'use strict';
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const {isLocalNavigation} = require('./runtime-config.cjs');
const channel = 'freenow:external-agent', requestChannel = channel + ':request', changedChannel = channel + ':changed', openChannel = channel + ':open';
function createExternalAgentBridge({ipcMain, dialog, getWindow, isAvailable = () => true, directory, runtimeRoot, executable}) {
  const {createBroker} = require(path.join(runtimeRoot, 'server/external-agent/broker.cjs'));
  const {binding, keys, fault, id} = require(path.join(runtimeRoot, 'server/external-agent/contracts.cjs'));
  const {safeCode} = require(path.join(runtimeRoot, 'server/external-agent/protocol.cjs'));
  let page, epoch = 0, confirming = false, closed = false;
  const pending = new Map();
  function windowFor(event) {
    const window = getWindow();
    if (closed || !window || window.isDestroyed() || !isAvailable() || !isLocalNavigation(window.webContents.mainFrame?.url)) throw fault('workspace_unavailable');
    if (event && (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame)) throw fault('workspace_unavailable');
    return window;
  }
  function workspace() {
    const window = windowFor();
    if (!page || page.windowId !== window.id || page.frame !== window.webContents.mainFrame) throw fault('workspace_unavailable');
    const project = new URL(page.frame.url).searchParams.get('project') || 'canvas';
    if (project !== page.binding.projectId) throw fault('workspace_changed');
    return {...page.binding};
  }
  function dispatch({name, args, binding: scope, signal}) {
    const window = windowFor(), current = workspace();
    if (current.pageId !== scope.pageId || current.projectId !== scope.projectId || signal?.aborted) return Promise.reject(fault('workspace_changed'));
    const requestId = randomUUID(), frame = window.webContents.mainFrame, capturedEpoch = epoch;
    return new Promise((resolve, reject) => {
      const abort = () => finish(fault('cancelled'));
      const timer = setTimeout(() => finish(fault('host_unavailable')), 8000);
      function finish(error, result) {clearTimeout(timer); signal?.removeEventListener('abort', abort); pending.delete(requestId); if (error) reject(error); else resolve(result);}
      pending.set(requestId, {scope, frame, epoch: capturedEpoch, resolve: result => finish(null, result), reject: finish});
      signal?.addEventListener('abort', abort, {once: true});
      try {window.webContents.send(requestChannel, {requestId, name, args, binding: scope});} catch {finish(fault('host_unavailable'));}
    });
  }
  const broker = createBroker({directory, getWorkspace: workspace, dispatch, changed() {try {windowFor().webContents.send(changedChannel);} catch {}}});
  function invalidate() {
    epoch++; page = null; broker.invalidate();
    for (const request of pending.values()) request.reject(fault('workspace_changed'));
  }
  ipcMain.handle(channel, async (event, input) => {
    try {
      const window = windowFor(event);
      if (!keys(input, ['method', 'args']) || typeof input.method !== 'string') throw fault('invalid_arguments');
      const args = input.args || {};
      if (input.method === 'register') {
        const scope = binding(args), projectId = new URL(event.senderFrame.url).searchParams.get('project') || 'canvas';
        if (scope.projectId !== projectId) throw fault('workspace_changed');
        if (page && (page.binding.pageId !== scope.pageId || page.windowId !== window.id || page.frame !== event.senderFrame)) invalidate();
        page = {binding: scope, windowId: window.id, frame: event.senderFrame};
        return {registered: true};
      }
      if (input.method === 'unregister') {
        if (!keys(args, ['pageId']) || !id(args.pageId)) throw fault('invalid_arguments');
        if (page?.binding.pageId === args.pageId) invalidate();
        return {registered: false};
      }
      if (input.method === 'reply') {
        if (!keys(args, ['requestId', 'result', 'error']) || !id(args.requestId) || Object.hasOwn(args, 'result') === Object.hasOwn(args, 'error')) throw fault('invalid_arguments');
        const request = pending.get(args.requestId);
        if (!request) return {accepted: false};
        const current = workspace();
        if (request.frame !== event.senderFrame || request.epoch !== epoch || current.pageId !== request.scope.pageId || current.projectId !== request.scope.projectId) {request.reject(fault('workspace_changed')); return {accepted: false};}
        if (args.error) request.reject(fault(safeCode(args.error))); else request.resolve(args.result);
        return {accepted: true};
      }
      if (input.method === 'status') {
        if (!keys(args, [])) throw fault('invalid_arguments');
        let current; try {current = workspace();} catch {}
        return {available: !!current, project: current ? {id: current.projectId, title: current.title} : null, clients: broker.list(), config: {mcpServers: {freenow: {command: executable, args: [path.join(runtimeRoot, 'server/external-agent/stdio.cjs'), '--socket', broker.socketPath], env: {ELECTRON_RUN_AS_NODE: '1'}}}}};
      }
      if (!['approve', 'revoke'].includes(input.method) || !keys(args, ['connectionId']) || !id(args.connectionId)) throw fault('invalid_arguments');
      if (input.method === 'revoke') {epoch++; return {revoked: broker.revoke(args.connectionId)};}
      if (confirming) throw fault('rate_limited');
      const current = workspace(), client = broker.list().find(item => item.id === args.connectionId), approvalEpoch = epoch;
      if (!client) throw fault('transport_closed');
      confirming = true;
      try {
        const result = await dialog.showMessageBox(window, {type: 'question', buttons: ['取消', '允许读取当前画布'], defaultId: 0, cancelId: 0, message: '允许此外部 Agent 读取当前画布的节点概要？', detail: `客户端自报名称：${client.client.name}（未经身份验证）\n当前画布：${current.title}\n\n允许读取节点名称、类型、位置、数量和选择状态，有效期一小时。客户端可能将这些内容发给自己的模型。\n不允许读取正文、提示词、媒体、会话或系统文件；不允许修改、生成或使用模型接口凭据。关闭、重新加载、切换画布或撤销后失效。`});
        if (result.response !== 1) return {authorized: false, cancelled: true};
        windowFor(event); if (epoch !== approvalEpoch) throw fault('workspace_changed');
        return broker.approve(args.connectionId, current);
      } finally {confirming = false;}
    } catch (error) {return {error: {code: safeCode(error)}};}
  });
  return {
    start: () => broker.start(), invalidate,
    openPanel() {try {windowFor().webContents.send(openChannel);} catch {}},
    async close({keepHandler = false} = {}) {
      if (closed) {if (!keepHandler) ipcMain.removeHandler(channel); return;}
      // pagehide can enqueue unregister after shutdown begins. Keep only this
      // closed, unconditional rejection path until the desktop process exits.
      closed = true; invalidate(); if (!keepHandler) ipcMain.removeHandler(channel); await broker.close();
    },
    get socketPath() {return broker.socketPath;},
  };
}
module.exports = {createExternalAgentBridge, channel, requestChannel, changedChannel, openChannel};
