const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const navigation = require('../canvas-navigation.js');
const source = fs.readFileSync(require.resolve('../app.js'), 'utf8');
const wheel = source.slice(source.indexOf("  canvas.addEventListener('wheel'"), source.indexOf("  canvas.addEventListener('pointerdown'"));
const closeMenu = source.slice(source.indexOf('  function closeMenu('), source.indexOf('  function menu('));
function fixture(mac = true, open = false) {
  let handler, bounds = {left: 0, top: 0}, reads = 0, hidden = !open, writes = 0, cancelled = 0, prevented = 0;
  const menu = {get hidden() {return hidden;}, set hidden(value) {hidden = value; writes++;}};
  const context = vm.createContext({
    view: {x: -36140.125, y: -730.375, scale: .7},
    canvas: {addEventListener(type, fn, options) {assert.equal(type, 'wheel'); assert.equal(options.passive, false); handler = fn;}, getBoundingClientRect() {reads++; return bounds;}},
    $: selector => {assert.equal(selector, '#menu'); return menu;},
    window: {CanvasNavigation: navigation}, navigator: {userAgent: mac ? 'Mac' : 'Windows'},
    cancelViewportAnimation() {cancelled++;}, scheduleRender(viewportOnly) {assert.equal(viewportOnly, true);},
  });
  vm.runInContext(closeMenu + wheel, context);
  return {send(delta) {handler({clientX: 320.25, clientY: 200.75, deltaX: .125, deltaY: .25, deltaMode: 0, ...delta, preventDefault() {prevented++;}});},
    bounds(value) {bounds = value;}, state: () => structuredClone(context.view), metrics: () => ({reads, writes, hidden, cancelled, prevented})};
}
test('pan retains exact per-event arithmetic without layout reads or redundant hidden writes', () => {
  for (const mac of [true, false]) for (const deltaMode of [0, 1, 2]) for (const shiftKey of [true, false]) {
    const f = fixture(mac); let expected = f.state();
    for (let i = 0; i < 120; i++) {const delta = {deltaMode, shiftKey, deltaX: .125, deltaY: .25}; expected = navigation.wheel(expected, delta, undefined, mac); f.send(delta);}
    assert.deepEqual(f.state(), expected); assert.deepEqual(f.metrics(), {reads: 0, writes: 0, hidden: true, cancelled: 120, prevented: 120});
  }
});
test('pinch reads current canvas bounds after each layout shift and closes an open menu only once', () => {
  for (const mac of [true, false]) {
    const f = fixture(mac, true); let expected = f.state();
    for (let i = 0; i < 120; i++) {
      const rect = {left: 17.25 + i / 8, top: 11.75 - i / 16}; f.bounds(rect);
      const delta = {ctrlKey: true, deltaMode: i % 3, deltaY: i % 2 ? -2.5 : 5};
      expected = navigation.wheel(expected, delta, {x: 320.25 - rect.left, y: 200.75 - rect.top}, mac); f.send(delta);
    }
    assert.deepEqual(f.state(), expected); assert.deepEqual(f.metrics(), {reads: 120, writes: 1, hidden: true, cancelled: 120, prevented: 120});
  }
});
