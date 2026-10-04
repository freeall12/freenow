import {parameters,changeParameters,parentVideo,mediaSource,upscaleFactor,validationError,buildRequest} from './core.mjs';
import {chevron} from './icons.mjs';
import {openVideoFrames} from '../video-media/frames.mjs';
const app=window.CanvasApp,icons=window.CANVAS_MENU_ICONS,operations=new Map();
const el=(tag,cls='',text)=>{const e=document.createElement(tag);e.className=cls;if(text!==undefined)e.textContent=text;return e;};
const button=(label,fn,cls='')=>{const e=el('button',cls);e.type='button';e.setAttribute('aria-label',label);e.onclick=fn;return e;};
let current;
const sourceKey=n=>JSON.stringify([n?.id,mediaSource(n),n?.clip||null]);
class Upscale {
  constructor(node){
    this.id=node.id;this.alive=true;this.listeners=new AbortController();this.root=el('section','video-upscale');this.root.setAttribute('aria-label','视频增强参数');this.root.dataset.nodeId=node.id;document.body.append(this.root);
    this.root.onpointerdown=e=>e.stopPropagation();this.root.onclick=e=>e.stopPropagation();this.root.onkeydown=e=>e.stopPropagation();
    document.addEventListener('pointerdown',e=>{if(this.pop&&!this.pop.contains(e.target)&&!this.anchor?.contains(e.target))this.closeMenu(false);},{signal:this.listeners.signal});
    document.addEventListener('keydown',e=>{if(this.pop&&e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();this.closeMenu();}},{capture:true,signal:this.listeners.signal});
    window.addEventListener('resize',()=>this.place(),{signal:this.listeners.signal});this.sync();
  }
  node(){return app.getState().nodes.find(n=>n.id===this.id);}
  sync(){
    const state=app.getState(),parent=parentVideo(state,this.id),key=sourceKey(parent);
    this.root.hidden=!parent;
    if(key!==this.sourceKey){this.sourceKey=key;this.parent=parent;if(operations.get(this.id)?.status!=='running')operations.delete(this.id);this.info=null;this.infoError='';this.readInfo();}
    const busy=operations.get(this.id),signature=JSON.stringify([this.node()?.params,busy?.status,busy?.error,this.info,this.infoError,this.loading]);
    if(signature!==this.signature){this.signature=signature;this.paint();}this.place();
  }
  async readInfo(){
    this.readController?.abort();this.readController=new AbortController();const signal=this.readController.signal,parent=this.parent,key=this.sourceKey;this.loading=!!parent;this.info=null;
    if(!parent)return;let reader;
    try{reader=await openVideoFrames(await window.LocalAssets.url(mediaSource(parent)),signal);if(signal.aborted||key!==this.sourceKey)return;
      const clip=parent.clip,start=Math.max(0,clip?.start||0),end=Math.min(reader.duration,clip?.end??reader.duration);
      this.info={width:reader.width,height:reader.height,duration:end-start};
      this.thumbnail=parent.image|| (await reader.at(start,72)).toDataURL();
    }catch(error){if(!signal.aborted)this.infoError=error.message;}finally{reader?.dispose();if(!signal.aborted&&this.alive){this.loading=false;this.signature=null;this.sync();}}
  }
  change(key,value){if(operations.get(this.id)?.status!=='running')operations.delete(this.id);this.closeMenu(false);const n=this.node();if(n)app.updateNode(this.id,{params:changeParameters(n.params,key,value)});this.root.querySelector(`[data-key="${key}"]`)?.focus({preventScroll:true});}
  field(label,key,options,disabled=false){
    const row=el('div','video-upscale-row'),p=parameters(this.node().params),b=button(label,()=>this.menu(b,key,options),'video-upscale-select');b.dataset.key=key;b.setAttribute('role','combobox');b.setAttribute('aria-haspopup','listbox');b.setAttribute('aria-expanded','false');b.disabled=disabled;
    const chosen=options.find(v=>String(v[0])===String(p[key])&&!v[2]);b.append(el('span','',chosen?.[1]||label));b.insertAdjacentHTML('beforeend',chevron);b.onkeydown=e=>{if(['ArrowDown','ArrowUp','Enter',' '].includes(e.key)){e.preventDefault();this.menu(b,key,options);}};row.append(el('label','',label),b);this.root.append(row);
  }
  paint(){
    this.closeMenu(false);this.root.replaceChildren();const n=this.node();if(!n)return;const p=parameters(n.params),op=operations.get(this.id),busy=op?.status==='running',flux=p.provider==='bfl';
    const header=el('header');header.append(el('h3','','视频增强'));this.root.append(header);
    this.field('模型','provider',[['topazlabs','Topaz Labs'],['bfl','FLUX Video Upscale']],busy);
    if(flux)this.field('模式','mode',[['precise','精准（忠于原片）'],['creative','创意（细节增强）']],busy);
    this.field('视频高清分辨率','resolution',[['1080p','1080p'],['2k','2K'],['4k','4K']].map(v=>[...v,flux&&upscaleFactor(v[0],this.info)===undefined]),busy||this.loading||!this.info);
    if(!flux){this.field('视频帧数（可选）','frame_rate',[['auto','自适应（原帧数）'],['30','30fps'],['60','60fps'],['90','90fps']],busy);this.field('视频放慢倍率（可选）','slow_motion',[[1,'自适应（原速）'],[2,'2x']],busy);}
    else if(p.mode==='creative'){
      const row=el('div','video-upscale-row prompt-row'),input=el('textarea');input.value=p.prompt;input.maxLength=2000;input.placeholder='描述希望增强的细节（仅创意模式生效）';input.setAttribute('aria-label','提示词（可选）');input.disabled=busy;
      input.onblur=()=>{if(input.value!==parameters(this.node()?.params).prompt)this.change('prompt',input.value);};row.append(el('label','','提示词（可选）'),input);this.root.append(row);
    }
    const invalid=this.loading?'':this.infoError||validationError(p,this.info),message=invalid||op?.error;
    if(message){const status=el('p','video-upscale-status',message);status.setAttribute('role','status');this.root.append(status);if(!this.info){const retry=button('重试读取视频',()=>{this.readInfo();this.signature=null;this.sync();});retry.textContent='重试';status.append(retry);}}
    const footer=el('footer'),thumbnail=el('img');thumbnail.alt='Video thumbnail';if(this.thumbnail)window.LocalAssets.url(this.thumbnail).then(url=>{if(thumbnail.isConnected)thumbnail.src=url;}).catch(()=>{});footer.append(thumbnail);
    const group=el('div','creation-submit-group'),cost=el('span','creation-cost');cost.innerHTML=icons.creationCost;cost.append(el('span','','—'));cost.title='由接入的生成服务返回用量';this.generate=button(busy?'正在增强视频':'视频增强',()=>this.submit(),'creation-generate');this.generate.innerHTML=icons.creationGenerate;this.generate.dataset.tooltip='视频增强';this.generate.disabled=busy||this.loading||!!invalid||!this.parent;this.generate.setAttribute('aria-busy',String(busy||this.loading));group.append(cost,this.generate);footer.append(group);this.root.append(footer);
    if(busy&&op.jobId){const cancel=button('取消视频增强',()=>window.GenerationAPI.cancel(op.jobId),'video-upscale-cancel');cancel.textContent='取消生成';this.root.append(cancel);}
    this.place();
  }
  menu(anchor,key,options){
    if(this.pop&&this.anchor===anchor){this.closeMenu();return;}this.closeMenu(false);this.anchor=anchor;anchor.setAttribute('aria-expanded','true');this.pop=el('div','video-upscale-options');this.pop.id='video-upscale-options';anchor.setAttribute('aria-controls',this.pop.id);this.pop.setAttribute('role','listbox');this.pop.setAttribute('aria-label',anchor.getAttribute('aria-label'));this.pop.onpointerdown=e=>e.stopPropagation();this.pop.onclick=e=>e.stopPropagation();document.body.append(this.pop);
    const p=parameters(this.node().params);for(const [value,label,disabled]of options){const chosen=String(value)===String(p[key]),b=button(label,()=>this.change(key,value));b.setAttribute('role','option');b.setAttribute('aria-selected',String(chosen));b.disabled=!!disabled;b.dataset.value=value;const check=el('i');if(chosen)check.innerHTML=window.UI_ICONS.check;b.append(check,el('span','',label));this.pop.append(b);}
    this.pop.onkeydown=e=>{e.stopPropagation();const all=[...this.pop.querySelectorAll('button:not(:disabled)')],i=all.indexOf(document.activeElement);if(e.key==='Tab'){this.closeMenu();return;}if(!['ArrowUp','ArrowDown','Home','End'].includes(e.key))return;e.preventDefault();all[e.key==='Home'?0:e.key==='End'?all.length-1:(i+(e.key==='ArrowDown'?1:-1)+all.length)%all.length]?.focus();};this.placeMenu();(this.pop.querySelector('[aria-selected=true]:not(:disabled)')||this.pop.querySelector('button:not(:disabled)'))?.focus({preventScroll:true});
  }
  closeMenu(focus=true){this.pop?.remove();this.pop=null;this.anchor?.setAttribute('aria-expanded','false');if(focus)this.anchor?.focus({preventScroll:true});this.anchor=null;}
  placeMenu(){if(!this.pop)return;const r=this.anchor.getBoundingClientRect(),selected=this.pop.querySelector('[aria-selected=true]'),index=[...this.pop.children].indexOf(selected);this.pop.style.width=r.width+'px';this.pop.style.left=Math.max(8,Math.min(innerWidth-r.width-8,r.left))+'px';this.pop.style.top=Math.max(8,Math.min(innerHeight-this.pop.offsetHeight-8,r.top-4-Math.max(0,index)*48))+'px';}
  place(){const n=this.node();if(!n)return;const {view}=app.getState(),r=document.querySelector('#canvas').getBoundingClientRect(),w=Math.max(400,n.width);this.root.style.width=w+'px';this.root.style.left=r.left+(n.x+n.width/2)*view.scale+view.x-w/2+'px';this.root.style.top=r.top+(n.y+n.height)*view.scale+view.y+20+'px';this.placeMenu();}
  async submit(){
    if(operations.get(this.id)?.status==='running'||this.loading||!this.info)return;
    const n=this.node(),parent=this.parent,id=this.id,snapshot=JSON.stringify(parameters(n.params)),key=this.sourceKey,oldVideo=mediaSource(n),info={...this.info},op={status:'running',error:null};operations.set(id,op);this.sync();
    const guard=()=>{const state=app.getState(),target=state.nodes.find(v=>v.id===id);if(target!==n||target.tool!=='video-upscale'||sourceKey(parentVideo(state,id))!==key||mediaSource(target)!==oldVideo||JSON.stringify(parameters(target.params))!==snapshot)throw Error('来源、参数或增强节点已变化，请重新生成');};
    let unsubscribe;
    try{
      let url=await window.LocalAssets.url(mediaSource(parent));guard();
      if(window.GenerationAPI.isConfigured()){
        if(parent.clip){const response=await fetch(url);if(!response.ok)throw Error('来源视频读取失败');const blob=await window.LocalMedia.process('trim',await response.blob(),parent.clip);info.sizeBytes=blob.size;url=await window.LocalMedia.asDataUrl(blob);}
        else {const absolute=new URL(url,document.baseURI);if(absolute.protocol==='blob:'||absolute.protocol==='data:'||absolute.origin===location.origin){const response=await fetch(absolute);if(!response.ok)throw Error('来源视频读取失败');const blob=await response.blob();info.sizeBytes=blob.size;url=await window.LocalMedia.asDataUrl(blob);}}
      }
      const request=buildRequest(n,parent,info,url);if(parent.clip&&window.GenerationAPI.isConfigured())delete request.inputs[0].clip;guard();
      unsubscribe=window.GenerationAPI.subscribe(job=>{if(job.request.nodeId===id&&job.request.kind==='video.upscale'&&['queued','running'].includes(job.status)){op.jobId=job.id;if(this.alive){this.signature=null;this.sync();}}});
      await window.GenerationAPI.runInPlace(request,{type:'video',guard,apply:async output=>{const history=await import('../video-history/core.mjs');guard();const n=this.node();app.updateNode(id,history.record(n,{id:crypto.randomUUID(),createdAt:Date.now(),request,outputs:[output]},window.NodeEditor.getConfig(n)));}});op.status='succeeded';
    }catch(error){op.status='failed';op.error=error.message;}finally{unsubscribe?.();if(this.alive){this.signature=null;this.sync();}}
  }
  close(){this.alive=false;this.listeners.abort();this.readController?.abort();this.closeMenu(false);this.root.remove();}
}
export function sync(){const state=app.getState(),node=state.selected.length===1&&state.nodes.find(n=>n.id===state.selected[0]&&n.tool==='video-upscale');if(current?.id!==node?.id){current?.close();current=null;if(node)current=new Upscale(node);}else current?.sync();return current;}
document.addEventListener('canvas:render',sync);
