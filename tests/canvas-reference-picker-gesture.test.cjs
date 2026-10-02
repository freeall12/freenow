const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');

function fixture({withTrigger=false,rebuildTrigger=false}={}){
 const frames=new Map();let nextFrame=1,renderCalls=0,closed=0;const selected=[];
 class Surface{
  constructor(){this.listeners=new Map();}
  addEventListener(type,fn){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(fn);}
  removeEventListener(type,fn){this.listeners.get(type)?.delete(fn);}
  emit(type,properties={}){const event={type,button:0,pointerId:1,clientX:100.5,clientY:200.125,target:canvas,preventDefault(){this.defaultPrevented=true;},stopImmediatePropagation(){this.immediate=true;},stopPropagation(){this.stopped=true;},...properties};for(const fn of [...this.listeners.get(type)||[]])fn(event);return event;}
 }
 class Element extends Surface{
  constructor(tag){super();this.tagName=tag;this.children=[];this.style={};this.dataset={};this.className='';this.attributes={};this.classList={add:(...names)=>{this.className=[...new Set([...this.className.split(' '),...names])].join(' ');},remove:(...names)=>{this.className=this.className.split(' ').filter(value=>!names.includes(value)).join(' ');},contains:name=>this.className.split(' ').includes(name)};}
  append(...items){for(const item of items){item.remove?.();item.parentNode=this;this.children.push(item);}}
  remove(){if(this.parentNode){this.parentNode.children.splice(this.parentNode.children.indexOf(this),1);this.parentNode=null;}}
  setAttribute(key,value){this.attributes[key]=String(value);}
  contains(target){return target===this||this.children.some(child=>child.contains?.(target));}
  focus(){document.activeElement=this;document.emit('focusin',{target:this});}
  querySelectorAll(selector){const classes=selector.split(',').map(value=>value.trim().replace(/^:scope\s*>\s*/,'').replace(/^\./,''));return this.children.filter(child=>classes.some(value=>child.classList?.contains(value)));}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  closest(selector){if(selector.startsWith('.')&&this.classList.contains(selector.slice(1)))return this;return this.parentNode?.closest?.(selector)||null;}
  get isConnected(){return !!this.root||!!this.parentNode?.isConnected;}
  getBoundingClientRect(){return{left:10.25,top:20.375,width:1280,height:720};}
  setPointerCapture(id){this.pointer=id;}hasPointerCapture(id){return this.pointer===id;}releasePointerCapture(){this.pointer=null;}
 }
 const canvas=new Element('div'),body=new Element('body'),head=new Element('head');body.root=true;body.append(canvas);
 const nodes=[{id:'target',type:'video',title:'目标',x:53284.3125,y:-32.875,width:435.25,height:250.125},{id:'source',type:'image',title:'参考',x:53400.875,y:120.625,width:300.125,height:400.375}];
 const state={nodes,edges:[],selected:['target'],view:{x:102.125,y:-30.875,scale:.7}},owners=new Map(nodes.map(n=>{const owner=new Element('div');owner.dataset.id=n.id;canvas.append(owner);return[n.id,owner];}));
 const document=Object.assign(new Surface(),{body,head,createElement:tag=>new Element(tag),createTextNode:text=>({textContent:text}),querySelector:selector=>selector==='#canvas'?canvas:owners.get(selector.match(/data-id="([^"]+)"/)?.[1])});
 const emitDocument=document.emit.bind(document);document.emit=(type,properties={})=>{if(type==='keydown'&&(!properties.target||canvas.contains(properties.target))){const event=canvas.emit(type,properties);if(event.immediate||event.stopped)return event;return emitDocument(type,event);}return emitDocument(type,properties);};
 const triggerHost=new Element('section'),originalTrigger=new Element('button');triggerHost.className='node-editor';originalTrigger.className='reference-add';if(withTrigger){triggerHost.append(originalTrigger);body.append(triggerHost);document.activeElement=originalTrigger;}
 const window=Object.assign(new Surface(),{CanvasConnections:{validate:()=>null}});
 const app={getState:()=>state,setView(view){state.view={...view};renderCalls++;document.emit('canvas:render',{detail:{viewportOnly:true}});},notify(message){throw Error(message);},transitionView(view){this.setView(view);}};
 const context=vm.createContext({window,document,Map,Set,CSS:{escape:value=>value},matchMedia:()=>({matches:true}),requestAnimationFrame:fn=>{const id=nextFrame++;frames.set(id,fn);return id;},cancelAnimationFrame:id=>frames.delete(id)});
 const source=fs.readFileSync(require.resolve('../src/features/canvas-reference-picker/entry.mjs'),'utf8').replace(/export function /g,'function ').replace("new URL('./styles.css', import.meta.url)","'styles.css'");
 vm.runInContext(source+';this.pickReference=pickReference;',context);
 const picker=context.pickReference({app,targetId:'target',allowedTypes:['image'],onSelect:id=>selected.push(id),onClose:()=>{closed++;if(rebuildTrigger){originalTrigger.remove();const next=new Element('button');next.className='reference-add';triggerHost.append(next);}}});
 return{app,state,canvas,document,window,owners,picker,frames,selected,triggerHost,originalTrigger,get renders(){return renderCalls;},get closed(){return closed;},frame(){const pending=[...frames.values()];frames.clear();pending.forEach(fn=>fn());},hit:()=>owners.get('source').children.find(child=>child.classList.contains('canvas-reference-hit'))};
}

test('reference picking coalesces 120 pointer moves into one view/render and preserves exact fractional anchors',()=>{
 const f=fixture(),initial={...f.state.view};f.canvas.emit('pointerdown');
 for(let i=1;i<=120;i++)f.canvas.emit('pointermove',{clientX:100.5+i*.125,clientY:200.125-i*.375});
 assert.equal(f.renders,0);assert.equal(f.frames.size,1);f.frame();assert.equal(f.renders,1);assert.equal(f.state.view.x,initial.x+15);assert.equal(f.state.view.y,initial.y-45);assert.equal(f.state.view.scale,.7);
 f.canvas.emit('pointermove',{clientX:200.875,clientY:150.25});assert.equal(f.frames.size,1);f.canvas.emit('pointerup',{clientX:210.875,clientY:160.25});
 assert.equal(f.renders,2);assert.equal(f.frames.size,0);assert.equal(f.state.view.x,initial.x+100.375);assert.equal(f.state.view.y,initial.y-49.875);f.frame();assert.equal(f.renders,2);assert.deepEqual(f.selected,[]);assert.equal(f.canvas.pointer,null);
});

test('click selection, four-pixel threshold and foreign pointer IDs preserve existing behavior',()=>{
 const f=fixture(),hit=f.hit();f.canvas.emit('pointerdown',{target:hit});f.canvas.emit('pointermove',{clientX:104.5,target:hit});assert.equal(f.frames.size,0);
 f.canvas.emit('pointercancel',{pointerId:2});assert.equal(f.canvas.pointer,1);f.canvas.emit('pointermove',{pointerId:2,clientX:500});f.canvas.emit('pointerup',{pointerId:2,target:hit});assert.equal(f.closed,0);
 f.canvas.emit('pointerup',{target:hit});assert.deepEqual(f.selected,['source']);assert.equal(f.closed,1);assert.equal(f.renders,0);
 const drag=fixture(),target=drag.hit();drag.canvas.emit('pointerdown',{target});drag.canvas.emit('pointermove',{clientX:105.5});drag.canvas.emit('pointermove',{clientX:101});drag.canvas.emit('pointerup',{target});
 assert.equal(drag.renders,1);assert.equal(drag.state.view.x,102.625);assert.deepEqual(drag.selected,[],'crossing the threshold remains a drag even after returning near the origin');
});

test('cancel and blur flush received movement once, while closed pickers cannot apply late frames',()=>{
 for(const kind of ['pointercancel','blur']){
  const f=fixture();f.canvas.emit('pointerdown');f.canvas.emit('pointermove',{clientX:151.125,clientY:190.75});
  if(kind==='blur')f.window.emit(kind);else f.canvas.emit(kind);
  assert.equal(f.renders,1);assert.equal(f.state.view.x,152.75);assert.equal(f.state.view.y,-40.25);assert.equal(f.frames.size,0);f.frame();assert.equal(f.renders,1);
  f.canvas.emit('pointermove',{clientX:800});assert.equal(f.frames.size,0);
 }
 const f=fixture();f.canvas.emit('pointerdown');f.canvas.emit('pointermove',{clientX:200});f.picker.close();assert.equal(f.canvas.pointer,null);assert.equal(f.renders,1);f.frame();assert.equal(f.renders,1);assert.equal(f.closed,1);assert.equal(f.frames.size,0);
 f.canvas.emit('pointermove',{clientX:800});assert.equal(f.renders,1);
});

test('wheel and keyboard navigation flush earlier pan samples before changing the viewport',()=>{
 for(const kind of ['wheel','keydown']){
  const f=fixture();f.canvas.emit('pointerdown');f.canvas.emit('pointermove',{clientX:120.875,clientY:215.625});
  if(kind==='wheel')f.canvas.emit('wheel');else f.document.emit('keydown',{key:'+'});
  assert.equal(f.renders,1);assert.equal(f.state.view.x,122.5);assert.equal(f.state.view.y,-15.375);
  f.app.setView({...f.state.view,x:999.125,scale:1.25});assert.equal(f.canvas.pointer,null);f.canvas.emit('pointermove',{clientX:800});f.canvas.emit('pointerup',{clientX:810});f.frame();assert.equal(f.state.view.x,999.125);assert.equal(f.state.view.scale,1.25);assert.equal(f.renders,2);
 }
 const f=fixture();f.canvas.emit('pointerdown');f.canvas.emit('pointermove',{clientX:150.875});f.document.emit('keydown',{key:'Escape'});assert.equal(f.state.view.x,152.5);assert.equal(f.closed,1);assert.equal(f.frames.size,0);
 const returning=fixture();returning.canvas.emit('pointerdown');returning.canvas.emit('pointermove',{clientX:180.875});
 const banner=returning.document.body.children.find(child=>child.classList.contains('canvas-reference-banner')),back=banner.children.find(child=>child.classList.contains('canvas-reference-return'));back.onclick();
 const afterReturn={...returning.state.view};returning.canvas.emit('pointermove',{clientX:800});returning.canvas.emit('pointerup');assert.equal(returning.canvas.pointer,null);assert.equal(returning.frames.size,0);returning.frame();assert.deepEqual(returning.state.view,afterReturn);assert.equal(returning.renders,2);
});

test('external graph invalidation closes and discards pending work; space leaves canvas navigation to its owner',()=>{
 const f=fixture();f.canvas.emit('pointerdown');f.canvas.emit('pointermove',{clientX:200});f.state.nodes.splice(0,1);f.document.emit('canvas:render');assert.equal(f.canvas.pointer,null);assert.equal(f.closed,1);f.frame();assert.equal(f.renders,0);
 const spaced=fixture();spaced.document.emit('keydown',{code:'Space'});spaced.canvas.emit('pointerdown');spaced.canvas.emit('pointermove',{clientX:800});assert.equal(spaced.frames.size,0);assert.equal(spaced.renders,0);
 spaced.document.emit('keyup',{code:'Space'});spaced.canvas.emit('pointerdown');spaced.canvas.emit('pointermove',{clientX:120.875});spaced.frame();assert.equal(spaced.renders,1);
});


test('reference picker yields Escape to nested, external and composing input; owned Escape closes once',()=>{
 const f=fixture(),external=f.document.createElement('input');f.document.body.append(external);
 for(const extra of [{defaultPrevented:true},{isComposing:true},{keyCode:229},{target:external}]){const event=f.document.emit('keydown',{key:'Escape',...extra});assert.equal(event.immediate,undefined);assert.equal(f.closed,0);}
 const nested=f.canvas.emit('keydown',{key:'Escape',defaultPrevented:true});f.document.emit('keydown',nested);assert.equal(f.closed,0);
 const event=f.document.emit('keydown',{key:'Escape'});assert.equal(event.defaultPrevented,true);assert.equal(event.immediate,true);assert.equal(f.closed,1);f.picker.close();assert.equal(f.closed,1);
});

test('outside pointer and focus close without taking focus; pagehide discards pending pan',()=>{
 for(const type of ['pointerdown','focusin']){
  const f=fixture(),external=f.document.createElement('input');f.document.body.append(external);f.document.activeElement=external;
  f.document.emit(type,{target:external});assert.equal(f.closed,1);assert.equal(f.document.activeElement,external);assert.equal(f.canvas.pointer,undefined);
 }
 const f=fixture();f.canvas.emit('pointerdown');f.canvas.emit('pointermove',{clientX:800});assert.equal(f.frames.size,1);f.window.emit('pagehide');assert.equal(f.closed,1);assert.equal(f.renders,0);assert.equal(f.frames.size,0);f.frame();assert.equal(f.renders,0);
});


test('picker Escape is consumed before document canvas shortcuts and restores a rebuilt source trigger',()=>{
 const f=fixture({withTrigger:true,rebuildTrigger:true});let documentShortcuts=0;f.document.addEventListener('keydown',()=>{documentShortcuts++;f.state.selected=[];});
 f.document.emit('pointerdown',{target:f.originalTrigger});assert.equal(f.closed,0,'same trigger remains available to its host toggle');
 f.document.emit('keydown',{key:'Escape'});assert.equal(documentShortcuts,0);assert.deepEqual(f.state.selected,['target']);assert.equal(f.closed,1);
 assert.equal(f.document.activeElement,f.triggerHost.children[0]);assert.notEqual(f.document.activeElement,f.originalTrigger);
});


test('an open native dialog owns even a body-targeted Escape fallback',()=>{
 const f=fixture(),query=f.document.querySelector;f.document.querySelector=selector=>selector==='dialog[open]'?{}:query(selector);
 const event=f.document.emit('keydown',{target:f.document.body,key:'Escape'});assert.equal(event.defaultPrevented,undefined);assert.equal(f.closed,0);f.picker.close();
});
