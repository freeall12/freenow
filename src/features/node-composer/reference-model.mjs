import {reconcilePrompt} from './prompt-state.mjs';
const bindingId = value => typeof value === 'string' ? value : value?.nodeId || value?.id;
const kinds = ['image', 'video', 'audio', 'text'];
export const referenceNames = {image: '参考图', video: '参考视频', audio: '参考音频', text: '参考文本'};
function material(node, fallback = {}) {
  const type = node.type, url = type === 'video' ? node.video || fallback.video : type === 'audio' ? node.audio : node.fullImage || node.image;
  return {type, url, thumbnail: node.image, text: type === 'text' ? node.content || '' : undefined, title: node.title || node.name || ({image:'Image',video:'Video',audio:'Audio',text:'Text'}[type]), nodeId: node.id};
}
// Edges are live inputs, not a one-time copy of their source thumbnails.
export function referencesFor(node, config, state, library = [], original = {}) {
  const allowed = node.type === 'image' ? ['image', 'text'] : kinds;
  const incoming = state.edges.filter(edge => edge.target === node.id);
  const byId = new Map(state.nodes.map(item => [item.id, item])), entries = [];
  (config.refs || []).forEach((url, index) => {
    const bound = bindingId(config.referenceBindings?.[index]);
    const source = bound ? byId.get(bound) : incoming.map(edge => byId.get(edge.source)).find(item => item && [item.image, item.fullImage, item.video, item.audio].includes(url));
    if (bound && !source) return;
    const edges = source ? incoming.filter(edge => edge.source === source.id).map(edge => edge.id) : [];
    const existing = source && entries.find(item => item.nodeId === source.id);
    if (existing) {existing.savedIndices.push(index); return;}
    const item = source ? material(source, original[source.id]) : {type:'image', url, thumbnail:url, title:library.find(item => item.image === url)?.name || 'Image'};
    if (allowed.includes(item.type)) entries.push({...item, key:source ? `node:${source.id}` : `saved:${index}`, edgeIds:edges, savedIndices:[index]});
  });
  for (const edge of incoming) {
    const source = byId.get(edge.source);
    if (!source || !allowed.includes(source.type) || entries.some(item => item.nodeId === source.id)) continue;
    entries.push({...material(source, original[source.id]), key:`node:${source.id}`, edgeIds:[edge.id], savedIndices:[]});
  }
  const order = new Map((config.referenceOrder || []).map((key, i) => [key, i]));
  for (const item of entries) item.empty = item.type === 'text' ? !item.text?.trim() : !item.url;
  return entries.sort((a,b) => Number(a.empty)-Number(b.empty) || kinds.indexOf(a.type)-kinds.indexOf(b.type) || (order.get(a.key) ?? 1e9)-(order.get(b.key) ?? 1e9));
}
export function referenceInputs(items) {
  const empty = items.find(item => item.empty);
  if (empty) throw Error(`${empty.title}：参考节点没有内容`);
  return items.map(({type,url,text,nodeId,title}) => ({type,...(type === 'text' ? {text} : {url}),...(nodeId ? {id:nodeId} : {}),title}));
}
export function removeReference(config, item) {
  const removed = new Set(item.savedIndices), indices = (config.refs || []).map((_,i) => i).filter(i => !removed.has(i));
  const remap = new Map(indices.map((old,i) => [`saved:${old}`,`saved:${i}`]));
  const next = {...config, refs:indices.map(i => config.refs[i]), referenceBindings:indices.map(i => config.referenceBindings?.[i] || null), referenceOrder:(config.referenceOrder || []).filter(key => key !== item.key && (!key.startsWith('saved:') || remap.has(key))).map(key => remap.get(key) || key)};
  if (!config.promptReferenceBindings) return next;
  const remaining=config.promptReferenceBindings.filter(binding=>binding.referenceKey!==item.key).map(binding=>({key:binding.referenceKey,type:binding.renderText.split(' ')[0].toLowerCase()}));
  const reconciled=reconcilePrompt(next,remaining);
  reconciled.promptReferenceBindings=reconciled.promptReferenceBindings.map(binding=>({...binding,referenceKey:remap.get(binding.referenceKey)||binding.referenceKey}));
  return reconciled;
}
export function reorderReferences(config, items, from, to) {
  if (!items[from] || !items[to] || items[from].type !== items[to].type || items[from].empty || items[to].empty) return config;
  const ordered = [...items], [moved] = ordered.splice(from,1); ordered.splice(to,0,moved);
  return reconcilePrompt({...config, referenceOrder:ordered.map(item => item.key)},ordered);
}
export function withoutSources(config, sources) {
  let next = config;
  for (const source of sources) {
    const savedIndices = (next.refs || []).map((url,i) => bindingId(next.referenceBindings?.[i]) === source.id || !bindingId(next.referenceBindings?.[i]) && [source.image,source.fullImage,source.video,source.audio].includes(url) ? i : -1).filter(i => i >= 0);
    next = removeReference(next, {key:`node:${source.id}`,savedIndices});
  }
  return next;
}
export function orderInputs(config, inputs) {
  const order = new Map((config.referenceOrder || []).map((key,i)=>[key,i])), used = new Set();
  return inputs.map(input=>{
    const index = input.id ? -1 : (config.refs || []).findIndex((url,i)=>url === input.url && !used.has(i));
    used.add(index); return {input,key:input.id ? `node:${input.id}` : `saved:${index}`};
  }).sort((a,b)=>kinds.indexOf(a.input.type)-kinds.indexOf(b.input.type)||(order.get(a.key)??1e9)-(order.get(b.key)??1e9)).map(item=>item.input);
}
