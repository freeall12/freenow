'use strict';
const {randomUUID} = require('node:crypto');
const fs = require('node:fs/promises');
const {isLocalNavigation} = require('./runtime-config.cjs');
const channel = 'freenow:desktop-files';
function createDesktopFilesBridge({ipcMain, dialog, getWindow, request, qaFolder}) {
  let owner, windowId, busy = false;
  const pending = new Map();
  const cancelled = entry => entry?.cancelled === true;
  function session() {
    const window = getWindow();
    if (!window || window.isDestroyed()) throw Error('桌面窗口不可用。');
    if (windowId !== window.id) {windowId = window.id; owner = randomUUID();}
    return {window, owner};
  }
  function sender(event) {
    const {window} = session();
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || !isLocalNavigation(event.senderFrame.url)) throw Error('文件权限只提供给本机主窗口。');
  }
  async function call(method, args) {const s = session(); return request({method, owner: s.owner, args});}
  async function authorize(entry) {
    if (busy) throw Error('文件批次正在确认或执行。');
    const s = session();
    const selected = await dialog.showOpenDialog(s.window, {title: '授权 Agent 整理一个文件夹', buttonLabel: '授权此文件夹', ...(qaFolder ? {defaultPath: qaFolder} : {}), properties: ['openDirectory', 'dontAddToRecent']});
    if (cancelled(entry) || selected.canceled || !selected.filePaths?.[0]) return {authorized: false, cancelled: true};
    if (qaFolder && await fs.realpath(selected.filePaths[0]) !== await fs.realpath(qaFolder)) throw Error('此验收入口只允许本次创建的临时 QA 文件夹。');
    if (cancelled(entry)) return {authorized: false, cancelled: true};
    if (getWindow() !== s.window || s.window.isDestroyed() || owner !== s.owner) throw Error('原桌面窗口已关闭，未授权。');
    if (entry) entry.started = true;
    return call('grant', {path: selected.filePaths[0]});
  }
  async function apply(args, entry) {
    if (busy) throw Error('文件批次正在确认或执行。');
    const s = session(); busy = true;
    try {
      if (cancelled(entry)) return {status: 'cancelled', error: '原 Agent 请求已停止，未执行。'};
      const plan = await call('read', args);
      if (plan.status !== 'prepared') return {...plan, replayed: true};
      const state = await call('status');
      const detail = plan.operations.map((a, i) => `${i + 1}. ${a.type === 'mkdir' ? '创建文件夹：' + a.path : (a.type === 'rename' ? '重命名：' : '移动：') + a.source + ' → ' + a.destination}`).join('\n');
      if (cancelled(entry)) return await call('cancel', args);
      const decision = await dialog.showMessageBox(s.window, {signal: entry?.controller.signal, type: 'question', buttons: ['取消', '确认执行整批操作'], defaultId: 0, cancelId: 0, noLink: true, message: `确认在「${state.name}」内执行 ${plan.operations.length} 项操作？`, detail: state.displayPath + '\n\n' + detail + '\n\n不会覆盖已有文件；失败时按相反顺序撤回本批更改。'});
      if (getWindow() !== s.window || s.window.isDestroyed() || owner !== s.owner) throw Error('原桌面窗口已关闭，未执行。');
      if (cancelled(entry) || decision.response !== 1) return await call('cancel', args);
      if (entry) entry.started = true;
      return await call('apply', args);
    } catch (error) {
      if (cancelled(entry)) return await call('cancel', args);
      throw error;
    } finally {busy = false;}
  }
  ipcMain.handle(channel, async (event, input) => {
    sender(event);
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !['method', 'args', 'requestId'].includes(k))) throw Error('文件请求格式无效。');
    if (input.method === 'cancel-request') {
      const entry = pending.get(input.requestId);
      if (!entry) return {cancelled: false, finishedOrUnknown: true};
      if (entry.started) return {cancelled: false, executionStarted: true};
      entry.cancelled = true; entry.controller.abort(); return {cancelled: true};
    }
    let entry;
    if (input.requestId !== undefined) {
      if (typeof input.requestId !== 'string' || !/^[a-f0-9-]{36}$/i.test(input.requestId) || pending.has(input.requestId)) throw Error('文件请求身份无效或重复。');
      entry = {cancelled: false, started: false, controller: new AbortController()}; pending.set(input.requestId, entry);
    }
    try {
    if (input.method === 'qa-location' && qaFolder) return {qaFolder};
    if (input.method === 'authorize') return await authorize(entry);
    if (input.method === 'apply') return await apply(input.args, entry);
    if (!['status', 'list', 'preview', 'read', 'recover', 'revoke'].includes(input.method)) throw Error('不支持该文件操作。');
    if (input.method === 'revoke' && busy) throw Error('文件批次正在确认或执行。');
    return await call(input.method, input.args);
    } finally {if (input.requestId) pending.delete(input.requestId);}
  });
  async function revoke() {if (owner) await request({method: 'revoke', owner}); owner = undefined; windowId = undefined;}
  return {authorize, revoke, status: () => call('status'), isBusy: () => busy};
}
module.exports = {createDesktopFilesBridge, channel};
