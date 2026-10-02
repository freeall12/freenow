(() => {
 'use strict';
 function createReplayRecorder(limit=80){
  const frames=[];let lastNodes=null,lastView=null,lastSelected=null;
  const sameNode=(a,b)=>!!a&&a.id===b.id&&a.type===b.type&&a.title===b.title&&a.x===b.x&&a.y===b.y&&a.width===b.width&&a.height===b.height;
  function record(state,viewportOnly=false,at=Date.now()){
   let nodesChanged=false;
   if(!viewportOnly||!lastNodes){
    // Copy only changed metadata. Old replay frames must never retain live
    // graph objects, while unchanged nodes can safely share their snapshots.
    let next=null;
    for(let i=0;i<state.nodes.length;i++){
     const n=state.nodes[i],previous=lastNodes?.[i];
     if(sameNode(previous,n)){if(next)next.push(previous);continue;}
     if(!next)next=lastNodes?lastNodes.slice(0,i):[];
     const {id,type,title,x,y,width,height}=n;next.push({id,type,title,x,y,width,height});
    }
    if(!lastNodes||next||lastNodes.length!==state.nodes.length){
     lastNodes=next||lastNodes?.slice(0,state.nodes.length)||[];nodesChanged=true;
    }
   }
   const {view,selected}=state;
   const sameView=lastView&&lastView.x===view.x&&lastView.y===view.y&&lastView.scale===view.scale;
   const sameSelection=lastSelected&&lastSelected.length===selected.length&&lastSelected.every((id,i)=>id===selected[i]);
   if(!nodesChanged&&sameView&&sameSelection)return;
   lastView={...view};lastSelected=[...selected];
   frames.push({at,view:lastView,selected:lastSelected,nodes:lastNodes});if(frames.length>limit)frames.shift();
  }
  return {frames,record};
 }
 if(typeof module!=='undefined'&&module.exports){module.exports={createReplayRecorder};return;}
 const app=window.CanvasApp,el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
 let provider=null;const recorder=createReplayRecorder(),replay=recorder.frames;
 document.addEventListener('canvas:render',event=>recorder.record(app.getState(),!!event?.detail?.viewportOnly));
 function records(){try{return JSON.parse(localStorage.getItem('tapnow-feedback-v1')||'[]');}catch{return [];}}
 function save(record){const all=records(),i=all.findIndex(r=>r.id===record.id);if(i<0)all.push(record);else all[i]=record;localStorage.setItem('tapnow-feedback-v1',JSON.stringify(all));}
 function open(ids=[]){
  const state=app.getState(),selected=new Set(ids),screenshots=[],recordId=crypto.randomUUID(),createdAt=Date.now(),dialog=el('dialog','feedback-dialog'),form=el('form');dialog.setAttribute('aria-labelledby','feedback-title');dialog.append(form);
  const heading=el('h2','','告诉我们哪里出了问题');heading.id='feedback-title';const close=el('button','feedback-close');close.type='button';close.setAttribute('aria-label','Close');close.innerHTML=window.UI_ICONS.close;close.onclick=()=>dialog.close();const intro=el('p','feedback-intro','我们会发送你的描述、可选截图及当前画布上下文，帮助我们更快复现问题。');form.append(heading,close,intro);
  const label=el('label','feedback-label','Describe the issue'),description=el('textarea');description.id='feedback-description';description.required=true;description.maxLength=12000;description.placeholder='What were you trying to do? What did you expect to happen? What actually happened?';label.htmlFor=description.id;form.append(label,description);
  const relatedHeading=el('div','feedback-row'),relatedLabel=el('span','','Related nodes'),clear=el('button','','Clear');clear.type='button';relatedHeading.append(relatedLabel,clear);const related=el('div','feedback-related');const candidates=state.nodes.filter(n=>selected.has(n.id));function renderRelated(){related.replaceChildren();for(const node of candidates){const b=el('button','feedback-node');b.type='button';b.setAttribute('aria-pressed',String(selected.has(node.id)));const tick=el('span','feedback-tick');tick.innerHTML=selected.has(node.id)?window.UI_ICONS.check:'';const copy=el('span');copy.append(el('span','',node.title),el('small','',node.type==='studio'?'threeDStudio':node.type));b.append(tick,copy);b.onclick=()=>{selected.has(node.id)?selected.delete(node.id):selected.add(node.id);renderRelated();};related.append(b);}if(!candidates.length)related.append(el('p','','未选择节点'));}clear.onclick=()=>{selected.clear();renderRelated();};renderRelated();form.append(relatedHeading,related);
  const shotHeading=el('div','feedback-row'),add=el('button','feedback-add','添加');add.type='button';add.insertAdjacentHTML('afterbegin',window.UI_ICONS.image);shotHeading.append(el('span','','截图（可选）'),add);const file=el('input');file.type='file';file.accept='image/*';file.multiple=true;file.hidden=true;file.setAttribute('aria-label','添加反馈截图');const shots=el('div','feedback-shots');form.append(shotHeading,file,shots);
  const status=el('p','feedback-status');status.setAttribute('role','status');let uploading=false;
  function renderShots(){shots.replaceChildren();for(const shot of screenshots){const tile=el('div'),image=el('img');image.src=shot.preview;image.alt=shot.name;const remove=el('button');remove.type='button';remove.setAttribute('aria-label','移除截图 '+shot.name);remove.innerHTML=window.UI_ICONS.close;remove.onclick=()=>{screenshots.splice(screenshots.indexOf(shot),1);URL.revokeObjectURL(shot.preview);renderShots();};tile.append(image,remove);shots.append(tile);}}
  add.onclick=()=>file.click();file.onchange=async()=>{uploading=true;add.disabled=true;try{for(const image of file.files){if(!image.type.startsWith('image/'))throw Error('请选择图片');const asset=await window.LocalAssets.put(image);screenshots.push({name:image.name,type:image.type,asset,preview:URL.createObjectURL(image)});}renderShots();}catch(error){status.textContent=error.message;}finally{uploading=false;add.disabled=false;file.value='';}};
  const options={};for(const [key,text]of [['shareLink','分享当前画布链接'],['replay','附带最近操作回放']]){const row=el('label','feedback-option'),check=el('input');check.type='checkbox';check.checked=true;options[key]=check;row.append(check,el('span','',text));form.append(row);}
  const info=el('div','feedback-info');info.append(el('p','','自动附加的信息'),el('p','','应用版本、浏览器与系统、时间戳、画布 ID、分享链接、用户身份、页面地址、屏幕信息、设备像素比、节点数、网络状态与语言区域。'));form.append(info,status);
  const footer=el('div','feedback-footer'),cancel=el('button','','取消'),submit=el('button','feedback-submit','发送反馈');cancel.type='button';cancel.onclick=()=>dialog.close();submit.type='submit';footer.append(cancel,submit);form.append(footer);
  form.onsubmit=async event=>{event.preventDefault();if(uploading||!description.value.trim())return;submit.disabled=true;status.textContent='正在保存反馈…';const now=Date.now(),current=app.getState(),record={id:recordId,description:description.value.trim(),nodeIds:[...selected],screenshots:screenshots.map(({preview,...shot})=>shot),context:{version:'0.1.0',timestamp:now,canvasId:'local',canvasTitle:document.querySelector('#project-title').textContent,shareLink:options.shareLink.checked?location.origin+location.pathname:null,userIdentity:null,pageUrl:location.origin+location.pathname,screen:{width:screen.width,height:screen.height,devicePixelRatio:devicePixelRatio},nodeCount:current.nodes.length,userAgent:navigator.userAgent,online:navigator.onLine,language:navigator.language},replay:options.replay.checked?structuredClone(replay):[],status:'saved',createdAt};
   try{save(record);if(!provider){status.textContent='反馈已保存在本机，反馈服务待接入。';return;}status.textContent='正在发送反馈…';const result=await provider.submit(structuredClone(record));if(!result?.id)throw Error('反馈服务未返回接收编号');record.status='sent';record.remoteId=result.id;save(record);dialog.close();app.notify('反馈已发送');}catch(error){status.textContent='反馈未发送：'+error.message;}finally{submit.disabled=false;}
  };
  dialog.onclose=()=>{screenshots.forEach(shot=>URL.revokeObjectURL(shot.preview));dialog.remove();};document.body.append(dialog);dialog.showModal();description.focus();return dialog;
 }
 window.FeedbackAPI={open,records,setProvider(next){if(next!==null&&typeof next?.submit!=='function')throw Error('反馈提供方必须实现submit');provider=next;},async attachment(asset){return fetch(await window.LocalAssets.url(asset)).then(r=>{if(!r.ok)throw Error('反馈截图不存在');return r.blob();});}};
})();
