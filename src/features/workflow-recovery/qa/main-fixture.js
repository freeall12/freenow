(() => {
  'use strict';
  const params = new URLSearchParams(location.search), session = params.get('session') || 'manual';
  const namespace = 'qa-workflow-recovery:' + encodeURIComponent(session) + ':';
  if (!params.has('project')) {
    let hash = 2166136261;
    for (const character of session) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
    const url = new URL(location.href); url.searchParams.set('project', 'qa_workflow_' + (hash >>> 0).toString(16)); history.replaceState(null, '', url);
  }
  // Isolate both the production stores and preference writes from normal canvas pages.
  const preferences = new Map(), nativeFetch = window.fetch.bind(window);
  Object.defineProperty(window, 'localStorage', {value: {getItem: key => preferences.get(key) ?? null, setItem: (key, value) => preferences.set(key, String(value)), removeItem: key => preferences.delete(key)}});
  window.CANVAS_DB_NAME = namespace + 'canvas'; window.LOCAL_ASSETS_DB_NAME = namespace + 'assets';
  preferences.set('tapnow-canvas-view-v1', JSON.stringify({x: 220, y: 335, scale: .6}));
  preferences.set('tapnow-playlist-intro-hidden', 'true');
  const groupId = 'qa-durable-group';
  const node = (id, title, x, y) => ({id, type: 'text', textMode: 'generate', title, parentId: groupId, x, y, width: 280, height: 270, content: '', generation: {model: 'gemini-3.1-flash-lite', prompt: title + ' · 仅本机合成合同回放', count: 1, referenceIds: [], promptReferenceBindings: []}});
  const seed = {referenceWidth: 1400, referenceHeight: 900, nodes: [
    {id: groupId, type: 'group', title: '分组持久恢复合同 QA', x: 10, y: 10, width: 970, height: 665},
    node('qa-layer1-a', '首层 A · 合成合同', 40, 70), node('qa-layer1-b', '首层 B · 合成合同', 40, 375), node('qa-layer2-c', '后层 C · 等待显式继续', 610, 220)
  ], edges: [{id: 'qa-edge-a-c', source: 'qa-layer1-a', target: 'qa-layer2-c'}, {id: 'qa-edge-b-c', source: 'qa-layer1-b', target: 'qa-layer2-c'}]};
  Object.defineProperty(window, 'CANVAS_DATA', {get: () => seed, set: () => {}});
  const fixture = window.WorkflowRecoveryFixture = {namespace, session, groupId, failureStage: null, localEvents: [], externalAttempts: [], contractReplay: true, syntheticOutput: true};
  // Non-default production projects require an existing document. Persist a
  // first-use fixture before the real CanvasStore.load; never replace saved data.
  fixture.canvasSeedReady = new Promise((resolve, reject) => {
    const request = indexedDB.open(window.CANVAS_DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('documents');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, projectId = new URL(location.href).searchParams.get('project'), key = projectId === 'canvas' ? 'canvas' : 'project:' + projectId;
      const tx = db.transaction('documents', 'readwrite'), store = tx.objectStore('documents'), read = store.get(key);
      read.onsuccess = () => {
        if (read.result !== undefined) return;
        const now = Date.now();
        store.put({...structuredClone(seed), version: 1, storageRevision: 1, project: {id: projectId, title: '分组持久恢复合同 QA', createdAt: now, updatedAt: now}, view: {x: 220, y: 335, scale: .6}, history: [], future: []}, key);
      };
      tx.oncomplete = () => {db.close(); resolve();}; tx.onabort = () => {db.close(); reject(tx.error || Error('QA 初始画布保存中断'));}; tx.onerror = () => reject(tx.error);
    };
  });
  const database = new Promise((resolve, reject) => {
    const request = indexedDB.open(namespace + 'transport', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('records');
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  const blank = () => ({version: 1, tasks: {}, events: [], sequence: 0, lookup404: false});
  fixture.transact = async transform => {
    const db = await database;
    return new Promise((resolve, reject) => {
      const tx = db.transaction('records', transform ? 'readwrite' : 'readonly'), store = tx.objectStore('records'), request = store.get('state'); let result;
      request.onsuccess = () => {try {const state = request.result || blank(); result = transform ? transform(state) : state; if (transform) store.put(state, 'state');} catch (error) {reject(error); tx.abort();}};
      tx.oncomplete = () => resolve(structuredClone(result)); tx.onabort = () => reject(tx.error || Error('合同传输数据库事务中断')); tx.onerror = () => reject(tx.error);
    });
  };
  fixture.read = () => fixture.transact();
  const event = (state, method, path, detail = {}) => {
    state.events.push({sequence: ++state.sequence, at: Date.now(), method, path, ...detail});
    state.events = state.events.slice(-2000);
  };
  const output = nativeFetch('/src/features/workflow-recovery/qa/contract-output.txt').then(response => {if (!response.ok) throw Error('本机合同文本文件缺失'); return response.text();});
  fixture.transport = async (input, options = {}) => {
    if (options.signal?.aborted) throw options.signal.reason;
    const url = new URL(typeof input === 'string' ? input : input.url, location.href), method = options.method || 'GET', path = url.pathname;
    if (url.origin !== location.origin || !path.startsWith('/qa-workflow-contract/tasks')) throw Error('合同夹具只接受本地 tasks 传输');
    const text = await output;
    const value = await fixture.transact(state => {
      const key = path.startsWith('/qa-workflow-contract/tasks/by-key/') ? decodeURIComponent(path.split('/').at(-1)) : null;
      if (method === 'POST' && path === '/qa-workflow-contract/tasks') {
        const request = JSON.parse(options.body), id = new Headers(options.headers).get('Idempotency-Key');
        if (!id || !request.parameters?.workflowRecovery) throw Error('合同 POST 缺原任务身份');
        const duplicate = !!state.tasks[id]; event(state, method, path, {id, nodeId: request.nodeId, duplicate});
        if (!duplicate) state.tasks[id] = {id, request, status: 'running', progress: 15, createdAt: Date.now(), syntheticOutput: true, contractText: text};
        return {status: 200, body: state.tasks[id]};
      }
      const id = key || decodeURIComponent(path.split('/').at(-1));
      event(state, method, path, {id, byKey: !!key});
      if (method === 'DELETE') {if (state.tasks[id]) state.tasks[id].status = 'cancelled'; return {status: 200, body: {id, status: 'cancelled'}};}
      if (key && state.lookup404 || !state.tasks[id]) return {status: 404, body: {error: 'QA 合同：原任务查询 404', code: 'unknown'}};
      return {status: 200, body: state.tasks[id]};
    });
    document.dispatchEvent(new CustomEvent('workflow-qa:transport'));
    return Response.json(value.body, {status: value.status});
  };
  fixture.release = ids => fixture.transact(state => {
    for (const task of Object.values(state.tasks)) if (task.status === 'running' && (!ids || ids.includes(task.id))) {
      task.status = 'succeeded'; task.progress = 100; task.outputs = [{type: 'text', text: task.contractText + '\n节点：' + task.request.nodeId, title: '显式合成合同结果'}];
      event(state, 'FIXTURE_RELEASE', 'local-indexeddb', {id: task.id, nodeId: task.request.nodeId});
    }
    return state;
  });
  fixture.set404 = value => fixture.transact(state => {state.lookup404 = value; event(state, 'FIXTURE_404', 'local-indexeddb', {enabled: value}); return state;});
  window.fetch = async (input, options = {}) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href);
    if (url.origin !== location.origin && !['blob:', 'data:'].includes(url.protocol)) {fixture.externalAttempts.push(url.hostname); throw Error('工作流合同 QA 禁止外部请求');}
    if (['/api/generation/config', '/api/agent/config'].includes(url.pathname)) return Response.json({configured: false, capabilities: {kinds: []}});
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) throw Error('工作流合同 QA 禁止触及生产 API');
    return nativeFetch(input, options);
  };
})();
