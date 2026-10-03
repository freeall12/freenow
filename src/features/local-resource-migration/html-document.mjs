import {hashSource as defaultHash, validateResourceIndex, isStaticAssetRef, HASH_PATTERN} from './index-format.mjs';
import {importIndexedAsset} from './import-asset.mjs';

export const HTML_RESOURCE_POLICY = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; media-src data:; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
export const WIDGET_RESOURCE_POLICY = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
const preparedDocuments = new WeakMap();
const emptyIndex = {version: 1, algorithm: 'sha256-exact-utf8', entries: {}};
const fail = (code, message) => Object.assign(Error(message), {code});
const check = signal => {if (signal?.aborted) throw signal.reason || new DOMException('HTML 本地化已取消', 'AbortError');};
const space = c => /[\t\n\f\r ]/.test(c || '');
const mediaType = mime => /^(image|video|audio)\//.test(mime);

function inertTemplate(html, document) {
  if (typeof html !== 'string' || html.length > 8 * 1024 * 1024) throw fail('html_input_invalid', 'HTML 输入无效或超过预算');
  if (!document?.createElement) throw fail('html_parse_unavailable', '缺少惰性 HTML 解析器');
  const template = document.createElement('template');
  if (!template.content) throw fail('html_parse_unavailable', '当前环境不支持惰性 HTML 模板');
  // Template contents never enter a browsing context. DOMParser's inactive
  // document may still load images in some engines; do not use it for this input.
  const root = template.content.ownerDocument.createElement('html');
  template.content.append(root);
  root.innerHTML = html;
  // HTML fragment parsing in the html context preserves head/body attributes.
  // Its outer html token is ignored; copy only a leading real html tag's attrs,
  // parsed again as inert attributes, without touching strings inside scripts.
  let offset = 0;
  for (;;) {
    while (space(html[offset])) offset++;
    if (html.startsWith('<!--', offset)) {const end = html.indexOf('-->', offset + 4); if (end < 0) break; offset = end + 3; continue;}
    if (/^<!doctype\b/i.test(html.slice(offset))) {const end = html.indexOf('>', offset + 2); if (end < 0) break; offset = end + 1; continue;}
    break;
  }
  const opening = /^<html(?=[\t\n\f\r />])/i.exec(html.slice(offset));
  if (opening) {
    let end = offset + opening[0].length, quote = null;
    for (; end < html.length; end++) {const char = html[end]; if (quote) {if (char === quote) quote = null;} else if (char === '"' || char === "'") quote = char; else if (char === '>') break;}
    if (end < html.length) {
      const attributes = document.createElement('template');
      attributes.innerHTML = '<div' + html.slice(offset + opening[0].length, end) + '></div>';
      for (const attr of attributes.content.firstElementChild?.attributes || []) root.setAttribute(attr.name, attr.value);
    }
  }
  return template;
}

function elements(fragment, prefix = '$') {
  const result = [];
  [...fragment.querySelectorAll('*')].forEach((element, index) => {
    const path = prefix + '.elements[' + index + ']';
    result.push({element, path});
    if (element.localName === 'template') result.push(...elements(element.content, path + '.content'));
  });
  return result;
}

// Conservative synchronous gate for existing widget handshakes. Escaped CSS
// takes the async parser path even when the escape turns out to be harmless.
export function hasHtmlResourceSlots(html, {document = globalThis.document} = {}) {
  try {
    return elements(inertTemplate(html, document).content).some(({element: e}) => {
      const name = e.localName;
      if (['base', 'iframe', 'frame', 'object', 'embed', 'link'].includes(name)) return true;
      if (e.hasAttribute('src') || e.hasAttribute('srcset') || e.hasAttribute('poster') || e.hasAttribute('href') || e.hasAttribute('xlink:href') || e.hasAttribute('action') || e.hasAttribute('formaction')) return true;
      if (name === 'meta' && /^(refresh|content-security-policy)$/i.test(e.getAttribute('http-equiv') || '')) return true;
      return /url\s*\(|image-set\s*\(|@import|\\/i.test((e.getAttribute('style') || '') + (name === 'style' ? e.textContent : ''));
    });
  } catch {return true;}
}

function collect(template) {
  const slots = [], diagnostics = [], css = [];
  for (const {element: e, path} of elements(template.content)) {
    const name = e.localName;
    const attribute = (key, kind, type = 'url') => {if (e.hasAttribute(key) && e.getAttribute(key)) slots.push({e, key, value: e.getAttribute(key), path: path + '.' + key, kind, type});};
    if (name === 'img') {attribute('src', 'image'); attribute('srcset', 'image', 'srcset');}
    if (name === 'video' || name === 'audio') attribute('src', name);
    if (name === 'video') attribute('poster', 'image');
    if (name === 'source') {attribute('src', ['video', 'audio'].includes(e.parentElement?.localName) ? e.parentElement.localName : undefined); attribute('srcset', 'image', 'srcset');}
    if (name === 'image' && e.namespaceURI === 'http://www.w3.org/2000/svg') {attribute('href', 'image'); attribute('xlink:href', 'image');}
    if (e.hasAttribute('style')) css.push({e, path: path + '.style', text: e.getAttribute('style'), inline: true});
    if (name === 'style') css.push({e, path: path + '.css', text: e.textContent, inline: false});
    const diagnostic = (code, severity = 'error', suffix = '') => diagnostics.push({path: path + suffix, code, severity});
    if (name === 'script') {
      if (['src', 'href', 'xlink:href'].some(key => e.hasAttribute(key))) {diagnostic('external_script_unsupported', 'error', '.external-code'); for (const key of ['src', 'href', 'xlink:href']) e.removeAttribute(key); e.setAttribute('type', 'application/x-localization-blocked');}
      else if (e.textContent.trim()) diagnostic('dynamic_code_uninspected', 'warning');
    }
    for (const attr of [...e.attributes]) {
      if (/^on/i.test(attr.name)) diagnostic('dynamic_code_uninspected', 'warning', '.inline-handler');
      if (['action', 'formaction', 'ping'].includes(attr.name) || ['a', 'area'].includes(name) && ['href', 'xlink:href'].includes(attr.name) && !attr.value.startsWith('#')) {
        diagnostic('navigation_disabled', 'warning', '.navigation'); e.removeAttribute(attr.name);
      }
    }
    if (name === 'base') {diagnostic('base_disabled', 'warning'); e.remove();}
    if (name === 'link') {diagnostic('external_stylesheet_or_link_unsupported'); e.remove();}
    if (['iframe', 'frame', 'object', 'embed'].includes(name)) {diagnostic('embedded_document_unsupported'); e.remove();}
    if (name === 'meta' && /^(refresh|content-security-policy)$/i.test(e.getAttribute('http-equiv') || '')) {if (/^refresh$/i.test(e.getAttribute('http-equiv'))) diagnostic('navigation_disabled', 'warning'); e.remove();}
    // SVG use/feImage, HTML input-image and legacy background are outside the
    // supported media slots. Keep a visible unresolved boundary, not a success.
    for (const key of ['src', 'background', 'href', 'xlink:href']) if (e.hasAttribute(key) && !slots.some(slot => slot.e === e && slot.key === key) && e.getAttribute(key) && !e.getAttribute(key).startsWith('#')) diagnostic('resource_slot_unsupported', 'error', '.unsupported-resource');
  }
  return {slots, diagnostics, css};
}

export async function prepareHtmlDocument(html, {document = globalThis.document, parseCss, hashSource = defaultHash, expectedSourceHash, signal} = {}) {
  check(signal);
  const template = inertTemplate(html, document), sourceHash = await hashSource(html);
  check(signal);
  if (!HASH_PATTERN.test(sourceHash)) throw fail('html_input_invalid', 'HTML 来源哈希无效');
  if (expectedSourceHash !== undefined && expectedSourceHash !== sourceHash) throw fail('html_source_changed', 'HTML 原文已经改变');
  const analysis = collect(template), prepared = Object.freeze({sourceHash, resourceCount: analysis.slots.length + analysis.css.length, diagnostics: Object.freeze(analysis.diagnostics.map(value => Object.freeze({...value})))});
  preparedDocuments.set(prepared, {html, document, parseCss, hashSource});
  return prepared;
}

function escaped(text, position) {
  let i = position + 1, hex = '';
  while (i < text.length && hex.length < 6 && /[a-f\d]/i.test(text[i])) hex += text[i++];
  if (hex) {if (space(text[i])) i++; const point = parseInt(hex, 16); return {value: point && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : '\ufffd', end: i};}
  if (text[i] === '\r' && text[i + 1] === '\n') return {value: '', end: i + 2};
  return {value: /[\r\n\f]/.test(text[i] || '') ? '' : text[i] || '', end: i + 1};
}

function quoted(text, position) {
  const quote = text[position]; let value = '', i = position + 1;
  while (i < text.length && text[i] !== quote) {
    if (text[i] === '\\') {const part = escaped(text, i); value += part.value; i = part.end;}
    else value += text[i++];
  }
  if (text[i] !== quote) throw Error('css_token_invalid');
  return {value, end: i + 1};
}

// This tokenizer only locates URL tokens in CSSOM-normalized declaration values;
// it does not rewrite source CSS by regular expression or evaluate JS expressions.
function cssTokens(text) {
  const urls = [], flags = new Set(); let i = 0;
  while (i < text.length) {
    if (text.startsWith('/*', i)) {const end = text.indexOf('*/', i + 2); if (end < 0) throw Error('css_token_invalid'); i = end + 2; continue;}
    if (text[i] === '"' || text[i] === "'") {i = quoted(text, i).end; continue;}
    const start = i; let word = '';
    if (text[i] === '@') {word += '@'; i++;}
    while (i < text.length && (/[\w-]/.test(text[i]) || text[i] === '\\')) {
      if (text[i] === '\\') {const part = escaped(text, i); word += part.value; i = part.end;}
      else word += text[i++];
    }
    if (!word) {i = Math.max(i, start + 1); continue;}
    word = word.toLowerCase();
    if (word === '@import') flags.add('css_import_unsupported');
    while (space(text[i])) i++;
    if (word.endsWith('image-set') && text[i] === '(') flags.add('css_image_set_unsupported');
    if (word !== 'url' || text[i] !== '(') continue;
    i++; while (space(text[i])) i++;
    let value = '';
    if (text[i] === '"' || text[i] === "'") {const part = quoted(text, i); value = part.value; i = part.end; while (space(text[i])) i++;}
    else {while (i < text.length && text[i] !== ')') {if (text[i] === '\\') {const part = escaped(text, i); value += part.value; i = part.end;} else {if (text[i] === '(' || text[i] === '"' || text[i] === "'") throw Error('css_token_invalid'); value += text[i++];}} value = value.trim();}
    if (text[i] !== ')') throw Error('css_token_invalid');
    urls.push({start, end: ++i, value});
  }
  return {urls, flags};
}

function parseSrcset(text) {
  const result = []; let i = 0;
  while (i < text.length) {
    while (space(text[i]) || text[i] === ',') i++;
    if (i >= text.length) break;
    const start = i; while (i < text.length && !space(text[i])) i++;
    let url = text.slice(start, i), descriptor = '';
    if (url.endsWith(',')) url = url.replace(/,+$/, '');
    else {const at = i; while (i < text.length && text[i] !== ',') i++; descriptor = text.slice(at, i).trim(); if (text[i] === ',') i++;}
    if (!url || descriptor && !/^(?:[1-9]\d*w|(?:\d+(?:\.\d+)?|\.\d+)x)$/.test(descriptor)) throw Error('srcset_invalid');
    result.push({url, descriptor});
  }
  return result;
}

function defaultCssParser(document) {
  const Constructor = document.defaultView?.CSSStyleSheet || globalThis.CSSStyleSheet;
  return text => {const sheet = new Constructor(); if (typeof sheet.replaceSync !== 'function') throw Error('css_parser_unavailable'); sheet.replaceSync(text); return sheet;};
}

async function blobBytes(blob, document) {
  if (typeof blob.arrayBuffer === 'function') return new Uint8Array(await blob.arrayBuffer());
  const Reader = document.defaultView?.FileReader;
  if (!Reader) throw Error('asset_read_failed');
  return new Promise((resolve, reject) => {const reader = new Reader(); reader.onload = () => resolve(new Uint8Array(reader.result)); reader.onerror = () => reject(Error('asset_read_failed')); reader.readAsArrayBuffer(blob);});
}

function dataUrl(bytes, mime) {
  let binary = ''; for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return 'data:' + mime + ';base64,' + btoa(binary);
}

async function boundedBlobResponse(response, signal, limit) {
  if (!response?.ok || response.redirected || !response.body?.getReader) throw Error('asset_read_failed');
  const declared = response.headers?.get('content-length');
  if (declared !== null && declared !== undefined && (!/^\d+$/.test(declared) || Number(declared) > limit)) {await response.body.cancel(); throw Error('resource_budget_exceeded');}
  const reader = response.body.getReader(), chunks = []; let size = 0;
  const cancel = () => {try {Promise.resolve(reader.cancel(signal?.reason)).catch(() => {});} catch {}};
  signal?.addEventListener('abort', cancel, {once: true});
  try {for (;;) {check(signal); const part = await reader.read(); check(signal); if (part.done) break; if (!(part.value instanceof Uint8Array) || size + part.value.length > limit) throw Error('resource_budget_exceeded'); size += part.value.length; chunks.push(part.value);}}
  catch (error) {cancel(); throw error;}
  finally {signal?.removeEventListener('abort', cancel); reader.releaseLock();}
  return new Blob(chunks, {type: response.headers?.get('content-type') || ''});
}

export async function materializeHtmlDocument(prepared, {index = emptyIndex, assets, fetchImpl = globalThis.fetch, signal, maxBytes = 20 * 1024 * 1024, maxTotalBytes = 60 * 1024 * 1024, hashBytes, policyTarget = 'artifact'} = {}) {
  check(signal);
  const state = preparedDocuments.get(prepared);
  if (!state) throw fail('html_input_invalid', 'HTML 准备结果无效');
  if (!['artifact', 'widget'].includes(policyTarget)) throw fail('html_input_invalid', 'HTML 权限目标无效');
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 100 * 1024 * 1024 || !Number.isSafeInteger(maxTotalBytes) || maxTotalBytes < 1 || maxTotalBytes > 200 * 1024 * 1024) throw fail('html_input_invalid', 'HTML 素材预算无效');
  const template = inertTemplate(state.html, state.document), analysis = collect(template), diagnostics = [...analysis.diagnostics], validated = validateResourceIndex(index), cache = new Map();
  let embedded = 0, slots = 0, totalBytes = 0;
  const diagnostic = (path, code, sourceHash) => diagnostics.push({path, code, severity: 'error', ...(sourceHash ? {sourceHash} : {})});
  const resolve = async (source, path, kind) => {
    check(signal); slots++;
    if (source.startsWith('#')) return source;
    const sourceHash = await state.hashSource(source); check(signal);
    if (!HASH_PATTERN.test(sourceHash)) throw fail('html_input_invalid', 'HTML 素材来源哈希无效');
    if (/^data:(image|video|audio)\//i.test(source)) {
      if (kind && !source.toLowerCase().startsWith('data:' + kind + '/')) {diagnostic(path, 'asset_type_invalid', sourceHash); return source;}
      if (source.length > maxBytes * 1.4 || totalBytes + source.length > maxTotalBytes * 1.4) {diagnostic(path, 'resource_budget_exceeded', sourceHash); return source;}
      totalBytes += source.length; embedded++; return source;
    }
    if (!cache.has(source + ':' + (kind || ''))) cache.set(source + ':' + (kind || ''), (async () => {
      let blob;
      if (/^asset:[^\s]+$/.test(source)) {
        if (typeof assets?.read === 'function') blob = await assets.read(source, {signal});
        else if (typeof assets?.url === 'function') {
          const url = await assets.url(source); check(signal);
          if (typeof url !== 'string' || !url.startsWith('blob:')) throw Error('asset_read_untrusted');
          const response = await fetchImpl(url, {signal, redirect: 'error'}); check(signal);
          blob = await boundedBlobResponse(response, signal, Math.min(maxBytes, maxTotalBytes - totalBytes));
        } else throw Error('asset_adapter_unavailable');
      } else {
        const ref = isStaticAssetRef(source) ? '/assets/' + source.replace(/^(?:\.\/|\/)?assets\//, '') : validated.entries[sourceHash]?.ref;
        if (!ref) throw Error('source_unmapped');
        // Reuse the verified import path, but its put writes to a local variable,
        // never the user's AssetStore. Derivation itself has no storage effects.
        const remaining = Math.min(maxBytes, maxTotalBytes - totalBytes);
        if (remaining < 1) throw Error('resource_budget_exceeded');
        await importIndexedAsset(ref, {index: validated, assets: {put: async value => {blob = value; return 'asset:html-ephemeral';}}, fetchImpl, signal, maxBytes: remaining, expectedKind: kind, ...(hashBytes ? {hashBytes} : {})});
      }
      check(signal);
      const mime = String(blob?.type || '').split(';')[0].toLowerCase();
      if (!Number.isSafeInteger(blob?.size) || !mediaType(mime) || kind && !mime.startsWith(kind + '/')) throw Error('asset_type_invalid');
      if (blob.size > maxBytes || totalBytes + blob.size > maxTotalBytes) throw Error('resource_budget_exceeded');
      const bytes = await blobBytes(blob, state.document); check(signal);
      if (bytes.length !== blob.size) throw Error('asset_bytes_invalid');
      totalBytes += bytes.length; return dataUrl(bytes, mime);
    })());
    try {const result = await cache.get(source + ':' + (kind || '')); check(signal); embedded++; return result;}
    catch (error) {check(signal); diagnostic(path, ['source_unmapped', 'asset_adapter_unavailable', 'asset_read_untrusted', 'asset_read_failed', 'asset_type_invalid', 'asset_bytes_invalid', 'resource_budget_exceeded'].includes(error.message) ? error.message : 'resource_read_failed', sourceHash); return source;}
  };
  for (const slot of analysis.slots) {
    if (slot.type === 'srcset') {
      let candidates; try {candidates = parseSrcset(slot.value);} catch {diagnostic(slot.path, 'srcset_invalid'); continue;}
      const values = []; for (let i = 0; i < candidates.length; i++) {const candidate = candidates[i]; values.push(await resolve(candidate.url, slot.path + '.candidates[' + i + ']', slot.kind) + (candidate.descriptor ? ' ' + candidate.descriptor : ''));}
      slot.e.setAttribute(slot.key, values.join(', '));
    } else slot.e.setAttribute(slot.key, await resolve(slot.value, slot.path, slot.kind));
  }
  for (const item of analysis.css) {
    let tokens, sheet;
    try {
      tokens = cssTokens(item.text);
      if (tokens.flags.size) {for (const code of tokens.flags) diagnostic(item.path, code); continue;}
      if (!tokens.urls.length) continue;
      sheet = (state.parseCss || defaultCssParser(state.document))(item.inline ? 'x{' + item.text + '}' : item.text);
      if (!sheet?.cssRules) throw Error('css_parser_unavailable');
      const normalized = [...sheet.cssRules].map(rule => rule.cssText).join('\n'), after = cssTokens(normalized);
      if (tokens.urls.some(url => !after.urls.some(value => value.value === url.value))) throw Error('css_parse_loss');
    } catch (error) {diagnostic(item.path, ['css_parser_unavailable', 'css_parse_loss'].includes(error.message) ? error.message : 'css_parse_failed'); continue;}
    const visit = async (rules, path) => {
      for (let i = 0; i < rules.length; i++) {
        const rule = rules[i], at = path + '.rules[' + i + ']';
        if (rule.type === 3) {diagnostic(at, 'css_import_unsupported'); continue;}
        if (rule.cssRules) await visit(rule.cssRules, at);
        if (!rule.style) {if (cssTokens(rule.cssText).urls.length && !rule.cssRules) diagnostic(at, 'css_rule_unsupported'); continue;}
        for (let p = 0; p < rule.style.length; p++) {
          const name = rule.style[p], value = rule.style.getPropertyValue(name), urls = cssTokens(value).urls;
          if (!urls.length) continue;
          if (rule.type === 5) {diagnostic(at + '.declarations[' + p + ']', 'css_font_unsupported'); continue;}
          let next = '', end = 0;
          for (let u = 0; u < urls.length; u++) {const url = urls[u]; next += value.slice(end, url.start) + 'url(' + JSON.stringify(await resolve(url.value, at + '.declarations[' + p + '].urls[' + u + ']')) + ')'; end = url.end;}
          rule.style.setProperty(name, next + value.slice(end), rule.style.getPropertyPriority(name));
        }
      }
    };
    try {await visit(sheet.cssRules, item.path); if (item.inline) item.e.setAttribute('style', sheet.cssRules[0].style.cssText); else item.e.textContent = [...sheet.cssRules].map(rule => rule.cssText).join('\n');}
    catch (error) {check(signal); diagnostic(item.path, 'css_materialize_failed');}
  }
  check(signal);
  const unresolved = diagnostics.filter(value => value.severity === 'error').length;
  // A real outer head precedes all original nodes, including hostile old meta
  // policies. Navigation still requires the consumer's opaque sandbox wrapper.
  const root = template.content.firstElementChild, head = root.querySelector('head'), policy = root.ownerDocument.createElement('meta'), referrer = root.ownerDocument.createElement('meta');
  policy.setAttribute('http-equiv', 'Content-Security-Policy'); policy.setAttribute('content', policyTarget === 'widget' ? WIDGET_RESOURCE_POLICY : HTML_RESOURCE_POLICY);
  referrer.setAttribute('name', 'referrer'); referrer.setAttribute('content', 'no-referrer');
  head.prepend(policy, referrer);
  const html = '<!doctype html>' + root.outerHTML;
  return {html, sourceHash: prepared.sourceHash, status: unresolved ? 'pending_import' : 'ready', diagnostics, summary: {slots, embedded, unresolved}};
}

export async function localizeHtmlDocument(html, options = {}) {
  const prepared = await prepareHtmlDocument(html, options);
  return materializeHtmlDocument(prepared, options);
}
