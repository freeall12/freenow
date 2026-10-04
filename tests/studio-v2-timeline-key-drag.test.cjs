const test=require('node:test'),assert=require('node:assert/strict'),{createRequire}=require('node:module');
const fabricRequire=createRequire(require.resolve('fabric')),domRequire=createRequire(fabricRequire.resolve('jsdom'));
const canvasPath=domRequire.resolve('canvas'),priorCanvas=require.cache[canvasPath];
require.cache[canvasPath]={id:canvasPath,loaded:true,exports:{createCanvas:undefined}};
const {JSDOM}=fabricRequire('jsdom');
if(priorCanvas)require.cache[canvasPath]=priorCanvas;else delete require.cache[canvasPath];

async function fixture(t,{motion=false}={}){
  const [THREE,{SceneRuntime},{ScenePlayback},{MotionEditor},{propertyControls},{createMotionUI},{createNumberFieldModel}]=await Promise.all([
    import('three'),import('../src/features/studio-v2/runtime.mjs'),import('../src/features/studio-v2/playback.mjs'),import('../src/features/studio-v2/motion-editor.mjs'),
    import('../src/features/studio-v2/properties.mjs'),import('../src/features/studio-v2/motion-ui.mjs'),import('../src/features/studio-v2/qa/number-field-model.mjs')]);
  const dom=new JSDOM('<body><main></main><button id="outside">失焦</button></body>'),prior={document:global.document,window:global.window,AbortController:global.AbortController};
  Object.assign(global,{document:dom.window.document,window:dom.window,AbortController:dom.window.AbortController});t.after(()=>{dom.window.close();Object.assign(global,prior);});
  const model=createNumberFieldModel(),runtime=Object.assign(Object.create(SceneRuntime.prototype),{content:model.scene,scene:new THREE.Scene(),animations:model.animations,
    loadStatus:'ready',revision:0,savedRevision:0,undoStack:[],redoStack:[{sentinel:'keep'}],selected:model.cube,
    lighting:{azimuth:0,elevation:30},grid:{visible:true},shotId:model.camera.userData.studioId,motionIndex:0,shotRatios:{},
    transform:{detach(){},attach(){},setMode(){}},centeredTransform:{attach(){},detach(){}},box:{setFromObject(){},visible:false},
    commit(){this.revision++;this.onChange?.('scene');}});
  runtime.scene.add(runtime.content);runtime.playback=new ScenePlayback(runtime);runtime.motion=new MotionEditor(runtime);t.after(()=>runtime.motion.dispose());
  let ui,element;
  if(motion){runtime.motion.start(0,model.camera.userData.studioId);runtime.motion.select(0);runtime.undoStack=[];runtime.redoStack=[{sentinel:'keep'}];runtime.revision=0;
    ui=createMotionUI(runtime);element=ui.element;document.querySelector('main').append(element);ui.refresh();runtime.onChange=reason=>ui.refresh(reason);t.after(()=>ui.dispose());}
  else{element=propertyControls(runtime,model.cube);document.querySelector('main').append(element);}
  const input=label=>[...element.querySelectorAll('input')].find(input=>input.ariaLabel===label);
  const event=(target,type,options={})=>target.dispatchEvent(type==='keydown'?new dom.window.KeyboardEvent(type,{bubbles:true,...options}):new dom.window.Event(type,{bubbles:true,...options}));
  const type=(target,value)=>{target.focus();target.value=value;event(target,'input');};
  const raw=()=>motion?Array.from(runtime.motion.tracks[0].values):[...model.cube.position.toArray(),...model.cube.quaternion.toArray(),...model.cube.scale.toArray()];
  return {runtime,input,type,event,raw,outside:document.getElementById('outside'),model,dom};
}


function pointer(f,button,type,x,id=1){
  button['on'+type]?.({currentTarget:button,button:0,clientX:x,pointerId:id,preventDefault(){}});
}
function capture(button){let id=null;button.setPointerCapture=next=>{id=next;};button.hasPointerCapture=next=>id===next;button.releasePointerCapture=()=>{id=null;};return ()=>{id=null;};}
function key(){return document.querySelectorAll('button._key_1aeqb_62')[1];}
function width(button){button.parentElement.getBoundingClientRect=()=>({left:0,width:200});}

test('real motion UI previews only captured key, preserves selected inspector and commits one history on release',async t=>{
 const f=await fixture(t,{motion:true}),b=key();width(b);capture(b);
 const before=Array.from(f.runtime.motion.tracks[0].times);pointer(f,b,'pointerdown',100);
 assert.equal(f.runtime.motion.selected,1);pointer(f,b,'pointermove',150,2);assert.equal(f.runtime.playback.time,1);
 pointer(f,b,'pointermove',150);assert.equal(f.runtime.playback.time,1.5);assert.equal(f.runtime.motion.selected,1);
 assert.equal(b.style.left,'75%');assert.deepEqual(Array.from(f.runtime.motion.tracks[0].times),before);assert.equal(f.runtime.revision,0);
 pointer(f,b,'pointerup',150);assert.deepEqual(Array.from(f.runtime.motion.tracks[0].times),[0,1.5,2]);assert.equal(f.runtime.revision,1);assert.equal(f.runtime.undoStack.length,1);
});
for(const method of ['pointercancel','lostpointercapture','Escape'])test('real motion UI cancels '+method+' preview without committing or rewinding playback',async t=>{
 const f=await fixture(t,{motion:true}),b=key();width(b);capture(b);pointer(f,b,'pointerdown',100);pointer(f,b,'pointermove',150);
 if(method==='Escape')f.event(b,'keydown',{key:'Escape'});else pointer(f,b,method,150);
 assert.equal(b.hasPointerCapture(1),false);assert.equal(b.style.left,'50%');assert.equal(f.runtime.playback.time,1.5);pointer(f,b,'pointerup',150);
 assert.deepEqual(Array.from(f.runtime.motion.tracks[0].times),[0,1,2]);assert.equal(f.runtime.revision,0);assert.equal(f.runtime.undoStack.length,0);
});
test('real motion UI cannot commit after capture is lost without a loss event',async t=>{
 const f=await fixture(t,{motion:true}),b=key();width(b);const lose=capture(b);pointer(f,b,'pointerdown',100);lose();pointer(f,b,'pointermove',150);pointer(f,b,'pointerup',150);
 assert.equal(f.runtime.playback.time,1);assert.deepEqual(Array.from(f.runtime.motion.tracks[0].times),[0,1,2]);assert.equal(f.runtime.revision,0);
});
for(const change of ['clip','revision','content'])test('real motion UI rejects stale release after '+change+' identity changes',async t=>{
 const f=await fixture(t,{motion:true}),b=key();width(b);capture(b);pointer(f,b,'pointerdown',100);pointer(f,b,'pointermove',150);
 if(change==='clip')f.runtime.animations[0]=f.runtime.animations[0].clone();else if(change==='revision')f.runtime.revision++;else f.runtime.content=f.runtime.playback.document();
 const revision=f.runtime.revision;pointer(f,b,'pointerup',150);assert.equal(f.runtime.revision,revision);assert.deepEqual(Array.from(f.runtime.animations[0].tracks[0].times),[0,1,2]);assert.equal(f.runtime.undoStack.length,0);
});
test('real motion UI switches object preview back to camera playback before key drag',async t=>{
 const f=await fixture(t,{motion:true}),b=key();width(b);capture(b);f.runtime.playback.target='objects';pointer(f,b,'pointerdown',100);pointer(f,b,'pointermove',150);
 assert.equal(f.runtime.playback.target,'camera');assert.equal(f.runtime.playback.index,0);assert.equal(f.runtime.playback.time,1.5);assert.equal(f.runtime.motion.selected,1);
});
test('last key drag keeps official 7200-second bound beyond prior duration',async t=>{
 const f=await fixture(t,{motion:true}),b=document.querySelectorAll('button._key_1aeqb_62')[2];width(b);capture(b);pointer(f,b,'pointerdown',100);pointer(f,b,'pointermove',200);assert.equal(b.style.left,'150%');pointer(f,b,'pointerup',200);
 assert.deepEqual(Array.from(f.runtime.motion.tracks[0].times),[0,1,3]);assert.equal(f.runtime.motion.clip.duration,3);assert.equal(f.runtime.revision,1);
});

test('real UI rejects old release after switching between two same-name motion identities',async t=>{
 const f=await fixture(t,{motion:true});const second=f.runtime.animations[0].clone();second.name=f.runtime.animations[0].name='same name';for(let i=0;i<second.tracks[0].values.length;i+=3)second.tracks[0].values[i]+=10;f.runtime.animations.push(second);
 const b=key();width(b);capture(b);pointer(f,b,'pointerdown',100);pointer(f,b,'pointermove',150);
 f.runtime.motion.start(1,f.runtime.motion.cameraId);const revision=f.runtime.revision,undo=f.runtime.undoStack.length;
 pointer(f,b,'pointerup',150);assert.equal(f.runtime.motion.index,1);assert.equal(f.runtime.revision,revision);assert.equal(f.runtime.undoStack.length,undo);
 assert.deepEqual(f.runtime.animations.map(clip=>Array.from(clip.tracks[0].times)),[[0,1,2],[0,1,2]]);
 const next=key();width(next);capture(next);pointer(f,next,'pointerdown',100);pointer(f,next,'pointermove',140);pointer(f,b,'lostpointercapture',150);pointer(f,next,'pointerup',140);
 assert.deepEqual(Array.from(f.runtime.motion.tracks[0].times),[0,Math.fround(1.4),2]);assert.equal(f.runtime.undoStack.length,undo+1);
});
