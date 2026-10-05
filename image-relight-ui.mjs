import {parameters,setAngle,buttons,brightnessStops,temperatureStops,temperatureColors,rimAllowed,stopIndex,scrubIndex,requestParameters,panelPosition,openingView} from './image-relight-core.mjs';
import {createStage} from './image-relight-stage.mjs';
import icons from './image-relight-icons.mjs';
import {relightRequestState} from './src/features/image-relight/native-profile.mjs';
import {relightSource as source,createRelightSourceGuard,createRelightConfigurationGuard,assertRelightSourceScope} from './src/features/image-relight/source-guard.mjs';
import {createRelightResultApplication} from './src/features/image-relight/result-application.mjs';
const app=window.CanvasApp;
const link=document.createElement('link');link.rel='stylesheet';link.href='image-relight.css';document.head.append(link);
const el=(tag,cls='',text)=>{const e=document.createElement(tag);e.className=cls;if(text!==undefined)e.textContent=text;return e;};
const button=(label,icon,fn,cls='')=>{const b=el('button',cls);b.type='button';b.setAttribute('aria-label',label);if(icon)b.innerHTML=icons[icon];else b.textContent=label;b.onclick=fn;return b;};
let current;
class Relight {
 constructor(node){
  this.node=node;this.id=node.id;this.src=source(node);this.values=parameters();this.view='perspective';this.target='main';this.alive=true;this.events=new AbortController();this.rows=new Map();this.guard=createRelightSourceGuard(app,node,{signal:this.events.signal,isAlive:()=>this.alive,requireSelection:true});this.generationReady=false;
  this.root=el('section','image-relight-panel');this.root.dataset.nodeId=this.id;this.root.setAttribute('aria-label','重新打光');this.root.onpointerdown=e=>e.stopPropagation();this.root.onkeydown=e=>e.stopPropagation();this.root.append(button('关闭重新打光','close',()=>this.close(),'relight-close'));
  const preview=el('div','relight-preview'),tabs=el('div','relight-views');this.tabs=new Map();for(const [key,label]of [['perspective','透视'],['front','正面']]){const b=button(label,null,()=>{this.view=key;this.paint();});tabs.append(b);this.tabs.set(key,b);}preview.append(tabs);this.mount=el('div','relight-stage');preview.append(this.mount,button('重置','reset',()=>{this.values=parameters();this.paint();},'relight-reset'));preview.lastChild.append(document.createTextNode('重置'));const caption=el('div','relight-caption');this.caption=el('span','','主光源');caption.append(this.caption,el('i'));preview.append(caption);this.root.append(preview);
  const controls=el('div','relight-controls'),stack=el('div','relight-stack'),global=el('div','relight-global');global.append(el('h3','','全局'));const sliders=el('div','relight-sliders');sliders.append(this.slider('brightnessLevel','亮度',brightnessStops,'brightness','%'),this.slider('temperatureK','色温',temperatureStops,'temperature','K'));global.append(sliders);stack.append(global,el('hr'));const presets=el('div','relight-presets');presets.append(el('h3','','主光源'));const grid=el('div','relight-preset-grid');this.presets=new Map();for(const p of buttons){const b=button(p.label,null,()=>{this.values=setAngle(this.values,p.azimuthDeg,p.elevationDeg);this.paint();});grid.append(b);this.presets.set(p.key,b);}presets.append(grid);stack.append(presets,el('hr'));
  const row=el('div','relight-rim'),label=el('div','relight-rim-label');this.rimLabel=el('span','','轮廓光');const help=el('span','relight-help');help.tabIndex=0;help.innerHTML=icons.help;help.setAttribute('aria-label','轮廓光说明');const tip=el('span','relight-tip','轮廓光仅支持主光位于正位（前/左/右/顶/底）及 45° 标准光位，锁定为背部三点投射');tip.id='relight-rim-tooltip';tip.setAttribute('role','tooltip');help.setAttribute('aria-describedby',tip.id);this.help=help;this.tip=tip;tip.hidden=true;document.body.append(tip);const showTip=()=>{tip.hidden=false;this.placeTip();};const hideTip=()=>{tip.hidden=true;};help.onpointerenter=help.onfocus=showTip;help.onpointerleave=help.onblur=hideTip;label.append(this.rimLabel,help);this.rim=button('轮廓光',null,()=>{this.values.rimEnabled=!this.values.rimEnabled;this.paint();},'relight-switch');this.rim.textContent='';this.rim.setAttribute('role','switch');this.rim.append(el('span'));row.append(label,this.rim);stack.append(row);controls.append(stack);
  const generate=el('div','relight-generate');this.estimate=button('检查打光配置',null,()=>this.refreshReadiness(),'relight-estimate');this.estimate.textContent='正在检查配置…';this.estimate.setAttribute('aria-live','polite');this.generate=button('生成打光图片','generate',()=>this.submit(),'relight-submit');this.generate.disabled=true;generate.append(this.estimate,this.generate);controls.append(generate);this.root.append(controls);document.body.append(this.root);document.body.classList.add('image-relight-open');
  this.ready=window.LocalAssets.url(this.src).then(url=>{this.guard();this.stage=createStage(this.mount,url,(az,el)=>{this.values=setAngle(this.values,az,el);this.paint();},key=>{this.values.rimPreset=key;this.paint();},target=>{this.target=target;this.paint();},message=>app.notify(message));this.paint();}).catch(error=>{if(this.alive){this.mount.append(el('p','relight-error','3D 预览加载失败'));app.notify(error.message);}});
  window.addEventListener('keydown',e=>{if(e.defaultPrevented||document.querySelector('dialog[open],.ie-modal-shade'))return;if(e.key==='Escape'&&this.alive){e.preventDefault();e.stopImmediatePropagation();app.fitNode(this.id,{padding:5,duration:500});this.closing=true;this.closeTimer=setTimeout(()=>this.close(),50);}},{capture:true,signal:this.events.signal});window.addEventListener('resize',()=>this.place(),{signal:this.events.signal});window.addEventListener('focus',()=>this.refreshReadiness(),{signal:this.events.signal});this.root.addEventListener('pointerenter',()=>{if(!this.busy)this.refreshReadiness();},{signal:this.events.signal});this.paint();this.place();this.refreshReadiness();
 }
 slider(key,label,stops,icon,suffix){
  const group=el('div','relight-slider-group'),row=el('div','relight-slider-row'),rail=el('div','relight-stop-rail'),track=el('div','relight-stop-track'),fill=el('div','relight-stop-fill');group.append(el('span','relight-slider-label',label));rail.tabIndex=0;rail.setAttribute('role','slider');rail.setAttribute('aria-label',label);rail.setAttribute('aria-valuemin',stops[0]);rail.setAttribute('aria-valuemax',stops.at(-1));if(key==='temperatureK')rail.classList.add('temperature');for(let i=0;i<stops.length;i++){const part=el('i'),dot=el('i','relight-stop-dot');part.style.setProperty('--stop-color',key==='temperatureK'?temperatureColors[i]:'#ccc');dot.style.left=(132/stops.length*(i+.5)-1)+'px';dot.style.background=key==='temperatureK'?temperatureColors[i]:'#ccc';fill.append(part);rail.append(dot);}track.append(fill);rail.prepend(track);
  const value=el('div','relight-value');value.tabIndex=0;value.setAttribute('role','slider');value.setAttribute('aria-label',label+'数值');value.setAttribute('aria-valuemin',stops[0]);value.setAttribute('aria-valuemax',stops.at(-1));value.innerHTML=icons[icon];const out=el('span','relight-number'),unit=el('span','relight-unit',suffix);value.append(out,unit);row.append(rail,value);group.append(row);const change=index=>{this.values[key]=stops[index];this.paint();};
  for(const [target,scrub]of [[rail,false],[value,true]]){let drag;target.onpointerdown=e=>{if(e.button!==0)return;e.preventDefault();target.setPointerCapture(e.pointerId);target.focus({preventScroll:true});drag={x:e.clientX,index:stops.indexOf(this.values[key])};if(!scrub){const r=rail.getBoundingClientRect();change(stopIndex(e.clientX,r.left,r.width,stops.length));}};target.onpointermove=e=>{if(!drag)return;const r=rail.getBoundingClientRect();change(scrub?scrubIndex(drag.index,e.clientX-drag.x,stops.length):stopIndex(e.clientX,r.left,r.width,stops.length));};target.onpointerup=target.onpointercancel=target.onlostpointercapture=()=>{drag=null;};target.onkeydown=e=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(e.key))return;e.preventDefault();const index=stops.indexOf(this.values[key]);change(e.key==='Home'?0:e.key==='End'?stops.length-1:Math.min(stops.length-1,Math.max(0,index+(['ArrowRight','ArrowUp'].includes(e.key)?1:-1))));};}
  this.rows.set(key,{rail,value,fill,out,stops});return group;
 }
 paint(){for(const [key,b]of this.tabs){b.classList.toggle('chosen',key===this.view);b.setAttribute('aria-pressed',key===this.view);}for(const [key,b]of this.presets){b.classList.toggle('chosen',key===this.values.angle.preset);b.setAttribute('aria-pressed',key===this.values.angle.preset);}for(const [key,row]of this.rows){const value=this.values[key],index=row.stops.indexOf(value);row.out.textContent=value;for(const target of [row.rail,row.value])target.setAttribute('aria-valuenow',value);[...row.fill.children].forEach((e,i)=>e.classList.toggle('chosen',i===index));row.rail.querySelectorAll('.relight-stop-dot').forEach((e,i)=>e.style.opacity=i===index?'.7':'.2');}const allowed=rimAllowed(this.values.angle.azimuthDeg,this.values.angle.elevationDeg);this.rim.disabled=!allowed;this.rim.setAttribute('aria-checked',String(this.values.rimEnabled));this.rimLabel.classList.toggle('disabled',!allowed);this.caption.textContent=this.target==='rim'&&this.values.rimEnabled?'轮廓光':'主光源';this.caption.parentElement.style.setProperty('--glow',this.values.temperatureK<=4000?'#D5C6AA':this.values.temperatureK>=7000?'#9EC4F9':'#A6A196');this.stage?.update(this.values,this.view);this.paintReadiness();}
 placeTip(){if(!this.tip||this.tip.hidden)return;const r=this.help.getBoundingClientRect(),t=this.tip.getBoundingClientRect();this.tip.style.left=Math.max(4,Math.min(innerWidth-t.width-4,r.left+r.width/2-t.width/2))+'px';this.tip.style.top=(r.top-t.height-4>=4?r.top-t.height-4:r.bottom+4)+'px';}
 place(){const n=app.getState().nodes.find(n=>n.id===this.id);if(!n)return;const p=panelPosition(n,app.getState().view);Object.assign(this.root.style,{left:p.left+'px',top:p.top+'px',transform:`scale(${p.scale})`});this.placeTip();}
 close(){if(!this.alive)return;if(!this.dispatched)this.preparation?.abort(new DOMException('打光准备已取消','AbortError'));this.alive=false;clearTimeout(this.closeTimer);this.events.abort();this.stage?.dispose();this.tip?.remove();this.root.remove();if(current===this){current=null;document.body.classList.remove('image-relight-open');}app.render();}
 request(values=this.values){assertRelightSourceScope(this.node);return {kind:'image.relight',label:'打光',nodeId:this.id,prompt:'',inputs:[{type:'image',role:'source_image',nodeId:this.id,url:this.src}],parameters:requestParameters(values)};}
 paintReadiness(){
  let standard=true;try{requestParameters(this.values);}catch{standard=false;}
  const state=this.readinessState,reason=this.operationError||(!standard?'请选择标准光位':state?.reason)||'';
  this.generate.disabled=!!this.busy||!this.generationReady||!standard;
  this.estimate.textContent=this.busy?'正在准备打光…':this.operationError?'生成未完成':!standard?'请选择标准光位':state?.label||'正在检查配置…';
  this.estimate.title=[reason,state?.hint,'点击重新检查配置'].filter(Boolean).join('\n');this.estimate.setAttribute('aria-label',this.estimate.title);this.estimate.dataset.ready=String(this.generationReady&&!reason);
  this.generate.title=reason||state?.hint||'正在检查打光服务配置';
 }
 async readiness(request,signal=this.events.signal){
  assertRelightSourceScope(this.node);
  const available=await window.GenerationAPI.availability({request,signal});this.guard();
  const metadata=await window.GenerationAPI.configuration();this.guard();
  const state=metadata?relightRequestState(metadata,request):{ready:available.configured===true,reason:'',hint:'打光使用独立图片编辑服务，效果需以结果为准。',label:'打光服务已配置'};
  if(available.configured!==true){state.ready=false;state.reason=available.reason||state.reason||'打光服务尚未配置';state.label=metadata?.missing?.some(key=>key.includes('KEY'))?'缺少 Key':'打光服务待配置';}
  return {...state,metadata};
 }
 async refreshReadiness(){
  if(!this.alive||this.busy)return;const ticket=this.readinessTicket=(this.readinessTicket||0)+1;this.generationReady=false;this.readinessState=null;this.paintReadiness();
  try{const state=await this.readiness({kind:'image.relight'});if(ticket!==this.readinessTicket)return;this.readinessState=state;this.generationReady=state.ready;this.paintReadiness();}
  catch(error){if(this.alive&&ticket===this.readinessTicket){this.readinessState={ready:false,reason:error.message,label:'配置读取失败'};this.paintReadiness();}}
 }
 async submit(){
  if(this.busy||this.generate.disabled)return;this.busy=true;this.dispatched=false;this.operationError='';this.paintReadiness();
  const values=structuredClone(this.values),controller=new AbortController();this.preparation=controller;
  let applying=false;const uiGuard=createRelightSourceGuard(app,this.node,{signal:controller.signal,isAlive:()=>this.alive,requireSelection:true});
  const result=createRelightResultApplication({app,node:this.node,parameters:values,beforeCreate:()=>{guard();applying=true;}});
  const guard=()=>{if(this.dispatched||applying)result.guard();else uiGuard();};
  try{
   guard();const request=this.request(values),state=await this.readiness(request,controller.signal);guard();this.readinessState=state;this.generationReady=state.ready;
   if(!state.ready)throw Error(state.reason);
   const configurationGuard=state.metadata?createRelightConfigurationGuard(window.GenerationAPI,state.metadata,request):()=>{if(window.GenerationAPI.configurationSnapshot?.())throw Error('打光供应商已变化，请重新确认生成');};
   await window.GenerationAPI.runInPlace(request,{type:'image',guard,dispatchGuard:configurationGuard,apply:output=>{guard();return result.apply(output);}},{signal:controller.signal,onPrepared:()=>{guard();configurationGuard();this.dispatched=true;},onSubmitted:job=>{this.jobId=job.id;}});
   app.notify('打光图片已生成并保存');if(this.alive)this.close();
  }catch(error){if(error.name!=='AbortError'&&error.code!=='cancelled'){if(this.alive){this.operationError=error.message;this.paintReadiness();}app.notify(error.message);}}
  finally{this.busy=false;this.preparation=null;if(this.alive)this.paintReadiness();}
 }
}
function center(n){const canvas=document.querySelector('#canvas');app.transitionView(openingView(n,canvas.clientWidth,canvas.clientHeight),500);}
export function open(node){const n=app.getState().nodes.find(n=>n.id===(typeof node==='string'?node:node.id));if(n?.type!=='image'||!source(n))return;window.NodeActions.closePop();if(current?.id===n.id){center(n);return current;}current?.close();window.NodeActions.close();app.select(n.id);current=new Relight(n);center(n);return current;}
window.ImageRelight={open,close:()=>current?.close(),get active(){return current;}};
document.addEventListener('canvas:render',event=>{
 if(!current||current.closing)return;
 try{current.guard();current.place();}catch{current.close();}
});
