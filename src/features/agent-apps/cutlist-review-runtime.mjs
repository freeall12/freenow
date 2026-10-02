import {isGenerationMediaRef} from '../generation-results/media-ref.mjs';
import {cutlistReviewUri, cutlistReviewBudget, prepareCutlistReview} from './cutlist-review.mjs';
import {materializationScope} from '../world-node/materialization.mjs';
import {openVideoFrames} from '../../../video-frames.mjs';
const fail = message => {throw Error(message);};
const hash = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
const signature = node => JSON.stringify([node?.id, node?.type, node?.video, node?.clip ?? null, node?.trim ?? null]);
const fingerprint = response => JSON.stringify({...response, shots: response.shots.map(({preview_url, ...shot}) => shot)});
const clone = value => structuredClone(value);
const normalized = response => {const {title, ...data} = response;return prepareCutlistReview(data, title);};
async function decodeVideo(url, {signal} = {}) {
  const reader = await openVideoFrames(url, signal);
  try {await reader.at(0, 320);return {duration: reader.duration, width: reader.width, height: reader.height};} finally {reader.dispose();}
}
async function boundedBlob(response, scope, limit) {
  const cancel = () => response?.body?.cancel?.().catch(() => {});
  if (!response?.ok) {cancel();fail('拼装来源视频读取失败');}
  if (Number(response.headers?.get?.('content-length')) > limit) {cancel();fail('拼装来源视频超过8MiB单段或16MiB总量限制，请先裁剪为较小的真实素材');}
  if (!response.body?.getReader) {cancel();fail('当前环境不支持有界读取拼装来源视频');}
  const reader = response.body.getReader(), chunks = [];let size = 0, complete = false;
  try {
    for (;;) {const chunk = await scope.wait(() => reader.read());if (chunk.done) {complete = true;break;}size += chunk.value.byteLength;if (size > limit) fail('拼装来源视频实际字节超出读取预算');chunks.push(chunk.value);}
    const type = response.headers?.get?.('content-type')?.split(';')[0];if (!size || !['video/mp4', 'video/webm'].includes(type)) fail('拼装来源不是可读取的MP4/WebM视频');
    return new Blob(chunks, {type});
  } finally {if (!complete) reader.cancel().catch(() => {});reader.releaseLock();}
}
async function inline(blob, scope) {
  const bytes = new Uint8Array(await scope.wait(() => blob.arrayBuffer()));let encoded = '';
  for (let at = 0; at < bytes.length; at += 32768) encoded += String.fromCharCode(...bytes.subarray(at, at + 32768));
  return {url: `data:${blob.type};base64,${btoa(encoded)}`, sha256: await scope.wait(() => hash(bytes))};
}
function previewBytes(url) {
  const match = /^data:video\/(?:mp4|webm);base64,([A-Za-z0-9+/]+={0,2})$/.exec(url ?? '');
  if (!match || match[1].length % 4 || match[1].length > Math.ceil(cutlistReviewBudget.videoBytes / 3) * 4) fail('拼装预览缺少有界真实视频字节');
  const binary = atob(match[1]), bytes = Uint8Array.from(binary, char => char.charCodeAt(0));if (!bytes.length || bytes.length > cutlistReviewBudget.videoBytes || btoa(binary) !== match[1]) fail('拼装预览视频字节无效');return bytes;
}
/** The iframe sees host-owned bytes. It cannot select a URL, fabricate source
 * duration, execute trims or access a generation provider. */
export function createCutlistReviewRuntime({app, localAssets, getProjectId, fetchImpl = (...args) => fetch(...args), decode = decodeVideo,
  createObjectURL = blob => URL.createObjectURL(blob), revokeObjectURL = url => URL.revokeObjectURL(url), timeoutMs = cutlistReviewBudget.timeoutMs} = {}) {
  for (const [name, fn] of Object.entries({'app.getState': app?.getState, 'LocalAssets.url': localAssets?.url, getProjectId, fetchImpl, decode})) if (typeof fn !== 'function') throw TypeError(name + ' adapter is required');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > cutlistReviewBudget.timeoutMs) throw TypeError('invalid cutlist timeout');
  const preparations = new WeakMap(), nodes = () => app.getState().nodes;
  function source(id) {
    const node = nodes().find(node => node.id === id);
    if (node?.type !== 'video' || typeof node.video !== 'string' || !node.video || node.clip != null || node.trim != null) fail('拼装片段ID必须对应当前真实完整视频节点；已有虚拟裁剪须先导出');
    return node;
  }
  async function read(node, scope, maxBytes) {
    const url = isGenerationMediaRef(node.video) ? node.video : await scope.wait(() => localAssets.url(node.video));
    if (typeof url !== 'string') fail('拼装来源视频地址无法解析');
    const response = await scope.wait(() => fetchImpl(url, {signal: scope.signal, ...(isGenerationMediaRef(url) ? {redirect: 'error', mode: 'same-origin', credentials: 'same-origin'} : {})}), {disposeLate: value => value?.body?.cancel?.().catch(() => {})});
    return boundedBlob(response, scope, maxBytes);
  }
  async function prepareAppArgs(args, {signal, isCurrent = () => true} = {}) {
    if (args.resource_uri !== cutlistReviewUri) return args;
    const response = prepareCutlistReview(args.data, args.title || '拼装审阅'), projectId = getProjectId(), entries = response.shots.map(shot => ({shot, node: source(shot.id)}));
    const snapshots = entries.map(({node}) => ({nodeId: node.id, signature: signature(node)}));
    const current = () => {if (!isCurrent() || getProjectId() !== projectId || entries.some(({node}, index) => source(node.id) !== node || signature(node) !== snapshots[index].signature)) fail('准备拼装审阅期间真实来源已切换');};
    const scope = materializationScope({signal, validateSources: current, timeoutMs});let total = 0;const videos = new Map();
    try {
      for (const {shot, node} of entries) {
        // A declared preview is evidence only when it is the actual node source.
        if (shot.preview_url !== undefined && shot.preview_url !== node.video && shot.preview_url !== await scope.wait(() => localAssets.url(node.video))) fail('禁止为拼装审阅提供伪造或无关的预览地址');
        let video = videos.get(node.video);
        if (!video) {
          const blob = await read(node, scope, Math.min(cutlistReviewBudget.videoBytes, cutlistReviewBudget.totalBytes - total));total += blob.size;
          const url = createObjectURL(blob);let actual;
          try {actual = await scope.wait(() => decode(url, {signal: scope.signal}));} finally {revokeObjectURL(url);}
          if (!Number.isFinite(actual?.duration) || actual.duration < .1 || actual.duration > 36000 || !Number.isInteger(actual.width) || actual.width < 1 || actual.width > 8192 || !Number.isInteger(actual.height) || actual.height < 1 || actual.height > 8192 || actual.width * actual.height > 33554432) fail('拼装来源视频实际解码无效');
          video = {...await inline(blob, scope), duration: actual.duration, width: actual.width, height: actual.height};videos.set(node.video, video);
        }
        if (shot.media_duration_ms !== Math.round(video.duration * 1000) || shot.out_ms > video.duration * 1000 + .5) fail('拼装声明时长或裁切区间与实际解码的视频不符');
        shot.preview_url = video.url;Object.assign(snapshots.find(snapshot => snapshot.nodeId === node.id), {mediaSha256: video.sha256, duration: video.duration, width: video.width, height: video.height});
      }
      current();const {title, ...data} = normalized(response), prepared = {...clone(args), data};
      preparations.set(prepared, {projectId, responseFingerprint: fingerprint(response), sources: snapshots});return prepared;
    } finally {scope.close();}
  }
  function bindPreparedResult(result, args) {
    if (args.resource_uri !== cutlistReviewUri) return result;
    const binding = preparations.get(args);
    if (!binding || binding.projectId !== getProjectId() || fingerprint(result.response) !== binding.responseFingerprint || binding.sources.some(snapshot => signature(source(snapshot.nodeId)) !== snapshot.signature)) fail('拼装审阅展示缺少有效真实来源绑定');
    return {...result, cutlistSourceContext: clone(binding)};
  }
  function capture(response, {trace, chat, isCurrent} = {}) {
    const result = trace?.result, stored = result?.cutlistSourceContext;
    if (!trace?.id || !chat?.id || !stored || typeof isCurrent !== 'function' || result.response !== response) fail('拼装审阅缺少真实会话来源绑定');
    const binding = clone(stored), sourceData = normalized(response), baseline = fingerprint(sourceData), previewUrls = response.shots.map(shot => shot.preview_url);
    if (!Array.isArray(binding.sources) || binding.responseFingerprint !== baseline || JSON.stringify(binding.sources.map(item => item.nodeId)) !== JSON.stringify(sourceData.shots.map(shot => shot.id))) fail('拼装审阅原始来源与展示数据不一致');
    let disposed = false, previewVerified = false, pending = null, bytePending = null;const controllers = new Set();
    function current() {
      try {return !disposed && isCurrent() === true && getProjectId() === binding.projectId && trace.result === result && result.response === response && result.cutlistSourceContext === stored && fingerprint(response) === baseline && response.shots.every((shot, index) => shot.preview_url === previewUrls[index]) && binding.sources.every(snapshot => /^[a-f0-9]{64}$/.test(snapshot.mediaSha256) && signature(source(snapshot.nodeId)) === snapshot.signature);} catch {return false;}
    }
    const check = () => {if (!current()) fail('拼装审阅所属项目、视频或应用来源已变化');};
    async function verify(verifyBytes) {
      check();const controller = new AbortController();controllers.add(controller);const scope = materializationScope({signal: controller.signal, validateSources: check, timeoutMs});
      try {
        if (!previewVerified) {
          for (let index = 0; index < binding.sources.length; index++) {
            const bytes = previewBytes(response.shots[index].preview_url);
            if (await scope.wait(() => hash(bytes)) !== binding.sources[index].mediaSha256) fail('拼装预览实际字节与原视频绑定不符');
          }
          previewVerified = true;
        }
        if (verifyBytes) {
          let total = 0;const seen = new Map();
          for (const snapshot of binding.sources) {
            const node = source(snapshot.nodeId);let digest = seen.get(node.video);
            if (!digest) {const blob = await read(node, scope, Math.min(cutlistReviewBudget.videoBytes, cutlistReviewBudget.totalBytes - total));total += blob.size;digest = await scope.wait(async () => hash(await blob.arrayBuffer()));seen.set(node.video, digest);}
            if (digest !== snapshot.mediaSha256) fail('拼装来源视频实际字节已被替换，请重新打开审阅');
          }
        }
        check();return true;
      } finally {scope.close();controllers.delete(controller);}
    }
    function guard({verifyBytes = false} = {}) {
      if (verifyBytes) {if (bytePending) return bytePending;bytePending = verify(true).finally(() => {bytePending = null;});return bytePending;}
      if (bytePending) return bytePending;if (pending) return pending;pending = verify(false).finally(() => {pending = null;});return pending;
    }
    function dispose() {disposed = true;for (const controller of controllers) controller.abort(Error('拼装审阅已关闭，读取已中止'));}
    check();return {guard, isCurrent: current, dispose};
  }
  return {prepareAppArgs, bindPreparedResult, capture};
}

// Host-only optional continuation. A review is insufficient: callers must obtain
// a separate explicit local-assembly user action and normal mutation approval.
export function createCutlistReviewExecutor({app, localAssets, store, fetchImpl = (...args) => fetch(...args), decode = decodeVideo,
  createObjectURL = blob => URL.createObjectURL(blob), revokeObjectURL = url => URL.revokeObjectURL(url), getProjectId} = {}) {
  for (const [name, fn] of Object.entries({'app.getState': app?.getState, 'app.createConnected': app?.createConnected, 'LocalAssets.put': localAssets?.put, 'LocalAssets.url': localAssets?.url, 'store.save': store?.save})) if (typeof fn !== 'function') throw TypeError(name + ' adapter is required');
  if (getProjectId !== undefined && typeof getProjectId !== 'function') throw TypeError('getProjectId must be a function');
  const operations = new Map(), kind = 'cutlist-local-assembly';
  function outputGuard(record) {
    const node = record.node, p = node?.provenance, metadata = node?.videoMetadata;
    const expected = record.expectedReceipt;
    if (expected && (node?.id !== expected.nodeIds[0] || record.sha256 !== expected.mediaSha256 || record.duration !== expected.duration || record.width !== expected.width || record.height !== expected.height)) fail('已存拼装产物与宿主持久操作回执不符');
    if (!app.getState().nodes.includes(node) || node.type !== 'video' || node.video !== record.media || node.clip != null || node.trim != null || node.duration !== record.duration || metadata?.duration !== record.duration || metadata?.width !== record.width || metadata?.height !== record.height || JSON.stringify(p) !== record.provenanceFingerprint) fail('实际拼装结果节点、解码元数据或provenance已被删除或修改，不会自动重建');
    if (getProjectId && getProjectId() !== record.projectId) fail('拼装产物所属项目已切换，不能保存到其他画布');
  }
  async function persist(record, {sourceContext} = {}) {
    outputGuard(record);record.saved = false;
    try {
      if (sourceContext && !sourceContext.isCurrent()) fail('拼装结果入图后真实来源已切换');
      if (await store.save() === false) fail('拼装结果画布保存未完成');await store.flush?.();record.saved = true;outputGuard(record);
      const receipt = {operationId: record.operationId, applied: true, saved: true, currentMatches: true, nodeIds: [record.node.id], duration: record.duration, width: record.width, height: record.height, mediaSha256: record.sha256};
      await validateReceiptCurrent(receipt, {sourceContext});return receipt;
    } catch (error) {
      const applied = app.getState().nodes.includes(record.node);
      throw Object.assign(Error('拼装产物保存或来源核验未完成：' + error.message), {applied, saved: record.saved === true, currentMatches: false, operationId: record.operationId, nodeIds: applied ? [record.node.id] : []});
    }
  }
  async function execute(input, {sourceContext, signal} = {}) {
    const {operationId, message, response: inputResponse, state: inputState, authorization, expectedReceipt: inputExpected} = input ?? {};
    const expectedReceipt = inputExpected === undefined ? undefined : clone(inputExpected);
    const response = normalized(inputResponse), state = clone(inputState);
    if (typeof operationId !== 'string' || !/^[A-Za-z0-9_-]{1,180}$/.test(operationId)) fail('本地拼装须提供稳定operationId');
    const {resolveCutlistReviewReply} = await import('./cutlist-review.mjs'), reply = await resolveCutlistReviewReply(message, response, state);
    if (reply.kind !== 'confirmed' || authorization?.kind !== 'local_cutlist_assembly' || authorization.handoffId !== reply.metadata.handoffId) fail('审核不是执行授权；请单独明确确认本地裁剪拼装');
    if (expectedReceipt && (expectedReceipt.operationId !== operationId || expectedReceipt.applied !== true || expectedReceipt.saved !== true || expectedReceipt.currentMatches === false || !Array.isArray(expectedReceipt.nodeIds) || expectedReceipt.nodeIds.length !== 1 || typeof expectedReceipt.nodeIds[0] !== 'string' || !Number.isFinite(expectedReceipt.duration) || expectedReceipt.duration <= 0 || expectedReceipt.width !== 1280 || expectedReceipt.height !== 720 || !/^[a-f0-9]{64}$/.test(expectedReceipt.mediaSha256))) fail('宿主持久拼装操作回执无效');
    const fingerprint = JSON.stringify(reply.result), prior = operations.get(operationId);
    if (prior && prior.fingerprint !== fingerprint) fail('相同拼装operationId不能用于不同计划');
    if (prior?.pending) return prior.pending;
    if (prior?.node) {if (expectedReceipt) prior.expectedReceipt = expectedReceipt;return persist(prior, {sourceContext});}
    if (prior?.error) throw prior.error;
    const matches = app.getState().nodes.filter(node => node.provenance?.kind === kind && node.provenance.operationId === operationId);
    if (matches.length > 1) fail('相同拼装操作存在多个结果，请先核对画布');
    if (expectedReceipt && !matches.length) fail('已保存操作回执对应的拼装结果已删除，不会自动重新生成');
    const record = {operationId, fingerprint, projectId: getProjectId?.(), expectedReceipt};operations.set(operationId, record);
    record.pending = process().catch(error => {if (record.node) {const applied = app.getState().nodes.includes(record.node);Object.assign(error, {applied, saved: record.saved === true, currentMatches: false, operationId, nodeIds: applied ? [record.node.id] : []});}record.error = error;throw error;}).finally(() => {delete record.pending;});return record.pending;
    async function process() {
      const existing = matches[0];
      if (existing) {
        const p = existing.provenance;
        if (!Number.isFinite(p.duration) || p.duration <= 0 || p.width !== 1280 || p.height !== 720 || !/^[a-f0-9]{64}$/.test(p.mediaSha256)) fail('已存拼装产物缺少可核对的解码/字节回执');
        if (p.handoffId !== reply.metadata.handoffId || p.requestFingerprint !== fingerprint || existing.video !== p.outputMedia || existing.type !== 'video' || existing.clip != null || existing.trim != null) fail('已存拼装结果与操作绑定不一致');
        record.node = existing;record.media = existing.video;record.duration = p.duration;record.width = p.width;record.height = p.height;record.sha256 = p.mediaSha256;record.provenanceFingerprint = JSON.stringify(p);outputGuard(record);
        const scope = materializationScope({signal, timeoutMs: 30000, validateSources: () => outputGuard(record)});
        try {const url = await scope.wait(() => localAssets.url(record.media)), blob = await boundedBlob(await scope.wait(() => fetchImpl(url, {signal: scope.signal, ...(isGenerationMediaRef(url) ? {redirect: 'error', mode: 'same-origin', credentials: 'same-origin'} : {})})), scope, 16 * 1024 * 1024), actualUrl = createObjectURL(blob);let actual;
          try {actual = await scope.wait(() => decode(actualUrl, {signal: scope.signal}));} finally {revokeObjectURL(actualUrl);}
          if (await scope.wait(async () => hash(await blob.arrayBuffer())) !== record.sha256 || Math.abs(actual.duration - record.duration) > .1 || actual.width !== record.width || actual.height !== record.height) fail('已有拼装产物实际字节或解码与回执不符');
        } finally {scope.close();}
        return persist(record, {sourceContext});
      }
      if (!sourceContext?.guard || !sourceContext?.isCurrent) fail('本地拼装缺少实时真实来源约束');
      if (signal?.aborted) throw signal.reason || new DOMException('拼装已取消', 'AbortError');
      await sourceContext.guard({verifyBytes: true});
      const scope = materializationScope({signal, timeoutMs: 120000, validateSources: () => {if (!sourceContext.isCurrent()) fail('本地拼装期间真实来源已变化');}});
      try {
        const payload = response.shots.filter(shot => state.shots[shot.id].keep).map(shot => {const selected = state.shots[shot.id];previewBytes(shot.preview_url);return {start: selected.in_ms / 1000, duration: (selected.out_ms - selected.in_ms) / 1000, data: shot.preview_url.slice(shot.preview_url.indexOf(',') + 1)};});
        const result = await scope.wait(() => fetchImpl('/api/media/playlist', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({clips: payload}), signal: scope.signal}), {disposeLate: value => value?.body?.cancel?.().catch(() => {})});
        const blob = await boundedBlob(result, scope, 16 * 1024 * 1024), url = createObjectURL(blob);let actual;
        try {actual = await scope.wait(() => decode(url, {signal: scope.signal}));} finally {revokeObjectURL(url);}
        if (!Number.isFinite(actual?.duration) || Math.abs(actual.duration - reply.result.duration_ms / 1000) > Math.max(.1, payload.length / 30) || actual.width !== 1280 || actual.height !== 720) fail('本地拼装产物实际时长或归一化尺寸不符合计划');
        record.sha256 = await scope.wait(async () => hash(await blob.arrayBuffer()));record.duration = actual.duration;record.width = actual.width;record.height = actual.height;
        record.media = await scope.wait(() => localAssets.put(blob));if (typeof record.media !== 'string' || !record.media.startsWith('asset:')) fail('真实拼装视频未保存到本地素材');
        const storedUrl = await scope.wait(() => localAssets.url(record.media)), storedBlob = await boundedBlob(await scope.wait(() => fetchImpl(storedUrl, {signal: scope.signal}), {disposeLate: value => value?.body?.cancel?.().catch(() => {})}), scope, 16 * 1024 * 1024);
        if (await scope.wait(async () => hash(await storedBlob.arrayBuffer())) !== record.sha256) fail('已存拼装素材实际字节与解码产物不符');
        scope.check();const sourceId = reply.result.shots.find(shot => shot.keep).id;
        const provenance = {kind, operationId, requestFingerprint: fingerprint, handoffId: reply.metadata.handoffId, outputMedia: record.media, mediaSha256: record.sha256, duration: actual.duration, width: actual.width, height: actual.height};
        record.provenanceFingerprint = JSON.stringify(provenance);
        const created = app.createConnected(sourceId, [{type: 'video', title: '本地拼装结果', video: record.media, width: 400, height: 225, duration: actual.duration, videoMetadata: {duration: actual.duration, width: actual.width, height: actual.height}, provenance}]);
        if (!Array.isArray(created) || created.length !== 1 || !created[0]?.id) fail('实际拼装产物节点创建失败');record.node = created[0];outputGuard(record);
      } finally {scope.close();}
      // Once a real result is visible, always finish its save even after stopping.
      return persist(record, {sourceContext});
    }
  }
  async function retrySave(operationId) {const record = operations.get(operationId);if (!record?.node) fail('没有可重试保存的真实拼装结果');if (record.pending) return record.pending;return persist(record);}
  async function validateReceiptCurrent(receipt, {sourceContext, signal, expectedReceipt} = {}) {
    const record = operations.get(receipt?.operationId);
    if (!record?.node || record.saved !== true || receipt.applied !== true || receipt.saved !== true || receipt.currentMatches === false || !Array.isArray(receipt.nodeIds) || receipt.nodeIds.length !== 1 || receipt.nodeIds[0] !== record.node.id || receipt.mediaSha256 !== record.sha256 || receipt.duration !== record.duration || receipt.width !== record.width || receipt.height !== record.height) fail('拼装产物回执与当前真实操作不符');
    if (expectedReceipt && (expectedReceipt.operationId !== record.operationId || !Array.isArray(expectedReceipt.nodeIds) || expectedReceipt.nodeIds.length !== 1 || expectedReceipt.nodeIds[0] !== record.node.id || expectedReceipt.mediaSha256 !== record.sha256 || expectedReceipt.duration !== record.duration || expectedReceipt.width !== record.width || expectedReceipt.height !== record.height)) fail('拼装产物与宿主持久操作回执不符');
    const check = () => {outputGuard(record);if (sourceContext && !sourceContext.isCurrent()) fail('拼装回执核验期间真实来源已切换');};
    const scope = materializationScope({signal, timeoutMs: 30000, validateSources: check});
    try {
      const url = await scope.wait(() => localAssets.url(record.media)), storedBlob = await boundedBlob(await scope.wait(() => fetchImpl(url, {signal: scope.signal, ...(isGenerationMediaRef(url) ? {redirect: 'error', mode: 'same-origin', credentials: 'same-origin'} : {})}), {disposeLate: value => value?.body?.cancel?.().catch(() => {})}), scope, 16 * 1024 * 1024);
      if (await scope.wait(async () => hash(await storedBlob.arrayBuffer())) !== record.sha256) fail('画布保存后拼装产物实际字节已变化');
      if (sourceContext) await scope.wait(() => sourceContext.guard({verifyBytes: true}));check();return clone(receipt);
    } finally {scope.close();}
  }
  return {execute, retrySave, validateReceiptCurrent};
}
