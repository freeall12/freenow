const test = require('node:test'), assert = require('node:assert/strict');
const TemplatesCore = require('../templates-core.js');
const core = import('../src/features/workflow-templates/core.mjs');
const source = 'https://public.example/result.mp4';
function fixture() {
  return {id: 'official-template', name: 'API fallback', i18n_content: {title: {zh: '真实工作流'}, des: {zh: '说明'}}, created_at: '2026-04-21T12:30:20.819823Z', preview_image: 'assets/cover.png', cover_media_type: 'image', category: 'workflow', tags: ['workflow'], approved_by: 'private-user', source_template_id: 'private-source', template_data: {
    nodes: [
      {id: 'image-a', type: 'image', parentId: 'omitted-capture-group', position: {x: 14.56, y: 25.12}, width: 250.125, height: 448.75, data: {title: 'Reference', src: 'assets/ref.webp', prompt: 'keep original words', params: {model: 'provider-original-model', aspectRatio: '9:16', imageSize: '2K', times: 4, access_token: 'secret'}, taskInfo: {user_id: 'private-user'}, __metadata: {canvas_id: 'private-canvas'}}},
      {id: 'video-b', type: 'video', parentId: 'omitted-capture-group', position: {x: 615.125, y: 30.25}, measured: {width: 250, height: 444}, data: {title: 'Result', src: source, options: [source], prompt: 'original prompt text', params: {model: 'seedance-2.0', variant: 'fast', duration: 5, generateAudio: true, callback_url: 'https://private.example/callback'}}},
      {id: 'text-c', type: 'text', parentId: 'omitted-capture-group', position: {x: 300.125, y: 910.333}, measured: {width: 250, height: 250}, data: {title: 'Text', text: '真实说明', prompt: 'write a shot', params: {model: 'gemini-3-pro'}}}
    ], edges: [{id: 'edge-a', source: 'image-a', target: 'video-b', sourceHandle: 'right', targetHandle: 'left', org_id: 'private-org', created_by: 'private-user', data: {order: 1, valueKey: 'image_oref', canvas_id: 'private-canvas'}}]
  }};
}
test('public compiler consumes the real list envelope and retains complete graph geometry/content/parameters', async () => {
  const {publicTemplateRows, compilePublicTemplate} = await core, row = fixture();
  assert.deepEqual(publicTemplateRows({code: 0, data: {templates: [row]}}), [row]);
  const item = compilePublicTemplate(row, {resources: {[source]: '/assets/workflow-templates/result.mp4'}});
  assert.equal(item.name, '真实工作流'); assert.equal(item.description, '说明'); assert.equal(item.graph.nodes.length, 3); assert.equal(item.graph.edges.length, 1);
  assert.equal(item.graph.nodes[0].x, 40); assert.equal(item.graph.nodes[0].y, 40);
  assert.equal(item.graph.nodes[1].x - item.graph.nodes[0].x, 615.125 - 14.56);
  assert.equal(item.graph.nodes[0].width, 250.125); assert.equal(item.graph.nodes[0].parentId, undefined);
  assert.equal(item.graph.nodes[1].generation.prompt, 'original prompt text'); assert.equal(item.graph.nodes[1].generation.model, 'seedance-2.0'); assert.equal(item.graph.nodes[1].generation.audio, true);
  assert.equal(item.graph.nodes[0].generation.ratio, '9:16'); assert.equal(item.graph.nodes[0].generation.quality, '2K'); assert.equal(item.graph.nodes[0].generation.count, 4);
  assert.equal(item.graph.nodes[2].content, '真实说明'); assert.equal(item.graph.nodes[2].textMode, 'generate');
  assert.equal(item.graph.nodes[1].video, '/assets/workflow-templates/result.mp4'); assert.deepEqual(item.graph.nodes[1].versions, [{video: '/assets/workflow-templates/result.mp4'}]);
  assert.deepEqual(item.graph.nodes[1].generation.referenceOrder, ['node:image-a']);
  assert.deepEqual(item.graph.edges[0].data, {order: 1, valueKey: 'image_oref'});
  assert.doesNotMatch(JSON.stringify(item), /private-|secret|callback_url|access_token|taskInfo|__metadata|created_by|org_id/);
});
test('media extraction only visits declared media slots and never treats prompt text or task callbacks as media', async () => {
  const {publicMediaSlots} = await core, row = fixture(); row.template_data.nodes[0].data.prompt = 'https://do-not-download.example/prompt';
  const slots = publicMediaSlots({data: {templates: [row]}});
  assert.equal(slots.length, 4); assert.equal(new Set(slots.map(slot => slot.source)).size, 3);
  assert.equal(slots.filter(slot => slot.type === 'video').length, 2);
  assert.doesNotMatch(JSON.stringify(slots), /do-not-download|callback|private/);
});
test('missing media/unsupported nodes/malformed coordinates fail before graph mutation', async () => {
  const {compilePublicTemplate} = await core;
  assert.throws(() => compilePublicTemplate(fixture()), /媒体尚未导入/);
  const invalid = fixture(); invalid.template_data.nodes[0].type = 'studio'; assert.throws(() => compilePublicTemplate(invalid), /暂不支持/);
  const coordinate = fixture(); coordinate.template_data.nodes[0].position.x = NaN; assert.throws(() => compilePublicTemplate(coordinate), /坐标/);
  const invalidEdge = fixture(); invalidEdge.template_data.edges[0].target = 'absent'; assert.throws(() => compilePublicTemplate(invalidEdge, {resources: {[source]: 'assets/video.mp4'}}), /连线/);
});
test('application remaps every ID, avoids current nodes, focuses one inserted group and rejects a changed project', async () => {
  const {compilePublicTemplate, applyPublicTemplate} = await core;
  const item = compilePublicTemplate(fixture(), {resources: {[source]: 'assets/video.mp4'}}), calls = [];
  let next = 0, current = 'project-a';
  const app = {getState: () => ({nodes: [{id: 'existing', x: -61234.57, y: 45500.4, width: 435, height: 300}], view: {x: 0, y: 0, scale: 1}}), insertGraph: graph => calls.push(graph), focusNode: id => calls.push(id)};
  const templatesCore = {instantiate: (template, point) => TemplatesCore.instantiate(template, point, () => 'new-' + next++)};
  const options = {app, templatesCore, projectId: 'project-a', currentProjectId: () => current, bounds: () => ({width: 1000, height: 800})};
  const group = applyPublicTemplate(item, options);
  assert.equal(calls.length, 2); assert.equal(calls[0].nodes.length, 4); assert.equal(calls[1], group.id); assert.equal(calls[0].edges[0].source, 'new-1'); assert.equal(calls[0].edges[0].target, 'new-2');
  assert.equal(calls[0].nodes[1].parentId, group.id); assert.equal(calls[0].nodes[2].x - calls[0].nodes[1].x, item.graph.nodes[1].x - item.graph.nodes[0].x);
  current = 'project-b'; assert.throws(() => applyPublicTemplate(item, options), /画布已切换/); assert.equal(calls.length, 2);
});
test('public category IDs preserve safe historical values and older catalogs remain compatible', async () => {
  const {compilePublicTemplate, validateCatalog, officialCategories} = await core, row = fixture();
  const historical = '8296d6d4-a7a0-4bdd-b274-4d050aff4315';
  row.category_ids = [officialCategories[0].id, historical, historical, 'private-user', {id: 'secret'}];
  const compiled = compilePublicTemplate(row, {resources: {[source]: 'assets/video.mp4'}});
  assert.equal(officialCategories.length, 8); assert.deepEqual(compiled.categoryIds, [officialCategories[0].id, historical]);
  assert.equal(officialCategories.some(category => category.id === historical), false);
  const old = structuredClone(compiled); delete old.categoryIds;
  assert.equal(validateCatalog({version: 1, templates: [old]}).length, 1);
  compiled.categoryIds.push('invalid'); assert.throws(() => validateCatalog({version: 1, templates: [compiled]}), /分类数据/);
});
