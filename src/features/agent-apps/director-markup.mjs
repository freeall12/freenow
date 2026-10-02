// Source contract: packaged director-markup@v1, Rm/q_/J_/H_/Cm/V_.
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
const fail = () => {throw Error('导演批注数据无效或与已保存内容不一致');};
function keys(value, allowed) {if (!object(value) || Object.keys(value).some(key => !allowed.includes(key))) fail();}
function text(value, max = 24000) {
  if (typeof value !== 'string' || value.length > max) fail();
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {const next = value.charCodeAt(++i);if (!(next >= 0xdc00 && next <= 0xdfff)) fail();}
    else if (code >= 0xdc00 && code <= 0xdfff) fail();
  }
  return value;
}
function boundary(draft, offset) {
  if (!Number.isInteger(offset) || offset < 0 || offset > draft.length) fail();
  if (offset > 0 && offset < draft.length && draft.charCodeAt(offset - 1) >= 0xd800 && draft.charCodeAt(offset - 1) <= 0xdbff && draft.charCodeAt(offset) >= 0xdc00 && draft.charCodeAt(offset) <= 0xdfff) fail();
}
export function prepareDirectorMarkup(data, title = '导演画线批注') {
  keys(data, ['draft', 'locale']);
  const draft = text(data.draft, 8000);
  if (!draft.trim() || data.locale !== undefined && !['zh-CN', 'en-US', 'ja-JP', 'ko-KR', 'fr-FR'].includes(data.locale)) fail();
  return {version: 1, locale: data.locale || 'zh-CN', title, draft, anchors: [], annotations: []};
}
function savedMarkup(state) {
  keys(state, ['version', 'draft', 'anchors', 'annotations', 'active_annotation_id']);
  if (state.version !== 1 || !text(state.draft).trim() || !Array.isArray(state.anchors) || state.anchors.length > 64 || !Array.isArray(state.annotations) || state.annotations.length > 64) fail();
  const ids = new Set(), positions = new Set(), noteIds = new Set(), notes = new Map();
  for (const anchor of state.anchors) {
    if (!object(anchor) || !/^[a-z0-9][a-z0-9_-]{0,31}$/.test(anchor.id) || ids.has(anchor.id) || anchor.status !== 'valid') fail();
    ids.add(anchor.id);
    let start, end;
    if (anchor.type === 'range') {start = anchor.start;end = anchor.end;boundary(state.draft, start);boundary(state.draft, end);if (start >= end || anchor.quote !== state.draft.slice(start, end)) fail();}
    else if (anchor.type === 'point') {start = end = anchor.offset;boundary(state.draft, start);}
    else fail();
    text(anchor.before, 24);text(anchor.after, 24);
    if (!state.draft.slice(0, start).endsWith(anchor.before) || !state.draft.slice(end).startsWith(anchor.after)) fail();
    const position = `${anchor.type}:${start}:${end}`;
    if (positions.has(position)) fail();positions.add(position);
  }
  for (const note of state.annotations) {
    keys(note, ['id', 'anchor_id', 'kind', 'content']);
    const anchor = state.anchors.find(item => item.id === note.anchor_id);
    if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(note.id) || noteIds.has(note.id) || !anchor || !text(note.content, 1000).trim() || !(anchor.type === 'range' ? ['shot', 'motion'] : ['cut', 'emotion']).includes(note.kind)) fail();
    noteIds.add(note.id);
    const key = `${note.anchor_id}:${note.kind}`;
    if (notes.has(key)) fail();notes.set(key, note.content);
  }
  const tuples = state.anchors.map(anchor => {
    const first = notes.get(`${anchor.id}:${anchor.type === 'range' ? 'shot' : 'cut'}`), second = notes.get(`${anchor.id}:${anchor.type === 'range' ? 'motion' : 'emotion'}`);
    const tuple = anchor.type === 'range' ? [0, anchor.start, anchor.end] : [1, anchor.offset];
    if (second !== undefined) tuple.push(first ?? null, second);else if (first !== undefined) tuple.push(first);
    return tuple;
  });
  return {tuples, draft: state.draft, annotations: state.annotations.map(note => ({kind: note.kind, content: note.content, anchor: state.anchors.find(anchor => anchor.id === note.anchor_id)}))};
}
export async function resolveDirectorMarkupReply(message, baseDraft, state) {
  text(message, 4000);text(baseDraft, 8000);
  const match = /(?:^|\n)DM1 data=([A-Za-z0-9_-]+)$/.exec(message);
  if (!match || match[1].length > 3600) fail();
  let payload;
  try {const bytes = Uint8Array.from(atob(match[1].replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0));payload = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));} catch {fail();}
  keys(payload, ['v', 'e', 'm']);
  if (payload.v !== 1 || !Array.isArray(payload.m)) fail();
  let draft = baseDraft;
  if (payload.e !== null) {
    keys(payload.e, ['start', 'end', 'text']);boundary(baseDraft, payload.e.start);boundary(baseDraft, payload.e.end);
    if (payload.e.start > payload.e.end) fail();
    draft = baseDraft.slice(0, payload.e.start) + text(payload.e.text) + baseDraft.slice(payload.e.end);
  }
  const saved = savedMarkup(state);
  if (draft !== saved.draft || JSON.stringify(payload.m) !== JSON.stringify(saved.tuples)) fail();
  const resolved = {draft: saved.draft, annotations: saved.annotations};
  // The compact DM1 text is preserved; add readable, verified content so the
  // model need not invent a decoder or infer which original draft it belongs to.
  const prompt = `${message}\n\n已核对本应用保存的正文与批注，请据此重组结构化视频提示词。批注确认只授权整理提示词，视频生成仍需正常流程。\n${JSON.stringify(resolved)}`;
  if (prompt.length > 16384) throw Error('正文与批注过长，请缩短后再确认');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(resolved)));
  const handoffId = 'director_' + [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  return {text: prompt, metadata: {handoffId}};
}
