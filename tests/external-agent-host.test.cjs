'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {webcrypto} = require('node:crypto');
test('production readonly host returns metadata snapshots, no content, and revision-bound pagination', async () => {
  const {createReadonlyHost} = await import('../src/features/external-agent/host.mjs');
  let ready = true, project = 'public-qa'; const state = {nodes: [{id: 'n1', type: 'text', title: 'Public node', text: 'PRIVATE_BODY', prompt: 'PRIVATE_PROMPT', image: 'https://private.invalid', x: 0, y: 1, width: 10, height: 20}, {id: 'n2', type: 'image', name: 'PRIVATE_HIDDEN_NAME', label: 'PRIVATE_HIDDEN_LABEL', x: 4, y: 5, width: 30, height: 40}], edges: [{id: 'e1', source: 'n1', target: 'n2', private: 'PRIVATE_EDGE'}], selected: ['n1']};
  const host = createReadonlyHost({app: {getState: () => state}, getReady: () => ready, getIdentity: () => ({id: project, title: 'Public QA'}), pageId: 'page-qa', crypto: webcrypto}); const binding = host.identity();
  const status = await host.read('workspace_status', {}, binding); assert.equal(status.node_count, 2);
  const first = await host.read('canvas_read', {limit: 1, expected_revision: status.revision}, binding); assert.equal(first.next_offset, 1); assert.equal(first.nodes[0].selected, true); assert.doesNotMatch(JSON.stringify(first), /PRIVATE|https:/);
  const second = await host.read('canvas_read', {offset: 1, limit: 1, expected_revision: status.revision}, binding); assert.equal(second.nodes[0].title, ''); assert.equal(second.next_offset, null);
  state.nodes[0].x++; await assert.rejects(host.read('canvas_read', {expected_revision: status.revision}, binding), {code: 'revision_changed'});
  project = 'other'; await assert.rejects(host.read('workspace_status', {}, binding), {code: 'workspace_changed'});
  ready = false; await assert.rejects(host.read('workspace_status', {}, binding), {code: 'workspace_unavailable'}); ready = true; host.dispose(); await assert.rejects(host.read('workspace_status', {}, binding), {code: 'workspace_unavailable'});
});
test('readonly host rejects unsupported commands and non-metadata arguments', async () => {
  const {createReadonlyHost} = await import('../src/features/external-agent/host.mjs');
  const host = createReadonlyHost({app: {getState: () => ({nodes: [], edges: [], selected: []})}, getReady: () => true, getIdentity: () => ({id: 'qa', title: 'QA'}), pageId: 'page', crypto: webcrypto}); const binding = host.identity();
  await assert.rejects(host.read('generation_submit', {}, binding), {code: 'tool_not_supported'});
  for (const args of [{url: 'https://private.invalid'}, {limit: 51}, {offset: -1}, {expected_revision: ['a'.repeat(64)]}]) await assert.rejects(host.read('canvas_read', args, binding), {code: 'invalid_arguments'});
});
