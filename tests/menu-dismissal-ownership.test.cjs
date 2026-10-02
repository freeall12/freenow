'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function fixture(){
 const listeners=new Map();
 const document={activeElement:null,addEventListener(name,fn){if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(fn);},removeEventListener(name,fn){listeners.get(name)?.delete(fn);}};
 class Element{
  constructor(tag='div'){this.tagName=tag;this.children=[];this.hidden=true;this.style={};this.offsetWidth=200;this.offsetHeight=150;this.isConnected=true;}
  append(child){child.parent=this;this.children.push(child);}
  replaceChildren(){this.children.forEach(c=>c.isConnected=false);this.children=[];}
  contains(target){return target===this||this.children.some(c=>c.contains(target));}
  setAttribute(){}
  addEventListener(){}
  querySelectorAll(){return this.children.filter(c=>c.tagName==='button'&&!c.disabled);}
  querySelector(){return this.querySelectorAll()[0];}
  focus(){document.activeElement=this;for(const fn of listeners.get('focusin')||[])fn({target:this});}
 }
 document.createElement=tag=>new Element(tag);
 const timers=new Map(),windowListeners=new Map();let timerId=0;
 const context={document,module:{exports:{}},innerWidth:800,innerHeight:600,console,
  setTimeout(fn){timers.set(++timerId,fn);return timerId;},clearTimeout(id){timers.delete(id);},
  addEventListener(name,fn){if(!windowListeners.has(name))windowListeners.set(name,new Set());windowListeners.get(name).add(fn);},removeEventListener(name,fn){windowListeners.get(name)?.delete(fn);}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../component-library/ui.js'),'utf8'),context);
 const trigger=new Element('button');trigger.focus();const element=new Element();
 const menu=context.module.exports.createMenu({element});
 function key(key,target=document.activeElement,extra={}){const event={key,target,...extra,preventDefault(){this.defaultPrevented=true;},stopImmediatePropagation(){this.stopped=true;}};for(const fn of listeners.get('keydown')||[])fn(event);return event;}
 const flush=()=>{const callbacks=[...timers.values()];timers.clear();callbacks.forEach(fn=>fn());};
 return {document,listeners,windowListeners,Element,element,trigger,menu,key,flush,timers};
}
test('menu only consumes its own keys and returns focus on Escape',()=>{
 const f=fixture();f.menu.show(10,10,[{label:'Copy',run(){}}]);
 const external=new f.Element('input');
 assert.equal(f.key('Escape',external).defaultPrevented,undefined);assert(f.menu.isOpen);
 assert.equal(f.key('ArrowDown',external).defaultPrevented,undefined);
 assert.equal(f.key('Escape',f.document.activeElement,{isComposing:true}).defaultPrevented,undefined);
 const owned=f.key('Escape');assert(owned.defaultPrevented);assert(owned.stopped);assert(!f.menu.isOpen);assert.equal(f.document.activeElement,f.trigger);
});
test('new dialog focus dismisses stale menu without stealing its focus; destroy removes handlers',()=>{
 const f=fixture();f.menu.show(10,10,[{label:'Copy',run(){}}]);const field=new f.Element('input');field.focus();
 assert(!f.menu.isOpen);assert.equal(f.document.activeElement,field);assert.equal(f.key('Escape').defaultPrevented,undefined);
 f.menu.destroy();assert.equal(f.listeners.get('focusin').size,0);assert.equal(f.listeners.get('keydown').size,0);
 assert.equal(f.listeners.get('focusout').size,0);assert.equal(f.windowListeners.get('blur').size,0);
});
test('Tab into browser chrome dismisses after focusout settles without requiring focusin',()=>{
 const f=fixture();f.menu.show(10,10,[{label:'Find',run(){}}]);const origin=f.document.activeElement;
 f.key('Tab');for(const fn of f.listeners.get('focusout'))fn({target:origin});
 assert.equal(f.element.inert,false);assert(f.menu.isOpen);
 f.document.activeElement=new f.Element('body');f.flush();
 assert.equal(f.menu.isOpen,false);assert.equal(f.element.inert,true);
});
test('queued focusout cannot close reopened menu; window blur and destroy clean up safely',()=>{
 const f=fixture();f.menu.show(10,10,[{label:'Old',run(){}}]);
 for(const fn of f.listeners.get('focusout'))fn({target:f.document.activeElement});const stale=[...f.timers.values()];
 f.menu.show(10,10,[{label:'New',run(){}}]);f.document.activeElement=new f.Element('body');for(const fn of stale)fn();assert(f.menu.isOpen);
 for(const fn of f.windowListeners.get('blur'))fn();assert.equal(f.menu.isOpen,false);
 f.menu.show(10,10,[{label:'New',run(){}}]);for(const fn of f.listeners.get('focusout'))fn({target:f.document.activeElement});
 f.menu.destroy();f.flush();assert.equal(f.menu.isOpen,false);assert.equal(f.timers.size,0);
});
test('all-disabled menu owns focus and can still be dismissed',()=>{
 const f=fixture();f.menu.show(10,10,[{label:'Unavailable'}]);assert.equal(f.document.activeElement,f.element);assert.equal(f.element.tabIndex,-1);assert(f.key('Escape').defaultPrevented);assert.equal(f.document.activeElement,f.trigger);
});
test('Tab leaves its native focus origin intact and focusin dismisses only after leaving the menu',()=>{
 const f=fixture();f.menu.show(10,10,[{label:'Copy',run(){}},{label:'Paste',run(){}}]);
 const origin=f.document.activeElement,event=f.key('Tab');
 assert.equal(event.defaultPrevented,undefined);assert.equal(f.element.inert,false);assert.equal(f.element.hidden,false);assert.equal(f.document.activeElement,origin);
 f.element.children[1].focus();assert(f.menu.isOpen);
 const next=new f.Element('button');next.focus();
 assert.equal(f.menu.isOpen,false);assert.equal(f.element.inert,true);assert.equal(f.document.activeElement,next);
});
