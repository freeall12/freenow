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

test('motion key: edited axis A commits before axis B starts dragging without replacing the captured handle',async t=>{
  const f=await fixture(t,{motion:true}),inputA=f.input('位置 X'),inputB=f.input('位置 Y'),handle=inputB.previousElementSibling;
  const y=f.runtime.motion.pose(0).elements[13];let captured=false;
  handle.setPointerCapture=()=>{assert.equal(handle.isConnected,true,'the handle must survive sibling blur commit');captured=true;};
  f.type(inputA,'2.765432109');
  assert.doesNotThrow(()=>handle.onpointerdown({button:0,pointerId:1,clientX:0,preventDefault(){},stopPropagation(){}}));
  assert.equal(captured,true);assert.equal(document.activeElement,inputB);assert.equal(f.input('位置 Y'),inputB);
  assert.equal(f.runtime.revision,1);assert.equal(f.runtime.undoStack.length,1);assert.ok(Math.abs(f.runtime.motion.pose(0).elements[12]-2.765432109)<1e-6);
  handle.onpointermove({pointerId:1,clientX:10,shiftKey:false});handle.onpointerup();
  assert.ok(Math.abs(f.runtime.motion.pose(0).elements[13]-(y+.1))<1e-6);assert.ok(Math.abs(f.runtime.motion.pose(0).elements[12]-2.765432109)<1e-6);
  assert.equal(f.runtime.revision,2);assert.equal(f.runtime.undoStack.length,2);
});

for(const motion of [false,true]){
  const scope=motion?'motion key':'object';
  test(scope+': untouched blur and Escape then blur preserve exact authored data, history and focus',async t=>{
    const f=await fixture(t,{motion}),before=f.raw(),revision=f.runtime.revision,redo=f.runtime.redoStack[0];let escaped=0;
    document.querySelector('main').addEventListener('keydown',()=>escaped++);
    for(const label of ['位置 X',motion?'旋转 X':'旋转（°） X','缩放 X']){
      const input=f.input(label),display=input.value;input.focus();f.outside.focus();
      f.type(input,'987.654321');f.event(input,'keydown',{key:'Escape'});
      assert.equal(document.activeElement,input);assert.equal(input.value,display);f.outside.focus();
    }
    assert.deepEqual(f.raw(),before);assert.equal(f.runtime.revision,revision);assert.equal(f.runtime.undoStack.length,0);assert.equal(f.runtime.redoStack[0],redo);assert.equal(escaped,0);
  });
  test(scope+': Enter commits a real precise draft once, while blank, invalid and equal drafts do nothing',async t=>{
    const f=await fixture(t,{motion}),input=f.input('位置 X'),read=()=>motion?f.runtime.motion.pose(0).elements[12]:f.model.cube.position.x;
    const before=f.raw();for(const text of ['','not-a-number',String(read())]){f.type(input,text);f.outside.focus();}
    assert.deepEqual(f.raw(),before);assert.equal(f.runtime.revision,0);
    f.type(input,'2.765432109');f.event(input,'keydown',{key:'Enter'});
    assert.ok(Math.abs(read()-2.765432109)<(motion?1e-6:1e-12));assert.equal(f.runtime.revision,1);assert.equal(f.runtime.undoStack.length,1);assert.equal(f.runtime.redoStack.length,0);
    const after=f.raw(),next=f.input('位置 X');next.focus();f.outside.focus();assert.deepEqual(f.raw(),after);assert.equal(f.runtime.revision,1);
  });
  test(scope+': starting axis scrub discards typed draft and later blur cannot author the rounded display',async t=>{
    const f=await fixture(t,{motion}),input=f.input('位置 X'),handle=input.previousElementSibling,before=f.raw();
    handle.setPointerCapture=()=>{};handle.hasPointerCapture=()=>false;
    f.type(input,'999');handle.onpointerdown({button:0,pointerId:1,clientX:0,preventDefault(){},stopPropagation(){}});f.outside.focus();
    assert.deepEqual(f.raw(),before);assert.equal(f.runtime.revision,0);assert.equal(f.runtime.undoStack.length,0);
  });
}
