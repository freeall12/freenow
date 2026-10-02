const failure = (code, message) => Object.assign(Error(message), {code});

// A source guard can fail while a network reader or decoder has no next callback.
// Keep that guard live until the complete localized patch is ready.
export function materializationScope({signal, validateSources = () => {}, timeoutMs = 60000, pollMs = 200} = {}) {
  const controller = new AbortController(); let rejectAbort;
  const interrupted = new Promise((_, reject) => {rejectAbort = reject;}); interrupted.catch(() => {});
  const abort = reason => {if (!controller.signal.aborted) controller.abort(reason);};
  const externalAbort = () => abort(signal.reason ?? new DOMException('3D 结果读取已取消', 'AbortError'));
  const onAbort = () => rejectAbort(controller.signal.reason);
  controller.signal.addEventListener('abort', onAbort, {once: true});
  signal?.addEventListener('abort', externalAbort, {once: true});
  if (signal?.aborted) externalAbort();
  function check() {
    if (controller.signal.aborted) throw controller.signal.reason;
    try {validateSources();} catch (error) {abort(error); throw error;}
  }
  const timer = setTimeout(() => abort(failure('world_materialization_timeout', '3D 结果下载或解码超时，请检查网络后从原任务重试')), timeoutMs);
  const monitor = setInterval(() => {try {check();} catch {}}, pollMs);
  return {
    signal: controller.signal, check,
    async wait(operation, {disposeLate} = {}) {
      check(); let discarded = false;
      const discard = value => {if (!discarded) {discarded = true; disposeLate?.(value);}};
      const pending = Promise.resolve().then(() => {check(); return operation();});
      // Decoders cannot always be aborted. Their late result still has an owner.
      if (disposeLate) pending.then(value => {if (controller.signal.aborted) discard(value);}, () => {});
      const value = await Promise.race([pending, interrupted]);
      try {check();} catch (error) {discard(value); throw error;}
      return value;
    },
    close() {clearTimeout(timer); clearInterval(monitor); signal?.removeEventListener('abort', externalAbort); controller.signal.removeEventListener('abort', onAbort);}
  };
}

export async function readModelBlob(response, scope, maxBytes) {
  const tooLarge = () => failure('size', '3D 结果超过本地 12 MiB 模型上限；原任务结果仍保留，请精简模型或纹理后导入');
  scope.check();
  if (!response?.ok) {response?.body?.cancel?.().catch(() => {}); throw failure('world_download_failed', '3D 结果读取失败，请检查网络、地址及跨域 CORS 后从原任务重试');}
  if (Number(response.headers?.get?.('content-length')) > maxBytes) {response.body?.cancel?.().catch(() => {}); throw tooLarge();}
  // Browser fetch has a stream. Never fall back to an unbounded response.blob().
  if (!response.body?.getReader) throw failure('world_download_unreadable', '3D 结果无法有界读取，请更换支持流式读取的浏览器后重试');
  const reader = response.body.getReader(), chunks = []; let size = 0, complete = false;
  try {
    for (;;) {
      const chunk = await scope.wait(() => reader.read());
      if (chunk.done) {complete = true; break;}
      size += chunk.value.byteLength;
      if (size > maxBytes) throw tooLarge();
      chunks.push(chunk.value);
    }
    if (!size) throw failure('world_download_empty', '3D 结果内容为空，请从原任务重试');
    scope.check(); return new Blob(chunks, {type: 'model/gltf-binary'});
  } finally {if (!complete) reader.cancel().catch(() => {}); reader.releaseLock();}
}
