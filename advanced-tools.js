(() => {
  'use strict';
  const app=window.CanvasApp, $=s=>document.querySelector(s);
  const el=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;};
  const button=(label,fn,cls='')=>{const b=el('button',cls,label);b.type='button';b.onclick=fn;return b;};
  const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
  function iconButton(name,label,fn){const b=button('',fn,'media-icon');b.innerHTML=window.UI_ICONS[name]||window.UI_ICONS.image;b.setAttribute('aria-label',label);b.title=label;return b;}
  let session=null;
  const maskDrafts=new Map();
  window.AdvancedTools={open,close};
  function position(){if(!session)return;const {node,surface,topbar,bottom}=session,{view}=app.getState();const x=node.x*view.scale+view.x,y=node.y*view.scale+view.y,w=node.width*view.scale,h=node.height*view.scale;
    surface.style.cssText=`left:${x}px;top:${y}px;width:${w}px;height:${h}px`;
    if(topbar){topbar.style.left=clamp(x+w/2-topbar.offsetWidth/2,8,innerWidth-topbar.offsetWidth-8)+'px';topbar.style.top=Math.max(64,y-62)+'px';}
    bottom.style.left=clamp(x+w/2-bottom.offsetWidth/2,8,innerWidth-bottom.offsetWidth-8)+'px';bottom.style.top=Math.min(innerHeight-bottom.offsetHeight-12,y+h+14)+'px';
    if(session.mode==='crop')paintCrop();
  }
  function fit(){if(!session)return;const n=session.node,cw=$('#canvas').clientWidth,margin=innerWidth<750?24:140;const scale=Math.min((cw-margin)/n.width,(innerHeight-360)/n.height,2.5);app.setView({scale:Math.max(.15,scale),x:cw/2-(n.x+n.width/2)*scale,y:Math.max(150,(innerHeight-180-n.height*scale)/2)-n.y*scale});}
  function close(){if(!session)return;if(session.mode==='mask')maskDrafts.set(session.node.id,{strokes:session.strokes,prompt:session.prompt.value,refs:session.refs,model:session.model,quality:session.quality,count:session.count});session.layer.remove();session=null;document.body.classList.remove('media-editing');app.render();}
  async function open(node,mode){if(!node?.image)return;if(mode==='crop')return import('./image-crop-ui.mjs').then(m=>m.open(node));if(mode==='mask')return import('./image-redraw-ui.mjs').then(m=>m.open(node));close();const layer=el('section','media-edit-layer');layer.setAttribute('aria-label',mode==='crop'?'图片裁剪':'图片蒙版编辑');const surface=el('div','media-surface');const image=el('img');image.src=node.fullImage||node.image;image.alt=node.title;image.draggable=false;surface.append(image);layer.append(surface);document.body.append(layer);session={node,mode,layer,surface,image};document.body.classList.add('media-editing');
    try{await image.decode();}catch{close();return;}
    if(mode==='crop')buildCrop();else buildMask();fit();position();
  }
  function buildCrop(){const s=session;s.crop={x:.1,y:.1,w:.8,h:.8};s.ratio=null;const frame=el('div','crop-selection');frame.setAttribute('aria-label','裁剪选区');frame.tabIndex=0;frame.append(el('div','crop-thirds'));
    for(const dir of ['nw','n','ne','e','se','s','sw','w']){const h=el('span','crop-handle '+dir);h.dataset.direction=dir;frame.append(h);}s.surface.append(frame);s.frame=frame;frame.onpointerdown=startCropDrag;
    frame.onkeydown=e=>{const delta=e.shiftKey?.02:.002;if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();s.crop.x=clamp(s.crop.x+(e.key==='ArrowRight'?delta:e.key==='ArrowLeft'?-delta:0),0,1-s.crop.w);s.crop.y=clamp(s.crop.y+(e.key==='ArrowDown'?delta:e.key==='ArrowUp'?-delta:0),0,1-s.crop.h);paintCrop();}};
    const bar=el('div','crop-toolbar');bar.append(iconButton('close','取消裁剪',close),el('span','media-divider'));const ratio=button('宽高比',()=>ratioMenu(),'crop-ratio-trigger');ratio.insertAdjacentHTML('afterbegin',window.UI_ICONS.ratio);bar.append(ratio,button('✓ 确认裁剪',confirmCrop,'confirm-crop'));s.bottom=bar;s.layer.append(bar);
  }
  function paintCrop(){const {crop:c,frame}=session;frame.style.cssText=`left:${c.x*100}%;top:${c.y*100}%;width:${c.w*100}%;height:${c.h*100}%`;frame.setAttribute('aria-description',`${Math.round(c.w*session.image.naturalWidth)} × ${Math.round(c.h*session.image.naturalHeight)}`);}
  function startCropDrag(e){e.preventDefault();const s=session,start={...s.crop},r=s.surface.getBoundingClientRect(),dir=e.target.dataset.direction||'move',x=e.clientX,y=e.clientY;s.frame.setPointerCapture(e.pointerId);
    s.frame.onpointermove=event=>{const dx=(event.clientX-x)/r.width,dy=(event.clientY-y)/r.height;if(dir==='move'){s.crop={...start,x:clamp(start.x+dx,0,1-start.w),y:clamp(start.y+dy,0,1-start.h)};paintCrop();return;}
      let left=start.x,right=start.x+start.w,top=start.y,bottom=start.y+start.h;
      if(dir.includes('w'))left=clamp(start.x+dx,0,right-.025);if(dir.includes('e'))right=clamp(right+dx,left+.025,1);if(dir.includes('n'))top=clamp(start.y+dy,0,bottom-.025);if(dir.includes('s'))bottom=clamp(bottom+dy,top+.025,1);
      if(s.ratio){const k=s.ratio*s.image.naturalHeight/s.image.naturalWidth;let w=right-left,h=bottom-top;if(dir==='n'||dir==='s'){w=h*k;}else{h=w/k;}
        const ax=dir.includes('w')?start.x+start.w:start.x,ay=dir.includes('n')?start.y+start.h:start.y;
        w=Math.min(w,dir.includes('w')?ax:1-ax,(dir.includes('n')?ay:1-ay)*k);h=w/k;left=dir.includes('w')?ax-w:ax;top=dir.includes('n')?ay-h:ay;right=left+w;bottom=top+h;
      }s.crop={x:left,y:top,w:right-left,h:bottom-top};paintCrop();};
    s.frame.onpointerup=()=>{s.frame.onpointermove=null;s.frame.onpointerup=null;};
  }
  function ratioMenu(){const s=session;const existing=s.layer.querySelector('.crop-ratio-menu');if(existing){existing.remove();return;}const menu=el('div','crop-ratio-menu');const select=(label,ratio)=>{s.ratio=ratio;const k=ratio*s.image.naturalHeight/s.image.naturalWidth;let w=.8,h=w/k;if(h>.8){h=.8;w=h*k;}s.crop={x:(1-w)/2,y:(1-h)/2,w,h};s.bottom.querySelector('.crop-ratio-trigger').lastChild.textContent=label;paintCrop();menu.remove();};
    for(const [label,ratio]of [['原图比例',s.image.naturalWidth/s.image.naturalHeight],['1 : 1',1],['4 : 3',4/3],['3 : 4',3/4],['16 : 9',16/9],['9 : 16',9/16],['21 : 9',21/9]])menu.append(button(label,()=>select(label,ratio)));
    const custom=button('自定义…',()=>{const row=el('form','custom-ratio');const w=el('input'),h=el('input');for(const [i,label]of [[w,'宽'],[h,'高']]){i.type='number';i.min='1';i.max='100';i.placeholder=label;i.setAttribute('aria-label','自定义比例'+label);i.required=true;}row.append(w,el('span','',':'),h);const apply=()=>{if(w.valueAsNumber>0&&h.valueAsNumber>0)select(`${w.value} : ${h.value}`,w.valueAsNumber/h.valueAsNumber);};row.onsubmit=e=>{e.preventDefault();apply();};row.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();apply();}};[w,h].forEach(i=>i.onchange=()=>{if(w.valueAsNumber>0&&h.valueAsNumber>0)select(`${w.value} : ${h.value}`,w.valueAsNumber/h.valueAsNumber);});custom.replaceWith(row);w.focus();});menu.append(custom);s.bottom.append(menu);
  }
  function confirmCrop(){const s=session,{crop:c,image}=s;const x=Math.round(c.x*image.naturalWidth),y=Math.round(c.y*image.naturalHeight),w=Math.max(1,Math.round(c.w*image.naturalWidth)),h=Math.max(1,Math.round(c.h*image.naturalHeight));const out=el('canvas');out.width=w;out.height=h;out.getContext('2d').drawImage(image,x,y,w,h,0,0,w,h);const output=out.toDataURL('image/png'),id=s.node.id;close();const n=app.insertDerived(id,output,w,h);if(n)app.select(n.id,true);}
  function buildMask(){const s=session,draft=maskDrafts.get(s.node.id);s.strokes=structuredClone(draft?.strokes||[]);s.redo=[];s.tool='brush';s.size=30;s.refs=draft?.refs||[];s.model=draft?.model||'Tap Nano Pro';s.quality=draft?.quality||'2K';s.count=draft?.count||1;
    const canvas=el('canvas','mask-canvas');canvas.width=s.image.naturalWidth;canvas.height=s.image.naturalHeight;s.mask=canvas;s.surface.append(canvas);canvas.setAttribute('aria-label','绘制图片蒙版');
    const toolbar=el('div','mask-toolbar');toolbar.append(iconButton('close','关闭图片编辑',close),el('span','media-divider'));for(const [name,label]of [['brush','画笔'],['rect','矩形选区'],['eraser','橡皮擦']]){const b=iconButton(name,label,()=>{s.tool=name;toolbar.querySelectorAll('[role="radio"]').forEach(b=>b.setAttribute('aria-checked',b.dataset.tool===name));});b.setAttribute('role','radio');b.dataset.tool=name;b.setAttribute('aria-checked',name==='brush');toolbar.append(b);}toolbar.append(el('span','media-divider'));const size=el('input','mask-size');size.type='range';size.min='5';size.max='100';size.value=30;size.setAttribute('aria-label','画笔大小');size.oninput=()=>s.size=+size.value;toolbar.append(el('span','brush-size-symbol','⌁'),size,el('span','media-divider'),iconButton('undo','撤销蒙版',()=>{if(s.strokes.length)s.redo.push(s.strokes.pop());paintMask();}),iconButton('redo','重做蒙版',()=>{if(s.redo.length)s.strokes.push(s.redo.pop());paintMask();}));s.topbar=toolbar;s.layer.append(toolbar);
    const composer=el('div','mask-composer'),prompt=el('textarea');prompt.placeholder='描述你想改变什么...';prompt.setAttribute('aria-label','重绘提示词');prompt.value=draft?.prompt||'';s.prompt=prompt;composer.append(prompt);const footer=el('div','mask-footer');const attach=iconButton('clip','添加重绘参考图',()=>maskReferences());const hint=el('span','mask-hint','绘制蒙版以重绘');const quality=button(s.quality,()=>cycle(quality,'quality',['1K','2K','4K']));const count=button('x'+s.count,()=>cycle(count,'count',[1,2,3,4],'x'));const model=button('✧ '+s.model,()=>maskModels(),'mask-model');const generate=button('◉ —　↑',()=>window.GenerationAPI.submit({kind:'image.inpaint',label:'图片重绘',nodeId:s.node.id,prompt:s.prompt.value,inputs:[{type:'image',url:s.node.fullImage||s.node.image},{type:'mask',url:s.mask.toDataURL('image/png')},...s.refs.map(url=>({type:'image',url}))],parameters:{model:s.model,quality:s.quality,count:s.count}}),'mask-generate');generate.title='重绘';generate.setAttribute('aria-label','重绘');footer.append(attach,hint,quality,count,model,generate);composer.append(footer);s.bottom=composer;s.layer.append(composer);
    function cycle(b,key,values,prefix=''){s[key]=values[(values.indexOf(s[key])+1)%values.length];b.textContent=prefix+s[key];}
    canvas.onpointerdown=e=>{e.preventDefault();canvas.setPointerCapture(e.pointerId);const r=canvas.getBoundingClientRect();const point=e=>({x:clamp((e.clientX-r.left)/r.width,0,1),y:clamp((e.clientY-r.top)/r.height,0,1)});const stroke={tool:s.tool,size:s.size/r.width,points:[point(e)]};s.strokes.push(stroke);s.redo=[];paintMask();canvas.onpointermove=e=>{stroke.points.push(point(e));paintMask();};canvas.onpointerup=()=>{canvas.onpointermove=null;canvas.onpointerup=null;};};renderMaskRefs();paintMask();
  }
  function paintMask(){if(!session||session.mode!=='mask')return;const s=session,c=s.mask,ctx=c.getContext('2d');ctx.clearRect(0,0,c.width,c.height);for(const stroke of s.strokes){ctx.globalCompositeOperation=stroke.tool==='eraser'?'destination-out':'source-over';ctx.fillStyle='#fff';ctx.strokeStyle='#fff';ctx.lineWidth=stroke.size*c.width;ctx.lineCap='round';ctx.lineJoin='round';const a=stroke.points[0],b=stroke.points.at(-1);if(stroke.tool==='rect'){ctx.fillRect(Math.min(a.x,b.x)*c.width,Math.min(a.y,b.y)*c.height,Math.abs(a.x-b.x)*c.width,Math.abs(a.y-b.y)*c.height);}else{ctx.beginPath();ctx.moveTo(a.x*c.width,a.y*c.height);if(stroke.points.length===1)ctx.lineTo(a.x*c.width+.01,a.y*c.height);else stroke.points.slice(1).forEach(p=>ctx.lineTo(p.x*c.width,p.y*c.height));ctx.stroke();}}s.topbar.querySelector('[aria-label="撤销蒙版"]').disabled=!s.strokes.length;s.topbar.querySelector('[aria-label="重做蒙版"]').disabled=!s.redo.length;}
  function maskModels(){const s=session;const prior=s.bottom.querySelector('.mask-model-menu');if(prior){prior.remove();return;}const menu=el('div','mask-model-menu');for(const name of ['Tap Image 2','Tap Nano Pro','Seedream 5.0 Pro'])menu.append(button(name,()=>{s.model=name;s.bottom.querySelector('.mask-model').textContent='✧ '+name;menu.remove();}));s.bottom.append(menu);}
  function maskReferences(){const s=session;const d=el('dialog','asset-picker');d.append(el('h2','','添加参考图'));const grid=el('div','asset-picker-grid');app.getState().nodes.filter(n=>n.image).forEach(n=>{const b=button('',()=>{s.refs.push(n.image);renderMaskRefs();d.close();},'asset-tile');const i=el('img');i.src=n.image;i.alt=n.title;b.append(i,el('span','',n.title));grid.append(b);});d.append(grid,button('取消',()=>d.close()));document.body.append(d);d.onclose=()=>d.remove();d.showModal();}
  function renderMaskRefs(){const s=session;let row=s.bottom.querySelector('.mask-refs');if(!row){row=el('div','mask-refs');s.bottom.prepend(row);}row.replaceChildren();s.refs.forEach((src,index)=>{const b=button('',()=>{s.refs.splice(index,1);renderMaskRefs();});b.setAttribute('aria-label','移除重绘参考图 '+(index+1));const i=el('img');i.src=src;b.append(i);row.append(b);});position();}

  function installToolbar(){const state=app.getState();const node=state.selected.length===1?state.nodes.find(n=>n.id===state.selected[0]):null;for(const [oldLabel,label,mode]of [['裁剪 · 后续复刻','裁剪','crop'],['图片编辑 · 后续复刻','重绘','mask']]){const b=$(`#node-toolbar button[aria-label="${oldLabel}"]`)||$(`#node-toolbar button[aria-label="${label}"]`);if(b){b.disabled=!node?.image||node.type==='video';b.setAttribute('aria-label',label);b.title=label;b.onclick=()=>open(node,mode);}}}
  document.addEventListener('canvas:render',event=>{if(!event?.detail?.viewportOnly)installToolbar();position();renderComments(event);});
  document.addEventListener('keydown',e=>{if(!session||$('dialog[open]'))return;if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();close();}else if(session.mode==='mask'&&(e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='z'&&!e.target.closest('textarea,input')){e.preventDefault();session.topbar.querySelector(`[aria-label="${e.shiftKey?'重做蒙版':'撤销蒙版'}"]`).click();}},{capture:true});
  window.addEventListener('resize',()=>{if(session)fit();});

  const commentStorageKey=window.CanvasProjects?.storageKey('tapnow-comments')||'tapnow-comments';
  const commentRecordKey='comments-canvas:'+(window.CanvasProjects?.id()||'canvas'),commentStore=window.CanvasStore;
  let comments=[],commentsReadError=null,commentsLoaded=false,commentSaving=null,commentNeedsFlush=false;
  let commenting=false,draftComment=null;
  const commentLayer=el('div','canvas-comments'),commentNodes=new Map();$('#canvas').append(commentLayer);
  const commentLoadStatus=el('div','comment-load-status','正在读取本地评论…');commentLoadStatus.setAttribute('role','status');commentLoadStatus.style.cssText='position:fixed;bottom:20px;left:20px;padding:8px;background:#222;color:#ddd;font-size:12px';commentLayer.append(commentLoadStatus);
  const commentsReady=Promise.resolve().then(async()=>{
    if(!commentStore?.readRecord||!commentStore?.writeRecord)throw Error('本地评论存储尚未就绪');
    const record=await commentStore.readRecord(commentRecordKey),saved=record===undefined?JSON.parse(localStorage.getItem(commentStorageKey)||'[]'):record?.comments;
    if(!Array.isArray(saved)||saved.some(item=>!item||typeof item.text!=='string'||![item.x,item.y].every(Number.isFinite)))throw Error('本地评论格式无效');
    comments=saved;commentsLoaded=true;commentLoadStatus.remove();commentButton.disabled=false;renderComments();
  }).catch(error=>{commentsReadError=error;commentLoadStatus.textContent='本地评论读取失败，已停止保存以保护已有评论。请保留此页面并重试加载。';});
  async function persistComments(next){await commentsReady;if(!commentsLoaded||commentsReadError)throw Error('本地评论读取失败，已停止保存以保护已有评论');await commentStore.writeRecord(commentRecordKey,{version:1,comments:next});}
  function commentStyle(node,key,value){if(node.style[key]!==value)node.style[key]=value;}
  function renderComments(event){
    if(!event?.detail?.viewportOnly){
      const live=new Set();let next=commentLayer.firstChild;
      for(const comment of comments){
        const key=comment.id??comment;live.add(key);let record=commentNodes.get(key);
        if(!record){record={comment,button:button('',()=>editComment(record.comment),'canvas-comment')};record.button.onpointerdown=e=>e.stopPropagation();commentNodes.set(key,record);}
        record.comment=comment;const node=record.button;
        if(record.text!==comment.text){record.text=comment.text;node.textContent=comment.text;node.setAttribute('aria-label','评论：'+comment.text);}
        // Keep attached buttons in place so canvas rendering cannot steal focus.
        if(node!==next)commentLayer.insertBefore(node,next);next=node.nextSibling;
      }
      for(const [key,record]of commentNodes)if(!live.has(key)){record.button.remove();commentNodes.delete(key);}
    }
    if(!commentNodes.size&&!draftComment)return;
    const {view}=app.getState();
    for(const {comment,button:node}of commentNodes.values()){commentStyle(node,'left',(comment.x*view.scale+view.x)+'px');commentStyle(node,'top',(comment.y*view.scale+view.y)+'px');}
    if(draftComment){commentStyle(draftComment.editor,'left',clamp(draftComment.x*view.scale+view.x,8,$('#canvas').clientWidth-308)+'px');commentStyle(draftComment.editor,'top',clamp(draftComment.y*view.scale+view.y,65,innerHeight-115)+'px');}
  }
  function closeComment(discard=false,restoreFocus=false){
    if(commentSaving){draftComment?.status('评论正在保存，请稍候。');return false;}
    if(!discard&&draftComment?.dirty()){draftComment.status('评论尚未发送，草稿已保留。请发送，或点击取消评论。');draftComment.text.focus();return false;}
    const returnFocus=draftComment?.returnFocus;draftComment?.editor.remove();draftComment=null;if(restoreFocus&&returnFocus?.isConnected)returnFocus.focus({preventScroll:true});return true;
  }
  function editComment(existing,x,y){
    if(!commentsLoaded)return;
    if(!closeComment())return;
    const {view}=app.getState(),editor=el('div','comment-composer'),text=el('textarea'),initialText=existing?.text||'';
    text.placeholder='输入你的评论...';text.setAttribute('aria-label','评论内容');text.maxLength=200;text.value=initialText;
    const foot=el('div','comment-footer'),count=el('span','',`${text.value.length}/200`),send=iconButton('arrow','发送评论 (Enter)',save),cancel=button('取消',()=>closeComment(true,true)),status=el('div','comment-save-status');
    cancel.setAttribute('aria-label','取消评论');status.setAttribute('role','status');status.hidden=true;status.style.cssText='position:absolute;top:100%;left:0;width:100%;padding:8px;background:#222;border:1px solid #777;color:#ddd;font-size:12px;line-height:1.5';
    send.disabled=!text.value.trim();foot.append(cancel,count,send);editor.append(text,foot,status);document.body.append(editor);
    let saveFailed=false;
    draftComment={editor,text,returnFocus:existing?commentNodes.get(existing.id??existing)?.button:commentButton,x:existing?.x??(x-view.x)/view.scale,y:existing?.y??(y-view.y)/view.scale,dirty:()=>text.value!==initialText||saveFailed,status:message=>{status.textContent=message;status.hidden=false;}};
    text.oninput=()=>{count.textContent=`${text.value.length}/200`;send.disabled=!text.value.trim();};
    text.onkeydown=e=>{e.stopPropagation();if(e.defaultPrevented||e.isComposing||e.keyCode===229)return;if(e.key==='Escape'){e.preventDefault();closeComment(false,true);}if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();return save();}};
    async function save(){
      const value=text.value.trim();if(!value||commentSaving)return;
      const comment=existing?{...existing,text:value}:{id:crypto.randomUUID(),x:draftComment.x,y:draftComment.y,text:value},next=existing?comments.map(item=>item===existing?comment:item):[...comments,comment];
      text.disabled=send.disabled=cancel.disabled=true;draftComment.status('正在保存评论…');commentNeedsFlush=true;
      commentSaving=persistComments(next);
      try{await commentSaving;}catch(error){commentNeedsFlush=false;saveFailed=true;draftComment.status(commentsReadError?'本地评论读取失败，未覆盖已有数据。草稿已保留，请勿关闭页面。':error?.name==='CanvasCommentsConflictError'?'另一窗口已更新评论，当前评论尚未保存。草稿已保留，请先处理版本冲突。':error?.name==='QuotaExceededError'?'评论未保存：浏览器存储空间不足。草稿已保留，可重试发送。':'评论保存失败，草稿已保留。请稍后重试发送。');return;}
      finally{commentSaving=null;text.disabled=cancel.disabled=false;send.disabled=!text.value.trim();}
      comments=next;closeComment(true,true);renderComments();
    }
    renderComments();text.focus();
  }
  window.CanvasProjects?.registerNavigationGuard(async()=>{if(!commentsLoaded)return commentsReadError?'本地评论读取失败，请先处理后再切换项目':'本地评论仍在读取，请稍后切换项目';if(commentSaving)return '评论正在保存，请稍后切换项目';if(draftComment?.dirty())return '评论尚未发送，请先发送或取消评论草稿，再切换项目';if(commentNeedsFlush){await commentStore.flush();commentNeedsFlush=false;}return null;});
  window.addEventListener('beforeunload',event=>{if(commentSaving||draftComment?.dirty()){event.preventDefault();event.returnValue='';}});
  const commentButton=$('.side-tools button[aria-label^="评论"]');commentButton.disabled=!commentsLoaded;commentButton.classList.remove('deferred');commentButton.setAttribute('aria-label','评论');commentButton.dataset.tip='评论';commentButton.onclick=()=>{if(!commentsLoaded)return;if(commenting&&!closeComment())return;commenting=!commenting;commentButton.classList.toggle('active-comment',commenting);commentButton.setAttribute('aria-pressed',commenting);$('#canvas').classList.toggle('comment-mode',commenting);};
  $('#canvas').addEventListener('pointerdown',e=>{if(e.target.closest('.canvas-comment'))return;if(commenting&&!e.target.closest('.node')&&e.button===0&&!session){e.stopImmediatePropagation();editComment(null,e.clientX,e.clientY);}else closeComment();},{capture:true});
  document.addEventListener('keydown',e=>{if(e.defaultPrevented||e.isComposing||e.keyCode===229||$('dialog[open]'))return;if(e.target&&e.target!==document.body&&e.target!==commentButton&&!e.target.closest('#canvas,.comment-composer'))return;if(e.target?.closest('input,textarea,[contenteditable]')&&!e.target.closest('.comment-composer'))return;if(e.key==='Escape'&&!session){if(!closeComment())return;commenting=false;commentButton.classList.remove('active-comment');commentButton.setAttribute('aria-pressed','false');$('#canvas').classList.remove('comment-mode');}});
  installToolbar();renderComments();
})();
