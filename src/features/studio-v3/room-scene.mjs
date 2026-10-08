import * as THREE from 'three';
import {clone, requireDomain} from './invariants.mjs';
import {assertRoomConfig} from './space-actions.mjs';

const ownedRooms = new WeakMap();
const textureSize = 64, inset = 0.004, edgeRadius = 0.035, markerRadius = edgeRadius / 4, edgeMargin = edgeRadius * 2;
const axisColors = {x: 16724016, y: 2283119, z: 3108351};
const noRaycast = () => {};
const round = value => Math.round(value * 1000) / 1000;

function roomTexture(config, width, depth, own) {
  const data = new Uint8Array(textureSize * textureSize * 4);
  for (let y = 0; y < textureSize; y++) for (let x = 0; x < textureSize; x++) {
    const opposite = (x < 32) !== (y < 32);
    let color = opposite ? 0xffffff : 7368816;
    if (config.trackingGuides.mode === 'calibration') {
      const localX = x % 32, localY = y % 32, origin = opposite ? 6 : 9;
      const insideX = localX >= origin && localX < origin + 8, insideY = localY >= origin && localY < origin + 8;
      const marker = (localX >= origin && localX < origin + 2 && insideY) || (localY >= origin && localY < origin + 2 && insideX);
      color = marker ? opposite ? 6250335 : 0xffffff : opposite ? 0xffffff : 6250335;
    }
    const index = (y * textureSize + x) * 4;
    data[index] = color >> 16 & 255;data[index + 1] = color >> 8 & 255;data[index + 2] = color & 255;data[index + 3] = 255;
  }
  const texture = own(new THREE.DataTexture(data, textureSize, textureSize), 'textures');
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;texture.magFilter = THREE.NearestFilter;texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.anisotropy = 8;texture.generateMipmaps = true;texture.colorSpace = THREE.SRGBColorSpace;
  const tile = config.trackingGuides.spacingMeters * 2;
  texture.repeat.set(Math.max(1, width / tile), Math.max(1, depth / tile));texture.needsUpdate = true;return texture;
}
function surfaceMaterial(config, width, depth, own) {
  const guides = config.trackingGuides, white = guides.mode === 'white';
  const material = own(new THREE.MeshStandardMaterial({color: white ? 0xffffff : 7895160, roughness: white ? 0.82 : 0.9, metalness: 0, side: THREE.FrontSide}), 'materials');
  if (guides.enabled && !white) {material.map = roomTexture(config, width, depth, own);material.color.set(0xffffff);material.needsUpdate = true;}
  return material;
}
function guideMaterial(axis, own) {
  const material = own(new THREE.MeshBasicMaterial({color: axisColors[axis], side: THREE.FrontSide, transparent: false, opacity: 1, depthWrite: false, toneMapped: false}), 'materials');
  material.alphaToCoverage = true;return material;
}
function basis(tangent, normal, length = 1) {
  const t = tangent.clone().normalize(), n = normal.clone().normalize(), side = new THREE.Vector3().crossVectors(t, n).normalize();
  return new THREE.Matrix4().makeBasis(side, t.multiplyScalar(length), n);
}
function symmetricMarks(size, spacing) {
  const half = size / 2 - edgeMargin;if (half <= 0) return [];
  const count = Math.floor(half / spacing);return Array.from({length: count * 2 + 1}, (_, index) => round((index - count) * spacing));
}
function heightMarks(height, spacing) {
  const first = Math.ceil(edgeMargin / spacing), last = Math.floor((height - edgeMargin) / spacing);
  return Array.from({length: Math.max(0, last - first + 1)}, (_, index) => round((index + first) * spacing));
}
function trackingGuides(config, groundY, own) {
  const root = new THREE.Group();root.name = 'mesh-preset-tracking-guides';
  if (!config.trackingGuides.lineMarkers) return root;
  const {width, depth, height} = config, spacing = config.trackingGuides.spacingMeters;
  const x = new THREE.Vector3(1, 0, 0), y = new THREE.Vector3(0, 1, 0), z = new THREE.Vector3(0, 0, 1);
  const up = y.clone(), down = y.clone().negate(), front = z.clone(), back = z.clone().negate(), right = x.clone(), left = x.clone().negate();
  const edges = new THREE.Group();edges.name = 'mesh-preset-room-edge-guides';root.add(edges);
  const halfW = Math.max(0, width / 2 - inset - edgeRadius), halfD = Math.max(0, depth / 2 - inset - edgeRadius);
  const bottom = groundY + inset + edgeRadius, top = groundY + height - inset - edgeRadius;
  const length = size => Math.max(edgeRadius * 2, size - inset * 2);
  const edgeMaterials = Object.fromEntries(['x', 'y', 'z'].map(axis => [axis, guideMaterial(axis, own)]));
  const edge = (axis, tangent, normal, position, span) => {
    const mesh = own(new THREE.Mesh(own(new THREE.CylinderGeometry(edgeRadius, edgeRadius, span, 24, 1, false), 'geometries'), edgeMaterials[axis]), 'meshes');
    mesh.name = 'mesh-preset-room-edge-guide-strip';mesh.position.set(...position);mesh.quaternion.setFromRotationMatrix(basis(tangent, normal));
    mesh.renderOrder = 2;mesh.raycast = noRaycast;mesh.userData.meshPresetGuide = true;mesh.userData.meshPresetGuideAxis = axis;edges.add(mesh);
  };
  for (const [level, normal] of [[bottom, up], [top, down]]) {
    for (const edgeZ of [-halfD, halfD]) edge('x', x, normal, [0, level, edgeZ], length(width));
    for (const edgeX of [-halfW, halfW]) edge('z', z, normal, [edgeX, level, 0], length(depth));
  }
  for (const edgeX of [-halfW, halfW]) for (const edgeZ of [-halfD, halfD]) edge('y', y, front, [edgeX, (bottom + top) / 2, edgeZ], length(height));
  const lines = new THREE.Group();lines.name = 'mesh-preset-room-line-markers';root.add(lines);
  const specs = {x: [], y: [], z: []}, span = size => Math.max(markerRadius * 2, size - edgeMargin * 2);
  const add = (axis, tangent, normal, position, size) => specs[axis].push(basis(tangent, normal, span(size)).setPosition(...position));
  const floor = groundY + inset + markerRadius, ceiling = groundY + height - inset - markerRadius;
  const near = -depth / 2 + inset + markerRadius, far = depth / 2 - inset - markerRadius;
  const west = -width / 2 + inset + markerRadius, east = width / 2 - inset - markerRadius, middle = groundY + height / 2;
  for (const mark of symmetricMarks(depth, spacing)) {add('x', x, up, [0, floor, mark], width);add('x', x, down, [0, ceiling, mark], width);}
  for (const mark of symmetricMarks(width, spacing)) {add('z', z, up, [mark, floor, 0], depth);add('z', z, down, [mark, ceiling, 0], depth);}
  for (const mark of heightMarks(height, spacing)) {
    add('x', x, front, [0, groundY + mark, near], width);add('x', x, back, [0, groundY + mark, far], width);
    add('z', z, right, [west, groundY + mark, 0], depth);add('z', z, left, [east, groundY + mark, 0], depth);
  }
  for (const mark of symmetricMarks(width, spacing)) {add('y', y, front, [mark, middle, near], height);add('y', y, back, [mark, middle, far], height);}
  for (const mark of symmetricMarks(depth, spacing)) {add('y', y, right, [west, middle, mark], height);add('y', y, left, [east, middle, mark], height);}
  for (const axis of ['x', 'y', 'z']) {
    const geometry = own(new THREE.CylinderGeometry(markerRadius, markerRadius, 1, 12, 1, false), 'geometries');
    const mesh = own(new THREE.InstancedMesh(geometry, guideMaterial(axis, own), specs[axis].length), 'meshes');
    mesh.name = 'mesh-preset-room-line-marker';mesh.renderOrder = 1;mesh.raycast = noRaycast;mesh.userData.meshPresetGuide = true;mesh.userData.meshPresetGuideAxis = axis;
    specs[axis].forEach((matrix, index) => mesh.setMatrixAt(index, matrix));mesh.instanceMatrix.needsUpdate = true;lines.add(mesh);
  }
  return root;
}

/** Official sx room surfaces at the actual ground elevation, with owned assets. */
export function createRoomScene({config, groundY = 0} = {}) {
  assertRoomConfig(config);requireDomain(Number.isFinite(groundY), 'roomScene.groundY', 'must be finite');
  const resources = {geometries: new Set(), materials: new Set(), textures: new Set(), meshes: new Set()};
  const own = (value, kind) => {resources[kind].add(value);return value;};
  const root = new THREE.Group();root.name = 'mesh-preset-world:room';
  const plane = (name, width, depth, position, rotation, receiveShadow = true) => {
    const mesh = own(new THREE.Mesh(own(new THREE.PlaneGeometry(width, depth), 'geometries'), surfaceMaterial(config, width, depth, own)), 'meshes');
    mesh.name = name;mesh.position.set(...position);mesh.rotation.set(...rotation);mesh.receiveShadow = receiveShadow;root.add(mesh);
  };
  const {width, depth, height} = config, middle = groundY + height / 2;
  plane('mesh-preset-floor', width, depth, [0, groundY, 0], [-Math.PI / 2, 0, 0]);
  plane('mesh-preset-ceiling', width, depth, [0, groundY + height, 0], [Math.PI / 2, 0, 0], false);
  plane('mesh-preset-wall', width, height, [0, middle, -depth / 2], [0, 0, 0]);
  plane('mesh-preset-wall', width, height, [0, middle, depth / 2], [0, Math.PI, 0]);
  plane('mesh-preset-wall', depth, height, [-width / 2, middle, 0], [0, Math.PI / 2, 0]);
  plane('mesh-preset-wall', depth, height, [width / 2, middle, 0], [0, -Math.PI / 2, 0]);
  root.updateMatrixWorld(true);
  // Derive bounds from the six real surfaces before decorative guides. Camera
  // helpers or children attached later cannot inflate the authored room bounds.
  const bounds = new THREE.Box3().setFromObject(root, true);
  if (config.trackingGuides.enabled && config.trackingGuides.mode !== 'white') root.add(trackingGuides(config, groundY, own));
  root.updateMatrixWorld(true);
  Object.assign(root.userData, {spaceSource: {kind: 'mesh-preset', preset: 'room'}, roomConfig: clone(config), groundY, bounds, surfaceCount: 6, disposed: false});
  ownedRooms.set(root, resources);return root;
}

/** Idempotent; never disposes caller-owned helpers, lights or shared resources. */
export function disposeRoomScene(root) {
  const resources = ownedRooms.get(root);if (!resources) return false;
  ownedRooms.delete(root);
  for (const mesh of resources.meshes) if (mesh.isInstancedMesh) mesh.dispose();
  for (const kind of ['geometries', 'materials', 'textures']) for (const resource of resources[kind]) resource.dispose();
  root.userData.disposed = true;return true;
}
