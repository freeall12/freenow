const {test} = require('node:test'), assert = require('node:assert/strict');
const modules = Promise.all([import('three'), import('../src/features/studio-v3/temporal-playback.mjs'),
  import('../src/features/studio-v3/camera-shot-sampling.mjs'), import('../src/features/studio-v3/schema.mjs'),
  import('../src/features/studio-v3/world-space.mjs'), import('../src/features/studio-v3/render-graph.mjs')]);
const vec = (x, y = 0, z = 0) => ({x, y, z}), keys = [{id:'a',timeMs:0},{id:'b',timeMs:1000}];
const ch = (property,kind,a,b,interpolation='linear') => ({id:property,property,values:[{keyId:'a',interpolation,value:{kind,value:a}},{keyId:'b',interpolation,value:{kind,value:b}}]});
const gate = () => {let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
const turn = () => new Promise(resolve=>setImmediate(resolve));
async function fixture({noCamera=false,applyGate,realGraph=false,applyFailure=false,restoreGate}={}) {
  const [THREE,{createTemporalPlayback},sampling,schema,world,{createRenderGraph}] = await modules;
  let state=schema.createState({worldNodeId:'world',now:1}),fence={owner:'a',editEpoch:0},sourceKey='source:a',current=true,hidden=false,time=0;
  const setupId=state.scenePlay.worldSpace.activeSetupId;
  for(const [id,kind] of [['actor','actor'],['prop','prop'],...noCamera?[]:[['cam','camera']],['baseline','prop']]) {
    const value={...schema.createSetupState(id,1),...kind==='actor'?{pose:'Standing'}:{},...kind==='camera'?{camera:{position:vec(0,2,5),rotation:{x:0,y:0,z:0,order:'YXZ'},fov:60,frameAspectRatio:1.5,focusDistance:3,depthOfFieldMode:'aperture',apertureFNumber:2}}:{}};
    state=world.addEntity(state,schema.createEntity({id,kind,label:id,now:1,...kind==='prop'?{asset:{sourceFormat:'glb',sourceUrl:'/assets/studio/prop.glb'}}:{}}),{setupId:id==='baseline'?'setup-default':setupId,setupState:value});
  }
  const tracks=[{id:'actor-track',owner:{kind:'entity',entityId:'actor'},keys,channels:[ch('entity.transform.position','vec3',vec(0),vec(10)),ch('entity.pose','pose','Standing','Walking')]},
    {id:'prop-track',owner:{kind:'entity',entityId:'prop'},keys,channels:[ch('entity.transform.position','vec3',vec(2),vec(6)),ch('entity.transform.scale','vec3',vec(1,1,1),vec(3,3,3)),ch('entity.visibility','boolean',true,false)]}];
  if(!noCamera)tracks.push({id:'cam-track',owner:{kind:'entity',entityId:'cam'},keys,channels:[ch('entity.transform.position','vec3',vec(0,2,5),vec(10,2,5)),ch('camera.focalLength','number',20,80),ch('camera.focusDistance','number',3,9),ch('camera.frameAspectRatio','number',1.5,2)]});
  state=world.setTemporal(state,setupId,{durationMs:1000,tracks},2);const author=structuredClone(state),applies=[],restores=[],errors=[],frames=new Map();let frameId=0,loads=0;
  const graph=realGraph?createRenderGraph({scene:new THREE.Scene(),loader:{async load(){loads++;const root=new THREE.Group();return {root,format:'glb',animations:[new THREE.AnimationClip('Standing',1,[]),new THREE.AnimationClip('Walking',1,[])],dispose(){}};}}}):null;
  if(graph)await graph.sync(state);
  const view = value => world.renderSetup(value).entityStates;
  let displayed=structuredClone(view(state)),replacement=null;
  const playback=createTemporalPlayback({getState:()=>state,getFence:()=>fence,getSourceKey:()=>sourceKey,isCurrent:()=>current,isHidden:()=>hidden,now:()=>time,
    requestFrame:callback=>{frames.set(++frameId,callback);return frameId;},cancelFrame:id=>frames.delete(id),capturePreview:()=>({original:displayed,root:graph?.entity('actor')?.root}),
    async applyPreview(payload){applies.push(payload.timeMs);await applyGate?.promise;payload.assertCurrent();if(applyFailure)throw Error('render application failed');displayed=structuredClone(payload.entityStates);if(graph)await graph.sync(payload.state);payload.assertCurrent();},
    async restorePreview(payload){restores.push(payload);await restoreGate?.promise;displayed=structuredClone(view(payload.state));if(graph&&payload.isCurrent())await graph.sync(payload.state);if(replacement)assert.notEqual(payload.lease.root,replacement);},onError:error=>errors.push(error)});
  return {playback,sampling,schema,world,author,applies,restores,errors,frames,graph,setupId,get state(){return state;},get displayed(){return displayed;},get loads(){return loads;},
    setTime(value){time=value;},setFence(value){fence={...fence,...value};},setSource(value){sourceKey=value;},hide(){hidden=true;},expire(){current=false;},
    async fire(timestamp){time=timestamp;const entry=frames.entries().next().value;assert(entry,'one scheduled frame');frames.delete(entry[0]);entry[1](timestamp);await playback.whenIdle();},
    switchSetup(){state=world.addSetup(state,schema.createIndependentSetup({id:'other',now:3}),{activate:true});},replaceRoot(){replacement=new THREE.Group();return replacement;}};
}

test('shared sampler supports camera-free setups and detached actor/prop/baseline state without author timestamps changing',async()=>{
  const f=await fixture({noCamera:true}),result=f.sampling.sampleTemporalSetupState(f.state,{setupId:f.setupId},500);
  assert.deepEqual(result.entityStates.map(e=>e.entityId),['baseline','actor','prop']);assert.equal(result.entityStates.find(e=>e.entityId==='actor').transform.position.x,5);
  assert.deepEqual(result.entityStates.find(e=>e.entityId==='prop').transform.scale,vec(2,2,2));assert.equal(result.entityStates.find(e=>e.entityId==='actor').pose,'Standing');
  f.schema.assertState(result.state);result.entityStates[0].transform.position.x=999;assert.deepEqual(f.state,f.author);
  assert.throws(()=>f.sampling.sampleCameraShotState(f.state,{setupId:f.setupId,stageId:'stage-default',cameraEntityId:null},0),/real linked camera/);
});

test('seek applies every entity and optical value to real graph; pause keeps sample; stop restores same roots and cameras',async()=>{
  const f=await fixture({realGraph:true}),actor=f.graph.entity('actor').root,camera=f.graph.entity('cam').camera,initialOptics=structuredClone(camera.userData.studioV3Optics),loads=f.loads;
  assert.equal(await f.playback.seek(500,{scrubbing:true}),true);assert.equal(f.playback.blocksWrites,true);assert.equal(f.playback.status.scrubbing,true);
  assert.equal(actor.position.x,5);assert.equal(f.graph.entity('prop').root.scale.x,2);assert.equal(camera.position.x,5);assert.equal(camera.userData.studioV3Optics.focalLength,40);assert.equal(camera.userData.studioV3Optics.focusDistance,6);
  assert.deepEqual(f.state,f.author);await f.playback.pause();assert.equal(f.playback.active,true);assert.equal(actor.position.x,5);assert.equal(f.frames.size,0);assert.equal(f.loads,loads);
  await f.playback.seek(1000);assert.equal(f.graph.entity('actor').pose,'Walking');assert.equal(f.graph.entity('prop').root.visible,false);
  await f.playback.stop();assert.equal(f.graph.entity('actor').root,actor);assert.equal(f.graph.entity('cam').camera,camera);assert.equal(actor.position.x,0);assert.equal(f.graph.entity('actor').pose,'Standing');assert.equal(f.graph.entity('prop').root.visible,true);assert.deepEqual(camera.userData.studioV3Optics,initialOptics);
  assert.equal(f.playback.previewState,null);assert.equal(f.playback.blocksWrites,false);assert.equal(f.restores.length,1);f.graph.dispose();
});

test('on-demand RAF covers speed, endpoint stop, replay from zero and loop modulo without domain writes',async()=>{
  const f=await fixture();assert.equal(f.frames.size,0);await f.playback.play();assert.equal(f.frames.size,1);await f.fire(250);assert.equal(f.playback.status.timeMs,250);assert.equal(f.frames.size,1);
  f.playback.setSpeed(2);await f.fire(500);assert.equal(f.playback.status.timeMs,750);await f.fire(750);assert.equal(f.playback.status.timeMs,1000);assert.equal(f.playback.playing,false);assert.equal(f.frames.size,0);
  await f.playback.play();assert.equal(f.playback.status.timeMs,0);f.playback.setLoop(true);await f.fire(1400);assert.equal(f.playback.status.timeMs,300);assert.equal(f.playback.playing,true);
  assert.equal(f.playback.setSpeed(NaN),1);f.setTime(1450);await f.playback.pause();assert.equal(f.playback.status.timeMs,350);assert.equal(f.frames.size,0);assert.deepEqual(f.state,f.author);await f.playback.exit();
});

test('queued seeks coalesce and adapters can reject a superseded async application before touching graph',async()=>{
  const pending=gate(),f=await fixture({applyGate:pending}),first=f.playback.seek(100);await turn();
  const second=f.playback.seek(200),latest=f.playback.seek(800);assert.equal(f.playback.blocksWrites,true);pending.resolve();
  assert.equal(await first,false);assert.equal(await second,false);assert.equal(await latest,true);assert.deepEqual(f.applies,[100,800]);assert.equal(f.playback.status.timeMs,800);assert.equal(f.errors.length,0);await f.playback.exit();
});

test('stop waits for in-flight application and restore while writes stay gated; disposal drains without returning sample',async()=>{
  const pending=gate(),restore=gate(),f=await fixture({applyGate:pending,restoreGate:restore}),request=f.playback.seek(500);await turn();
  const close=f.playback.dispose();assert.equal(f.playback.disposed,true);assert.equal(f.playback.blocksWrites,true);assert.equal(f.restores.length,0);pending.resolve();assert.equal(await request,false);await turn();
  assert.equal(f.restores.length,1);assert.equal(f.playback.blocksWrites,true);restore.resolve();await close;await f.playback.whenIdle();assert.equal(f.playback.blocksWrites,false);assert.equal(f.playback.previewState,null);assert.deepEqual(f.state,f.author);await assert.rejects(f.playback.seek(0),{code:'studio_v3_temporal_disposed'});
});

test('ownership/source/editEpoch/setup and hidden fences cancel and restore once; replaced native instances stay separate',async()=>{
  for(const change of [f=>f.setFence({owner:'b'}),f=>f.setFence({editEpoch:1}),f=>f.setSource('source:b'),f=>f.switchSetup(),f=>f.hide(),f=>f.expire()]) {
    const f=await fixture();await f.playback.play();f.playback.setLoop(true);change(f);assert.equal(await f.playback.refresh(),false);assert.equal(f.playback.active,false);assert.equal(f.frames.size,0);assert.equal(f.restores.length,1);assert.equal(f.restores[0].isCurrent(),false);await f.playback.dispose();assert.equal(f.restores.length,1);
  }
  const f=await fixture({realGraph:true});await f.playback.seek(500);f.replaceRoot();f.setSource('new');await f.playback.refresh();assert.equal(f.restores[0].isCurrent(),false);f.graph.dispose();
});

test('identity changes during asynchronous render apply fence out the result and restore before drain',async()=>{
  const pending=gate(),f=await fixture({applyGate:pending}),request=f.playback.seek(500);f.playback.setLoop(true);f.playback.setSpeed(2);await turn();f.setFence({editEpoch:9});pending.resolve();assert.equal(await request,false);
  assert.equal(f.playback.previewState,null);assert.equal(f.restores.length,1);assert.equal(f.restores[0].reason,'stale');assert.equal(f.playback.status.loop,false);assert.equal(f.playback.status.speed,1);assert.equal(f.playback.blocksWrites,false);assert.equal(f.errors.length,0);
});

test('manual ticks use the same sampler without auto RAF; invalid input and adapter failure do not mutate author state',async()=>{
  const f=await fixture({applyFailure:true});await assert.rejects(f.playback.seek(500),/render application failed/);assert.equal(f.errors.length,1);assert.equal(f.restores.length,1);assert.equal(f.playback.blocksWrites,false);assert.deepEqual(f.state,f.author);
  await assert.rejects(f.playback.seek(Infinity),TypeError);await f.playback.dispose();
  const [,{createTemporalPlayback}]=await modules,g=await fixture();let sampled;
  const manual=createTemporalPlayback({getState:()=>g.state,autoSchedule:false,now:()=>0,applyPreview:value=>{sampled=value;},restorePreview:()=>{}});
  await manual.play();await manual.tick(600);assert.equal(sampled.timeMs,600);assert.equal(manual.status.timeMs,600);assert.equal(g.frames.size,0);await manual.tick(-100);assert.equal(sampled.timeMs,0);manual.setLoop(true);await manual.tick(-100);assert.equal(sampled.timeMs,900);await manual.dispose();
});

test('shared geometric helpers retain 64-chord distance timing and official midpoint bend split, detached from track',async()=>{
  const f=await fixture(),track={id:'path',owner:{kind:'entity',entityId:'prop'},keys,channels:[ch('entity.transform.position','vec3',vec(0),vec(10))],pathEndpointControls:{start:{point:vec(0,10)},end:{point:vec(10,10)}}};
  const before=structuredClone(track),segments=f.sampling.temporalPositionPathSegments(track);assert.equal(segments.length,1);assert.equal(segments[0].lengths.length,65);assert(segments[0].length>10);
  const split=f.sampling.resolveTemporalPathSplit(track,250);assert(split.t<.25);assert.equal(split.leftBend.t,.5);assert.equal(split.rightBend.t,.5);assert.equal(split.fromKeyId,'a');assert.equal(split.toKeyId,'b');assert(split.leftBend.point.y>0);
  assert.equal(f.sampling.resolveTemporalPathSplit(track,0),null);segments[0].p0.x=999;assert.deepEqual(track,before);
  const bent={...track,segments:[{fromKeyId:'a',toKeyId:'b',transition:{spatialBend:{point:vec(5,4),t:.5}}}]};
  const state=f.world.setTemporal(f.state,f.setupId,{durationMs:1000,tracks:[bent]},3),sample=f.sampling.sampleTemporalSetupState(state,{setupId:f.setupId},500);assert(Math.abs(sample.entityStates.find(e=>e.entityId==='prop').transform.position.y-4)<1e-9);
});


test('turning loop off preserves the current cycle and stale play cancels an existing preview', async () => {
  const f=await fixture();f.playback.setLoop(true);await f.playback.play();await f.fire(1300);assert.equal(f.playback.status.timeMs,300);
  f.playback.setLoop(false);await f.fire(1400);assert.equal(f.playback.status.timeMs,400);assert.equal(f.playback.playing,true);
  await f.fire(2100);assert.equal(f.playback.status.ended,true);assert.equal(f.playback.playing,false);
  f.setFence({editEpoch:1});await assert.rejects(f.playback.play(),{code:'studio_v3_temporal_stale'});assert.equal(f.playback.blocksWrites,false);assert.equal(f.restores.length,1);
});
