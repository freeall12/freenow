import {isGenerationMediaRef} from '../generation-results/media-ref.mjs';
import {libraryPickerUri, libraryPickerTypes, prepareLibraryPicker, validateLibraryPickerFindRequest, validateLibraryPickerState, resolveLibraryPickerContext, resolveLibraryPickerReply, validateLibraryPickerCanvasRequest} from './library-picker.mjs';
import {materializationScope} from '../world-node/materialization.mjs';
import {prepareMediaInputs} from '../agent-attachments/media-inputs.mjs';
import {libraryFolders, libraryScope} from '../agent-composer/reference-data.mjs';
const failure = (code, message) => Object.assign(Error(message), {code});
const clone = value => structuredClone(value);
const signature = value => JSON.stringify(value);
const hash = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
const sourceUrl = item => item.type === 'image' ? item.fullImage || item.image : item.type === 'video' ? item.video : item.type === 'audio' ? item.audio : null;
const token = id => 'library://private/' + encodeURIComponent(id);
function safeMedia(url, type) {
  if (typeof url !== 'string' || !url) return false;
  if (/^asset:[A-Za-z0-9_-]+$/.test(url) || isGenerationMediaRef(url)) return true;
  if (new RegExp('^data:' + type + '/[a-z0-9.+-]+;base64,[A-Za-z0-9+/]+={0,2}$', 'i').test(url)) return true;
  return false;
}
// Host-owned library:// identities keep data URLs and asset bytes out of the
// conversation. The iframe never supplies the media imported by insertAsset.
export function createLibraryPickerRuntime({library, app, store, getProjectId, localAssets, persistConversation, fetchImpl = (...args) => fetch(...args), preparePreviews = prepareMediaInputs, createObjectURL = blob => URL.createObjectURL(blob), revokeObjectURL = url => URL.revokeObjectURL(url)} = {}) {
  for (const [name, fn] of Object.entries({'app.getState': app?.getState, 'app.insertAsset': app?.insertAsset, 'store.save': store?.save, getProjectId, persistConversation})) if (typeof fn !== 'function') throw TypeError(name + ' adapter is required');
  if (!library) throw TypeError('CanvasLibrary adapter is required');
  const preparations = new WeakMap();
  function read() {
    const rows = library.items, extra = library.folders;
    if (!Array.isArray(rows) || !Array.isArray(extra)) throw failure('library_unreadable', '当前个人素材库无法读取');
    const items = rows.filter(item => libraryScope(item) === 'personal').map(clone);
    if (items.some(item => !item || typeof item.id !== 'string' || !item.id || !libraryPickerTypes.includes(item.type)) || new Set(items.map(item => item.id)).size !== items.length) throw failure('library_unreadable', '个人素材库包含无效或重复素材');
    const names = [...new Set(['收藏', ...libraryFolders, ...extra.filter(folder => typeof folder === 'string'), ...extra.filter(folder => folder && typeof folder === 'object' && libraryScope(folder) === 'personal').map(folder => folder.name), ...items.map(item => item.folder || 'Others')])];
    if (names.some(name => typeof name !== 'string' || !name.trim())) throw failure('library_unreadable', '个人素材库文件夹无效');
    const folders = names.map(name => ({folder_id: 'private:' + encodeURIComponent(name), scope: 'private', name: name.split('/').at(-1), path: name, asset_count: items.filter(item => (item.folder || 'Others') === name).length}));
    return {items, folders};
  }
  function guard(scope, captured, isCurrent, signal) {
    if (signal?.aborted) throw signal.reason || new DOMException('素材库操作已取消', 'AbortError');
    if (isCurrent() !== true || scope.projectId !== getProjectId()) throw failure('stale_library_app', '素材库应用所属画布或会话已切换');
    if (signature(read()) !== captured) throw failure('library_changed', '个人素材库已变化，请重新打开选择器');
  }
  async function generatedPreview(ref, item, check, signal, budget) {
    if (budget.used >= 16 * 1024 * 1024) return undefined;
    const scope = materializationScope({signal, validateSources: check, timeoutMs: 30000});let reader, body, complete = false;
    try {
      const response = await scope.wait(() => fetchImpl(ref, {signal: scope.signal, redirect: 'error', mode: 'same-origin', credentials: 'same-origin'}), {disposeLate: value => value?.body?.cancel?.().catch(() => {})});
      body = response?.body;if (!response?.ok) throw failure('preview_unavailable', '生成素材预览读取失败');
      const type = response.headers?.get?.('content-type')?.split(';')[0], limit = 8 * 1024 * 1024;
      if (Number(response.headers?.get?.('content-length')) > Math.min(limit, 16 * 1024 * 1024 - budget.used)) {await response.body?.cancel?.();return undefined;}
      if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(type) || !response.body?.getReader) {await response.body?.cancel?.();throw failure('preview_unavailable', '生成素材预览格式或有界读取无效');}
      reader = response.body.getReader();const chunks = [];let size = 0;
      for (;;) {const chunk = await scope.wait(() => reader.read());if (chunk.done) {complete = true;break;}size += chunk.value.byteLength;budget.used += chunk.value.byteLength;if (size > limit || budget.used > 16 * 1024 * 1024) return undefined;chunks.push(chunk.value);}
      if (!size) throw failure('preview_unavailable', '生成素材预览为空');
      const url = createObjectURL(new Blob(chunks, {type}));
      try {
        const images = await scope.wait(() => preparePreviews([{name: item.id, type: 'image', asset: url}], {signal: scope.signal, resolveUrl: async () => {check();return url;}}));
        const image = images?.[0];if (images?.length !== 1 || image.name !== item.id || typeof image.imageUrl !== 'string' || image.imageUrl.length > 1500000 || !/^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(image.imageUrl)) throw failure('preview_unavailable', '生成素材没有有效真实图片预览');
        check();return image.imageUrl;
      } finally {revokeObjectURL(url);}
    } finally {if (!complete) {if (reader) reader.cancel().catch(() => {});else body?.cancel?.().catch(() => {});}reader?.releaseLock();scope.close();}
  }
  async function project(item, check, signal, budget) {
    check();const out = {asset_id: item.id, type: item.type, name: item.name || item.title || item.type}, media = sourceUrl(item);
    if (media && safeMedia(media, item.type)) out.source_url = token(item.id);
    if (['image', 'video'].includes(item.type) && item.image && safeMedia(item.image, 'image')) {
      let preview = item.image;
      if (preview.startsWith('asset:')) {if (typeof localAssets?.url !== 'function') throw failure('preview_unavailable', '缺少本地素材预览适配');preview = await localAssets.url(preview);check();}
      if (isGenerationMediaRef(preview)) preview = await generatedPreview(preview, item, check, signal, budget);
      if (preview !== undefined) out.preview_url = preview;
    }
    return out;
  }
  async function prepareAppArgs(args, {isCurrent = () => true, signal} = {}) {
    if (args.resource_uri !== libraryPickerUri) return args;
    const projectId=getProjectId();await library.ready?.();
    if(projectId!==getProjectId()||!isCurrent()||signal?.aborted)throw failure('stale_source','画布或素材库操作已变化，请重试');
    const data = args.data || {};
    if (Object.keys(data).some(key => !['applied', 'can_add_to_canvas'].includes(key))) throw failure('invalid_input', '素材库来源必须由宿主读取，不能由Agent提供素材或地址');
    const snapshot = read(), captured = signature(snapshot), scope = {projectId: getProjectId()};const check = () => guard(scope, captured, isCurrent, signal);check();
    const response = prepareLibraryPicker({folders: snapshot.folders, assets: [], ...(data.applied ? {applied: data.applied} : {}), can_add_to_canvas: data.can_add_to_canvas !== false}, args.title || '素材库');
    const prepared = {...clone(args), data: {folders: response.folders, assets: [], ...(response.applied ? {applied: response.applied} : {}), can_add_to_canvas: response.can_add_to_canvas}};
    preparations.set(prepared, {projectId: scope.projectId, library_sha256: await hash(captured)});check();return prepared;
  }
  function bindPreparedResult(result, args) {
    if (args.resource_uri !== libraryPickerUri) return result;
    const binding = preparations.get(args);if (!binding || binding.projectId !== getProjectId()) throw failure('invalid_source', '素材库展示缺少真实宿主来源绑定');
    return {...result, librarySourceContext: clone(binding)};
  }
  function capture(response, {trace, chat, isCurrent} = {}) {
    if (typeof isCurrent !== 'function' || !trace?.id || !chat?.id || !trace.result?.librarySourceContext) throw failure('invalid_source', '缺少素材库会话来源保护');
    const snapshot = read(), captured = signature(snapshot), scope = {projectId: getProjectId(), chatId: chat.id, traceId: trace.id}, binding = trace.result.librarySourceContext;
    const source = prepareLibraryPicker({folders: response.folders, assets: response.assets, ...(response.applied ? {applied: response.applied} : {}), can_add_to_canvas: response.can_add_to_canvas}, response.title);
    if (signature(source.folders) !== signature(snapshot.folders) || source.assets.length) throw failure('invalid_source', '素材库展示与实际个人文件夹不一致');
    const ready = hash(captured);
    let visible = [], context = null, epoch = 0;
    const known = snapshot.items.filter(item => !source.applied || source.applied.types.includes(item.type)).map(item => ({asset_id: item.id, type: item.type, name: item.name || item.title || item.type}));
    const check = signal => {guard(scope, captured, isCurrent, signal);if (trace.result.response !== response) throw failure('stale_library_app', '素材库来源卡片已替换');};
    const action = flag => {if (flag !== true) throw failure('user_action_required', '素材库操作需要当前应用用户动作');};
    function operationCheck(signal, operationCurrent) {check(signal);if (operationCurrent() !== true) throw failure('stale_library_action', '素材库用户动作所属页面已重载或状态已变化');}
    async function current(signal, operationCurrent = () => true) {const digest = await ready;if (binding.projectId !== scope.projectId || binding.library_sha256 !== digest) throw failure('library_changed', '素材库展示的原始来源已变化');operationCheck(signal, operationCurrent);}
    async function find(args, {userAction, restore = false, signal, isCurrent: operationCurrent = () => true} = {}) {
      await current(signal, operationCurrent);const request = validateLibraryPickerFindRequest(args, source);
      if (restore) {
        const saved = validateLibraryPickerState(trace.appState, source, known);
        if (request.folder_id !== saved.folder?.folder_id || request.query !== (saved.query || undefined)) throw failure('invalid_restore', '素材库恢复查询与已保存浏览位置不符');
      } else action(userAction);
      const generation = ++epoch;context = null;
      let rows = snapshot.items.filter(item => !source.applied || source.applied.types.includes(item.type));
      if (request.folder_id) {const folder = source.folders.find(folder => folder.folder_id === request.folder_id);rows = rows.filter(item => (item.folder || 'Others') === folder.path);}
      else {const query = request.query.toLocaleLowerCase();rows = rows.filter(item => [item.name || item.title || item.type, item.folder || 'Others'].some(value => value.toLocaleLowerCase().includes(query)));}
      const budget = {used: 0}, projected = [], projectionCheck = () => {operationCheck(signal, operationCurrent);if (generation !== epoch) throw failure('stale_query', '素材库查询已被更新的请求替换');};
      for (const item of rows) projected.push(await project(item, projectionCheck, signal, budget));await current(signal, operationCurrent);
      if (generation !== epoch) throw failure('stale_query', '素材库查询已被更新的请求替换');
      visible = projected;return {items: clone(visible)};
    }
    async function setModelContext(params, {userAction, isCurrent: operationCurrent = () => true} = {}) {action(userAction);await current(undefined, operationCurrent);context = resolveLibraryPickerContext(params, source, visible);return {};}
    async function reply(message, savedState, {locale = 'zh-CN', userAction, isCurrent: operationCurrent = () => true} = {}) {
      action(userAction);await current(undefined, operationCurrent);if (!context) throw failure('missing_reference', '缺少本次实际素材引用上下文');
      const selected = context;context = null;const result = await resolveLibraryPickerReply(message, source, savedState, selected, visible, locale, known);await current(undefined, operationCurrent);
      result.metadata.libraryReference = {kind: 'library', id: selected.asset_id, label: selected.name, scope: 'personal', mediaType: selected.type};
      return result;
    }
    async function addToCanvas(params, {userAction, signal, isCurrent: operationCurrent = () => true} = {}) {
      action(userAction);await current(signal, operationCurrent);const selected = validateLibraryPickerCanvasRequest(params, source, visible), item = snapshot.items.find(item => item.id === selected.asset_id), media = sourceUrl(item);
      if (!safeMedia(media, item.type) || token(item.id) !== selected.source_url || !['image', 'video'].includes(item.type)) throw failure('unsafe_source', '素材没有可信的实际图片或视频源');
      // Freeze the actual library source; no editor-node fallback or iframe URL.
      const actual = {id: item.id, type: item.type, name: item.name || item.title || item.type, ...(item.type === 'image' ? {image: safeMedia(item.image, 'image') ? item.image : media, fullImage: media} : {video: media, ...(safeMedia(item.image, 'image') ? {image: item.image} : {})})};
      if (media.startsWith('asset:')) {if (typeof localAssets?.url !== 'function') throw failure('asset_unavailable', '缺少本地素材读取适配');await localAssets.url(media);await current(signal, operationCurrent);}
      operationCheck(signal, operationCurrent);const node = app.insertAsset(actual);
      if (!node?.id || !app.getState().nodes.includes(node) || node.type !== item.type || sourceUrl(node) !== media) throw failure('apply_failed', '素材节点未按实际来源创建');
      const receipt = {node_ref: 'node/' + node.id, asset_id: item.id, library_sha256: binding.library_sha256, scope: clone(scope)};
      node.provenance = {...node.provenance, kind: 'library-picker', ...clone(receipt)};
      const provenance = signature(node.provenance);
      function assertNode() {
        if (!app.getState().nodes.includes(node) || 'node/' + node.id !== receipt.node_ref || node.type !== item.type || sourceUrl(node) !== media || node.image !== actual.image || signature(node.provenance) !== provenance) throw failure('placement_changed', '加入的素材节点已被撤销、删除或修改，不能确认成功');
      }
      assertNode();
      if (await store.save(app.projectSnapshot?.() || app.getState(), scope.projectId) === false) throw failure('save_failed', '素材已加入画布，但画布保存失败');
      assertNode();await store.flush?.();assertNode();await current(signal, operationCurrent);assertNode();
      const previous = trace.libraryPickerPlacements;trace.libraryPickerPlacements = [...(previous || []), clone(receipt)];
      operationCheck(signal, operationCurrent);
      try {assertNode();if (await persistConversation() === false) throw failure('conversation_save_failed', '素材节点已保存，但会话回执保存失败');assertNode();await current(signal, operationCurrent);assertNode();}
      catch (error) {if (previous === undefined) delete trace.libraryPickerPlacements;else trace.libraryPickerPlacements = previous;try {if (await persistConversation() === false) throw Error('补偿事务未提交');} catch {throw failure('conversation_rollback_failed', '素材节点已保存，会话回执及补偿保存失败');}throw error;}
      return receipt;
    }
    return {scope, guard: current, isCurrent: () => {try {check();return true;} catch {return false;}}, find, setModelContext, reply, addToCanvas, validateState: value => {check();return validateLibraryPickerState(value, source, known);}, getKnownAssets: () => clone(known), getVisibleAssets: () => clone(visible)};
  }
  return {prepareAppArgs, bindPreparedResult, capture};
}
