(() => {
  'use strict';
  const app = window.CanvasApp;
  let mediaDisplay=window.CanvasResourceDisplay;
  const mediaDisplayReady=(window.CanvasResourceDisplayReady||import('./src/features/local-resource-migration/display-media.mjs')).then(policy=>{mediaDisplay=policy;return policy;});
  mediaDisplayReady.catch(()=>{});
  const unavailableMedia='原站资源已停用，请重新导入本地资源';
  function candidateReferenceSource(item,policy,style=false){
    if(style||item.type==='image')return policy.displayMediaRef(item.fullImage)||policy.displayMediaRef(item.image);
    if(item.type==='text')return item.content||'node:'+item.id;
    return policy.displayMediaRef(item.type==='video'?item.video||item.image:item.type==='audio'?item.audio||item.image:item.fullImage||item.image||item.video||item.audio);
  }
  function displayReferenceImage(image,source,alternate){
    const paint=async policy=>{
      await Promise.resolve();if(!image.isConnected)return;
      const safe=policy.displayMediaRef(source)||policy.displayMediaRef(alternate);
      if(!safe){image.removeAttribute('src');image.title=unavailableMedia;image.alt=unavailableMedia;return;}
      const resolved=safe.startsWith('asset:')?await window.LocalAssets.url(safe):safe;
      if(image.isConnected){const checked=policy.displayMediaRef(resolved);if(checked)image.src=checked;else image.title=unavailableMedia;}
    };
    (mediaDisplay?paint(mediaDisplay):mediaDisplayReady.then(paint)).catch(error=>{if(image.isConnected)image.title=error.message;});
  }
  const $ = s => document.querySelector(s);
  const make = (tag, cls, text) => {const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;};
  const icon = name => window.UI_ICONS[name] || window.UI_ICONS.spark;
  const button = (label, fn, cls='') => {const b=make('button',cls,label);b.type='button';if(fn)b.onclick=fn;window.applyButtonIcon?.(b,label);return b;};
  const videoModels=['Seedance 2.0 Mini','Wan 2.6','TapNow 悠船 Video','Hailuo02','Vidu Q2','Seedance 2.0','Seedance 2.0 Fast','Seedance 2.5','Seedance 2.5 样片','MiniMax H3','Wan 3.0','Kling 3.0 Omni','TapNow Omni Flash','TapNow Omni 1.1 Flash','Kling 3.0','HappyHorse 1.0','HappyHorse 1.1','Kling O1','Video 3.1 Lite','Video 3.1 Fast','Video 3.1','Kling 2.6','Seedance 1.0 Pro','Vidu Q2 Pro','Vidu Q2 Turbo','Kling 2.1','PixVerse 5.5','PixVerse 5.0','MiniMax H3 Max','FLUX 3','HappyHorse 1.0 Edit','Kling 3.0 Omni Edit','Kling O1 Edit','Hailuo-2.3','Hailuo-2.3 Fast','Vidu Q3','Kling 2.5','Kling 2.6 Motion Control','Wan 2.2','Wan 2.2 Flash','Wan 2.5','Soda 2','Soda 2 Pro','OmniHuman 1.5'];
  const modelLabel=name=>videoModels.includes(name)?name.replace(/^TapNow /,'freenow '):name;
  const nodeSettingsKey=window.CanvasProjects?.storageKey('tapnow-node-settings')||'tapnow-node-settings';
  let drafts={};try{drafts=JSON.parse(localStorage.getItem(nodeSettingsKey)||'{}');}catch{}
  let node=null,config=null,activeId=null,popAnchor=null,pendingAnchor=null,dragRef=null;
  const submitting=new Set();let generationAction=null;
  import('./src/features/generation-results/action-button.mjs').then(module=>{generationAction=module;if(node)updateBusyState();}).catch(error=>console.error('Generation action:',error));
  let resultCounts=null,resultMode='variants';
  try{const stored=localStorage.getItem('tapnow.canvas.generation-result-mode');if(['pile','spread','variants'].includes(stored))resultMode=stored;}catch{}
  import('./src/features/generation-results/counts.mjs').then(module=>{resultCounts=module;syncResultCountMode();}).catch(error=>console.error('Generation counts:',error));
  let composerLayout=null,referenceUI=null,referenceSignature='',promptModule=null,promptControl=null,positionReady=false;
  import('./assets/agent-editor.js').then(module=>{promptModule=module;if(node&&!panel.hidden)draw();}).catch(error=>console.error('Node prompt:',error));
  import('./src/features/node-composer/layout.mjs').then(module=>{composerLayout=module;if(node)draw();}).catch(error=>console.error('Node composer layout:',error));
  let draftFinalUI=null,draftFinalSignature='';
  import('./src/features/video-generation/draft-final-ui.mjs').then(module=>{draftFinalUI=module.createDraftFinalUI({app,panel,onModeChange(){framePicker?.close();closePopover();draw();},onLayout:position});draftFinalUI.syncBadges(app.getState());if(node)draw();}).catch(error=>console.error('Draft/final controls:',error));
  let subjects=null;
  import('./src/features/subject-library/entry.mjs').then(async module=>{await module.readySubjects();subjects=module;if(node)draw();}).catch(error=>console.error('Subject library:',error));
  let focusEdit=null;
  import('./src/features/focus-edit/entry.mjs').then(module=>{focusEdit=module;if(node){draw();}}).catch(error=>console.error('Focus edit:',error));
  let videoMenus=null, videoFrames=null, referencePicker=null, framePicker=null, tailFrameKey=null;
  import('./src/features/canvas-reference-picker/entry.mjs').then(module=>{referencePicker=module;}).catch(error=>console.error('Canvas reference selection:',error));
  import('./src/features/video-generation/frames.mjs').then(module=>{videoFrames=module;if(node)draw();}).catch(error=>console.error('Video frames:',error));
  const videoMenusReady=import('./src/features/video-generation/menus.mjs').then(module=>{videoMenus=module;if(node){if(['MiniMax-H3','MiniMax-H3-Max'].includes(module.modelFor(config.model)?.id))config=structuredClone(getConfig(node));draw();}return module;}).catch(error=>{console.error('Video generation menus:',error);return null;});
  let imageMenus=null, cameraControls=null, shortcutModule=null, shortcutController=null, popCleanup=null, menuRevision=0;
  import('./src/features/prompt-shortcuts/menu.mjs').then(module=>{shortcutModule=module;bindShortcuts();}).catch(error=>console.error('Prompt shortcuts:',error));
  const cameraReady=import('./src/features/camera-control/controls.mjs').then(module=>{cameraControls=module;if(node){config=structuredClone(getConfig(node));refreshFooter();position();}return module;}).catch(error=>{console.error('Camera controls:',error);return null;});
  const imageMenusReady=import('./src/features/image-generation/menus.mjs').then(module=>{imageMenus=module;if(node){syncResultCountMode();refreshFooter();position();}return module;}).catch(error=>{console.error('Image generation menus:',error);return null;});
  const panel=make('section','node-editor');panel.id='node-editor';panel.hidden=true;panel.setAttribute('aria-label','节点生成参数');
  const pop=make('section','parameter-popover');pop.id='parameter-popover';pop.hidden=true;
  document.body.append(panel,pop);
  function defaults(n){return {prompt:'',refs:[],model:n.type==='video'?'Seedance 2.0':'Tap Nano 2',ratio:'16:9',quality:n.type==='video'?'1080p':'2K',duration:5,count:n.type==='video'?1:4,camera:'Sony Venice',lens:'Zeiss Ultra Prime',focal:'24mm',aperture:'ƒ/4',thinking:'high',mode:'全能参考',audio:true};}
  function countConfiguration(value,n=node){
    if(!resultCounts)return {options:[1,2],times:value.count};
    if(n.type==='image')return resultCounts.imageResultCounts({mode:resultMode,isMidjourney:!!imageMenus?.modelFor(value.model)?.midjourney||/^midjourney(?:-|\s)/i.test(value.model),currentTimes:value.count??value.times});
    const model=videoMenus?.modelFor(value.model),variant=model?.variants.find(v=>v.key===value.variant||v.modelType===value.videoMode)||model?.variants[0];
    return resultCounts.videoResultCounts({currentTimes:value.count??value.times,timesOptions:variant?.options?.timesOptions,final:typeof value.draftVideoId==='string'&&!!value.draftVideoId.trim()});
  }
  function normalizeCountConfig(value,n=node){const count=countConfiguration(value,n).times;return {...value,resultMode,count,...value.times!==undefined?{times:count}:{}};}
  function syncResultCountMode(event){
    if(event){if(!['pile','spread','variants'].includes(event.detail?.mode))return;resultMode=event.detail.mode;}
    if(!node||panel.hidden||!resultCounts)return;
    const previous=config;config=normalizeCountConfig(config);closePopover();
    if(previous.count!==config.count||previous.times!==config.times||previous.resultMode!==config.resultMode)save();
    refreshFooter();position();
  }
  function getConfig(n){
    const saved=n.generation||n.params||drafts[n.id]||window.EDITOR_DATA?.nodes[n.id]||{};
    let value={...defaults(n),...cameraControls?.initialSettings(n,saved),...saved};
    if(saved.count===undefined&&saved.times!==undefined)value.count=saved.times;
    if(n.type==='video'&&['MiniMax-H3','MiniMax-H3-Max'].includes(videoMenus?.modelFor(value.model)?.id)){
      const state=app.getState();
      let inputs=composerLayout?.referencesFor(n,value,state,window.CanvasLibrary?.items||[],window.EDITOR_DATA?.nodes)||[
        ...(value.refs||[]).map(url=>({type:'image',url})),
        ...state.edges.filter(edge=>edge.target===n.id).map(edge=>state.nodes.find(source=>source.id===edge.source)).filter(Boolean)
      ];
      inputs=inputs.filter(input=>!input.empty);
      if(composerLayout)inputs.push(...(composerLayout.assetReferences(value.prompt)||[]));
      if(subjects&&subjects.subjectsEnabled(n.type,value))try{inputs=subjects.projectSubjects({kind:'video.generate',prompt:value.prompt,inputs,parameters:value},subjects.listSubjects()).inputs;}catch{}
      // H3 has native audio and no audio switch. Reopening must not reintroduce
      // the generic node defaults after JSON storage removes undefined fields.
      value=videoMenus.configuration(value,inputs).settings;
      delete value.audio;delete value.generateAudio;
    }
    value.audioLabel=value.audioLabel||(value.audio?'开启':'关闭');
    return normalizeCountConfig(value,n);
  }
  function save(patch={}){if(composerLayout)config=composerLayout.reconcilePrompt(config,references());if(!node.generation)node.generation=structuredClone(getConfig(node));drafts[node.id]=structuredClone(config);try{localStorage.setItem(nodeSettingsKey,JSON.stringify(drafts));}catch{}app.updateNode(node.id,{...patch,generation:structuredClone(config)});}
  function update(key,value){config[key]=value;save();draw();}
  function closePopover(restoreFocus=false){pendingAnchor=null;const anchor=popAnchor;popCleanup?.();popCleanup=null;menuRevision++;pop.hidden=true;anchor?.setAttribute('aria-expanded','false');popAnchor=null;pop.onkeydown=null;if(restoreFocus&&!panel.hidden&&anchor?.isConnected&&!anchor.disabled)anchor.focus({preventScroll:true});}
  function togglePopover(anchor){if(!pop.hidden&&popAnchor===anchor){closePopover(true);return true;}return false;}
  function dismissPopoverKey(event){if(event.key!=='Escape'||event.defaultPrevented||event.isComposing||event.keyCode===229||pop.hidden||!pop.contains(event.target)&&!popAnchor?.contains(event.target))return;event.preventDefault();event.stopImmediatePropagation();closePopover(true);}
  function placePopover(){
    if(pop.hidden||!popAnchor?.isConnected)return;
    const r=popAnchor.getBoundingClientRect();
    pop.style.maxHeight='calc(100vh - 24px)';
    const topSpace=r.top-16,bottomSpace=innerHeight-r.bottom-16;
    const above=topSpace>=pop.offsetHeight||topSpace>=bottomSpace;
    pop.style.maxHeight=Math.max(40,above?topSpace:bottomSpace)+'px';
    const w=pop.offsetWidth,h=pop.offsetHeight;
    const x=(pop.classList.contains('image-spec-menu')||pop.classList.contains('camera-control-popover'))?r.left+r.width/2-w/2:r.left;
    pop.style.left=Math.max(8,Math.min(innerWidth-w-8,x))+'px';
    pop.style.top=(above?Math.max(8,r.top-h-8):r.bottom+8)+'px';
  }
  function showPopover(anchor,cls=''){
    pendingAnchor=null;popCleanup?.();popCleanup=null;menuRevision++;popAnchor?.setAttribute('aria-expanded','false');pop.replaceChildren();pop.className='parameter-popover '+cls;pop.onkeydown=null;
    popAnchor=anchor;popAnchor.setAttribute('aria-expanded','true');pop.setAttribute('role','dialog');pop.tabIndex=-1;pop.hidden=false;pop.focus({preventScroll:true});
  }
  function busy(){return submitting.has(node?.id)||!!node?.pendingOperation||window.GenerationAPI.getJobs().some(job=>job.request.nodeId===node?.id&&(['queued','running'].includes(job.status)||job.applying));}
  function commitImage(patch){
    if(!node||node.type!=='image'||busy())return config;
    const before=config.ratio;
    config=imageMenus.normalize({...config,...patch,resultMode});
    const geometry=before!==config.ratio?imageMenus.emptyNodeGeometry(node,config.ratio):null;
    if(geometry)imageMenus.resizeNode(node,geometry,save,()=>app.render());else save();
    refreshFooter();position();return config;
  }
  async function imageMenu(kind,anchor){
    if(togglePopover(anchor))return;
    const revision=++menuRevision,id=activeId;pendingAnchor=anchor;const module=await imageMenusReady;
    if(!module||revision!==menuRevision||activeId!==id||!anchor.isConnected||busy())return;
    showPopover(anchor);config.inputCounts=imageInputCount();
    if(kind==='model')module.renderModels(pop,config,next=>{commitImage(next);closePopover();panel.querySelector('.model-trigger')?.focus({preventScroll:true});});
    if(kind==='count')module.renderCount(pop,config,count=>{commitImage({count});closePopover();panel.querySelector('.count-trigger')?.focus({preventScroll:true});});
    if(kind==='spec')module.renderSpecifications(pop,config,commitImage);
    placePopover();requestAnimationFrame(placePopover);
    pop.focus({preventScroll:true});
  }
  function row(label,values,key,layout=''){pop.append(make('div','param-label',label));const group=make('div','option-group '+layout);values.forEach(value=>{const b=button(String(value),()=>{config[key]=value;if(key==='count')config=normalizeCountConfig(config);if(key==='audioLabel')config.audio=value==='开启';save();group.querySelectorAll('button').forEach(x=>{const match=x===b;x.classList.toggle('chosen',match);x.setAttribute('aria-pressed',match);});refreshFooter();});b.classList.toggle('chosen',config[key]===value);b.setAttribute('aria-pressed',config[key]===value);group.append(b);});pop.append(group);}
  function ratios(values){pop.append(make('div','param-label','比例'));const group=make('div','ratio-options');values.forEach(value=>{const b=button('',()=>{config.ratio=value;save();group.querySelectorAll('button').forEach(x=>x.classList.toggle('chosen',x===b));refreshFooter();});b.setAttribute('aria-label',value);b.classList.toggle('chosen',config.ratio===value);const shape=make('span','ratio-shape');const [a,c]=value.split(':').map(Number);shape.style.width=(a>c?16:12)+'px';shape.style.height=(a<c?17:11)+'px';if(a===c)shape.style.height='13px';b.append(shape,make('span','',value));group.append(b);});pop.append(group);}
  function videoInputs(){const base=[...references(),...(composerLayout?.assetReferences(config.prompt)||[])].filter(item=>!item.empty);if(!subjects?.subjectsEnabled(node.type,config))return base;try{return subjects.projectSubjects({kind:'video.generate',prompt:config.prompt,inputs:base,parameters:config},subjects.listSubjects()).inputs;}catch{return base;}}
  function commitVideo(next){
    if(!node||node.type!=='video'||busy())return config;
    config=normalizeCountConfig(videoMenus.configuration(next,videoInputs())?.settings||next);
    if(!frameMode())framePicker?.close();
    save();refreshReferenceRow();refreshFooter();position();return config;
  }
  async function videoSpecMenu(anchor){
    if(togglePopover(anchor))return;
    const revision=++menuRevision,id=activeId;pendingAnchor=anchor;const module=await videoMenusReady;
    if(!module||revision!==menuRevision||activeId!==id||!anchor.isConnected||busy())return;
    showPopover(anchor);popCleanup=module.renderSpecifications(pop,config,videoInputs,commitVideo);
    placePopover();requestAnimationFrame(placePopover);pop.focus({preventScroll:true});
  }
  function qualityMenu(anchor){
    if(node.type==='image')return imageMenu('spec',anchor);
    if(videoMenus?.modelFor(config.model))return videoSpecMenu(anchor);
    if(togglePopover(anchor))return;showPopover(anchor,'quality-popover');row('生成方式',['首尾帧','全能参考'],'mode');ratios(['16:9','4:3','1:1','3:4','9:16','21:9']);row('清晰度',['480p','720p','1080p','4k'],'quality');row('生成时长',Array.from({length:12},(_,i)=>i+4),'duration','durations');row('生成音频',['开启','关闭'],'audioLabel');placePopover();
  }
  function modelMenu(anchor){
    if(node.type==='image')return imageMenu('model',anchor);
    if(togglePopover(anchor))return;showPopover(anchor,'model-popover');for(const name of videoModels){const b=button('',()=>{const next={...config,model:name,videoMode:undefined},before=videoMenus?.modelFor(config.model)?.id||config.model,after=videoMenus?.modelFor(name)?.id||name;if(before!==after)for(const key of ['draft','draftVideoId','draftEstimateMedia'])delete next[key];if(videoMenus?.modelFor(name))commitVideo(next);else{config=normalizeCountConfig(next);save();draw();}closePopover(true);},'model-option');const symbol=make('span','model-symbol');const originalIcon=videoMenus?.modelIcon({model:name});if(originalIcon)symbol.append(originalIcon);else symbol.innerHTML=icon('spark');b.append(symbol,make('span','model-name',modelLabel(name)));if(name===config.model||videoMenus?.modelFor(name)?.id===videoMenus?.modelFor(config.model)?.id&&videoMenus?.modelFor(name))b.append(make('span','selected-mark','✓'));pop.append(b);}placePopover();
  }
  function countMenu(anchor){if(node.type==='image')return imageMenu('count',anchor);if(togglePopover(anchor))return;showPopover(anchor,'count-popover');row('生成数量',countConfiguration(config).options,'count');placePopover();}
  function commitCamera(patch){
    if(!node||busy())return;
    Object.assign(config,patch);cameraControls.remember(config);save();refreshFooter();position();
  }
  async function cameraMenu(anchor){
    if(togglePopover(anchor))return;
    const revision=++menuRevision,id=activeId;pendingAnchor=anchor;const module=await cameraReady;
    if(!module||revision!==menuRevision||activeId!==id||!anchor.isConnected||busy())return;
    if(!module.isEnabled(config)){commitCamera({cameraEnabled:true});anchor=panel.querySelector('.camera-trigger');}
    showPopover(anchor);
    popCleanup=module.renderPanel(pop,config,commitCamera,()=>{closePopover();panel.querySelector('.camera-trigger')?.focus({preventScroll:true});});
    placePopover();requestAnimationFrame(placePopover);pop.querySelector('.camera-control-save')?.focus({preventScroll:true});
  }
  function chooseReference(style=false){
    const trigger=document.activeElement,triggerClass=trigger?.classList?.[0];closePopover();const currentId=node.id;const dialog=make('dialog','asset-picker');dialog.setAttribute('aria-label',style?'选择风格图片':'添加参考素材');const head=make('div','dialog-heading');head.append(make('h2','',style?'选择风格图片':'添加参考素材'),button('×',()=>dialog.close(),'close'));dialog.append(head);
    const tabs=make('div','segmented');const personal=button('个人',()=>switchTab('personal')),team=button('团队',()=>switchTab('team')),canvas=button('画布',()=>switchTab('canvas'));tabs.append(personal,team,canvas);dialog.append(tabs);const search=make('input','panel-search');search.placeholder='搜索';dialog.append(search);const body=make('div','picker-body');dialog.append(body);let choice=null,choiceId=null,currentTab=style?'personal':'canvas';
    const footer=make('div','picker-footer');const file=make('input');file.type='file';file.accept='image/*';file.hidden=true;file.onchange=()=>{const f=file.files[0];if(!f)return;const reader=new FileReader();reader.onload=()=>{choice=reader.result;choiceId=null;commit();};reader.readAsDataURL(f);};
    const confirm=button('确认',commit,'solid-button');confirm.disabled=true;footer.append(button('上传图片',()=>file.click()),button('取消',()=>dialog.close()),confirm);dialog.append(file,footer);
    function commit(){if(!choice)return;const selectedNode=choiceId&&app.getState().nodes.find(item=>item.id===choiceId);if(selectedNode?.type!=='text'&&mediaDisplay?.isOriginalMediaRef(choice)){app.notify(unavailableMedia);return;}const n=app.getState().nodes.find(n=>n.id===currentId);if(!style&&choiceId){try{app.connect(choiceId,currentId);config=structuredClone(getConfig(n));dialog.close();draw();}catch(error){app.notify(error.message);}return;}const target=structuredClone(getConfig(n));if(style)target.style=choice;else{target.referenceBindings=target.refs.map((_,i)=>target.referenceBindings?.[i]||null);target.refs.push(choice);target.referenceBindings.push(choiceId);}if(!n.generation)n.generation=structuredClone(getConfig(n));app.updateNode(currentId,{generation:target});config=target;dialog.close();draw();}
    function display(items){body.replaceChildren();const grid=make('div','asset-picker-grid');items.filter(n=>(n.title||n.name||'').toLowerCase().includes(search.value.toLowerCase())).forEach(n=>{
      const canvasSource=!style&&currentTab==='canvas';if(canvasSource?!['image','video','audio','text'].includes(n.type):!n.image&&!n.fullImage)return;
      const b=button('',async()=>{try{const policy=await mediaDisplayReady;if(!dialog.isConnected||!b.isConnected)return;const selected=candidateReferenceSource(n,policy,style);if(!selected){app.notify(unavailableMedia);return;}choice=selected;choiceId=currentTab==='canvas'?n.id:null;confirm.disabled=false;grid.querySelectorAll('button').forEach(e=>e.classList.toggle('chosen',e===b));}catch(error){app.notify(error.message);}},'asset-tile');
      mediaDisplayReady.then(policy=>{if(b.isConnected&&!candidateReferenceSource(n,policy,style)){b.disabled=true;b.title=unavailableMedia;}}).catch(()=>{b.disabled=true;b.title=unavailableMedia;});
      if(canvasSource){const reason=window.CanvasConnections?.validate(n.id,currentId);if(reason){b.disabled=true;b.title=reason;}}
      const i=make(n.image||n.fullImage?'img':'span');if(n.image||n.fullImage){i.alt=n.title||n.name||'';displayReferenceImage(i,n.fullImage||n.image,n.image);}else{i.className='asset-tile-type';i.innerHTML=n.type==='audio'?composerLayout?.musicIcon||'':composerLayout?.mediaIcons[n.type+'Type']||'';}
      b.append(i,make('span','',n.title||n.name||n.type));grid.append(b);
    });body.append(grid);if(!grid.children.length)body.append(make('p','panel-empty','暂无素材'));}
    function switchTab(type){currentTab=type;personal.classList.toggle('chosen',type==='personal');team.classList.toggle('chosen',type==='team');canvas.classList.toggle('chosen',type==='canvas');choice=null;choiceId=null;confirm.disabled=true;if(type==='canvas')display(app.getState().nodes);else if(type==='team')display([]);else{body.replaceChildren();for(const folder of ['收藏','角色','场景','道具','风格','音效','Others']){const b=button('',()=>display(window.CanvasLibrary?.items?.filter(i=>i.folder===folder)||[]),'folder-row');b.append(make('span','folder-chevron','›'),make('span','folder-symbol'),make('span','',folder));body.append(b);}}}
    search.oninput=()=>{if(currentTab==='canvas')display(app.getState().nodes);else display(currentTab==='team'?[]:window.CanvasLibrary?.items||[]);};switchTab(currentTab);document.body.append(dialog);dialog.addEventListener('close',()=>{dialog.remove();if(!panel.hidden&&activeId===currentId){const anchor=trigger?.isConnected?trigger:triggerClass&&panel.querySelector('.'+triggerClass);anchor?.focus({preventScroll:true});}});dialog.showModal();
  }
  function frameMode(){return node?.type==='video'&&(videoMenus?.configuration(config,videoInputs())?.settings.mode||config.mode)==='首尾帧';}
  function frameError(){
    if(!frameMode()||!videoFrames)return '';
    const items=references(),slots=videoFrames.frameSlots(items,tailFrameKey);
    if(slots.last&&!slots.first)return '请先选择首帧';
    if(items.some(item=>item.empty))return '参考节点没有内容';
    return '';
  }
  function refreshReferenceRow(){panel.querySelector('.reference-strip')?.replaceWith(referenceRow());position();}
  function selectReference(){
    if(!referencePicker||busy()||focusEdit?.active())return;
    if(framePicker){const previous=framePicker.slot;framePicker.close();if(previous==='reference')return;}
    closePopover();const targetId=node.id;
    framePicker=referencePicker.pickReference({app,targetId,allowedTypes:node.type==='image'?['image','text']:['image','video','audio','text'],onSelect(id){
      app.connect(id,targetId);config=structuredClone(getConfig(node));refreshReferenceRow();refreshFooter();
    },onClose(){framePicker=null;refreshReferenceRow();updateBusyState();}});
    refreshReferenceRow();updateBusyState();
  }
  function selectFrame(slot){
    if(busy()||focusEdit?.active())return;
    if(framePicker){const previous=framePicker.slot;framePicker.close();if(previous===slot)return;}
    closePopover();const targetId=node.id;
    framePicker=videoFrames.pickFrame({app,targetId,slot,onSelect(id){
      // Keep tail-only selection transient, as in the official component.
      if(slot==='last')tailFrameKey='node:'+id;
      app.connect(id,targetId);config=structuredClone(getConfig(node));
      const items=references(),images=items.filter(item=>item.type==='image');
      if(images.length===2&&images[0].key===tailFrameKey){
        const ordered=[images[1],images[0],...items.filter(item=>item.type!=='image')];
        config=composerLayout.reconcilePrompt({...config,referenceOrder:ordered.map(item=>item.key)},ordered);
        if(!images.some(item=>item.empty))tailFrameKey=null;save();
      }
      refreshReferenceRow();refreshFooter();
    },onClose(){framePicker=null;refreshReferenceRow();updateBusyState();}});
    refreshReferenceRow();updateBusyState();
  }
  function removeReferenceItem(item){
    framePicker?.close();tailFrameKey=null;
    if(item.edgeIds.length){app.removeEdges(item.edgeIds);config=structuredClone(getConfig(node));}
    else{config=composerLayout.removeReference(config,item);save();}
    draw();
  }
  function referenceRow(){
    if(!composerLayout)return legacyReferenceRow();
    referenceUI?.destroy();
    const select=button('',selectReference,'reference-add');select.innerHTML=icon('cursor');select.ariaLabel='选择参考素材';
    const items=references();referenceSignature=JSON.stringify(items);
    const subjectNodeId=node.id;
    const subjectFocus=subjects?.subjectsEnabled(node.type,config)?subjects.subjectTrigger({selected:()=>subjects.subjectIds(config.prompt),onChoose:chosen=>{if(node?.id!==subjectNodeId){app.notify('原节点已切换，请重新选择主体');return;}config.prompt=subjects.replaceSubjects(config.prompt,chosen);promptControl?.sync(config.prompt);save();refreshReferenceRow();refreshFooter();}}):null;
    if(videoFrames&&frameMode()){
      referenceUI=videoFrames.renderFrames({focus:focusEdit?focusEdit.trigger(node.id):select,items,tailKey:tailFrameKey,picking:framePicker?.slot,disabled:busy()||!!focusEdit?.active(),onPick:selectFrame,onRemove:removeReferenceItem,onSwap(){
        framePicker?.close();const images=items.filter(item=>item.type==='image');
        config=composerLayout.reorderReferences(config,items,items.indexOf(images[1]),items.indexOf(images[0]));tailFrameKey=null;save();draw();
      }});
    }else referenceUI=composerLayout.renderReferences({focus:subjectFocus||(focusEdit?focusEdit.trigger(node.id):select),items,disabled:busy()||!!focusEdit?.active(),picking:framePicker?.slot==='reference',imageNode:node.type==='image',onAdd:selectReference,onPick:item=>promptControl?.insert(item),
      onRemove:index=>removeReferenceItem(items[index]),
      onReorder(from,to){config=composerLayout.reorderReferences(config,items,from,to);save();draw();}
    });referenceUI.element.dataset.busy=String(busy());return referenceUI.element;
  }
  function references(settings=config){return composerLayout?.referencesFor(node,settings,app.getState(),window.CanvasLibrary?.items||[],window.EDITOR_DATA?.nodes)||[];}
  function inputs(settings=config){if(!composerLayout)throw Error('参考素材组件仍在加载');return composerLayout.referenceInputs(references(settings));}
  function legacyReferenceRow(){const row=make('div','reference-strip');const select=button('',selectReference,'reference-add');select.innerHTML=icon('cursor');select.title='选择参考素材';select.setAttribute('aria-label','选择参考素材');row.append(focusEdit?focusEdit.trigger(node.id):select);if(focusEdit)row.append(make('span','focus-reference-divider'));config.refs.forEach((src,index)=>{const chip=make('div','reference-chip');chip.draggable=true;chip.dataset.index=index;const img=make('img');img.alt=`参考图 ${index+1}`;displayReferenceImage(img,src);const remove=button('×',()=>{config.refs.splice(index,1);config.referenceBindings?.splice(index,1);save();draw();},'remove-reference');remove.setAttribute('aria-label',`移除参考图 ${index+1}`);chip.append(img,remove);chip.ondragstart=()=>{dragRef=index;};chip.ondragover=e=>e.preventDefault();chip.ondrop=e=>{e.preventDefault();if(dragRef===null)return;const [r]=config.refs.splice(dragRef,1);config.refs.splice(index,0,r);if(config.referenceBindings){const [binding]=config.referenceBindings.splice(dragRef,1);config.referenceBindings.splice(index,0,binding);}dragRef=null;save();draw();};row.append(chip);});const add=button('+',selectReference,'reference-add');add.setAttribute('aria-label','添加参考图');add.disabled=!!focusEdit?.active();row.append(add);if(node.type==='image'&&config.refs.length)row.append(make('span','reference-count',`参考图 ${config.refs.length} 张`));return row;}
  function refreshFooter(){
    if(draftFinalUI?.finalMode(node,config))return;
    const footer=panel.querySelector('.generation-footer');if(!footer)return;const anchorClass=!pop.hidden?popAnchor?.classList[0]:null;footer.replaceChildren();
    const model=button('',e=>modelMenu(e.currentTarget),'model-trigger');const originalModelIcon=node.type==='image'?imageMenus?.modelIcon(config):videoMenus?.modelIcon(config);if(originalModelIcon)model.append(originalModelIcon);else model.innerHTML=icon('spark');model.append(make('span','',node.type==='video'?modelLabel(videoMenus?.modelFor(config.model)?.name||config.model):config.model));model.setAttribute('aria-label','选择生成模型');footer.append(model,make('span','footer-separator'));
    const videoData=node.type==='video'&&videoMenus?.configuration(config,videoInputs());
    const quality=button('',e=>qualityMenu(e.currentTarget),'quality-trigger');if(node.type==='image'&&imageMenus)quality.append(imageMenus.ratioIcon(config.ratio,16));else if(!videoData?.modeOptions?.length)quality.innerHTML=icon('screen');quality.append(make('span','',node.type==='video'?(videoData?videoMenus.triggerLabel(videoData):`${config.mode} · ${config.ratio} · ${config.quality} · ${config.duration}s`):(imageMenus?.triggerLabel(config)||`${config.ratio} · ${config.quality}`)));if(node.type==='video'&&videoData?.options.supportsAudio){quality.append(make('span','','·'),videoMenus.audioIcon(videoData.settings.audio));}quality.setAttribute('aria-label','生成规格');footer.append(quality);
    if(node.type==='image'){const style=button('',()=>chooseReference(true),'style-trigger');style.innerHTML=icon('image');style.append(make('span','','风格'));style.classList.toggle('configured',!!config.style);footer.append(style);if(cameraControls?.supportsCamera(imageMenus?.modelFor(config.model)?.id))footer.append(cameraControls.renderTrigger(config,commitCamera,cameraMenu));}
    footer.append(make('span','footer-spacer'));const voice=button('',null,'voice-trigger');voice.innerHTML=icon('mic');footer.append(voice,make('span','footer-separator'));const voiceNodeId=node.id,voiceTarget=panel.querySelector('.prompt-editor');window.VoiceInput.bind(voice,{target:voiceTarget,getValue:()=>promptControl?promptControl.getText():focusEdit?focusEdit.readPrompt(voiceTarget):voiceTarget.innerText,captureSelection:promptControl?()=>promptControl.captureSelection():undefined,commitTranscript:promptControl?(snapshot,text)=>promptControl.commitTranscript(snapshot,text):undefined,setValue:value=>{if(promptControl)promptControl.sync(value);else if(focusEdit)focusEdit.paintPrompt(voiceTarget,value);else voiceTarget.textContent=value;config.prompt=value;save();},isCurrent:()=>activeId===voiceNodeId,mount:footer});
    const count=button(config.count*(node.type==='image'&&imageMenus?.modelFor(config.model)?.midjourney?4:1)+'×',e=>countMenu(e.currentTarget),'count-trigger');count.setAttribute('aria-label','生成数量');footer.append(count);
    const generate=button('',submitGeneration,'generate-trigger');generate.title='生成';generate.setAttribute('aria-label','生成');footer.append(generate);
    for(const trigger of [model,quality,count]){trigger.setAttribute('aria-haspopup','dialog');trigger.setAttribute('aria-expanded','false');}
    if(anchorClass){popAnchor=footer.querySelector('.'+anchorClass);popAnchor?.setAttribute('aria-expanded','true');}
    updateBusyState();placePopover();
  }
  function imageInputCount(){return new Set([...references(),...composerLayout.assetReferences(config.prompt)].filter(item=>item.type==='image'&&!item.empty).map(item=>item.url)).size;}
  function generationContent(settings){const policy=composerLayout.libraryPolicy(node.type,settings.model,settings.mode);const projected=composerLayout.projectGenerationPrompt(settings.prompt,inputs(settings),policy.enabled?policy.allowed:[]);if(subjects&&subjects.subjectIds(projected.prompt).length){settings.subjects=subjects.listSubjects().filter(s=>subjects.subjectIds(projected.prompt).includes(s.id));subjects.projectSubjects({kind:node.type+'.generate',...projected,parameters:settings},settings.subjects);}return projected;}
  async function submitGeneration(){
    if(draftFinalUI?.finalMode(node,config))return draftFinalUI.submit();
    if(busy())return;
    if(frameError()){app.notify(frameError());return;}
    const target=node,submitted=structuredClone(config);submitting.add(target.id);updateBusyState();
    try{return await window.GenerationAPI.submit({kind:target.type+'.generate',label:target.type==='video'?'视频生成':'图片生成',nodeId:target.id,...generationContent(submitted),parameters:submitted});}catch(error){app.notify(error.message);}finally{submitting.delete(target.id);updateBusyState();}
  }

  function updateBusyState(){
    if(draftFinalUI?.finalMode(node,config)){panel.setAttribute('aria-busy',String(busy()));draftFinalUI.update();if(busy()&&!pop.hidden)closePopover();return;}
    const disabled=busy();draftFinalUI?.update();if(panel.querySelector('.reference-strip')?.dataset.busy!==String(disabled)&&panel.querySelector('.reference-strip'))refreshReferenceRow();promptControl?.setEditable(!disabled);panel.setAttribute('aria-busy',disabled);
    panel.querySelectorAll('.model-trigger,.quality-trigger,.count-trigger,.generate-trigger,.focus-edit-trigger,.camera-control-trigger button').forEach(button=>{button.disabled=disabled;});
    if(node?.type==='image'&&imageMenus){
      const imageCount=imageInputCount();
      const compatibility=imageMenus.inputCompatibility(imageMenus.modelFor(config.model),imageCount);
      const generate=panel.querySelector('.generate-trigger');
      if(generate){generate.disabled=disabled||!compatibility.supported;generate.title=compatibility.reason||'生成';}
      const counter=panel.querySelector('.reference-count');
      if(counter){counter.textContent=compatibility.error==='max_images_exceeded'?`参考图 ${imageCount} / ${compatibility.maxImages}`:`参考图 ${imageCount} 张`;counter.classList.toggle('exceeded',!compatibility.supported);}
    }
    if(node?.type==='video'&&videoMenus){const data=videoMenus.configuration(config,videoInputs()),generate=panel.querySelector('.generate-trigger');if(generate&&data){generate.disabled=disabled||!!data.error||!!frameError();generate.title=frameError()||data.error||'生成';}}
    const generate=panel.querySelector('.generate-trigger');if(generate)generationAction?.updateGenerationAction(generate,{busy:disabled,disabled:generate.disabled,label:'生成'});
    if(framePicker){const focus=panel.querySelector('.focus-edit-trigger');if(focus)focus.disabled=true;if(disabled)framePicker.close();}
    shortcutController?.update();
    if(disabled&&!pop.hidden)closePopover();
  }
  function bindShortcuts(){
    shortcutController?.destroy();shortcutController=null;
    const prompt=panel.querySelector('.prompt-editor');
    if(!shortcutModule||node?.type!=='image'||!prompt)return;
    const id=node.id;
    shortcutController=shortcutModule.bindMenu({panel,prompt,getState:()=>({busy:busy()||activeId!==id,referenceCount:references().filter(item=>item.type==='image'&&!item.empty).length}),onOpen:closePopover,onSelect:command=>{
      if(activeId!==id||busy())return;
      const submitted=structuredClone(config);
      try{window.GenerationAPI.submit({kind:'image.generate',label:command.title,nodeId:id,...generationContent({...submitted,prompt:command.prompt}),parameters:{...submitted,shortcut:{id:command.id,title:command.title}}});}catch(error){app.notify(error.message);}
    }});
  }
  function draw(){
    if(!node)return;positionReady=false;draftFinalUI?.beginUpdate(node,config);shortcutController?.destroy();shortcutController=null;promptControl?.destroy();promptControl=null;
    if(composerLayout&&!draftFinalUI?.finalMode(node,config))config=composerLayout.reconcilePrompt(config,references());
    panel.replaceChildren();panel.classList.toggle('video-editor',node.type==='video');const draftView=draftFinalUI?.mount(node,config);draftFinalSignature=draftFinalUI?.signature(node,config)||'';
    if(draftView?.replacement){framePicker?.close();referenceUI=null;draftFinalUI?.finishMount();position();updateBusyState();return;}
    const content=draftView?.body||panel;content.append(referenceRow());
    const host=make('div','composer-prompt-host');content.append(host);
    let prompt;
    if(promptModule){promptControl=promptModule.createNodePrompt({element:host,value:config.prompt,getItems:references,getLibrary:()=>({library:window.CanvasLibrary?.items||[],folders:window.CanvasLibrary?.folders||[]}),getPolicy:()=>composerLayout.libraryPolicy(node.type,config.model,config.mode),getSubjects:()=>subjects?.subjectsEnabled(node.type,config)?subjects.listSubjects():[],onChange:value=>{config.prompt=value;save();},onSubmit:()=>{if(!panel.querySelector('.generate-trigger')?.disabled)submitGeneration();}});prompt=promptControl.dom;}
    else{prompt=make('div','prompt-editor');prompt.contentEditable='true';prompt.setAttribute('role','textbox');prompt.setAttribute('aria-label','生成提示词');prompt.setAttribute('aria-multiline','true');if(focusEdit){focusEdit.paintPrompt(prompt,config.prompt);focusEdit.bindPrompt(prompt);}else prompt.textContent=config.prompt;prompt.oninput=()=>{config.prompt=focusEdit?focusEdit.readPrompt(prompt):prompt.innerText;save();};prompt.onkeydown=e=>e.stopPropagation();host.append(prompt);}
    prompt.dataset.placeholder=node.type==='video'?'描述视频内容、动作和镜头运动…':'描述你想要生成的画面…';
    const footer=make('div','generation-footer');content.append(footer);refreshFooter();bindShortcuts();draftFinalUI?.finishMount();position();
  }
  // Viewport updates retain live width/history geometry, but prompt overflow and
  // composer dimensions are refreshed by full renders and existing layout events.
  function position(options){if(panel.hidden||!node||!composerLayout)return;const {view}=app.getState(),layout={...node,...window.NodeEditor.layoutFor(node),...window.ImageHistory?.layoutFor(node)};const bounds=$('#canvas').getBoundingClientRect();if(options?.viewportOnly===true&&positionReady){panel.style.left=bounds.left+(layout.x+layout.width/2)*view.scale+view.x-panel.offsetWidth/2+'px';panel.style.top=bounds.top+(layout.y+layout.height+8)*view.scale+view.y+8+'px';}else if(draftFinalUI?.finalMode(node,config)){panel.classList.add('source-anchored');panel.classList.remove('compact-editor');Object.assign(panel.style,{width:'max-content',minWidth:'640px',maxWidth:'min(960px, calc(100vw - 32px))',height:'auto'});panel.style.left=bounds.left+(layout.x+layout.width/2)*view.scale+view.x-panel.offsetWidth/2+'px';panel.style.top=bounds.top+(layout.y+layout.height+8)*view.scale+view.y+8+'px';}else composerLayout.placeComposer(panel,layout,view,bounds,config);positionReady=true;placePopover();}
  function onRender(event){if(event?.detail?.viewportOnly){position({viewportOnly:true});return;}const state=app.getState();draftFinalUI?.syncBadges(state);const picked=state.nodes.find(n=>state.selected.length===1&&n.id===state.selected[0]);const eligible=picked&&['image','video'].includes(picked.type)&&!picked.tool&&(picked.generation||picked.params||window.EDITOR_DATA?.nodes[picked.id]||/generation|生成/i.test(picked.title)||!picked.image&&['image','video'].includes(picked.type));if(!eligible){positionReady=false;draftFinalUI?.unmount();draftFinalSignature='';framePicker?.close();tailFrameKey=null;composerLayout?.reset(panel);panel.hidden=true;shortcutController?.close();promptControl?.close();activeId=null;closePopover();return;}panel.hidden=false;if(activeId!==picked.id||node!==picked){framePicker?.close();tailFrameKey=null;node=picked;activeId=picked.id;config=structuredClone(getConfig(picked));closePopover();draw();}else{node=picked;const live=getConfig(picked);if(draftFinalUI&&draftFinalSignature!==draftFinalUI.signature(picked,live)){config=structuredClone(live);closePopover();draw();return;}if(draftFinalUI?.finalMode(picked,live)){config=structuredClone(live);updateBusyState();return;}if(composerLayout&&JSON.stringify(references(live))!==referenceSignature){config=composerLayout.reconcilePrompt(structuredClone(live),references(live));panel.querySelector(".reference-strip")?.replaceWith(referenceRow());promptControl?.sync(config.prompt);refreshFooter();if(config.prompt!==live.prompt)save();}position();updateBusyState();}}
  for(const surface of [panel,pop])surface.addEventListener('keydown',event=>{if(event.key!=='Escape')event.stopPropagation();});
  document.addEventListener('focus-edit:change',()=>{if(focusEdit?.active())framePicker?.close();if(node){const row=panel.querySelector('.reference-strip');row?.replaceWith(referenceRow());}});
  window.addEventListener('canvas:generation-result-mode',syncResultCountMode);
  window.addEventListener('storage',event=>{if(event.key==='tapnow.canvas.generation-result-mode'||event.key===null){let mode='variants';try{mode=localStorage.getItem('tapnow.canvas.generation-result-mode')||'variants';}catch{}syncResultCountMode({detail:{mode:['pile','spread','variants'].includes(mode)?mode:'variants'}});}});
  document.addEventListener('canvas:render',onRender);document.addEventListener('voice:layout',position);document.addEventListener('pointerdown',e=>{if(!pop.contains(e.target)&&!popAnchor?.contains(e.target))closePopover();});document.addEventListener('focusin',e=>{if((!pop.hidden||pendingAnchor)&&!pop.contains(e.target)&&!popAnchor?.contains(e.target)&&!pendingAnchor?.contains(e.target))closePopover();});for(const surface of [pop,panel])surface.addEventListener('keydown',dismissPopoverKey);window.addEventListener('resize',position);document.addEventListener('image-menus:layout',position);document.addEventListener('node-composer:layout',position);window.GenerationAPI.subscribe(updateBusyState);
  window.NodeEditor={getConfig,withoutSources:(n,sources)=>composerLayout?.withoutSources(getConfig(n),sources),layoutFor:n=>imageMenus?.layoutFor(n),invalidate(){activeId=null;},setConfig(id,patch){const n=app.getState().nodes.find(n=>n.id===id);if(!n||!['image','video'].includes(n.type))throw Error('请选择图片或视频生成节点');if(!n.generation)n.generation=structuredClone(getConfig(n));const next=normalizeCountConfig({...getConfig(n),...structuredClone(patch)},n);activeId=null;app.updateNode(id,{generation:next});return getConfig(n);},openPicker:chooseReference,closePopover};onRender();
})();
