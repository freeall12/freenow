import {BackSide, Color, LessEqualDepth, NoBlending, ShaderMaterial, Vector2} from 'three';

const DEFAULT_COLOR = 16739072;
const PROFILES = Object.freeze({selection: Object.freeze({layer: 6, edgeWidthCssPx: 3}), hover: Object.freeze({layer: 7, edgeWidthCssPx: 2})});

// Original WorkspaceViewfinder Ia: inverted hull with screen-space expansion.
// Shader chunks retain actual skin/morph/batching deformation and depth.
const fragmentShader = `
      uniform vec3 outlineColor;

      #include <common>
      #include <logdepthbuf_pars_fragment>
      #include <clipping_planes_pars_fragment>

      void main() {
        #include <clipping_planes_fragment>
        #include <logdepthbuf_fragment>
        gl_FragColor = vec4(outlineColor, 1.0);
        #include <colorspace_fragment>
      }
    `;
const vertexShader = `
      uniform vec2 resolution;
      uniform float thicknessPx;

      #include <common>
      #include <batching_pars_vertex>
      #include <morphtarget_pars_vertex>
      #include <skinning_pars_vertex>
      #include <logdepthbuf_pars_vertex>
      #include <clipping_planes_pars_vertex>

      void main() {
        #include <morphinstance_vertex>
        #include <batching_vertex>
        #include <beginnormal_vertex>
        #include <morphnormal_vertex>
        #include <skinbase_vertex>
        #include <skinnormal_vertex>
        #include <defaultnormal_vertex>

        // BackSide flips normals for lighting; silhouette expansion still needs the source outward
        // direction before face culling is applied.
        #ifdef FLIP_SIDED
          transformedNormal = -transformedNormal;
        #endif

        #include <begin_vertex>
        #include <morphtarget_vertex>
        #include <skinning_vertex>
        #include <project_vertex>

        vec4 neighborClip = projectionMatrix * vec4(
          mvPosition.xyz + normalize(transformedNormal),
          1.0
        );
        vec2 positionNdc = gl_Position.xy / max(abs(gl_Position.w), 0.000001);
        vec2 neighborNdc = neighborClip.xy / max(abs(neighborClip.w), 0.000001);
        vec2 direction = neighborNdc - positionNdc;
        float directionLength = length(direction);
        if (directionLength > 0.000001) {
          direction /= directionLength;
          gl_Position.xy += direction * thicknessPx * 2.0 / resolution * gl_Position.w;
        }

        #include <logdepthbuf_vertex>
        #include <clipping_planes_vertex>
      }
    `;

function meshLayer(root, layer, enabled) {
  root.traverse(object => {if (object.isMesh) {if (enabled) object.layers.enable(layer); else object.layers.disable(layer);}});
}
function cameraValue(camera) {if (!camera?.isCamera) throw new TypeError('outline camera must be a Three Camera'); return camera;}

/** Direct local translation of official cl/ll/pn/ul/$t. Owns one material,
 * reserves mesh layer 6 (selection) or 7 (hover), and borrows scene/camera/assets.
 * Render after the base depth pass, before editor overlays; never in captures. */
export function createSelectionOutline({scene, camera, presentation = 'selection', color = DEFAULT_COLOR, edgeWidthCssPx} = {}) {
  if (!scene?.isScene) throw new TypeError('outline scene must be a Three Scene');
  let currentCamera = cameraValue(camera);
  const profile = PROFILES[presentation];
  if (!profile) throw new TypeError('outline presentation must be selection or hover');
  const width = edgeWidthCssPx ?? profile.edgeWidthCssPx;
  if (!Number.isFinite(width) || width <= 0) throw new TypeError('outline edge width must be finite and positive');
  const uniforms = {outlineColor: {value: new Color(color ?? DEFAULT_COLOR)}, resolution: {value: new Vector2(1, 1)}, thicknessPx: {value: 1}};
  const material = new ShaderMaterial({blending: NoBlending, clipping: true, depthFunc: LessEqualDepth, depthTest: true, depthWrite: false,
    fragmentShader, name: 'WorkspaceSelectionSilhouetteMaterial', side: BackSide, toneMapped: false, transparent: false, uniforms, vertexShader});
  let selectedObjects = [], disposed = false;
  function setObjects(objects) {
    if (disposed) return false;
    if (!Array.isArray(objects) || objects.some(object => !object?.isObject3D)) throw new TypeError('outline objects must be an array of Three Object3D roots');
    const previous = new Set(selectedObjects), next = [...new Set(objects.filter(object => object.visible))], nextSet = new Set(next);
    for (const object of previous) if (!nextSet.has(object)) meshLayer(object, profile.layer, false);
    for (const object of next) if (!previous.has(object)) meshLayer(object, profile.layer, true);
    selectedObjects = next; return true;
  }
  function render({renderer, camera: nextCamera, outputTarget = null} = {}) {
    if (disposed || selectedObjects.length === 0) return false;
    if (nextCamera) currentCamera = cameraValue(nextCamera);
    const renderWidth = outputTarget?.width ?? renderer.domElement.width, renderHeight = outputTarget?.height ?? renderer.domElement.height;
    const pixelRatio = outputTarget ? 1 : renderer.getPixelRatio();
    uniforms.resolution.value.set(Math.max(1, renderWidth), Math.max(1, renderHeight));
    uniforms.thicknessPx.value = Math.max(1, width * pixelRatio);
    const previousTarget = renderer.getRenderTarget(), previousAutoClear = renderer.autoClear;
    const previousBackground = scene.background, previousOverride = scene.overrideMaterial, previousLayers = currentCamera.layers.mask;
    try {
      renderer.setRenderTarget(outputTarget); renderer.autoClear = false; scene.background = null; scene.overrideMaterial = material;
      currentCamera.layers.set(profile.layer); renderer.render(scene, currentCamera); return true;
    } finally {
      currentCamera.layers.mask = previousLayers; scene.background = previousBackground; scene.overrideMaterial = previousOverride;
      renderer.autoClear = previousAutoClear; renderer.setRenderTarget(previousTarget);
    }
  }
  function dispose() {
    if (disposed) return;
    disposed = true; for (const object of selectedObjects) meshLayer(object, profile.layer, false);
    selectedObjects = []; material.dispose();
  }
  return {setObjects, render, dispose, material, uniforms, layer: profile.layer, edgeWidthCssPx: width,
    get selectedObjects() {return [...selectedObjects];}, get camera() {return currentCamera;}, get disposed() {return disposed;}};
}
