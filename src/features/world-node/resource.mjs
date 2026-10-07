import {decodeSplat,splatProxy,splatAxisScale,spatialBounds,SplatContext} from './splat-io.mjs';
import {splatLimits} from './splat-contract.mjs';
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
import {isGenerationMediaRef} from '../generation-results/media-ref.mjs';
import {isStaticAssetRef} from '../local-resource-migration/index-format.mjs';

const app = window.CanvasApp;
const el = (tag, cls, text) => {const node = document.createElement(tag); node.className = cls || ''; if (text !== undefined) node.textContent = text; return node;};
let current;
function stage(model, canvas, loaded, {splatMesh} = {}) {
  const splat=!!model.userData?.worldSplat;const bounds = splat?spatialBounds(model,undefined,{framing:true}):new THREE.Box3().setFromObject(model), center = bounds.getCenter(new THREE.Vector3());
  if (bounds.isEmpty()) throw Error('模型没有可显示的几何体');
  const renderer = new THREE.WebGLRenderer({canvas, antialias: !splat, preserveDrawingBuffer: true, alpha: false});
  try {
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#050505'); scene.add(model);
  let dirty=()=>{},capturing=false;const gaussian=splat?new SplatContext(renderer,scene,{onDirty:()=>dirty()}):null;
  if(splatMesh){gaussian.entries.set(model,splatMesh);gaussian.layer.add(splatMesh);}
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
    if(capturing)return;
    if (width !== renderedWidth || height !== renderedHeight) {renderer.setSize(width, height, false); renderedWidth = width; renderedHeight = height;}
    camera.aspect = width / height; camera.updateProjectionMatrix(); if(gaussian)gaussian.render(model,camera,()=>renderer.render(scene,camera));else renderer.render(scene, camera);
  }
  let disposed = false;
  async function dispose() {if (disposed) return; disposed = true; dirty=()=>{};if(gaussian)await gaussian.dispose(); if (loaded) disposeLoadedModel(loaded); else disposeModel(model); renderer.dispose(); renderer.forceContextLoss();}
  return {renderer, scene, camera, center, minDistance, maxDistance, render, dispose,gaussian,model,onDirty:fn=>{dirty=fn;},setCapturing:value=>{capturing=value;},settle:async view=>{if(gaussian)await gaussian.settle(model,view||camera);}};
  } catch (error) {renderer.dispose(); renderer.forceContextLoss(); throw error;}
}
function png(canvas) {return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(Error('预览图片编码失败')), 'image/png'));}

async function localize(file, outputType = 'asset', scope, {format='glb',metadata}={}) {
  const canvas = document.createElement('canvas'); let view, prepared,temporary;
  if(format==='spz'){
    try{prepared=await scope.wait(()=>decodeSplat(file,{signal:scope.signal,fileName:file.name}),{disposeLate:value=>value.mesh.dispose()});
      temporary=URL.createObjectURL(file);const coordinateSystem=metadata?.world?.coordinateSystem==='marble_raw_opencv'?'marble_raw_opencv':'spz_rub',flip=new THREE.Matrix4().makeScale(...splatAxisScale({coordinateSystem}).toArray()),box=prepared.bounds.clone().applyMatrix4(flip),framing=prepared.framingBounds.clone().applyMatrix4(flip),metrics=metadata?.world?.assets?.splats?.semanticsMetadata;const descriptor={version:1,format:'spz',coordinateSystem,url:temporary,count:prepared.header.count,bounds:[box.min.toArray(),box.max.toArray()],framingBounds:[framing.min.toArray(),framing.max.toArray()],...(metrics?{metricScaleFactor:metrics.metricScaleFactor,groundPlaneOffset:metrics.groundPlaneOffset}:{})};
      const proxy=splatProxy(descriptor,{name:file.name});view=stage(proxy,canvas,null,{splatMesh:prepared.mesh});
      view.render(600,400);await scope.wait(()=>view.settle());view.render(600,400);
      const thumbnail=await scope.wait(()=>png(canvas)),cover=await scope.wait(()=>window.LocalMedia.asDataUrl(thumbnail));
      const url=await scope.wait(()=>window.LocalAssets.put(file)),image=await scope.wait(()=>window.LocalAssets.put(thumbnail));scope.check();
      return {image:cover,outputType,worldResource:{format:'spz',representation:'gaussianSplat',url,thumbnail:image,name:file.name,bytes:file.size,splat:{coordinateSystem:descriptor.coordinateSystem,count:descriptor.count,bounds:descriptor.bounds,framingBounds:descriptor.framingBounds,...(metrics?{metricScaleFactor:metrics.metricScaleFactor,groundPlaneOffset:metrics.groundPlaneOffset}:{})},...(metadata?.world?{world:structuredClone(metadata.world)}:{})}};
    }finally{if(view)await view.dispose();else prepared?.mesh.dispose();if(temporary)URL.revokeObjectURL(temporary);}
  }
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
  if (!/\.(glb|spz)$/i.test(file.name)) throw Error('请选择 .glb 或 .spz 文件');
  const scope = materializationScope();
  try {return await localize(file, 'asset', scope,{format:/\.spz$/i.test(file.name)?'spz':'glb'});} finally {scope.close();}
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
    const format=output.format==='spz'||output.representation==='gaussianSplat'?'spz':'glb',mime=format==='spz'?'application/octet-stream':'model/gltf-binary';
    const blob = await readModelBlob(response, scope, format==='spz'?splatLimits.bytes:maxBytes,{format,mime});
    const patch = await localize(new File([blob], format==='spz'?(output.filename||'generated').replace(/\.(?:glb|spz)$/i,'')+'.spz':output.filename || 'generated.glb', {type: mime}), outputType, scope,{format,metadata:output});
    for(const key of ['mime','sourceFileId','sourceUrl','representation','asset_metadata']) if(output[key]!==undefined)patch.worldResource[key]=structuredClone(output[key]);
    return patch;
  } finally {scope.close();}
}
function localDownloadSource(source, baseUrl, {allowAsset = false} = {}) {
  const unavailable = () => Object.assign(Error('模型尚未保存到本机，请迁移或重新导入本地素材后下载；原记录已保留'), {code: 'media_localization_required'});
  if (typeof source !== 'string' || !source || source !== source.trim() || /[\x00-\x20\x7f\\]/.test(source)) throw unavailable();
  if (allowAsset && /^asset:[^\s]+$/.test(source)) return source;
  if (/^data:(?:model\/gltf-binary|application\/octet-stream);base64,[A-Za-z0-9+/]+={0,2}$/i.test(source)) return new URL(source).href;
  let url, base;
  try {base = new URL(baseUrl); url = new URL(source, base);} catch {throw unavailable();}
  if (url.username || url.password || url.origin !== base.origin) throw unavailable();
  if (url.protocol === 'blob:') return url.href;
  if (!['http:', 'https:'].includes(url.protocol) || url.search || url.hash || !isStaticAssetRef(url.pathname) && !isGenerationMediaRef(url.pathname)) throw unavailable();
  return url.href;
}

export async function readWorldDownloadBlob(source, {assets = window.LocalAssets, fetchImpl = globalThis.fetch, baseUrl = globalThis.location?.href || window.location?.href, signal,format='glb'} = {}) {
  const scope = materializationScope({signal});
  try {
    const local = localDownloadSource(source, baseUrl, {allowAsset: true});
    const resolved = local.startsWith('asset:') ? await scope.wait(() => assets.url(local)) : local;
    const url = localDownloadSource(resolved, baseUrl);
    // An anchor download can become a cross-origin navigation, including a
    // redirect. Only bytes fetched locally may produce the final anchor URL.
    const response = await scope.wait(() => fetchImpl(url, {signal: scope.signal, redirect: 'error', credentials: 'same-origin'}), {disposeLate: value => value.body?.cancel?.().catch(() => {})});
    let redirected = response.redirected;
    try {if (response.url && localDownloadSource(response.url, baseUrl) !== url) redirected = true;} catch {redirected = true;}
    if (redirected) {
      response.body?.cancel?.().catch(() => {});
      throw Object.assign(Error('模型下载不允许跳转到其他资源'), {code: 'world_download_redirect_forbidden'});
    }
    const blob = await readModelBlob(response, scope, format==='spz'?splatLimits.bytes:maxBytes,{format,mime:format==='spz'?'application/octet-stream':'model/gltf-binary'});
    return new Blob([blob], {type: response.headers?.get?.('content-type') || blob.type});
  } finally {scope.close();}
}

export async function download(node, options) {
  const blob = await readWorldDownloadBlob(node?.worldResource?.url, {...options,format:node?.worldResource?.format});
  const url = URL.createObjectURL(blob), link = el('a'); link.href = url; link.download = node.worldResource.name || node.title + '.'+(node.worldResource.format||'glb');if(node.worldResource.format==='spz'&&!/\.spz$/i.test(link.download))link.download=link.download.replace(/\.[^.]+$/,'')+'.spz';
  try {link.click();} finally {const timer = setTimeout(() => URL.revokeObjectURL(url), 30000); timer.unref?.();}
}

export async function preview(node, {panoramaUrl = null} = {}) {
  assertReadableMediaSource(panoramaUrl || node.worldResource?.url);
  const sourceResourceSnapshot=panoramaUrl?null:JSON.stringify(node.worldResource);
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
      if(node.worldResource.format==='spz'){const descriptor={version:1,format:'spz',url:node.worldResource.url,...node.worldResource.splat};const proxy=splatProxy(descriptor,{name:node.title});view=stage(proxy,canvas);view.render();await view.settle();}
      else {const loaded = await loadSaved(node.worldResource.url);
      if (!alive) {disposeLoadedModel(loaded); return;}
      try {view = stage(loaded.scene, canvas, loaded);} catch (error) {disposeLoadedModel(loaded); throw error;}
      }
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
    view.onDirty?.(invalidate);
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
          const output = await renderPhoto(view, camera, width, height); chrome.flash();
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
          const draft = panoramaUrl ? (await import('./panorama-stage.mjs')).panoramaStudio(node, panoramaUrl) : null;
          const director = draft ? null : await import('../studio-v3/source.mjs');
          if (!alive || !app.getState().nodes.some(n => n.id === node.id)) return;
          if(!panoramaUrl&&JSON.stringify(app.getState().nodes.find(n=>n.id===node.id)?.worldResource)!==sourceResourceSnapshot)throw Error('来源模型已变化，请重新打开预览后进入片场');
          const studio = draft ? app.createConnected(node.id, [draft])[0] : director.createDirectorNode(app,node.id);
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
async function renderPhoto(view, camera, width, height) {
  const {renderer, scene} = view;
  if (Math.max(width, height) > renderer.capabilities.maxTextureSize) throw Error('此设备无法渲染 4096px 照片');
  const size = renderer.getSize(new THREE.Vector2()), pixelRatio = renderer.getPixelRatio();
  const target = renderer.getRenderTarget(), viewport = renderer.getViewport(new THREE.Vector4()), scissor = renderer.getScissor(new THREE.Vector4()), scissorTest = renderer.getScissorTest();
  try {
    // Three disables display tone mapping on ordinary render targets. Render to
    // the same context's default framebuffer after Gaussian sorting. Suppress
    // preview redraw/resize during the await, then restore in finally so HDR
    // PMREM resources and displayed colors stay intact.
    renderer.setRenderTarget(null); renderer.setPixelRatio(1); renderer.setSize(width, height, false);
    renderer.setViewport(0, 0, width, height); renderer.setScissorTest(false);view.setCapturing?.(true);await view.settle?.(camera);if(view.gaussian)view.gaussian.render(view.model,camera,()=>renderer.render(scene,camera));else renderer.render(scene, camera);
    const output = document.createElement('canvas'); output.width = width; output.height = height;
    output.getContext('2d').drawImage(renderer.domElement, 0, 0); return output;
  } finally {
    view.setCapturing?.(false);renderer.setPixelRatio(pixelRatio); renderer.setSize(size.x, size.y, false); renderer.setRenderTarget(target);
    renderer.setViewport(viewport); renderer.setScissor(scissor); renderer.setScissorTest(scissorTest);
    view.render();
  }
}
