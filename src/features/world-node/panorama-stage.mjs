import {assertReadableMediaSource} from '../generation-results/media-ref.mjs';
import * as THREE from 'three';

// Official Gn: a camera at the origin viewing an equirectangular background.
export async function panoramaStage(src, canvas) {
  assertReadableMediaSource(src);
  const texture = await new THREE.TextureLoader().loadAsync(await window.LocalAssets.url(src));
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true});
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1;
    const scene = new THREE.Scene(); scene.background = texture;
    const camera = new THREE.PerspectiveCamera(60, 1, .01, 1000); camera.lookAt(0, 0, -1);
    let renderedWidth, renderedHeight;
    return {renderer, scene, camera, render(width = canvas.clientWidth, height = canvas.clientHeight) {
      width = Math.max(1, width); height = Math.max(1, height);
      if (width !== renderedWidth || height !== renderedHeight) {renderer.setSize(width, height, false); renderedWidth = width; renderedHeight = height;}
      camera.aspect = width / height; camera.updateProjectionMatrix(); renderer.render(scene, camera);
    }, dispose() {scene.background = null; texture.dispose(); renderer.dispose(); renderer.forceContextLoss();}};
  } catch (error) {texture.dispose(); renderer?.dispose(); throw error;}
}

export function panoramaStudio(node, src) {
  const panorama = {url: src, format: 'image', name: node.title};
  return {type: 'studio', title: node.title || '3D 片场', width: 375, height: 250,
    sourceNodeId: node.id, sourceKind: 'panorama', sourceSnapshot: {display_name: node.title, pano_url: src, src_thumbnail_url: src},
    studio: {version: 1, ground: {y: -1.7, size: 20, grid: false, room: false, hidden: true},
      environment: {background: 'panorama', panorama, panoramaRotation: 0, azimuth: 0, intensity: 1},
      viewer: {position: [0, 0, 0], rotation: [0, 0, 0], order: 'YXZ', focal: 24, aspect: 16 / 9},
      objects: [], keyframes: [], captures: []}};
}
