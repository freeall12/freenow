const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const {TaskService} = require('../generation-api.js');
const alias = 'hunyuan-world-panorama';
const modules = () => Promise.all([import('../src/features/image-generation/panorama-native.mjs'), import('../src/features/image-generation/catalog.mjs'), import('../src/features/image-generation/request.mjs')]);
const request = (parameters = {}) => ({kind: 'image.generate', prompt: '保持房间结构，生成完整360度空间', inputs: [{type: 'image', id: 'public-source', url: '/assets/tap-logo.webp'}], parameters: {modelId: alias, ratio: '2:1', isPanoramaPrompt: true, count: 1, ...parameters}});
const metadata = () => ({configured: true, protocol: 'fal-panorama-native', capabilities: {kinds: ['image.generate'], models: {[alias]: {kind: 'image.generate'}}, panorama: {[alias]: {source: 'image', maxImages: 1, maxCount: 1, projection: 'equirectangular', fixedAspectRatio: '2:1', nativeSize: true, editing: false}}}});

test('native alternative is distinct, fixed-size, and requires one ordinary reference', async () => {
  const [, catalog] = await modules(), model = catalog.modelFor(alias);
  assert.equal(model.name, 'Hunyuan World Panorama'); assert.equal(model.nativePanorama, true);
  assert.match(model.tag, /独立替代/); assert.deepEqual(model.ratios, ['2:1']); assert.deepEqual(model.sizes, []);
  for (const mode of ['variants', 'pile', 'spread']) assert.deepEqual(catalog.countsFor(model, mode), [1]);
  for (const refs of [0, 2, {normal: 1, style: 1}, {style: 1}, {omni: 1}]) assert.equal(catalog.inputCompatibility(model, refs).supported, false);
  assert.equal(catalog.inputCompatibility(model, 1).mode, 'image_to_image');
  assert.equal(catalog.modelFor('nano-banana').nativePanorama, undefined);
});

test('switching preserves old image settings and blocks active incompatible camera intent', async () => {
  const [, catalog, requests] = await modules();
  const original = {model: 'Tap Nano 2', ratio: '16:9', quality: '4K', thinking: 'Minimal', count: 4, resultMode: 'spread', cameraEnabled: false, camera: 'Arri Alexa 35', lens: 'Canon K-35', duration: 5, audio: true, audioLabel: '开启', mode: '全能参考', prompt: '原提示词', refs: ['/public.png'], promptReferenceBindings: [{referenceKey: 'saved:0', renderText: 'Image 1'}]};
  const before = structuredClone(original), next = catalog.selectModel(original, alias);
  assert.deepEqual(original, before); assert.equal(next.ratio, '2:1'); assert.equal(next.count, 1); assert.equal(next.resultMode, 'variants'); assert.equal(next.isPanoramaPrompt, true);
  for (const key of ['quality', 'imageSize', 'thinking', 'duration', 'audio', 'audioLabel', 'mode']) assert.equal(Object.hasOwn(next, key), false);
  assert.equal(next.prompt, original.prompt); assert.deepEqual(next.refs, original.refs);
  const prepared = requests.prepareImageRequest({...request(), parameters: next});
  assert.equal(prepared.parameters.model, alias); assert.equal(prepared.parameters.camera, undefined);
  const restored = catalog.selectModel(next, 'nano-banana-flash');
  assert.equal(restored.quality, '4K'); assert.equal(restored.thinking, 'Minimal'); assert.equal(restored.count, 4); assert.equal(restored.resultMode, 'spread');
  for (const incompatible of [{cameraEnabled: true}, {cameraControl: {enabled: true}}, {style: '/style.png'}, {region: {x: 0}}]) assert.throws(() => catalog.selectModel({...original, ...incompatible}, alias));
});

test('strict preparation is pure and idempotent and projects only the native wire contract', async () => {
  const [, , {prepareImageRequest}] = await modules();
  const original = request({model: 'Hunyuan World Panorama', prompt: '本地编辑器字段', refs: ['/assets/tap-logo.webp'], referenceOrder: ['node:public-source'], promptReferenceBindings: [], modelSettings: {'nano-banana-flash': {quality: '4K'}}, cameraEnabled: false});
  const before = structuredClone(original), prepared = prepareImageRequest(original);
  assert.deepEqual(original, before); assert.deepEqual(prepareImageRequest(prepared), prepared);
  assert.deepEqual(prepared.parameters, {model: alias, modelId: alias, ratio: '2:1', count: 1, resultMode: 'variants', isPanoramaPrompt: true, providerParameters: {model: alias, mode: 'image_to_image', aspectRatio: '2:1', times: 1, isPanoramaPrompt: true}});
  assert.equal(prepareImageRequest(request({aspect: '2:1'})).parameters.aspect, undefined, 'Agent aspect facade is checked then projected to ratio');
  assert.throws(() => prepareImageRequest(request({aspect: '16:9'})), /画幅/);
});

test('unsupported intent is rejected before normalization or any provider call', async () => {
  const [, , {prepareImageRequest}] = await modules();
  const invalid = [request({ratio: '16:9'}), request({count: 2}), request({times: 2}), request({resultMode: 'spread'}), request({isPanoramaPrompt: false}), request({cameraEnabled: true}), request({cameraControl: {enabled: true}}), request({quality: '2K'}), request({thinking: 'high'}), request({seed: 4}), request({mask: '/mask.png'}), request({style: '/style.png'}), request({webSearch: true}), request({providerParameters: {model: 'nano-banana'}}), request({providerParameters: {quality: 'high'}}), request({canvasResults: {targetNodeIds: ['one', 'two']}}), {...request(), prompt: ' '}, {...request(), inputs: []}, {...request(), inputs: [request().inputs[0], {type: 'text', text: 'extra'}]}, {...request(), inputs: [{type: 'image', url: '/image.png', role: 'style'}]}, {...request(), kind: 'panorama.edit'}];
  let calls = 0;
  const service = new TaskService({prepareRequest: prepareImageRequest}); service.setProvider({generate: async () => {calls++; return {outputs: [{type: 'image', url: '/result.png'}]};}});
  for (const value of invalid) {
    const before = structuredClone(value); assert.throws(() => prepareImageRequest(value)); assert.deepEqual(value, before);
    const job = service.submit(value); await new Promise(resolve => setImmediate(resolve)); assert.equal(job.status, 'failed');
  }
  assert.equal(calls, 0);
  for (const extra of [{fullImage: '/different.png'}, {image: '/other.png'}, {crop: null}, {sourceUrl: '/old.png'}]) assert.throws(() => prepareImageRequest({...request(), inputs: [{...request().inputs[0], ...extra}]}), /输入/);
});

test('configured route must publish this exact native profile without supplier fallback', async () => {
  const [{assertNativePanoramaConfiguration}] = await modules();
  const ready = metadata(); assert.equal(assertNativePanoramaConfiguration(ready, request()).parameters.model, alias);
  const routed = {configured: true, protocol: 'routed', routes: {'image.generate': {models: {[alias]: 'panorama'}}}, providers: {panorama: ready}};
  assert.equal(assertNativePanoramaConfiguration(routed, request()).parameters.count, 1);
  for (const patch of [{source: 'text'}, {maxImages: 2}, {maxCount: 2}, {projection: 'rectilinear'}, {fixedAspectRatio: '16:9'}, {nativeSize: false}, {editing: true}]) {
    const changed = metadata(); Object.assign(changed.capabilities.panorama[alias], patch); assert.throws(() => assertNativePanoramaConfiguration(changed, request()));
  }
  for (const changed of [{...ready, configured: false}, {...ready, protocol: 'tasks-v1'}, {...ready, capabilities: {kinds: ['image.generate'], models: {}}}, {...routed, routes: {'image.generate': {models: {[alias]: 'missing'}}}}]) assert.throws(() => assertNativePanoramaConfiguration(changed, request()));
});

test('native results require a successful actual 2:1 decode before returning measured dimensions', async () => {
  const [{validateNativePanoramaOutputs}] = await modules(); let decodes = 0;
  const output = {type: 'image', url: '/api/generation/media/public.png', sourceFileId: 'fal-public-task'};
  const before = structuredClone(output), result = await validateNativePanoramaOutputs([output], {decode: async url => {assert.equal(url, output.url); decodes++; return {width: 2048, height: 1024};}});
  assert.equal(decodes, 1); assert.deepEqual(output, before); assert.deepEqual(result, [{...output, width: 2048, height: 1024}]);
  for (const actual of [{width: 1024, height: 1024}, {width: 2047, height: 1024}, {width: 0, height: 0}, {width: 2, height: .5}, {}]) await assert.rejects(validateNativePanoramaOutputs([{...output, width: 2048, height: 1024}], {decode: async () => actual}));
  await assert.rejects(validateNativePanoramaOutputs([{...output, width: 4096, height: 2048}], {decode: async () => ({width: 2048, height: 1024})}));
  await assert.rejects(validateNativePanoramaOutputs([output], {decode: async () => {throw Error('decode failed');}}), /decode failed/);
  for (const outputs of [[], [output, output], [{type: 'video', url: '/video.mp4'}], [{type: 'image'}]]) await assert.rejects(validateNativePanoramaOutputs(outputs, {decode: async () => assert.fail('invalid envelopes must not decode')}));
  for (const key of ['image', 'fullImage']) await assert.rejects(validateNativePanoramaOutputs([{...output, [key]: '/different-1x1.png'}], {decode: async () => assert.fail('conflicting output references must not decode')}), /不一致图片引用/);
  const controller = new AbortController(); await assert.rejects(validateNativePanoramaOutputs([output], {signal: controller.signal, decode: async () => {controller.abort(Error('cancelled')); return {width: 4, height: 2};}}), /cancelled/);
});

test('production editor global count layout cannot increase a native panorama request', async () => {
  const [,{modelFor}] = await modules(), resultCounts = await import('../src/features/generation-results/counts.mjs');
  const source = fs.readFileSync(require.resolve('../node-editor.js'), 'utf8');
  const context = {resultCounts, resultMode: 'spread', node: {id: 'target', type: 'image'}, config: {model: 'Hunyuan World Panorama', count: 12, times: 12, prompt: '公共提示词'}, panel: {hidden: false}, imageMenus: {modelFor}, save() {}, closePopover() {}, refreshFooter() {}, position() {}};
  vm.createContext(context); vm.runInContext(source.slice(source.indexOf('  function countConfiguration('), source.indexOf('  function getConfig(')), context);
  for (const mode of ['spread', 'pile', 'variants']) {context.syncResultCountMode({detail: {mode}}); assert.equal(context.config.count, 1); assert.equal(context.config.times, 1); assert.equal(context.config.resultMode, 'variants'); assert.equal(context.config.prompt, '公共提示词');}
});

test('native editor reopening does not reintroduce generic quality or activate a remembered camera', async () => {
  const [,{modelFor}] = await modules(); const source = fs.readFileSync(require.resolve('../node-editor.js'), 'utf8');
  const context = {imageMenus: {modelFor}, drafts: {}, cameraControls: {initialSettings: () => ({cameraEnabled: true})}, defaults: () => ({quality: '2K', thinking: 'high', camera: 'Sony Venice', count: 4}), normalizeCountConfig: value => value};
  vm.createContext(context); vm.runInContext(source.slice(source.indexOf('  function getConfig('), source.indexOf('  function save(')), context);
  const reopened = context.getConfig({id: 'target', type: 'image', generation: {modelId: alias, model: 'Hunyuan World Panorama', isPanoramaPrompt: true, ratio: '2:1', count: 1}});
  assert.equal(reopened.cameraEnabled, false); for (const key of ['quality', 'thinking', 'audioLabel']) assert.equal(reopened[key], undefined);
  assert.equal(context.getConfig({id: 'target', type: 'image', generation: {...reopened, cameraEnabled: true}}).cameraEnabled, true, 'activated incompatible intent remains visible to request validation');
});

test('Agent native draft never inherits hidden resolution, thinking or result layout from another model', async () => {
  const model = await import('../src/features/agent-generation/model.mjs'), {parse} = require('../agent-tools.js');
  const nodes = [{id: 'source', type: 'image', image: '/public.png'}], args = {kind: 'image.generate', nodeId: 'source', model: alias, prompt: '公开源图转全景'};
  const draft = model.createGenerationDraft(args, {quality: '4K', outputQuality: 'high', thinking: 'high', count: 12, ratio: '16:9', resultMode: 'spread', audio: true}, nodes);
  assert.equal(draft.isPanoramaPrompt, true); assert.equal(draft.aspect, '2:1'); assert.equal(draft.count, 1); assert.equal(draft.resultMode, 'variants');
  for (const key of ['quality', 'imageSize', 'thinking', 'duration', 'generateAudio']) assert.equal(draft[key], undefined);
  assert.equal(model.compatibility(args.kind, model.findModel(args.kind, alias), model.referenceShape(args, nodes), draft), '');
  assert.deepEqual(model.parameterOptions(draft, nodes), {aspect: ['2:1'], imageSize: [], quality: [], count: [1]});
  const confirmed = model.confirmedArguments(args, draft, nodes); assert.equal(confirmed.isPanoramaPrompt, true); assert.equal(confirmed.aspect, '2:1'); assert.equal(confirmed.count, 1); assert.deepEqual(parse('generation_submit', confirmed).args, confirmed);
});

test('Agent native confirmation rejects explicit unsupported intent and keeps one actual image reference', async () => {
  const model = await import('../src/features/agent-generation/model.mjs');
  const nodes = [{id: 'source', type: 'image', image: '/public.png'}, {id: 'other', type: 'image', image: '/other.png'}, {id: 'text', type: 'text', content: 'extra'}];
  const args = {kind: 'image.generate', nodeId: 'source', model: alias, prompt: '公开全景'};
  for (const extra of [{imageSize: '4K'}, {quality: 'high'}, {count: 2}, {aspect: '16:9'}, {isPanoramaPrompt: false}, {cameraEnabled: true}, {seed: 2}, {duration: 5}, {referenceIds: ['source', 'other']}, {referenceIds: ['source', 'text']}]) {
    const original = {...args, ...extra}, draft = model.createGenerationDraft(original, {}, nodes);
    for (const [key, value] of Object.entries(extra)) assert.deepEqual(draft[key], value, 'explicit incompatible fields remain reviewable');
    assert.throws(() => model.confirmedArguments(original, draft, nodes));
  }
  const draft = model.createGenerationDraft(args, {cameraEnabled: true}, nodes);
  assert.match(draft.nativePanoramaInheritedIntent, /相机/); assert.throws(() => model.confirmedArguments(args, draft, nodes), /相机/);
});

test('Agent explicit model switch restores old parameters and batch carries panorama opt-in per task', async () => {
  const model = await import('../src/features/agent-generation/model.mjs'), batch = await import('../src/features/agent-generation/batch.mjs');
  const nodes = [{id: 'source', type: 'image', image: '/public.png'}, {id: 'other', type: 'image', image: '/other.png'}];
  const args = id => ({kind: 'image.generate', nodeId: id, model: 'nano-banana-flash', prompt: '公开提示词', aspect: '16:9', imageSize: '4K', count: 4});
  const initial = model.createGenerationDraft(args('source'), {}, nodes), panorama = model.selectGenerationModel(initial, alias, nodes);
  assert.equal(panorama.imageSize, undefined); assert.equal(panorama.isPanoramaPrompt, true); assert.equal(panorama.count, 1);
  const restored = model.selectGenerationModel(panorama, 'nano-banana-flash', nodes); assert.equal(restored.imageSize, '4K'); assert.equal(restored.aspect, '16:9'); assert.equal(restored.count, 4); assert.equal(restored.isPanoramaPrompt, undefined);
  const trace = {batchItems: ['source', 'other'].map((id, index) => ({callId: 'call-' + index, args: args(id)}))};
  const items = trace.batchItems.map(item => ({args: model.createGenerationDraft(item.args, {}, nodes), rejected: false}));
  const shared = batch.changeBatch(items[0].args, items, 'model', alias, nodes), decisions = batch.batchDecisions(trace, shared, items, nodes);
  for (const decision of decisions) {assert.equal(decision.args.model, alias); assert.equal(decision.args.count, 1); assert.equal(decision.args.isPanoramaPrompt, true); assert.equal(decision.args.imageSize, undefined);}
  items[1].args.nativePanoramaInheritedIntent = '第二个来源启用了相机'; assert.match(batch.batchCompatibility(shared, items, nodes), /第二个来源/);
});
