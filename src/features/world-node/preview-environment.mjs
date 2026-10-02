import * as THREE from 'three';
import {HDRLoader} from 'three/addons/loaders/HDRLoader.js';
import {EXRLoader} from 'three/addons/loaders/EXRLoader.js';
import {environmentPresets} from '../../../studio-environment-data.mjs';

// Catalog file IDs match current official release eb1c357; provenance and hashes
// for these unchanged files are in reference/stage-environment-assets.json.
export const presets = environmentPresets.map(p => ({...p, url: '/' + p.url, preview: '/' + p.preview, format: 'hdr'}));
const backgroundKey = 'tapnow.threeDWorkspace.assetPreview.backgroundVisible';
export const normalizeRotation = value => Number.isFinite(value) ? ((value % 360) + 360) % 360 : 0;

export function previewLights(scene) {
  const rig = new THREE.Group(); rig.name = 'preview-light-rig';
  const key = new THREE.DirectionalLight(0xffffff, 1.8); key.position.set(-3.5, 5.5, 4.5);
  rig.add(new THREE.AmbientLight(0xffffff, .32), new THREE.HemisphereLight(16448767, 15000284, .72), key); scene.add(rig);
}

async function loadTexture(resource, signal, onProgress) {
  const response = await fetch(resource.url, {signal});
  if (!response.ok) throw Error('HDRI 文件读取失败');
  const reader = response.body.getReader(), chunks = [], total = Number(response.headers.get('content-length')) || 0;
  let length = 0;
  while (true) {const {done, value} = await reader.read(); if (done) break; chunks.push(value); length += value.length; onProgress?.(total ? Math.min(1, length / total) : null);}
  signal.throwIfAborted();
  const bytes = new Uint8Array(length); let offset = 0; for (const part of chunks) {bytes.set(part, offset); offset += part.length;}
  let data;
  try {data = (resource.format === 'exr' ? new EXRLoader() : new HDRLoader()).parse(bytes.buffer);}
  catch (cause) {throw new Error('文件无法解码，请选择有效的 HDR 或 EXR 文件', {cause});}
  if (!data?.data || !data.width || !data.height) throw Error('HDRI 文件无法解码');
  const texture = new THREE.DataTexture(data.data, data.width, data.height);
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  for (const key of ['type', 'colorSpace', 'minFilter', 'magFilter', 'format', 'flipY', 'generateMipmaps']) if (data[key] !== undefined) texture[key] = data[key];
  texture.mapping = THREE.EquirectangularReflectionMapping; texture.needsUpdate = true;
  return texture;
}

export function previewEnvironment(view, invalidate) {
  const {scene, renderer} = view;
  let disposed = false, request = 0, pending, texture, target, fade, resource = null, rotation = 0, showBackground = true;
  try {showBackground = localStorage.getItem(backgroundKey) !== '0';} catch {}
  const dark = new THREE.Color(0x050505);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  function background(animate = false) {
    const to = showBackground && texture ? 1 : 0;
    if (!texture) {scene.background = dark; scene.backgroundIntensity = 1; fade = null; return;}
    const from = scene.background === texture ? scene.backgroundIntensity : 0;
    scene.background = texture;
    if (animate && !reduced.matches && Math.abs(from - to) > .001) fade = {from, to, elapsed: 0, duration: .22 * Math.max(.01, Math.abs(from - to))};
    else {fade = null; scene.backgroundIntensity = to || 1; if (!to) scene.background = dark;}
    invalidate();
  }
  return {
    get resource() {return resource;}, get rotation() {return rotation;}, get backgroundVisible() {return showBackground;},
    async select(next, onProgress) {
      if (disposed) return false;
      const id = ++request; pending?.abort(); pending = new AbortController();
      if (resource?.url === next.url && texture) return true;
      let loaded, pmrem, output;
      try {
        loaded = await loadTexture(next, pending.signal, onProgress);
        if (disposed || id !== request) return false;
        if (Math.max(loaded.image.width, loaded.image.height) > renderer.capabilities.maxTextureSize) throw Error('此设备不支持该 HDRI 分辨率');
        pmrem = new THREE.PMREMGenerator(renderer); output = pmrem.fromEquirectangular(loaded);
        const oldTexture = texture, oldTarget = target;
        texture = loaded; target = output; resource = next; loaded = output = null;
        scene.environment = target.texture; scene.environmentIntensity = 1;
        scene.environmentRotation.y = scene.backgroundRotation.y = THREE.MathUtils.degToRad(rotation);
        background(false); oldTexture?.dispose(); oldTarget?.dispose(); invalidate(); return true;
      } catch (error) {
        if (disposed || id !== request || error.name === 'AbortError') return false;
        throw error;
      } finally {loaded?.dispose(); output?.dispose(); pmrem?.dispose();}
    },
    setRotation(value) {rotation = normalizeRotation(value); scene.environmentRotation.y = scene.backgroundRotation.y = THREE.MathUtils.degToRad(rotation); invalidate();},
    toggleBackground() {
      showBackground = !showBackground;
      try {if (showBackground) localStorage.removeItem(backgroundKey); else localStorage.setItem(backgroundKey, '0');} catch {}
      background(true);
    },
    tick(delta) {
      if (!fade) return false;
      fade.elapsed += Math.max(0, delta); const t = Math.min(1, fade.elapsed / fade.duration), eased = t * t * (3 - 2 * t);
      scene.backgroundIntensity = THREE.MathUtils.lerp(fade.from, fade.to, eased);
      if (t === 1) {if (!fade.to) {scene.background = dark; scene.backgroundIntensity = 1;} fade = null;}
      return !!fade;
    },
    dispose() {disposed = true; request++; pending?.abort(); scene.environment = null; scene.background = dark; texture?.dispose(); target?.dispose(); texture = target = fade = null;}
  };
}
