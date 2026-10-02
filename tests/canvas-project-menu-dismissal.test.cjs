'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync(require.resolve('../src/features/canvas-projects/ui.js'),'utf8');
function fixture({load,switchTo}={}) {
  const listeners=new Map();
  const document={activeElement:null,addEventListener(type,fn){const handlers=listeners.get(type)||[];handlers.push(fn);listeners.set(type,handlers);}};
  class Element {
    constructor(tag){this.tagName=tag;this.children=[];this.dataset={};this.style={};this.attributes={};this.events=new Map();this.classList={add(){}};this.value='';this.hidden=false;}
    append(...items){for(const item of items){item.parent=this;this.children.push(item);}}
    replaceChildren(){this.children=[];}
    contains(target){return target===this||this.children.some(child=>child.contains(target));}
    setAttribute(name,value){this.attributes[name]=value;}
    addEventListener(type,fn){this.events.set(type,fn);}
    closest(){return {getBoundingClientRect:()=>({left:16,bottom:52})};}
    focus(){document.activeElement=this;for(const fn of listeners.get('focusin')||[])fn({target:this});}
  }
  const title=new Element('button');document.body=new Element('body');document.createElement=tag=>new Element(tag);document.querySelector=selector=>selector==='#project-title'?title:null;
  const projects={id:()=> 'current',current:()=>({title:'Current'}),switchTo:switchTo||(async()=>{})};
  const window={CanvasProjects:projects,CANVAS_PROJECT_ICONS:{search:'',plus:'',check:''},CanvasStore:{listProjects:load||(async()=>[{id:'current',title:'Current'},{id:'other',title:'Other'}])},addEventListener(){}};
  vm.runInNewContext(source,{window,document,innerWidth:1000,innerHeight:800});
  const panel=document.body.children[0],search=panel.children[0].children[0],list=panel.children[1],create=panel.children[3].children[0];
  const key=extra=>{const event={key:'Escape',target:search,preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.stopped=true;},...extra};panel.events.get('keydown')(event);return event;};
  return {window,document,title,panel,search,list,create,key,Element};
}
test('keyboard focus leaving project list dismisses without stealing destination focus',async()=>{
  const f=fixture();await f.window.CanvasProjectsUI.open();const destination=new f.Element('button');destination.focus();
  assert.equal(f.panel.hidden,true);assert.equal(f.document.activeElement,destination);assert.equal(f.title.attributes['aria-expanded'],'false');
});
test('Escape consumes only the project layer and respects composition and prior owners',async()=>{
  const f=fixture();await f.window.CanvasProjectsUI.open();f.key({isComposing:true});assert.equal(f.panel.hidden,false);f.key({keyCode:229});assert.equal(f.panel.hidden,false);f.key({defaultPrevented:true});assert.equal(f.panel.hidden,false);
  const event=f.key();assert.equal(event.stopped,true);assert.equal(f.panel.hidden,true);assert.equal(f.document.activeElement,f.title);
});
test('failed project navigation retains error, restores row focus and unlocks creation',async()=>{
  let reject;const f=fixture({switchTo:()=>new Promise((_,fail)=>reject=fail)});await f.window.CanvasProjectsUI.open();
  const action=f.list.children[1].onclick();assert.equal(f.create.disabled,true);assert.equal(f.document.activeElement,f.panel);reject(Error('save failed'));await action;
  assert.equal(f.panel.hidden,false);assert.equal(f.create.disabled,false);assert.equal(f.document.activeElement.dataset.projectId,'other');assert.equal(f.panel.children[2].textContent,'save failed');
});
test('late list read cannot reopen a panel dismissed by keyboard focus',async()=>{
  let finish;const f=fixture({load:()=>new Promise(resolve=>finish=resolve)}),opening=f.window.CanvasProjectsUI.open();const destination=new f.Element('button');destination.focus();finish([{id:'other',title:'Other'}]);await opening;
  assert.equal(f.panel.hidden,true);assert.equal(f.list.children.length,0);assert.equal(f.document.activeElement,destination);
});
test('canvas Escape retains node and connection selection while a modal owns interaction',()=>{
  const app=fs.readFileSync(require.resolve('../app.js'),'utf8'),start=app.indexOf("  document.addEventListener('keydown',e=>{",app.indexOf("let canvasKeyboardScope='external'")),end=app.indexOf("    if(e.code==='Space')",start);
  let handler,modal=true,changes=0;
  const document={body:{classList:{contains:()=>false}},addEventListener:(_,fn)=>handler=fn};
  const context={document,window:{CanvasClipboard:{isComposing:()=>false,eventTarget:event=>event.target,keyboardScope:()=> 'canvas'},CanvasConnections:{cancel:()=>changes++,clearSelection:()=>changes++}},canvas:{},canvasKeyboardScope:'canvas',selected:{clear:()=>changes++},closeMenu:()=>changes++,render:()=>changes++,$$:()=>modal?[{}]:[]};
  vm.runInNewContext(app.slice(start,end)+'});',context);
  const event={key:'Escape',target:{closest:()=>null}};handler(event);assert.equal(changes,0);modal=false;handler(event);assert.equal(changes,5);
});
