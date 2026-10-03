(() => {
  'use strict';
  const session = new URLSearchParams(location.search).get('session') || 'manual';
  if (!/^[a-zA-Z0-9_-]{1,60}$/.test(session)) throw Error('Invalid demo session');
  const namespace = 'freenow-screenshot-demo:' + session + ':';
  const preferences = new Map();
  Object.defineProperty(window, 'localStorage', { value: {
    getItem: key => preferences.get(key) ?? null,
    setItem: (key, value) => preferences.set(key, String(value)),
    removeItem: key => preferences.delete(key),
    clear: () => preferences.clear(),
    key: index => [...preferences.keys()][index] ?? null,
    get length() { return preferences.size; }
  } });
  window.CANVAS_DB_NAME = namespace + 'canvas';
  window.LOCAL_ASSETS_DB_NAME = namespace + 'assets';
  window.TEMPLATE_DB_NAME = namespace + 'templates';
  preferences.set('tapnow-canvas-view-v1', JSON.stringify({ x: 110, y: 100, scale: .8 }));
  preferences.set('tapnow-playlist-intro-hidden', 'true');
  const graph = {
    referenceWidth: 1280, referenceHeight: 720,
    nodes: [
      { id: 'demo-brief', type: 'text', title: '创作简报', x: 50, y: 30, width: 350, height: 240, textMode: 'pure', content: '产品短片 · 办公椅\n\n目标：用三个镜头介绍造型与使用场景。\n\n① 产品全景\n② 材质与结构细节\n③ 环境中的使用画面\n\n拖动节点、连接素材，然后在片场设置镜头。' },
      { id: 'demo-image', type: 'image', title: '本地产品参考', x: 500, y: 30, width: 350, height: 280, image: '/assets/studio/library/chair-office.webp', fullImage: '/assets/studio/library/chair-office.webp' },
      { id: 'demo-studio', type: 'studio', title: '产品 3D 片场', x: 500, y: 420, width: 350, height: 220 },
      { id: 'demo-editor', type: 'image', tool: 'image-editor', title: '图片图层编辑', x: 50, y: 390, width: 350, height: 250, editorDoc: { version: 1, initialized: true, width: 960, height: 640, canvas: { version: '6.7.0', background: '#e9e4d6', objects: [
        { type: 'Rect', version: '6.7.0', left: 100, top: 100, width: 380, height: 360, fill: '#38504a', name: '背景形状', id: 'demo-rect' },
        { type: 'Circle', version: '6.7.0', left: 440, top: 190, radius: 140, fill: '#ba7354', name: '前景形状', id: 'demo-circle' }
      ] } } }
    ],
    edges: [
      { id: 'demo-edge-1', source: 'demo-brief', target: 'demo-image' },
      { id: 'demo-edge-2', source: 'demo-image', target: 'demo-studio' }
    ]
  };
  Object.defineProperty(window, 'CANVAS_DATA', { get: () => graph, set: () => {} });
  const editor = { nodes: {} }, sidebar = { template: [], history: [] }, versions = {};
  Object.defineProperty(window, 'EDITOR_DATA', { get: () => editor, set: () => {} });
  Object.defineProperty(window, 'SIDEBAR_DATA', { get: () => sidebar, set: () => {} });
  Object.defineProperty(window, 'VERSIONS_DATA', { get: () => versions, set: () => {} });
  const fetchLocal = window.fetch.bind(window);
  window.fetch = (input, options = {}) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href);
    if (url.origin !== location.origin && !['data:', 'blob:'].includes(url.protocol)) return Promise.reject(Error('Demo only accepts local resources'));
    if (url.pathname === '/api/generation/config' || url.pathname === '/api/agent/config') return Promise.resolve(Response.json({ configured: false, providers: {}, routes: {}, missing: ['Screenshot demo: no provider calls'], capabilities: { kinds: [] } }));
    if (url.pathname.startsWith('/api/')) return Promise.reject(Error('Screenshot demo does not submit API tasks'));
    return fetchLocal(input, options);
  };
  addEventListener('DOMContentLoaded', () => {
    window.CanvasProjects?.setTitle('功能演示 · 本地示例');
  }, { once: true });
})();
