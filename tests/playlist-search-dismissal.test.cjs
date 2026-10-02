'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');

function fixture(kind='playlist') {
 const handlers=new Map(),notifications=[],focusedNodes=[],created=[];
 const document={activeElement:null,addEventListener(type,fn){const list=handlers.get(type)||[];list.push(fn);handlers.set(type,list);}};
 class Element {
  constructor(tag){this.tagName=tag;this.children=[];this.attributes={};this.events=new Map();this.dataset={};this.style={};this.className='';this.value='';this.open=false;this.paused=true;this.offsetWidth=160;this.offsetHeight=120;this.clientWidth=1200;this.classList={add:name=>{this.className+=' '+name;},toggle:(name,on)=>{this.className=this.className.split(' ').filter(v=>v&&v!==name).concat(on?[name]:[]).join(' ');}};}
  get isConnected(){return this===document.body||!!this.parentNode?.isConnected;}
  get firstChild(){return this.children[0];}
  append(...items){for(const item of items){item.parentNode=this;this.children.push(item);}}
  replaceChildren(...items){this.children.forEach(item=>item.parentNode=null);this.children=[];this.append(...items);}
  remove(){if(this.parentNode){this.parentNode.children.splice(this.parentNode.children.indexOf(this),1);this.parentNode=null;}}
  set innerHTML(value){this.html=value;this.replaceChildren();}get innerHTML(){return this.html;}
  set src(value){this.attributes.src=value;}get src(){return this.attributes.src;}
  setAttribute(name,value){this.attributes[name]=String(value);}getAttribute(name){return this.attributes[name];}
  contains(target){return target===this||this.children.some(child=>child.contains(target));}
  matches(selector){if(selector==='dialog[open]')return this.tagName==='dialog'&&this.open;if(selector.startsWith('.'))return this.className.split(' ').includes(selector.slice(1));return selector===this.tagName;}
  closest(selector){for(let node=this;node;node=node.parentNode)if(selector.split(',').some(part=>node.matches(part)))return node;return null;}
  querySelectorAll(selector){const found=[];for(const child of this.children){if(child.matches(selector))found.push(child);found.push(...child.querySelectorAll(selector));}return found;}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  addEventListener(type,fn){const list=this.events.get(type)||[];list.push(fn);this.events.set(type,list);}
  emit(type,event={}){for(const fn of this.events.get(type)||[])fn(event);this['on'+type]?.(event);}
  focus(){document.activeElement=this;for(const fn of handlers.get('focusin')||[])fn({target:this});}
  showModal(){this.returnFocus=document.activeElement;this.open=true;(this.querySelector('button')||this).focus();}
  close(){this.open=false;this.returnFocus?.focus();this.emit('close');}
  pause(){this.paused=true;this.onpause?.();}play(){this.paused=false;return Promise.resolve();}
  getBoundingClientRect(){return {left:20,top:40,bottom:140,width:960,height:104};}
 }
 document.body=new Element('body');document.createElement=tag=>new Element(tag);document.createTextNode=text=>Object.assign(new Element('#text'),{textContent:text});
 const canvas=new Element('main'),bar=new Element('div'),search=new Element('button'),dialog=new Element('dialog');document.body.append(canvas,bar,search,dialog);
 const playlist={id:'p',type:'playlist',title:'时间线',x:0,y:0,width:960,clips:[{id:'c',url:'/video.mp4',poster:'/poster.png',title:'视频',sourceId:'v',sourceDuration:5,trimStart:0,duration:4}]};
 const shell=new Element('section');shell.className='node';shell.dataset.id='p';for(const name of ['node-title','node-body','port']){const element=new Element('div');element.className=name;shell.append(element);}canvas.append(shell);
 const state={nodes:kind==='playlist'?[playlist]:[{id:'a',type:'text',title:'文本',content:'草稿'},{id:'b',type:'image',title:'图片'}],selected:['p'],view:{x:0,y:0,scale:1}};
 document.querySelector=selector=>({'#canvas':canvas,'#node-toolbar':bar,'#search':search,'#search-dialog':dialog}[selector]||document.body.querySelector(selector));
 const app={getState:()=>state,getNodeElement:()=>shell,render:()=>{for(const fn of handlers.get('canvas:render')||[])fn({});},select(){},setView(){},updateNode(id,patch){Object.assign(playlist,patch);this.render();},notify:message=>notifications.push(message),focusNode:id=>focusedNodes.push(id),createConnected:(...args)=>created.push(args)};
 const window={CanvasApp:app,CanvasPlaylistCore:require('../canvas-playlist.js'),CanvasSearch:require('../src/features/canvas-search/core.js'),CanvasClipboard:require('../canvas-clipboard.js'),CANVAS_COMMAND_ICONS:{},CANVAS_SEARCH_ICONS:{},UI_ICONS:{},LocalAssets:{url:async url=>url},LocalMedia:{asDataUrl:async()=> 'data:video/mp4;base64,AA'},addEventListener(){}};
 const context={window,document,localStorage:{getItem:()=>null},innerWidth:1600,innerHeight:900,cancelAnimationFrame(){},requestAnimationFrame:()=>1,AbortController,crypto:{randomUUID:()=> 'id'},fetch:async()=>({ok:true,blob:async()=>({})})};
 vm.runInNewContext(fs.readFileSync(require.resolve(kind==='playlist'?'../canvas-playlist-ui.js':'../src/features/canvas-search/ui.js'),'utf8'),context);
 const key=(target=document.activeElement,patch={})=>{const event={key:'Escape',target,preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.stopped=true;},stopImmediatePropagation(){this.stopped=true;},...patch};for(const fn of handlers.get('keydown')||[])fn(event);if(!event.stopped){for(let node=target;node;node=node.parentNode){node.emit('keydown',event);if(event.stopped)break;}}return event;};
 return {window,document,context,Element,canvas,shell,search,dialog,state,key,notifications,focusedNodes,created,handlers,output:shell.querySelector('.playlist-tools')?.children[1],add:shell.querySelector('.playlist-add'),menu:()=>document.body.querySelector('.playlist-menu'),preview:()=>document.body.querySelector('.playlist-preview')};
}

test('playlist export menu toggles its trigger, dismisses on focus departure and restores focus on Escape',()=>{
 const f=fixture();f.output.focus();f.output.onclick();assert.ok(f.menu());assert.equal(f.output.getAttribute('aria-expanded'),'true');
 f.output.onclick();assert.equal(f.menu(),null);assert.equal(f.document.activeElement,f.output);
 f.output.onclick();const destination=new f.Element('input');f.document.body.append(destination);destination.focus();assert.equal(f.menu(),null);assert.equal(f.document.activeElement,destination);
 f.output.onclick();const event=f.key();assert(event.defaultPrevented);assert.equal(f.menu(),null);assert.equal(f.document.activeElement,f.output);
});
test('playlist menu closes for other toolbar controls and preserves the Tab focus origin',()=>{
 const f=fixture();f.output.onclick();for(const fn of f.handlers.get('pointerdown'))fn({target:f.output.parentNode.children[0]});assert.equal(f.menu(),null);
 f.output.onclick();const menu=f.menu(),origin=f.document.activeElement,event=f.key(undefined,{key:'Tab'});assert.equal(f.menu(),menu);assert.equal(f.document.activeElement,origin);assert.equal(origin.isConnected,true);assert.equal(event.defaultPrevented,undefined);
 menu.children[1].focus();assert.equal(f.menu(),menu,'native Tab within the menu keeps the menu present');
 const outside=new f.Element('button');f.document.body.append(outside);outside.focus();assert.equal(f.menu(),null);assert.equal(f.document.activeElement,outside);
});
test('playlist Escape yields to modal dialogs, composition, prior owners and unrelated UI',()=>{
 const f=fixture();f.add.onclick();const field=new f.Element('input');f.dialog.append(field);f.dialog.showModal();field.focus();
 assert.equal(f.key().defaultPrevented,undefined);assert.equal(f.document.body.className.includes('playlist-picking'),true);
 f.dialog.close();for(const patch of [{isComposing:true},{keyCode:229},{defaultPrevented:true}])f.key(f.canvas,patch);
 assert.equal(f.document.body.className.includes('playlist-picking'),true);
 const unrelated=new f.Element('button');f.document.body.append(unrelated);unrelated.focus();assert.equal(f.key().defaultPrevented,undefined);
 const event=f.key(f.canvas);assert(event.defaultPrevented);assert.equal(f.document.body.className.includes('playlist-picking'),false);assert.equal(f.document.activeElement,f.add);
});
test('playlist menu Escape closes only the menu before picking mode or preview',async()=>{
 const f=fixture();f.window.CanvasPlaylist.open('p',false,f.output);await Promise.resolve();f.add.onclick();f.output.onclick();f.key();
 assert.equal(f.menu(),null);assert.ok(f.preview());assert.equal(f.document.body.className.includes('playlist-picking'),true);
 f.key(f.canvas);assert.ok(f.preview());f.key(f.canvas);assert.equal(f.preview(),null);assert.equal(f.document.activeElement,f.output);
});
test('cancelled export cannot create a node when late media conversion finishes',async()=>{
 const f=fixture();let finish,signalConversion;let conversions=0;const converting=new Promise(resolve=>signalConversion=resolve);
 f.window.LocalMedia.asDataUrl=async()=>++conversions===1?'data:video/mp4;base64,AA':new Promise(resolve=>{finish=resolve;signalConversion();});
 const task=f.window.CanvasPlaylist.exportMerged('p',true);
 await converting;assert.equal(typeof finish,'function');
 const progress=f.document.body.querySelector('.playlist-export-progress');progress.querySelector('button').onclick();finish('data:video/mp4;base64,BB');await task;
 assert.equal(f.created.length,0);assert.equal(progress.isConnected,false);assert.deepEqual(f.notifications,[]);
});
test('seek failures notify only a live preview and closed previews ignore late resolution',async()=>{
 const f=fixture();f.window.LocalAssets.url=async()=>{throw Error('asset missing');};f.window.CanvasPlaylist.open('p',false);await f.window.CanvasPlaylist.seek(1);assert.deepEqual(f.notifications,['asset missing']);
 let reject;f.window.LocalAssets.url=()=>new Promise((resolve,fail)=>reject=fail);const seek=f.window.CanvasPlaylist.seek(1);f.window.CanvasPlaylist.close();reject(Error('late failure'));await seek;assert.deepEqual(f.notifications,['asset missing']);
});
test('node search keeps its query during duplicate open and composition or prior ownership',()=>{
 const f=fixture('search');f.window.CanvasSearchUI.open();const input=f.dialog.querySelector('input');input.value='草稿';input.oninput();f.window.CanvasSearchUI.open();assert.equal(input.value,'草稿');
 for(const patch of [{isComposing:true},{keyCode:229},{defaultPrevented:true}]){f.key(input,patch);f.key(input,{key:'Enter',...patch});}assert.equal(f.dialog.open,true);assert.equal(input.value,'草稿');assert.deepEqual(f.focusedNodes,[]);
 f.dialog.emit('compositionstart');f.key(input);const cancel={preventDefault(){this.defaultPrevented=true;}};f.dialog.emit('cancel',cancel);assert(cancel.defaultPrevented);assert.equal(input.value,'草稿');
 f.dialog.emit('compositionend');f.key(input);assert.equal(input.value,'');assert.equal(f.dialog.open,true);f.key(input);assert.equal(f.dialog.open,false);
});
test('node search navigation and native cancel retain clear-first Escape behavior',()=>{
 const f=fixture('search');f.search.focus();f.window.CanvasSearchUI.open();const input=f.dialog.querySelector('input');
 const event=f.key(input,{key:'Enter'});assert(event.defaultPrevented);assert.equal(f.dialog.open,false);assert.equal(f.focusedNodes.length,1);
 f.window.CanvasSearchUI.open();input.value='草稿';input.oninput();const cancel=()=>({preventDefault(){this.defaultPrevented=true;}});
 f.dialog.emit('cancel',cancel());assert.equal(input.value,'');assert.equal(f.dialog.open,true);f.dialog.emit('cancel',cancel());assert.equal(f.dialog.open,false);assert.equal(f.document.activeElement,f.search);
});
