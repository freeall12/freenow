'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const {EventEmitter} = require('node:events');

const settle = async () => {for (let i = 0; i < 4; i++) await new Promise(setImmediate);};
const event = () => ({defaultPrevented: false, preventDefault() {this.defaultPrevented = true;}});

async function boot({loadFails = false, renderer = {}, lifecycleSaved = false, backendExitCode = 0, backendExitGate, probeFails = false, navigateBeforeFailure = false} = {}) {
  const observations = {quit: false, reloads: 0, dialogs: [], errors: [], shutdowns: 0};
  const lifecycle = await import('../src/features/desktop/lifecycle.mjs');
  const document = {querySelector: () => null, body: {inert: false}};
  renderer.document = document;
  if (lifecycleSaved) Object.assign(renderer, {
    CanvasApp: {...renderer.CanvasApp, saveProject: async () => {}, getState: () => ({nodes: []})},
    CanvasStore: {flush: async () => {}}, CanvasProjects: {prepareNavigation: async () => {}}, AgentUI: {close: async () => true},
  });
  const app = new EventEmitter(), backend = new EventEmitter();
  let owner, menu;
  Object.assign(app, {
    isPackaged: false, setName() {}, setPath() {}, getPath: () => '/tmp/freenow-startup-contract',
    requestSingleInstanceLock: () => true, whenReady: () => Promise.resolve(),
    quit() {const before = event(); this.emit('before-quit', before); if (!before.defaultPrevented) observations.quit = true;},
  });
  Object.assign(backend, {
    stdout: new EventEmitter(), stderr: new EventEmitter(),
    postMessage(message) {assert.equal(message.type, 'freenow-shutdown'); observations.shutdowns++; Promise.resolve(backendExitGate).then(() => backend.emit('exit', backendExitCode));},
    kill() {throw Error('The startup close contract must not force-kill the backend');},
  });
  class BrowserWindow extends EventEmitter {
    constructor() {
      super(); owner = this; this.destroyed = false;
      this.webContents = new EventEmitter();
      Object.assign(this.webContents, {
        setWindowOpenHandler() {}, reload: () => {observations.reloads++;},
        executeJavaScript: async source => {
          if (source.includes('prepareDesktopClose')) {
            if (!lifecycleSaved) throw Error('Fixture lifecycle unavailable or persistence rejected');
          }
          if (probeFails && source.includes('Boolean(')) throw Error('Fixture renderer probe rejected');
          // Evaluate the real host probe instead of returning a mirrored boolean.
          // Only module resolution is substituted; real lifecycle calls keep
          // the renderer's frozen state through the actual host continuation.
          const executable = source.replace("import('/src/features/desktop/lifecycle.mjs')", 'Promise.resolve(desktopLifecycle)');
          const desktopLifecycle = {...lifecycle, resumeDesktopPage: target => lifecycle.resumeDesktopPage(target || renderer)};
          return vm.runInNewContext(executable, {...renderer, window: renderer, document, desktopLifecycle});
        },
      });
    }
    isDestroyed() {return this.destroyed;}
    isMinimized() {return false;}
    focus() {}
    show() {}
    restore() {}
    async loadURL(url) {if (navigateBeforeFailure) this.webContents.emit('did-navigate', {}, url); if (loadFails) throw Error('Fixture first navigation failed'); this.webContents.emit('did-finish-load');}
    close() {
      const closing = event(); this.emit('close', closing);
      if (!closing.defaultPrevented) {this.destroyed = true; this.emit('closed'); app.emit('window-all-closed');}
    }
  }
  const electron = {
    app, BrowserWindow,
    Menu: {buildFromTemplate: value => value, setApplicationMenu: value => {menu = value;}},
    dialog: {
      showErrorBox: (_title, message) => {observations.errors.push(message);},
      showMessageBox: async (...args) => {observations.dialogs.push(args.at(-1)); return {response: 0};},
      showMessageBoxSync: () => 0,
    },
    session: {fromPartition: () => ({webRequest: {onBeforeRequest() {}}, setPermissionRequestHandler() {}})},
    shell: {openPath: async () => ''},
    utilityProcess: {fork: () => {queueMicrotask(() => backend.emit('message', {type: 'freenow-ready', port: 4183})); return backend;}},
  };
  const directory = path.resolve(__dirname, '../desktop');
  const fsPromises = {mkdir: async () => {}, writeFile: async () => {}, lstat: async () => ({isFile: () => true, isSymbolicLink: () => false, size: 0}), readFile: async () => ''};
  const context = {
    __dirname: directory, process, console, setTimeout, clearTimeout,
    require: name => name === 'electron' ? electron : name === 'node:fs/promises' ? fsPromises : name.startsWith('./') ? require(path.join(directory, name)) : require(name),
  };
  vm.runInNewContext(fs.readFileSync(path.join(directory, 'main.cjs'), 'utf8'), context, {filename: 'desktop/main.cjs'});
  await settle();
  assert.ok(owner, 'The real main process created its window');
  return {app, owner, observations, document, reload: () => menu.find(item => item.label === '视图').submenu.find(item => item.label === '重新加载').click()};
}

test('a first navigation failure with no editing instance can retry and Quit normally', async () => {
  const {app, owner, observations, reload} = await boot({loadFails: true});
  assert.ok(observations.errors.length, 'Initial navigation failure was reported');
  await reload(); await settle();
  assert.equal(observations.reloads, 1); assert.equal(owner.isDestroyed(), false);
  app.quit(); await settle();
  assert.equal(owner.isDestroyed(), true); assert.equal(observations.shutdowns, 1); assert.equal(observations.quit, true);
});

test('an existing CanvasApp with rejected lifecycle persistence remains open on reload and Quit', async () => {
  const {app, owner, observations, reload} = await boot({renderer: {CanvasApp: {}}});
  await reload(); await settle(); app.quit(); await settle();
  assert.equal(observations.reloads, 0); assert.equal(owner.isDestroyed(), false);
  assert.equal(observations.shutdowns, 0); assert.equal(observations.quit, false);
  assert.ok(observations.dialogs.length >= 2);
});

test('a loaded page missing the core still preserves an existing scene editing instance', async () => {
  const {app, owner, observations, reload} = await boot({renderer: {StudioAPI: {active: {nodeId: 'scene-1'}}}});
  await reload(); await settle(); app.quit(); await settle();
  assert.equal(observations.reloads, 0); assert.equal(owner.isDestroyed(), false);
  assert.equal(observations.shutdowns, 0); assert.equal(observations.quit, false);
  assert.ok(observations.dialogs.length >= 2);
});

test('an unconfirmed backend persistence exit does not silently destroy the saved canvas window', async () => {
  let releaseBackend;
  const backendExitGate = new Promise(resolve => {releaseBackend = resolve;});
  const {app, owner, observations, document} = await boot({renderer: {CanvasApp: {}}, lifecycleSaved: true, backendExitCode: 1, backendExitGate});
  try {
    app.quit(); await settle();
    assert.equal(observations.shutdowns, 1); assert.equal(document.body.inert, true);
    const blockedInput = event(); owner.webContents.emit('before-input-event', blockedInput, {type: 'keyDown', key: 'x'});
    assert.equal(blockedInput.defaultPrevented, true);
  } finally {releaseBackend(); await settle();}
  assert.equal(observations.shutdowns, 1); assert.equal(owner.isDestroyed(), false);
  assert.equal(observations.quit, false); assert.equal(document.body.inert, false);
  const resumedInput = event(); owner.webContents.emit('before-input-event', resumedInput, {type: 'keyDown', key: 'x'});
  assert.equal(resumedInput.defaultPrevented, false);
  assert.ok(observations.dialogs.length, 'The unconfirmed backend shutdown requires an explicit user decision');
});

test('a rejected probe after first navigation failure can Quit when no main frame was delivered', async () => {
  const {app, owner, observations} = await boot({loadFails: true, probeFails: true});
  app.quit(); await settle();
  assert.equal(owner.isDestroyed(), true); assert.equal(observations.shutdowns, 1); assert.equal(observations.quit, true);
});

test('a rejected probe after did-navigate delivery preserves the page despite loadURL failure', async () => {
  const {app, owner, observations, reload} = await boot({loadFails: true, probeFails: true, navigateBeforeFailure: true});
  await reload(); await settle(); app.quit(); await settle();
  assert.equal(observations.reloads, 0); assert.equal(owner.isDestroyed(), false);
  assert.equal(observations.shutdowns, 0); assert.equal(observations.quit, false);
  assert.ok(observations.dialogs.length >= 2);
});
