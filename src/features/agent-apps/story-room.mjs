// Packaged story-room@v1.dae7d235.html: v_/U_/km/$_/b_/P_/we.
export const storyRoomUri = 'ui://tapnow/story-room@v1';
export const storyRoomLocales = Object.freeze(['zh-CN', 'en-US', 'ja-JP', 'ko-KR', 'fr-FR']);
export const storyRoomColors = Object.freeze(['teal', 'blue', 'purple', 'pink', 'coral', 'amber', 'green', 'gray']);
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
const fail = () => {throw Error('剧本结构数据无效或与已保存结构不一致');};
function fields(value, allowed) {if (!object(value) || Object.keys(value).some(key => !allowed.includes(key))) fail();}
function text(value, limit, nonempty = false) {
  if (typeof value !== 'string' || value.length > limit || nonempty && !value.trim()) fail();
  try {encodeURIComponent(value);} catch {fail();}
  return value;
}
function id(value) {if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/.test(value)) fail();return value;}
function list(value, limit) {if (!Array.isArray(value) || value.length > limit) fail();return value;}
function unique(values) {if (new Set(values).size !== values.length) fail();}
function cleanName(value) {return value.replace(/[;|:,=\r\n]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 24);}
export function prepareStoryRoom(data, title = '剧本结构板') {
  fields(data, ['acts', 'scenes', 'plotlines', 'causal_links', 'locale']);text(title, 200, true);
  if (data.locale !== undefined && !storyRoomLocales.includes(data.locale)) fail();
  const acts = list(data.acts, 12).map(act => {fields(act, ['id', 'label']);return {id: id(act.id), label: text(act.label, 100, true)};});
  if (!acts.length) fail();unique(acts.map(act => act.id));
  const plotlines = list(data.plotlines, 12).map(plot => {fields(plot, ['id', 'label', 'color']);if (!storyRoomColors.includes(plot.color)) fail();return {id: id(plot.id), label: text(plot.label, 100, true), color: plot.color};});
  unique(plotlines.map(plot => plot.id));
  const scenes = list(data.scenes, 80).map(scene => {
    fields(scene, ['key', 'act', 'name', 'cast', 'plotline', 'story_time', 'story_order', 'loc', 'synopsis', 'beat', 'has_body']);
    id(scene.key);id(scene.act);
    // The official board reserves every N-prefixed card for its local new scene.
    if (scene.key.startsWith('N') || !acts.some(act => act.id === scene.act)) fail();
    const cast = list(scene.cast, 12).map(person => text(person, 80, true));unique(cast);
    const copy = {key: scene.key, act: scene.act, name: text(scene.name, 200, true), cast};
    if (scene.plotline !== undefined) {if (scene.plotline !== '' && !plotlines.some(plot => plot.id === scene.plotline)) fail();copy.plotline = scene.plotline;}
    for (const [key, limit] of [['story_time', 100], ['loc', 200], ['synopsis', 1000], ['beat', 100]]) if (scene[key] !== undefined) copy[key] = text(scene[key], limit);
    if (scene.story_order !== undefined) {if (scene.story_order !== null && (typeof scene.story_order !== 'number' || !Number.isFinite(scene.story_order) || Math.abs(scene.story_order) > 1e9)) fail();copy.story_order = scene.story_order;}
    if (scene.has_body !== undefined) {if (typeof scene.has_body !== 'boolean') fail();copy.has_body = scene.has_body;}
    return copy;
  });
  unique(scenes.map(scene => scene.key));
  const causal_links = list(data.causal_links, 160).map(link => {
    fields(link, ['from', 'to']);id(link.from);id(link.to);
    if (link.from === link.to || !scenes.some(scene => scene.key === link.from) || !scenes.some(scene => scene.key === link.to)) fail();
    return {from: link.from, to: link.to};
  });
  unique(causal_links.map(link => `${link.from}/${link.to}`));
  const result = {title, locale: data.locale || 'zh-CN', acts, scenes, plotlines, causal_links};
  if (JSON.stringify(result).length > 12000) throw Error('剧本结构输入过长，请缩短场景摘要后重试');
  return result;
}
function prepared(response) {
  fields(response, ['title', 'locale', 'acts', 'scenes', 'plotlines', 'causal_links']);
  return prepareStoryRoom({acts: response.acts, scenes: response.scenes, plotlines: response.plotlines, causal_links: response.causal_links, locale: response.locale}, response.title);
}
export function validateStoryRoomState(value, response) {
  const source = prepared(response);
  fields(value, ['cols', 'news', 'nseq', 'dels', 'filter', 'collapsed', 'stripOpen']);
  fields(value.news, Object.keys(object(value.news) ? value.news : {}));
  const news = {}, entries = Object.entries(value.news);if (entries.length > 80) fail();
  let max = 0;
  for (const [key, scene] of entries) {
    if (!/^N[1-9][0-9]*$/.test(key) || key.length > 16 || !Number.isSafeInteger(Number(key.slice(1)))) fail();
    fields(scene, ['name', 'act']);text(scene.name, 24, true);
    // km trims before slicing: a 24-character truncation can end on a space.
    const cleaned = cleanName(scene.name), truncatedSpace = scene.name.length === 24 && scene.name.endsWith(' ') && cleaned === scene.name.slice(0, -1);
    if (cleaned !== scene.name && !truncatedSpace || !source.acts.some(act => act.id === scene.act)) fail();
    news[key] = {name: scene.name, act: scene.act};max = Math.max(max, Number(key.slice(1)));
  }
  const dels = list(value.dels, 80).map(key => {if (!source.scenes.some(scene => scene.key === key)) fail();return key;});unique(dels);
  const seen = new Set(), cols = list(value.cols, source.acts.length).map((column, index) => {
    fields(column, ['act', 'keys']);if (column.act !== source.acts[index].id) fail();
    return {act: column.act, keys: list(column.keys, 160).map(key => {
      if (typeof key !== 'string' || seen.has(key) || !(source.scenes.some(scene => scene.key === key) ? !dels.includes(key) : Object.hasOwn(news, key))) fail();
      seen.add(key);return key;
    })};
  });
  if (cols.length !== source.acts.length || seen.size !== source.scenes.length - dels.length + entries.length) fail();
  if (!Number.isSafeInteger(value.nseq) || value.nseq < max || value.nseq < 0 || value.nseq >= Number.MAX_SAFE_INTEGER) fail();
  if (value.filter !== null && !source.plotlines.some(plot => plot.id === value.filter)) fail();
  fields(value.collapsed, source.acts.map(act => act.id));
  if (Object.values(value.collapsed).some(collapsed => collapsed !== true) || typeof value.stripOpen !== 'boolean') fail();
  return {cols, news, nseq: value.nseq, dels, filter: value.filter, collapsed: {...value.collapsed}, stripOpen: value.stripOpen};
}
export function initialStoryRoomState(response) {
  const source = prepared(response), collapsed = {};
  if (source.scenes.length > 20) for (const act of source.acts.slice(1)) collapsed[act.id] = true;
  return {cols: source.acts.map(act => ({act: act.id, keys: source.scenes.filter(scene => scene.act === act.id).map(scene => scene.key)})), news: {}, nseq: 0, dels: [], filter: null, collapsed, stripOpen: true};
}
export function storyRoomToken(state) {
  let token = `NS1 v=1;order=${state.cols.map(column => `${column.act}:${column.keys.join(',')}`).join('|')}`;
  const keys = Object.keys(state.news);
  if (keys.length) token += ';' + keys.map(key => `new=${key}:${state.news[key].name}`).join(';');
  if (state.dels.length) token += ';del=' + state.dels.join(',');
  return token;
}
const summaries = Object.freeze({
  'zh-CN': '结构确认：{acts} 幕 {scenes} 场，移动 {moved}，新增 {added}，废弃 {removed}',
  'en-US': 'Structure confirmed: {acts} acts, {scenes} scenes, {moved} moved, {added} added, {removed} discarded',
  'ja-JP': '構成を確定：{acts} 幕、{scenes} シーン。移動 {moved}、追加 {added}、削除 {removed}。',
  'ko-KR': '구조 확인: {acts}막, {scenes}장면. 이동 {moved}개, 추가 {added}개, 삭제 {removed}개.',
  'fr-FR': 'Structure validée : {acts} actes, {scenes} scènes, {moved} déplacées, {added} ajoutées, {removed} supprimées.',
});
const skips = Object.freeze({
  'zh-CN': '先不改结构，继续刚才的事。', 'en-US': 'Keep the structure as is and continue.',
  'ja-JP': '構成は変更せず、そのまま続けてください。', 'ko-KR': '구조를 그대로 유지하고 계속 진행해 주세요.', 'fr-FR': 'Gardez la structure actuelle et continuez.',
});
function movedCount(state, initial) {
  const original = initial.cols.flatMap(column => column.keys.map(key => `${column.act}/${key}`)).filter(item => !state.dels.includes(item.split('/')[1]));
  const current = state.cols.flatMap(column => column.keys.filter(key => !key.startsWith('N')).map(key => `${column.act}/${key}`));
  return current.reduce((count, item, index) => count + (original[index] !== item ? 1 : 0), 0);
}
export async function resolveStoryRoomReply(message, response, savedState) {
  text(message, 16384, true);const source = prepared(response);
  if (message === skips[source.locale]) return {kind: 'skip', text: message, metadata: {}};
  const state = validateStoryRoomState(savedState, source), initial = initialStoryRoomState(source);
  const counts = {acts: state.cols.filter(column => column.keys.length).length, scenes: state.cols.reduce((sum, column) => sum + column.keys.length, 0), moved: movedCount(state, initial), added: Object.keys(state.news).length, removed: state.dels.length};
  const summary = Object.entries(counts).reduce((result, [key, value]) => result.split(`{${key}}`).join(String(value)), summaries[source.locale]);
  if (message !== `${summary} — ${storyRoomToken(state)}`) fail();
  const result = {title: source.title, acts: source.acts, plotlines: source.plotlines, causal_links: source.causal_links, scenes: state.cols.flatMap(column => column.keys.map(key => {
    const original = source.scenes.find(scene => scene.key === key);
    return original ? {...original, act: column.act, source_act: original.act} : {key, name: state.news[key].name, act: column.act, created_in_act: state.news[key].act, cast: [], has_body: false, is_new: true};
  })), discarded: source.scenes.filter(scene => state.dels.includes(scene.key))};
  const prompt = `${message}\n\n已核对本应用保存的剧本结构。请按实际幕与场景顺序整理剧本或结构修改方案；新增场景只有名称，不能声称已有正文。废弃场景仅列入本次方案，画布写入或删除仍需正常修改确认；此确认不授权生成媒体或额外工具权限。原有场景信息与因果关系如下，因果链接保留源数据供检查，不随拖拽伪造：\n${JSON.stringify(result)}`;
  if (prompt.length > 16384) throw Error('剧本结构交接过长，请缩短输入或新增场名后重试');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(result)));
  return {kind: 'confirmed', text: prompt, metadata: {handoffId: 'story_' + [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')}, result};
}
