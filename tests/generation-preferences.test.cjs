const test=require('node:test'),assert=require('node:assert/strict');
const preferences=()=>import('../src/features/generation-results/preferences.mjs');

function environment(t){
 const saved=new Map(['window','document','localStorage','getComputedStyle'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 const values=new Map(),window=new EventTarget();
 class Element extends EventTarget{
  constructor(tag){super();this.tagName=tag;this.children=[];this.dataset={};this.attributes={};this.style={};}
  append(...items){for(const item of items){item.parentNode=this;this.children.push(item);}}
  remove(){if(this.parentNode){this.parentNode.children.splice(this.parentNode.children.indexOf(this),1);this.parentNode=null;}}
  setAttribute(key,value){this.attributes[key]=String(value);}getAttribute(key){return this.attributes[key];}removeAttribute(key){delete this.attributes[key];}
  contains(node){return this===node||this.children.some(child=>child.contains(node));}
  getBoundingClientRect(){return this.bounds??{width:Math.min(260,parseFloat(this.style.maxWidth)||260),height:56};}
  focus(){document.activeElement=this;}
  get isConnected(){return !!this.root||!!this.parentNode?.isConnected;}
  showModal(){this.open=true;}close(){this.open=false;this.dispatchEvent(new Event('close'));}
 }
 const document=Object.assign(new EventTarget(),{activeElement:null,createElement:tag=>new Element(tag),head:Object.assign(new Element('head'),{root:true}),body:Object.assign(new Element('body'),{root:true}),querySelector(){return this.head.children.find(node=>Object.hasOwn(node.dataset,'generationResultPreferences'));}});
 const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
 for(const [key,value] of Object.entries({window,document,localStorage:storage}))Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});
 t.after(()=>{for(const [key,descriptor] of saved)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];});
 return{window,document,storage,values};
}

test('result mode persists official key, defaults to variants, rejects invalid values and notifies once',async t=>{
 const env=environment(t),p=await preferences();assert.equal(p.getResultMode(),'variants');
 env.values.set(p.RESULT_MODE_KEY,'legacy-invalid');assert.equal(p.getResultMode(),'variants');
 const notifications=[],details=[];const unsubscribe=p.subscribeResultMode(mode=>notifications.push(mode));env.window.addEventListener(p.RESULT_MODE_EVENT,event=>details.push(event.detail));
 assert.equal(p.setResultMode('pile'),'pile');assert.equal(env.values.get('tapnow.canvas.generation-result-mode'),'pile');assert.deepEqual(notifications,['pile']);assert.deepEqual(details,[{mode:'pile'}]);
 p.setResultMode('pile');assert.deepEqual(notifications,['pile']);assert.throws(()=>p.setResultMode('invalid'),TypeError);assert.equal(p.getResultMode(),'pile');
 env.values.set(p.RESULT_MODE_KEY,'spread');const event=new Event('storage');Object.defineProperty(event,'key',{value:p.RESULT_MODE_KEY});env.window.dispatchEvent(event);assert.deepEqual(notifications,['pile','spread']);
 unsubscribe();p.setResultMode('variants');assert.deepEqual(notifications,['pile','spread']);
});

test('mounted radios support keyboard wrapping, live synchronization and failed persistence without false selection',async t=>{
 const env=environment(t),p=await preferences(),mount=p.mountPreferences(env.document.body),row=mount.element.children[1],group=row.children[1],buttons=group.children;
 assert.deepEqual(buttons.map(button=>button.dataset.resultMode),['pile','variants','spread']);assert.deepEqual(buttons.map(button=>button.getAttribute('aria-checked')),['false','true','false']);mount.focus();assert.equal(env.document.activeElement,buttons[1]);
 function key(value){const event=new Event('keydown',{cancelable:true});Object.defineProperty(event,'key',{value});group.dispatchEvent(event);assert.equal(event.defaultPrevented,true);}
 key('ArrowRight');assert.equal(p.getResultMode(),'spread');key('ArrowRight');assert.equal(p.getResultMode(),'pile');
 key('End');assert.equal(p.getResultMode(),'pile');assert.equal(env.document.activeElement,buttons[2]);assert.equal(buttons[2].tabIndex,0);
 key('Home');assert.equal(p.getResultMode(),'pile');assert.equal(env.document.activeElement,buttons[0]);key('ArrowUp');assert.equal(p.getResultMode(),'spread');
 key('PageUp');assert.equal(p.getResultMode(),'spread');assert.equal(env.document.activeElement,buttons[0]);
 key('PageDown');assert.equal(p.getResultMode(),'spread');assert.equal(env.document.activeElement,buttons[2]);key('Enter');assert.equal(p.getResultMode(),'spread');
 globalThis.getComputedStyle=()=>({direction:'rtl'});key('ArrowRight');assert.equal(p.getResultMode(),'variants');key('ArrowLeft');assert.equal(p.getResultMode(),'spread');
 const modified=new Event('keydown',{cancelable:true});Object.assign(modified,{key:'ArrowLeft',ctrlKey:true});group.dispatchEvent(modified);assert.equal(modified.defaultPrevented,false);assert.equal(p.getResultMode(),'spread');
 p.setResultMode('variants');assert.equal(buttons[1].getAttribute('aria-checked'),'true');
 env.storage.setItem=()=>{throw Error('quota exceeded');};buttons[0].dispatchEvent(new Event('click'));assert.equal(p.getResultMode(),'variants');assert.equal(buttons[1].getAttribute('aria-checked'),'true');assert.equal(mount.element.children[2].hidden,false);
 const root=mount.element;mount.destroy();assert.equal(root.isConnected,false);assert.equal(env.document.head.children.length,1);
});

test('account entry keeps fractional anchors, flips and clamps, opens settings and restores focus',async t=>{
 const env=environment(t),{install}=await import('../src/features/generation-results/entry.mjs');
 env.window.innerWidth=1600;env.window.innerHeight=900;
 const avatar=env.document.createElement('BUTTON');avatar.bounds={left:21.621,right:61.621,top:571.992,bottom:611.992,width:40,height:40};env.document.body.append(avatar);
 const controller=install(avatar);assert.equal(install(avatar),controller);env.document.head.children[0].sheet={};
 avatar.dispatchEvent(new Event('click',{cancelable:true}));
 let popup=env.document.body.children.at(-1);assert.ok(Math.abs(parseFloat(popup.style.left)-75.621)<1e-9);assert.equal(popup.style.top,'555.992px');assert.equal(popup.children.length,1);assert.equal(popup.children[0].children[1].textContent,'账户管理');
 avatar.bounds={left:1550.5,right:1590.5,top:20.25,bottom:60.25};env.window.dispatchEvent(new Event('resize'));assert.equal(popup.dataset.side,'left');assert.equal(popup.style.left,'1276.5px');assert.equal(popup.style.top,'16px');
 env.window.innerWidth=220;env.window.dispatchEvent(new Event('resize'));assert.equal(popup.style.maxWidth,'188px');assert.equal(popup.style.left,'16px');
 popup.children[0].dispatchEvent(new Event('click'));assert.equal(popup.isConnected,false);let dialog=env.document.body.children.at(-1);assert.equal(dialog.className,'generation-preferences-dialog');assert.equal(dialog.open,true);dialog.close();assert.equal(env.document.activeElement,avatar);
 avatar.dispatchEvent(new Event('click'));popup=env.document.body.children.at(-1);const escape=new Event('keydown',{cancelable:true});Object.assign(escape,{key:'Escape'});popup.dispatchEvent(escape);assert.equal(popup.isConnected,false);assert.equal(avatar.getAttribute('aria-expanded'),'false');assert.equal(env.document.activeElement,avatar);
 avatar.dispatchEvent(new Event('click'));popup=env.document.body.children.at(-1);env.document.dispatchEvent(new Event('pointerdown'));assert.equal(popup.isConnected,false);
 controller.destroy();assert.equal(avatar.getAttribute('aria-haspopup'),undefined);avatar.dispatchEvent(new Event('click'));assert.equal(env.document.body.children.length,1);
});

test('preferences dialog reuses one session, closes and restores the opener focus',async t=>{
 const env=environment(t),p=await preferences(),opener=env.document.createElement('button');env.document.body.append(opener);opener.focus();
 const dialog=p.openPreferences();assert.equal(dialog.open,true);assert.equal(p.openPreferences(),dialog);assert.equal(env.document.head.children.length,1);
 dialog.close();assert.equal(dialog.isConnected,false);assert.equal(env.document.activeElement,opener);
 const next=p.openPreferences();assert.notEqual(next,dialog);next.close();
});
