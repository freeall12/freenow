const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../image-relight-stage.mjs'), 'utf8');
const modules = Promise.all([import('three'), import('../image-relight-core.mjs'), import('../image-relight-shaders.mjs')]);

function baseline() {
  let script = source;
  const replace = (from, to) => {assert(script.includes(from), from); script = script.replace(from, to);};
  replace('const vec=(az,el,target=new T.Vector3())=>', 'const vec=(az,el)=>');
  replace('return target.set(', 'return new T.Vector3(');
  replace(",lineDimColor=new T.Color(0x444444)", '');
  replace(',lights=[[main,false],[rim,true]]', '');
  replace('of lights)', 'of [[main,false],[rim,true]])');
  replace('vec(obj.az,obj.el,obj.group.position);', 'obj.group.position.copy(vec(obj.az,obj.el));');
  replace('drag&&!selected?lineDimColor:color', 'drag&&!selected?new T.Color(0x444444):color');
  return script;
}

async function harness(previous = false) {
  const [THREE, core, shader] = await modules;
  const allocations = {vectors: 0, colors: 0, lightArrays: 0}, listeners = new Map(), callbacks = [], textures = [];
  let nextFrame, clock = 1000, renders = 0, scene, camera, removed = false, disposed = false;
  class Vector3 extends THREE.Vector3 {constructor(...args) {super(...args); allocations.vectors++;}}
  class Color extends THREE.Color {constructor(...args) {super(...args); allocations.colors++;}}
  const canvas = {style: {}, dataset: {}, setAttribute() {}, setPointerCapture() {}, focus() {}, remove() {removed = true;},
    getBoundingClientRect: () => ({left: 40, top: 70, width: 256, height: 256}),
    addEventListener(name, handler, options) {listeners.set(name, handler); options.signal.addEventListener('abort', () => listeners.delete(name));}};
  class Renderer {constructor() {this.domElement = canvas; this.shadowMap = {};}
    setSize() {} setPixelRatio() {} render(s, c) {renders++; scene = s; camera = c;} dispose() {disposed = true;}}
  class Loader {setCrossOrigin() {return this;} load(src, ready) {callbacks.push(ready);}}
  const mount = {append() {}}, events = [], context = vm.createContext({
    T: {...THREE, Vector3, Color, WebGLRenderer: Renderer, TextureLoader: Loader}, shader, ...core,
    document: {createElement() {return {getContext() {return {createRadialGradient() {return {addColorStop() {}};}, fillRect() {}};}};}},
    devicePixelRatio: 1.5, AbortController, performance: {now: () => clock++},
    requestAnimationFrame(fn) {nextFrame = fn; return 1;}, cancelAnimationFrame() {nextFrame = null;},
    allocateLightPairs(main, rim) {allocations.lightArrays += 3; return [[main, false], [rim, true]];},
  });
  // Count only the three explicit array literals at this allocation site.
  const script = (previous ? baseline() : source).replace('[[main,false],[rim,true]]', 'allocateLightPairs(main,rim)')
    .replace(/^import .*;\n/gm, '').replace('export function createStage', 'function createStage');
  vm.runInContext(script + '\nglobalThis.createStage=createStage;', context);
  let params = structuredClone(core.defaults), mode = 'perspective', stage;
  stage = context.createStage(mount, '/qa/source.png', (az, el) => {events.push(['angle', az, el]); params = core.setAngle(params, az, el); stage.update(params, mode);},
    preset => {events.push(['rim', preset]); params = {...params, rimPreset: preset}; stage.update(params, mode);}, target => events.push(['target', target]));
  stage.update(params, mode);
  const tick = () => {assert(nextFrame); const fn = nextFrame; nextFrame = null; fn();};
  const snapshot = () => {
    const value = input => input?.isColor || input?.isVector3 ? input.toArray() : input;
    return {camera: {position: camera.position.toArray(), quaternion: camera.quaternion.toArray()}, canvas: {...canvas.dataset},
      objects: scene.children.map(object => ({type: object.type, position: object.position.toArray(), quaternion: object.quaternion.toArray(), scale: object.scale.toArray(), visible: object.visible,
        children: object.children.map(child => ({position: child.position.toArray(), quaternion: child.quaternion.toArray(), scale: child.scale.toArray(), intensity: child.intensity, color: child.color?.toArray(),
          uniforms: child.material?.uniforms && Object.fromEntries(Object.entries(child.material.uniforms).map(([key, field]) => [key, value(field.value)]))})),
        color: object.material?.color?.toArray(), opacity: object.material?.opacity,
        uniforms: object.material?.uniforms && Object.fromEntries(Object.entries(object.material.uniforms).map(([key, field]) => [key, value(field.value)])),
        attributes: object.isLine ? Object.fromEntries(['position', 'color', 'opacityAttr'].map(key => [key, {array: Array.from(object.geometry.attributes[key].array), version: object.geometry.attributes[key].version}])) : undefined})),
    };
  };
  return {stage, allocations, events, tick, snapshot, reset() {for (const key of Object.keys(allocations)) allocations[key] = 0;},
    update(patch, view = mode) {params = {...params, ...patch}; mode = view; stage.update(params, mode);},
    event(name, extra = {}) {listeners.get(name)?.({button: 0, pointerId: 7, clientX: 42, clientY: 72, preventDefault() {}, stopPropagation() {}, ...extra});},
    load() {const texture = new THREE.Texture(); texture.image = {width: 640, height: 360}; texture.addEventListener('dispose', () => textures.push(texture)); callbacks.shift()(texture); return texture;},
    get renders() {return renders;}, get stopped() {return !nextFrame && removed && disposed && listeners.size === 0;}, textures};
}

test('60 production frames preserve lights, colors, grid buffers, dots, camera and time while removing target allocations', async t => {
  const before = await harness(true), after = await harness();
  before.load(); after.load(); before.reset(); after.reset();
  for (let frame = 0; frame < 60; frame++) {
    for (const f of [before, after]) {
      if (frame === 5) f.update({angle: {azimuthDeg: 315, elevationDeg: 45}, brightnessLevel: 100, temperatureK: 2000});
      if (frame === 10) {f.update({rimEnabled: false}, 'front'); f.event('pointerdown');}
      if (frame >= 10 && frame < 20) f.event('pointermove', {clientX: 42 + (frame - 9) * 7.125, clientY: 72 - (frame - 9) * 3.375});
      if (frame === 20) f.event('pointerup');
      if (frame === 30) {f.update({rimEnabled: true, brightnessLevel: 10, temperatureK: 8000, rimPreset: 'top_back_45'}, 'perspective'); f.event('keydown', {key: 'ArrowDown', shiftKey: true});}
      if (frame === 40) f.event('keydown', {key: 'ArrowLeft'});
      f.tick();
    }
    assert.deepEqual(after.snapshot(), before.snapshot());
    assert.deepEqual(after.events, before.events);
  }
  assert.deepEqual(before.allocations, {vectors: 120, colors: 110, lightArrays: 180});
  assert.deepEqual(after.allocations, {vectors: 0, colors: 0, lightArrays: 0});
  assert.equal(after.renders, 60); assert.equal(before.renders, 60);
  // cone time still advances on idle frames; only transient objects were removed.
  assert(after.snapshot().objects.at(-2).children[1].uniforms.time > 1.1);
  const projectBefore = before.stage.project(), projectAfter = after.stage.project();
  assert.equal(projectAfter.x, projectBefore.x); assert.equal(projectAfter.y, projectBefore.y);
  before.stage.dispose(); after.stage.dispose();
  assert(before.stopped && after.stopped); assert.equal(after.textures.length, 1);
  t.diagnostic('60 frames / 10 drag frames: Vector3 120→0; Color 110→0; explicit light tuple arrays 180→0. GPU rendering is outside this harness.');
});

test('each stage keeps independent geometry and late textures are disposed after teardown', async () => {
  const a = await harness(), b = await harness();
  a.update({angle: {azimuthDeg: 90, elevationDeg: -45}, temperatureK: 3000}); a.tick(); b.tick();
  const bSnapshot = b.snapshot();
  a.event('pointerdown'); a.event('pointermove', {clientX: 90, clientY: 110}); a.tick();
  assert.deepEqual(b.snapshot(), bSnapshot);
  assert.notDeepEqual(a.snapshot().objects.at(-2).position, bSnapshot.objects.at(-2).position);
  a.stage.dispose(); const texture = a.load();
  assert.equal(a.textures[0], texture); assert(a.stopped); assert.equal(a.renders, 2);
  b.stage.dispose(); assert(b.stopped);
});
