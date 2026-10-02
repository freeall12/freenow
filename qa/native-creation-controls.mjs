import {primitive, exportGlb, disposeModel} from '/src/features/studio-v2/model-io.mjs';
import {configurationReadiness} from '/src/features/node-composer/provider-configuration.mjs';
import '/src/features/world-node/entry.mjs';

const app = window.CanvasApp, api = window.GenerationAPI, fixture = window.NativeCreationFixture;
const panel = document.createElement('aside'); panel.ariaLabel = '原生生成隔离 QA';
panel.style.cssText = 'position:fixed;right:18px;top:65px;z-index:80;width:340px;max-height:calc(100vh - 110px);overflow:auto;background:#171717;border:1px solid #555;color:#eee;padding:12px;font:12px sans-serif';
const title = document.createElement('strong'); title.textContent = '隔离 QA · MiniMax H3 视频 / Tripo H3.1 GLB'; panel.append(title);
const collapse = document.createElement('button'); collapse.type = 'button'; collapse.textContent = '收起 QA 检查器';
collapse.style.cssText = 'display:block;margin:6px 0;padding:5px;color:#eee;background:#333;border:1px solid #777;cursor:pointer'; panel.append(collapse);
const note = document.createElement('p'); note.textContent = '未调用 AI：视频为固定本地 MP4，3D 为固定本地立方体 GLB。创建节点后，通过原生提示词和生成按钮执行。'; panel.append(note);
const buttons = document.createElement('div'); panel.append(buttons);
const output = document.createElement('pre'); output.ariaLabel = '原生生成 QA 检查器'; output.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere;margin:10px 0 0'; panel.append(output);
collapse.onclick = () => {
  const expanded = collapse.getAttribute('aria-expanded') !== 'false';
  collapse.setAttribute('aria-expanded', String(!expanded)); collapse.textContent = expanded ? '展开 QA 检查器' : '收起 QA 检查器';
  for (const item of [title, note, buttons, output]) item.hidden = expanded;
  panel.style.width = expanded ? 'auto' : '340px';
};
let worldId, videoId, worldAsset, error = '', readiness = [];
const safe = value => JSON.parse(JSON.stringify(value, (_, item) => typeof item === 'string' && item.length > 180 ? item.slice(0, 100) + '… [' + item.length + ' chars]' : item));
function write() {
  output.textContent = JSON.stringify(safe({posts: fixture.posts, configReads: fixture.configReads, mediaReads: fixture.mediaReads,
    validGLB: fixture.validGLB, glbBytes: fixture.glbBytes, readiness, error, blockedRequests: fixture.blockedRequests,
    requests: fixture.requests, jobs: api.getJobs().map(job => ({id: job.id, kind: job.request.kind,
      requestedModel: job.request.parameters?.providerParameters?.model ?? job.request.parameters?.modelId ?? job.request.parameters?.model,
      status: job.status, applied: !!job.applied, applying: !!job.applying, applicationError: job.applicationError, error: job.error})),
    nodes: app.getState().nodes.map(node => ({id: node.id, type: node.type, title: node.title, video: node.video,
      worldResource: node.worldResource && {format: node.worldResource.format, name: node.worldResource.name, bytes: node.worldResource.bytes,
        url: node.worldResource.url, thumbnail: node.worldResource.thumbnail}}))}), null, 2);
}
function button(label, run) {
  const control = document.createElement('button'); control.type = 'button'; control.textContent = label;
  control.style.cssText = 'margin:3px;padding:6px;color:#eee;background:#333;border:1px solid #777;cursor:pointer';
  control.onclick = async () => {control.disabled = true; error = ''; try {await run();} catch (cause) {error = cause.message;} finally {control.disabled = false; write();}};
  buttons.append(control);
}
async function prepareFixedWorld() {
  if (worldAsset) return;
  const cube = primitive('cube', 'QA fixed cube'); let blob;
  try {blob = await exportGlb(cube);} finally {disposeModel(cube);}
  const bytes = await blob.arrayBuffer(), header = new DataView(bytes);
  if (header.getUint32(0, true) !== 0x46546c67 || header.getUint32(4, true) !== 2 || header.getUint32(8, true) !== bytes.byteLength) throw Error('QA 模型导出未得到有效 GLB');
  worldAsset = await window.LocalAssets.put(blob);
  fixture.worldOutput = await window.LocalAssets.url(worldAsset); fixture.validGLB = true; fixture.glbBytes = bytes.byteLength;
}
button('创建 / 选择 Tripo 3D 节点', async () => {
  await prepareFixedWorld();
  let node = app.getState().nodes.find(item => item.id === worldId);
  if (!node) {node = window.WorldNode.create({x: Math.max(400, innerWidth * .45), y: 270}); worldId = node.id; app.updateNode(node.id, {title: 'QA · Tripo 3D 生成'});}
  app.select(worldId, true);
});
button('创建 / 选择 MiniMax H3 视频节点', async () => {
  let node = app.getState().nodes.find(item => item.id === videoId);
  if (!node) {
    node = app.addNode('video', {x: Math.max(400, innerWidth * .45), y: 180}, null, 'QA · MiniMax H3 视频生成', {
      generation: {prompt: '', model: 'MiniMax H3', modelId: 'MiniMax-H3', mode: '首尾帧', videoMode: 'TEXT_TO_VIDEO',
        ratio: '16:9', quality: '2K', resolution: '2K', duration: 5, count: 1, audio: undefined, generateAudio: undefined}
    }); videoId = node.id;
  }
  app.select(videoId, true);
});
button('查看原生服务配置', () => api.configure());
button('刷新 QA 检查器', write);
window.addEventListener('qa:native-creation', write); api.subscribe(write); document.addEventListener('canvas:render', write);
document.body.append(panel); write();
try {readiness = configurationReadiness(await api.configuration());} catch (cause) {error = cause.message;} write();
