const test = require('node:test'), assert = require('node:assert/strict');
const modules = Promise.all([import('../src/features/studio-v3/camera-shot-preview.mjs'), import('../src/features/studio-v3/schema.mjs'), import('../src/features/studio-v3/world-space.mjs'), import('../src/features/studio-v3/camera-shots.mjs'), import('three')]);
const deferred = () => {let resolve, reject; const promise = new Promise((yes, no) => {resolve = yes; reject = no;}); return {promise, resolve, reject};};
async function fixture(options = {}) {
  const [preview, schema, world, shots, THREE] = await modules;
  let state = schema.createState({worldNodeId: 'owner', now: 1}), resource = {url: '/assets/scene.glb', format: 'glb'};
  const camera = {position: {x: 1, y: 2, z: 3}, rotation: {x: .1, y: .2, z: .3, order: 'YXZ'}, fov: 45, frameAspectRatio: 16 / 9};
  state = world.addEntity(state, schema.createEntity({id: 'shared-camera', kind: 'camera', label: 'Camera', now: 1}), {setupId: 'setup-default', setupState: {...schema.createSetupState('shared-camera', 1), camera}});
  const getShot = () => shots.listCameraShots(state)[0];
  const instances = [], urls = [], revoked = [], canvases = []; let live = 0, maxLive = 0;
  const host = preview.createCameraShotPreview({getState: () => state, getSourceResource(stageId, shot) {assert.equal(stageId, shot.stageId); return resource;},
    createCanvas() {const canvas = {id: canvases.length}; canvases.push(canvas); return canvas;},
    runtimeFactory(args) {
      const instance = {args, disposeCount: 0, syncState: null, photos: []}; instances.push(instance); live++; maxLive = Math.max(live, maxLive);
      return {async sync(snapshot) {instance.syncState = snapshot; schema.assertState(snapshot); if (options.sync) return options.sync(instance);
        return {source: resource ? {status: 'ready'} : null, entities: [{id: 'shared-camera', status: 'ready'}]};},
        entityObject: options.entityObject,
        async renderPhoto(camera, args) {assert(camera instanceof THREE.PerspectiveCamera); instance.photos.push({camera, args}); if (options.photo) return options.photo(instance, camera, args);
          const dimensions = preview.cameraShotPreviewDimensions(args.frameAspectRatio); return {canvas: {}, width: dimensions.width, height: dimensions.height, quality: .92, blob: new Blob(['jpeg-image'], {type: 'image/jpeg'})};},
        async dispose() {instance.disposeCount++; live--; await options.close?.(instance);}};
    }, createObjectURL(blob) {assert.equal(blob.type, 'image/jpeg'); const url = `blob:preview-${urls.length}`; urls.push(url); options.url?.(); return url;}, revokeObjectURL(url) {revoked.push(url);},
    ...options.cache});
  return {preview, schema, world, THREE, host, instances, urls, revoked, canvases, getShot, get state() {return state;}, set state(value) {state = value;}, set resource(value) {resource = value;}, get maxLive() {return maxLive;}};
}

test('strict detached merged-shot state freezes shared baseline without illegal independent overrides', async () => {
  const f = await fixture(), before = structuredClone(f.state), shot = f.getShot();
  const snapshot = f.preview.createCameraShotPreviewState(f.state, shot), space = snapshot.scenePlay.worldSpace;
  f.schema.assertState(snapshot); assert.equal(space.activeViewId, null); assert.equal(space.activeSetupId, shot.setupId);
  assert.deepEqual(space.setups.find(item => item.id === 'setup-default').entityStates, []);
  assert.deepEqual(space.setups.find(item => item.id === shot.setupId), shot.setup);
  snapshot.scenePlay.worldSpace.entities[0].label = 'Changed'; assert.deepEqual(f.state, before);
  assert.throws(() => f.preview.createCameraShotPreviewState(f.state, {...shot, setupId: 'missing'}), error => error.code === 'studio_v3_shot_preview_unavailable');
});

test('separate runtime/canvas uses genuine Three optics and fit-box JPEG .92 with no padding', async () => {
  const f = await fixture(), result = await f.host.request(f.getShot()), instance = f.instances[0], {camera, args} = instance.photos[0];
  assert.equal(instance.args.autoRender, false); assert.equal(instance.args.canControlInput(), false); assert.equal(instance.args.canvas, f.canvases[0]);
  assert.deepEqual(camera.position.toArray(), [1, 2, 3]); assert.equal(camera.rotation.order, 'YXZ'); assert.equal(camera.aspect, 16 / 9);
  assert(Math.abs(camera.fov - 45) < 1e-8); assert.deepEqual(args, {longEdge: 320, frameAspectRatio: 16 / 9});
  assert.equal(result.width, 320); assert.equal(result.height, 180); assert.equal(instance.disposeCount, 1);
  assert.equal(result.dispose(), true); assert.equal(result.dispose(), false); assert.deepEqual(f.revoked, [result.url]); await f.host.dispose();
});

test('portrait, square and wide thumbnails fit 320×180 and automatic ratio stays optical', async () => {
  const f = await fixture();
  for (const [ratio, width, height] of [[9 / 16, 101, 180], [1, 180, 180], [2.39, 320, 134], [null, 270, 180]]) {
    const shot = f.getShot(); shot.camera.frameAspectRatio = ratio;
    const result = await f.host.request(shot); assert.equal(result.width, width); assert.equal(result.height, height); result.dispose();
  }
  assert.throws(() => f.preview.cameraShotPreviewDimensions(0)); await f.host.dispose();
});

test('point and entity lookAt resolve against isolated scene after sync', async () => {
  const [, , , , THREE] = await modules, target = new THREE.Group(); target.position.set(5, 2, 3); target.updateMatrixWorld(true);
  const f = await fixture({entityObject: id => id === 'shared-camera' ? target : null});
  for (const lookAt of [{mode: 'point', target: {x: 5, y: 2, z: 3}}, {mode: 'entity', entityId: 'shared-camera'}]) {
    const shot = f.getShot(); shot.camera.lookAt = lookAt; (await f.host.request(shot)).dispose();
    const optical = f.instances.at(-1).photos[0].camera; assert(optical.getWorldDirection(new THREE.Vector3()).distanceTo(new THREE.Vector3(1, 0, 0)) < 1e-8);
  }
  await f.host.dispose();
});

test('serial queue deduplicates cached image, gives distinct URL leases and never overlaps runtimes', async () => {
  const sync = deferred(), started = deferred(); const f = await fixture({async sync() {started.resolve(); await sync.promise; return {source: {status: 'ready'}, entities: []};}});
  const first = f.host.request(f.getShot()); await started.promise; const second = f.host.request(f.getShot());
  assert.equal(f.instances.length, 1); sync.resolve(); const [a, b] = await Promise.all([first, second]);
  assert.equal(f.instances.length, 1); assert.equal(f.maxLive, 1); assert.notEqual(a.url, b.url); a.dispose(); assert.deepEqual(f.revoked, [a.url]);
  await f.host.dispose(); assert.deepEqual(f.revoked, [a.url, b.url]); assert.equal(b.dispose(), false);
});

test('cache updates LRU and counts encoded bytes plus cache keys; eviction leaves callers valid', async () => {
  const f = await fixture({cache: {maxEntries: 2}}), shot = f.getShot();
  const variant = x => ({...shot, camera: {...shot.camera, position: {...shot.camera.position, x}}});
  const a = await f.host.request(variant(1)), b = await f.host.request(variant(2)); (await f.host.request(variant(1))).dispose();
  const c = await f.host.request(variant(3)); assert.equal(f.host.cacheSize, 2); assert(f.host.cacheBytes > 3 * 10); assert.equal(f.revoked.includes(b.url), false);
  (await f.host.request(variant(2))).dispose(); assert.equal(f.instances.length, 4); a.dispose(); b.dispose(); c.dispose(); await f.host.dispose();
  const tiny = await fixture({cache: {maxBytes: 1}}); (await tiny.host.request(tiny.getShot())).dispose(); assert.equal(tiny.host.cacheSize, 0); (await tiny.host.request(tiny.getShot())).dispose(); assert.equal(tiny.instances.length, 2); await tiny.host.dispose();
});

test('source and other scene-state changes invalidate cached imagery while title alone does not', async () => {
  const f = await fixture(); (await f.host.request(f.getShot())).dispose();
  const renamed = f.getShot(); renamed.title = 'Renamed'; (await f.host.request(renamed)).dispose(); assert.equal(f.instances.length, 1);
  f.resource = {url: '/assets/new-scene.glb', format: 'glb'}; (await f.host.request(f.getShot())).dispose(); assert.equal(f.instances.length, 2);
  f.state = structuredClone(f.state); f.state.scenePlay.environment.ground.y = 3; (await f.host.request(f.getShot())).dispose(); assert.equal(f.instances.length, 3); await f.host.dispose();
});

test('request snapshots are captured before queue work and later domain changes cannot mutate rendering', async () => {
  const blocker = deferred(), started = deferred(); const f = await fixture({async sync() {started.resolve(); await blocker.promise; return {source: {status: 'ready'}, entities: []};}});
  const shot = f.getShot(), result = f.host.request(shot); shot.camera.position.x = 90; f.state.scenePlay.environment.ground.y = 9;
  await started.promise; assert.equal(f.instances[0].syncState.scenePlay.environment.ground.y, undefined); blocker.resolve(); (await result).dispose();
  assert.equal(f.instances[0].photos[0].camera.position.x, 1); await f.host.dispose();
});

test('queued abort rejects before canvas/runtime creation; active abort closes isolated renderer without URL', async () => {
  const blocker = deferred(), started = deferred(); const f = await fixture({async sync() {started.resolve(); await blocker.promise; return {source: {status: 'ready'}, entities: []};}});
  const signal = new AbortController(), queuedSignal = new AbortController(); const first = f.host.request(f.getShot(), {signal: signal.signal}); const firstFailure = assert.rejects(first, error => error.code === 'studio_v3_shot_preview_aborted');
  await started.promise; const second = f.host.request(f.getShot(), {signal: queuedSignal.signal}); const secondFailure = assert.rejects(second, error => error.code === 'studio_v3_shot_preview_aborted');
  queuedSignal.abort(); signal.abort(); await Promise.all([firstFailure, secondFailure]);
  assert.equal(f.instances.length, 1); assert.equal(f.instances[0].disposeCount, 1); assert.equal(f.urls.length, 0); blocker.resolve(); await f.host.dispose();
});

test('stale completion and stale cache-hit never publish URLs or cache newly rendered imagery', async () => {
  let current = true; const f = await fixture({photo(instance, camera, args) {current = false; const {width, height} = f.preview.cameraShotPreviewDimensions(args.frameAspectRatio); return {width, height, quality: .92, blob: new Blob(['jpeg'], {type: 'image/jpeg'})};}});
  await assert.rejects(f.host.request(f.getShot(), {isCurrent: () => current}), error => error.code === 'studio_v3_shot_preview_stale'); assert.equal(f.host.cacheSize, 0); assert.equal(f.urls.length, 0); assert.equal(f.instances[0].disposeCount, 1); await f.host.dispose();
  const cached = await fixture(); (await cached.host.request(cached.getShot())).dispose(); await assert.rejects(cached.host.request(cached.getShot(), {isCurrent: () => false}), error => error.code === 'studio_v3_shot_preview_stale'); assert.equal(cached.urls.length, 1); await cached.host.dispose();
});

test('final cleanup and URL publication are fenced; pre-aborted requests never read source or create runtimes', async () => {
  let current = true; const f = await fixture({close() {current = false;}});
  await assert.rejects(f.host.request(f.getShot(), {isCurrent: () => current}), error => error.code === 'studio_v3_shot_preview_stale'); assert.equal(f.urls.length, 0); assert.equal(f.host.cacheSize, 0); await f.host.dispose();
  let owner = true; const atURL = await fixture({url() {owner = false;}});
  await assert.rejects(atURL.host.request(atURL.getShot(), {isCurrent: () => owner}), error => error.code === 'studio_v3_shot_preview_stale'); assert.equal(atURL.host.cacheSize, 0); assert.deepEqual(atURL.revoked, atURL.urls); await atURL.host.dispose();
  const signal = new AbortController(); signal.abort(); const pre = await fixture();
  await assert.rejects(pre.host.request(pre.getShot(), {signal: signal.signal}), error => error.code === 'studio_v3_shot_preview_aborted'); assert.equal(pre.instances.length, 0); await pre.host.dispose();
});

test('resource, render and JPEG failures reject visibly without fake imagery or cache entries', async () => {
  for (const mode of ['status', 'source', 'entity', 'render', 'png', 'empty', 'oversize']) {
    const f = await fixture({sync(instance) {
      if (mode === 'status') instance.args.onStatus({kind: 'source', status: 'failed', error: 'Decode failed'});
      return {source: {status: mode === 'source' ? 'failed' : 'ready'}, entities: mode === 'entity' ? [{status: 'failed'}] : []};
    }, photo() {if (mode === 'render') throw new Error('GPU failed'); return {width: mode === 'oversize' ? 4096 : 320, height: 180, quality: .92, blob: new Blob(mode === 'empty' ? [] : ['image'], {type: mode === 'png' ? 'image/png' : 'image/jpeg'})};}});
    await assert.rejects(f.host.request(f.getShot())); assert.equal(f.instances[0].disposeCount, 1, mode); assert.equal(f.host.cacheSize, 0, mode); assert.equal(f.urls.length, 0, mode); await f.host.dispose();
  }
});

test('dispose aborts active and queued work, clears cache and revokes retained URL leases', async () => {
  const f = await fixture(); const held = await f.host.request(f.getShot()); const blocker = deferred(), started = deferred();
  const active = await fixture({async sync() {started.resolve(); await blocker.promise; return {source: {status: 'ready'}, entities: []};}});
  const first = active.host.request(active.getShot()), firstRejected = assert.rejects(first); await started.promise;
  const second = active.host.request(active.getShot()), secondRejected = assert.rejects(second); await active.host.dispose(); await Promise.all([firstRejected, secondRejected]); blocker.resolve();
  assert.equal(active.instances.length, 1); assert.equal(active.instances[0].disposeCount, 1); assert.equal(await active.host.dispose(), false);
  await f.host.dispose(); assert.equal(f.host.cacheSize, 0); assert.equal(f.host.cacheBytes, 0); assert.deepEqual(f.revoked, [held.url]);
  await assert.rejects(f.host.request(f.getShot()), error => error.code === 'studio_v3_shot_preview_disposed');
});
