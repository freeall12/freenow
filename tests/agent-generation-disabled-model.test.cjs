const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {createRequire}=require('node:module');
const fabricRequire=createRequire(require.resolve('fabric'));
const canvasPath=fabricRequire.resolve('canvas'),previousCanvas=require.cache[canvasPath];
require.cache[canvasPath]={id:canvasPath,loaded:true,exports:{createCanvas:undefined}};
const {JSDOM}=fabricRequire('jsdom');
if(previousCanvas)require.cache[canvasPath]=previousCanvas;else delete require.cache[canvasPath];

let icons,lock;
test.before(async()=>{({icons}=await import('../src/features/agent-generation/icons.mjs'));({lock}=await import('../src/features/agent-composer/model-icons.mjs'));});
function fixture({model=true,selected='ready'}={}){
 const dom=new JSDOM('<button id="trigger">模型</button><button id="outside">外部</button>',{pretendToBeVisual:true,runScripts:'outside-only'}),{window}=dom;
 window.HTMLElement.prototype.scrollIntoView=function(){};
 const context=dom.getInternalVMContext();context.icons=icons;context.lock=lock;
 vm.runInContext(fs.readFileSync(require.resolve('../src/features/agent-generation/menu.mjs'),'utf8').replace(/^import[^\n]*\n/gm,'').replace(/^export /gm,''),context);
 const trigger=window.document.getElementById('trigger'),writes=[];
 const open=()=>window.openParameterMenu(trigger,{label:'模型',model,value:selected,options:[{value:'ready',label:'可用模型'},{value:'blocked',label:'禁用模型',disabled:true,reason:'不支持当前参考视频'},{value:'unknown',label:'无原因模型',disabled:true}],onSelect:value=>writes.push(value)});
 const control=open(),menu=window.document.querySelector('.agent-generation-menu'),rows=[...menu.querySelectorAll('button')],blocked=rows[1],reason=blocked.querySelector('.agent-generation-model-reason'),mark=blocked.querySelector('.agent-generation-menu-lock');
 return {window,trigger,open,control,menu,rows,blocked,reason,mark,writes,close:()=>dom.window.close()};
}
function event(f,target,type){target.dispatchEvent(new f.window.Event(type,{bubbles:false}));}
test('disabled model hover reveals official reason overlay and restores its lock on leave',()=>{
 const f=fixture();try{
  assert.equal(f.blocked.getAttribute('aria-label'),'禁用模型: 不支持当前参考视频');assert.equal(f.blocked.title,'');assert.equal(f.reason.hidden,true);assert.equal(f.mark.hidden,false);
  event(f,f.blocked,'mouseenter');assert.equal(f.reason.hidden,false);assert.equal(f.mark.hidden,true);assert.equal(f.reason.textContent.trim(),'不支持当前参考视频');assert.equal(f.reason.querySelector('svg').getAttribute('aria-hidden'),'true');
  event(f,f.blocked,'mouseleave');assert.equal(f.reason.hidden,true);assert.equal(f.mark.hidden,false);assert.equal(f.menu.isConnected,true);
 }finally{f.close();}
});
test('keyboard focus reveals reason, blur and moving to another model clear it',()=>{
 const f=fixture();try{
  f.rows[0].dispatchEvent(new f.window.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}));assert.equal(f.window.document.activeElement,f.blocked);assert.equal(f.reason.hidden,false);
  f.blocked.dispatchEvent(new f.window.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}));assert.equal(f.window.document.activeElement,f.rows[2]);assert.equal(f.reason.hidden,true);assert.equal(f.mark.hidden,false);
  f.blocked.focus();event(f,f.blocked,'mouseenter');event(f,f.blocked,'mouseleave');assert.equal(f.reason.hidden,true);f.rows[0].focus();f.blocked.focus();assert.equal(f.reason.hidden,false);
 }finally{f.close();}
});
test('disabled rows remain selectable for explanation but do not apply model or close menu',()=>{
 const f=fixture({selected:'blocked'});try{
  assert.equal(f.reason.hidden,false);assert.equal(f.blocked.getAttribute('aria-checked'),'true');f.blocked.click();assert.equal(f.writes.length,0);assert.equal(f.menu.isConnected,true);
  f.rows[0].click();assert.deepEqual(f.writes,['ready']);assert.equal(f.menu.isConnected,false);assert.equal(f.trigger.getAttribute('aria-expanded'),'false');assert.equal(f.reason.hidden,true);
 }finally{f.close();}
});
test('Escape, outside dismissal, and disposal clear overlay without allowing late hover to revive it',()=>{
 for(const kind of ['Escape','outside','dispose']){const f=fixture();try{
  f.blocked.focus();assert.equal(f.reason.hidden,false);
  if(kind==='Escape')f.blocked.dispatchEvent(new f.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
  if(kind==='outside')f.window.document.getElementById('outside').dispatchEvent(new f.window.Event('pointerdown',{bubbles:true}));
  if(kind==='dispose')f.control.close();
  assert.equal(f.menu.isConnected,false);assert.equal(f.reason.hidden,true);event(f,f.blocked,'mouseenter');event(f,f.blocked,'focus');assert.equal(f.reason.hidden,true);assert.equal(f.writes.length,0);
  f.open();assert.equal(f.window.document.querySelectorAll('.agent-generation-menu').length,1);assert.equal(f.window.document.querySelector('.agent-generation-model-reason').hidden,true);
 }finally{f.close();}}
});
test('compact parameters retain their reason tooltip and do not acquire model overlays',()=>{
 const f=fixture({model:false});try{assert.equal(f.reason,null);assert.equal(f.blocked.title,'不支持当前参考视频');assert.equal(f.rows[2].querySelector('.agent-generation-model-reason'),null);}finally{f.close();}
});
