// QA-only fixed responses exercise native UI and materialization, never a model.
(() => {
  'use strict';
  const session = new URLSearchParams(location.search).get('session') || 'manual';
  const prefix = 'qa-native-creation:' + session + ':' + crypto.randomUUID() + ':';
  const storage = window.localStorage, nativeFetch = window.fetch.bind(window);
  const keys = () => Array.from({length: storage.length}, (_, index) => storage.key(index)).filter(key => key?.startsWith(prefix));
  Object.defineProperty(window, 'localStorage', {value: {
    getItem: key => storage.getItem(prefix + key), setItem: (key, value) => storage.setItem(prefix + key, String(value)),
    removeItem: key => storage.removeItem(prefix + key), clear: () => keys().forEach(key => storage.removeItem(key)),
    key: index => keys()[index]?.slice(prefix.length) ?? null, get length() {return keys().length;}
  }});
  window.CANVAS_DB_NAME = prefix + 'canvas'; window.LOCAL_ASSETS_DB_NAME = prefix + 'assets';
  const configuration = JSON.parse(document.getElementById('qa-native-configuration').textContent);
  const state = window.NativeCreationFixture = {session, namespace: prefix, posts: 0, configReads: 0, mediaReads: 0,
    blockedRequests: [], requests: [], worldOutput: null, validGLB: false, glbBytes: 0};
  const changed = () => window.dispatchEvent(new Event('qa:native-creation'));
  function blocked(url) {state.blockedRequests.push(url.origin === location.origin ? url.pathname : url.protocol + '//' + url.host); changed(); throw Error('隔离 QA 禁止其他 API 或外部网络请求');}
  function staticAllowed(url) {
    if (['blob:', 'data:'].includes(url.protocol)) return;
    if (url.origin !== location.origin || url.pathname === '/api' || url.pathname.startsWith('/api/')) blocked(url);
  }
  const xhrOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, input, ...rest) {staticAllowed(new URL(input, location.href)); return xhrOpen.call(this, method, input, ...rest);};
  for (const name of ['WebSocket', 'EventSource']) window[name] = class {constructor(input) {blocked(new URL(input, location.href));}};
  navigator.sendBeacon = input => {blocked(new URL(input, location.href));};
  window.fetch = async (input, options = {}) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href);
    const method = (options.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    if (url.origin !== location.origin && !['blob:', 'data:'].includes(url.protocol)) blocked(url);
    if (url.pathname === '/api/generation/config' && method === 'GET') {state.configReads++; changed(); return Response.json(configuration);}
    if (url.pathname === '/api/generation/tasks' && method === 'POST') {
      const body = options.body ?? (input instanceof Request ? await input.clone().text() : '');
      const request = JSON.parse(body), p = request.parameters || {}, alias = p.providerParameters?.model ?? p.modelId ?? p.model;
      if (!request.prompt?.trim()) throw Error('QA 请求缺少实际 UI 提示词');
      if (request.kind === 'video.generate' && alias !== 'MiniMax-H3' || request.kind === 'world.generate' && !['tripo-text-to-model-h3', 'tripo-image-to-model-h3'].includes(alias) || !['video.generate', 'world.generate'].includes(request.kind)) throw Error('QA 原生请求型号或操作错误');
      if (request.kind === 'world.generate' && (!state.validGLB || !state.worldOutput)) throw Error('QA 本地有效 GLB 尚未准备');
      state.posts++;
      state.requests.push({kind: request.kind, requestedModel: alias, prompt: request.prompt.slice(0, 160), parameters: p, inputCount: request.inputs?.length || 0});
      changed();
      const output = request.kind === 'video.generate'
        ? {type: 'video', url: new URL('/qa/trim-scenes.mp4', location.href).href, mimeType: 'video/mp4', title: 'QA 固定本地视频'}
        : {type: 'model', url: state.worldOutput, format: 'glb', mimeType: 'model/gltf-binary', filename: 'qa-fixed-cube.glb'};
      return Response.json({id: 'qa-native-' + state.posts, status: 'succeeded', outputs: [output]});
    }
    staticAllowed(url);
    if (url.protocol === 'blob:' || url.pathname === '/qa/trim-scenes.mp4') {state.mediaReads++; changed();}
    return nativeFetch(input, options);
  };
})();
