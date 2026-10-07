const $ = selector => document.querySelector(selector), frame = $('#frame'), log = $('#log');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let projectId, sourceUrl, nodeIds = [];
function report(message) {log.textContent += message + '\n';}
function assert(value, message) {if (!value) throw Error(message); report('PASS ' + message);}
const host = () => frame.contentWindow;
const current = id => host().CanvasApp.getState().nodes.find(node => node.id === id);
const input = id => host().CanvasApp.getNodeElement(id)?.querySelector('.node-title-input');
async function ready() {
  for (let i = 0; i < 200; i++) {
    const win = host();
    if (win.CanvasApp?.getNodeElement(nodeIds[0])) win.CanvasApp.select(nodeIds[0]);
    const field = input(nodeIds[0]);
    if (win.CanvasApp && win.CanvasProjects?.id() === projectId && field && !field.disabled) return;
    await pause(50);
  }
  throw Error('生产画布未能完成读取');
}
async function loadFrame(url) {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {frame.removeEventListener('load', loaded); reject(Error('生产画布导航超时'));}, 20000);
    function loaded() {clearTimeout(timeout); frame.removeEventListener('load', loaded); resolve();}
    frame.addEventListener('load', loaded); frame.src = url;
  });
  await ready();
}
function change(id, value) {const field = input(id); field.focus(); field.value = value; field.dispatchEvent(new (host().Event)('input', {bubbles: true})); return field;}
function key(field, value, extra = {}) {field.dispatchEvent(new (host().KeyboardEvent)('keydown', {bubbles: true, key: value, ...extra}));}
async function create() {
  $('#create').disabled = true; $('#run').disabled = true; $('#open').hidden = true; log.textContent = '';
  try {
    projectId = 'qa-node-titles-' + crypto.randomUUID();
    const types = ['image', 'video', 'audio', 'text', 'world'], nodes = types.map((type, index) => ({
      id: projectId + '-' + type, type, title: 'QA ' + type, x: 330 + index % 3 * 340, y: 90 + Math.floor(index / 3) * 270, width: 280, height: 170,
      ...(type === 'text' ? {content: '正文保持独立编辑', textMode: 'pure'} : {}), ...(type === 'audio' ? {audioMode: 'upload'} : {}),
    }));
    nodeIds = nodes.map(node => node.id);
    const now = Date.now();
    await window.CanvasStore.save({version: 1, nodes, edges: [], history: [], future: [], view: {x: 0, y: 0, scale: .7}, project: {id: projectId, title: '节点标题验收', createdAt: now, updatedAt: now}}, projectId);
    sourceUrl = '/?project=' + encodeURIComponent(projectId); await loadFrame(sourceUrl);
    $('#types').replaceChildren();
    for (const [index, type] of types.entries()) {const button = document.createElement('button'); button.textContent = '选择 ' + type; button.onclick = () => host().CanvasApp.select(nodeIds[index], true); $('#types').append(button);}
    $('#open').href = sourceUrl; $('#open').hidden = false; $('#run').disabled = false;
    $('#status').textContent = '生产画布已加载'; report('项目 ' + projectId); report('入口 ' + sourceUrl);
  } catch (error) {$('#status').textContent = error.message; report('FAIL ' + error.message);}
  finally {$('#create').disabled = false;}
}
async function run() {
  $('#run').disabled = true; const win = host(), app = win.CanvasApp, id = nodeIds[1];
  try {
    for (const nodeId of nodeIds) {
      app.select(nodeId); const field = input(nodeId);
      assert(field && !field.closest('.node-title-editor').hidden, current(nodeId).type + ' 选中显示输入');
      app.select(null); assert(field.closest('.node-title-editor').hidden, current(nodeId).type + ' 未选中显示 span');
    }
    app.select(id, true); const geometry = JSON.stringify([current(id).x, current(id).y, app.getState().view]);
    let field = change(id, '防抖标题'); await pause(500); assert(current(id).title === 'QA video', '500ms 不提前提交');
    change(id, '中文最终标题'); await pause(1100); assert(current(id).title === '中文最终标题', '最新输入 1s 防抖提交');
    field.dispatchEvent(new win.PointerEvent('pointerdown', {bubbles: true, pointerId: 77, button: 0, clientX: 500, clientY: 100}));
    frame.contentDocument.querySelector('#canvas').dispatchEvent(new win.PointerEvent('pointermove', {bubbles: true, pointerId: 77, clientX: 700, clientY: 200}));
    field.dispatchEvent(new win.WheelEvent('wheel', {bubbles: true, deltaY: 100, ctrlKey: true}));
    assert(JSON.stringify([current(id).x, current(id).y, app.getState().view]) === geometry, '标题手势不启动节点拖动或画布缩放');
    field.dispatchEvent(new win.CompositionEvent('compositionstart', {bubbles: true})); change(id, 'zhongwen'); key(field, 'Enter', {isComposing: true}); await pause(1100);
    assert(current(id).title === '中文最终标题', 'IME 过程中不提交半成品');
    field.value = '中文输入完成'; field.dispatchEvent(new win.CompositionEvent('compositionend', {bubbles: true})); key(field, 'Enter');
    assert(current(id).title === '中文输入完成', 'IME 完成后的 Enter 立即提交');
    field = change(id, '取消草稿'); key(field, 'Escape'); await pause(1100); assert(current(id).title === '中文输入完成' && field.value === '中文输入完成', 'Escape 取消未提交草稿');
    field = change(id, '   '); field.blur(); assert(current(id).title === '中文输入完成' && field.value === '中文输入完成', '空标题恢复已保存标题');
    change(id, '重建前标题'); app.updateNode(id, {qaTitleRebuild: true}); assert(current(id).title === '重建前标题' && input(id) !== field, '内容重建前提交草稿并重新绑定输入');
    field = change(id, '撤销前草稿'); app.undo(); await pause(1100); assert(current(id).title === '重建前标题', '撤销丢弃草稿，旧定时器不改写历史');
    app.undo(); assert(current(id).title === '中文输入完成', '已提交标题可撤销'); app.undo(true); assert(current(id).title === '重建前标题', '已提交标题可重做');
    app.select(id); change(id, '导航保存标题'); await app.prepareProjectNavigation();
    const saved = await window.CanvasStore.load(projectId); assert(saved.nodes.find(node => node.id === id).title === '导航保存标题', '导航前通过生产保存入口提交标题');
    await loadFrame(sourceUrl + '&qaReload=' + Date.now());
    assert(current(id).title === '导航保存标题', '刷新后本地数据库标题恢复');
    host().CanvasApp.select(id, true); $('#status').textContent = '生产入口检查通过；真实 IME 与视觉仍需人工复验';
    report('人工状态验证：选中标题拖选文字、中文输入法候选确认、双击文字、滚轮、不同缩放、切换两个画布。');
  } catch (error) {$('#status').textContent = '检查失败：' + error.message; report('FAIL ' + error.stack);}
  finally {$('#run').disabled = false;}
}
$('#create').onclick = create; $('#run').onclick = run;
