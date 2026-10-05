const types = new Set(['image', 'video', 'text']);
const supportsOperation = (type, kind) => types.has(type) &&
  (kind === `${type}.generate` || type === 'video' && kind === 'video.depth');
const installations = new WeakMap();
const isActive = job => ['queued', 'running'].includes(job.status) ||
  job.status === 'succeeded' && job.applying && !job.applied && !job.applicationError;
const mediaSource = node => node.type === 'video' ? node.video || node.image || '' : node.fullImage || node.image || '';

// A committed canvas result marker can precede the task's running notification.
// Terminal jobs override leftover markers, including failed result application.
export function pendingNodes(state, jobs = []) {
  const result = new Map(), activeRuns = new Set();
  let byJob, nodes;
  for (const node of state.nodes) {
    if (!supportsOperation(node.type, node.pendingOperation) ||
        typeof node.generationRun?.runId !== 'string' || !node.generationRun.runId ||
        typeof node.generationRun?.requestId !== 'string' || !node.generationRun.requestId) continue;
    const job = jobs.length ? (byJob ||= new Map(jobs.map(job => [job.id, job]))).get(node.generationRun.runId) : undefined;
    // A durable marker without a live task is awaiting explicit recovery, not evidence of active generation.
    if (!job && node.generationRecovery?.version === 1) continue;
    if (job && (job.request?.kind !== node.pendingOperation || !isActive(job))) continue;
    result.set(node.id, {node, runId: node.generationRun.runId});
    activeRuns.add(node.generationRun.runId);
  }
  for (const job of jobs) {
    if (!isActive(job)) continue;
    const type = job.request?.kind?.split('.')[0];
    if (!supportsOperation(type, job.request.kind)) continue;
    const targets = job.request.parameters?.canvasResults?.targetNodeIds;
    // Planned targets are owned by their markers. Undo, editing or applying a
    // result may remove them while the provider task remains in the task tray.
    if (Array.isArray(targets) || activeRuns.has(job.id)) continue;
    nodes ||= new Map(state.nodes.map(node => [node.id, node]));
    for (const id of [job.request.nodeId]) {
      const node = nodes.get(id);
      if (!node || node.type !== type || result.has(id)) continue;
      if (node.pendingOperation && node.pendingOperation !== job.request.kind) continue;
      if (node.generationRun?.runId && node.generationRun.runId !== job.id) continue;
      result.set(id, {node, runId: job.id});
      activeRuns.add(job.id);
    }
  }
  return result;
}

function backdropIndex(state) {
  const byId = new Map(state.nodes.map(item => [item.id, item]));
  const parents = new Map();
  for (const edge of state.edges || []) {
    const parent = byId.get(edge.source);
    if (!parents.has(edge.target) && parent && ['image', 'video'].includes(parent.type)) parents.set(edge.target, parent);
  }
  return parents;
}

export function pendingBackdrop(node, state, parents) {
  if (mediaSource(node)) return {hasMedia: true, fallback: null};
  const parent = (parents || backdropIndex(state)).get(node.id);
  if (parent) {
    const src = mediaSource(parent);
    return {hasMedia: !!src, fallback: src ? {src, type: parent.type === 'video' && parent.video ? 'video' : 'image'} : null};
  }
  return {hasMedia: false, fallback: null};
}

function element(document, className, tag = 'div') {
  const item = document.createElement(tag);
  item.className = className;
  return item;
}

/** Install after CanvasApp and GenerationAPI. No polling, network task or global auto-run. */
export function install({app = window.CanvasApp, generation = window.GenerationAPI,
  document = window.document, resolveMedia = src => window.LocalAssets?.url(src) || src,
  reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || false,
  loadStyles = true} = {}) {
  if (!app?.getState || !app?.getNodeElement || !generation?.getJobs || !generation?.subscribe) {
    throw new TypeError('Pending UI requires CanvasApp and GenerationAPI');
  }
  if (installations.has(app)) return installations.get(app);
  if (loadStyles && !document.getElementById('generation-pending-styles')) {
    const link = document.createElement('link');
    link.id = 'generation-pending-styles'; link.rel = 'stylesheet';
    link.href = new URL('./pending-ui.css', import.meta.url).href;
    document.head.append(link);
  }
  const records = new Map();
  const motionQuery = document.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)');
  let destroyed = false;

  function dispose(record) {
    record.live = false;
    if (record.media?.tagName.toLowerCase() === 'video') {
      record.media.pause(); record.media.removeAttribute('src'); record.media.load();
    }
    record.overlay.remove();
    record.body.removeAttribute('data-generation-pending');
    if (record.busy === null) record.body.removeAttribute('aria-busy');
    else record.body.setAttribute('aria-busy', record.busy);
    record.body.removeEventListener('dblclick', record.blockEdit, true);
  }

  function mount(node, body, runId, backdrop) {
    const text = node.type === 'text';
    const overlay = element(document, text ? 'generation-pending-text' : 'generation-pending-overlay');
    overlay.setAttribute('role', 'status'); overlay.setAttribute('aria-label', '生成中');
    const record = {body, overlay, runId, type: node.type, backdrop, live: true, busy: body.getAttribute('aria-busy')};
    if (text) {
      for (let i = 0; i < 3; i++) overlay.append(element(document, ''));
      record.blockEdit = event => {event.preventDefault(); event.stopImmediatePropagation();};
      body.addEventListener('dblclick', record.blockEdit, true);
    } else {
      if (!backdrop.hasMedia) overlay.append(element(document, 'generation-pending-empty'));
      if (backdrop.fallback) {
        const {src, type} = backdrop.fallback;
        const media = element(document, 'node-loading-media-blur', type === 'video' ? 'video' : 'img');
        record.media = media;
        if (type === 'video') {media.muted = true; media.loop = true; media.playsInline = true; media.autoplay = !reducedMotion();}
        else {media.alt = ''; media.draggable = false;}
        overlay.append(media);
        Promise.resolve().then(() => resolveMedia(src)).then(url => {
          if (!record.live || !url) return;
          media.src = url;
          if (type === 'video' && !reducedMotion()) media.play()?.catch(() => {});
        }).catch(() => {});
      }
      overlay.append(element(document, backdrop.hasMedia ? 'node-loading-shadow-layer' : 'node-loading-shadow-layer-empty'));
      const motion = element(document, 'generation-pending-motion node-loading-motion-enter');
      for (const name of ['grid-stars', 'grid-sweep', 'sweep-glow', 'burst', 'dither']) {
        motion.append(element(document, `node-loading-${name}`));
      }
      overlay.append(motion);
    }
    body.setAttribute('data-generation-pending', node.type);
    body.setAttribute('aria-busy', 'true'); body.append(overlay);
    return record;
  }

  function refresh(event) {
    if (destroyed || event?.detail?.viewportOnly) return;
    const state = app.getState(), pending = pendingNodes(state, generation.getJobs());
    const selected = state.selected?.length === 1 && pending.has(state.selected[0]) ? state.selected[0] : null;
    if (document.body.getAttribute('data-generation-pending-selection') !== selected) {
      if (selected === null) document.body.removeAttribute('data-generation-pending-selection');
      else document.body.setAttribute('data-generation-pending-selection', selected);
    }
    let parents;
    for (const [id, record] of records) {
      if (!pending.has(id)) {dispose(record); records.delete(id);}
    }
    for (const [id, {node, runId}] of pending) {
      const shell = app.getNodeElement(id);
      let record = records.get(id);
      // Query only new/replaced pending shells; dragging preserves both the DOM
      // and CSS animation clock. Body replacement is handled without a query scan.
      const body = record && record.body.parentNode === shell ? record.body : shell?.querySelector('.node-body');
      // Text skeletons and media already on the node never need the edge graph.
      if (node.type !== 'text' && !mediaSource(node)) parents ||= backdropIndex(state);
      const backdrop = node.type === 'text' ? null : pendingBackdrop(node, state, parents);
      const sameBackdrop = record && record.backdrop?.hasMedia === backdrop?.hasMedia &&
        record.backdrop?.fallback?.src === backdrop?.fallback?.src && record.backdrop?.fallback?.type === backdrop?.fallback?.type;
      if (record && (record.body !== body || record.type !== node.type || record.runId !== runId || !sameBackdrop || record.overlay.parentNode !== body)) {
        dispose(record); records.delete(id); record = null;
      }
      if (body && !record) records.set(id, mount(node, body, runId, backdrop));
    }
  }
  function syncMediaMotion() {
    for (const record of records.values()) {
      const media = record.media;
      if (media?.tagName.toLowerCase() !== 'video') continue;
      media.autoplay = !reducedMotion();
      if (reducedMotion()) media.pause();
      else if (media.src) media.play()?.catch(() => {});
    }
  }
  motionQuery?.addEventListener('change', syncMediaMotion);
  document.addEventListener('canvas:render', refresh);
  const unsubscribe = generation.subscribe(() => refresh());
  const api = {refresh, destroy() {
    if (destroyed) return;
    destroyed = true; unsubscribe?.(); document.removeEventListener('canvas:render', refresh);
    document.body.removeAttribute('data-generation-pending-selection');
    motionQuery?.removeEventListener('change', syncMediaMotion);
    for (const record of records.values()) dispose(record);
    records.clear(); installations.delete(app);
  }};
  installations.set(app, api); refresh();
  return api;
}
