const test=require('node:test'),assert=require('node:assert/strict');
const modules=Promise.all([import('three'),import('../src/features/studio-v2/runtime.mjs'),import('../src/features/studio-v2/model-io.mjs'),import('../src/features/studio-v2/playback.mjs'),import('../src/features/studio-v2/motion-editor.mjs'),import('../src/features/studio-v2/camera-presentations.mjs'),import('../src/features/studio-v2/display-materials.mjs')]);

async function fixture(t,{empty=false}={}){
  const [THREE,{SceneRuntime},io,{ScenePlayback},{MotionEditor},{CameraPresentations},{DisplayMaterials}]=await modules;
  const prior={window:global.window,FileReader:global.FileReader,ProgressEvent:global.ProgressEvent};
  global.FileReader=class {readAsArrayBuffer(blob){blob.arrayBuffer().then(value=>{this.result=value;this.onloadend?.();});}};
  global.ProgressEvent=class extends Event {constructor(type,fields){super(type);Object.assign(this,fields);}};
  const assets=new Map(),urls=[],source=new THREE.Scene(),camera=new THREE.PerspectiveCamera(50,16/9,.01,1000),cube=io.primitive('cube','saved cube');
  camera.name='saved camera';camera.userData.studioId='camera';cube.userData.studioId='cube';source.add(cube,camera);
  const clip=new THREE.AnimationClip('saved motion',2,[new THREE.VectorKeyframeTrack(camera.uuid+'.position',[0,2],[0,1,3,2,1,3])]);
  let puts=0,writeError=null,readHook=()=>{},assetHook=()=>{},readError=false,contextId='canvas',storeLoads=0;
  const local={async put(blob){const id='asset:test-'+(++puts),url=URL.createObjectURL(blob);assets.set(id,url);urls.push(url);return id;},async url(id){await assetHook();if(!assets.has(id))throw Error('missing asset');return assets.get(id);}};
  const asset=empty?null:await local.put(await io.exportGlb(source,[clip]));
  const saved={version:2,...asset?{asset}:{},grid:false,lighting:{azimuth:120,elevation:20},shotId:empty?null:'camera',motionIndex:empty?-1:0,shotRatios:empty?{}:{camera:{width:9,height:16}},viewer:{position:[4,3,9],quaternion:[0,0,0,1]}};
  const node={id:'studio',type:'studio',studioV2:structuredClone(saved)},other={id:'other',type:'text',text:'local'},nodes=[node,other];
  let committed={nodes:structuredClone(nodes),project:{id:'canvas'},storageRevision:1},expectedRevision=1;
  const store={async load(){storeLoads++;expectedRevision=committed.storageRevision;return structuredClone(committed);},async flush(){}};
  const app={getState:()=>({nodes}),updateNode(id,patch){Object.assign(nodes.find(value=>value.id===id),patch);},async saveProject(){if(writeError)throw writeError;if(expectedRevision!==committed.storageRevision)throw Object.assign(Error('another window updated'),{name:'CanvasProjectConflictError'});committed={nodes:structuredClone(nodes),project:{id:'canvas'},storageRevision:++expectedRevision};}};
  const idb={open(name){assert.equal(name,'tapnow-canvas-replica');const request={};queueMicrotask(()=>{request.result={close(){},transaction(storeName){assert.equal(storeName,'documents');const tx={objectStore(){return {get(key){assert.equal(key,'canvas');const read={};queueMicrotask(async()=>{await readHook();if(readError){tx.error=Error('read failed');tx.onabort?.();return;}read.result=structuredClone(committed);read.onsuccess?.();tx.oncomplete?.();});return read;}};},abort(){tx.onabort?.();}};return tx;}};request.onsuccess?.();});return request;}};
  global.window={CanvasApp:app,CanvasStore:store,LocalAssets:local,CanvasProjects:{id:()=>contextId},indexedDB:idb};
  const content=new THREE.Scene(),runtime=Object.assign(Object.create(SceneRuntime.prototype),{nodeId:'studio',hostNode:node,projectId:'canvas',projectApp:app,projectStore:store,assetStore:local,projectDatabase:'tapnow-canvas-replica',reloading:false,closed:false,saved:structuredClone(saved),loadStatus:'ready',revision:0,savedRevision:0,content,scene:new THREE.Scene(),camera:new THREE.PerspectiveCamera(),animations:[],undoStack:[],redoStack:[],selected:null,mode:'translate',grid:{visible:true},lighting:{azimuth:0,elevation:0},shotId:saved.shotId,motionIndex:saved.motionIndex,shotRatios:structuredClone(saved.shotRatios),transform:{dragging:false,detach(){},attach(){},setMode(){}},centeredTransform:{detach(){},attach(){}},box:{visible:false,setFromObject(){}},controls:{enabled:true,speed:1,reset(){}},onChange:()=>{},onError:()=>{}});
  runtime.scene.add(content);runtime.playback=new ScenePlayback(runtime);runtime.motion=new MotionEditor(runtime);runtime.cameraPresentations=new CameraPresentations(runtime);runtime.displayMaterials=new DisplayMaterials();await runtime.initialize();
  const edit=()=>{if(runtime.find('cube'))runtime.update('cube',{position:[8,.5,0]});else runtime.setGrid(true);clearTimeout(runtime.saveTimer);};
  t.after(()=>{clearTimeout(runtime.saveTimer);runtime.playback.stop();runtime.motion.dispose();runtime.cameraPresentations.dispose();runtime.displayMaterials.dispose();io.disposeModel(runtime.content);io.disposeModel(source);urls.forEach(url=>URL.revokeObjectURL(url));Object.assign(global,prior);});
  return {runtime,node,other,saved,edit,THREE,io,failWrite:error=>writeError=error,readHook:hook=>readHook=hook,assetHook:hook=>assetHook=hook,failRead:value=>readError=value,setProject:id=>contextId=id,loads:()=>storeLoads,committed:()=>committed,externalUpdate(){committed.nodes.find(n=>n.id==='other').text='external';committed.storageRevision++;}};
}

test('failed persistence does not advance the confirmed saved baseline; discard reloads real GLB, motion and settings and releases the old editor resources',async t=>{
  const f=await fixture(t),rt=f.runtime;rt.motion.start(0,'camera');rt.motion.select(1);f.edit();
  const old=rt.content,cube=rt.find('cube'),texture=new f.THREE.Texture();rt.cameraPresentations.update();
  const resources=[cube.geometry,cube.material,texture,...rt.motion.overlay.children.flatMap(o=>[o.geometry,o.material])],counts=new Map(resources.map(r=>[r,0]));for(const r of resources)r.addEventListener('dispose',()=>counts.set(r,counts.get(r)+1));
  f.failWrite(Error('quota'));await assert.rejects(()=>rt.flush(),/quota/);assert.deepEqual(rt.saved,f.saved);assert.notEqual(f.node.studioV2.asset,f.saved.asset);assert.equal(rt.find('cube').position.x,8);cube.material.map=texture;
  f.failWrite(null);await rt.discardEditsAndReload();assert.notEqual(rt.content,old);assert.equal(rt.find('cube').position.x,0);assert.equal(rt.animations.length,1);assert.equal(rt.shotId,'camera');assert.equal(rt.motionIndex,0);assert.equal(rt.playback.playing,false);assert.equal(rt.playback.time,0);
  assert.deepEqual(rt.camera.position.toArray(),[4,3,9]);assert.deepEqual(rt.lighting,f.saved.lighting);assert.deepEqual(rt.shotRatios,f.saved.shotRatios);assert.equal(rt.grid.visible,false);assert.equal(rt.selected,null);assert.equal(rt.motion.open,false);assert.equal(rt.motion.cameraId,null);assert.deepEqual(rt.undoStack,[]);assert.deepEqual(rt.redoStack,[]);assert.equal(rt.saveError,null);assert.equal(rt.revision,rt.savedRevision);assert.equal(rt.controls.enabled,true);assert.equal(f.loads(),0);for(const count of counts.values())assert.equal(count,1);
});

test('discard handles a durable empty scene without retaining temporary objects',async t=>{
  const f=await fixture(t,{empty:true}),rt=f.runtime;const cube=f.io.primitive('cube','temporary');cube.userData.studioId='temporary';rt.content.add(cube);rt.animations=[];f.edit();await rt.discardEditsAndReload();assert.equal(rt.content.children.length,0);assert.equal(rt.animations.length,0);assert.equal(rt.shotId,null);assert.equal(rt.motionIndex,-1);assert.equal(rt.grid.visible,false);
});

test('read or asset failure preserves the edited document, selection and history and allows a later retry',async t=>{
  const f=await fixture(t),rt=f.runtime;f.edit();rt.select('cube');const content=rt.content,history=rt.undoStack,selected=rt.selected;f.failRead(true);await assert.rejects(()=>rt.discardEditsAndReload(),/read failed/);assert.equal(rt.content,content);assert.equal(rt.undoStack,history);assert.equal(rt.selected,selected);assert.equal(rt.find('cube').position.x,8);assert.equal(rt.reloading,false);
  f.failRead(false);f.assetHook(()=>{throw Error('asset failed');});await assert.rejects(()=>rt.discardEditsAndReload(),/asset failed/);assert.equal(rt.content,content);assert.equal(rt.selected,selected);assert.equal(rt.undoStack,history);f.assetHook(()=>{});await rt.discardEditsAndReload();assert.equal(rt.find('cube').position.x,0);
});

test('in-flight saving or adjustment rejects discard before reading or clearing edits',async t=>{
  const f=await fixture(t),rt=f.runtime;f.edit();const content=rt.content;rt.saving=Promise.resolve();await assert.rejects(()=>rt.discardEditsAndReload(),/正在保存/);rt.saving=null;rt.transform.dragging=true;await assert.rejects(()=>rt.discardEditsAndReload(),/结束当前调整/);rt.transform.dragging=false;assert.equal(rt.content,content);assert.equal(rt.find('cube').position.x,8);assert.ok(rt.undoStack.length);
});

test('reload blocks edits and closing while staging, then rechecks project identity and node identity',async t=>{
  const prior={window:global.window,FileReader:global.FileReader,ProgressEvent:global.ProgressEvent};
  for(const change of ['project','node']){
    const f=await fixture(t),rt=f.runtime;f.edit();const content=rt.content;
    f.readHook(async()=>{assert.equal(rt.transform.enabled,false);await assert.rejects(()=>rt.close(),/重新加载/);assert.throws(()=>rt.assertReady(),/重新加载/);assert.throws(()=>rt.commit(),/重新加载/);assert.throws(()=>rt.select(null),/重新加载/);if(change==='project')f.setProject('other-project');else window.CanvasApp.getState().nodes[0]={...f.node};});
    await assert.rejects(()=>rt.discardEditsAndReload(),/上下文已变化|目标片场节点/);assert.equal(rt.content,content);assert.equal(rt.find('cube').position.x,8);assert.equal(rt.reloading,false);
  }
  t.after(()=>Object.assign(global,prior));
});

test('failed host restoration preserves recoverable edits and reverts only the live node field',async t=>{
  const f=await fixture(t),rt=f.runtime;f.edit();f.failWrite(Error('quota'));await assert.rejects(()=>rt.flush(),/quota/);const candidate=f.node.studioV2,content=rt.content,history=rt.undoStack;
  await assert.rejects(()=>rt.discardEditsAndReload(),/quota/);assert.equal(rt.content,content);assert.equal(rt.undoStack,history);assert.equal(rt.find('cube').position.x,8);assert.equal(f.node.studioV2,candidate);assert.ok(rt.saveError);assert.equal(rt.savedRevision,0);
});

test('a scoped reload never advances CanvasStore CAS or overwrites another window changes',async t=>{
  const f=await fixture(t),rt=f.runtime;f.edit();f.failWrite(Error('quota'));await assert.rejects(()=>rt.flush(),/quota/);f.failWrite(null);f.externalUpdate();
  await assert.rejects(()=>rt.discardEditsAndReload(),{name:'CanvasProjectConflictError'});assert.equal(f.loads(),0);assert.equal(f.committed().nodes.find(n=>n.id==='other').text,'external');assert.equal(f.other.text,'local');assert.equal(rt.find('cube').position.x,8);assert.ok(rt.saveError);
});

test('successful retry updates the confirmed baseline used by subsequent editing',async t=>{
  const f=await fixture(t),rt=f.runtime;f.edit();f.failWrite(Error('quota'));await assert.rejects(()=>rt.flush(),/quota/);f.failWrite(null);await rt.flush();const saved=structuredClone(rt.saved);rt.update('cube',{position:[9,.5,0]});clearTimeout(rt.saveTimer);await rt.discardEditsAndReload();assert.equal(rt.find('cube').position.x,8);assert.deepEqual(rt.saved,saved);assert.equal(rt.saveError,null);
});


test('malformed saved metadata fails before replacing the live tree or discarding history',async t=>{
  for(const corrupt of [saved=>saved.viewer.position=null,saved=>saved.viewer.quaternion=[0,0,0,0],saved=>saved.grid='yes',saved=>saved.lighting={azimuth:Infinity,elevation:10},saved=>saved.shotRatios={camera:{width:0,height:9}},saved=>saved.motionIndex='0']){
    await t.test('keeps recoverable edits',async sub=>{
      const f=await fixture(sub),rt=f.runtime;f.edit();const content=rt.content,history=rt.undoStack,node=f.node.studioV2;corrupt(f.committed().nodes[0].studioV2);
      await assert.rejects(()=>rt.discardEditsAndReload());assert.equal(rt.content,content);assert.equal(content.parent,rt.scene);assert.equal(rt.undoStack,history);assert.equal(f.node.studioV2,node);assert.equal(rt.find('cube').position.x,8);assert.equal(rt.reloading,false);
    });
  }
});
