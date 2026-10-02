// Protocol source: byte-identical product-kit@v1.758d09b3.html (y_/km/S_/I_/z_/q_/Tm).
export const productKitUri = 'ui://tapnow/product-kit@v1';
export const productKitPolicy = Object.freeze({allowExpanded: false, autoExpandOnReady: false});
export const productKitLocales = Object.freeze(['zh-CN', 'en-US', 'ja-JP', 'ko-KR', 'fr-FR']);
export const productKitRoles = Object.freeze(['scene', 'product', 'information', 'accent', 'brand', 'material']);
export const productKitLimits = Object.freeze({inputChars: 20000, messageChars: 16384, sourceBytes: 8 * 1024 * 1024, previewChars: 500000, timeoutMs: 30000});
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
const fail = message => {throw Object.assign(Error(message || 'Product Kit 数据无效或与已保存状态不一致'), {code: 'invalid_product_kit'});};
function fields(value, allowed) {if (!object(value) || Object.keys(value).some(key => !allowed.includes(key))) fail();}
function text(value, max, clean = true) {
  if (typeof value !== 'string' || !value.length || value.length > max || clean && (value !== value.trim() || /\s{2,}|[\r\n]/.test(value))) fail();
  try {encodeURIComponent(value);} catch {fail();}return value;
}
function list(value, min, max) {if (!Array.isArray(value) || value.length < min || value.length > max) fail();return value;}
function unique(values) {if (new Set(values).size !== values.length) fail();}
function enumeration(value, allowed) {if (!allowed.includes(value)) fail();return value;}
function date(value) {if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000-')) fail();const parsed = new Date(value + 'T00:00:00Z');if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) fail();return value;}
function color(value) {fields(value, ['name', 'hex']);if (!/^#[0-9A-F]{6}$/.test(value.hex)) fail();return {name: text(value.name, 24), hex: value.hex};}
function tone(value) {fields(value, ['word', 'physical']);return {word: text(value.word, 16), physical: text(value.physical, 120)};}
// The host verifies the original template SHA before applying the one local
// thumbnail-validator transport correction. Disk HTML remains byte-identical.
export function prepareProductKit(data, title = 'Product Kit') {
  fields(data, ['version', 'locale', 'variant', 'product', 'kit_version', 'updated_at', 'palette', 'tones', 'look', 'bans', 'copy', 'hypotheses', 'plan_attached', 'summary']);text(title, 200, false);
  if (data.version !== 1 || !Number.isInteger(data.kit_version) || data.kit_version < 1 || data.kit_version > 9999) fail();
  const locale = enumeration(data.locale, productKitLocales), variant = enumeration(data.variant, ['full', 'recall']);
  fields(data.product, ['name', 'category', 'price_band', 'thumbnail_url']);
  if (typeof data.product.thumbnail_url !== 'string' || data.product.thumbnail_url.length > productKitLimits.previewChars || !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(data.product.thumbnail_url)) fail('Product Kit 缩略图必须是宿主读取真实来源生成的有界本地图片');
  const product = {name: text(data.product.name, 20), category: enumeration(data.product.category, ['functional', 'beauty', 'food', 'home', 'apparel', 'trust']), price_band: enumeration(data.product.price_band, ['low', 'mid', 'high']), thumbnail_url: data.product.thumbnail_url};
  const palette = list(data.palette, 4, 6).map((slot, index) => {
    fields(slot, ['role', 'name', 'hex', 'locked', 'source', 'alternatives']);if (slot.role !== productKitRoles[index] || typeof slot.locked !== 'boolean') fail();
    const base = color({name: slot.name, hex: slot.hex}), alternatives = list(slot.alternatives, slot.locked ? 0 : 1, 6).map(color);
    if (slot.locked && (!slot.source || alternatives.length) || !slot.locked && slot.source !== undefined) fail();unique([base.hex, ...alternatives.map(item => item.hex)]);
    return {role: slot.role, ...base, locked: slot.locked, ...(slot.source !== undefined ? {source: text(slot.source, 80)} : {}), alternatives};
  });
  fields(data.tones, ['selected', 'options', 'max']);if (data.tones.max !== 2) fail();
  const options = list(data.tones.options, 1, 8).map(tone), selected = list(data.tones.selected, 1, 2).map(tone), key = item => item.word + '\0' + item.physical;
  unique(options.map(key));unique(selected.map(key));if (selected.some(item => !options.some(option => key(option) === key(item)))) fail();
  fields(data.look, data.look?.state === 'locked' ? ['state', 'sentence', 'locked_at'] : ['state', 'sentence']);enumeration(data.look.state, ['locked', 'unlocked']);
  const look = {state: data.look.state, sentence: text(data.look.sentence, 240), ...(data.look.state === 'locked' ? {locked_at: date(data.look.locked_at)} : {})};
  fields(data.bans, ['product']);const productBans = list(data.bans.product, 0, 12).map(ban => {fields(ban, ['name', 'on']);if (typeof ban.on !== 'boolean') fail();return {name: text(ban.name, 120), on: ban.on};});unique(productBans.map(item => item.name));
  fields(data.copy, ['language', 'voice']);fields(data.copy.language, ['value', 'locked', 'source']);fields(data.copy.voice, ['value', 'options']);if (data.copy.language.locked !== true) fail();
  const voiceOptions = list(data.copy.voice.options, 1, 6).map(value => text(value, 40));unique(voiceOptions);if (!voiceOptions.includes(data.copy.voice.value)) fail();
  const copy = {language: {value: text(data.copy.language.value, 40), locked: true, source: text(data.copy.language.source, 80)}, voice: {value: data.copy.voice.value, options: voiceOptions}};
  const hypotheses = list(data.hypotheses, 0, 12).map(item => {fields(item, ['id', 'text', 'auto_ban']);if (typeof item.id !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,23}$/.test(item.id) || item.auto_ban !== true) fail();return {id: item.id, text: text(item.text, 200), auto_ban: true};});unique(hypotheses.map(item => item.id));
  if (data.plan_attached !== undefined && typeof data.plan_attached !== 'boolean') fail();
  const result = {version: 1, locale, variant, product, kit_version: data.kit_version, updated_at: date(data.updated_at), palette, tones: {selected, options, max: 2}, look, bans: {product: productBans}, copy, hypotheses, ...(data.plan_attached !== undefined ? {plan_attached: data.plan_attached} : {}), summary: text(data.summary, productKitLimits.inputChars, false)};
  if (JSON.stringify({...result, product: {...product, thumbnail_url: ''}}).length > productKitLimits.inputChars) fail('Product Kit 输入过长');return result;
}
export function initialProductKitState(response) {
  const source = prepareProductKit(response);
  return {schema: 'product-kit-widget.v2', kit_version: source.kit_version, view: source.variant, palette: source.palette.map(({role, name, hex}) => ({role, name, hex})), tone_words: source.tones.selected.map(item => item.word), look_state: source.look.state, product_bans: source.bans.product.map(item => ({...item})), voice: source.copy.voice.value, confirmed_ids: []};
}
export function validateProductKitState(value, response) {
  const source = prepareProductKit(response);fields(value, ['schema', 'kit_version', 'view', 'palette', 'tone_words', 'look_state', 'product_bans', 'voice', 'confirmed_ids']);
  if (value.schema !== 'product-kit-widget.v2' || value.kit_version !== source.kit_version) fail();enumeration(value.view, ['full', 'recall']);enumeration(value.look_state, ['locked', 'unlocked']);if (source.look.state === 'unlocked' && value.look_state !== 'unlocked') fail();
  const palette = list(value.palette, source.palette.length, source.palette.length).map((slot, index) => {
    fields(slot, ['role', 'name', 'hex']);const original = source.palette[index];if (slot.role !== original.role || ![original, ...original.alternatives].some(item => item.name === slot.name && item.hex === slot.hex)) fail();return {role: slot.role, name: slot.name, hex: slot.hex};
  });
  const tone_words = list(value.tone_words, 0, 2).map(word => {if (!source.tones.options.some(item => item.word === word)) fail();return word;});unique(tone_words);
  const product_bans = list(value.product_bans, source.bans.product.length, source.bans.product.length).map((ban, index) => {fields(ban, ['name', 'on']);if (ban.name !== source.bans.product[index].name || typeof ban.on !== 'boolean') fail();return {name: ban.name, on: ban.on};});
  if (!source.copy.voice.options.includes(value.voice)) fail();
  const confirmed_ids = list(value.confirmed_ids, 0, source.hypotheses.length).map(id => {if (!source.hypotheses.some(item => item.id === id)) fail();return id;});unique(confirmed_ids);
  return {schema: 'product-kit-widget.v2', kit_version: source.kit_version, view: value.view, palette, tone_words, look_state: value.look_state, product_bans, voice: value.voice, confirmed_ids};
}
export function productKitProjection(response, savedState) {
  const source = prepareProductKit(response), state = validateProductKitState(savedState, source);
  return {palette: source.palette.map((original, index) => ({role: original.role, name: state.palette[index].name, hex: state.palette[index].hex, locked: original.locked, ...(original.locked && original.source ? {source: original.source} : {})})), tones: source.tones.options.filter(item => state.tone_words.includes(item.word)).map(item => ({...item})), look: state.look_state === 'locked' && source.look.state === 'locked' ? {...source.look} : {state: 'unlocked', sentence: source.look.sentence}, bans: {product: state.product_bans.map(item => ({...item}))}, copy: {language: {...source.copy.language}, voice: state.voice}};
}
export function productKitToken(response, savedState) {
  const source = prepareProductKit(response), state = validateProductKitState(savedState, source);
  const ids = source.hypotheses.filter(item => state.confirmed_ids.includes(item.id)).map(item => encodeURIComponent(item.id)).join(',');
  return `PK1 v=1;action=apply;kit_version=${source.kit_version};kit=${encodeURIComponent(JSON.stringify(productKitProjection(source, state)))};confirmed=${ids || '-'}`;
}
export function productKitMessage(response, savedState) {
  const source = prepareProductKit(response), state = validateProductKitState(savedState, source);
  // q_ intentionally uses the same English counts in all five locales.
  return `PRODUCT KIT v${source.kit_version}: ${state.palette.length} colors, ${state.tone_words.length} tones, ${state.confirmed_ids.length} confirmed specs.\n${productKitToken(source, state)}`;
}
export async function resolveProductKitReply(message, response, savedState) {
  text(message, productKitLimits.messageChars, false);const source = prepareProductKit(response), state = validateProductKitState(savedState, source);if (message !== productKitMessage(source, state)) fail();
  const result = {product: {name: source.product.name, category: source.product.category, price_band: source.product.price_band}, kit_version: source.kit_version, updated_at: source.updated_at, locale: source.locale, kit: productKitProjection(source, state), confirmed_hypotheses: source.hypotheses.filter(item => state.confirmed_ids.includes(item.id)), blocked_hypotheses: source.hypotheses.filter(item => !state.confirmed_ids.includes(item.id)), plan_attached: source.plan_attached === true};
  const prompt = `${message}\n\n已核对本应用持久保存的 Product Kit。按下列真实产品素材约束整理用户创作方案；确认的规格由用户声明属实，宿主未独立验证。未确认规格保持禁止入画和文案，不能把猜测写成产品事实。此交接本身不证明已生成图片、广告或任何产物，后续生成和画布写入须走正常工具流程。\n${JSON.stringify(result)}`;
  if (prompt.length > productKitLimits.messageChars) fail('Product Kit 交接过长');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(result)));
  return {kind: 'confirmed', text: prompt, metadata: {handoffId: 'product_kit_' + [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')}, result};
}
