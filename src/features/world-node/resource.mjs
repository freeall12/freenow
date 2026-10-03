import {assertReadableMediaSource, assertReadableResultMedia} from '../generation-results/media-ref.mjs';
import * as THREE from 'three';
import {inspectModel, loadSaved, disposeModel, disposeLoadedModel, maxBytes} from '../studio-v2/model-io.mjs';
import {materializationScope, readModelBlob} from './materialization.mjs';
import {previewChrome} from './preview-chrome.mjs';
import {DEFAULT_FOCAL, viewportFov, captureSize} from './preview-optics.mjs';
import {previewEnvironment, previewLights} from './preview-environment.mjs';
import {environmentControls} from './preview-environment-ui.mjs';
import {previewNavigation} from './preview-navigation.mjs';
import {assertWorldRendererSupport} from './render-capabilities.mjs';

const app = window.CanvasApp;
const el = (tag, cls, text) => {const node = document.createElement(tag); node.className = cls || ''; if (text !== undefined) node.textContent = text; return node;};
let current;
function stage(model, canvas, loaded) {
  const bounds = new THREE.Box3().setFromObject(model), center = bounds.getCenter(new THREE.Vector3());
  if (bounds.isEmpty()) throw Error('模型没有可显示的几何体');
  const renderer = new THREE.WebGLRenderer({canvas, antialias: true, preserveDrawingBuffer: true, alpha: false});
  try {
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#050505'); scene.add(model);
  previewLights(scene);
  const camera = new THREE.PerspectiveCamera(45, 1, .01, 10000);
  camera.fov = viewportFov(DEFAULT_FOCAL, canvas.clientWidth || 600, canvas.clientHeight || 400);
  const size = Math.max(...bounds.getSize(new THREE.Vector3()).toArray(), .01);
  camera.aspect = (canvas.clientWidth || 600) / (canvas.clientHeight || 400);
  // Fit all eight bounds corners in camera space using the official 0.5 fill.
  const direction = new THREE.Vector3(.78, 1.25, 1.12).normalize();
  camera.position.copy(center).add(direction); camera.lookAt(center); camera.updateMatrixWorld(true);
  const inverse = camera.quaternion.clone().invert(), tanY = Math.tan(camera.fov * Math.PI / 360), tanX = tanY * camera.aspect;
  let distance = Math.max(size, 1) * .1;
  for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
    const point = new THREE.Vector3(x, y, z).sub(center).applyQuaternion(inverse);
    distance = Math.max(distance, point.z + Math.abs(point.x) / (tanX * .5), point.z + Math.abs(point.y) / (tanY * .5));
  }
  camera.position.copy(center).addScaledVector(direction, distance);
  camera.near = Math.max(.01, distance / 100); camera.far = Math.max(1000, distance + size * 10); camera.lookAt(center);
  const minDistance = Math.max(.01, size * .15), maxDistance = Math.max(10, size * 20);
  let renderedWidth, renderedHeight;
  function render(width = canvas.clientWidth || 600, height = canvas.clientHeight || 400) {
    if (width !== renderedWidth || height !== renderedHeight) {renderer.setSize(width, height, false); renderedWidth = width; renderedHeight = height;}
    camera.aspect = width / height; camera.updateProjectionMatrix(); renderer.render(scene, camera);
  }
  let disposed = false;
  function dispose() {if (disposed) return; disposed = true; if (loaded) disposeLoadedModel(loaded); else disposeModel(model); renderer.dispose(); renderer.forceContextLoss();}
  return {renderer, scene, camera, center, minDistance, maxDistance, render, dispose};
  } catch (error) {renderer.dispose(); renderer.forceContextLoss(); throw error;}
}
function png(canvas) {return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(Error('预览图片编码失败')), 'image/png'));}

async function localize(file, outputType = 'asset', scope) {
  const canvas = document.createElement('canvas'); let view, prepared;
  try {
    prepared = await scope.wait(() => inspectModel(file, [], {signal: scope.signal}), {disposeLate: value => disposeLoadedModel(value.loaded)});
    view = stage(prepared.loaded.scene, canvas, prepared.loaded); view.render(600, 400); scope.check();
    const thumbnail = await scope.wait(() => png(canvas));
    // Covers use a durable data URL because legacy canvas renderers read img.src
    // directly; the source model remains a blob in the workspace asset store.
    const cover = await scope.wait(() => window.LocalMedia.asDataUrl(thumbnail));
    const url = await scope.wait(() => window.LocalAssets.put(file)), image = await scope.wait(() => window.LocalAssets.put(thumbnail));
    scope.check();
    return {image: cover, outputType, worldResource: {format: 'glb', url, thumbnail: image, name: file.name, bytes: file.size}};
  } finally {if (view) view.dispose(); else if (prepared) disposeLoadedModel(prepared.loaded);}
}
export async function importFile(file) {
  if (!/\.glb$/i.test(file.name)) throw Error('请选择 .glb 文件');
  const scope = materializationScope();
  try {return await localize(file, 'asset', scope);} finally {scope.close();}
}
export async function materialize(output, outputType, options = {}) {
  const url = output?.url || output?.model;
  if (typeof url !== 'string' || !url) throw Error('3D 结果缺少实际模型地址');
  assertWorldRendererSupport(output);
  assertReadableResultMedia(output);
  const scope = materializationScope(options);
  try {
    const resolved = await scope.wait(() => window.LocalAssets.url(url));
    let response;
    try {response = await scope.wait(() => fetch(resolved, {signal: scope.signal}), {disposeLate: value => value.body?.cancel?.().catch(() => {})});}
    catch (error) {scope.check(); throw Object.assign(Error('3D 结果读取失败，请检查网络、地址及跨域 CORS 后从原任务重试'), {code: 'world_download_failed', cause: error});}
    const blob = await readModelBlob(response, scope, maxBytes);
    const patch = await localize(new File([blob], output.filename || 'generated.glb', {type: 'model/gltf-binary'}), outputType, scope);
    for(const key of ['mime','sourceFileId','sourceUrl','representation','asset_metadata']) if(output[key]!==undefined)patch.worldResource[key]=structuredClone(output[key]);
    return patch;
  } finally {scope.close();}
}
export async function download(node) {
  assertReadableMediaSource(node.worldResource.url);
  const link = el('a'); link.href = await window.LocalAssets.url(node.worldResource.url); link.download = node.worldResource.name || node.title + '.glb'; link.click();
}

export async function preview(node, {panoramaUrl = null} = {}) {
  assertReadableMediaSource(panoramaUrl || node.worldResource?.url);
  const returnFocus = current?.returnFocus || document.activeElement;
  current?.close();
  const scenePreview = !panoramaUrl && node.outputType === 'world';
  const root = el('section', 'world-preview'); root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.ariaLabel = (scenePreview ? '3D 场景预览：' : '3D 物品预览：') + node.title; root.tabIndex = -1;
  if (panoramaUrl) root.ariaLabel = '全景预览：' + node.title;
  const canvas = el('canvas', 'world-preview-canvas'); canvas.ariaLabel = panoramaUrl ? '交互式全景预览' : '交互式 3D 预览'; canvas.setAttribute('role', 'application'); canvas.tabIndex = 0;
  const status = el('p', 'world-preview-status', '正在加载 3D 预览'); status.setAttribute('role', 'status');
  root.append(canvas, status); document.body.append(root); document.body.classList.add('media-editing');
  let alive = true, view, chrome, navigation, environment, environmentUI, observer, frame = 0, capturing = false, statusTimer;
  const close = () => {if (!alive) return; alive = false; clearTimeout(statusTimer); cancelAnimationFrame(frame); observer?.disconnect(); navigation?.dispose(); environmentUI?.dispose(); environment?.dispose(); chrome?.dispose(); view?.dispose(); root.remove(); document.body.classList.remove('media-editing'); if (current?.root === root) current = null; app.render(); const target = returnFocus?.isConnected ? returnFocus : document.querySelector('#canvas'); target?.focus({preventScroll: true});};
  const message = text => {if (!alive) return; clearTimeout(statusTimer); status.textContent = text; status.hidden = false; statusTimer = setTimeout(() => {status.hidden = true;}, 3500);};
  current = {root, close, returnFocus}; root.focus();
  root.onkeydown = event => {event.stopPropagation(); if (event.key === 'Escape') close();};
  try {
    if (panoramaUrl) view = await (await import('./panorama-stage.mjs')).panoramaStage(panoramaUrl, canvas);
    else {
      const loaded = await loadSaved(node.worldResource.url);
      if (!alive) {disposeLoadedModel(loaded); return;}
      try {view = stage(loaded.scene, canvas, loaded);} catch (error) {disposeLoadedModel(loaded); throw error;}
    }
    if (!alive) {view.dispose(); return;}
    status.hidden = true;
    const targetFov = () => viewportFov(chrome?.focal ?? DEFAULT_FOCAL, canvas.clientWidth, canvas.clientHeight, chrome?.aspect ?? null);
    let lastTime = performance.now();
    function draw(time = performance.now()) {
      const delta = Math.min(.05, Math.max(0, (time - lastTime) / 1000)); lastTime = time;
      const navigating = navigation?.tick(delta), target = targetFov(), difference = target - view.camera.fov;
      view.camera.fov = Math.abs(difference) <= .05 ? target : view.camera.fov + difference * Math.min(1, 12 * delta);
      const transitioning = environment?.tick(delta); view.render();
      if (navigating || transitioning || Math.abs(target - view.camera.fov) > .001) frame = requestAnimationFrame(draw); else frame = 0;
    }
    const invalidate = () => {if (!alive) return; if (!frame) {lastTime = performance.now() - 16; frame = requestAnimationFrame(draw);}};
    if (!panoramaUrl) {
      environment = previewEnvironment(view, invalidate);
      environmentUI = environmentControls(root, environment, message);
    }
    chrome = previewChrome(root, canvas, {
      onClose: close, onChange: invalidate, environmentControls: environmentUI?.element, scenePreview, panoramaPreview: !!panoramaUrl,
      onReset: () => navigation?.reset(),
      onCapture: async capture => {
        if (capturing || !chrome.aspect) return; capturing = true; capture.disabled = true;
        try {
          // Settle the projection and capture with a separate full-resolution camera.
          // UI borders stay outside the render; screen DPR does not scale the export.
          view.camera.fov = targetFov(); view.render();
          const aspect = chrome.aspect, {width, height} = captureSize(aspect);
          const camera = view.camera.clone(); camera.aspect = width / height;
          const fraction = parseFloat(root.querySelector('.world-viewfinder').style.height) / canvas.clientHeight;
          camera.fov = 2 * Math.atan(Math.tan(view.camera.fov * Math.PI / 360) * fraction) * 180 / Math.PI;
          camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
          const output = renderPhoto(view, camera, width, height); chrome.flash();
          const blob = await png(output);
          if (!alive || !app.getState().nodes.some(n => n.id === node.id)) throw Error('来源节点已删除或预览已关闭');
          const url = await new Promise((resolve, reject) => {const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(blob);});
          if (!alive || !app.getState().nodes.some(n => n.id === node.id)) return;
          app.createConnected(node.id, [{type: 'image', title: node.title + ' 拍摄', image: url, pixelWidth: width, pixelHeight: height, width: 375, height: 375 * height / width}]);
          message('照片已添加到画布');
        } catch (error) {message(error.message);}
        finally {capturing = false; capture.disabled = false;}
      },
      onEnter: async enter => {
        enter.disabled = true;
        try {
          if (!app.getState().nodes.some(n => n.id === node.id)) throw Error('来源节点已删除');
          const draft = panoramaUrl ? (await import('./panorama-stage.mjs')).panoramaStudio(node, panoramaUrl)
            : {type: 'studio', title: '3D 片场', width: 375, height: 250, studioV2: {version: 2, asset: node.worldResource.url}};
          if (!alive || !app.getState().nodes.some(n => n.id === node.id)) return;
          const [studio] = app.createConnected(node.id, [draft]);
          close(); await window.StudioAPI.open(studio.id);
        } catch (error) {app.notify(error.message); enter.disabled = false;}
      }
    });
    navigation = previewNavigation({camera: view.camera, canvas, root, target: scenePreview || panoramaUrl ? null : view.center, minDistance: view.minDistance, maxDistance: view.maxDistance, movement: scenePreview, getFocal: () => chrome.focal, setFocal: chrome.setFocal, invalidate, onDrag: chrome.dismissGuide});
    observer = new ResizeObserver(() => {chrome.refresh(); environmentUI?.refresh(); invalidate();}); observer.observe(canvas);
    view.camera.fov = targetFov(); view.render();
  } catch (error) {
    if (alive) {
      status.textContent = '预览无法加载：' + error.message;
      for (const [label, action] of [['重试', () => preview(node, {panoramaUrl})], ['关闭', close]]) {const button = el('button', 'world-button', label); button.onclick = action; status.append(button);}
    }
  }
}
function renderPhoto(view, camera, width, height) {
  const {renderer, scene} = view;
  if (Math.max(width, height) > renderer.capabilities.maxTextureSize) throw Error('此设备无法渲染 4096px 照片');
  const size = renderer.getSize(new THREE.Vector2()), pixelRatio = renderer.getPixelRatio();
  const target = renderer.getRenderTarget(), viewport = renderer.getViewport(new THREE.Vector4()), scissor = renderer.getScissor(new THREE.Vector4()), scissorTest = renderer.getScissorTest();
  try {
    // Three disables display tone mapping on ordinary render targets. Render to
    // the same context's default framebuffer, copy synchronously, and restore
    // before yielding so HDR PMREM resources and displayed colors stay intact.
    renderer.setRenderTarget(null); renderer.setPixelRatio(1); renderer.setSize(width, height, false);
    renderer.setViewport(0, 0, width, height); renderer.setScissorTest(false); renderer.render(scene, camera);
    const output = document.createElement('canvas'); output.width = width; output.height = height;
    output.getContext('2d').drawImage(renderer.domElement, 0, 0); return output;
  } finally {
    renderer.setPixelRatio(pixelRatio); renderer.setSize(size.x, size.y, false); renderer.setRenderTarget(target);
    renderer.setViewport(viewport); renderer.setScissor(scissor); renderer.setScissorTest(scissorTest);
    view.render();
  }
}
