'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function fixture(){
 const listeners=new Map(),windowListeners=new Map(),timers=new Map(),calls=[];let timerId=0;
 const document={activeElement:null,hasFocus:()=>true,addEventListener(type,fn){const handlers=listeners.get(type)||[];handlers.push(fn);listeners.set(type,handlers);}};
 class Element{
  constructor(tag='div'){this.tagName=tag;this.children=[];this.attributes={};this.dataset={};this.style={};this.events=new Map();this.className='';this.classList={add:name=>this.className+=' '+name,contains:name=>this.className.split(' ').includes(name)};this.disabled=false;this.isConnected=false;this.offsetWidth=288;this.offsetHeight=this.clientHeight=120;this.clientTop=0;this.scrollTop=0;}
  append(...items){for(const item of items){item.parent=this;item.isConnected=this.isConnected;this.children.push(item);}}
  setAttribute(name,value){this.attributes[name]=String(value);}
  getAttribute(name){return this.attributes[name];}
  get lastElementChild(){return this.children.at(-1);}
  contains(target){return this===target||this.children.some(item=>item.contains(target));}
  querySelectorAll(selector){const all=this.children.flatMap(item=>[item,...item.querySelectorAll('*')]);if(selector==='*')return all;if(selector==='button:not(:disabled)')return all.filter(item=>item.tagName==='button'&&!item.disabled);if(selector==='[role=option]')return all.filter(item=>item.attributes.role==='option');return [];}
  querySelector(selector){if(selector==='[aria-selected=true]')return this.querySelectorAll('*').find(item=>item.attributes['aria-selected']==='true');return this.querySelectorAll(selector)[0]||null;}
  closest(selector){if(selector.includes('#add')&&this===add)return this;if(selector.includes('.canvas-command-menu')&&this.className.includes('canvas-command-menu'))return this;return this.parent?.closest(selector)||null;}
  getBoundingClientRect(){const top=this.parent?.className.includes('canvas-command-menu')?this.parent.children.indexOf(this)*40-this.parent.scrollTop:0;return {left:0,top,right:288,bottom:top+(this.tagName==='button'?40:120),height:this.tagName==='button'?40:120,width:288};}
  focus(){const previous=document.activeElement;for(const fn of listeners.get('focusout')||[])fn({target:previous});document.activeElement=this;this.onfocus?.();for(const fn of listeners.get('focusin')||[])fn({target:this});}
  click(){if(!this.disabled)return this.onclick?.();}
  remove(){this.isConnected=false;if(this.parent)this.parent.children=this.parent.children.filter(item=>item!==this);}
  addEventListener(type,fn){this.events.set(type,fn);}
 }
 const add=new Element('button'),canvas=new Element();add.isConnected=canvas.isConnected=true;document.body=new Element('body');document.body.isConnected=true;document.createElement=tag=>new Element(tag);document.querySelector=selector=>selector==='#add'?add:selector==='#canvas'?canvas:null;document.activeElement=add;
 const window={CanvasApp:{getState:()=>({view:{x:0,y:0,scale:1}}),addNode:(...args)=>calls.push(args),notify:assert.fail},CanvasMenus:{close(){}},CANVAS_COMMAND_ICONS:{},WorldNode:{},CanvasImageEditor:{},addEventListener(type,fn){windowListeners.set(type,fn);}};
 const source=fs.readFileSync(require.resolve('../canvas-commands.js'),'utf8').replace("import('./src/features/local-resource-migration/display-image.mjs')","Promise.resolve({})");
 vm.runInNewContext(source,{window,document,innerWidth:800,innerHeight:600,console,setTimeout(fn){timers.set(++timerId,fn);return timerId;},clearTimeout(id){timers.delete(id);}});
 const open=(mode='dock')=>{window.CanvasCommands.open(20,20,mode);return document.body.children.at(-1);};
 const key=(key,patch={})=>{const event={key,target:document.activeElement,preventDefault(){this.defaultPrevented=true;},stopImmediatePropagation(){this.stopped=true;},...patch};for(const fn of listeners.get('keydown')||[])fn(event);return event;};
 return {open,key,window,document,add,canvas,Element,listeners,windowListeners,timers,calls,flush(){const pending=[...timers.values()];timers.clear();pending.forEach(fn=>fn());}};
}
test('command Tab preserves native origin until focus actually leaves, including the add trigger',()=>{
 const f=fixture(),menu=f.open(),origin=f.document.activeElement;
 assert.equal(f.add.attributes['aria-haspopup'],'listbox');assert.equal(f.add.attributes['aria-controls'],menu.id);assert.equal(f.add.attributes['aria-expanded'],'true');
 assert.equal(f.key('Tab').defaultPrevented,undefined);assert(menu.isConnected);assert.equal(f.document.activeElement,origin);
 menu.querySelectorAll('button:not(:disabled)')[1].focus();assert(menu.isConnected);
 f.add.focus();assert(!menu.isConnected);assert.equal(f.document.activeElement,f.add);assert.equal(f.add.attributes['aria-expanded'],'false');
});
test('command arrows start at keyboard focus after pointer hover and only scroll their overlay',()=>{
 const f=fixture(),menu=f.open(),rows=menu.querySelectorAll('button:not(:disabled)');rows[4].onpointerenter();
 assert(f.key('ArrowDown').defaultPrevented);assert.equal(f.document.activeElement,rows[1]);
 const style={...menu.style};assert(f.key('End').stopped);assert.equal(f.document.activeElement,rows.at(-1));assert(menu.scrollTop>0);assert.deepEqual(menu.style,style);
 f.key('ArrowDown');assert.equal(f.document.activeElement,rows[0]);assert.equal(menu.scrollTop,40);
});
test('command dismissal handles composition, browser chrome, blur and stale focusout after reopening',()=>{
 const f=fixture(),menu=f.open();for(const patch of [{isComposing:true},{keyCode:229},{key:'Process'},{defaultPrevented:true}])f.key('Escape',patch);assert(menu.isConnected);
 const external=new f.Element('input');assert.equal(f.key('Escape',{target:external}).defaultPrevented,undefined);assert(menu.isConnected);
 for(const fn of f.listeners.get('focusout'))fn({target:f.document.activeElement});const stale=[...f.timers.values()],replacement=f.open();f.document.activeElement=external;stale.forEach(fn=>fn());assert(replacement.isConnected);
 replacement.querySelector('button:not(:disabled)').focus();for(const fn of f.listeners.get('focusout'))fn({target:f.document.activeElement});f.document.activeElement=external;f.flush();assert(!replacement.isConnected);assert.equal(f.document.activeElement,external);
 const blurred=f.open();f.windowListeners.get('blur')();assert(!blurred.isConnected);
});
test('canvas command menu does not mark the dock expanded; Escape and activation restore their origin',async()=>{
 const f=fixture(),menu=f.open('nodes');assert.equal(f.add.attributes['aria-expanded'],'false');const escaped=f.key('Escape');assert(escaped.defaultPrevented);assert(escaped.stopped);assert(!menu.isConnected);assert.equal(f.document.activeElement,f.add);
 const next=f.open();await next.querySelector('button:not(:disabled)').onclick();assert(!next.isConnected);assert.equal(f.calls.length,1);assert.equal(f.calls[0][0],'text');assert.equal(f.document.activeElement,f.add);
});
test('wheel dismissal preserves destination focus and double click ignores interactive and consumed events',()=>{
 const f=fixture(),menu=f.open(),external=new f.Element('input');f.document.activeElement=external;f.canvas.events.get('wheel')({type:'wheel'});assert(!menu.isConnected);assert.equal(f.document.activeElement,external);
 const dblclick=f.canvas.events.get('dblclick');for(const event of [{defaultPrevented:true},{button:2},{target:{closest:()=>({})}}])dblclick({clientX:10,clientY:10,target:{closest:()=>null},...event});assert.equal(f.document.body.children.length,0);
 dblclick({clientX:10,clientY:10,button:0,target:{closest:()=>null}});assert.equal(f.document.body.children.length,1);
});

test('pointer focus on the add button preserves the host dock toggle, while cancel dismisses safely',()=>{
 const f=fixture(),menu=f.open();for(const fn of f.listeners.get('pointerdown'))fn({target:f.add});f.add.focus();assert(menu.isConnected);f.add.events.get('click')();
 // The production addMenu sees the existing dock and closes it, rather than reopening.
 f.window.CanvasCommands.close();assert(!menu.isConnected);
 const canceled=f.open();for(const fn of f.listeners.get('pointerdown'))fn({target:f.add});f.add.focus();for(const fn of f.listeners.get('pointercancel'))fn();assert(!canceled.isConnected);
});

for(const key of ['Enter',' '])test(`command ${key===' '?'Space':key} activates the visual/ARIA selection after hover without moving focus first`,()=>{
 const f=fixture(),menu=f.open(),rows=menu.querySelectorAll('button:not(:disabled)'),origin=f.document.activeElement;rows[2].onpointerenter();assert.equal(f.document.activeElement,origin);assert.equal(rows[2].attributes['aria-selected'],'true');
 const event=f.key(key);assert(event.defaultPrevented);assert(event.stopped);assert(!menu.isConnected);assert.equal(f.calls[0][0],'video');assert.equal(f.document.activeElement,f.add);
});
test('repeated command confirmation and modified Enter do not create nodes',()=>{
 const f=fixture(),menu=f.open();f.key('Enter',{repeat:true});f.key('Enter',{ctrlKey:true});assert(menu.isConnected);assert.equal(f.calls.length,0);
});
