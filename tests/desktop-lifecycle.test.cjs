'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return {promise, resolve}; };
const tick = () => new Promise(setImmediate);

test('desktop close awaits last parameters and session commits, and preserves the page on failed handoff or persistence', async () => {
  const {prepareDesktopClose} = await import('../src/features/desktop/lifecycle.mjs');
  const parameterCommit = deferred(), sessionCommit = deferred();
  let panel = true, closes = 0, allowHandoff = true, failStore = false, reopened = 0, savedParams;
  const params = {exposure: 31, temperature: 12};
  const target = {
    document: {body: {inert: false}, activeElement: {isConnected: true, blur() {}, focus() {}}, querySelector: selector => selector === '#agent-panel' && panel ? {} : null},
    CanvasApp: {saveProject: async () => {}, getState: () => ({nodes: []})},
    CanvasStore: {flush: async () => {if (failStore) throw Error('actual transaction rejected');}},
    CanvasProjects: {prepareNavigation: async () => {await sessionCommit.promise;}},
    AgentUI: {
      close: async () => {closes++; if (!allowHandoff) return false; await parameterCommit.promise; savedParams = structuredClone(params); panel = false; return true;},
      open: () => {reopened++; panel = true;},
    },
  };
  let finished = false;
  const closing = prepareDesktopClose(target).then(value => {finished = true; return value;});
  const sameWork = prepareDesktopClose(target);
  await tick(); assert.equal(finished, false); assert.equal(target.document.body.inert, true); assert.equal(panel, true); assert.equal(closes, 1);
  parameterCommit.resolve(); await tick(); assert.equal(finished, false); assert.deepEqual(savedParams, params);
  sessionCommit.resolve(); assert.equal(await closing, true); assert.equal(await sameWork, true); assert.equal(target.document.body.inert, false);

  panel = true; allowHandoff = false;
  await assert.rejects(prepareDesktopClose(target), /上下文交接尚未保存/);
  assert.equal(panel, true); assert.deepEqual(params, {exposure: 31, temperature: 12}); assert.equal(target.document.body.inert, false); assert.equal(reopened, 0);

  allowHandoff = true; failStore = true;
  await assert.rejects(prepareDesktopClose(target), /actual transaction rejected/);
  assert.equal(panel, true); assert.equal(reopened, 1); assert.deepEqual(savedParams, params); assert.equal(target.document.body.inert, false);
});

test('desktop close waits for scene persistence after Agent edits and restores the saved scene on a later store failure', async () => {
  const {prepareDesktopClose} = await import('../src/features/desktop/lifecycle.mjs');
  const sceneCommit = deferred(), events = [];
  const node = {id: 'scene-1', type: 'studio', studioV2: {asset: 'old-glb'}};
  let panel = true, failScene = false, failStore = false, finishClose = true;
  const scene = {
    nodeId: node.id,
    async close() {
      events.push('scene-close');
      if (failScene) throw Error('scene GLB save rejected');
      await sceneCommit.promise;
      node.studioV2.asset = 'saved-cube-glb';
      events.push('scene-saved');
      if (finishClose) target.StudioAPI.active = null;
    },
  };
  const target = {
    document: {body: {inert: false}, querySelector: selector => selector === '#agent-panel' && panel ? {} : null},
    CanvasApp: {saveProject: async () => {}, getState: () => ({nodes: [node]})},
    CanvasStore: {flush: async () => {events.push('store'); if (failStore) throw Error('terminal store rejected');}},
    CanvasProjects: {id: () => 'project-1', prepareNavigation: async () => {events.push('navigate');}},
    AgentUI: {
      close: async () => {events.push('agent-saved'); panel = false; return true;},
      open: () => {events.push('agent-reopened'); panel = true;},
    },
    StudioAPI: {
      active: scene,
      open: async id => {
        assert.equal(id, node.id); assert.equal(node.studioV2.asset, 'saved-cube-glb');
        events.push('scene-reopened'); target.StudioAPI.active = scene;
      },
    },
  };
  let finished = false;
  const closing = prepareDesktopClose(target).then(value => {finished = true; return value;});
  await tick();
  assert.deepEqual(events, ['agent-saved', 'scene-close']);
  assert.equal(finished, false); assert.equal(target.StudioAPI.active, scene); assert.equal(target.document.body.inert, true);
  sceneCommit.resolve();
  assert.equal(await closing, true);
  assert.deepEqual(events, ['agent-saved', 'scene-close', 'scene-saved', 'navigate', 'store']);
  assert.equal(target.StudioAPI.active, null); assert.equal(target.document.body.inert, false);

  events.length = 0; panel = true; target.StudioAPI.active = scene; failScene = true;
  await assert.rejects(prepareDesktopClose(target), /scene GLB save rejected/);
  assert.deepEqual(events, ['agent-saved', 'scene-close', 'agent-reopened']);
  assert.equal(target.StudioAPI.active, scene); assert.equal(target.document.body.inert, false);

  events.length = 0; failScene = false; finishClose = false;
  await assert.rejects(prepareDesktopClose(target), /片场尚未完成关闭/);
  assert.equal(target.StudioAPI.active, scene); assert.equal(events.includes('navigate'), false);

  events.length = 0; finishClose = true; failStore = true;
  await assert.rejects(prepareDesktopClose(target), /terminal store rejected/);
  assert.deepEqual(events, ['agent-saved', 'scene-close', 'scene-saved', 'navigate', 'store', 'scene-reopened', 'agent-reopened']);
  assert.equal(target.StudioAPI.active, scene); assert.equal(panel, true); assert.equal(target.document.body.inert, false);
});

test('desktop close holds input frozen until explicit resume and restores it on persistence rejection', async () => {
  const {prepareDesktopClose, resumeDesktopPage} = await import('../src/features/desktop/lifecycle.mjs');
  const storageCommit = deferred();
  let focusRestores = 0, rejectStorage = false;
  const target = {
    document: {body: {inert: false}, querySelector: () => null, activeElement: {isConnected: true, blur() {}, focus() {focusRestores++;}}},
    CanvasApp: {saveProject: async () => {}, getState: () => ({nodes: []})},
    CanvasProjects: {prepareNavigation: async () => {}},
    CanvasStore: {flush: async () => {await storageCommit.promise; if (rejectStorage) throw Error('final storage rejected');}},
    AgentUI: {close: async () => true},
  };
  const closing = prepareDesktopClose(target, {keepInputFrozen: true});
  await tick(); assert.equal(target.document.body.inert, true);
  storageCommit.resolve(); assert.equal(await closing, true);
  assert.equal(target.document.body.inert, true); assert.equal(focusRestores, 0);
  resumeDesktopPage(target);
  assert.equal(target.document.body.inert, false); assert.equal(focusRestores, 1);
  resumeDesktopPage(target); assert.equal(focusRestores, 1);

  target.document.body.inert = true;
  await prepareDesktopClose(target, {keepInputFrozen: true}); resumeDesktopPage(target);
  assert.equal(target.document.body.inert, true); assert.equal(focusRestores, 1);

  target.document.body.inert = false; rejectStorage = true;
  await assert.rejects(prepareDesktopClose(target, {keepInputFrozen: true}), /final storage rejected/);
  assert.equal(target.document.body.inert, false); assert.equal(focusRestores, 2);
  resumeDesktopPage(target); assert.equal(focusRestores, 2);

  rejectStorage = false;
  await prepareDesktopClose(target, {keepInputFrozen: false});
  assert.equal(target.document.body.inert, false); assert.equal(focusRestores, 3);
});
