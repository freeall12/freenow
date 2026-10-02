import {createHtmlCard, createWidgetCard} from './cards.mjs';
import {prepareHtml, prepareWidget} from './tools.mjs';
import {openHtmlPreview} from '../agent-artifacts/html-preview.mjs';
import {independentNavigationUrl} from '../local-resource-migration/origin-policy.mjs';
export {prepareHtml, prepareWidget};

const supported = trace => ['show_html', 'show_widget'].includes(trace?.name);
const actionable = trace => ['running', 'done', 'completed'].includes(trace?.status) && !trace?.error && !trace?.result?.error;

// Cards are scoped to the actual chat and trace objects. A stable trace keeps its
// iframe; a removed/replaced context cannot send prompts or open a late preview.
export function createArtifactController({getContext, getStore, onQueuePrompt, onUploadMedia, onDownloadMedia, onError = () => {}, openLink, openPreview = openHtmlPreview}) {
  const chats = new Map();let epoch = 0, previewAttempt = 0, preview = null;
  function context() {try {return getContext() || {};} catch {return {};}}
  function current(record, version = record.version) {
    const now = context();
    return !record.disposed && record.version === version && chats.get(record.chat)?.get(record.id) === record &&
      now.chat === record.chat && now.panelActive && !now.pageLeaving &&
      record.chat.messages?.includes(record.trace) && actionable(record.trace) && record.card?.element.isConnected;
  }
  function report(record, message) {if (current(record)) onError(message);}
  function closePreview() {
    const previous = preview;preview = null;
    try {previous?.handle?.close?.();} catch { /* Cleanup must still release every card. */ }
  }
  function dispose(record) {
    record.disposed = true;record.version++;
    if (preview?.record === record) closePreview();
    record.card.destroy();
  }
  function binding(trace) {
    return {namespace: trace.result?.namespace, artifact_path: trace.result?.artifact_path, revision: trace.result?.revision,
      kind: trace.result?.kind, requestPath: trace.args?.artifact_path, title: trace.result?.title, description: trace.result?.description};
  }
  function sameBinding(trace, value) {
    const next = binding(trace);return Object.keys(value).every(key => next[key] === value[key]);
  }
  async function openHtml(record, trace) {
    const version = record.version, generation = epoch, attempt = ++previewAttempt, receipt = binding(trace);
    const valid = () => attempt === previewAttempt && generation === epoch && current(record, version) && record.trace === trace && sameBinding(trace, receipt);
    if (!valid()) return false;
    try {
      if (receipt.kind !== 'html' || receipt.artifact_path !== receipt.requestPath || typeof receipt.namespace !== 'string' || !Number.isSafeInteger(receipt.revision) || receipt.revision < 1) throw Error('HTML 展示记录无效，请重新展示');
      const store = await getStore();
      if (!valid()) return false;
      if (store?.namespace !== receipt.namespace) throw Error('HTML 产物所属画布已变化，请重新展示');
      const file = await store.get(receipt.artifact_path);
      if (!valid()) return false;
      // Validate one complete snapshot through the same preparation contract; do
      // not fetch a paged body or race a second read against the first receipt.
      const checked = await prepareHtml({artifact_path: receipt.artifact_path}, {namespace: receipt.namespace, store: {namespace: store.namespace, get: async () => file}});
      if (!valid()) return false;
      if (checked.revision !== receipt.revision) throw Error('HTML 产物已更新，当前卡片已失效，请重新展示');
      closePreview();
      const handle = await openPreview({file: {...file, title: receipt.title || 'HTML'}, showShare: false, onError: message => {if (valid()) onError(message);}});
      if (!valid()) {try {handle?.close?.();} catch {}return false;}
      preview = {handle, record, binding: receipt};return true;
    } catch (error) {if (!valid()) return false;throw error;}
  }
  function render(trace) {
    const now = context();
    if (!supported(trace) || typeof trace.id !== 'string' || !trace.id || !now.chat?.messages?.includes(trace) || !now.panelActive || now.pageLeaving) return null;
    let records = chats.get(now.chat);if (!records) {records = new Map();chats.set(now.chat, records);}
    let record = records.get(trace.id);
    if (record && record.name !== trace.name) {dispose(record);records.delete(trace.id);record = null;}
    if (record) {
      if (record.trace !== trace) {if (preview?.record === record) closePreview();record.version++;record.trace = trace;}
      if (preview?.record === record && !sameBinding(trace, preview.binding)) closePreview();
      record.card.update(trace, {streaming: !!now.streaming});return record.card.element;
    }
    record = {chat: now.chat, trace, id: trace.id, name: trace.name, version: 0, disposed: false, card: null};records.set(trace.id, record);
    const shared = {trace, isCurrent: () => current(record), onError: message => report(record, message)};
    record.card = trace.name === 'show_html' ? createHtmlCard({...shared, onOpen: (_target, captured) => openHtml(record, captured)}) : createWidgetCard({...shared, streaming: !!now.streaming,
      onUploadMedia:async(payload,captured,options)=>{
        const version=record.version;
        const valid=()=>current(record,version)&&captured===record.trace&&options.isCurrent();
        if(!valid()||!onUploadMedia)throw Error('当前组件的画布交接已失效或未配置');
        return onUploadMedia(payload,captured,record.chat,{...options,isCurrent:valid});
      },onDownloadMedia,
      onSendPrompt: async (text, captured) => {
        if (!current(record) || captured !== record.trace || typeof text !== 'string' || !text.trim() || text.length > 20000 || !onQueuePrompt) return false;
        const version = record.version, result = await onQueuePrompt(text.trim(), captured, record.chat);
        return result !== false && current(record, version) && captured === record.trace;
      },
      onOpenLink: (url, captured) => {
        if (!current(record) || captured !== record.trace) return false;
        const target = independentNavigationUrl(url);
        return openLink ? openLink(target, captured, record.chat) : globalThis.window.open(target, '_blank', 'noopener,noreferrer');
      },
    });
    return record.card.element;
  }
  function prune(traces) {
    const now = context(), live = new Set(traces || []);
    for (const [chat, records] of chats) {
      for (const [id, record] of records) if (chat !== now.chat || !now.panelActive || now.pageLeaving || !live.has(record.trace) || !chat.messages?.includes(record.trace)) {dispose(record);records.delete(id);}
      if (!records.size) chats.delete(chat);
    }
    if (preview && (!current(preview.record) || !sameBinding(preview.record.trace, preview.binding))) closePreview();
  }
  function reset() {
    epoch++;previewAttempt++;closePreview();for (const records of chats.values()) for (const record of records.values()) dispose(record);chats.clear();
  }
  return {render, prune, reset};
}
