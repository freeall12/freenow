(() => {
  'use strict';
  const core = window.CanvasText, app = window.CanvasApp;
  const el = (tag, cls = '', text) => { const e = document.createElement(tag); e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  const button = (label, icon, action) => { const b = el('button'); b.type = 'button'; b.setAttribute('aria-label', label); b.title = label; if (icon) b.innerHTML = window.UI_ICONS[icon]; else b.textContent = label; b.onclick = action; return b; };
  const panel = el('section', 'text-generation-panel node-editor'), pop = el('div', 'text-generation-menu parameter-popover');
  panel.id = 'text-generation-panel'; panel.setAttribute('aria-label', '文本生成参数'); panel.hidden = pop.hidden = true; document.body.append(panel, pop);
  let active = null, activeNode = null, key = '', configKey = '', popAnchor = null,lastBusy=null;
  const preparing = new Set();
  let generationAction=null, richPrompt=null, canvasPicker=null, promptControl=null, promptHost=null, promptId=null, pickerControl=null;
  const modulesReady = Promise.all([import('./assets/agent-editor.js'), import('./src/features/canvas-reference-picker/entry.mjs')]).then(([editor, picker]) => {
    richPrompt=editor.createNodePrompt; canvasPicker=picker.pickReference;
    if(active){promptControl?.destroy();promptControl=promptHost=promptId=null;key='';render();}
  }).catch(error=>console.error('Text reference editor:',error));
  import('./src/features/generation-results/action-button.mjs').then(module=>{generationAction=module;updateGenerate();}).catch(error=>console.error('Text generation action:',error));
  const busy = id => preparing.has(id) || !!node(id)?.pendingOperation || window.GenerationAPI.getJobs().some(job => job.request.nodeId === id && (['queued', 'running'].includes(job.status)||job.applying));
  const node = id => app.getState().nodes.find(n => n.id === id);
  function setConfig(id, patch) {
    const n = node(id); if (!n || n.type !== 'text') throw Error('请选择文本节点');
    const state = app.getState(), before=core.withoutSources(n,[],state.nodes,state.edges), changed = core.transition({...n,generation:before}, patch);
    const generation = core.reconcile(changed, core.references({...n,generation:changed}, state.nodes, state.edges));
    if(JSON.stringify(generation)!==JSON.stringify(n.generation))app.updateNode(id, { textMode: 'generate', generation }); return generation;
  }
  async function buildRequest(id, overrides = {}) {
    const state = app.getState(), n = state.nodes.find(n => n.id === id), request = core.request(n, state.nodes, state.edges, overrides);
    // Keep the editable prompt separate from the already expanded reference text.
    request.parameters.prompt = core.reconcile(core.transition(n, overrides), core.references(n,state.nodes,state.edges,overrides.referenceIds)).prompt;
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
  async function picker(id) {
    closeMenu();
    if(pickerControl){pickerControl.close({restoreFocus:true});return;}
    if(!canvasPicker)await modulesReady;
    if(active!==id||!canvasPicker)return;
    let selected=false;
    pickerControl=canvasPicker({app,targetId:id,slot:'reference',allowedTypes:['image','video','text'],onSelect(source){app.connect(source,id);selected=true;},onClose(){pickerControl=null;if(selected&&active===id)queueMicrotask(()=>promptControl?.dom.focus({preventScroll:true}));}});
  }
  function currentInputs(id) {
    const state=app.getState();return core.references(node(id),state.nodes,state.edges);
  }
  function removeReference(id,input) {
    const links=app.getState().edges.filter(edge=>edge.source===input.id&&edge.target===id);
    if(links.length)app.removeEdges(links.map(edge=>edge.id));
    else {const state=app.getState();app.updateNode(id,{generation:core.withoutSources(node(id),[{id:input.id}],state.nodes,state.edges)});}
  }
  function reorderReference(id,source,target) {
    const inputs=currentInputs(id),from=inputs.findIndex(input=>input.id===source),to=inputs.findIndex(input=>input.id===target);
    if(from<0||to<0||from===to||inputs[from].type!==inputs[to].type)return;
    const ids=inputs.map(input=>input.id);ids.splice(from,1);ids.splice(to,0,source);setConfig(id,{referenceIds:ids});
  }
  function createPrompt(id,value) {
    if(richPrompt){
      promptHost=el('div','text-generation-prompt');
      promptControl=richPrompt({element:promptHost,value,getItems:()=>currentInputs(id),onChange:prompt=>setConfig(id,{prompt}),onSubmit:()=>submit(id)});
      promptControl.dom.setAttribute('aria-label','文本生成提示词');promptControl.dom.dataset.placeholder='描述你想生成的文本…';
    }else{
      // Keep the current draft editable while the existing local Tiptap bundle loads.
      promptHost=el('textarea','text-generation-prompt');promptHost.setAttribute('aria-label','文本生成提示词');promptHost.placeholder='描述你想生成的文本…';promptHost.value=value;
      promptHost.oninput=()=>setConfig(id,{prompt:promptHost.value});promptHost.onkeydown=event=>{event.stopPropagation();if((event.ctrlKey||event.metaKey)&&event.key==='Enter'&&!event.isComposing&&event.keyCode!==229){event.preventDefault();submit(id);}};
      promptControl={dom:promptHost,getText:()=>promptHost.value,sync(text){if(promptHost.value!==text)promptHost.value=text;},insert(input){const items=core.mentionItems(currentInputs(id)),item=items.find(next=>next.key===input.key);if(!item)return;promptHost.focus();promptHost.setRangeText('{{'+item.renderText+'}} ',promptHost.selectionStart,promptHost.selectionEnd,'end');promptHost.oninput();},destroy(){},close(){}};
    }
    promptId=id;return promptHost;
  }
  function draw(n) {
    if(!pop.hidden)closeMenu();
    const id=n.id,retain=promptControl&&promptId===id;
    if(!retain){promptControl?.destroy();promptControl=promptHost=promptId=null;panel.replaceChildren();}
    const config = core.config(n), model = core.models.find(m => m.id === config.model), refs = retain?panel.querySelector('.text-reference-strip'):el('div', 'text-reference-strip');
    refs.replaceChildren();
    const add=button('选择参考素材', '', () => picker(id));add.className='reference-add text-reference-add';add.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';refs.append(add);
    let inputs = []; try { const state = app.getState(); inputs = core.references(n, state.nodes, state.edges); } catch {}
    const reconciled=core.reconcile(config,inputs);
    for (const [index, input] of inputs.entries()) { const chip = el('div', 'text-reference-chip'); chip.draggable = true;chip.tabIndex=0;chip.dataset.referenceKey=input.key;chip.setAttribute('aria-label',input.title||'参考 '+(index+1));chip.setAttribute('aria-description','Alt+左方向键或右方向键调整同类参考顺序');const use = button(input.title || '参考 ' + (index + 1), input.type, () => promptControl?.insert(input));use.disabled=input.empty;
      use.append(el('span', '', input.title || input.type));if(input.empty)chip.className+=' is-empty';chip.append(use, button('移除参考 ' + (index + 1), 'close', () => removeReference(id,input)));
      chip.ondragstart = e => e.dataTransfer.setData('text/plain', input.id); chip.ondragover = e => e.preventDefault(); chip.ondrop = e => { e.preventDefault();reorderReference(id,e.dataTransfer.getData('text/plain'),input.id); };
      chip.onkeydown=e=>{if(!e.altKey||e.isComposing||e.keyCode===229||!['ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();e.stopPropagation();const same=currentInputs(id).filter(item=>item.type===input.type),at=same.findIndex(item=>item.id===input.id),target=same[at+(e.key==='ArrowLeft'?-1:1)];if(target){reorderReference(id,input.id,target.id);panel.querySelector('[data-reference-key="'+CSS.escape(input.key)+'"]')?.focus({preventScroll:true});}};refs.append(chip);
    }
    if(!retain){panel.append(refs);panel.append(createPrompt(id,reconciled.prompt));}else promptControl.sync(reconciled.prompt);
    const prompt=promptControl.dom,footer=retain?panel.querySelector('.generation-footer'):el('div', 'generation-footer');footer.replaceChildren();if(!retain)panel.append(footer);
    const modelButton = button('选择文本模型', '', e => menu(e.currentTarget, core.models.map(m => ({ label: m.name, value: m.id, icon: m.icon })), core.config(node(id)).model, model => setConfig(id, { model }), 'text-model-menu'));
    modelButton.setAttribute('aria-haspopup','dialog');modelButton.setAttribute('aria-expanded','false');modelButton.textContent = model?.name || config.model; const modelIcon = el('img'); modelIcon.src = window.TEXT_MODEL_ICONS[model?.icon || 'gemini']; modelIcon.alt = ''; modelButton.prepend(modelIcon); footer.append(modelButton);
    if (model?.thinking) { const labels = model.icon === 'deepseek' ? { OFF: '关闭思考', MEDIUM: '快速思考', HIGH: '专家思考' } : { LOW: '轻度思考', MEDIUM: '标准思考', HIGH: '深度思考' }; const thinking = button('思考强度', 'thinking', e => menu(e.currentTarget, model.thinking.map(value => ({ label: labels[value], value })), core.config(node(id)).thinkingLevel, thinkingLevel => setConfig(id, { thinkingLevel }))); thinking.setAttribute('aria-haspopup','dialog');thinking.setAttribute('aria-expanded','false');thinking.append(el('span', '', labels[config.thinkingLevel])); footer.append(thinking); }
    footer.append(el('span', 'footer-spacer')); const voice = button('语音输入', 'mic'); footer.append(voice);const control=promptControl; window.VoiceInput.bind(voice, { target: prompt, getValue: control.getText, setValue: value => {control.sync(value);setConfig(id, { prompt: value });},captureSelection:control.captureSelection,commitTranscript:control.commitTranscript,isCurrent: () => active === id&&promptControl===control, mount: footer });
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
    const prompt = promptControl?.dom;if(!prompt)return; prompt.setCustomValidity?.(reason && !generating ? reason : '');
    if (reason && !generating) prompt.setAttribute('aria-invalid', 'true'); else prompt.removeAttribute('aria-invalid');
  }
  function render(event) {
    if (event?.detail?.viewportOnly) { position({viewportOnly:true}); return; }
    const state = app.getState(), n = state.selected.length === 1 ? node(state.selected[0]) : null;
    if (!n || n.type !== 'text' || core.mode(n) !== 'generate') { panel.hidden = true;closeMenu();pickerControl?.close({restoreFocus:false});promptControl?.destroy();promptControl=promptHost=promptId=null;active = activeNode = null; key = ''; return; }
    if(active&&active!==n.id)pickerControl?.close({restoreFocus:false});
    panel.hidden = false; activeNode = n;
    const incoming = state.edges.filter(e => e.target === n.id), sourceIds = new Set(incoming.map(e => e.source));
    for(const id of core.config(n).referenceIds)sourceIds.add(id);
    const sources=state.nodes.filter(r => sourceIds.has(r.id)).map(r => [r.id, r.type, r.title, r.content, r.fullImage, r.image, r.poster, r.video]), next = JSON.stringify([n.id, core.config(n), incoming, sources]);
    if (next !== key) { const current = core.config(n), nextConfigKey = JSON.stringify([{...current,prompt:undefined},incoming,sources]), preserve = active === n.id && promptControl?.getText() === current.prompt && configKey === nextConfigKey; active = n.id; key = next; configKey = nextConfigKey; if (!preserve) draw(n); else updateGenerate(); }
    else if(busy(active)!==lastBusy)updateGenerate();
    position({resolvedNode:n});
  }
  window.GenerationAPI.subscribe(updateGenerate);
  document.addEventListener('canvas:render', render); document.addEventListener('voice:layout', position); window.addEventListener('resize', position);
  const dismissOutside=e=>{if(!pop.contains(e.target)&&!popAnchor?.contains(e.target))closeMenu();};
  document.addEventListener('pointerdown', dismissOutside);document.addEventListener('focusin', dismissOutside);
  for(const surface of [pop,panel])surface.addEventListener('keydown',e=>{if(e.key==='Escape'&&!e.defaultPrevented&&!e.isComposing&&e.keyCode!==229&&!pop.hidden&&(pop.contains(e.target)||popAnchor?.contains(e.target))){e.preventDefault();e.stopImmediatePropagation();closeMenu(true);}});
  window.TextAPI = { getConfig: core.config, setConfig, buildRequest, submit, get promptEditor(){return richPrompt?promptControl:null;},selectReference:picker,open: window.CanvasTextUI.open, close: window.CanvasTextUI.close };
  render();
})();
