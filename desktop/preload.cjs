'use strict';
const {contextBridge, ipcRenderer} = require('electron');
// No path/root/owner authority is exposed. Only the main process can select a
// directory and authorize a commit after the native batch confirmation.
if (location.origin === 'http://127.0.0.1:4183' && window === window.top) {
  contextBridge.exposeInMainWorld('FreenowDesktopFiles', Object.freeze({
    invoke(method, args, requestId) {return ipcRenderer.invoke('freenow:desktop-files', {method, args, ...(requestId ? {requestId} : {})});},
    cancel(requestId) {return ipcRenderer.invoke('freenow:desktop-files', {method: 'cancel-request', requestId});},
  }));
}
