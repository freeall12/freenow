const app = window.CanvasApp, fixture = window.WorkflowRecoveryFixture;
const bar = document.createElement('aside');
bar.id = 'workflow-qa-controls';
bar.style.cssText = 'position:fixed;left:185px;right:180px;top:54px;z-index:2200;padding:10px;background:#25282b;color:#eee;font:12px system-ui;border:1px solid #666;max-height:45vh;overflow:auto';
const title = document.createElement('strong'); title.textContent = '分组持久恢复 QA · 生产主壳 / 页面内模拟 HTTP 传输 / 合成合同文本';
const instruction = document.createElement('p'); instruction.textContent = '首层 A/B 并行，后层 C 依赖两项结果。先点正式整组运行并确认，等待 POST=2 后刷新；查询原任务、释放首层、再查询，C 必须等待明确继续。刷新和第二页保持相同 session/project。'; instruction.style.margin = '5px 0';
const status = document.createElement('output'); status.setAttribute('aria-label', '工作流合同 QA 状态'); status.id = 'workflow-qa-status'; status.style.cssText = 'display:block;white-space:pre-wrap;margin:5px 0';
const diagnostics = document.createElement('pre'); diagnostics.id = 'workflow-qa-diagnostics'; diagnostics.setAttribute('aria-label', '工作流持久恢复诊断'); diagnostics.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere;font:11px monospace;margin:5px 0;max-height:230px;overflow:auto';
bar.append(title, instruction, status); document.body.append(bar);
let ready = false, host = null, lastError = null, lastAction = null, saved = null, journal = null, transport = null, updating = false;
const buttons = [];
const projectId = window.CanvasProjects.id(), recordKey = 'agent-workflow-runs:' + projectId;
const nativeWrite = window.CanvasStore.writeRecord.bind(window.CanvasStore), nativeSave = window.CanvasStore.save.bind(window.CanvasStore);
function fault(stage) {
  if (fixture.failureStage !== stage) return;
  fixture.failureStage = null;
  fixture.localEvents.push({at: Date.now(), stage, event: 'explicit-save-failure'});
  throw Error('QA 显式阻断一次 ' + stage + ' 保存（旧持久快照保留）');
}
window.CanvasStore.writeRecord = (key, value, options) => {
  if (key === recordKey) {
    const run = value.runs?.at(-1), tasks = Object.values(run?.tasks || {});
    const stage = tasks.some(task => task.state === 'applying') ? 'application' : tasks.some(task => task.state === 'applied') ? 'applied' : tasks.some(task => task.transportRequestVersion) ? 'prepared' : tasks.some(task => task.taskId) ? 'submitted' : 'plan';
    fault(stage);
  }
  return nativeWrite(key, value, options);
};
window.CanvasStore.save = async (...args) => {fault('canvas'); return nativeSave(...args);};
const provider = window.GenerationCore.httpProvider({baseUrl: new URL('/qa-workflow-contract', location.href).href, fetchImpl: fixture.transport, pollInterval: 1000, timeout: 600000, cancelRemote: true, recoverable: true});
provider.isConfigured = async () => true;
window.GenerationAPI.setProvider(provider);
function button(label, run, enabled = false) {
  const control = document.createElement('button'); control.textContent = label; control.disabled = !enabled; control.style.cssText = 'margin:4px 6px 0 0;font:12px system-ui';
  control.onclick = async () => {lastAction = label; lastError = null; try {await run();} catch (error) {lastError = error.message; app.notify(error.message);} await draw();};
  bar.append(control); if (!enabled) buttons.push(control); return control;
}
button('正式整组运行 / 恢复对话框', () => window.WorkflowAPI.open(fixture.groupId));
button('查询原任务（生产恢复入口）', () => window.WorkflowAPI.query(fixture.groupId));
button('释放所有已派发合同结果', () => fixture.release());
button('明确继续未派发后层', async () => {const execution = await window.WorkflowAPI.continue(fixture.groupId); execution.completion.catch(error => {lastError = error.message; void draw();});});
button('停止整组（保留已派发）', () => window.WorkflowAPI.stop(fixture.groupId));
button('保存画布并回读', async () => {await app.saveProject(); saved = await window.CanvasStore.load();});
button('实际回读持久记录', () => read());
button('刷新当前页', () => location.reload(), true);
const second = document.createElement('a'); second.href = location.href; second.target = '_blank'; second.rel = 'noopener'; second.textContent = '打开相同 session 的第二页（Web Lock 只读验收）'; second.style.cssText = 'display:inline-block;margin:6px;color:#eee;text-decoration:underline'; bar.append(second);
const faults = document.createElement('select'); faults.setAttribute('aria-label', '下一次保存故障阶段');
for (const [value, label] of [['plan', '计划保存'], ['submitted', '原任务登记保存'], ['prepared', '最终请求签名保存（POST前）'], ['application', '应用意图保存'], ['applied', '完成收据保存'], ['canvas', '画布保存']]) {const option = document.createElement('option'); option.value = value; option.textContent = label; faults.append(option);}
bar.append(faults);
button('阻断所选阶段下一次保存', () => {fixture.failureStage = faults.value;});
button('将原任务 GET 设为 404', () => fixture.set404(true));
button('恢复原任务 GET', () => fixture.set404(false));
button('新隔离 session', () => {const url = new URL(location.href); const id = crypto.randomUUID(); url.searchParams.set('session', id); url.searchParams.set('project', 'qa_' + id.replaceAll('-', '')); location.assign(url.href);}, true);
const details = document.createElement('details'); details.open = true; const summary = document.createElement('summary'); summary.textContent = '可见诊断：传输计数 / 原 ID / 持久收据 / 图结果标记'; details.append(summary, diagnostics); bar.append(details);
async function read() {
  [transport, saved, journal] = await Promise.all([fixture.read(), window.CanvasStore.load(), window.CanvasStore.readRecord(recordKey)]);
}
function snapshot() {
  const events = transport?.events || [], posts = events.filter(event => event.method === 'POST'), gets = events.filter(event => event.method === 'GET'), deletes = events.filter(event => event.method === 'DELETE');
  const rows = nodes => nodes?.filter(node => node.parentId === fixture.groupId).map(({id, type, content, workflowRecoveryResult, textHistory}) => ({id, type, content, workflowRecoveryResult, textHistoryCount: textHistory?.length}));
  const run = journal?.runs?.at(-1);
  const compactRun = value => value && {runId: value.runId, ownerId: value.ownerId, epoch: value.epoch, stopping: value.stopping, plan: value.plan, tasks: Object.fromEntries(Object.entries(value.tasks || {}).map(([id, task]) => [id, {...task, application: task.application && {beforeVersionLength: task.application.beforeVersion?.length, afterVersionLength: task.application.afterVersion?.length, resultVersion: task.application.resultVersion}}]))};
  return {ready, writable: host?.writable, ownershipError: host?.error, projectId, namespace: fixture.namespace, syntheticOutput: true, actualProviderCalls: 0, transport: '页面内模拟 HTTP；生产 GenerationCore.httpProvider，实际本机 fixture 文件和隔离 IndexedDB',
    counts: {post: posts.length, duplicatePost: posts.filter(event => event.duplicate).length, get: gets.length, byKeyGet: gets.filter(event => event.byKey).length, delete: deletes.length},
    posts: posts.map(({id, nodeId, duplicate}) => ({id, nodeId, duplicate})), lookup404: transport?.lookup404,
    remoteTasks: Object.values(transport?.tasks || {}).map(({id, status, request}) => ({id, status, nodeId: request.nodeId, identity: request.parameters.workflowRecovery})),
    durableRun: compactRun(run), storageRevision: journal?.storageRevision,
    recovery: compactRun(window.WorkflowAPI.recoverable(fixture.groupId)), execution: (() => {const execution = window.WorkflowAPI.getRun(fixture.groupId); return execution && {status: execution.status, errors: execution.errors?.map(error => error.message)};})(),
    live: rows(app.getState().nodes), saved: rows(saved?.nodes), savedStorageRevision: saved?.storageRevision,
    jobs: window.GenerationAPI.getJobs().map(({id, status, applied, applicationError, recovered, cancellation}) => ({id, status, applied, applicationError, recovered, cancellation})),
    armedFailureStage: fixture.failureStage, localEvents: fixture.localEvents, recentTransportEvents: events.slice(-25), externalAttempts: fixture.externalAttempts, lastAction, lastError};
}
async function draw() {
  if (updating) return; updating = true;
  try {await read(); const value = snapshot(); const counts = value.counts;
    status.textContent = `${ready ? '生产恢复入口已就绪' : '正在等待生产恢复入口'} · ${host?.writable === false ? '只读 / 无项目写锁' : '项目写锁已获取或等待确认'} · POST=${counts.post} / 重复POST=${counts.duplicatePost} / 原ID GET=${counts.byKeyGet} / DELETE=${counts.delete}\n${lastError || host?.error || '输出为合成合同文本，非真实 provider 生成。'}${fixture.failureStage ? '\n下一次故障：' + fixture.failureStage : ''}`;
    diagnostics.textContent = JSON.stringify(value, null, 2);
  } catch (error) {lastError = error.message; status.textContent = error.message;} finally {updating = false;}
}
window.WorkflowRecoveryQA = {read, snapshot, draw};
document.addEventListener('workflow-qa:transport', () => void draw());
document.addEventListener('canvas:render', () => void draw());
window.GenerationAPI.subscribe(() => void draw());
try {
  await window.CanvasResourceDisplayReady;
  host = await window.WorkflowAPI.ready;
  await read(); if (!saved) {await app.saveProject(); await read();}
  for (let attempt = 0; attempt < 200; attempt++) {
    const notice = document.querySelector('#storage-notice[data-operation="load"]');
    if (notice) throw Error(notice.textContent);
    if (app.resourceMigrationStatus?.() && app.getState().nodes.length === saved.nodes.length) break;
    if (attempt === 199) throw Error('QA 等待生产画布实际加载超时；未启用运行控制');
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  ready = true; for (const control of buttons) control.disabled = false;
} catch (error) {lastError = error.message;}
await draw(); setInterval(() => void draw(), 1200);
