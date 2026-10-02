import {sourceOf,dimensions,validate,linkedDimension,distorted,nodeSize,panelPosition,openingView} from './image-resize-core.mjs';
import icons from './image-resize-icons.mjs';
const app=window.CanvasApp,el=(tag,cls='',text)=>{const e=document.createElement(tag);e.className=cls;if(text!==undefined)e.textContent=text;return e;};
const button=(text,fn,cls='')=>{const b=el('button',cls,text);b.type='button';b.onclick=fn;return b;};
const style=el('link');style.rel='stylesheet';style.href='image-resize.css';document.head.append(style);
let current;
class PixelResize {
 constructor(node){
  this.node=node;this.id=node.id;this.src=sourceOf(node);this.alive=true;this.locked=false;this.busy=false;this.accepted=false;this.original={width:0,height:0};this.events=new AbortController();
  this.root=el('section','image-pixel-resize');this.root.setAttribute('aria-label','调整像素');this.root.dataset.nodeId=this.id;
  for(const type of ['pointerdown','click','keydown'])this.root.addEventListener(type,e=>e.stopPropagation());
  const heading=el('header');this.originalLabel=el('span');heading.append(el('p','','调整像素'),this.originalLabel);this.root.append(heading);
  const fields=el('div','pixel-resize-fields');this.inputs={};for(const [key,label]of [['width','宽度（px）'],['height','高度（px）']]){
   const field=el('div'),labelEl=el('label','',label),input=el('input');input.type='number';input.min='1';input.max='20000';input.id='pixel-resize-'+key;labelEl.htmlFor=input.id;input.setAttribute('aria-label',label);input.oninput=()=>this.input(key);field.append(labelEl,input);fields.append(field);this.inputs[key]=input;
  }
  this.lock=button('',()=>{this.locked=!this.locked;this.clearWarning();this.paint();},'pixel-resize-lock');this.lock.setAttribute('aria-label','锁定宽高比');fields.insertBefore(this.lock,fields.lastChild);this.root.append(fields);
  this.warning=el('output','pixel-resize-warning');this.warning.setAttribute('aria-live','polite');this.warning.hidden=true;const message=el('div');message.innerHTML=icons.warning;message.append(el('p','','目标比例相对原图差异很大，生成的画面可能出现明显拉压变形。'));this.warning.append(message,button('仍要应用',()=>{this.accepted=true;this.warning.hidden=true;this.confirm.focus({preventScroll:true});}));this.root.append(this.warning);
  const footer=el('footer');this.cancel=button('取消',()=>this.close(),'pixel-resize-cancel');this.confirm=button('调整',()=>this.submit(),'pixel-resize-confirm');footer.append(this.cancel,this.confirm);this.root.append(footer);document.body.append(this.root);document.body.classList.add('image-pixel-resize-open');
  this.tip=el('div','pixel-resize-tip','锁定宽高比');this.tip.setAttribute('role','tooltip');this.tip.hidden=true;document.body.append(this.tip);const hide=()=>{clearTimeout(this.tipTimer);this.tip.hidden=true;};const show=()=>{clearTimeout(this.tipTimer);this.tipTimer=setTimeout(()=>{if(this.alive){this.tip.hidden=false;this.placeTip();}},300);};this.lock.onpointerenter=this.lock.onfocus=show;this.lock.onpointerleave=this.lock.onblur=hide;
  window.addEventListener('keydown',e=>{if(e.defaultPrevented||document.querySelector('dialog[open],.ie-modal-shade'))return;if(e.key==='Escape'&&!this.closing){e.preventDefault();e.stopImmediatePropagation();this.closing=true;app.fitNode(this.id,{padding:5,minZoom:.5,maxZoom:1.5,duration:500});this.closeTimer=setTimeout(()=>this.close(),50);}},{capture:true,signal:this.events.signal});window.addEventListener('resize',()=>this.place(),{signal:this.events.signal});
  this.paint();this.place();this.ready=this.load();
 }
 async load(){try{const url=await window.LocalAssets.url(this.src),img=new Image();if(/^https?:/.test(url))img.crossOrigin='anonymous';img.src=url;await img.decode();if(!this.alive)return;this.image=img;this.original={width:img.naturalWidth,height:img.naturalHeight};this.originalLabel.textContent=`原像素：${this.original.width}*${this.original.height}像素`;this.paint();}catch{if(this.alive){app.notify('图片加载失败');this.close();}}}
 clearWarning(){this.accepted=false;this.warning.hidden=true;}
 input(key){this.clearWarning();if(this.locked){const other=key==='width'?'height':'width',value=linkedDimension(this.inputs[key].value,this.original[other],this.original[key]);if(value!==null)this.inputs[other].value=value;}this.paint();}
 paint(){const d=dimensions(this.inputs.width.value,this.inputs.height.value);this.lock.innerHTML=this.locked?icons.locked:icons.unlocked;this.lock.setAttribute('aria-pressed',String(this.locked));for(const i of Object.values(this.inputs))i.disabled=this.busy;this.lock.disabled=this.busy;this.confirm.disabled=this.busy||!this.image||(d.width===this.original.width&&d.height===this.original.height);this.confirm.textContent=this.busy?'处理中…':'调整';}
 placeTip(){if(this.tip.hidden)return;const r=this.lock.getBoundingClientRect(),t=this.tip.getBoundingClientRect();this.tip.style.left=(r.left+r.width/2-t.width/2)+'px';this.tip.style.top=(r.top-t.height-4)+'px';}
 place(){const n=app.getState().nodes.find(n=>n.id===this.id);if(!n)return;const p=panelPosition(n,app.getState().view);Object.assign(this.root.style,{left:p.left+'px',top:p.top+'px',transform:`scale(${p.scale})`});this.placeTip();}
 guard(){const n=app.getState().nodes.find(n=>n.id===this.id);if(!this.alive||n!==this.node||sourceOf(n)!==this.src)throw Error('来源图片已变化或操作已取消，结果未添加');}
 async submit(){
  if(this.busy||!this.image)return;const {width,height}=dimensions(this.inputs.width.value,this.inputs.height.value),error=validate(width,height);if(error){app.notify(error);return;}if(width===this.original.width&&height===this.original.height)return;
  if(!this.accepted&&distorted(this.original,width,height)){this.warning.hidden=false;return;}
  this.busy=true;this.paint();let canvas;
  try{this.guard();canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
   if(window.PixelResampler)await window.PixelResampler.resize(this.image,canvas);else{const ctx=canvas.getContext('2d');if(!ctx)throw Error('无法创建图片画布');ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.drawImage(this.image,0,0,width,height);}
   const blob=await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('导出图片失败')),'image/png'));this.guard();const image=await window.LocalMedia.asDataUrl(blob);this.guard();
   const added=app.createConnected(this.id,[{type:'image',title:'已调整像素',image,fullImage:image,pixelWidth:width,pixelHeight:height,resizeSource:this.src}],{gap:100,nodeSize:nodeSize(width,height)});app.notify('像素调整完成');this.close();return added[0];
  }catch(error){if(this.alive)app.notify(error.message||'像素调整失败');}finally{if(canvas){canvas.width=0;canvas.height=0;}this.busy=false;if(this.alive)this.paint();}
 }
 close(){if(!this.alive)return;this.alive=false;this.events.abort();clearTimeout(this.closeTimer);clearTimeout(this.tipTimer);this.tip.remove();this.root.remove();this.image=null;document.body.classList.remove('image-pixel-resize-open');if(current===this)current=null;}
}
export function open(node){const n=app.getState().nodes.find(n=>n.id===(typeof node==='string'?node:node.id));if(!n||n.type!=='image'||!sourceOf(n))return;window.NodeActions.closePop();if(current?.id!==n.id){window.NodeActions.close();app.select(n.id);current=new PixelResize(n);}const canvas=document.querySelector('#canvas');app.transitionView(openingView(n,canvas.clientWidth,canvas.clientHeight),500);return current;}
function sync(){if(!current||current.closing)return;const state=app.getState(),n=state.nodes.find(n=>n.id===current.id);if(state.selected.length!==1||state.selected[0]!==current.id||n!==current.node||sourceOf(n)!==current.src)current.close();else current.place();}
window.ImageResize={open,close:()=>current?.close(),get active(){return current;}};document.addEventListener('canvas:render',sync);
