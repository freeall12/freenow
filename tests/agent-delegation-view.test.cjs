const test = require('node:test'), assert = require('node:assert/strict');
const {createRequire} = require('node:module'), fabricRequire = createRequire(require.resolve('fabric'));
const domRequire = createRequire(fabricRequire.resolve('jsdom')), canvasPath = domRequire.resolve('canvas'), previousCanvas = require.cache[canvasPath];
require.cache[canvasPath] = {id: canvasPath, loaded: true, exports: {createCanvas: undefined}};
const {JSDOM} = fabricRequire('jsdom');
if (previousCanvas) require.cache[canvasPath] = previousCanvas; else delete require.cache[canvasPath];
async function fixture(trace) {
  const dom = new JSDOM('<body></body>', {url: 'http://localhost:4173/'}), prior = {};
  for (const key of ['document', 'crypto']) {
    prior[key] = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, {configurable: true, writable: true, value: key === 'crypto' ? require('node:crypto').webcrypto : dom.window.document});
  }
  const {createDelegationCard} = await import('../src/features/agent-delegation/view.mjs'), card = createDelegationCard(trace);
  dom.window.document.body.append(card.element);
  return {card, document: dom.window.document, close() {card.destroy(); dom.window.close(); for (const key of Object.keys(prior)) if (prior[key]) Object.defineProperty(globalThis, key, prior[key]); else delete globalThis[key];}};
}
const rows = () => [
  {taskId: 'finish', title: '汇总镜头', dependsOn: ['review'], status: 'blocked', calls: []},
  {taskId: 'review', title: '检查真实画面', dependsOn: [], status: 'running', calls: []},
  {taskId: 'sibling', title: '独立声音检查', dependsOn: [], status: 'waiting', calls: []},
];
test('delegation card distinguishes dependency waiting, ready queue and terminal skipped while preserving focus and disclosure', async () => {
  const trace = {id: 'dag', status: 'running', delegates: rows()}, f = await fixture(trace);
  try {
    const child = f.card.element.querySelector('[data-task-id="finish"]'), trigger = child.querySelector('.execution-line');
    assert.equal(child.dataset.status, 'blocked'); assert.equal(child.querySelector('.delegation-status').textContent, '等待依赖');
    assert.equal(child.querySelector('.delegation-dependencies').textContent, '依赖：检查真实画面');
    assert.equal(f.card.element.querySelector('[data-task-id="sibling"] .delegation-status').textContent, '等待中');
    trigger.click(); trigger.focus(); assert.equal(trigger.getAttribute('aria-expanded'), 'true');
    trace.delegates[0].status = 'queued'; f.card.update(trace);
    assert.equal(child.querySelector('.delegation-status').textContent, '排队中'); assert.equal(f.document.activeElement, trigger);
    trace.delegates[0].status = 'unknown'; trace.delegates[0].error = '回执丢失'; f.card.update(trace);
    assert.equal(child.querySelector('.delegation-status').textContent, '状态未确认'); assert.equal(child.dataset.status, 'unknown');
    trace.delegates[0].status = 'skipped'; trace.delegates[0].blockedBy = ['review']; trace.delegates[0].error = '前置任务失败';
    trace.delegates[1].status = 'failed'; trace.delegates[2].status = 'completed'; f.card.update(trace);
    assert.equal(child.querySelector('.delegation-status').textContent, '已跳过'); assert.equal(child.dataset.status, 'skipped');
    assert.equal(child.querySelector('.delegation-dependencies').textContent, '依赖：检查真实画面；未完成：检查真实画面');
    assert.equal(trigger.getAttribute('aria-expanded'), 'true'); assert.equal(f.document.activeElement, trigger);
    assert.equal(child.querySelectorAll('.execution-icon').length, 2);
  } finally {f.close();}
});
test('canonical skipped and limited results keep their terminal labels over stale live traces', async () => {
  const trace = {id: 'dag', status: 'done', delegates: rows(), result: {status: 'failed', tasks: [
    {taskId: 'finish', title: '汇总镜头', dependsOn: ['review'], status: 'skipped', blockedBy: ['review'], error: '前置达到上限'},
    {taskId: 'review', title: '检查真实画面', dependsOn: [], status: 'limited', error: 'round_limit'},
    {taskId: 'sibling', title: '独立声音检查', dependsOn: [], status: 'cancelled'},
  ]}}, f = await fixture(trace);
  try {
    assert.equal(f.card.element.querySelector('[data-task-id="finish"] .delegation-status').textContent, '已跳过');
    assert.equal(f.card.element.querySelector('[data-task-id="review"] .delegation-status').textContent, '达到上限');
    assert.equal(f.card.element.querySelector('[data-task-id="sibling"] .delegation-status').textContent, '已取消');
    assert(f.card.element.textContent.includes('未完成：检查真实画面'));
  } finally {f.close();}
});
test('refresh recovery interrupts queued and dependency-blocked tasks while preserving actual skipped terminals', async () => {
  const {recoverTraces} = await import('../src/features/agent-execution/trace.mjs');
  const delegates = rows(); delegates[1].status = 'queued'; delegates[2].status = 'skipped'; delegates[2].blockedBy = ['review'];
  const trace = {id: 'dag', role: 'tool', name: 'agent_delegate', status: 'running', delegates};
  recoverTraces([trace]); assert.deepEqual(delegates.map(row => row.status), ['interrupted', 'interrupted', 'skipped']);
  assert.deepEqual(delegates[0].dependsOn, ['review']); assert.deepEqual(delegates[2].blockedBy, ['review']);
  const f = await fixture(trace); try {assert.equal(f.card.element.querySelector('[data-task-id="finish"] .delegation-status').textContent, '已中断');} finally {f.close();}
});
