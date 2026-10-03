(function (root) {
  'use strict';
  const colors = [
    ['red', '#964243', '#372626'], ['orange', '#834915', '#33281D'], ['yellow', '#8F8030', '#363323'],
    ['green', '#3D7344', '#253027'], ['cyan', '#337282', '#233033'], ['blue', '#2B5284', '#222933'], ['purple', '#763886', '#312434'],
  ];
  const models = [
    ['gemini-3.5-flash', 'Gemini 3.5 Flash', 'gemini'], ['gemini-3.6-flash', 'Gemini 3.6 Flash', 'gemini'],
    ['gemini-3.1-pro', 'Gemini 3.1 Pro', 'gemini'], ['gemini-3.1-flash-lite', 'Gemini 3.1 Flash Lite', 'gemini'],
    ['gemini-3-flash', 'Gemini 3 Flash', 'gemini'], ['deepseek-v4-pro', 'DeepSeek V4 Pro', 'deepseek'],
    ['grok-4.6', 'Grok 4.6', 'grok'], ['gpt-5.6-sol', 'GPT 5.6 Sol', 'openai'], ['gpt-5.6-terra', 'GPT 5.6 Terra', 'openai'],
    ['gpt-5.6-luna', 'GPT 5.6 Luna', 'openai'], ['gpt-6-astra', 'GPT 6 Astra', 'openai'],
    ['anthropic.claude-opus-5', 'Claude Opus 5', 'claude'], ['anthropic.claude-fable-5', 'Claude Fable 5', 'claude'],
    ['anthropic.claude-fable-5-1', 'Claude Fable 5.1', 'claude'],
  ].map(([id, name, icon]) => ({ id, name, icon, image: icon === 'gemini' || id === 'gpt-6-astra', video: icon === 'gemini',
    ...(icon === 'openai' ? { thinking: ['LOW', 'MEDIUM', 'HIGH'], defaultThinking: id === 'gpt-6-astra' ? 'MEDIUM' : 'LOW', wire: 'reasoning_effort' } :
      icon === 'deepseek' ? { thinking: ['OFF', 'MEDIUM', 'HIGH'], defaultThinking: 'MEDIUM', wire: 'thinking_level' } : {}),
  }));
  const mode = n => n.textMode || (n.generation ? 'generate' : 'pure');
  function config(n) {
    const value = { prompt: '', model: 'gemini-3.1-flash-lite', count: 1, referenceIds: [], promptReferenceBindings: [], ...n.generation };
    const model = models.find(m => m.id === value.model);
    value.thinkingLevel = model?.thinking?.includes(value.thinkingLevel?.toUpperCase()) ? value.thinkingLevel.toUpperCase() : model?.defaultThinking;
    return value;
  }
  function transition(n, patch) {
    const value = { ...config(n), ...patch }, model = models.find(m => m.id === value.model);
    if (!model) throw Error('未知文本模型');
    if (typeof value.prompt !== 'string' || value.prompt.length > 100000) throw Error('文本提示词无效');
    if (!Number.isInteger(value.count) || value.count < 1 || value.count > 4) throw Error('文本生成数量须为 1–4');
    if (!Array.isArray(value.referenceIds) || value.referenceIds.some(id => typeof id !== 'string')) throw Error('文本参考节点身份无效');
    value.referenceIds = [...new Set(value.referenceIds)];
    if (!Array.isArray(value.promptReferenceBindings) || value.promptReferenceBindings.some(binding => !binding || typeof binding.referenceKey !== 'string' || !/^(Image|Video|Text) [1-9]\d*$/.test(binding.renderText))) throw Error('文本提示词引用绑定无效');
    if (patch.model && patch.model !== config(n).model && !Object.hasOwn(patch, 'thinkingLevel')) value.thinkingLevel = model.defaultThinking;
    if (model.thinking && value.thinkingLevel && !model.thinking.includes(value.thinkingLevel.toUpperCase())) throw Error('思考强度不受当前模型支持');
    value.thinkingLevel = model.thinking ? (value.thinkingLevel?.toUpperCase() || model.defaultThinking) : undefined;
    delete value.reasoning_effort; delete value.thinking_level;
    return value;
  }
  function references(n, nodes, edges, ids) {
    const ordered = ids || [...(config(n).referenceIds || []), ...edges.filter(e => e.target === n.id).map(e => e.source)];
    return [...new Set(ordered)].map(id => {
      const source = nodes.find(n => n.id === id);
      if (!source || source.id === n.id) throw Error('参考节点已不存在或引用了自身');
      if (!['text', 'image', 'video'].includes(source.type)) throw Error('文本节点仅支持文字、图片与视频参考');
      const url = source.type === 'video' ? source.video : source.fullImage || source.image;
      return { id, nodeId: id, key: 'node:' + id, type: source.type, title: source.title, text: source.content, url,
        thumbnail: source.image || source.poster, empty: source.type === 'text' ? !source.content?.trim() : !url };
    });
  }
  function mentionItems(inputs) {
    const counts = {};
    return inputs.filter(input => !input.empty).map(input => ({ ...input, renderText: input.type[0].toUpperCase() + input.type.slice(1) + ' ' + (counts[input.type] = (counts[input.type] || 0) + 1) }));
  }
  // Provider ordinals are presentation; stored node keys preserve meaning on reorder.
  function reconcile(value, inputs) {
    const items = mentionItems(inputs), labels = new Map(items.map(item => [item.key, item.renderText]));
    const before = new Map((value.promptReferenceBindings || []).map(binding => [binding.renderText, binding.referenceKey]));
    const prompt = (value.prompt || '').replace(/\{\{(Image|Video|Text) ([1-9]\d*)\}\}/g, (token, type, index) => {
      const name = type + ' ' + index;
      if (!before.has(name)) return token;
      const current = labels.get(before.get(name));
      return current ? '{{' + current + '}}' : '';
    });
    return { ...value, prompt, promptReferenceBindings: items.map(item => ({ renderText: item.renderText, referenceKey: item.key })) };
  }
  // Called inside the host's existing graph history transaction before edges/nodes disappear.
  function withoutSources(n, sources, nodes, edges) {
    const removed = new Set(sources.map(source => source.id)), value = config(n);
    value.referenceIds = value.referenceIds.filter(id => !removed.has(id));
    if (nodes && edges) {
      const valid = new Set(nodes.filter(source => source.id !== n.id && ['image','video','text'].includes(source.type)).map(source => source.id));
      value.referenceIds = value.referenceIds.filter(id => valid.has(id));
      const validEdges = edges.filter(edge => valid.has(edge.source));
      // Imported historical drafts may have missing IDs; cleanup must never block deletion.
      if (!value.promptReferenceBindings.length) value.promptReferenceBindings = reconcile({ ...value, referenceIds: config(n).referenceIds.filter(id => valid.has(id)) }, references({ ...n, generation: { ...value, referenceIds: config(n).referenceIds.filter(id => valid.has(id)) } }, nodes, validEdges)).promptReferenceBindings;
      return reconcile(value, references({ ...n, generation: value }, nodes.filter(source => !removed.has(source.id)), validEdges.filter(edge => !removed.has(edge.source))));
    }
    const items = value.promptReferenceBindings.filter(binding => !removed.has(binding.referenceKey.slice(5))).map(binding => ({ key: binding.referenceKey, type: binding.renderText.split(' ')[0].toLowerCase() }));
    return reconcile(value, items);
  }
  function remapGeneration(n, mapping) {
    const value = config(n), remap = id => mapping.get(id) || id;
    return { ...value, referenceIds: value.referenceIds.map(remap), promptReferenceBindings: value.promptReferenceBindings.map(binding => ({ ...binding, referenceKey: binding.referenceKey.startsWith('node:') ? 'node:' + remap(binding.referenceKey.slice(5)) : binding.referenceKey })) };
  }
  function projectPrompt(prompt, inputs) {
    const texts = mentionItems(inputs).filter(input => input.type === 'text'), used = new Set();
    const inline = (prompt || '').replace(/(\{\{Text [1-9]\d*\}\})\s*(?=\{\{Text [1-9]\d*\}\})/g, '$1\n').replace(/\{\{Text ([1-9]\d*)\}\}/g, (token, index) => {
      const input = texts[Number(index) - 1]; if (!input) return token;
      used.add(input.key); return input.text || '';
    });
    return [...texts.filter(input => !used.has(input.key)).map(input => input.text), inline].filter(Boolean).join('\n\n');
  }
  function validateInputs(c, inputs, pendingIds = new Set()) {
    const model = models.find(m => m.id === c.model);
    if (!model) throw Error('未知文本模型');
    for (const input of inputs) {
      if (!['image', 'video', 'text'].includes(input.type)) throw Error('文本节点仅支持文字、图片与视频参考');
      if (input.type === 'image' && !model.image || input.type === 'video' && !model.video) throw Error('当前模型不支持' + (input.type === 'video' ? '视频' : '图片') + '参考');
      if (!pendingIds.has(input.id) && (input.type === 'text' ? !input.text?.trim() : !input.url)) throw Error('参考节点没有内容');
    }
    if (!c.prompt?.trim() && !inputs.some(i => i.url || i.text?.trim() || pendingIds.has(i.id))) throw Error('请输入提示词或添加参考素材');
  }
  function request(n, nodes, edges, overrides = {}) {
    if (!n || n.type !== 'text' || mode(n) !== 'generate') throw Error('请选择文本生成节点');
    const inputs = references(n, nodes, edges, overrides.referenceIds), c = reconcile(transition(n, overrides), inputs), model = models.find(m => m.id === c.model);
    validateInputs(c, inputs);
    const prompt = projectPrompt(c.prompt, inputs);
    if (!prompt.trim() && !inputs.some(i => i.url)) throw Error('请输入提示词或添加参考素材');
    return { kind: 'text.generate', label: '文本生成', nodeId: n.id, prompt, inputs, parameters: {
      model: c.model, count: c.count, ...(model.wire ? { [model.wire]: model.wire === 'reasoning_effort' ? c.thinkingLevel.toLowerCase() : c.thinkingLevel } : {}),
    } };
  }
  function resize(bounds, handle, dx, dy) {
    let { x, y, width, height } = bounds;
    if (handle.includes('e')) width = Math.max(250, width + dx);
    if (handle.includes('s')) height = Math.max(250, height + dy);
    if (handle.includes('w')) { width = Math.max(250, width - dx); x += bounds.width - width; }
    if (handle.includes('n')) { height = Math.max(250, height - dy); y += bounds.height - height; }
    return { x, y, width, height };
  }
  const api = { colors, models, mode, config, transition, references, mentionItems, reconcile, withoutSources, remapGeneration, projectPrompt, request, validateInputs, resize };
  if (typeof module !== 'undefined') module.exports = api; else root.CanvasText = api;
})(typeof window === 'undefined' ? globalThis : window);
