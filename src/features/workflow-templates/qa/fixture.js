(() => {
  'use strict';
  let session = null, namespace = null;
  const state = window.WorkflowTemplateMainFixture = {session, namespace, ready: false, initializationError: null, externalAttempts: [], blockedNetworkWrites: [], fetches: []};
  try {
    const parameters = new URLSearchParams(location.search);
    session = parameters.get('session');
    if (!session) {
      session = crypto.randomUUID(); parameters.set('session', session);
      history.replaceState(null, '', location.pathname + '?' + parameters.toString());
    }
    namespace = 'qa-workflow-templates:' + encodeURIComponent(session) + ':';
    Object.assign(state, {session, namespace});
    // Names are isolated before even accessing storage, fetch or Web Locks.
    window.CANVAS_DB_NAME = namespace + 'canvas';
    window.LOCAL_ASSETS_DB_NAME = namespace + 'assets';
    window.TEMPLATE_DB_NAME = namespace + 'templates';
    const preferences = window.localStorage, originalFetch = window.fetch.bind(window), nativeLocks = navigator.locks;
    if (preferences.getItem(namespace + 'tapnow-template-intro') === null) preferences.setItem(namespace + 'tapnow-template-intro', 'dismissed');
    // Every preference key and IndexedDB name is owned by this explicit session.
    // The production CanvasStore/LocalAssets/TemplateAPI implementations stay intact.
    Object.defineProperty(window, 'localStorage', {configurable: true, value: {
      getItem: key => preferences.getItem(namespace + key),
      setItem: (key, value) => preferences.setItem(namespace + key, String(value)),
      removeItem: key => preferences.removeItem(namespace + key)
    }});
    if (nativeLocks?.request) Object.defineProperty(navigator, 'locks', {configurable: true, value: {
      request(name, options, callback) {
        return typeof options === 'function' ? nativeLocks.request(namespace + name, options) : nativeLocks.request(namespace + name, options, callback);
      }
    }});
    window.fetch = async (input, options = {}) => {
      const source = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const url = new URL(source, location.href), method = String(options.method || input?.method || 'GET').toUpperCase();
      if (url.origin !== location.origin && !['blob:', 'data:'].includes(url.protocol)) {
        state.externalAttempts.push(url.hostname); throw Error('模板隔离 QA 禁止外部请求');
      }
      // Real template application is entirely local. This guard only prevents an
      // accidental generation/service write; it never replaces the apply routine.
      if (!['GET', 'HEAD'].includes(method)) {
        state.blockedNetworkWrites.push({path: url.pathname, method}); throw Error('模板隔离 QA 只验收本地模板，不提交模型或服务请求');
      }
      state.fetches.push(url.protocol === 'blob:' ? 'blob:local-read' : url.pathname);
      return originalFetch(input, options);
    };
    state.ready = true;
  } catch (error) {
    state.initializationError = {name: error.name, message: error.message};
    // Fail closed for getter errors and nonconfigurable wrappers as well as
    // quota failures. This head script blocks every later production script.
    document.write('<meta http-equiv="Content-Security-Policy" content="script-src \'none\'">');
    const failure = document.createElement('aside'); failure.id = 'workflow-template-qa-initialization-error'; failure.setAttribute('role', 'alert');
    failure.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#202020;color:#eee;padding:40px;font:16px/1.7 system-ui';
    const heading = document.createElement('h1'); heading.textContent = '隔离 QA 初始化失败，已停止验收';
    const receipt = document.createElement('output'); receipt.id = 'workflow-template-qa-receipt'; receipt.textContent = JSON.stringify({ready: false, session, namespace, initializationError: state.initializationError}, null, 2); receipt.style.whiteSpace = 'pre-wrap';
    failure.append(heading, receipt); document.documentElement.append(failure);
    try { window.fetch = async () => { throw Error('隔离 QA 初始化失败，已停止请求'); }; } catch {}
  }
})();
