'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const modules=Promise.all([import('three'),import('../src/features/world-node/splat-contract.mjs'),import('../src/features/world-node/splat-io.mjs')]);
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
const turn=()=>new Promise(resolve=>setImmediate(resolve));
async function fixture({lodGate,sortGate}={}){
  const [THREE,contract,splat]=await modules,events=[],lodStarted=deferred(),sortStarted=deferred();
  class Spark extends THREE.Group{
    constructor(options){super();this.renderSize=new THREE.Vector2(1280,720);this.autoUpdate=options.autoUpdate;this.disposals=0;}
    async update({scene,camera}){events.push({stage:'sort',size:this.renderSize.toArray(),visible:scene.visible,mask:camera.layers.mask});sortStarted.resolve();await sortGate?.promise;}
    dispose(){this.disposals++;}
  }
  const sandbox={THREE,Promise,Map,Set,AbortController,DOMException,Error,JSON,Number,splatObjects:splat.splatObjects,splatLimits:contract.splatLimits,splatAxisScale:splat.splatAxisScale,
    splatLodPolicy:{targetSplats:250000,minPixelSize:2},loadSpark:async()=>({SparkRenderer:Spark}),readLocalSplat:async()=>new Blob(['explicit source boundary']),
    decodeSplat:async()=>{const mesh=new THREE.Group();mesh.dispose=()=>{};return {mesh,header:{count:1}};},
    SplatLodController:class{constructor(spark){this.spark=spark;}async select(camera){events.push({stage:'lod',size:this.spark.renderSize.toArray(),mask:camera.layers.mask});lodStarted.resolve();await lodGate?.promise;}async release(){}disposeTextures(){}}};
  vm.createContext(sandbox);const source=fs.readFileSync(require.resolve('../src/features/world-node/splat-io.mjs'),'utf8');
  vm.runInContext(source.slice(source.indexOf('export class SplatContext')).replace('export class','class')+'\nglobalThis.Context=SplatContext;',sandbox);
  const scene=new THREE.Scene(),root=new THREE.Group(),proxy=splat.splatProxy({version:1,format:'spz',url:'asset:fixture',count:1,bounds:[[0,0,0],[1,1,1]]});root.add(proxy);scene.add(root);
  const renderer={domElement:{width:1280,height:720},getDrawingBufferSize:size=>size.set(1280,720)},manager=new sandbox.Context(renderer,scene),camera=new THREE.PerspectiveCamera(50,1.5,.1,100);camera.position.z=4;camera.updateMatrixWorld(true);
  const options={width:4096,height:2731};return {manager,root,proxy,scene,renderer,camera,options,events,lodStarted,sortStarted};
}

test('offscreen dimensions reach LOD and awaited sort, then restore Spark size; settled draws never enqueue',async()=>{
  const gate=deferred(),f=await fixture({sortGate:gate}),request=f.manager.settleOffscreen(f.root,f.camera,f.options);await f.sortStarted.promise;
  assert.deepEqual(f.events.map(e=>[e.stage,e.size]),[['lod',[4096,2731]],['sort',[4096,2731]]]);assert.equal(f.events[1].visible,true);assert.equal(f.manager.layer.visible,false);
  assert.throws(()=>f.manager.renderSettled(f.root,f.camera,()=>true,f.options),/尚未完成排序/);gate.resolve();await request;
  assert.deepEqual(f.manager.spark.renderSize.toArray(),[1280,720]);f.manager.spark.autoUpdate=true;
  for(let i=0;i<10;i++)assert.equal(f.manager.renderSettled(f.root,f.camera,()=>{assert.equal(f.manager.layer.visible,true);assert.equal(f.manager.spark.autoUpdate,false);return true;},f.options),true);
  assert.equal(f.events.length,2);assert.equal(f.manager.layer.visible,false);assert.equal(f.manager.spark.autoUpdate,true);await f.manager.dispose();
});

test('queued viewport work finishes before independent offscreen selection; next viewport reschedules its own dimensions',async()=>{
  const gate=deferred(),f=await fixture({sortGate:gate});await f.manager.prepare(f.root);const viewport=f.manager.enqueue(f.camera);await f.sortStarted.promise;
  const photo=f.manager.settleOffscreen(f.root,f.camera,f.options);await turn();assert.equal(f.events.length,2);gate.resolve();await viewport;await photo;
  assert.deepEqual(f.events.map(e=>e.size),[[1280,720],[1280,720],[4096,2731],[4096,2731]]);
  await f.manager.enqueue(f.camera);assert.deepEqual(f.events.slice(-2).map(e=>e.size),[[1280,720],[1280,720]]);
  assert.throws(()=>f.manager.renderSettled(f.root,f.camera,()=>true,f.options),/尚未完成排序/);await f.manager.dispose();
});

test('same offscreen frame reuses settled accumulation, but a thumbnail selects and sorts at 320 directly',async()=>{
  const f=await fixture();await f.manager.settleOffscreen(f.root,f.camera,f.options);await f.manager.settleOffscreen(f.root,f.camera,f.options);assert.equal(f.events.length,2);
  const thumb={width:320,height:213};await f.manager.settleOffscreen(f.root,f.camera,thumb);assert.deepEqual(f.events.slice(-2).map(e=>e.size),[[320,213],[320,213]]);
  assert.throws(()=>f.manager.renderSettled(f.root,f.camera,()=>true,f.options),/尚未完成排序/);assert.equal(f.manager.renderSettled(f.root,f.camera,()=>true,thumb),true);await f.manager.dispose();
});

test('settled draw rejects pose, projection, camera layers, proxy transform/visibility/layers, source and root changes',async()=>{
  for(const mutate of [f=>f.camera.position.x++,f=>{f.camera.fov=55;},f=>{f.camera.fov=60;f.camera.updateProjectionMatrix();},f=>f.camera.layers.set(5),f=>f.proxy.position.x++,f=>{f.root.visible=false;},f=>f.proxy.layers.set(5),f=>f.proxy.removeFromParent()]){
    const f=await fixture();await f.manager.settleOffscreen(f.root,f.camera,f.options);mutate(f);let drawn=false;assert.throws(()=>f.manager.renderSettled(f.root,f.camera,()=>{drawn=true;},f.options));assert.equal(drawn,false);await f.manager.dispose();
  }
  const f=await fixture();await f.manager.settleOffscreen(f.root,f.camera,f.options);const replacement=f.root.clone();assert.throws(()=>f.manager.renderSettled(replacement,f.camera,()=>true,f.options));await f.manager.dispose();
});

test('camera or ownership changes during native waits reject, restore dimensions and require a fresh settlement',async()=>{
  for(const stage of ['lod','sort'])for(const mode of ['camera','abort','identity']){
    const gate=deferred(),f=await fixture(stage==='lod'?{lodGate:gate}:{sortGate:gate}),abort=new AbortController();let current=true;
    const options={...f.options,signal:abort.signal,assertCurrent:()=>current},request=f.manager.settleOffscreen(f.root,f.camera,options);await (stage==='lod'?f.lodStarted.promise:f.sortStarted.promise);
    if(mode==='camera')f.camera.position.x++;else if(mode==='abort')abort.abort(Error('cancelled'));else current=false;
    gate.resolve();await assert.rejects(request);assert.deepEqual(f.manager.spark.renderSize.toArray(),[1280,720]);assert.equal(f.manager.offscreenSettled,null);assert.equal(f.manager.layer.visible,false);
    await f.manager.settleOffscreen(f.root,f.camera,f.options);assert.equal(f.manager.renderSettled(f.root,f.camera,()=>true,f.options),true);await f.manager.dispose();
  }
});

test('draw failure restores context visibility/autoUpdate, and disposal waits for native sort completion',async()=>{
  const f=await fixture();await f.manager.settleOffscreen(f.root,f.camera,f.options);f.manager.spark.autoUpdate=true;
  assert.throws(()=>f.manager.renderSettled(f.root,f.camera,()=>{throw Error('GPU failed');},f.options),/GPU failed/);assert.equal(f.manager.layer.visible,false);assert.equal(f.manager.spark.autoUpdate,true);
  assert.throws(()=>f.manager.renderSettled(f.root,f.camera,async()=>true,f.options),/必须同步/);await f.manager.dispose();
  const gate=deferred(),g=await fixture({sortGate:gate}),request=g.manager.settleOffscreen(g.root,g.camera,g.options);await g.sortStarted.promise;const spark=g.manager.spark,disposal=g.manager.dispose();assert.equal(spark.disposals,0);gate.resolve();await assert.rejects(request,/已关闭/);await disposal;assert.equal(spark.disposals,1);assert.deepEqual(spark.renderSize.toArray(),[1280,720]);
});

test('empty Gaussian roots settle and draw synchronously; invalid dimensions and cancelled identities cannot draw',async()=>{
  const f=await fixture();f.proxy.removeFromParent();await f.manager.settleOffscreen(f.root,f.camera,f.options);assert.equal(f.manager.renderSettled(f.root,f.camera,()=>{assert.equal(f.manager.layer.visible,false);return true;},f.options),true);assert.equal(f.events.length,0);
  for(const options of [{width:0,height:1},{width:320.5,height:213},{width:320,height:NaN},{...f.options,assertCurrent:()=>false}])await assert.rejects(f.manager.settleOffscreen(f.root,f.camera,options));
  const abort=new AbortController();abort.abort(Error('cancelled'));assert.throws(()=>f.manager.renderSettled(f.root,f.camera,()=>true,{...f.options,signal:abort.signal}),/cancelled/);await f.manager.dispose();
});
