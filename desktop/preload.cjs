'use strict';
const {contextBridge, ipcRenderer} = require('electron');
// No path/root/owner authority is exposed. Only the main process can select a
// directory and authorize a commit after the native batch confirmation.
if (location.origin === 'http://127.0.0.1:4183' && window === window.top) {
  contextBridge.exposeInMainWorld('FreenowDesktopFiles', Object.freeze({
    invoke(method, args, requestId) {return ipcRenderer.invoke('freenow:desktop-files', {method, args, ...(requestId ? {requestId} : {})});},
    cancel(requestId) {return ipcRenderer.invoke('freenow:desktop-files', {method: 'cancel-request', requestId});},
  }));
  const listen = (channel, callback) => {const listener = (_event, value) => callback(value); ipcRenderer.on(channel, listener); return () => ipcRenderer.removeListener(channel, listener);};
  contextBridge.exposeInMainWorld('FreenowExternalAgent', Object.freeze({
    invoke(method, args = {}) {return ipcRenderer.invoke('freenow:external-agent', {method, args});},
    onRequest(callback) {return listen('freenow:external-agent:request', callback);},
    onOpen(callback) {return listen('freenow:external-agent:open', callback);},
  }));
}
