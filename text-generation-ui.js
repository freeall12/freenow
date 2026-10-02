(() => {
  'use strict';
  const core = window.CanvasText, app = window.CanvasApp;
  const el = (tag, cls = '', text) => { const e = document.createElement(tag); e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  const button = (label, icon, action) => { const b = el('button'); b.type = 'button'; b.setAttribute('aria-label', label); b.title = label; if (icon) b.innerHTML = window.UI_ICONS[icon]; else b.textContent = label; b.onclick = action; return b; };
  const panel = el('section', 'text-generation-panel node-editor'), pop = el('div', 'text-generation-menu parameter-popover');
  panel.id = 'text-generation-panel'; panel.setAttribute('aria-label', '文本生成参数'); panel.hidden = pop.hidden = true; document.body.append(panel, pop);
  let active = null, activeNode = null, key = '', configKey = '', popAnchor = null,lastBusy=null;
  const preparing = new Set();
  let generationAction=null;
  import('./src/features/generation-results/action-button.mjs').then(module=>{generationAction=module;updateGenerate();}).catch(error=>console.error('Text generation action:',error));
  const busy = id => preparing.has(id) || !!node(id)?.pendingOperation || window.GenerationAPI.getJobs().some(job => job.request.nodeId === id && (['queued', 'running'].includes(job.status)||job.applying));
  const node = id => app.getState().nodes.find(n => n.id === id);
  function setConfig(id, patch) {
    const n = node(id); if (!n || n.type !== 'text') throw Error('请选择文本节点');
    const generation = core.transition(n, patch); app.updateNode(id, { textMode: 'generate', generation }); return generation;
  }
  async function buildRequest(id, overrides = {}) {
    const state = app.getState(), n = state.nodes.find(n => n.id === id), request = core.request(n, state.nodes, state.edges, overrides);
    // Keep the editable prompt separate from the already expanded reference text.
    request.parameters.prompt = core.transition(n, overrides).prompt;
    for (const input of request.inputs) if (input.url && (input.url.startsWith('asset:') || input.url.startsWith('blob:') || input.url.startsWith('/') || !/^[a-z]+:/i.test(input.url))) {
      const url = await window.LocalAssets.url(input.url), response = await fetch(url); if (!response.ok) throw Error('参考素材无法读取'); const blob = await response.blob();
      input.url = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(Error('参考素材读取失败')); reader.readAsDataURL(blob); });
    }
    return request;
  }
  async function submit(id) {
    if (busy(id)) return;
    preparing.add(id); updateGenerate();
    try { const request = await buildRequest(id); return await window.GenerationAPI.submit(request); }
    catch (error) { app.notify(error.message); }
    finally { preparing.delete(id); updateGenerate(); }
  }
  function position({viewportOnly = false, resolvedNode = null} = {}) {
    if (panel.hidden || !active) return;
    // Pure viewport events preserve graph identity; content/selection events
    // refresh this reference. Resize/voice/menu calls still resolve live state.
    const n = resolvedNode || (viewportOnly && activeNode ? activeNode : node(active)); if (!n) return;
    const { view } = app.getState(), r = document.querySelector('#canvas').getBoundingClientRect(), w = Math.min(680, r.width - 24), x = r.left + (n.x + n.width / 2) * view.scale + view.x, y = r.top + (n.y + n.height) * view.scale + view.y;
    panel.style.width = w + 'px'; panel.style.left = Math.max(r.left + 12, Math.min(r.right - w - 12, x - w / 2)) + 'px'; panel.style.top = Math.max(72, Math.min(innerHeight - panel.offsetHeight - 18, y + 12)) + 'px';
    if (!pop.hidden && popAnchor?.isConnected) { const a = popAnchor.getBoundingClientRect(); pop.style.left = Math.max(8, Math.min(innerWidth - pop.offsetWidth - 8, a.left)) + 'px'; pop.style.top = Math.max(8, a.top - pop.offsetHeight - 8) + 'px'; }
  }
  function closeMenu(restoreFocus = false) {
    pop.hidden = true;
    popAnchor?.setAttribute('aria-expanded', 'false');
    const label = popAnchor?.getAttribute('aria-label');
    const anchor = popAnchor?.isConnected ? popAnchor : [...panel.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === label);
    popAnchor = null;
    if (restoreFocus && !panel.hidden && !anchor?.disabled) anchor?.focus({ preventScroll: true });
  }
  function menu(anchor, options, value, choose, cls = '') {
    if (!pop.hidden && popAnchor === anchor) { closeMenu(true); return; }
    closeMenu();pop.replaceChildren(); pop.className = 'text-generation-menu parameter-popover ' + cls; popAnchor = anchor; popAnchor.setAttribute('aria-haspopup', 'dialog');popAnchor.setAttribute('aria-expanded', 'true');pop.setAttribute('role', 'dialog');pop.hidden = false;
    for (const option of options) { const b = button(option.label, '', () => { pop.hidden = true; choose(option.value); closeMenu(true); }); b.setAttribute('aria-pressed', String(option.value === value)); if (option.icon) { const image = el('img'); image.src = window.TEXT_MODEL_ICONS[option.icon]; image.alt = ''; b.prepend(image); } if (option.value === value) { const check = el('span'); check.innerHTML = window.UI_ICONS.check; b.append(check); } pop.append(b); }
    position(); (pop.querySelector('[aria-pressed=true]') || pop.querySelector('button'))?.focus({ preventScroll: true });
  }
  pop.addEventListener('keydown', e => {
    const buttons = [...pop.querySelectorAll('button')], index = buttons.indexOf(document.activeElement);
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault(); e.stopPropagation();
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (index + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  });
  function picker(id) {
    closeMenu();const trigger=document.activeElement;
    const d = el('dialog', 'text-reference-picker'), state = app.getState(), n = node(id), selected = new Set(core.references(n, state.nodes, state.edges).map(r => r.id));
    d.setAttribute('aria-label', '选择文本参考素材'); d.append(el('h2', '', '选择参考素材')); const list = el('div', 'text-reference-list');
    for (const item of state.nodes.filter(n => n.id !== id && ['text', 'image', 'video'].includes(n.type))) { const label = el('label'), check = el('input'); check.type = 'checkbox'; check.checked = selected.has(item.id); check.onchange = () => check.checked ? selected.add(item.id) : selected.delete(item.id); label.append(check, el('span', '', item.title)); list.append(label); }
    if (!list.children.length) list.append(el('p', '', '画布上暂无可用参考节点')); d.append(list);
    const actions = el('footer'); actions.append(button('取消', '', () => d.close()), button('确认', '', () => { const current = app.getState(); for (const edge of current.edges.filter(e => e.target === id)) if (!selected.has(edge.source)) app.disconnect(edge.source, id); for (const source of selected) if (!current.edges.some(e => e.source === source && e.target === id)) app.connect(source, id); setConfig(id, { referenceIds: [...selected] }); d.close(); })); d.append(actions); d.onclose = () => {d.remove();if(active===id&&!panel.hidden)(trigger?.isConnected?trigger:[...panel.querySelectorAll('button')].find(button=>button.getAttribute('aria-label')==='选择参考素材'))?.focus({preventScroll:true});}; document.body.append(d); d.showModal();
  }
  function draw(n) {
    if(!pop.hidden)closeMenu();
    panel.replaceChildren(); const id = n.id, config = core.config(n), model = core.models.find(m => m.id === config.model), refs = el('div', 'text-reference-strip');
    refs.append(button('选择参考素材', 'cursor', () => picker(id)));
    let inputs = []; try { const state = app.getState(); inputs = core.references(n, state.nodes, state.edges); } catch {}
    for (const [index, input] of inputs.entries()) { const chip = el('div', 'text-reference-chip'); chip.draggable = true; const use = button(input.title || '参考 ' + (index + 1), input.type, () => { prompt.focus(); const start = prompt.selectionStart; prompt.setRangeText('@' + ({ text: 'Text', image: 'Image', video: 'Video' }[input.type]) + ' ' + (inputs.slice(0, index + 1).filter(r => r.type === input.type).length) + ' ', start, prompt.selectionEnd, 'end'); prompt.dispatchEvent(new Event('input')); });
      use.append(el('span', '', input.title || input.type)); chip.append(use, button('移除参考 ' + (index + 1), 'close', () => { app.disconnect(input.id, id); setConfig(id, { referenceIds: core.config(node(id)).referenceIds.filter(r => r !== input.id) }); }));
      chip.ondragstart = e => e.dataTransfer.setData('text/plain', input.id); chip.ondragover = e => e.preventDefault(); chip.ondrop = e => { e.preventDefault(); const ids = inputs.map(i => i.id), source = e.dataTransfer.getData('text/plain'), at = ids.indexOf(source); if (at < 0) return; ids.splice(at, 1); ids.splice(index, 0, source); setConfig(id, { referenceIds: ids }); }; refs.append(chip);
    }
    panel.append(refs); const prompt = el('textarea', 'text-generation-prompt'); prompt.setAttribute('aria-label', '文本生成提示词'); prompt.placeholder = '描述你想生成的文本…'; prompt.value = config.prompt; prompt.oninput = () => setConfig(id, { prompt: prompt.value }); prompt.onkeydown = e => { e.stopPropagation(); if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); submit(id); } }; panel.append(prompt);
    const footer = el('div', 'generation-footer'); panel.append(footer);
    const modelButton = button('选择文本模型', '', e => menu(e.currentTarget, core.models.map(m => ({ label: m.name, value: m.id, icon: m.icon })), core.config(node(id)).model, model => setConfig(id, { model }), 'text-model-menu'));
    modelButton.setAttribute('aria-haspopup','dialog');modelButton.setAttribute('aria-expanded','false');modelButton.textContent = model?.name || config.model; const modelIcon = el('img'); modelIcon.src = window.TEXT_MODEL_ICONS[model?.icon || 'gemini']; modelIcon.alt = ''; modelButton.prepend(modelIcon); footer.append(modelButton);
    if (model?.thinking) { const labels = model.icon === 'deepseek' ? { OFF: '关闭思考', MEDIUM: '快速思考', HIGH: '专家思考' } : { LOW: '轻度思考', MEDIUM: '标准思考', HIGH: '深度思考' }; const thinking = button('思考强度', 'thinking', e => menu(e.currentTarget, model.thinking.map(value => ({ label: labels[value], value })), core.config(node(id)).thinkingLevel, thinkingLevel => setConfig(id, { thinkingLevel }))); thinking.setAttribute('aria-haspopup','dialog');thinking.setAttribute('aria-expanded','false');thinking.append(el('span', '', labels[config.thinkingLevel])); footer.append(thinking); }
    footer.append(el('span', 'footer-spacer')); const voice = button('语音输入', 'mic'); footer.append(voice); window.VoiceInput.bind(voice, { target: prompt, getValue: () => prompt.value, setValue: value => { prompt.value = value; setConfig(id, { prompt: value }); }, isCurrent: () => active === id, mount: footer });
    const count = button('生成数量', '', e => menu(e.currentTarget, [1, 2, 3, 4].map(value => ({ value, label: value + '×' })), core.config(node(id)).count, count => setConfig(id, { count }))); count.setAttribute('aria-haspopup','dialog');count.setAttribute('aria-expanded','false');count.textContent = config.count + '×';
    const generate = button('生成文本', 'arrow', () => submit(id)); generate.className = 'generate-trigger text-generate'; footer.append(count, generate); updateGenerate(); position({resolvedNode:n});
  }
  function updateGenerate() {
    const generate = panel.querySelector('.text-generate'); if (!generate || !active) return;
    const generating=busy(active);lastBusy=generating;let reason = generating ? '文本生成中，请等待当前任务完成或取消' : '';
    if (!reason) try { const state = app.getState(); core.request(node(active), state.nodes, state.edges); } catch (error) { reason = error.message; }
    generate.disabled = !!reason; generate.title = reason || '生成文本';
    generationAction?.updateGenerationAction(generate,{busy:generating,disabled:!!reason,label:'生成文本'});
    panel.setAttribute('aria-busy', String(generating));
    const prompt = panel.querySelector('textarea'); prompt.setCustomValidity(reason && !generating ? reason : '');
    if (reason && !generating) prompt.setAttribute('aria-invalid', 'true'); else prompt.removeAttribute('aria-invalid');
  }
  function render(event) {
    if (event?.detail?.viewportOnly) { position({viewportOnly:true}); return; }
    const state = app.getState(), n = state.selected.length === 1 ? node(state.selected[0]) : null;
    if (!n || n.type !== 'text' || core.mode(n) !== 'generate') { panel.hidden = true;closeMenu(); active = activeNode = null; key = ''; return; }
    panel.hidden = false; activeNode = n;
    const incoming = state.edges.filter(e => e.target === n.id), sourceIds = new Set(incoming.map(e => e.source));
    const next = JSON.stringify([n.id, core.config(n), incoming, state.nodes.filter(r => sourceIds.has(r.id)).map(r => [r.id, r.title, r.content, r.image, r.video])]);
    if (next !== key) { const current = core.config(n), nextConfigKey = JSON.stringify({...current,prompt:undefined}), prompt = panel.querySelector('textarea'), preserve = active === n.id && document.activeElement === prompt && prompt.value === current.prompt && configKey === nextConfigKey; active = n.id; key = next; configKey = nextConfigKey; if (!preserve) draw(n); else updateGenerate(); }
    else if(busy(active)!==lastBusy)updateGenerate();
    position({resolvedNode:n});
  }
  window.GenerationAPI.subscribe(updateGenerate);
  document.addEventListener('canvas:render', render); document.addEventListener('voice:layout', position); window.addEventListener('resize', position);
  const dismissOutside=e=>{if(!pop.contains(e.target)&&!popAnchor?.contains(e.target))closeMenu();};
  document.addEventListener('pointerdown', dismissOutside);document.addEventListener('focusin', dismissOutside);
  for(const surface of [pop,panel])surface.addEventListener('keydown',e=>{if(e.key==='Escape'&&!e.defaultPrevented&&!e.isComposing&&e.keyCode!==229&&!pop.hidden&&(pop.contains(e.target)||popAnchor?.contains(e.target))){e.preventDefault();e.stopImmediatePropagation();closeMenu(true);}});
  window.TextAPI = { getConfig: core.config, setConfig, buildRequest, submit, open: window.CanvasTextUI.open, close: window.CanvasTextUI.close };
  render();
})();
