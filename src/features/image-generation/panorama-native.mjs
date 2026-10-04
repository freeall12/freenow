import { resolveProviderConfiguration, providerConfigurationStatus } from '../node-composer/provider-configuration.mjs';

export const panoramaModelId = 'hunyuan-world-panorama';
export const panoramaModelName = 'Hunyuan World Panorama';
const fail = message => Object.assign(new Error(message), {code: 'unsupported_generation', providerDispatched: false});
const active = value => value !== undefined && value !== null && value !== false && value !== '';
const identifiers = new Set([panoramaModelId, panoramaModelName]);
export const isNativePanoramaModel = value => identifiers.has(typeof value === 'object' ? value?.id : value);
export function isNativePanoramaRequest(request) {
  const p = request?.parameters || {};
  return [p.model, p.modelId, p.providerParameters?.model].some(isNativePanoramaModel);
}

// Camera labels remain in old drafts even with Lens Off. The explicit toggle
// distinguishes those remembered choices from an intent we must not discard.
export function nativePanoramaIntentError(config) {
  if (config.cameraEnabled === true || config.cameraControl && config.cameraControl.enabled !== false ||
      Object.entries({camera: 'Sony Venice', lens: 'Zeiss Ultra Prime', focal: '24mm', aperture: 'ƒ/4'}).some(([key, value]) => active(config[key]) && config[key] !== value) && config.cameraEnabled !== false)
    return 'Hunyuan 全景不支持相机控制，请先关闭 Lens';
  if (['style', 'omni', 'mask', 'region', 'crop', 'sourceClip', 'editing', 'cameraPath'].some(key => active(config[key])))
    return 'Hunyuan 全景只支持普通源图，不支持风格、区域或相机编辑';
  return '';
}

const localKeys = new Set(['aspect', 'prompt', 'refs', 'referenceBindings', 'referenceOrder', 'promptReferenceBindings', 'inputCounts', 'modelSettings', 'cameraEnabled', 'cameraControl', 'camera', 'lens', 'focal', 'aperture', 'style', 'omni', 'mask', 'region', 'crop', 'sourceClip', 'editing', 'cameraPath']);
const allowedKeys = new Set(['model', 'modelId', 'providerParameters', 'ratio', 'aspectRatio', 'isPanoramaPrompt', 'count', 'times', 'resultMode', 'canvasResults', 'batch_count', 'batch_id', 'is_regeneration', 'layout']);
const wireKeys = new Set(['model', 'mode', 'aspectRatio', 'times', 'isPanoramaPrompt']);
const inputKeys = new Set(['type', 'url', 'id', 'nodeId', 'key', 'title', 'name', 'role', 'width', 'height', 'mimeType']);
export function prepareNativePanoramaRequest(request) {
  if (!isNativePanoramaRequest(request)) return request;
  const p = request.parameters || {}, wire = p.providerParameters || {};
  if (request.kind !== 'image.generate') throw fail('Hunyuan 全景仅支持图片生成，不支持世界生成或区域编辑');
  if (typeof request.prompt !== 'string' || !request.prompt.trim() || request.prompt.length > 32768)
    throw fail('图生360全景需要非空提示词，最长32768字符');
  if (!Array.isArray(request.inputs) || request.inputs.length !== 1 || request.inputs[0]?.type !== 'image' || request.references?.length)
    throw fail('图生360全景必须绑定且只提交一张普通参考图');
  const image = request.inputs[0];
  if (Object.keys(image).some(key => !inputKeys.has(key)) || image.role && !['reference', 'source_image'].includes(image.role))
    throw fail('图生360全景不支持选段、风格或区域输入');
  for (const model of [p.model, p.modelId, wire.model]) if (model !== undefined && !identifiers.has(model))
    throw fail('全景模型身份不一致，未替换所选型号');
  const flags = [p.isPanoramaPrompt, wire.isPanoramaPrompt].filter(value => value !== undefined);
  if (!flags.length || flags.some(value => value !== true)) throw fail('请明确选择图生360全景');
  if ([p.ratio, p.aspectRatio, p.aspect, wire.aspectRatio].some(value => value !== undefined && value !== '2:1'))
    throw fail('Hunyuan 原生全景固定2:1，不会修改画幅后提交');
  if ([request.count, p.count, p.times, p.batch_count, wire.times, p.canvasResults?.targetNodeIds?.length].some(value => value !== undefined && value !== 1))
    throw fail('Hunyuan 全景每个任务只生成一张图片');
  if (p.resultMode !== undefined && p.resultMode !== 'variants' || wire.mode !== undefined && wire.mode !== 'image_to_image')
    throw fail('Hunyuan 全景只支持单图转全景及单结果');
  const intentError = nativePanoramaIntentError(p);
  if (intentError) throw fail(intentError);
  if (Object.keys(wire).some(key => !wireKeys.has(key)) || Object.keys(p).some(key => !allowedKeys.has(key) && !localKeys.has(key)))
    throw fail('Hunyuan 全景使用原生尺寸，不支持画质、种子、步数、思考或额外设置');
  const parameters = Object.fromEntries(Object.entries(p).filter(([key]) => allowedKeys.has(key)));
  return {...request, parameters: {...parameters, model: panoramaModelId, modelId: panoramaModelId,
    ratio: '2:1', isPanoramaPrompt: true, count: 1, resultMode: 'variants',
    providerParameters: {model: panoramaModelId, mode: 'image_to_image', aspectRatio: '2:1', times: 1, isPanoramaPrompt: true}}};
}

export function assertNativePanoramaConfiguration(metadata, request) {
  if (!isNativePanoramaRequest(request)) return request;
  const prepared = prepareNativePanoramaRequest(request), selected = resolveProviderConfiguration(metadata, prepared);
  const state = providerConfigurationStatus(metadata, prepared), profile = selected?.capabilities?.panorama?.[panoramaModelId];
  if (state.configured !== true) throw fail(state.message);
  if (selected.protocol !== 'fal-panorama-native' || profile?.source !== 'image' || profile.maxImages !== 1 || profile.maxCount !== 1 ||
      profile.projection !== 'equirectangular' || profile.fixedAspectRatio !== '2:1' || profile.nativeSize !== true || profile.editing !== false)
    throw fail('所选供应商未声明 Hunyuan 原生图生360全景能力，不会转交其他图片模型');
  return prepared;
}

export function decodePanoramaImage(url, {signal, timeout = 15000} = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {reject(signal.reason || fail('全景解码已取消')); return;}
    const image = new Image();
    const settle = (error, value) => {
      clearTimeout(timer); signal?.removeEventListener('abort', abort); image.onload = image.onerror = null;
      if (error) {image.src = ''; reject(error);} else resolve(value);
    };
    const abort = () => settle(signal.reason || fail('全景解码已取消'));
    const timer = setTimeout(() => settle(fail('全景结果解码超时，未回填')), timeout);
    signal?.addEventListener('abort', abort, {once: true});
    image.onerror = () => settle(fail('全景结果无法解码，未回填'));
    image.onload = () => settle(null, {width: image.naturalWidth, height: image.naturalHeight});
    image.src = url;
  });
}

// The returned dimensions are measured from pixels, never trusted supplier
// labels. Call before any canvas/history insertion; callers retain source guards.
export async function validateNativePanoramaOutputs(outputs, {decode = decodePanoramaImage, signal} = {}) {
  if (!Array.isArray(outputs) || outputs.length !== 1 || outputs[0]?.type !== 'image' || typeof outputs[0].url !== 'string' || !outputs[0].url)
    throw fail('全景结果须为一张可解码图片，未回填');
  const output = outputs[0];
  if (['image', 'fullImage'].some(key => output[key] !== undefined && output[key] !== null && output[key] !== '' && output[key] !== output.url))
    throw fail('全景结果包含不一致图片引用，未回填');
  const actual = await decode(output.url, {signal});
  if (signal?.aborted) throw signal.reason || fail('全景结果已取消');
  if (!Number.isSafeInteger(actual?.width) || !Number.isSafeInteger(actual?.height) || actual.height < 1 || actual.width !== 2 * actual.height ||
      [output.width, output.height].some((value, index) => value !== undefined && value !== actual[index ? 'height' : 'width']))
    throw fail('全景结果实际尺寸不是2:1或与回执不一致，未回填');
  return [{...output, width: actual.width, height: actual.height}];
}
