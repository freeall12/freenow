const test = require('node:test'), assert = require('node:assert/strict');
const text = require('../canvas-text.js'), geometry = require('../canvas-geometry.js');
const node = (patch = {}) => ({ id: 'g', type: 'text', textMode: 'generate', x: 52000.25, y: -2000.5, width: 300, height: 200, generation: { prompt: '写脚本', model: 'gemini-3.1-flash-lite', count: 1 }, ...patch });
test('text request retains ordered reference IDs and prepends text once without changing coordinates', () => {
  const n = node({ generation: { prompt: '写脚本', model: 'gemini-3.1-flash-lite', count: 2, referenceIds: ['b', 'a'] } });
  const nodes = [n, { id: 'a', type: 'text', content: '角色', x: 1 }, { id: 'b', type: 'text', content: '场景', x: 2 }], before = JSON.stringify(nodes);
  const r = text.request(n, nodes, [{ source: 'a', target: 'g' }, { source: 'b', target: 'g' }]);
  assert.deepEqual(r.inputs.map(i => i.id), ['b', 'a']); assert.equal(r.prompt, '场景\n\n角色\n\n写脚本'); assert.equal(r.parameters.count, 2); assert.equal(JSON.stringify(nodes), before);
});
test('switching text models resets incompatible thinking settings and respects wire case', () => {
  let n = node(); n.generation = text.transition(n, { model: 'deepseek-v4-pro' }); assert.equal(n.generation.thinkingLevel, 'MEDIUM');
  assert.equal(text.request(n, [n], []).parameters.thinking_level, 'MEDIUM'); n.generation = text.transition(n, { model: 'gpt-6-astra' });
  assert.equal(text.request(n, [n], []).parameters.reasoning_effort, 'medium'); assert.equal(text.request(n, [n], []).parameters.thinking_level, undefined);
  n.generation = text.transition(n, { model: 'gemini-3.1-flash-lite' }); assert.equal(n.generation.thinkingLevel, undefined);
  assert.throws(() => text.transition(n, { count: 1.5 }), /数量/); assert.throws(() => text.transition(n, { model: 'injected' }), /未知/);
});
test('text generation refuses pure, empty, missing, self and incompatible multimodal inputs', () => {
  const n = node(); assert.throws(() => text.request({ ...n, textMode: 'pure' }, [n], []), /文本生成/);
  assert.throws(() => text.request(n, [n], [], { prompt: '' }), /提示词/);
  assert.throws(() => text.request(n, [n], [], { referenceIds: ['missing'] }), /不存在/);
  assert.throws(() => text.request(n, [n], [], { referenceIds: ['g'] }), /自身/);
  const video = { id: 'v', type: 'video', video: 'https://example.test/video.mp4' };
  assert.throws(() => text.request(n, [n, video], [], { model: 'gpt-6-astra', referenceIds: ['v'] }), /不支持视频/);
  const image = { id: 'i', type: 'image', image: 'https://example.test/image.png' };
  assert.throws(() => text.request(n, [n, image], [], { model: 'deepseek-v4-pro', referenceIds: ['i'] }), /不支持图片/);
  assert.equal(text.request(n, [n, video], [], { referenceIds: ['v'], prompt: '' }).inputs[0].type, 'video');
});
test('text resize preserves opposite corner at fractional world coordinates and enforces minimum sizes', () => {
  const n = {...node(), height:300}, r = text.resize(n, 'nw', 22.5, -33.75); assert.equal(r.x + r.width, n.x + n.width); assert.equal(r.y + r.height, n.y + n.height);
  assert.deepEqual(r, { x: 52022.75, y: -2034.25, width: 277.5, height: 333.75 });
  assert.equal(text.resize(n, 'se', -1000, -1000).width, 250); assert.equal(text.resize(n, 'se', -1000, -1000).height, 250);
});
test('text output uses 300 by 200 geometry and avoids an occupied neighbor without group offset', () => {
  const n = node(), occupied = { x: 52460.25, y: -2000.5, width: 300, height: 200 };
  const out = geometry.placeOutputs(n, [{ type: 'text', text: '# New' }], [n, occupied])[0];
  assert.equal(out.width, 300); assert.equal(out.height, 200); assert.equal(out.x, occupied.x); assert.equal(out.y, occupied.y + 265);
});

test('workflow preflight allows unfinished upstream text but rejects unsupported media before scheduling', () => {
 const config = text.transition(node(), {model:'deepseek-v4-pro',prompt:''});
 assert.doesNotThrow(() => text.validateInputs(config, [{id:'upstream',type:'text'}], new Set(['upstream'])));
 assert.throws(() => text.validateInputs(config, [{id:'upstream',type:'image'}], new Set(['upstream'])), /不支持图片/);
 assert.throws(() => text.validateInputs(config, [{id:'upstream',type:'text'}]), /没有内容/);
 assert.equal(text.transition(node(), {model:'gpt-6-astra',thinkingLevel:'HIGH'}).thinkingLevel, 'HIGH');
});
