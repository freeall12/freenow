import {fileTextSpark} from './icons.mjs';
import {mediaBridgeSource} from './media-bridge.mjs';
import {createWidgetMediaReceiver} from './media-receiver.mjs';
import {whiteboxCaptureSource} from './whitebox-capture.mjs';

const completed = trace => ['done', 'completed'].includes(trace?.status) && !trace?.error && !trace?.result?.error;
const active = trace => ['pending', 'started', 'running'].includes(trace?.status) && !trace?.error && !trace?.result?.error;
const request = trace => trace?.args ?? trace?.request ?? trace?.content?.request ?? trace ?? {};
const identity = trace => trace?.id ?? trace?.callId ?? trace?.tool_call_id ?? '';
const proxyUrl = new URL('./widget-proxy.html', import.meta.url).href;

function node(document, tag, className, text) {
  const element = document.createElement(tag);element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}
function styles(document) {
  if (document.querySelector('link[data-agent-widgets]')) return;
  const link = document.createElement('link');link.rel = 'stylesheet';link.href = new URL('./styles.css', import.meta.url).href;
  link.dataset.agentWidgets = '';document.head.append(link);
}
function current(check) {try {return check() !== false;} catch {return false;}}

/** Official ShowHtmlCard: an artifact-opening button, never an embedded app. */
export function createHtmlCard({trace, onOpen, onError = () => {}, isCurrent = () => true, document = globalThis.document}) {
  styles(document);
  const element = node(document, 'button', 'agent-show-html');element.type = 'button';
  for (const name of ['hover', 'glow', 'glow-hover', 'dots']) {
    const layer = node(document, 'span', `agent-show-html-${name}`);layer.setAttribute('aria-hidden', 'true');element.append(layer);
  }
  const icon = node(document, 'span', 'agent-show-html-icon');icon.innerHTML = fileTextSpark;icon.setAttribute('aria-hidden', 'true');
  const text = node(document, 'div', 'agent-show-html-text'), title = node(document, 'span', 'agent-show-html-title');
  text.append(title, node(document, 'span', 'agent-show-html-subtitle', '打开互动作品'));element.append(icon, text);
  let value = trace, destroyed = false, suspended = false, opening = false, revision = 0, target, targetKey;
  function update(next) {
    if (destroyed) return element;
    const args = request(next), path = args.artifact_path;
    const nextTarget = {artifact_path: path, title: args.title ?? 'HTML', ...(args.description !== undefined ? {description: args.description} : {})};
    const nextKey = JSON.stringify([identity(next), next?.result?.namespace, next?.result?.revision, next?.status, next?.error, next?.result?.error, nextTarget]);
    if (targetKey !== nextKey) {revision++;targetKey = nextKey;}
    value = next;target = nextTarget;suspended = false;
    if (title.textContent !== String(target.title)) title.textContent = String(target.title);
    element.hidden = !completed(next) || typeof path !== 'string' || !path;
    return element;
  }
  element.onclick = async () => {
    if (destroyed || suspended || opening || element.hidden || !current(isCurrent)) return;
    const captured = value, version = revision;opening = true;
    try {if (!onOpen) throw Error('互动作品预览未配置');await onOpen({...target}, captured);}
    catch (error) {if (!destroyed && !suspended && version === revision && current(isCurrent)) onError(error.message || '互动作品无法打开');}
    finally {opening = false;}
  };
  update(trace);
  return {element, update, suspend() {suspended = true;}, destroy() {if (destroyed) return;destroyed = true;revision++;element.onclick = null;element.remove();}};
}

/** Official WidgetLoadingPlaceholder, used only for a live pending tool. */
function generationPlaceholder(document) {
  const element = node(document, 'div', 'agent-widget-generating');
  element.append(node(document, 'div', 'agent-widget-dot-base'));
  const waves = node(document, 'div', 'agent-widget-wave-container');
  waves.append(node(document, 'div', 'agent-widget-wave agent-widget-wave-1'), node(document, 'div', 'agent-widget-wave agent-widget-wave-2'));
  const footer = node(document, 'div', 'agent-widget-generating-footer'), label = node(document, 'span', 'agent-widget-generating-label');
  footer.append(node(document, 'div', 'agent-widget-generating-spinner'), label);element.append(waves, footer);
  return {element, label};
}

/** Arbitrary widget HTML stays in the official double-frame sandbox. The host
 * accepts messages and proposed media; no tools/call route is exposed. */
export function createWidgetCard({trace, streaming = trace?.streaming === true, onSendPrompt, onOpenLink,
  onUploadMedia,onDownloadMedia,
  onError = () => {}, isCurrent = () => true, document = globalThis.document}) {
  const window = document.defaultView || globalThis.window;styles(document);
  const element = node(document, 'div', 'agent-show-widget'), generating = generationPlaceholder(document);
  const loading = node(document, 'div', 'agent-widget-loading');
  loading.append(node(document, 'div', 'agent-widget-loading-spinner'), node(document, 'span', '', 'Loading widget...'));
  element.append(generating.element, loading);
  let value = trace, isStreaming = streaming, destroyed = false, suspended = false, frame = null, nonce = '', code = null, traceId = null;
  let sent = false, rendered = false, resized = false, state = 'idle', generation = 0, timeout = null, deadline = 0, remaining = 10000, loads = 0;
  let rotation = null, labelIndex = 0, labelKey = '', labels = [], loadingTitle, sending = false, lastActionAt = -Infinity;
  const mediaReceiver=createWidgetMediaReceiver({mount:element,document,
    isCurrent:identity=>interactive(identity.version,identity.source,identity.token)&&identity.trace===value&&identity.code===request(value).widget_code,
    onUpload:(payload,options)=>{if(!onUploadMedia)throw Error('画布媒体交接尚未配置');return onUploadMedia(payload,value,options);},onDownload:onDownloadMedia,
    reply:(requestId,result,identity)=>{if(frame?.contentWindow===identity.source&&nonce===identity.token)identity.source.postMessage({type:'uploadToCanvasResult',nonce:identity.token,requestId,...result},'*');},
    createId:()=>window.crypto.randomUUID()});
  function stopTimeout() {if (timeout !== null) {window.clearTimeout(timeout);timeout = null;}}
  function stopRotation() {if (rotation !== null) {window.clearInterval(rotation);rotation = null;}}
  function hideFrame() {if (frame) frame.style.display = 'none';}
  function syncDisplay() {
    const preparing = active(value) && isStreaming, display = completed(value) && !!code && state !== 'error';
    element.hidden = !preparing && !display;generating.element.hidden = !preparing;
    loading.hidden = !display || rendered && resized;
    if (frame) frame.style.display = display && rendered && resized ? 'block' : 'none';
  }
  function armTimeout() {
    stopTimeout();if (suspended || state !== 'loading' || destroyed) return;
    deadline = Date.now() + remaining;
    timeout = window.setTimeout(() => {timeout = null;if (state === 'loading') {state = 'error';syncDisplay();}}, remaining);
  }
  function fail() {state = 'error';stopTimeout();syncDisplay();}
  function resetHandshake() {sent = false;rendered = false;resized = false;state = 'loading';remaining = 10000;syncDisplay();armTimeout();}
  function sendRender() {
    if (destroyed || sent || !frame?.contentWindow || !code || state === 'error') return;
    sent = true;frame.contentWindow.postMessage({type: 'render', html: code, nonce,localBridge:mediaBridgeSource(nonce)+whiteboxCaptureSource()}, '*');
  }
  function makeFrame() {
    mediaReceiver.reset();stopTimeout();frame?.remove();generation++;nonce = window.crypto.randomUUID();loads = 0;
    frame = node(document, 'iframe', 'agent-widget-frame');frame.setAttribute('sandbox', 'allow-scripts');
    frame.title = request(value).title ?? 'Widget';frame.style.height = '200px';
    frame.addEventListener('load', () => {
      // Moving with moveBefore preserves the browsing context. A real reload
      // must repeat the handshake; keeping a DOM object is not sufficient.
      if (destroyed || frame !== eventFrame) return;
      if (loads++ > 0) {mediaReceiver.reset();generation++;nonce = window.crypto.randomUUID();resetHandshake();}sendRender();
    });
    const eventFrame = frame;
    frame.src = proxyUrl;element.append(frame);resetHandshake();
  }
  function syncLabel() {
    const text = loadingTitle || labels[labelIndex] || '正在生成...';
    if (generating.label.textContent !== text) generating.label.textContent = text;
  }
  function syncRotation() {
    if (!destroyed && !suspended && active(value) && isStreaming && labels.length > 1) {
      if (rotation !== null) return;
      rotation = window.setInterval(() => {labelIndex = (labelIndex + 1) % labels.length;syncLabel();}, 2500);
    } else stopRotation();
  }
  function interactive(version, source, token) {
    return !destroyed && !suspended && generation === version && frame?.contentWindow === source && nonce === token &&
      rendered && resized && state === 'rendered' && completed(value) && !element.hidden && element.isConnected && current(isCurrent);
  }
  function userAction() {
    // A valid nonce identifies the widget, not a user request. Ignore boot-time
    // scripts and bursts; generated choices still use the host's normal queue.
    const now = Date.now();
    if (document.activeElement !== frame || window.navigator.userActivation?.isActive !== true || now - lastActionAt < 350) return false;
    lastActionAt = now;return true;
  }
  async function sendPrompt(text, version, source, token) {
    if (!interactive(version, source, token) || sending) return;
    sending = true;
    try {
      if (!onSendPrompt || await onSendPrompt(text, value) === false) throw Error('widget prompt rejected');
      if (!interactive(version, source, token)) return;
    } catch {
      if (interactive(version, source, token)) onError('发送失败，请重试。');
    } finally {sending = false;}
  }
  function receive(event) {
    if (destroyed || !frame || event.source !== frame.contentWindow) return;
    const data = event.data;if (!data || typeof data !== 'object') return;
    if (data.type === 'proxy-ready') {sendRender();return;}
    if (data.nonce !== nonce || state === 'error') return;
    if (data.type === 'rendered') {rendered = true;state = 'rendered';stopTimeout();syncDisplay();}
    else if (data.type === 'error') fail();
    else if (data.type === 'resize' && typeof data.height === 'number' && Number.isFinite(data.height) && data.height > 0) {
      const height = Math.max(data.height, 100);if (frame.style.height !== `${height}px`) frame.style.height = `${height}px`;
      resized = true;syncDisplay();
    } else if(data.type==='uploadToCanvas'&&interactive(generation,event.source,data.nonce)){
      mediaReceiver.receive(data,{version:generation,source:event.source,token:data.nonce,trace:value,code});
    } else if (data.type === 'sendPrompt' && typeof data.text === 'string' && data.text.trim()) {
      if (interactive(generation, event.source, data.nonce) && !sending && userAction()) void sendPrompt(data.text.trim(), generation, event.source, data.nonce);
    } else if (data.type === 'openLink' && typeof data.url === 'string' && interactive(generation, event.source, data.nonce)) {
      let url;try {url = new URL(data.url);} catch {return;}
      if (!['http:', 'https:'].includes(url.protocol) || !userAction()) return;
      const version = generation, source = event.source, token = data.nonce;
      try {
        Promise.resolve(onOpenLink ? onOpenLink(url.href, value) : window.open(url.href, '_blank', 'noopener,noreferrer')).catch(() => {
          if (interactive(version, source, token)) onError('链接无法打开');
        });
      } catch {if (interactive(version, source, token)) onError('链接无法打开');}
    }
  }
  window.addEventListener('message', receive);
  function update(next, options = {}) {
    if (destroyed) return element;
    const wasSuspended = suspended;if(value!==next)mediaReceiver.reset();value = next;suspended = false;
    isStreaming = options.streaming ?? next?.streaming ?? isStreaming;
    const args = request(next), nextLabelKey = JSON.stringify([args.title, args.loading_messages]);
    if (labelKey !== nextLabelKey) {stopRotation();labelKey = nextLabelKey;loadingTitle = args.title;labels = Array.isArray(args.loading_messages) ? args.loading_messages.filter(text => typeof text === 'string') : [];labelIndex = 0;syncLabel();}
    if (completed(next) && typeof args.widget_code === 'string' && args.widget_code) {
      if (code !== args.widget_code || traceId !== identity(next)) {code = args.widget_code;traceId = identity(next);makeFrame();}
      else if (frame) {frame.title = args.title ?? 'Widget';if (wasSuspended) armTimeout();}
    } else {
      stopTimeout();hideFrame();
      if (frame) {mediaReceiver.reset();generation++;frame.remove();frame = null;code = null;nonce = '';state = 'idle';}
    }
    syncDisplay();syncRotation();return element;
  }
  update(trace, {streaming});
  return {element, update, suspend() {
    if (destroyed || suspended) return;
    mediaReceiver.reset();suspended = true;if (timeout !== null) remaining = Math.max(0, deadline - Date.now());stopTimeout();stopRotation();
  }, destroy() {
    if (destroyed) return;mediaReceiver.destroy();destroyed = true;generation++;stopTimeout();stopRotation();window.removeEventListener('message', receive);frame?.remove();frame = null;element.remove();
  }};
}
