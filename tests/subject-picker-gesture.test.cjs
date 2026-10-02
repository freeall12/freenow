const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
async function fixture(count=5){
 const {selectionSession}=await import('../src/features/subject-library/selection-session.mjs');
 const frames=new Map();let nextFrame=1,reads=0,writes=0,assets=[],closed=0;
 class Surface{
  constructor(){this.listeners=new Map();}
  addEventListener(type,fn,opts){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(fn);opts?.signal?.addEventListener('abort',()=>this.listeners.get(type).delete(fn));}
  emit(type,properties={}){const event={type,button:0,pointerId:1,clientX:0.125,clientY:0.375,target:canvas,preventDefault(){},stopImmediatePropagation(){},...properties};for(const fn of [...this.listeners.get(type)||[]])fn(event);}
 }
 class Element extends Surface{
  constructor(tag){super();this.tagName=tag;this.children=[];this.style={};this.dataset={};this.className='';this.attributes={};this.classList={contains:name=>this.className.split(' ').includes(name),toggle:(name,on)=>{this.className=[...this.className.split(' ').filter(v=>v&&v!==name),...(on?[name]:[])].join(' ');},remove:(...names)=>names.forEach(n=>this.classList.toggle(n,false))};}
  append(...items){for(const item of items){item.parentNode=this;this.children.push(item);}}
  remove(){if(this.parentNode){this.parentNode.children.splice(this.parentNode.children.indexOf(this),1);this.parentNode=null;}}
  setAttribute(key,value){this.attributes[key]=String(value);}getAttribute(key){return this.attributes[key]??null;}
  querySelector(selector){return this.children.find(child=>child.classList.contains(selector.slice(1)))||null;}
  closest(selector){if(selector==='[data-subject-node]'&&this.dataset.subjectNode)return this;return this.parentNode?.closest(selector)||null;}
  get isConnected(){return !!this.root||!!this.parentNode?.isConnected;}
  getBoundingClientRect(){reads++;return this.rect;}
  focus(){}setPointerCapture(id){this.pointer=id;}hasPointerCapture(id){return this.pointer===id;}releasePointerCapture(){this.pointer=null;}
 }
 const canvas=new Element('main'),body=new Element('body');body.root=true;body.append(canvas);
 const nodes=Array.from({length:count},(_,i)=>({id:'n'+i,title:'Node '+i,type:'image',image:'/image-'+i,x:999999,y:999999,width:1,height:1}));
 const state={nodes,view:{x:.125,y:.375,scale:.37}},owners=new Map(nodes.map((n,i)=>{const root=new Element('div');root.rect={left:10.25+i*12.125,right:20.375+i*12.125,top:10.375,bottom:30.125};canvas.append(root);return[n.id,root];}));
 const document=Object.assign(new Surface(),{body,querySelector:selector=>selector==='#canvas'?canvas:owners.get(selector.match(/data-id="([^"]+)"/)?.[1])});
 const window=new Surface(),app={getState:()=>state};
 const el=(tag,cls='',text)=>{const e=new Element(tag);e.className=cls;e.textContent=text;return e;},button=(label,action,cls='')=>{const e=el('button',cls,label);e.onclick=action;return e;};
 const context=vm.createContext({window,document,Map,Set,CSS:{escape:v=>v},AbortController,el,button,selectionSession,assetFromNode:n=>({id:n.id,sourceNodeId:n.id,type:n.type,url:n.image,text:n.content}),requestAnimationFrame:fn=>{const id=nextFrame++;frames.set(id,fn);return id;},cancelAnimationFrame:id=>frames.delete(id)});
 const source=fs.readFileSync(require.resolve('../src/features/subject-library/canvas-picker.mjs'),'utf8').replace(/^import .*;\n/gm,'').replace('export function ','function ');
 vm.runInContext(source+';this.pick=pickSubjectAssets;',context);
 const picker=context.pick({app,getAssets:()=>assets,setAssets:value=>{assets=value;writes++;},onClose:()=>closed++});
 return{canvas,document,window,state,owners,picker,frames,frame(){const pending=[...frames.values()];frames.clear();pending.forEach(fn=>fn());},get reads(){return reads;},get writes(){return writes;},get assets(){return assets;},get closed(){return closed;},hit(id='n0'){return owners.get(id).querySelector('.subject-selection-hit');},box(){return body.querySelector('.subject-selection-box');}};
}
test('120 moves measure actual fractional DOM bounds once and commit all hits in one publish',async()=>{
 const f=await fixture(500);f.canvas.emit('pointerdown');
 for(let i=1;i<=120;i++)f.canvas.emit('pointermove',{clientX:7000.125*i/120,clientY:100.375*i/120});
 assert.equal(f.reads,0);assert.equal(f.frames.size,1);f.frame();assert.equal(f.reads,500);assert.equal(f.box().style.left,'0.125px');
 f.canvas.emit('pointerup',{clientX:1,clientY:1});assert.equal(f.assets.length,500);assert.equal(f.writes,1);assert.equal(f.canvas.pointer,null);assert.equal(f.frames.size,0);
 f.picker.close();assert.equal(f.assets.length,0);f.frame();assert.equal(f.assets.length,0);
});
test('release before RAF flushes last move; threshold >=4 locks drag even when pointer returns',async()=>{
 const f=await fixture();f.canvas.emit('pointerdown');f.canvas.emit('pointermove',{clientX:100.125,clientY:100.375});f.canvas.emit('pointerup',{clientX:1,clientY:1});assert.equal(f.assets.length,5);assert.equal(f.frames.size,0);assert.equal(f.reads,5);
 const near=await fixture();near.canvas.emit('pointerdown',{target:near.hit()});near.canvas.emit('pointermove',{clientX:4.125});near.canvas.emit('pointermove',{clientX:.125});near.canvas.emit('pointerup',{target:near.hit()});assert.equal(near.assets.length,0,'return to origin must not toggle clicked node');
 const click=await fixture();click.canvas.emit('pointerdown',{target:click.hit()});click.canvas.emit('pointermove',{clientX:3.125});click.canvas.emit('pointerup',{target:click.hit()});assert.equal(click.assets.length,1);assert.equal(click.reads,0);
});
test('cancel/blur/wheel/close/type change discard queued work and release capture',async()=>{
 for(const kind of ['pointercancel','lostpointercapture','blur','wheel','close','types']){
  const f=await fixture();f.canvas.emit('pointerdown');f.canvas.emit('pointermove',{clientX:100,clientY:100});
  if(kind==='blur')f.window.emit(kind);else if(kind==='close')f.picker.close();else if(kind==='types')f.picker.setTypes(['text']);else f.canvas.emit(kind);
  f.frame();assert.equal(f.assets.length,0,kind);assert.equal(f.reads,0,kind);assert.equal(f.frames.size,0);assert.equal(f.canvas.pointer,null);
 }
});
test('foreign pointers cannot flush/cancel; each frame rereads transforms and excludes strict edge contact',async()=>{
 const f=await fixture(1);f.canvas.emit('pointerdown');f.canvas.emit('pointermove',{clientX:10.25,clientY:100});f.canvas.emit('pointercancel',{pointerId:2});f.canvas.emit('pointerup',{pointerId:2});assert.equal(f.frames.size,1);f.frame();assert.equal(f.owners.get('n0').classList.contains('subject-selection-pending'),false);
 f.owners.get('n0').rect={left:5.125,right:9.875,top:1,bottom:4};f.canvas.emit('pointermove',{clientX:10.25,clientY:100});f.frame();assert.equal(f.reads,2);f.canvas.emit('pointerup');assert.equal(f.assets.length,1);
});
test('removal, hidden shells and eligibility changes before release cannot commit stale hits',async()=>{
 const f=await fixture(4);f.canvas.emit('pointerdown');f.canvas.emit('pointermove',{clientX:100,clientY:100});f.frame();
 f.state.nodes.splice(0,1);f.state.nodes[0].type='group';f.state.nodes[1].hidden=true;
 f.canvas.emit('pointerup');assert.deepEqual(f.assets.map(a=>a.id),['n3']);
 const detached=await fixture(2);detached.canvas.emit('pointerdown');detached.canvas.emit('pointermove',{clientX:100,clientY:100});detached.owners.get('n0').remove();detached.owners.get('n1').hidden=true;detached.frame();detached.canvas.emit('pointerup');assert.equal(detached.assets.length,0);
});
