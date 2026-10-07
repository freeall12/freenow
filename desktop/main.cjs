'use strict';
const {app, BrowserWindow, Menu, dialog, session, shell, utilityProcess} = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {ORIGIN, PORT, PARTITION, serverEnvironment, isLocalNavigation, providerTemplate} = require('./runtime-config.cjs');

app.setName('freenow');
app.setPath('userData', path.join(app.getPath('appData'), 'freenow-desktop'));
let window, backend, stopping, quitAllowed = false, backendReady = false;
let windowCloseAllowed = false, transition;
let everEditable = false;
let pageCommitted = false, initialLoadFailed = false, closingInput = false;
const runtimeRoot = () => app.isPackaged ? path.join(process.resourcesPath, 'runtime') : path.resolve(__dirname, '../build/desktop/runtime');
const providerFile = () => path.join(app.getPath('userData'), 'providers.env');
const showError = message => dialog.showErrorBox('freenow', message);

async function startBackend() {
  const dataDirectory = app.getPath('userData');
  await fs.mkdir(dataDirectory, {recursive: true, mode: 0o700});
  try {await fs.writeFile(providerFile(), providerTemplate(await fs.readFile(path.join(runtimeRoot(), 'provider.env.example'), 'utf8')), {flag: 'wx', mode: 0o600});}
  catch (error) {if (error.code !== 'EEXIST') throw error;}
  const stat = await fs.lstat(providerFile());
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 256 * 1024) throw Error('接口配置必须是小于256KB的本地普通文件。');
  const text = await fs.readFile(providerFile(), 'utf8');
  const env = serverEnvironment({text, dataDirectory, temporaryDirectory: os.tmpdir()});
  backend = utilityProcess.fork(path.join(runtimeRoot(), 'server/server.cjs'), [], {cwd: runtimeRoot(), env, stdio: 'pipe', serviceName: 'freenow local backend'});
  // Do not forward supplier/configuration errors or request payloads to desktop
  // logs. Startup is confirmed by this child's IPC, never by probing an occupied port.
  backend.stdout?.on('data', () => {});
  backend.stderr?.on('data', () => {});
  const child = backend;
  child.on('exit', () => {
    if (backend !== child) return;
    backend = undefined;
    const wasReady = backendReady; backendReady = false;
    if (wasReady && !stopping) showError('本地后台已停止。画布已保留，请先保存或导出当前编辑，再退出重开；不要重复提交尚未确认的生成任务。');
  });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(Error('本地服务启动超时。请检查接口配置和数据目录权限。')), 20000);
    child.on('message', message => {
      if (message?.type === 'freenow-ready' && message.port === PORT) {clearTimeout(timeout); backendReady = true; resolve();}
    });
    child.once('exit', () => {clearTimeout(timeout); reject(Error(`本地服务未启动。请确认端口 ${PORT} 未被占用，以及数据目录可写。`));});
  });
}
async function stopBackend() {
  if (stopping) return stopping;
  if (!backend) return;
  stopping = new Promise((resolve, reject) => {
    const child = backend;
    let timeout, forced = false;
    const waitForPersistence = () => {timeout = setTimeout(async () => {
      const result = await dialog.showMessageBox({type: 'warning', buttons: ['继续等待', '强制退出'], defaultId: 0, cancelId: 0, message: '本地后台仍在关闭保存。强制退出可能使尚未确认的任务需要恢复，是否继续等待？'});
      if (backend !== child) return;
      if (result.response === 0) waitForPersistence(); else {forced = true; child.kill();}
    }, 10000);};
    waitForPersistence();
    child.once('exit', code => {
      clearTimeout(timeout);
      if (code === 0 || forced) resolve();
      else reject(Object.assign(Error('本地后台关闭未确认'), {code: 'desktop_shutdown_unconfirmed'}));
    });
    child.postMessage({type: 'freenow-shutdown'});
  });
  return stopping;
}
async function openProviderFile() {
  const result = await shell.openPath(providerFile());
  if (result) showError('无法打开接口配置。可从「打开数据目录」手动编辑 providers.env。');
}
async function prepareTransition(action, {closing = false} = {}) {
  if (transition || !window || window.isDestroyed()) return;
  const owner = window;
  closingInput = closing;
  transition = (async () => {
    try {
      // A failed first load has no editable page to flush. Presence of any
      // editor is sticky: partial initialization must never discard edits.
      let editable;
      try {
        editable = await owner.webContents.executeJavaScript("(() => {const editable = Boolean(window.CanvasApp || window.CanvasTextUI || window.AgentUI || window.StudioAPI?.active || window.CanvasImageEditor?.current || document.querySelector('.voice-control,.voice-recovery,#skill-manager .manager-form')); if (!editable && " + closing + " && document.body) document.body.inert = true; return editable;})()");
      } catch (error) {
        if (!initialLoadFailed || pageCommitted || everEditable) throw error;
        // The first main frame never committed, so no editor was delivered.
        editable = false;
      }
      if (editable !== false) everEditable = true;
      if (everEditable) {
        const saved = await owner.webContents.executeJavaScript("import('/src/features/desktop/lifecycle.mjs').then(module => module.prepareDesktopClose(window, {keepInputFrozen: " + closing + "}))");
        if (saved !== true) throw Error('保存尚未确认');
      }
      if (owner !== window) throw Error('页面已切换');
      await action(owner);
    } catch (error) {
      if (!owner.isDestroyed()) {
        if (closing) {
          await owner.webContents.executeJavaScript(everEditable ? "import('/src/features/desktop/lifecycle.mjs').then(module => module.resumeDesktopPage())" : "if (document.body) document.body.inert = false").catch(() => {});
        }
        if (error.code === 'desktop_shutdown_unconfirmed') {
          const result = await dialog.showMessageBox(owner, {type: 'warning', buttons: ['保留画布', '退出并在重启后恢复'], defaultId: 0, cancelId: 0, message: '本地后台关闭时未确认全部持久化。画布已保留；尚未确认的任务需在重启后查询原任务，不要重新提交。'});
          if (result.response === 1) {quitAllowed = true; destroySavedWindow(owner);}
        } else await dialog.showMessageBox(owner, {type: 'warning', buttons: ['继续编辑'], message: '保存尚未确认，画布已保留。请完成内嵌应用的交接或重试保存后再关闭。'});
      }
    } finally {transition = undefined; closingInput = false;}
  })();
  return transition;
}
function destroySavedWindow(owner) {
  windowCloseAllowed = true;
  try {owner.close();} finally {windowCloseAllowed = false;}
}
function createWindow() {
  everEditable = false;
  pageCommitted = false; initialLoadFailed = false;
  const localSession = session.fromPartition(PARTITION);
  // No remote top-level page or renderer network fallback. Configured provider
  // requests originate in the isolated Node service. Sandboxed local app frames
  // still need their production about:srcdoc/blob and local HTTP resources.
  localSession.webRequest.onBeforeRequest({urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*']}, (details, callback) => callback({cancel: !isLocalNavigation(details.url)}));
  localSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    if (permission !== 'media' || contents !== window?.webContents ||
        !isLocalNavigation(details.requestingUrl) || !details.mediaTypes?.length || details.mediaTypes.some(type => type !== 'audio')) return callback(false);
    dialog.showMessageBox(window, {type: 'question', buttons: ['允许麦克风', '取消'], defaultId: 1, cancelId: 1, message: '允许 freenow 使用麦克风进行语音输入？'}).then(result => callback(result.response === 0));
  });
  window = new BrowserWindow({width: 1440, height: 960, minWidth: 900, minHeight: 640, backgroundColor: '#161616', title: 'freenow', show: false, webPreferences: {
    partition: PARTITION, nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true,
  }});
  window.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
  window.webContents.on('did-navigate', (_event, url) => {if (isLocalNavigation(url)) pageCommitted = true;});
  window.webContents.on('will-navigate', (event, url) => {event.preventDefault(); if (isLocalNavigation(url)) void prepareTransition(owner => owner.loadURL(url));});
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.webContents.on('will-prevent-unload', event => {
    // Keep the original canvas open when it reports unfinished edits.
    const result = dialog.showMessageBoxSync(window, {type: 'warning', buttons: ['留在画布', '仍然关闭'], defaultId: 0, cancelId: 0, message: '画布仍有未确认的保存，继续关闭可能丢失修改。'});
    if (result === 1) event.preventDefault();
  });
  window.webContents.on('before-input-event', (event, input) => {
    if (closingInput) {event.preventDefault(); return;}
    if (input.type === 'keyDown' && (input.key === 'F5' || (input.control || input.meta) && input.key.toLowerCase() === 'r')) {
      event.preventDefault(); void prepareTransition(owner => owner.webContents.reload());
    }
  });
  window.on('close', event => {
    if (windowCloseAllowed) return;
    event.preventDefault();
    void prepareTransition(async owner => {await stopBackend(); destroySavedWindow(owner);}, {closing: true});
  });
  window.once('ready-to-show', () => window.show());
  window.on('closed', () => {window = undefined;});
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {label: 'freenow', submenu: [{role: 'about'}, {type: 'separator'}, {label: '模型接口配置…', click: openProviderFile}, {label: '打开数据目录', click: () => shell.openPath(app.getPath('userData'))}, {type: 'separator'}, {role: 'hide'}, {role: 'quit'}]},
    {role: 'editMenu'},
    {label: '视图', submenu: [{label: '重新加载', accelerator: 'CmdOrCtrl+R', click: () => prepareTransition(owner => owner.webContents.reload())}, {role: 'toggleDevTools'}, {role: 'resetZoom'}, {role: 'zoomIn'}, {role: 'zoomOut'}, {role: 'togglefullscreen'}]},
    {role: 'windowMenu'},
  ]));
  window.loadURL(ORIGIN).then(() => {pageCommitted = true;}).catch(() => {initialLoadFailed = true; showError('本地画布未能加载。请检查后台是否正常运行。');});
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {if (window?.isMinimized()) window.restore(); window?.focus();});
  app.whenReady().then(async () => {await startBackend(); createWindow();}).catch(async () => {showError(`freenow 启动失败。请检查端口 ${PORT}、providers.env 和数据目录；没有连接其他本地项目。`); await stopBackend().catch(() => showError('本地后台关闭未确认，请在下次启动查询原任务并检查数据目录。')); quitAllowed = true; app.quit();});
  app.on('activate', () => {if (backendReady && !window) createWindow();});
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', event => {
    if (quitAllowed) return;
    event.preventDefault();
    if (window && !window.isDestroyed()) {window.close(); return;}
    void stopBackend().then(() => {quitAllowed = true; app.quit();}).catch(() => showError('本地后台关闭未确认。请检查数据目录并重新退出；未知任务需要重启后查询原任务。'));
  });
}
