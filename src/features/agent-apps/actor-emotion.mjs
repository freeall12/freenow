// Contract: unmodified actor-emotion@v1.63ee986b.html, MT/IT/gb/rT/Db/eT.
export const actorEmotionUri = 'ui://tapnow/actor-emotion@v1';
export const actorExpressionGuideTool = 'actor_emotion_save_expression_guide';
export const actorVoicePresets = Object.freeze(['calm', 'happy', 'tender', 'sad', 'angry', 'fearful', 'tense', 'cold']);
const locales = ['zh-CN', 'en-US'], modes = ['image', 'video'];
const fail = () => {throw Error('人物情绪数据无效或与已保存状态及灰模参考不一致');};
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
function fields(value, allowed) {if (!object(value) || Object.keys(value).some(key => !allowed.includes(key))) fail();}
function text(value, max, required = false) {
  if (typeof value !== 'string' || value.length > max || required && !value.trim()) fail();
  try {encodeURIComponent(value);} catch {fail();} return value;
}
function node(value) {if (typeof value !== 'string' || !/^node\/[a-zA-Z0-9_-]{1,180}$/.test(value)) fail();return value;}
function binding(value) {if (typeof value !== 'string' || !/^aem_[a-f0-9]{16}$/.test(value)) fail();return value;}
function integer(value, min, max) {if (!Number.isInteger(value) || value < min || value > max) fail();return value;}
function face(value) {
  fields(value, ['valence', 'stance', 'intensity']);
  return {valence: integer(value.valence, -100, 100), stance: integer(value.stance, -100, 100), intensity: integer(value.intensity, 0, 100)};
}
function voice(value) {
  fields(value, ['preset', 'intensity']);if (!actorVoicePresets.includes(value.preset)) fail();
  return {preset: value.preset, intensity: integer(value.intensity, 0, 100)};
}
function preview(value) {
  text(value, 500000, true);
  if (/^data:image\/(?:png|webp|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) return value;
  let url;try {url = new URL(value);} catch {fail();}
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) fail();return value;
}
export function prepareActorEmotion(data, title = '人物情绪导演台') {
  fields(data, ['locale', 'scene', 'mode', 'source', 'actor', 'face', 'voice', 'dialogue']);
  if (!modes.includes(data.mode) || data.locale !== undefined && !locales.includes(data.locale)) fail();
  fields(data.source, ['node_ref', 'media_kind']);
  if (data.source.media_kind !== data.mode) fail();
  fields(data.actor, ['binding_id', 'name', 'role', 'reference_nodes']);
  if (!Array.isArray(data.actor.reference_nodes) || data.actor.reference_nodes.length < 1 || data.actor.reference_nodes.length > 4) fail();
  const refs = data.actor.reference_nodes.map(item => {fields(item, ['node_ref', 'preview_url']);return {node_ref: node(item.node_ref), preview_url: preview(item.preview_url)};});
  if (new Set(refs.map(item => item.node_ref)).size !== refs.length) fail();
  const result = {version: 1, locale: data.locale || 'zh-CN', title: text(title, 200, true), scene: text(data.scene, 4000), mode: data.mode,
    source: {node_ref: node(data.source.node_ref), media_kind: data.source.media_kind},
    actor: {binding_id: binding(data.actor.binding_id), name: text(data.actor.name, 200, true), role: text(data.actor.role, 1000), reference_nodes: refs}, face: face(data.face)};
  if (data.mode === 'image') {if (data.voice !== undefined || data.dialogue !== undefined) fail();}
  else {result.voice = voice(data.voice);if (data.dialogue !== undefined) result.dialogue = text(data.dialogue, 4000);}
  result.summary = result.title;return result;
}
function prepared(data) {
  fields(data, ['version', 'locale', 'title', 'scene', 'mode', 'source', 'actor', 'face', 'voice', 'dialogue', 'summary']);
  if (data.version !== 1 || typeof data.summary !== 'string') fail();
  const {version, title, summary, ...input} = data;return prepareActorEmotion(input, title);
}
export function validateActorEmotionState(state, data) {
  fields(state, ['version', 'active_tab', 'face', 'voice']);
  if (state.version !== 1 || !['face', 'voice'].includes(state.active_tab)) fail();
  const result = {version: 1, active_tab: state.active_tab, face: face(state.face)};
  if (data.mode === 'image') {if (state.active_tab !== 'face' || state.voice !== undefined) fail();}
  else if (data.mode === 'video') result.voice = voice(state.voice);else fail();
  return result;
}
export function initialActorEmotionState(data) {
  return validateActorEmotionState({version: 1, active_tab: 'face', face: data.face, ...(data.voice ? {voice: data.voice} : {})}, data);
}
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function byteLength(value) {return new TextEncoder().encode(value).length;}
async function digest(bytes) {
  const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
function crc32(bytes) {
  let crc = 0xffffffff;for (const byte of bytes) {crc ^= byte;for (let i = 0; i < 8; i++) crc = crc >>> 1 ^ (crc & 1 ? 0xedb88320 : 0);}
  return (crc ^ 0xffffffff) >>> 0;
}
// Structural validation cannot replace actual image decoding. The persistence
// adapter must decode these exact bytes before committing and returning receipt.
export function actorExpressionImage(value) {
  text(value, 120 * 1024, true);
  const match = /^data:image\/(png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);if (!match || match[2].length % 4) fail();
  let bytes;try {bytes = Uint8Array.from(atob(match[2]), char => char.charCodeAt(0));} catch {fail();}
  let binary = '';for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  if (btoa(binary) !== match[2]) fail();
  const view = new DataView(bytes.buffer), name = (offset, length) => String.fromCharCode(...bytes.subarray(offset, offset + length));
  let width, height;
  if (match[1] === 'png') {
    if (bytes.length < 57 || !equal([...bytes.subarray(0, 8)], [137,80,78,71,13,10,26,10])) fail();
    let offset = 8, header = false, image = false, end = false;
    while (offset + 12 <= bytes.length) {
      const length = view.getUint32(offset), type = name(offset + 4, 4), next = offset + length + 12;
      if (next > bytes.length || end || crc32(bytes.subarray(offset + 4, next - 4)) !== view.getUint32(next - 4)) fail();
      if (!header) {
        if (type !== 'IHDR' || length !== 13) fail();header = true;width = view.getUint32(offset + 8);height = view.getUint32(offset + 12);
        if (![0,2,3,4,6].includes(bytes[offset + 17]) || bytes[offset + 18] !== 0 || bytes[offset + 19] !== 0 || bytes[offset + 20] > 1) fail();
      } else if (type === 'IHDR') fail();
      if (type === 'IDAT') {if (!length) fail();image = true;}
      if (type === 'IEND') {if (length || !image || next !== bytes.length) fail();end = true;}
      offset = next;
    }
    if (!end || offset !== bytes.length) fail();
  } else {
    if (bytes.length < 30 || name(0, 4) !== 'RIFF' || name(8, 4) !== 'WEBP' || view.getUint32(4, true) !== bytes.length - 8) fail();
    let offset = 12, image = false;
    while (offset + 8 <= bytes.length) {
      const type = name(offset, 4), length = view.getUint32(offset + 4, true), start = offset + 8, next = start + length + (length % 2);
      if (next > bytes.length) fail();
      if (type === 'VP8 ') {
        if (length < 10 || (bytes[start] & 1) || name(start + 3, 3) !== '\x9d\x01\x2a') fail();
        width = view.getUint16(start + 6, true) & 0x3fff;height = view.getUint16(start + 8, true) & 0x3fff;image = true;
      } else if (type === 'VP8L') {
        if (length < 5 || bytes[start] !== 0x2f) fail();
        const dimensions = view.getUint32(start + 1, true);width = (dimensions & 0x3fff) + 1;height = (dimensions >>> 14 & 0x3fff) + 1;image = true;
      } else if (type === 'ANIM' || type === 'ANMF') fail();
      offset = next;
    }
    if (!image || offset !== bytes.length) fail();
  }
  if (width !== 512 || height !== 512) fail();return {bytes, mime: 'image/' + match[1], width, height};
}
function guideArguments(args, data, state) {
  fields(args, ['binding', 'mode', 'source_node_ref', 'actor_reference_node_refs', 'face', 'locale', 'image_data_uri']);
  if (byteLength(JSON.stringify(args)) > 128 * 1024 || args.binding !== data.actor.binding_id || args.mode !== data.mode || args.source_node_ref !== data.source.node_ref || args.locale !== data.locale || !equal(args.actor_reference_node_refs, data.actor.reference_nodes.map(item => item.node_ref)) || !equal(face(args.face), state.face)) fail();
}
export async function prepareActorExpressionGuide(params, data, savedState) {
  fields(params, ['name', 'arguments', '_meta']);fields(params._meta, ['tapnow/callId']);
  if (params.name !== actorExpressionGuideTool) fail();
  const callId = text(params._meta['tapnow/callId'], 200, true);
  if (!/^[A-Za-z0-9_-]{8,200}$/.test(callId)) fail();
  const initial = prepared(data), state = validateActorEmotionState(savedState, initial);guideArguments(params.arguments, initial, state);
  const image = actorExpressionImage(params.arguments.image_data_uri), hash = await digest(image.bytes);
  const record = {version: 1, guide_sha256: hash, binding: initial.actor.binding_id, mode: initial.mode,
    source_node_ref: initial.source.node_ref, actor_reference_node_refs: initial.actor.reference_nodes.map(item => item.node_ref), face: state.face,
    locale: initial.locale, mime: image.mime, image_data_uri: params.arguments.image_data_uri};
  // A real saved canvas node must supply node_ref; this pending record is not
  // a successful tool receipt and cannot confirm or queue a handoff.
  return {callId, ...image, record};
}
export async function validateActorExpressionGuide(record, data, savedState) {
  fields(record, ['version', 'node_ref', 'guide_sha256', 'binding', 'mode', 'source_node_ref', 'actor_reference_node_refs', 'face', 'locale', 'mime', 'image_data_uri']);
  if (record.version !== 1 || typeof record.guide_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(record.guide_sha256)) fail();
  node(record.node_ref);const initial = prepared(data), state = validateActorEmotionState(savedState, initial);
  const {version, node_ref, guide_sha256, mime, ...args} = record;guideArguments(args, initial, state);
  const image = actorExpressionImage(record.image_data_uri);
  if (image.mime !== mime || await digest(image.bytes) !== guide_sha256) fail();
  return {node_ref, guide_sha256, binding: record.binding, face: {...state.face}};
}
const anchors = ['joyful', 'resolve', 'angry', 'tense', 'cold', 'sad', 'fearful', 'tender'];
function dominant(value) {
  if (value.intensity === 0 || value.valence === 0 && value.stance === 0) return 'neutral';
  const angle = (Math.atan2(value.stance, value.valence) * 180 / Math.PI + 360) % 360, index = Math.floor(angle / 45), ratio = (angle - index * 45) / 45;
  const weights = Object.fromEntries(anchors.map(id => [id, 0]));weights[anchors[index]] = 1 - ratio;weights[anchors[(index + 1) % 8]] = ratio;
  return anchors.reduce((best, id) => weights[id] > weights[best] ? id : best, anchors[0]);
}
const faceNames = {'zh-CN': {neutral:'中性',joyful:'喜悦',tender:'温柔',sad:'悲伤',angry:'愤怒',fearful:'恐惧',tense:'紧张',cold:'冷峻',resolve:'坚定'}, 'en-US': {neutral:'Neutral',joyful:'Joyful',tender:'Tender',sad:'Sad',angry:'Angry',fearful:'Fearful',tense:'Tense',cold:'Cold',resolve:'Resolve'}};
const voiceNames = {'zh-CN': {calm:'平静',happy:'开心',tender:'温柔',sad:'悲伤',angry:'愤怒',fearful:'恐惧',tense:'紧张',cold:'冷淡'}, 'en-US': {calm:'Calm',happy:'Happy',tender:'Tender',sad:'Sad',angry:'Angry',fearful:'Fearful',tense:'Tense',cold:'Cold'}};
export function actorEmotionConfirmation(data, state, receipt, displayLocale = data.locale) {
  if (!locales.includes(displayLocale)) fail();
  const f = state.face, v = state.voice, name = faceNames[displayLocale][dominant(f)];
  const summary = displayLocale === 'zh-CN' ? `确认人物情绪：面部 ${name}（横轴 ${f.valence}，纵轴 ${f.stance}，强度 ${f.intensity}）${v ? `；声音 ${voiceNames[displayLocale][v.preset]}（强度 ${v.intensity}）` : ''}` : `Confirm actor emotion: face ${name} (x ${f.valence}, y ${f.stance}, intensity ${f.intensity})${v ? `; voice ${voiceNames[displayLocale][v.preset]} (intensity ${v.intensity})` : ''}`;
  return `${summary} — AE2 v=2;binding=${data.actor.binding_id};mode=${data.mode};face=${f.valence}~${f.stance}~${f.intensity};voice=${v ? `${v.preset}~${v.intensity}` : 'none'};guide=${receipt.node_ref};guide_sha256=${receipt.guide_sha256}`;
}
export async function resolveActorEmotionReply(message, data, savedState, savedGuide) {
  text(message, 16384, true);const initial = prepared(data), state = validateActorEmotionState(savedState, initial);
  const receipt = await validateActorExpressionGuide(savedGuide, initial, state);
  // The official page takes display strings from host locale, which may differ
  // from the persisted data locale. Both exact official summaries are bounded.
  if (!locales.some(locale => message === actorEmotionConfirmation(initial, state, receipt, locale))) fail();
  const result = {title: initial.title, scene: initial.scene, mode: initial.mode, source: initial.source,
    actor: {binding_id: initial.actor.binding_id, name: initial.actor.name, role: initial.actor.role, reference_nodes: initial.actor.reference_nodes.map(item => ({node_ref: item.node_ref}))},
    face: state.face, ...(state.voice ? {voice: state.voice} : {}), ...(initial.dialogue !== undefined ? {dialogue: initial.dialogue} : {}), guide: receipt};
  const prompt = `${message}\n\n已核对本应用提交保存的人物情绪与灰模参考。请将面部情绪转换为可观察的眉眼、嘴角、肌肉张力和姿态提示词；声音情绪独立于面部表情。灰模仅为情绪方向参考，此确认仅授权整理提示词，不提交图片、视频或声音生成。\n${JSON.stringify(result)}`;
  if (prompt.length > 16384) throw Error('人物情绪交接过长，请缩短场景或台词后再确认');
  // A repeated official confirmation gets a fresh callId. Real node identity
  // stays in the readable handoff, but equal guide bytes/content must dedupe.
  const identity = {...result, guide: {guide_sha256: receipt.guide_sha256, binding: receipt.binding, face: receipt.face}};
  return {kind: 'confirmed', text: prompt, metadata: {handoffId: 'actor_' + await digest(new TextEncoder().encode(JSON.stringify(identity)))}, result};
}
