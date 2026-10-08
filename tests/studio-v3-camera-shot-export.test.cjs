const test = require('node:test'), assert = require('node:assert/strict');
const modules = Promise.all([import('../src/features/studio-v3/schema.mjs'), import('../src/features/studio-v3/world-space.mjs'), import('../src/features/studio-v3/camera-shots.mjs'), import('../src/features/studio-v3/camera-shot-export.mjs'), import('../src/features/studio-v3/webm-encoder.mjs'), import('three')]);
async function fixture({dynamic = false, linked = true, runtimeOptions = {}, exporterOptions = {}} = {}) {
  const [schema, world, {listCameraShots}, {createCameraShotExporter}, , THREE] = await modules;
  let state = schema.createState({worldNodeId: 'export-owner', now: 1}); const setupId = state.scenePlay.worldSpace.activeSetupId;
  const camera = {position: {x: 0, y: 2, z: 5}, rotation: {x: 0, y: 0, z: 0, order: 'YXZ'}, fov: 45, focalLength: 24, frameAspectRatio: 4 / 3, apertureFNumber: 11, depthOfFieldMode: 'deepFocus', focusDistance: 10};
  const entity = schema.createEntity({id: 'camera', kind: 'camera', label: 'Local shot', now: 1}), local = schema.createSetupState('camera', 1); local.camera = camera;
  state = world.addEntity(state, entity, {setupId, setupState: local});
  if (dynamic) state.scenePlay.worldSpace.setups.find(item => item.id === setupId).temporal = {durationMs: 100, tracks: [{id: 'track', owner: {kind: 'entity', entityId: 'camera'}, keys: [{id: 'a', timeMs: 0}, {id: 'b', timeMs: 100}], channels: [{id: 'position', property: 'entity.transform.position', values: [{keyId: 'a', value: {kind: 'vec3', value: {x: 0, y: 2, z: 5}}, interpolation: 'linear'}, {keyId: 'b', value: {kind: 'vec3', value: {x: 3, y: 2, z: 5}}, interpolation: 'linear'}]}]}]};
  if (!linked) state = world.addView(state, schema.createView({id: 'unlinked', label: 'Detached still', camera, tags: ['shot'], now: 1}));
  const shot = listCameraShots(state).find(item => linked ? item.cameraEntityId : item.id === 'unlinked'), original = structuredClone(state), canvases = [], captures = [], samples = [], events = [];
  let disposals = 0, fence = 'one', sources = 0, stateReads = 0, construction;
  class Canvas {
    constructor() {this.calls = []; this.context = {save() {}, restore() {}, beginPath() {}, rect() {}, clip() {}, fillRect() {}, drawImage: (...args) => this.calls.push(args)}; canvases.push(this);}
    getContext() {return this.context;}
    toBlob(callback, type, quality) {this.encoded = {type, quality}; callback(new Blob(['fixture-image-bytes'], {type}));}
  }
  const canvasFactory = () => new Canvas();
  const exporter = createCameraShotExporter({getState: () => {stateReads++; return state;}, getFence: () => ({token: fence}), getSourceResource: () => {sources++; return {url: '/local.glb', format: 'glb'};}, onProgress: info => events.push(info), canvasFactory,
    runtimeFactory(options) {construction = options; let current = state; const optical = new THREE.PerspectiveCamera(45, 4 / 3, .1, 1000); return {
      graph: {tick() {}}, entityCamera: () => linked ? optical : null,
      depthOfFieldSupported: runtimeOptions.depthOfFieldSupported,
      async sync(value) {current = value; samples.push(value); optical.position.copy(current.scenePlay.worldSpace.setups.find(item => item.id === setupId).entityStates.find(item => item.entityId === 'camera').camera.position); return runtimeOptions.syncReport;},
      async renderPhoto(camera, options) {captures.push({camera, options}); await runtimeOptions.renderPhoto?.(); const canvas = new Canvas(); canvas.width = options.longEdge; canvas.height = Math.round(options.longEdge / camera.aspect); return {canvas, width: canvas.width, height: canvas.height};},
      async dispose() {disposals++;}};}, ...exporterOptions});
  return {exporter, shot, state, original, canvases, captures, samples, events, Canvas, canvasFactory, get construction() {return construction;}, get disposals() {return disposals;}, get sources() {return sources;}, get stateReads() {return stateReads;}, stale() {fence = 'two';}};
}

test('static shot uses detached photographic runtime and native-size optical frame then cover crops JPEG 4096x2304 .92', async () => {
  const t = await fixture(); const [result] = await t.exporter.render(t.shot);
  assert.equal(result.type, 'image'); assert.equal(result.blob.type, 'image/jpeg'); assert.equal(result.width, 4096); assert.equal(result.height, 2304);
  assert.equal(t.construction.autoRender, false); assert.equal(t.captures[0].options.encode, false); assert.equal(t.captures[0].options.longEdge, 4096); assert.equal(t.captures[0].options.frameAspectRatio, undefined);
  const output = t.canvases.find(canvas => canvas.encoded); assert.deepEqual(output.encoded, {type: 'image/jpeg', quality: .92}); assert.equal(output.calls[0][3] / output.calls[0][4], 4 / 3, 'cover retains source pixel ratio');
  assert.equal(t.disposals, 1); assert.equal(t.sources, 1); assert.equal(t.stateReads, 1); assert.deepEqual(t.state, t.original); assert.equal(result.provenance.exportKind, 'still'); assert.equal(t.events.at(-1).phase, 'completed');
});

test('static unlinked view uses its frozen optical camera and preview snapshot without strict dynamic camera sampling', async () => {
  const t = await fixture({linked: false}); const [result] = await t.exporter.render(t.shot); assert.equal(result.type, 'image'); assert.equal(result.provenance.cameraEntityId, null); assert.equal(t.captures.length, 1); assert.equal(t.disposals, 1); assert.deepEqual(t.state, t.original);
});

test('dynamic export samples canonical temporal states and returns only real encoder output plus first-frame poster', async () => {
  const times = []; const t = await fixture({dynamic: true, exporterOptions: {async encodeVideo(options) {
    assert.equal(options.width, 1280); assert.equal(options.height, 720); assert.equal(options.fps, 30);
    for (const time of [0, 1000 / 30, 2000 / 30]) {times.push(time); const canvas = await options.drawFrame(time); assert.equal(canvas.width, 1280); assert.equal(canvas.height, 720);}
    return {blob: new Blob(['fixture-native-encoder-result'], {type: 'video/webm;codecs=vp9'}), width: 1280, height: 720, fps: 30, durationMs: 100, frameCount: 3, codec: 'vp9'};
  }}});
  const [result] = await t.exporter.render(t.shot, {state: t.state}); assert.equal(t.stateReads, 0, 'batch snapshot skips live state reread'); assert.equal(result.type, 'video'); assert.equal(result.duration, .1); assert.equal(result.posterBlob.type, 'image/jpeg'); assert.equal(result.provenance.fps, 30);
  assert.deepEqual(t.samples.map(state => state.scenePlay.worldSpace.setups.find(item => item.id === t.shot.setupId).entityStates.find(item => item.entityId === 'camera').camera.position.x), [0, .99, 2.0100000000000002]);
  assert.equal(t.disposals, 1); assert.deepEqual(t.state, t.original); assert.equal(times.length, 3);
});

test('only explicit unsupported codec falls back to six endpoint-inclusive contact frames; GPU/encode failures propagate', async () => {
  const [, , , , {ShotVideoUnsupportedError}] = await modules;
  const t = await fixture({dynamic: true, exporterOptions: {encodeVideo: async () => {throw new ShotVideoUnsupportedError('no codec');}}}); const [result] = await t.exporter.render(t.shot);
  assert.equal(result.type, 'image'); assert.equal(result.blob.type, 'image/webp'); assert.equal(result.provenance.exportKind, 'contact-sheet'); assert.deepEqual(result.provenance.sampleTimesMs, [0, 20, 40, 60, 80, 100]); assert.equal(t.captures.length, 6); assert.equal(t.disposals, 1);
  const failed = await fixture({dynamic: true, exporterOptions: {encodeVideo: async () => {throw Error('encoder runtime failure');}}}); await assert.rejects(failed.exporter.render(failed.shot), /encoder runtime failure/); assert.equal(failed.captures.length, 0); assert.equal(failed.disposals, 1);
});

test('abort and ownership changes suppress late output and release the independent renderer once', async () => {
  let release; const waiting = new Promise(resolve => {release = resolve;}), controller = new AbortController();
  const t = await fixture({runtimeOptions: {renderPhoto: () => waiting}}), pending = t.exporter.render(t.shot, {signal: controller.signal});
  while (!t.captures.length) await new Promise(resolve => setImmediate(resolve)); controller.abort(); release(); await assert.rejects(pending, error => error.name === 'AbortError'); assert.equal(t.disposals, 1); assert.equal(t.exporter.busy, false);
  const stale = await fixture({runtimeOptions: {renderPhoto: async () => {stale.stale();}}}); await assert.rejects(stale.exporter.render(stale.shot), error => error.code === 'studio_v3_shot_export_stale'); assert.equal(stale.disposals, 1); assert.equal(stale.exporter.busy, false);
});

test('busy export cannot create a second renderer, and disposal does not return an unfinished result', async () => {
  let release; const waiting = new Promise(resolve => {release = resolve;}), t = await fixture({runtimeOptions: {renderPhoto: () => waiting}}), pending = t.exporter.render(t.shot);
  while (!t.captures.length) await new Promise(resolve => setImmediate(resolve)); await assert.rejects(t.exporter.render(t.shot), error => error.code === 'studio_v3_shot_export_busy'); t.exporter.dispose(); release(); await assert.rejects(pending, error => error.code === 'studio_v3_shot_export_closed'); assert.equal(t.disposals, 1);
});

test('unsupported authored held relationships and ordinary GLB aperture DOF fail before a false image result', async () => {
  const held = await fixture(); held.state.scenePlay.worldSpace.setups.find(item => item.id === held.shot.setupId).entityStates[0].heldEntityId = 'camera';
  await assert.rejects(held.exporter.render(held.shot), error => error.code === 'studio_v3_shot_render_unsupported' && /持握/.test(error.message)); assert.equal(held.captures.length, 0); assert.equal(held.disposals, 1);
  const dof = await fixture(); dof.state.scenePlay.worldSpace.setups.find(item => item.id === dof.shot.setupId).entityStates[0].camera.depthOfFieldMode = 'aperture';
  await assert.rejects(dof.exporter.render(dof.shot), error => error.code === 'studio_v3_shot_render_unsupported' && /景深/.test(error.message)); assert.equal(dof.captures.length, 0); assert.equal(dof.disposals, 1);
  const supported = await fixture({runtimeOptions: {depthOfFieldSupported: true}}); supported.state.scenePlay.worldSpace.setups.find(item => item.id === supported.shot.setupId).entityStates[0].camera.depthOfFieldMode = 'aperture';
  const [result] = await supported.exporter.render(supported.shot); assert.equal(result.type, 'image');
});

test('failed model reports reject incomplete captures instead of publishing a missing scene', async () => {
  const t = await fixture({runtimeOptions: {syncReport: {entities: [{id: 'camera', status: 'failed', error: 'local model missing'}]}}});
  await assert.rejects(t.exporter.render(t.shot), error => error.code === 'studio_v3_shot_resource_failed'); assert.equal(t.captures.length, 0); assert.equal(t.disposals, 1);
});

function fakeNativeCodec({supported = true, configureError, failEncode} = {}) {
  const frames = [], configurations = [], closed = [];
  class Frame {constructor(canvas, options) {this.canvas = canvas; Object.assign(this, options); frames.push(this);} close() {this.closed = true;}}
  class Encoder {
    static async isConfigSupported(config) {return {supported, config};}
    constructor(callbacks) {this.callbacks = callbacks; this.state = 'unconfigured'; this.encodeQueueSize = 0;}
    configure(config) {if (configureError) throw configureError; configurations.push(config); this.state = 'configured';}
    encode(frame, options) {if (failEncode) {this.callbacks.error(Error('native encode failed')); return;} const data = Uint8Array.of(1, 2, 3); this.callbacks.output({type: options.keyFrame ? 'key' : 'delta', timestamp: frame.timestamp, duration: frame.duration, byteLength: data.length, copyTo: output => output.set(data)});}
    async flush() {} close() {this.state = 'closed'; closed.push(this);}
  }
  return {Encoder, Frame, frames, configurations, closed};
}

test('native frame encoder uses precise 30fps timestamps, closes VideoFrames and emits finite WebM EBML metadata', async () => {
  const [, , , , {encodeShotWebM}] = await modules, native = fakeNativeCodec(), progress = [];
  const result = await encodeShotWebM({...native, durationMs: 100, drawFrame: async () => ({width: 1280, height: 720}), onProgress: value => progress.push(value)});
  assert.deepEqual(native.frames.map(frame => frame.timestamp), [0, 33333, 66667]); assert.deepEqual(native.frames.map(frame => frame.duration), [33333, 33334, 33333]); assert(native.frames.every(frame => frame.closed)); assert.equal(native.closed.length, 1); assert.equal(result.frameCount, 3); assert.equal(result.blob.type, 'video/webm;codecs=vp9');
  const buffer = new Uint8Array(await result.blob.arrayBuffer()); assert.deepEqual([...buffer.slice(0, 4)], [0x1a, 0x45, 0xdf, 0xa3]); assert(Buffer.from(buffer).includes(Buffer.from('V_VP9'))); assert.equal(progress.at(-1).progress, 1);
  // Fixture packets only verify mux structure. Browser QA and ffprobe prove
  // native packets are actually decodable; these dummy bytes do not do that.
});

test('codec absence is explicit unsupported, supported configuration/runtime failures are errors with cleanup', async () => {
  const [, , , , {encodeShotWebM, ShotVideoUnsupportedError}] = await modules;
  await assert.rejects(encodeShotWebM({Encoder: null, Frame: null, durationMs: 100, drawFrame() {}}), ShotVideoUnsupportedError);
  const unsupported = fakeNativeCodec({supported: false}); await assert.rejects(encodeShotWebM({...unsupported, durationMs: 100, drawFrame() {}}), ShotVideoUnsupportedError); assert.equal(unsupported.closed.length, 0);
  const broken = fakeNativeCodec({configureError: Error('configuration failed')}); await assert.rejects(encodeShotWebM({...broken, durationMs: 100, drawFrame() {}}), /configuration failed/); assert.equal(broken.closed.length, 1);
  const encoding = fakeNativeCodec({failEncode: true}); await assert.rejects(encodeShotWebM({...encoding, durationMs: 100, drawFrame: () => ({width: 1280, height: 720})}), /native encode failed/); assert(encoding.frames.every(frame => frame.closed)); assert.equal(encoding.closed.length, 1);
});
