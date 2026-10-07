import {Box3, Color, DoubleSide, Euler, Group, MeshStandardMaterial, Vector3, Vector4} from 'three';
import {LineMaterial} from 'three/addons/lines/LineMaterial.js';
import {LineSegments2} from 'three/addons/lines/LineSegments2.js';
import {LineSegmentsGeometry} from 'three/addons/lines/LineSegmentsGeometry.js';
import {planRotationToCamera} from './transform-coordinates.mjs';

const STYLE = Object.freeze({layer: 5, size: .25, bodyOffset: .13, assetForwardYaw: Math.PI / 2,
  bodyColor: 15399156, selectedOutlineColor: 16739072, distance: .18, maxHalfHeight: .04125,
  maxHalfWidth: .07125, defaultAspect: 16 / 9, renderOrder: 20,
  outlineWidth: 1.7, strokeWidth: .9, selectedOutlineWidth: 2.4, selectedStrokeWidth: 1.05});
const ORDERS = new Set(['XYZ', 'YXZ', 'ZXY', 'ZYX', 'YZX', 'XZY']);
const identityPose = () => ({position: {x: 0, y: 0, z: 0}, rotation: {x: 0, y: 0, z: 0, order: 'XYZ'}});

function helperLayer(object) {object.traverse(child => {child.layers.set(STYLE.layer); child.userData.helper = child.userData.captureExcluded = true;});}
function group(name, entityId) {
  const object = new Group(); object.name = name; object.userData.worldEntityId = object.userData.entityId = entityId; helperLayer(object); return object;
}
function colorValue(value) {
  if (!value) return new Color(STYLE.bodyColor);
  try {return new Color(value);} catch {return new Color(STYLE.bodyColor);}
}
const outlineColor = color => color.clone().multiplyScalar(.58);
function finiteVector(value, label) {
  if (!value || !['x', 'y', 'z'].every(axis => typeof value[axis] === 'number' && Number.isFinite(value[axis]))) throw new TypeError(`${label} must contain finite x, y and z`);
}

// Official Xc ignores hidden renderables, uses skinned-object bounds where
// available, and falls back to Three's object bounds for an empty traversal.
function renderableBounds(root) {
  root.updateMatrixWorld(true);
  const result = new Box3(), local = new Box3();
  root.traverse(object => {
    if (!object.visible) return;
    if (object.isSkinnedMesh) {
      const geometry = object.geometry;
      if (object.skeleton && geometry?.getAttribute('position') && geometry.getAttribute('skinIndex') && geometry.getAttribute('skinWeight')) object.computeBoundingBox();
      if (object.boundingBox && !object.boundingBox.isEmpty()) result.union(local.copy(object.boundingBox).applyMatrix4(object.matrixWorld));
      return;
    }
    if (!object.geometry) return;
    if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
    if (object.geometry.boundingBox) result.union(local.copy(object.geometry.boundingBox).applyMatrix4(object.matrixWorld));
  });
  return result.isEmpty() ? new Box3().setFromObject(root) : result;
}
function normalizeIcon(assetRoot) {
  const normalized = new Group(); normalized.name = 'director-camera-icon-normalized';
  // Clone nodes only: the caller retains the original geometry/material/textures.
  normalized.add(assetRoot.clone(true)); normalized.updateMatrixWorld(true);
  const bounds = renderableBounds(normalized);
  if (bounds.isEmpty()) return normalized;
  const size = bounds.getSize(new Vector3()), longest = Math.max(size.x, size.y, size.z);
  if (!Number.isFinite(longest)) throw new TypeError('camera asset bounds must be finite');
  if (longest <= 1e-4) return normalized;
  normalized.scale.setScalar(STYLE.size / longest); normalized.updateMatrixWorld(true);
  const center = renderableBounds(normalized).getCenter(new Vector3()); finiteVector(center, 'camera asset center');
  normalized.position.sub(center); normalized.updateMatrixWorld(true); return normalized;
}
function cameraState(input) {
  if (input?.camera !== undefined || input?.transform !== undefined) return input;
  return {camera: input || {}, transform: identityPose()};
}
function opticalPose(state) {
  const position = state.camera?.position ?? state.transform?.position ?? identityPose().position;
  const rotation = state.camera?.rotation ?? (state.transform?.rotation ? planRotationToCamera(state.transform.rotation) : identityPose().rotation);
  finiteVector(position, 'camera position'); finiteVector(rotation, 'camera rotation');
  if (!ORDERS.has(rotation.order ?? 'XYZ')) throw new TypeError('camera rotation order is invalid');
  return {position: new Vector3(position.x, position.y, position.z), rotation: new Euler(rotation.x, rotation.y, rotation.z, rotation.order ?? 'XYZ')};
}
function frustumPositions(state) {
  const aspect = state.camera?.frameAspectRatio ?? STYLE.defaultAspect, fov = state.camera?.fov ?? 50;
  if (!Number.isFinite(aspect) || aspect <= 0 || !Number.isFinite(fov) || fov <= 0 || fov >= 180) throw new TypeError('camera frustum needs a finite positive aspect and FOV between 0 and 180');
  const halfHeight = Math.min(Math.tan(fov * Math.PI / 360) * STYLE.distance, STYLE.maxHalfHeight);
  const halfWidth = Math.min(halfHeight * aspect, STYLE.maxHalfWidth), z = -STYLE.distance;
  const corners = [[-halfWidth, halfHeight, z], [halfWidth, halfHeight, z], [halfWidth, -halfHeight, z], [-halfWidth, -halfHeight, z]];
  const segments = [...corners.map((corner, index) => [corner, corners[(index + 1) % 4]]), ...corners.map(corner => [[0, 0, 0], corner])];
  return new Float32Array(segments.flat(2));
}

/** The caller owns the decoded raw GLB root and all of its shared resources.
 * This helper owns cloned nodes, replacement body materials and both line
 * geometries/materials. No loader, renderer or external calls are hidden here. */
export function createCameraMarker({assetRoot, entityId, color, selected = false} = {}) {
  if (!assetRoot?.isObject3D || typeof assetRoot.clone !== 'function') throw new TypeError('assetRoot must be a decoded raw Three Object3D');
  if (typeof entityId !== 'string' || !entityId) throw new TypeError('entityId must be a nonempty string');
  const root = group(`director-camera:${entityId}`, entityId), frustumRoot = group('director-camera-frustum', entityId);
  const bodyRoot = group('director-camera-body', entityId), iconRoot = group('director-camera-icon', entityId);
  bodyRoot.position.z = STYLE.bodyOffset; iconRoot.rotation.y = STYLE.assetForwardYaw; iconRoot.renderOrder = STYLE.renderOrder + 2;
  root.add(frustumRoot, bodyRoot); bodyRoot.add(iconRoot);
  const ownedMaterials = [], ownedGeometries = [], bodyMaterials = [], viewport = new Vector4();
  let disposed = false, currentColor = colorValue(color), currentSelected = !!selected, currentCamera;
  const lineWidths = {outline: STYLE.outlineWidth, stroke: STYLE.strokeWidth};
  let outlineLine, strokeLine;
  function dispose() {
    if (disposed) return;
    disposed = true; root.removeFromParent();
    for (const geometry of ownedGeometries) geometry.dispose();
    for (const material of ownedMaterials) material.dispose();
    iconRoot.clear(); frustumRoot.clear(); root.clear(); bodyMaterials.length = 0;
  }
  function makeLine(name, widthKey, lineColor, renderOrder) {
    const material = new LineMaterial({color: lineColor, linewidth: lineWidths[widthKey], depthTest: true, depthWrite: true, toneMapped: false}); ownedMaterials.push(material);
    const geometry = new LineSegmentsGeometry(); ownedGeometries.push(geometry);
    const line = new LineSegments2(geometry, material); line.name = name; line.frustumCulled = false; line.renderOrder = renderOrder; helperLayer(line);
    line.onBeforeRender = renderer => {
      renderer.getViewport(viewport); material.resolution.set(viewport.z, viewport.w); material.linewidth = lineWidths[widthKey] * renderer.getPixelRatio();
    };
    return line;
  }
  function update(options = {}) {
    if (disposed) return false;
    const nextCamera = options.camera === undefined ? currentCamera : options.camera, state = cameraState(nextCamera);
    // Validate before changing any visible state; domain input must not poison matrices.
    const positions = frustumPositions(state), pose = options.transformPreviewActive ? null : opticalPose(state);
    const nextColor = options.color === undefined ? currentColor : colorValue(options.color);
    const nextSelected = options.selected === undefined ? currentSelected : !!options.selected;
    if (pose) {root.position.copy(pose.position); root.rotation.copy(pose.rotation); root.scale.set(1, 1, 1);}
    if (!currentColor.equals(nextColor)) {
      currentColor.copy(nextColor);
      for (const material of bodyMaterials) {material.color.copy(currentColor); material.needsUpdate = true;}
    }
    strokeLine.material.color.copy(currentColor);
    outlineLine.material.color.copy(nextSelected ? new Color(STYLE.selectedOutlineColor) : outlineColor(currentColor));
    lineWidths.outline = nextSelected ? STYLE.selectedOutlineWidth : STYLE.outlineWidth;
    lineWidths.stroke = nextSelected ? STYLE.selectedStrokeWidth : STYLE.strokeWidth;
    for (const line of [outlineLine, strokeLine]) {line.geometry.setPositions(positions); line.visible = positions.length > 0;}
    outlineLine.material.linewidth = lineWidths.outline; strokeLine.material.linewidth = lineWidths.stroke;
    if (options.visible !== undefined) root.visible = !!options.visible;
    currentCamera = nextCamera; currentSelected = nextSelected; root.updateMatrixWorld(true); return true;
  }
  try {
    outlineLine = makeLine('director-camera-outline-line', 'outline', outlineColor(currentColor), STYLE.renderOrder);
    strokeLine = makeLine('director-camera-stroke-line', 'stroke', currentColor, STYLE.renderOrder + 1); frustumRoot.add(outlineLine, strokeLine);
    const normalized = normalizeIcon(assetRoot); iconRoot.add(normalized); helperLayer(iconRoot);
    normalized.traverse(object => {
      if (!object.isMesh) return;
      const material = new MeshStandardMaterial({color: currentColor, metalness: .06, roughness: .78, envMapIntensity: .18, depthTest: true, depthWrite: true, toneMapped: true, side: DoubleSide});
      ownedMaterials.push(material); bodyMaterials.push(material);
      object.material = material; object.frustumCulled = false; object.renderOrder = STYLE.renderOrder + 2;
    });
    update({selected});
    return {root, transformRoot: root, bodyRoot, iconRoot, frustumRoot, transformPivot: bodyRoot, outlineTarget: iconRoot, pickTarget: iconRoot, update, dispose};
  } catch (error) {dispose(); throw error;}
}
