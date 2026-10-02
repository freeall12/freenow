(() => {
  'use strict';
  import('./image-versions-ui.mjs');
  const reviewReady=import('./media-review-ui.mjs');
  const enhanceReady=import('./image-enhance-ui.mjs');
  const cutoutReady=import('./image-cutout-ui.mjs'),outpaintReady=import('./image-outpaint-ui.mjs'),eraseReady=import('./image-erase-ui.mjs');
  const app=window.CanvasApp,$=s=>document.querySelector(s);
  const el=(tag,cls,text)=>{const e=document.createElement(tag);e.className=cls||'';if(text!==undefined)e.textContent=text;return e;};
  const btn=(text,fn,cls='')=>{const b=el('button',cls,text);b.type='button';b.onclick=fn;window.applyButtonIcon?.(b,text);return b;};
  const panel=el('section','node-action-panel');panel.hidden=true;panel.setAttribute('aria-label','图片工具参数');document.body.append(panel);
  let active=null,pop=null;
  const decorations=new WeakMap();
  function close(){window.ImageOutpaint?.close();window.ImageErase?.close();window.ImageAnnotation?.close();window.ImageCrop?.close();window.ImageRedraw?.close();window.ImageResize?.close();window.ImageRelight?.close();window.ImageAngle?.close();panel.querySelectorAll('video').forEach(v=>v.pause());active=null;panel.hidden=true;document.body.classList.remove('action-editing');app.render();}
  function place({viewportOnly=false}={}){if(!active)return;const state=app.getState(),{view}=state,n=viewportOnly?active.node:state.nodes.find(n=>n.id===active.node.id);if(!n){close();return;}active.node=n;const w=panel.offsetWidth;panel.style.left=Math.max(12,Math.min($('#canvas').clientWidth-w-12,(n.x+n.width/2)*view.scale+view.x-w/2))+'px';panel.style.top=Math.max(80,Math.min(innerHeight-panel.offsetHeight-18,(n.y+n.height)*view.scale+view.y+12))+'px';}
  function start(node,kind,title){window.ImageOutpaint?.close();window.ImageErase?.close();window.ImageAnnotation?.close();window.ImageCrop?.close();window.ImageRedraw?.close();window.ImageResize?.close();window.ImageRelight?.close();window.ImageAngle?.close();if(active?.kind===kind&&active.node.id===node.id){close();return false;}panel.querySelectorAll('video').forEach(v=>v.pause());active={node,kind,returnFocus:document.activeElement};panel.replaceChildren();panel.className='node-action-panel '+kind+'-panel';panel.hidden=false;const header=el('header');header.append(el('span','',title),btn('×',close,'action-close'));panel.append(header);document.body.classList.add('action-editing');window.NodeEditor.closePopover();app.select(node.id,true);return true;}
  function select(label,values,value,onChange){const row=el('label','action-select');row.append(el('span','',label));const input=el('select');input.setAttribute('aria-label',label);values.forEach(v=>{const o=el('option','',v);o.value=v;input.append(o);});input.value=value;input.onchange=()=>onChange(input.value);row.append(input);return row;}
  function slider(label,min,max,step,value,onChange,suffix=''){const row=el('label','action-slider'),line=el('span'),out=el('output','',value+suffix),input=el('input');line.append(el('span','',label),out);input.type='range';Object.assign(input,{min,max,step,value});input.setAttribute('aria-label',label);input.oninput=()=>{out.textContent=input.value+suffix;onChange(+input.value,out);};row.append(line,input);row.input=input;row.output=out;return row;}
  function toggle(label,value,onChange){const row=el('label','action-toggle'),input=el('input');input.type='checkbox';input.checked=value;input.setAttribute('role','switch');input.setAttribute('aria-label',label);input.onchange=()=>onChange(input.checked);row.append(el('span','',label),input);return row;}
  function submit(node,kind,label,parameters,prompt=''){const source=app.getState().nodes.find(n=>n.id===node.sourceId)||node;return window.GenerationAPI.submit({kind,label,nodeId:node.id,prompt,inputs:[{type:source.type||'image',url:source.type==='video'?(source.video||window.EDITOR_DATA?.nodes[source.id]?.video):source.fullImage||source.image}],parameters:structuredClone(parameters)});}
  function footer(node,kind,label,params,prompt){const row=el('footer','action-footer');if(node.image){const img=el('img');img.src=node.image;img.alt='参考图片';row.append(img);}const estimate=el('span','action-estimate','约 1 分钟');estimate.insertAdjacentHTML('afterbegin',window.UI_ICONS.time);row.append(estimate,btn('↑',()=>submit(node,typeof kind==='function'?kind():kind,label,params,prompt?.value||''),'action-generate'));row.lastChild.setAttribute('aria-label','生成'+label);panel.append(row);}
  function multiAngle(node){import('./image-angle-ui.mjs').then(m=>m.open(node)).catch(e=>app.notify(e.message));}
  function relight(node){import('./image-relight-ui.mjs').then(m=>m.open(node)).catch(e=>app.notify(e.message));}
  async function loadImage(node){const image=new Image();if(/^https?:/.test(node.fullImage||node.image))image.crossOrigin='anonymous';image.src=node.fullImage||node.image;await image.decode();return image;}
  function notify(message){const d=el('dialog');d.append(el('p','',message),btn('关闭',()=>d.close()));document.body.append(d);d.onclose=()=>d.remove();d.showModal();}
  function resize(node){import('./image-resize-ui.mjs').then(m=>m.open(node)).catch(e=>app.notify(e.message));}
  async function split(node,rows,cols=rows){
    if(!Number.isInteger(rows)||!Number.isInteger(cols)||rows<1||cols<1||rows>8||cols>8)throw Error('切分范围为 1–8 行和列');
    const image=await loadImage(node),outputs=[],w=Math.floor(image.width/cols),h=Math.floor(image.height/rows);
    if(!w||!h)throw Error('图片太小，无法切分');
    // Match the source's equal-sized tiles; remainder pixels on the bottom/right are omitted.
    for(let y=0;y<rows;y++)for(let x=0;x<cols;x++){
      const c=document.createElement('canvas');c.width=w;c.height=h;c.getContext('2d').drawImage(image,x*w,y*h,w,h,0,0,w,h);
      outputs.push({type:'image',title:`切分 ${y+1}-${x+1}`,image:c.toDataURL('image/png'),width:w,height:h,pixelWidth:w,pixelHeight:h});
    }
    const added=app.createConnected(node.id,outputs);close();return added;
  }
  function enhance(node,existing=false){enhanceReady.then(m=>m.open(node,existing)).catch(e=>app.notify(e.message));}
  function closePop(){if(pop?.dataset.videoTrigger)document.querySelector(`#node-toolbar [data-video-action="${pop.dataset.videoTrigger}"]`)?.setAttribute('aria-expanded','false');document.querySelectorAll('.split-preview').forEach(e=>e.remove());if(pop?.classList.contains('video-more-menu'))document.querySelector('#node-toolbar [data-video-action="更多操作"]')?.setAttribute('aria-expanded','false');pop?.remove();pop=null;}
  function popup(anchor,cls=''){closePop();pop=el('div','node-action-pop '+cls);document.body.append(pop);const r=anchor.getBoundingClientRect();pop.style.left=Math.max(8,Math.min(innerWidth-240,r.left))+'px';pop.style.top=Math.max(70,r.bottom+8)+'px';return pop;}
  const pinColors=[['红色','#f0606b'],['橙色','#f4a14b'],['黄色','#edc63d'],['绿色','#4fc978'],['蓝色','#4ea8ff'],['紫色','#a55cf0']];
  function pins(node){if(node.colorPins)return node.colorPins;const legacy=['#dd7777','#dd9e62','#d8c564','#7cab76','#6e98c6','#a17ab7'].indexOf(node.color);return ['image','video','audio'].includes(node.type)&&legacy>=0?[pinColors[legacy][1]]:[];}
  function colors(node,anchor){
    if(pop?.classList.contains('color-pins')){closePop();return;}
    const menu=popup(anchor,'color-pins');menu.dataset.nodeId=node.id;menu.setAttribute('role','dialog');menu.setAttribute('aria-label','Pin 颜色');
    const paint=()=>{const current=app.getState().nodes.find(n=>n.id===node.id);[...menu.children].forEach((b,i)=>{const chosen=pins(current).includes(pinColors[i][1]);b.setAttribute('aria-pressed',String(chosen));b.firstChild.innerHTML=chosen?window.UI_ICONS.check:'';});};
    for(const [name,color]of pinColors){
      const b=btn('',()=>{const current=app.getState().nodes.find(n=>n.id===node.id),values=pins(current);app.updateNode(node.id,{colorPins:values.includes(color)?values.filter(v=>v!==color):[...values,color]});paint();});const swatch=el('span');swatch.style.background=color;b.append(swatch);b.setAttribute('aria-label',name);menu.append(b);
    }
    paint();const r=anchor.getBoundingClientRect();menu.style.left=Math.max(8,Math.min(innerWidth-menu.offsetWidth-8,r.left+r.width/2-menu.offsetWidth/2))+'px';menu.style.top=(r.top-48<8?r.bottom+8:r.top-48)+'px';
    menu.onkeydown=e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();closePop();document.querySelector('#node-toolbar [aria-label="Pin"]')?.focus({preventScroll:true});return;}if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();e.stopPropagation();const items=[...menu.children],i=items.indexOf(document.activeElement);items[e.key==='Home'?0:e.key==='End'?items.length-1:(i+(e.key==='ArrowRight'?1:-1)+items.length)%items.length].focus({preventScroll:true});};(menu.querySelector('[aria-pressed="true"]')||menu.firstChild).focus({preventScroll:true});
  }
  function more(node,anchor){
    if(pop?.classList.contains('image-more-menu')){closePop();return;}
    const menu=popup(anchor,'image-more-menu'),icons=window.CANVAS_MENU_ICONS;menu.setAttribute('role','menu');menu.setAttribute('aria-label','图片更多操作');
    const action=(name,icon,fn)=>{const b=btn(name,()=>{closePop();fn();});b.insertAdjacentHTML('afterbegin',icons[icon]);b.setAttribute('role','menuitem');return b;};
    for(const [name,icon,fn]of [['扩图','outpaint',()=>outpaintReady.then(m=>m.open(node))],['擦除','erase',()=>eraseReady.then(m=>m.open(node))],['标注','annotation',()=>annotation(node)],['增强','enhance',()=>enhance(node)],['调整像素','resize',()=>resize(node)],['抠图','removeBackground',()=>cutoutReady.then(m=>m.submit(node.id))]]){const item=action(name,icon,fn);menu.append(item);if(icon==='removeBackground')cutoutReady.then(m=>m.bindMenu(item,node.id));}
    const row=el('div','split-row');row.insertAdjacentHTML('afterbegin',icons.split);row.append(el('span','','快速切分'));
    const run=(r,c)=>{closePop();split(node,r,c).catch(e=>notify(e.message));};
    const preview=(rows,cols)=>{
      document.querySelectorAll('.split-preview').forEach(e=>e.remove());
      const body=document.querySelector(`.node[data-id="${node.id}"] .node-body`);if(!body)return;
      const grid=el('div','split-preview');grid.style.gridTemplateColumns=`repeat(${cols},1fr)`;grid.style.gridTemplateRows=`repeat(${rows},1fr)`;
      for(let i=0;i<rows*cols;i++)grid.append(el('i'));body.append(grid);
    };
    for(const n of [2,3,4]){const b=btn(n+'×'+n,()=>run(n,n));b.onpointerenter=()=>preview(n,n);b.onfocus=()=>preview(n,n);row.append(b);}
    const trigger=btn('›',()=>openGrid(true));trigger.setAttribute('aria-label','自定义切分');trigger.setAttribute('aria-haspopup','grid');trigger.setAttribute('aria-expanded','false');row.append(trigger);menu.append(row,action('Seedance 2.0 合规验证','compliance',()=>reviewReady.then(m=>m.submit(node.id))));reviewReady.then(m=>m.bindMenu(menu.lastChild,node.id));
    let picker=null,current=[1,1];
    function openGrid(focus=false){
      if(picker){if(focus)picker.querySelector('button').focus();return;}
      picker=el('div','split-picker');const grid=el('div','split-picker-grid'),out=el('output','','1×1');grid.setAttribute('role','grid');grid.setAttribute('aria-label','切分行列');picker.append(grid,out);menu.append(picker);trigger.setAttribute('aria-expanded','true');
      const paint=(r,c)=>{current=[r,c];out.textContent=r+'×'+c;[...grid.children].forEach((b,i)=>{b.classList.toggle('chosen',Math.floor(i/8)<r&&i%8<c);b.tabIndex=i===(r-1)*8+c-1?0:-1;});preview(r,c);};
      for(let r=1;r<=8;r++)for(let c=1;c<=8;c++){const b=btn('',()=>run(r,c));b.setAttribute('aria-label',r+'×'+c);b.setAttribute('role','gridcell');b.onpointerenter=b.onfocus=()=>paint(r,c);grid.append(b);}
      const mr=menu.getBoundingClientRect(),rr=row.getBoundingClientRect();picker.style.left=Math.max(8,Math.min(innerWidth-220,mr.right+212<=innerWidth-8?mr.right:mr.left-212))+'px';picker.style.top=Math.max(8,Math.min(innerHeight-picker.offsetHeight-8,rr.top-12))+'px';paint(1,1);
      picker.onkeydown=e=>{let [r,c]=current;if(e.key==='Escape'||(e.key==='ArrowLeft'&&c===1)){e.preventDefault();e.stopPropagation();picker.remove();picker=null;trigger.setAttribute('aria-expanded','false');trigger.focus();return;}if(!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();e.stopPropagation();if(e.key==='ArrowUp')r=Math.max(1,r-1);if(e.key==='ArrowDown')r=Math.min(8,r+1);if(e.key==='ArrowLeft')c=Math.max(1,c-1);if(e.key==='ArrowRight')c=Math.min(8,c+1);if(e.key==='Home')c=1;if(e.key==='End')c=8;grid.children[(r-1)*8+c-1].focus();};
      if(focus)grid.firstChild.focus();
    }
    trigger.onpointerenter=()=>openGrid();trigger.onkeydown=e=>{if(e.key==='ArrowRight'){e.preventDefault();e.stopPropagation();openGrid(true);}};
    menu.onpointerleave=()=>{picker?.remove();picker=null;trigger.setAttribute('aria-expanded','false');document.querySelectorAll('.split-preview').forEach(e=>e.remove());};
    menu.onkeydown=e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();closePop();anchor.focus();return;}if(!['ArrowDown','ArrowUp','Home','End'].includes(e.key))return;e.preventDefault();e.stopPropagation();const buttons=[...menu.querySelectorAll(':scope>button,.split-row>button')],i=buttons.indexOf(document.activeElement);buttons[e.key==='Home'?0:e.key==='End'?buttons.length-1:(i+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus();};
    const r=anchor.getBoundingClientRect();menu.style.left=Math.max(8,Math.min(innerWidth-menu.offsetWidth-8,r.left))+'px';menu.style.top=Math.max(8,Math.min(innerHeight-menu.offsetHeight-8,r.bottom+8))+'px';
  }
  function annotation(node){import('./image-annotation-ui.mjs').then(m=>m.open(node)).catch(e=>notify(e.message));}
  const mappings=[['3D 片场 · 后续复刻','多角度调整',multiAngle],['重命名','重新打光',relight],['更多操作','更多操作',more],['标签 · 后续复刻','Pin',colors]];
  let toolbarCache=null;
  const noPins=[];
  function samePins(before,after){if(before.length!==after.length)return false;for(let index=0;index<before.length;index++)if(before[index]!==after[index])return false;return true;}
  const belongs=(root,child)=>!!child&&(child.parentNode===root||root.contains(child));
  function decorate(n,e){
    const values=n.colorPins||(n.color?pins(n):noPins),previous=decorations.get(e),color=n.color||'',hasImage=!!n.image;
    const pinChanged=!previous||!samePins(previous.pins,values);
    const bodyValid=belongs(e,previous?.body,'node-body');
    const titleValid=!values.length||belongs(e,previous?.title,'node-title');
    const dotsValid=!values.length||!!previous?.dots&&previous.dots.parentNode===previous.title;
    const enhance=n.tool==='enhance'&&!hasImage;
    const placeholderValid=!enhance||belongs(e,previous?.placeholder,'placeholder')&&previous.placeholder.textContent==='配置参数生成增强图像';
    // Nodes and colorPins may be mutated in place. Compare their small primitive
    // fields, but also validate owned DOM so shell/title replacement is repaired.
    if(previous&&!pinChanged&&previous.type===n.type&&previous.color===n.color&&previous.tool===n.tool&&previous.hasImage===hasImage&&bodyValid&&titleValid&&dotsValid&&placeholderValid)return;
    const body=bodyValid?previous.body:e.querySelector('.node-body');if(!body)return;
    if(e.style.isolation!=='isolate')e.style.isolation='isolate';
    if(body.dataset.color!==color)body.dataset.color=color;
    const border=n.color&&!['text','image','video','audio'].includes(n.type)?`4px solid ${n.color}`:'';
    if(!bodyValid||previous.type!==n.type||previous.color!==n.color||body.style.border!==previous.border)body.style.border=border;
    let title=titleValid?previous?.title:null,dots=previous?.dots,pinLabel=previous?.pinLabel;
    if(pinChanged||!titleValid||!dotsValid){
      if(dots?.parentNode)dots.remove();else e.querySelector('.node-pin-dots')?.remove();dots=null;pinLabel='';
      if(values.length){title=title||e.querySelector('.node-title');if(title){dots=el('span','node-pin-dots');pinLabel='Pin '+values.map(c=>pinColors.find(v=>v[1]===c)?.[0]||c).join('、');dots.setAttribute('aria-label',pinLabel);for(const [,value]of pinColors.filter(v=>values.includes(v[1]))){const dot=el('i');dot.style.background=value;dots.append(dot);}title.append(dots);}}
    }else if(dots&&dots.getAttribute('aria-label')!==pinLabel)dots.setAttribute('aria-label',pinLabel);
    let placeholder=previous?.placeholder;
    if(enhance&&!placeholderValid){placeholder=e.querySelector('.placeholder');if(placeholder&&placeholder.textContent!=='配置参数生成增强图像')placeholder.textContent='配置参数生成增强图像';}
    decorations.set(e,{type:n.type,color:n.color,tool:n.tool,hasImage,pins:pinChanged?(values.length?[...values]:noPins):previous.pins,body,title,dots,pinLabel,placeholder,border:body.style.border});
  }
  function toolbarMutations(records){
    if(!toolbarCache)return;
    for(const record of records){
      if(record.type==='childList'){toolbarCache.dirty=true;return;}
      const binding=toolbarCache.bindings.find(binding=>binding.button===record.target);
      if(!binding||record.target.getAttribute('aria-label')!==binding.label||record.target.dataset.videoAction){toolbarCache.dirty=true;return;}
    }
  }
  function mapToolbar(node){
    // Audio owns its persistent Pin button; a shared label is not ownership.
    if(node?.type==='audio')return;
    if(!toolbarCache?.root.isConnected){
      toolbarCache?.observer.disconnect();const root=document.getElementById('node-toolbar');if(!root){toolbarCache=null;return;}
      toolbarCache={root,dirty:true,bindings:[],observer:new MutationObserver(toolbarMutations)};
      toolbarCache.observer.observe(root,{childList:true,subtree:true,attributes:true,attributeFilter:['aria-label','data-video-action']});
    }
    toolbarMutations(toolbarCache.observer.takeRecords());
    if(toolbarCache.dirty||toolbarCache.bindings.some(binding=>!toolbarCache.root.contains(binding.button))){
      const old=toolbarCache.bindings,next=[];
      for(const [original,label,fn]of mappings){
        const button=toolbarCache.root.querySelector(`[aria-label="${original}"]`)||toolbarCache.root.querySelector(`[aria-label="${label}"]`);if(!button||button.dataset.videoAction||node?.type!=='image'&&!old.some(binding=>binding.button===button))continue;
        let binding=old.find(binding=>binding.button===button&&binding.label===label);
        if(!binding)binding={button,label,handler:()=>{const state=app.getState(),current=state.selected.length===1?state.nodes.find(n=>n.id===state.selected[0]):null;if(current?.image&&current.type==='image'&&!button.dataset.videoAction)fn(current,button);}};next.push(binding);
      }
      for(const binding of old)if(!next.includes(binding)&&binding.button.onclick===binding.handler)binding.button.onclick=null;
      toolbarCache.bindings=next;toolbarCache.dirty=false;
    }
    const disabled=!node?.image||node.type!=='image';
    for(const {button,label,handler}of toolbarCache.bindings){if(button.getAttribute('aria-label')!==label)button.setAttribute('aria-label',label);if(button.title!==label)button.title=label;if(button.disabled!==disabled)button.disabled=disabled;if(button.onclick!==handler)button.onclick=handler;}
  }
  function render(event){if(pop?.matches('.image-more-menu,.video-more-menu,.video-capture-menu'))closePop();if(event?.detail?.viewportOnly){place({viewportOnly:true});return;}const state=app.getState(),node=state.selected.length===1?state.nodes.find(n=>n.id===state.selected[0]):null;if(pop?.dataset.nodeId&&pop.dataset.nodeId!==node?.id)closePop();if(active&&(!node||node.id!==active.node.id)){active=null;panel.hidden=true;document.body.classList.remove('action-editing');}for(const n of state.nodes){const e=app.getNodeElement?app.getNodeElement(n.id):$(`.node[data-id="${n.id}"]`);if(e)decorate(n,e);}mapToolbar(node);place();}
  window.NodeActions={pins,pinColors,split,more,el,btn,select,slider,toggle,start,place,close,popup,closePop,colors,footer,notify};
  document.addEventListener('canvas:render',render);document.addEventListener('pointerdown',e=>{if(!e.target.closest('.node-action-pop,#node-toolbar'))closePop();});document.addEventListener('keydown',e=>{if(e.key==='Escape'&&active&&!pop&&!e.defaultPrevented&&!e.isComposing&&!document.querySelector('dialog[open]')){const target=e.composedPath?.()[0]||e.target;if(target?.closest?.('#agent-panel,.floating-panel,[role=menu],[role=listbox],[role=dialog],[role=alertdialog]'))return;const returnFocus=active.returnFocus;e.preventDefault();e.stopImmediatePropagation();close();(returnFocus?.isConnected?returnFocus:$('#canvas'))?.focus({preventScroll:true});}},{capture:true});window.addEventListener('resize',place);new ResizeObserver(place).observe(panel);render();
})();
