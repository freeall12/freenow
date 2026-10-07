import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {DRACOLoader} from 'three/addons/loaders/DRACOLoader.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
import {modelResourceLifecycle} from '../studio-v2/model-resource-lifecycle.mjs';
import {disposeLoadedModel} from '../studio-v2/model-io.mjs';
import {materializationScope} from '../world-node/materialization.mjs';
import {decodeSplat, splatProxy, splatAxisScale, spatialBounds} from '../world-node/splat-io.mjs';
import {splatLimits} from '../world-node/splat-contract.mjs';
import {isStaticAssetRef} from '../local-resource-migration/index-format.mjs';
import {isGenerationMediaRef} from '../generation-results/media-ref.mjs';
import {studioLibrary} from '../../../studio-library-data.mjs';

export const GLB_MAX_BYTES = 100 * 1024 * 1024;
export const BUILTIN_ASSETS = Object.freeze({actor: '/assets/studio/character.glb', camera: '/assets/studio/camera.glb'});
const fail = (code, message) => Object.assign(Error(message), {code});
const once = fn => {let done = false; return () => {if (!done) {done = true; return fn();}};};
export function catalogAsset(id) {
  const group = studioLibrary.find(item => item.assets.some(asset => asset.id === id)), asset = group?.assets.find(item => item.id === id);
  if (!asset) throw fail('studio_v3_asset_missing', '本地示例模型不存在');
  return {sourceUrl: '/' + asset.model.replace(/^\//, ''), sourceFormat: 'glb', presentationAnchor: 'bottom', scale: asset.scale, label: group.label, thumbnail: '/' + asset.preview};
}
export function localAssetSource(source, baseUrl = globalThis.location?.href || 'http://localhost/') {
  if (typeof source !== 'string' || source !== source.trim() || !source || /[\x00-\x20\x7f\\]/.test(source)) throw fail('studio_v3_asset_local', '片场模型需要本地素材引用');
  if (/^asset:[^\s]+$/.test(source)) return source;
  if (/^data:(?:model\/gltf-binary|application\/octet-stream);base64,[A-Za-z0-9+/]+={0,2}$/i.test(source)) return source;
  let url, base;
  try {base = new URL(baseUrl); url = new URL(source, base);} catch {throw fail('studio_v3_asset_local', '片场模型地址无效');}
  if (url.origin !== base.origin || url.username || url.password || !['http:', 'https:', 'blob:'].includes(url.protocol) || url.protocol !== 'blob:' && (url.search || url.hash || !isStaticAssetRef(url.pathname) && !isGenerationMediaRef(url.pathname))) throw fail('studio_v3_asset_local', '请先把模型保存到本地素材，片场不会读取外部模型地址');
  return url.href;
}
export function inspectGlbBytes(data) {
  try {
    if (!(data instanceof ArrayBuffer) || data.byteLength < 20 || data.byteLength > GLB_MAX_BYTES) throw Error();
    const view = new DataView(data), length = view.getUint32(12, true);
    if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== data.byteLength || view.getUint32(16, true) !== 0x4e4f534a || length % 4 || 20 + length > data.byteLength) throw Error();
    const json = JSON.parse(new TextDecoder().decode(data.slice(20, 20 + length)));
    if (json.asset?.version !== '2.0' || !Array.isArray(json.scenes)) throw Error();
    if ([...(json.buffers || []), ...(json.images || [])].some(value => value.uri && !value.uri.startsWith('data:'))) throw fail('studio_v3_asset_external', 'V3 仅接受包含完整资源的 GLB，请内嵌纹理和缓冲区后导入');
    return json;
  } catch (error) {if (error.code) throw error; throw fail('studio_v3_asset_invalid', '文件不是有效完整的 GLB 2.0');}
}
export async function readAssetBlob(response, scope, {format = 'glb', maxBytes = format === 'spz' ? splatLimits.bytes : GLB_MAX_BYTES} = {}) {
  const oversized = () => fail('studio_v3_asset_size', format === 'spz' ? 'SPZ 超过现有本地 64 MiB 预算' : 'V3 GLB 超过 100 MiB 导入预算');
  scope.check();
  if (!response?.ok) {response?.body?.cancel?.().catch(() => {}); throw fail('studio_v3_asset_fetch', '本地模型读取失败');}
  if (Number(response.headers?.get?.('content-length')) > maxBytes) {response.body?.cancel?.().catch(() => {}); throw oversized();}
  if (!response.body?.getReader) throw fail('studio_v3_asset_stream', '模型无法有界读取');
  const reader = response.body.getReader(), chunks = []; let size = 0, complete = false;
  try {
    for (;;) {const chunk = await scope.wait(() => reader.read()); if (chunk.done) {complete = true; break;} size += chunk.value.byteLength; if (size > maxBytes) throw oversized(); chunks.push(chunk.value);}
    if (!size) throw fail('studio_v3_asset_empty', '模型文件为空');
    scope.check(); return new Blob(chunks, {type: format === 'spz' ? 'application/octet-stream' : 'model/gltf-binary'});
  } finally {if (!complete) reader.cancel().catch(() => {}); reader.releaseLock();}
}
export async function decodeGlb(blob, {scope, signal = scope?.signal} = {}) {
  if (!(blob instanceof Blob) || !blob.size || blob.size > GLB_MAX_BYTES) throw fail('studio_v3_asset_size', '请选择非空且不超过 100 MiB 的 GLB');
  const ownsScope = !scope;
  scope ||= materializationScope({signal});
  let draco, loaded;
  const lifecycle = modelResourceLifecycle();
  try {
    const data = await scope.wait(() => blob.arrayBuffer()); inspectGlbBytes(data); scope.check();
    const manager = new THREE.LoadingManager(); manager.setURLModifier(url => {if (!/^(data:|blob:|\/node_modules\/three\/)/.test(url)) throw fail('studio_v3_asset_external', '模型引用了未提供的外部资源'); return url;});
    draco = new DRACOLoader(manager).setDecoderPath('/node_modules/three/examples/jsm/libs/draco/gltf/');
    const loader = new GLTFLoader(manager).setDRACOLoader(draco).setMeshoptDecoder(MeshoptDecoder);
    loader.register(parser => lifecycle.plugin(parser));
    loaded = await scope.wait(() => loader.parseAsync(data, ''), {disposeLate: () => lifecycle.fail()}); scope.check();
    if (!loaded.scene || new THREE.Box3().setFromObject(loaded.scene).isEmpty()) throw fail('studio_v3_asset_empty', '模型没有可渲染几何体');
    lifecycle.transfer();
    return {root: loaded.scene, animations: loaded.animations || [], format: 'glb', dispose: once(() => disposeLoadedModel(loaded))};
  } catch (error) {lifecycle.fail(); throw error;}
  finally {draco?.dispose(); if (ownsScope) scope.close();}
}
export function createAssetLoader({assets = globalThis.window?.LocalAssets, fetchImpl = globalThis.fetch, baseUrl = globalThis.location?.href || 'http://localhost/', decode = decodeGlb, timeoutMs = 60000, maxConcurrent = 2} = {}) {
  if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > 4) throw fail('studio_v3_asset_concurrency', '资产并发预算必须为 1–4');
  let active = 0; const waiting = [];
  function drain() {while (active < maxConcurrent && waiting.length) {const next = waiting.shift(); if (next.scope.signal.aborted) continue; active++; next.resolve(once(() => {active--; drain();}));}}
  const acquire = scope => new Promise(resolve => {waiting.push({scope, resolve}); drain();});
  async function load(asset, {signal, isCurrent = () => true, file} = {}) {
    const format = asset?.sourceFormat || asset?.format || 'glb';
    if (!['glb', 'spz'].includes(format)) throw fail('studio_v3_asset_format', '片场仅支持 GLB 或本地 SPZ');
    const scope = materializationScope({signal, timeoutMs, validateSources() {if (!isCurrent()) throw fail('studio_v3_asset_stale', '片场、状态或资源身份已变化，已取消模型加载');}});
    let release, result;
    try {
      release = await scope.wait(() => acquire(scope), {disposeLate: value => value()});
      let blob = file;
      if (file) {if (!(file instanceof Blob) || !file.size || file.size > (format === 'glb' ? GLB_MAX_BYTES : splatLimits.bytes)) throw fail('studio_v3_asset_size', '请选择非空且未超预算的模型'); if (format === 'glb' && file.name && !/\.glb$/i.test(file.name)) throw fail('studio_v3_asset_format', 'V3 模型上传只接受 .glb');}
      else {
        const source = localAssetSource(asset?.sourceUrl || asset?.url, baseUrl);
        const resolved = source.startsWith('asset:') ? await scope.wait(() => assets?.url(source)) : source;
        const url = localAssetSource(resolved, baseUrl); if (url.startsWith('asset:')) throw fail('studio_v3_asset_local', '本地模型尚未解析');
        const response = await scope.wait(() => fetchImpl(url, {signal: scope.signal, redirect: 'error', credentials: 'same-origin'}), {disposeLate: value => value.body?.cancel?.().catch(() => {})});
        if (response.redirected || response.url && localAssetSource(response.url, baseUrl) !== url) {response.body?.cancel?.().catch(() => {}); throw fail('studio_v3_asset_redirect', '本地模型不允许重定向');}
        blob = await readAssetBlob(response, scope, {format});
      }
      if (format === 'glb') result = await scope.wait(() => decode(blob, {scope, signal: scope.signal}), {disposeLate: value => value.dispose()});
      else {
        const prepared = await scope.wait(() => decodeSplat(blob, {signal: scope.signal, fileName: asset.name || 'scene.spz'}), {disposeLate: value => value.mesh.dispose()});
        try {
          const metadata = asset.splat || asset, coordinateSystem = metadata.coordinateSystem || 'spz_rub', flip = new THREE.Matrix4().makeScale(...splatAxisScale({coordinateSystem}).toArray());
          const bounds = prepared.bounds.clone().applyMatrix4(flip), framing = prepared.framingBounds.clone().applyMatrix4(flip);
          const descriptor = {version: 1, format: 'spz', url: asset.sourceUrl || asset.url, coordinateSystem, count: prepared.header.count, bounds: [bounds.min.toArray(), bounds.max.toArray()], framingBounds: [framing.min.toArray(), framing.max.toArray()], ...Number.isFinite(metadata.metricScaleFactor) ? {metricScaleFactor: metadata.metricScaleFactor} : {}, ...Number.isFinite(metadata.groundPlaneOffset) ? {groundPlaneOffset: metadata.groundPlaneOffset} : {}};
          const root = splatProxy(descriptor, {name: asset.name || '本地高斯场景'}); let transferred = false;
          prepared.mesh.dispose = once(prepared.mesh.dispose.bind(prepared.mesh));
          result = {root, animations: [], format: 'spz', splatMesh: prepared.mesh, transferSplat() {transferred = true;}, dispose: once(() => {if (!transferred) prepared.mesh.dispose();})};
        } catch (error) {prepared.mesh.dispose(); throw error;}
      }
      scope.check(); result.bounds = spatialBounds(result.root); return result;
    } catch (error) {result?.dispose(); throw error;}
    finally {release?.(); scope.close();}
  }
  return {load, get active() {return active;}, get queued() {return waiting.filter(item => !item.scope.signal.aborted).length;}};
}
