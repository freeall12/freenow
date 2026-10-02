// Official performance-rhythm@v3.9ead0d0b.html: cb/Zs/As/bb/hb/Zb.
export const performanceRhythmUri = 'ui://tapnow/performance-rhythm@v3';
export const performanceBeatKinds = Object.freeze(['pause', 'emphasis', 'interruption', 'overlap', 'emotion_turn', 'action']);
export const performanceLocales = Object.freeze(['zh-CN', 'en-US', 'ja-JP', 'ko-KR', 'fr-FR']);
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
const invalid = () => {throw Error('表演节奏数据无效或与已保存节奏不一致');};
function fields(value, allowed) {if (!object(value) || Object.keys(value).some(key => !allowed.includes(key))) invalid();}
function string(value, limit, nonempty = false) {
  if (typeof value !== 'string' || value.length > limit || nonempty && !value.trim()) invalid();
  // Percent encoding used by the official PS1 protocol requires valid Unicode.
  try {encodeURIComponent(value);} catch {invalid();}
  return value;
}
function integer(value, min, max) {if (!Number.isInteger(value) || value < min || value > max) invalid();return value;}
function id(value) {if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,23}$/.test(value)) invalid();return value;}
function duration(value) {return integer(value, 2000, 600000);}
function copyScore(curve, beats, milliseconds) {
  if (!Array.isArray(curve) || curve.length < 3 || curve.length > 12 || !Array.isArray(beats) || beats.length > 24) invalid();
  const points = new Set(), marks = new Set();let previous = -1;
  const copiedCurve = curve.map(point => {
    fields(point, ['id', 'at_ms', 'drive']);id(point.id);integer(point.at_ms, 0, milliseconds);integer(point.drive, 0, 100);
    if (points.has(point.id) || point.at_ms <= previous) invalid();points.add(point.id);previous = point.at_ms;
    return {id: point.id, at_ms: point.at_ms, drive: point.drive};
  });
  if (copiedCurve[0].at_ms !== 0 || copiedCurve.at(-1).at_ms !== milliseconds) invalid();
  const copiedBeats = beats.map(beat => {
    fields(beat, ['id', 'at_ms', 'kind', 'intensity', 'label']);id(beat.id);integer(beat.at_ms, 0, milliseconds);integer(beat.intensity, 1, 3);string(beat.label, 48);
    if (marks.has(beat.id) || !performanceBeatKinds.includes(beat.kind) || beat.label.trim().replace(/\s+/g, ' ') !== beat.label) invalid();marks.add(beat.id);
    return {id: beat.id, at_ms: beat.at_ms, kind: beat.kind, intensity: beat.intensity, label: beat.label};
  });
  return {curve: copiedCurve, beats: copiedBeats};
}
export function preparePerformanceRhythm(data, title = '表演节奏') {
  fields(data, ['duration_ms', 'scene', 'curve', 'beats', 'locale']);
  const milliseconds = duration(data.duration_ms), scene = string(data.scene, 4000, true);
  string(title, 200, true);
  if (data.locale !== undefined && !performanceLocales.includes(data.locale)) invalid();
  return {version: 2, locale: data.locale || 'zh-CN', title, duration_ms: milliseconds, scene, ...copyScore(data.curve, data.beats, milliseconds), summary: title};
}
export function validatePerformanceRhythmState(value, milliseconds) {
  fields(value, ['curve', 'beats', 'playhead_ms', 'selected_id', 'selected_type', 'review_requested']);duration(milliseconds);
  const score = copyScore(value.curve, value.beats, milliseconds);
  integer(value.playhead_ms, 0, milliseconds);
  if (typeof value.review_requested !== 'boolean' || !['point', 'beat'].includes(value.selected_type)) invalid();
  id(value.selected_id);
  if (!(value.selected_type === 'point' ? score.curve : score.beats).some(item => item.id === value.selected_id)) invalid();
  return {...score, playhead_ms: value.playhead_ms, selected_id: value.selected_id, selected_type: value.selected_type, review_requested: value.review_requested};
}
export function initialPerformanceRhythmState(data) {
  const first = data.beats[0] || data.curve[0];
  return validatePerformanceRhythmState({curve: data.curve, beats: data.beats, playhead_ms: 0, selected_id: first.id, selected_type: data.beats.length ? 'beat' : 'point', review_requested: false}, data.duration_ms);
}
export function performanceRhythmToken(milliseconds, state) {
  const saved = validatePerformanceRhythmState(state, milliseconds);
  const curve = saved.curve.map(point => `${point.at_ms}~${point.drive}`).join(',');
  const beats = saved.beats.length ? saved.beats.map((beat, index) => ({beat, index})).sort((a, b) => a.beat.at_ms - b.beat.at_ms || a.index - b.index).map(({beat}) => `${beat.kind}~${beat.at_ms}~${beat.intensity}~${encodeURIComponent(beat.label).replace(/~/g, '%7E')}`).join(',') : '-';
  return `PS1 v=2;duration=${milliseconds};curve=${curve};beats=${beats};review=${saved.review_requested ? 1 : 0}`;
}
const reviseMessages = new Set([
  '这版表演节奏还需要调整，我们回对话继续修改。',
  'I want to adjust this performance rhythm further in chat.',
  'この演技リズムをチャットでさらに調整します。',
  '이 연기 리듬을 대화에서 더 조정할게요.',
  'Je veux encore ajuster ce rythme de jeu dans le chat.',
]);
// Exact mp/Rb summaries from the packaged v3 page; prefix text is never user
// input. Ce rounds the fixed duration to tenths of a second for this summary.
const confirmationSummaries = Object.freeze({
  'zh-CN': ['采用 {duration} 表演节奏：{points} 个曲线点、{beats} 个节拍标记。', '采用 {duration} 表演节奏，并请 Agent 检查对白时长：{points} 个曲线点、{beats} 个节拍标记。'],
  'en-US': ['Use a {duration} performance score: {points} curve points, {beats} beat markers.', 'Use a {duration} performance score and ask Agent to review dialogue timing: {points} curve points, {beats} beat markers.'],
  'ja-JP': ['{duration} の演技リズムを採用：カーブ {points} 点、ビート {beats} 個。', '{duration} の演技リズムを採用し、台詞の尺を確認：カーブ {points} 点、ビート {beats} 個。'],
  'ko-KR': ['{duration} 연기 리듬 사용: 곡선 {points}개, 비트 {beats}개.', '{duration} 연기 리듬을 사용하고 대사 길이 검토 요청: 곡선 {points}개, 비트 {beats}개.'],
  'fr-FR': ['Adopter une partition de {duration} : {points} points, {beats} repères.', 'Adopter une partition de {duration} et vérifier les répliques : {points} points, {beats} repères.'],
});
function confirmationMessage(data, state) {
  const tenths = Math.round(data.duration_ms / 100), values = {duration: `${Math.floor(tenths / 10)}.${tenths % 10}s`, points: state.curve.length, beats: state.beats.length};
  const summary = Object.entries(values).reduce((result, [key, value]) => result.split(`{${key}}`).join(String(value)), confirmationSummaries[data.locale][state.review_requested ? 1 : 0]);
  return `${summary} — ${performanceRhythmToken(data.duration_ms, state)}`;
}
export async function resolvePerformanceRhythmReply(message, data, savedState) {
  string(message, 16384, true);
  const initial = preparePerformanceRhythm({duration_ms: data.duration_ms, scene: data.scene, curve: data.curve, beats: data.beats, locale: data.locale}, data.title);
  if (data.version !== 2) invalid();
  if (reviseMessages.has(message)) return {kind: 'revise', text: message, metadata: {}};
  // Zb first flushes persisted bb state. A failed flush is swallowed by the
  // official page; require the exact saved score before accepting confirmation.
  const state = validatePerformanceRhythmState(savedState, initial.duration_ms);
  if (message !== confirmationMessage(initial, state)) invalid();
  const result = {title: initial.title, scene: initial.scene, duration_ms: initial.duration_ms, curve: state.curve, beats: state.beats, review_requested: state.review_requested};
  const instructions = state.review_requested ? '用户要求检查对白能否在固定时长内自然说完；先报告问题，不能自动修改。' : '用户采用本版表演节奏，请将实际曲线与节拍用于整理表演提示词。';
  const prompt = `${message}\n\n已核对本应用保存的表演节奏。${instructions}曲线表示表演驱动力，不能当作播放速度或实际视频编辑；此确认不提交视频生成。\n${JSON.stringify(result)}`;
  if (prompt.length > 16384) throw Error('表演节奏交接过长，请缩短场景或备注后再确认');
  const hash = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(result)));
  return {kind: 'confirmed', text: prompt, metadata: {handoffId: 'rhythm_' + [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('')}, result};
}
