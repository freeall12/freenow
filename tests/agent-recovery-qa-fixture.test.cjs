'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');

test('QA terminal delegation interrupts the real runner before a receipt, then supports only explicit aggregate continuation', async () => {
 const writes = [];
 class Storage {
  constructor() {this.values = new Map();}
  getItem(key) {return this.values.get(key) ?? null;}
  setItem(key, value) {writes.push(key); this.values.set(key, String(value));}
  removeItem(key) {this.values.delete(key);}
 }
 const window = {fetch: () => assert.fail('Agent QA requests must never reach a live server'), dispatchEvent() {}};
 const context = vm.createContext({window, Storage, sessionStorage: new Storage(), URL, URLSearchParams, location: {href: 'http://localhost/qa/agent-recovery-app.html', search: '?session=terminal-fixture-test&mode=terminal_delegation'}, crypto, Response, DOMException, Event});
 vm.runInContext(fs.readFileSync(require.resolve('../qa/agent-recovery-fixture.js'), 'utf8'), context);
 const request = async (action, input) => {
  const response = await window.fetch('/api/agent/' + action, {body: JSON.stringify(input)});
  const value = await response.json();
  if (!response.ok) throw Error(value.error);
  return value;
 };
 const journal = await import('../src/features/agent-recovery/journal.mjs'), model = await import('../src/features/agent-recovery/model.mjs'), recovery = await import('../src/features/agent-recovery/terminal-delegation.mjs'), {runDelegation} = await import('../src/features/agent-delegation/runner.mjs');
 const scope = {projectId: 'qa-project', conversationId: 'qa-chat'}, binding = {...scope, submissionId: 'qa-submission'}, sourceVersion = 'a'.repeat(64);
 const first = await request('turn', {binding}), record = {sessionId: first.sessionId, submissionId: binding.submissionId, binding};
 await journal.initializeJournal(record, {submission: {id: binding.submissionId, text: 'QA 委派恢复'}, sourceVersion});
 journal.recordPendingRound(record, first, new Set(first.calls.map(call => call.callId)));
 const before = structuredClone(record.journal), call = first.calls[0];
 await assert.rejects(runDelegation({sessionId: first.sessionId, callId: call.callId, tasks: call.args.tasks, signal: new AbortController().signal, request, execute: () => assert.fail('QA should execute no child tools'), allowedTools: []}), {name: 'AbortError'});
 assert.deepEqual(record.journal, before); assert.equal(record.journal.receipts, null);
 record.state = model.checkedSummary(record, await request('state', {sessionId: record.sessionId, binding}));
 assert.deepEqual(record.state.delegation.tasks.map(task => task.status), ['completed', 'completed']);
 assert(!JSON.stringify(record.state).includes('QA 固定模拟正文'));
 await recovery.prepareTerminalDelegationReceipt(record, {scope, sourceVersion, request, isCurrent: () => true});
 assert(record.journal.receipts.results[0].result.tasks.every(task => task.response.text.includes('非真实模型')));
 const plan = await journal.buildResumePlan(record, scope, sourceVersion), last = await request('continue', {sessionId: plan.sessionId, binding: plan.binding, results: plan.results});
 journal.assertResumeResponse(last, plan); assert.equal(last.done, true);
 const actions = Array.from(window.AgentRecoveryFixture.state().requests, item => item.path.split('/').at(-1));
 assert.deepEqual(actions, ['turn', 'delegated-start', 'state', 'delegated-result', 'continue']);
 assert(writes.every(key => key === 'qa-agent-recovery:terminal-fixture-test:fixture-state'));
});
