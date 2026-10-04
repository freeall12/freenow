const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {createRequire}=require('node:module'),fabricRequire=createRequire(require.resolve('fabric'));
const canvasPath=fabricRequire.resolve('canvas'),previousCanvas=require.cache[canvasPath];require.cache[canvasPath]={id:canvasPath,loaded:true,exports:{createCanvas:undefined}};
const {JSDOM}=fabricRequire('jsdom');if(previousCanvas)require.cache[canvasPath]=previousCanvas;else delete require.cache[canvasPath];
let icons,lock;test.before(async()=>{({icons}=await import('../src/features/agent-generation/icons.mjs'));({lock}=await import('../src/features/agent-composer/model-icons.mjs'));});
function fixture({audio=false,model=false}={}){
 const dom=new JSDOM('<button id="trigger">时长</button><button id="outside">外部</button>',{pretendToBeVisual:true,runScripts:'outside-only'}),{window}=dom,context=dom.getInternalVMContext();
 window.HTMLElement.prototype.scrollIntoView=function(){};context.icons=icons;context.lock=lock;
 vm.runInContext(fs.readFileSync(require.resolve('../src/features/agent-generation/menu.mjs'),'utf8').replace(/^import[^\n]*\n/gm,'').replace(/^export /gm,''),context);
 const trigger=window.document.getElementById('trigger'),writes=[];let closes=0;
 const open=()=>window.openParameterMenu(trigger,{label:model?'模型':'时长',duration:!model,model,value:audio?30:5,numericSpec:audio?{min:3,max:300,step:1}:null,options:(audio?[null,30,60]:[4,5,6,7,8,9,10,11,12,13,14,15]).map(value=>({value,label:String(value)})),onSelect:value=>writes.push(value),onClose:()=>closes++});
 const control=open(),menu=window.document.querySelector('.agent-generation-menu'),input=menu.querySelector('input');
 return {window,trigger,writes,open,control,menu,input,get closes(){return closes;},close:()=>window.close()};
}
function key(f,target,value){const event=new f.window.KeyboardEvent('keydown',{key:value,bubbles:true,cancelable:true});target.dispatchEvent(event);return event;}
function input(f,value){f.input.focus();f.input.value=value;f.input.dispatchEvent(new f.window.Event('input',{bubbles:true}));}
test('integer duration first Escape cancels pending input, blurs it and preserves keyboard ownership',()=>{
 const f=fixture();try{
  let blurs=0;f.input.addEventListener('blur',()=>blurs++);input(f,'19');assert.equal(f.writes.length,0);
  const first=key(f,f.input,'Escape');assert.equal(first.defaultPrevented,true);assert.equal(blurs,1);assert.equal(f.input.value,'5');assert.deepEqual(f.writes,[]);assert.equal(f.closes,0);assert.equal(f.menu.isConnected,true);assert.equal(f.window.document.activeElement,f.menu);assert.equal(f.trigger.getAttribute('aria-expanded'),'true');
  key(f,f.window.document.activeElement,'Escape');assert.equal(f.closes,1);assert.equal(f.menu.isConnected,false);assert.equal(f.window.document.activeElement,f.trigger);assert.deepEqual(f.writes,[]);
 }finally{f.close();}
});
test('Enter still commits nearest valid integer and input Escape does not recommit it',()=>{
 const f=fixture();try{
  input(f,'19');key(f,f.input,'Enter');assert.deepEqual(f.writes,[15]);assert.equal(f.input.value,'15');assert.equal(f.window.document.activeElement,f.input);assert.equal(f.menu.isConnected,true);
  key(f,f.input,'Escape');assert.deepEqual(f.writes,[15]);assert.equal(f.window.document.activeElement,f.menu);key(f,f.menu,'Escape');assert.equal(f.menu.isConnected,false);
 }finally{f.close();}
});
test('already accepted live duration remains accepted without a second callback on input Escape',()=>{
 const f=fixture();try{input(f,'12');assert.deepEqual(f.writes,[12]);key(f,f.input,'Escape');assert.equal(f.input.value,'12');assert.deepEqual(f.writes,[12]);assert.equal(f.menu.isConnected,true);}finally{f.close();}
});
test('outside after cancelling input closes the popover and reopening retains a fresh owner',()=>{
 const f=fixture();try{
  input(f,'19');key(f,f.input,'Escape');f.window.document.getElementById('outside').dispatchEvent(new f.window.Event('pointerdown',{bubbles:true}));assert.equal(f.menu.isConnected,false);assert.equal(f.closes,1);assert.deepEqual(f.writes,[]);
  const next=f.open(),reopened=f.window.document.querySelector('.agent-generation-menu'),owner=f.window.document.activeElement;key(f,f.input,'Escape');assert.equal(f.window.document.activeElement,owner);assert.equal(reopened.isConnected,true);next.close();
 }finally{f.close();}
});
test('ordinary blur still commits and numericSpec audio Escape retains its existing close semantics',()=>{
 const f=fixture();try{input(f,'19');f.menu.querySelector('button').focus();assert.deepEqual(f.writes,[15]);assert.equal(f.menu.isConnected,true);}finally{f.close();}
 const audio=fixture({audio:true});try{input(audio,'47');key(audio,audio.input,'Escape');assert.equal(audio.menu.isConnected,false);assert.equal(audio.window.document.activeElement,audio.trigger);assert.equal(audio.input.value,'30');assert.deepEqual(audio.writes,[]);}finally{audio.close();}
});
test('non-duration model menu keeps its existing single Escape dismissal',()=>{
 const f=fixture({model:true});try{key(f,f.window.document.activeElement,'Escape');assert.equal(f.menu.isConnected,false);assert.equal(f.window.document.activeElement,f.trigger);assert.equal(f.closes,1);}finally{f.close();}
});
test('audio Escape suppresses blur from removal and native trigger focus before removal',()=>{
 for(const order of ['blur-before-remove','focus-before-remove']){const f=fixture({audio:true});try{
  let blurs=0;f.input.addEventListener('blur',()=>blurs++);const remove=f.menu.remove.bind(f.menu);
  f.menu.remove=()=>{if(order==='blur-before-remove')f.input.blur();else f.trigger.focus();remove();};
  input(f,'47');key(f,f.input,'Escape');assert.equal(blurs,1,order);assert.deepEqual(f.writes,[],order);assert.equal(f.input.value,'30');assert.equal(f.menu.isConnected,false);assert.equal(f.window.document.activeElement,f.trigger);
 }finally{f.close();}}
});
test('audio Escape suppresses post-removal blur delivered during and after restoring trigger focus',()=>{
 for(const order of ['during-focus-return','after-focus-return']){const f=fixture({audio:true});try{
  let blurs=0;f.input.addEventListener('blur',()=>blurs++);const focus=f.trigger.focus.bind(f.trigger);
  const deliver=()=>f.input.dispatchEvent(new f.window.FocusEvent('blur',{relatedTarget:f.trigger}));
  if(order==='during-focus-return')f.trigger.focus=(...args)=>{assert.equal(f.menu.isConnected,false);deliver();focus(...args);};
  input(f,'47');key(f,f.input,'Escape');if(order==='after-focus-return')deliver();
  assert.equal(blurs,1,order);assert.deepEqual(f.writes,[],order);assert.equal(f.menu.isConnected,false);assert.equal(f.window.document.activeElement,f.trigger);
 }finally{f.close();}}
});
test('integer cancellation suppresses a late blur but refocusing begins a normally committing edit',()=>{
 const f=fixture();try{
  input(f,'19');key(f,f.input,'Escape');f.input.dispatchEvent(new f.window.FocusEvent('blur',{relatedTarget:f.menu}));assert.deepEqual(f.writes,[]);assert.equal(f.menu.isConnected,true);
  input(f,'19');f.menu.querySelector('button').focus();assert.deepEqual(f.writes,[15]);assert.equal(f.menu.isConnected,true);
 }finally{f.close();}
});
