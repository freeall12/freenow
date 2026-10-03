import { metadata, nextDocument, nextTemplateImport, ordered, readSlice, validatePath } from './model.mjs';
import {verifyStoredTemplateSource} from '../agent-apps/template-source.mjs';

// Same namespace as the current canvas, shared across its conversations. No OS paths.
export function createStore({ namespace = 'tapnow-canvas-replica', indexedDB = globalThis.indexedDB } = {}) {
  let database;
  const listeners = new Set();
  const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(namespace + '-artifacts');
  const notify = file => { for (const listener of listeners) { try { listener(file); } catch (error) { console.error(error); } } };
  if (channel) channel.onmessage = () => notify();
  function connect() {
    if (!database) database = new Promise((resolve, reject) => {
      const request = indexedDB.open(namespace + '-artifacts', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('documents');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(Error('产物数据库被其他窗口占用'));
    }).catch(error => { database = null; throw error; });
    return database;
  }
  async function transaction(mode, update) {
    const db = await connect();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('documents', mode), store = tx.objectStore('documents');
      const request = store.get('canvas');
      let result, failure;
      request.onsuccess = () => {
        try {
          const document = request.result || { revision: 0, files: [] };
          result = update ? update(document) : document;
          if (update) store.put(result, 'canvas');
        } catch (error) { failure = error; tx.abort(); }
      };
      tx.oncomplete = () => resolve(result);
      tx.onerror = tx.onabort = () => reject(failure || tx.error || Error('产物保存中断'));
    });
  }
  const api = {
    namespace,
    async list() { return ordered((await transaction('readonly')).files).map(metadata); },
    async get(path) {
      validatePath(path);
      const file = (await transaction('readonly')).files.find(item => item.artifact_path === path);
      if (!file) throw Error('产物不存在');
      return verifyStoredTemplateSource(file);
    },
    async read({ artifact_path, offset, limit }) { return readSlice(await api.get(artifact_path), offset, limit); },
    async write(input) {
      // Revision check and write share one IndexedDB transaction, including across tabs.
      const document = await transaction('readwrite', current => nextDocument(current, input));
      const file = document.files.find(item => item.artifact_path === input.artifact_path);
      notify(metadata(file)); channel?.postMessage({ changed: true });
      return metadata(file);
    },
    async importTemplate(input,{guard=()=>true}={}) {
      const document=await transaction('readwrite',current=>{
        if(guard()===false)throw Error('模板导入来源已切换');
        const next=nextTemplateImport(current,input);
        if(guard()===false)throw Error('模板导入保存前来源已切换');
        return next;
      });
      const source=document.files.find(file=>file.artifact_path===input.source_path),artifact=document.files.find(file=>file.artifact_path===input.artifact_path);
      notify(metadata(artifact));channel?.postMessage({changed:true});
      return {source:metadata(source),artifact:metadata(artifact)};
    },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  };
  return api;
}
