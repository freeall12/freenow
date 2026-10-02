// Protocol/layout source: unmodified cutlist-review@v1.a3b10365.html (__/wm/z_/we).
export const cutlistReviewUri = 'ui://tapnow/cutlist-review@v1';
export const cutlistReviewPolicy = Object.freeze({allowExpanded: false, autoExpandOnReady: false});
export const cutlistReviewLocales = Object.freeze(['zh-CN', 'en-US', 'ja-JP', 'ko-KR', 'fr-FR']);
export const cutlistReviewBudget = Object.freeze({videoBytes: 8 * 1024 * 1024, totalBytes: 16 * 1024 * 1024, responseBytes: 15 * 1024 * 1024, timeoutMs: 30000});
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
const fail = () => {throw Error('拼装审阅数据无效或与已保存裁切计划不一致');};
function fields(value, allowed) {if (!object(value) || Object.keys(value).some(key => !allowed.includes(key))) fail();}
function text(value, max, required = false) {if (typeof value !== 'string' || value.length > max || required && !value.trim()) fail();try {encodeURIComponent(value);} catch {fail();}return value;}
function integer(value, min, max) {if (!Number.isSafeInteger(value) || value < min || value > max) fail();return value;}
function range(value, duration) {const in_ms = integer(value.in_ms, 0, duration - 100), out_ms = integer(value.out_ms, in_ms + 100, duration);return {in_ms, out_ms};}
export function prepareCutlistReview(data, title = '拼装审阅') {
  fields(data, ['locale', 'ratio', 'notes', 'target_duration_s', 'shots']);text(title, 200, true);
  if (data.locale !== undefined && !cutlistReviewLocales.includes(data.locale) || !Array.isArray(data.shots) || !data.shots.length || data.shots.length > 50) fail();
  const result = {title, locale: data.locale || 'zh-CN'};
  for (const [key, max] of [['ratio', 32], ['notes', 2000]]) if (data[key] !== undefined) result[key] = text(data[key], max);
  if (data.target_duration_s !== undefined) {if (!Number.isFinite(data.target_duration_s) || data.target_duration_s <= 0 || data.target_duration_s > 180) fail();result.target_duration_s = data.target_duration_s;}
  let previewTotal = 0;
  result.shots = data.shots.map(shot => {
    fields(shot, ['id', 'label', 'media_duration_ms', 'in_ms', 'out_ms', 'default_keep', 'preview_url', 'trim_reason', 'flag', 'flag_note']);
    if (typeof shot.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,179}$/.test(shot.id) || typeof shot.default_keep !== 'boolean') fail();
    const duration = integer(shot.media_duration_ms, 100, 36000000);
    const copy = {id: shot.id, label: text(shot.label, 200, true), media_duration_ms: duration, ...range(shot, duration), default_keep: shot.default_keep};
    for (const key of ['trim_reason', 'flag_note']) if (shot[key] !== undefined) copy[key] = text(shot[key], 1000);
    if (shot.flag !== undefined) {if (!['aggressive_trim', 'drop_suggested', 'ratio_mismatch'].includes(shot.flag)) fail();copy.flag = shot.flag;}
    // Runtime replaces an actual node's URL with bounded decoded video bytes.
    if (shot.preview_url !== undefined) {
      if (typeof shot.preview_url !== 'string' || !shot.preview_url || shot.preview_url.length > 12 * 1024 * 1024) fail();
      previewTotal += shot.preview_url.length;
      if (previewTotal > cutlistReviewBudget.responseBytes) throw Error('拼装审阅视频预览超过整页15MiB预算，请减少片段后重试');
      if (!/^data:video\/(?:mp4|webm);base64,[A-Za-z0-9+/]+={0,2}$/.test(shot.preview_url)) {
        let url;try {url = new URL(shot.preview_url);} catch {fail();}
        if (!['http:', 'https:', 'blob:'].includes(url.protocol) || url.username || url.password) fail();
      }
      copy.preview_url = shot.preview_url;
    }
    return copy;
  });
  if (new Set(result.shots.map(shot => shot.id)).size !== result.shots.length) fail();
  if (new TextEncoder().encode(JSON.stringify(result)).length > cutlistReviewBudget.responseBytes) throw Error('拼装审阅视频预览超过整页15MiB预算，请减少片段后重试');
  return result;
}
function prepared(response) {fields(response, ['title', 'locale', 'ratio', 'notes', 'target_duration_s', 'shots']);const {title, ...data} = response;return prepareCutlistReview(data, title);}
export function validateCutlistReviewState(value, response) {
  const source = prepared(response);fields(value, ['shots']);fields(value.shots, source.shots.map(shot => shot.id));
  if (Object.keys(value.shots).length !== source.shots.length) fail();const shots = {};
  for (const shot of source.shots) {const state = value.shots[shot.id];fields(state, ['keep', 'in_ms', 'out_ms']);if (typeof state.keep !== 'boolean') fail();shots[shot.id] = {keep: state.keep, ...range(state, shot.media_duration_ms)};}
  return {shots};
}
export function initialCutlistReviewState(response) {const source = prepared(response);return {shots: Object.fromEntries(source.shots.map(shot => [shot.id, {keep: shot.default_keep, in_ms: shot.in_ms, out_ms: shot.out_ms}]))};}
export function cutlistReviewToken(response, savedState) {
  const source = prepared(response), state = validateCutlistReviewState(savedState, source), kept = source.shots.filter(shot => state.shots[shot.id].keep), dropped = source.shots.filter(shot => !state.shots[shot.id].keep);
  return `CR1 v=1;keep=${kept.map(shot => `${shot.id}:${state.shots[shot.id].in_ms}-${state.shots[shot.id].out_ms}`).join(',')}${dropped.length ? `;drop=${dropped.map(shot => shot.id).join(',')}` : ''};confirm=1`;
}
const messages = Object.freeze({
  'zh-CN': ['确认拼装计划：保留 {k}/{t} 段，总时长 {dur}s', '确认拼装计划：保留 {k}/{t} 段，总时长 {dur}s（目标 {target}s）', '这版拼装计划再改改，我们回对话里继续调整。'],
  'en-US': ['Confirm the cut plan: keeping {k}/{t} shots, {dur}s total', 'Confirm the cut plan: keeping {k}/{t} shots, {dur}s total (target {target}s)', "Let's tweak this cut plan - back to chat to adjust."],
  'ja-JP': ['編集プランを確定：{k}/{t} ショット採用、合計 {dur} 秒', '編集プランを確定：{k}/{t} ショット採用、合計 {dur} 秒（目標 {target} 秒）', 'この編集プランを会話でさらに調整してください。'],
  'ko-KR': ['편집 계획 확인: {k}/{t}개 샷 유지, 총 {dur}초', '편집 계획 확인: {k}/{t}개 샷 유지, 총 {dur}초 (목표 {target}초)', '이 편집 계획을 대화에서 더 조정해 주세요.'],
  'fr-FR': ['Montage validé : {k}/{t} plans conservés, {dur} s au total', 'Montage validé : {k}/{t} plans conservés, {dur} s au total (objectif {target} s)', 'Reprenons ce plan de montage dans la conversation pour l’ajuster.'],
});
export function cutlistReviewSeconds(milliseconds) {const tenths = Math.round(milliseconds / 100);return tenths % 10 === 0 ? String(tenths / 10) : (tenths / 10).toFixed(1);}
export async function resolveCutlistReviewReply(message, response, savedState) {
  text(message, 16384, true);const source = prepared(response), locale = messages[source.locale];
  // Official revise resets suggestions and sends no CR1; it cannot adopt edits.
  if (message === locale[2]) return {kind: 'revise', text: message, metadata: {}};
  const state = validateCutlistReviewState(savedState, source), kept = source.shots.filter(shot => state.shots[shot.id].keep), duration = kept.reduce((sum, shot) => sum + state.shots[shot.id].out_ms - state.shots[shot.id].in_ms, 0);
  if (!kept.length || duration > 180000) fail();
  const values = {k: kept.length, t: source.shots.length, dur: cutlistReviewSeconds(duration), target: source.target_duration_s ?? 0};
  const summary = Object.entries(values).reduce((text, [key, value]) => text.split(`{${key}}`).join(String(value)), locale[source.target_duration_s !== undefined ? 1 : 0]);
  if (message !== `${summary} — ${cutlistReviewToken(source, state)}`) fail();
  const result = {title: source.title, ...(source.ratio !== undefined ? {ratio: source.ratio} : {}), ...(source.notes !== undefined ? {notes: source.notes} : {}), ...(source.target_duration_s !== undefined ? {target_duration_s: source.target_duration_s} : {}), duration_ms: duration,
    shots: source.shots.map(({preview_url, ...shot}) => ({...shot, node_ref: 'node/' + shot.id, keep: state.shots[shot.id].keep, in_ms: state.shots[shot.id].in_ms, out_ms: state.shots[shot.id].out_ms})), time_basis: 'source', order: 'fixed'};
  const prompt = `${message}\n\n已核对真实视频来源及本应用已保存的保留/丢弃和裁切区间，顺序固定。审核确认不是生成授权，也不会自动裁剪、拼装或删除来源节点。请按实际计划整理剪辑方案；只有后续明确授权并经正常工具确认，才可使用本地视频裁剪/拼装。未取得实际产物、保存和解码回执前不得声称已经完成剪辑或观看完整视频。丢弃仅指本次计划排除；预览/参数不代表模型评判或真实成片。\n${JSON.stringify(result)}`;
  if (prompt.length > 16384) throw Error('拼装审阅交接过长，请减少片段或缩短说明');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(result)));
  return {kind: 'confirmed', text: prompt, metadata: {handoffId: 'cutlist_' + [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')}, result};
}
