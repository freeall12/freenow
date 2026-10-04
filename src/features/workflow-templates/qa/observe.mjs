const app = window.CanvasApp, fixture = window.WorkflowTemplateMainFixture;
const panel = document.createElement('aside'); panel.id = 'workflow-template-qa-observer'; panel.setAttribute('aria-label', '工作流模板隔离 QA 回执');
panel.style.cssText = 'position:fixed;right:16px;top:64px;z-index:48;width:min(360px,calc(100vw - 32px));padding:12px;background:#202020;color:#ddd;border:1px solid #444;border-radius:8px;font:12px/1.5 system-ui';
const heading = document.createElement('strong'); heading.textContent = '工作流模板 · 正式入口隔离 QA';
const note = document.createElement('p'); note.textContent = '左侧正式模板按钮 → 查看 / 应用；正式画布右键撤销、⌘⇧Z 重做；浏览器刷新复验。下方只观察，不替换应用或撤销。'; note.style.margin = '6px 0';
const details = document.createElement('details'); details.open = true;
const summary = document.createElement('summary'); summary.textContent = '节点 / 连线 / 精确坐标 / 历史回执';
const output = document.createElement('output'); output.id = 'workflow-template-qa-receipt'; output.setAttribute('aria-label', '工作流模板应用真实状态'); output.setAttribute('aria-live', 'polite');
output.style.cssText = 'display:block;white-space:pre-wrap;overflow-wrap:anywhere;max-height:240px;overflow:auto;margin-top:8px';
details.append(summary, output); panel.append(heading, note, details); document.body.append(panel);
let saved = null, readError = null, serial = 0, ready = false;
function nodeRow(node) {
  return {id: node.id, type: node.type, title: node.title, parentId: node.parentId, x: node.x, y: node.y, width: node.width, height: node.height, ...(node.generation ? {model: node.generation.model, referenceOrder: node.generation.referenceOrder} : {}), ...(node.type === 'text' ? {textCharacters: node.content?.length || 0} : {}), ...(node.versions?.length ? {versions: node.versions.length} : {})};
}
function draw() {
  const state = app.getState();
  output.textContent = JSON.stringify({ready, session: fixture.session, namespace: fixture.namespace, nodeCount: state.nodes.length, edgeCount: state.edges.length, history: app.historyState(), nodes: state.nodes.map(nodeRow), edges: state.edges.map(edge => ({id: edge.id, source: edge.source, target: edge.target, data: edge.data})), persisted: saved ? {nodeCount: saved.nodes.length, edgeCount: saved.edges.length, undoCount: saved.history?.length || 0, redoCount: saved.future?.length || 0, storageRevision: saved.storageRevision} : null, externalAttempts: fixture.externalAttempts, blockedNetworkWrites: fixture.blockedNetworkWrites, readError}, null, 2);
}
async function observeSaved() {
  const request = ++serial;
  try {
    // Wait for production persistence instead of introducing a separate save.
    await window.CanvasStore.flush(); const snapshot = await window.CanvasStore.load();
    if (request !== serial) return; saved = snapshot; readError = null; ready = true;
  } catch (error) { if (request !== serial) return; readError = error.message; }
  draw();
}
document.addEventListener('canvas:render', event => {
  if (event.detail?.viewportOnly) return;
  draw(); queueMicrotask(observeSaved);
});
document.addEventListener('templates:changed', () => draw());
window.WorkflowTemplateMainQA = {diagnostics: () => JSON.parse(output.textContent), snapshot: () => structuredClone(app.projectSnapshot()), read: observeSaved};
await window.CanvasResourceDisplayReady;
draw(); await observeSaved();
