import {createAppController, prepareApp} from '../integration.mjs';
import {productionProgressUri, validateProductionProgressRequest, normalizeProductionProgressResult} from '../production-progress.mjs';
const status = document.getElementById('status'), cards = document.getElementById('cards');
const source = document.getElementById('source'), receipt = document.getElementById('receipt');
const projectId = 'qa-production-progress-local-only', ids = ['qa-image-1', 'qa-video-2'];
let database, saving = false, queries = 0, snapshot = {
  chat: {messages: []},
  fixture: {project_id: projectId, node_ids: ids, phase: 'running', query_error: false, revision: 0},
};
const mediaUrls = new Map();
async function loadFixtureMedia() {
  // Both are committed public fixtures, never generated outputs.
  async function fetchMedia(path, type) {
    const response = await fetch(path);
    if (!response.ok) throw Error('公共测试素材未能读取：' + path);
    const blob = await response.blob();
    if (blob.type !== type || !blob.size || blob.size > 2000000) throw Error('公共测试素材格式或大小无效');
    return blob;
  }
  const [image, video] = await Promise.all([fetchMedia('/assets/tap-logo.webp', 'image/webp'), fetchMedia('/qa/trim-scenes.mp4', 'video/mp4')]);
  const bitmap = await createImageBitmap(image);
  let imageProbe;
  try {
    if (!bitmap.width || !bitmap.height) throw Error('公共WebP素材无法解码');
    imageProbe = {width: bitmap.width, height: bitmap.height};
  } finally {bitmap.close();}
  const videoProbe = await new Promise((resolve, reject) => {
    const element = document.createElement('video'), url = URL.createObjectURL(video);
    const cleanup = () => {clearTimeout(timer);element.onloadeddata = element.onerror = null;element.removeAttribute('src');element.load();URL.revokeObjectURL(url);};
    const timer = setTimeout(() => {cleanup();reject(Error('公共MP4素材解码超时'));}, 8000);
    element.muted = true;element.preload = 'auto';element.playsInline = true;
    element.onloadeddata = () => {
      const probe = {width: element.videoWidth, height: element.videoHeight, duration: element.duration, readyState: element.readyState};
      cleanup();
      if (!probe.width || !probe.height || !Number.isFinite(probe.duration) || probe.duration <= 0 || probe.readyState < 2) reject(Error('公共MP4素材没有可解码视频帧'));
      else resolve(probe);
    };
    element.onerror = () => {cleanup();reject(Error('公共MP4素材无法解码'));};element.src = url;
  });
  return {image, video, imageProbe, videoProbe};
}
async function dataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || Error('已提交测试媒体字节读取失败'));reader.readAsDataURL(blob);
  });
}
async function openDatabase() {
  database = await new Promise((resolve, reject) => {
    const request = indexedDB.open('tapnow-qa-production-progress-public-v3', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('sessions');
    request.onsuccess = () => {request.result.onversionchange = () => request.result.close();resolve(request.result);};
    request.onerror = () => reject(request.error || Error('本地验收存储未能打开'));
    request.onblocked = () => reject(Error('本地验收存储被旧页面阻塞'));
  });
}
function read() {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('sessions', 'readonly'), request = transaction.objectStore('sessions').get('current');
    transaction.oncomplete = () => resolve(request.result);
    transaction.onerror = transaction.onabort = () => reject(transaction.error || request.error || Error('本地验收读取失败'));
  });
}
function write(value) {
  const copy = structuredClone(value);
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('sessions', 'readwrite');transaction.objectStore('sessions').put(copy, 'current');
    transaction.oncomplete = () => resolve();
    transaction.onerror = transaction.onabort = () => reject(transaction.error || Error('本地验收状态未能提交'));
  });
}
function validateSnapshot(value) {
  if (!value?.chat || !Array.isArray(value.chat.messages) || value.chat.messages.length > 1 || value.fixture?.project_id !== projectId || JSON.stringify(value.fixture.node_ids) !== JSON.stringify(ids) || !['running', 'done', 'failed'].includes(value.fixture.phase) || typeof value.fixture.query_error !== 'boolean' || !Number.isSafeInteger(value.fixture.revision) || value.fixture.revision < 0) throw Error('本地验收来源无效');
  if (value.fixture.phase === 'done' && (!(value.fixture.media?.image instanceof Blob) || value.fixture.media.image.type !== 'image/webp' || !value.fixture.media.image.size || !(value.fixture.media.video instanceof Blob) || value.fixture.media.video.type !== 'video/mp4' || !value.fixture.media.video.size || !value.fixture.media.imageProbe?.width || !value.fixture.media.videoProbe?.duration)) throw Error('本地完成测试缺少实际已提交并解码的图像/视频');
  for (const trace of value.chat.messages) if (trace.name !== 'show_app' || trace.status !== 'done' || trace.args?.resource_uri !== productionProgressUri || trace.result?.resource_uri !== productionProgressUri || trace.result?.response?.project_id !== projectId || JSON.stringify(trace.result.response.node_ids) !== JSON.stringify(ids)) throw Error('本地验收卡片来源无效');
  return value;
}
function show(message) {
  source.textContent = JSON.stringify({...snapshot.fixture, media: snapshot.fixture.media ? {image: {type: snapshot.fixture.media.image.type, size: snapshot.fixture.media.image.size, source: '公共assets/tap-logo.webp', ...snapshot.fixture.media.imageProbe}, video: {type: snapshot.fixture.media.video.type, size: snapshot.fixture.media.video.size, source: '公共qa/trim-scenes.mp4', ...snapshot.fixture.media.videoProbe}} : undefined}, null, 2);
  document.getElementById('query-error').checked = snapshot.fixture.query_error;
  status.textContent = message || `已提交本地测试状态 ${snapshot.fixture.phase}；修订 ${snapshot.fixture.revision}；实际查询 ${queries} 次。未调用模型，图片仅为已存在的本地测试素材。`;
}
const controller = createAppController({
  getContext: () => ({chat: snapshot.chat, panelActive: true, pageLeaving: false, streaming: false}),
  getProductionSourceContext: (response, trace, chat) => {
    const capturedResult = trace.result;
    const guard = () => chat === snapshot.chat && chat.messages.includes(trace) && trace.result === capturedResult && capturedResult.response === response && response.project_id === projectId && JSON.stringify(response.node_ids) === JSON.stringify(ids);
    return {guard, query: async args => {
      if (!guard()) throw Error('本地验收来源已切换');
      validateProductionProgressRequest(args, response);
      const current = validateSnapshot(await read());
      if (!guard()) throw Error('读取期间本地验收来源已切换');
      queries += 1;
      if (current.fixture.query_error) {show('本地模拟查询失败；已提交任务状态未改变。');throw Error('本地模拟查询失败');}
      let media;
      if (current.fixture.phase === 'done') {
        const key = current.fixture.revision;
        if (!mediaUrls.has(key)) mediaUrls.set(key, {image: await dataUrl(current.fixture.media.image), video: await dataUrl(current.fixture.media.video)});
        media = mediaUrls.get(key);
        if (!guard()) throw Error('读取媒体字节期间本地验收来源已切换');
      }
      const result = normalizeProductionProgressResult({structuredContent: {items: ids.map((node_id, index) => ({node_id, status: current.fixture.phase, media_type: index === 0 ? 'image' : 'video', title: index === 0 ? '公共Logo图像测试（未生成）' : '公共MP4播放测试（未生成）', ...(media ? {media_url: index === 0 ? media.image : media.video} : {})}))}}, response);
      receipt.textContent = JSON.stringify({revision: current.fixture.revision, ...result}, null, 2);
      show(`已从 IndexedDB 提交记录读取 ${current.fixture.phase}；修订 ${current.fixture.revision}；查询 ${queries} 次。未调用模型。`);
      return result;
    }};
  },
  onProductionProgressQuery: async (args, trace, chat, {isCurrent, sourceContext}) => {
    if (!isCurrent() || !sourceContext.guard()) throw Error('制作进度来源已切换');
    const result = await sourceContext.query(args);
    if (!isCurrent() || !sourceContext.guard()) throw Error('查询期间制作进度来源已切换');
    return result;
  },
  onSaveState: () => {throw Error('官方制作进度页没有应用状态保存');},
  onQueuePrompt: () => {throw Error('官方制作进度页不发送对话交接');},
  onError: message => show(message),
});
function render() {
  controller.prune(snapshot.chat.messages);
  for (const trace of snapshot.chat.messages) {const element = controller.render(trace);if (element && element.parentElement !== cards) cards.append(element);}
  show();
}
async function commitFixture(patch) {
  if (saving) throw Error('本地状态正在提交，请稍后重试');
  saving = true;
  const next = {...snapshot, fixture: {...snapshot.fixture, ...patch, revision: snapshot.fixture.revision + 1}};
  try {await write(next);snapshot = next;show();} finally {saving = false;}
}
function action(id, fn) {
  document.getElementById(id).onclick = async () => {try {await fn();} catch (error) {show(error.message);}};
}
action('open', async () => {
  if (snapshot.chat.messages.length) {render();return;}
  if (saving) throw Error('本地状态正在提交');
  saving = true;
  try {
    const args = {resource_uri: productionProgressUri, title: '本地状态协议测试 · 未生成媒体', data: {node_ids: ids, project_id: projectId}};
    const trace = {id: crypto.randomUUID(), name: 'show_app', args, status: 'done', result: prepareApp(args)};
    const next = {...snapshot, chat: {messages: [trace]}};
    await write(next);snapshot = next;render();
  } finally {saving = false;}
});
action('rerender', render);
action('reload', () => {controller.reset();render();});
for (const phase of ['running', 'done', 'failed']) action(phase, async () => {
  const media = phase === 'done' ? await loadFixtureMedia() : undefined;
  await commitFixture({phase, media});
});
document.getElementById('query-error').onchange = async event => {try {await commitFixture({query_error: event.target.checked});} catch (error) {show(error.message);}};
window.addEventListener('pagehide', () => {controller.reset();mediaUrls.clear();database?.close();});
try {
  await openDatabase();const saved = await read();
  if (saved === undefined) await write(snapshot);else snapshot = validateSnapshot(saved);
  render();for (const id of ['open', 'rerender', 'reload', 'running', 'done', 'failed', 'query-error']) document.getElementById(id).disabled = false;
} catch (error) {show('验收页未就绪：' + error.message);}
