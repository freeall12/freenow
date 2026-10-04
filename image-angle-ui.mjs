import {defaults,parameters,change,drag,cubeTransform,requestParameters,panelPosition} from './image-angle-core.mjs';
import icons from './image-angle-icons.mjs';
import {multiAngleNativeProfile,multiAngleNativeError} from './src/features/image-multi-angle/native-profile.mjs';
const app=window.CanvasApp,operations=new Map();
const link=document.createElement('link');link.rel='stylesheet';link.href='image-angle.css';document.head.append(link);
const el=(tag,cls='',text)=>{const e=document.createElement(tag);e.className=cls;if(text!==undefined)e.textContent=text;return e;};
const button=(label,icon,fn,cls='')=>{const b=el('button',cls);b.type='button';b.setAttribute('aria-label',label);if(icon)b.innerHTML=icons[icon];b.onclick=fn;return b;};
const source=n=>n?.fullImage||n?.image;
let current;
class Angle {
  constructor(node){
    this.id=node.id;this.node=node;this.projectId=app.projectIdentity().id;this.src=source(node);this.values=parameters();this.alive=true;this.events=new AbortController();
    this.root=el('section','image-angle-panel');this.root.dataset.nodeId=node.id;this.root.setAttribute('aria-label','多角度调整');this.root.onpointerdown=e=>e.stopPropagation();this.root.onkeydown=e=>e.stopPropagation();
    const header=el('header');header.append(el('span','','拖拽方块调整角度'),button('关闭多角度调整','close',()=>this.close(),'angle-close'));this.root.append(header);
    const body=el('div','angle-layout'),stage=el('div','angle-preview');this.cube=el('div','angle-preview-cube');this.cube.tabIndex=0;this.cube.setAttribute('role','group');this.cube.setAttribute('aria-label','拖拽方块调整角度');
    for(const [label,rotation]of [['','rotateY(0deg)'],['BK','rotateY(180deg)'],['L','rotateY(-90deg)'],['R','rotateY(90deg)'],['T','rotateX(90deg)'],['B','rotateX(-90deg)']]){const face=el('div','angle-preview-face',label);face.style.transform=rotation+' translateZ(30px)';if(!label){face.classList.add('front');const img=el('img');img.draggable=false;img.alt='当前图片';window.LocalAssets.url(this.src).then(url=>{if(this.alive)img.src=url;}).catch(e=>app.notify(e.message));face.append(img);}this.cube.append(face);}
    const reset=button('重置','reset',()=>{this.values=parameters();this.paint();},'angle-reset');reset.append(document.createTextNode('重置'));stage.append(this.cube,reset);body.append(stage);
    const controls=el('div','angle-settings'),stack=el('div','angle-sliders');this.ranges=new Map();
    for(const [key,label,min,max,step]of [['rotate_right_left','旋转',-90,90,1],['vertical_angle','倾斜',-1,1,.01],['move_forward','缩放',0,10,.1]]){
      const row=el('label','angle-slider-row'),rail=el('div','angle-slider-rail'),track=el('div','angle-slider-track'),fill=el('i'),thumb=el('i','angle-slider-thumb'),input=el('input'),out=el('output');input.type='range';Object.assign(input,{min,max,step});input.setAttribute('aria-label',label);input.oninput=()=>{this.values=change(this.values,{[key]:+input.value});this.paint();};track.append(fill);rail.append(track,thumb,input);row.append(el('span','angle-slider-label',label),rail,out);stack.append(row);this.ranges.set(key,{input,out,fill,thumb,min,max});
    }
    const wide=el('div','angle-wide');this.wide=button('广角镜头',null,()=>{this.values=change(this.values,{wide_angle_lens:!this.values.wide_angle_lens});this.paint();},'angle-switch');this.wide.setAttribute('role','switch');this.wide.append(el('span'));wide.append(el('span','','广角镜头'),this.wide);stack.append(wide);controls.append(stack);
    const generate=el('div','angle-generate');const estimate=this.estimate=el('span','angle-estimate');estimate.innerHTML=icons.cost;estimate.append(el('span','','10'));estimate.setAttribute('aria-label','预计消耗 10');this.generate=button('生成多角度图片','generate',()=>this.submit(),'angle-submit');generate.append(estimate,this.generate);controls.append(generate);body.append(controls);this.root.append(body);document.body.append(this.root);document.body.classList.add('image-angle-open');
    this.cube.onpointerdown=e=>{if(e.button!==0)return;e.preventDefault();this.drag={x:e.clientX,y:e.clientY,id:e.pointerId};this.cube.setPointerCapture(e.pointerId);this.cube.classList.add('dragging');};
    this.cube.onpointermove=e=>{if(!this.drag)return;this.values=drag(this.values,e.clientX-this.drag.x,e.clientY-this.drag.y);this.drag.x=e.clientX;this.drag.y=e.clientY;this.paint();};
    this.cube.onpointerup=this.cube.onpointercancel=this.cube.onlostpointercapture=()=>{this.drag=null;this.cube.classList.remove('dragging');};
    this.cube.onkeydown=e=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();this.values=drag(this.values,e.key==='ArrowRight'?2:e.key==='ArrowLeft'?-2:0,e.key==='ArrowDown'?1:e.key==='ArrowUp'?-1:0);this.paint();};
    window.addEventListener('keydown',e=>{if(e.defaultPrevented||document.querySelector('dialog[open],.ie-modal-shade'))return;if(e.key==='Escape'&&this.alive){e.preventDefault();e.stopImmediatePropagation();app.fitNode(this.id,{padding:5,duration:500});this.closing=true;this.closeTimer=setTimeout(()=>this.close(),50);}},{capture:true,signal:this.events.signal});
    this.providerNote=el('p','angle-provider-note');this.providerNote.hidden=true;controls.append(this.providerNote);
    void window.GenerationAPI.configuration().then(metadata=>{if(this.alive)this.showProvider(metadata);}).catch(()=>{});
    window.addEventListener('resize',()=>this.place(),{signal:this.events.signal});this.paint();this.place();
  }
  showProvider(metadata){this.nativeProfile=multiAngleNativeProfile(metadata);this.providerNote.hidden=!this.nativeProfile;this.estimate.hidden=!!this.nativeProfile;this.providerNote.textContent=this.nativeProfile?'Qwen 2511 原生替代 · 最低倾斜 -30° · 不支持广角':'';}
  paint(){
    this.cube.style.transform=cubeTransform(this.values);
    for(const [key,row]of this.ranges){const value=this.values[key],p=(value-row.min)/(row.max-row.min)*100,zero=-row.min/(row.max-row.min)*100;row.input.value=value;row.fill.style.left=Math.min(p,zero)+'%';row.fill.style.width=Math.abs(p-zero)+'%';row.thumb.style.left=`calc(${p}% - 5px)`;row.out.textContent=key==='vertical_angle'?Math.round(value*45)+'°':key==='rotate_right_left'?value+'°':String(value);}
    this.wide.setAttribute('aria-checked',String(this.values.wide_angle_lens));
  }
  place(){const node=app.getState().nodes.find(n=>n.id===this.id);if(!node)return;const p=panelPosition(node,app.getState().view);Object.assign(this.root.style,{left:p.left+'px',top:p.top+'px',transform:`scale(${p.scale})`});}
  close(){if(!this.alive)return;this.alive=false;clearTimeout(this.closeTimer);this.events.abort();this.root.remove();if(current===this){current=null;document.body.classList.remove('image-angle-open');}app.render();}
  async submit(){
    if(this.busy)return;this.busy=true;this.generate.disabled=true;
    const id=this.id,src=this.src,values=structuredClone(this.values),guardSource=()=>{const n=app.getState().nodes.find(n=>n.id===id);if(app.projectIdentity().id!==this.projectId||n!==this.node||n.type!=='image'||source(n)!==src)throw Error('来源图片或画布已变化，请重新生成');};
    try{
      const available=await window.GenerationAPI.availability({request:{kind:'image.multiAngle',parameters:requestParameters(values)},signal:this.events.signal});
      if(!this.alive)return;guardSource();this.showProvider(await window.GenerationAPI.configuration());if(!this.alive)return;guardSource();
      if(available?.configured!==true){app.notify(available?.reason||'请先配置多角度图片生成服务');window.GenerationAPI.configure();return;}
      const nativeError=multiAngleNativeError(values,this.nativeProfile);if(nativeError)throw Error(nativeError);
      let url=await window.LocalAssets.url(src);if(!this.alive)return;guardSource();const resolved=new URL(url,document.baseURI);if(resolved.protocol==='blob:'||resolved.origin===location.origin){const response=await fetch(resolved,{signal:this.events.signal});if(!response.ok)throw Error('来源图片读取失败');url=await window.LocalMedia.asDataUrl(await response.blob());}else url=resolved.href;if(!this.alive)return;guardSource();
      const request={kind:'image.multiAngle',label:'多角度',nodeId:id,prompt:'',inputs:[{type:'image',url}],parameters:requestParameters(values)};
      const target=app.createConnected(id,[{type:'image',title:'多角度',image:null,pendingOperation:'image.multiAngle',angleParameters:values}],{gap:200})[0];
      operations.set(target.id,{sourceId:id});this.close();app.fitNode(target.id,{padding:1.5,minZoom:.15,maxZoom:1,duration:500});
      const guard=()=>{guardSource();const node=app.getState().nodes.find(n=>n.id===target.id);if(node!==target||node.pendingOperation!=='image.multiAngle'||node.image)throw Error('生成节点已变化，结果未覆盖');};
      try{await window.GenerationAPI.runInPlace({...request,nodeId:target.id,sourceNodeId:id},{type:'image',guard,patch:{pendingOperation:null}});if(app.projectIdentity().id===this.projectId&&app.getState().nodes.includes(target)&&app.getState().selected.includes(target.id))app.fitNode(target.id,{padding:1.5,minZoom:.15,maxZoom:1,duration:500});app.notify('多角度图片已生成');}
      catch(error){const node=app.getState().nodes.find(n=>n.id===target.id);if(app.projectIdentity().id===this.projectId&&node===target&&node.pendingOperation==='image.multiAngle'&&!node.image)app.remove([target.id]);app.notify(error.message);}
      finally{operations.delete(target.id);}
    }catch(error){if(this.alive)app.notify(error.message);}finally{this.busy=false;if(this.alive)this.generate.disabled=false;}
  }
}
export function open(node){const n=app.getState().nodes.find(n=>n.id===(typeof node==='string'?node:node.id));if(!n||n.type!=='image'||!source(n))return;window.NodeActions.closePop();if(current?.id===n.id){app.fitNode(n.id,{padding:2.5,minZoom:.5,maxZoom:1.5,duration:500});return current;}current?.close();window.NodeActions.close();app.select(n.id);current=new Angle(n);app.fitNode(n.id,{padding:2.5,minZoom:.5,maxZoom:1.5,duration:500});return current;}
function render(){
  if(current&&!current.closing){const state=app.getState(),n=state.nodes.find(n=>n.id===current.id);if(state.selected.length!==1||state.selected[0]!==current.id||source(n)!==current.src)current.close();else current.place();}
  for(const n of app.getState().nodes){if(n.pendingOperation!=='image.multiAngle')continue;const p=document.querySelector(`.node[data-id="${CSS.escape(n.id)}"] .placeholder`);if(p)p.textContent=operations.has(n.id)?'正在生成多角度图片…':'生成已中断，请重新生成';}
}
window.ImageAngle={open,close:()=>current?.close(),get active(){return current;}};document.addEventListener('canvas:render',render);
