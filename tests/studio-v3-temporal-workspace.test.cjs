const {test} = require('node:test'), assert = require('node:assert/strict');
const modules = Promise.all(['schema','world-space','history','temporal-workspace','temporal-actions'].map(name => import(`../src/features/studio-v3/${name}.mjs`)));
const turn = () => new Promise(resolve => setImmediate(resolve));
const vec = x => ({x,y:0,z:0});
async function fixture({baseline=false}={}) {
  const [schema,world,{createHistory},{createTemporalWorkspace},actions] = await modules;
  let state=schema.createState({worldNodeId:'world',now:1}),selected='actor',source='source:a',epoch=0,revision=0,busy=false,current=true,hidden=false,historyId=0,time=0;
  const setupId=baseline?'setup-default':state.scenePlay.worldSpace.activeSetupId;
  if(baseline)state=world.setActiveSetup(state,setupId);
  for(const [id,kind] of [['actor','actor'],['prop','prop'],['camera','camera']])state=world.addEntity(state,schema.createEntity({id,kind,label:id,now:1,...kind==='prop'?{asset:{sourceFormat:'glb',sourceUrl:'/prop.glb'}}:{}}),
    {setupId,setupState:{...schema.createSetupState(id,1),...kind==='actor'?{pose:'Standing'}:{},...kind==='camera'?{camera:{position:vec(0),rotation:{x:0,y:0,z:0,order:'YXZ'},fov:60,lookAt:{mode:'point',target:vec(10)}}}:{}}});
  const engine=createHistory(state,{createId:()=>`h:${++historyId}`,now:()=>10}),applied=[];let host,modal=null;
  const notify=()=>{epoch++;host?.onAuthorStateChanged();};
  const history={...engine,preview(fn){const changed=engine.preview(fn);if(changed)notify();return changed;},commit(){const changed=engine.commit();if(changed)notify();return changed;},cancel(){const changed=engine.cancel();if(changed)notify();return changed;}};
  const session={getState:engine.getState,getFence:()=>({owner:'owner',editEpoch:epoch,revision}),history,isCurrent:()=>current,
    async flush(){revision++;host?.onAuthorStateChanged();return {ok:true};},
    change(fn,options){const changed=engine.transact(options.lane,options.label,fn,options.scope);if(changed)notify();return changed;}};
  const runtime={controlling:null,possessing:null,async sync(value){applied.push(structuredClone(value));},render(){}};
  const timeline={refresh(){},dispose(){},get confirming(){return !!modal;},handleEscape(){if(!modal)return false;const old=modal;modal=null;old.onCancel();return true;},requestKeyCreationConfirmation(value){modal=value;return false;}};
  host=createTemporalWorkspace({getState:engine.getState,session,getRuntime:()=>runtime,readCurrentSelection:()=>selected,select:id=>{selected=id;return true;},getSourceKey:()=>source,getBusy:()=>busy,isCurrent:()=>current,isHidden:()=>hidden,now:()=>10,
    createTimelineView:()=>timeline,playbackOptions:{autoSchedule:false,now:()=>time}});host.mount();host.setVisible(true);
  const local=(id='actor',value=engine.getState())=>value.scenePlay.worldSpace.setups.find(s=>s.id===setupId).entityStates.find(e=>e.entityId===id);
  const track=(id='actor')=>engine.getState().scenePlay.worldSpace.setups.find(s=>s.id===setupId).temporal?.tracks.find(t=>t.owner.entityId===id);
  const seed=(id='actor',at=0,x=0)=>{const snapshot=local(id);snapshot.transform.position=vec(x);if(id==='camera')snapshot.camera.position=vec(x);const result=actions.reduceTemporalAction(engine.getState(),{type:'save-key',setupId,entityId:id,timeMs:at,snapshot,keyId:`${id}:${at}`},{now:10});session.change(()=>result.state,{lane:result.lane,label:'seed',scope:result.scope});};
  return {host,session,history,runtime,schema,world,setupId,local,track,seed,applied,timeline,
    get state(){return engine.getState();},get modal(){return modal;},select(id){selected=id;},setBusy(value){busy=value;},setSource(value){source=value;},expire(){current=false;},hide(){hidden=true;},setTime(value){time=value;},
    async confirm(){const old=modal;assert(old);modal=null;return old.onConfirm();},cancel(){return timeline.handleEscape();},records:()=>engine.getHistory().lanes[`setup:${setupId}`]?.undoStack??engine.getHistory().lanes.world.undoStack};
}
test('one track follows controlled entity, selection, then selected key owner; explicit save needs no confirmation',async()=>{
  const f=await fixture();assert.equal(f.host.read().track.entityId,'actor');await f.host.read().track.onSaveKeyAt(0);assert.equal(f.modal,null);
  await f.host.read().track.onSelectKey(f.track().keys[0].id);f.select(null);assert.equal(f.host.read().track.entityId,'actor');f.select('prop');assert.equal(f.host.read().track.entityId,'prop');
  f.runtime.controlling={entityId:'camera'};assert.equal(f.host.read().track.entityId,'camera');f.runtime.controlling=null;await f.host.dispose();
});
test('implicit time key asks before mutation, cancellation is inert, confirmation fixes the target',async()=>{
  const f=await fixture();f.seed('actor',0,0);f.seed('actor',1000,10);await f.host.seek(500);const before=f.state;
  const pending=f.host.prepareEntityEdit({type:'update',entityId:'actor',patch:{transform:{position:{x:8}}}});await turn();assert(f.modal);assert.deepEqual(f.state,before);f.cancel();assert.equal((await pending).reason,'cancelled');assert.deepEqual(f.state,before);
  const next=f.host.prepareEntityEdit({type:'update',entityId:'actor',patch:{transform:{position:{x:8}}}});await turn();await f.confirm();const prepared=await next;assert.equal(prepared.target.kind,'time-key');assert.equal(prepared.action.timeMs,500);assert.deepEqual(f.state,before);
  assert.equal((await f.host.applyEntityEdit(prepared)).ok,true);assert.equal(f.track().keys.length,3);assert.equal(f.local().transform.position.x,0);assert.equal(f.host.displayState.scenePlay.worldSpace.setups.find(s=>s.id===f.setupId).entityStates.find(e=>e.entityId==='actor').transform.position.x,8);await f.host.dispose();
});
test('selected key authoring freezes its owner/time and previews/commit form one transaction',async()=>{
  const f=await fixture();f.seed('actor',0,0);f.seed('actor',1000,10);await f.host.read().track.onSelectKey('actor:1000');assert.equal(await f.host.primeTransform('actor'),true);
  assert.equal(f.host.getSubject('actor').transform.position.x,10);const before=f.state,records=f.records().length;
  assert.equal(f.host.handleTransform({phase:'begin',entityId:'actor'}),true);const transform=f.host.getSubject('actor').transform;
  assert.equal(f.host.handleTransform({phase:'preview',entityId:'actor',transform:{...transform,position:vec(14)}}),true);
  assert.equal(f.host.handleTransform({phase:'preview',entityId:'actor',transform:{...transform,position:vec(17)}}),true);assert.equal(f.local().transform.position.x,0);assert.equal(f.records().length,records);
  assert.equal(f.host.handleTransform({phase:'commit',entityId:'actor'}),true);assert.equal(f.records().length,records+1);assert.equal(f.host.getSubject('actor').transform.position.x,17);
  assert.equal(f.history.undo(`setup:${f.setupId}`).ok,true);assert.deepEqual(f.state,before);await f.host.dispose();
});
test('key dragging drains paused preview and commits one bounded transaction; cancellation restores channels',async()=>{
  const f=await fixture();f.seed('actor',0,0);f.seed('actor',1000,10);f.seed('actor',2000,20);await f.host.seek(1000);const before=f.state,records=f.records().length;
  let descriptor=f.host.read().track;assert.equal(await descriptor.onBeforeKeyMoveStart('actor:1000'),true);assert.equal(f.host.playback.active,false);const lease=descriptor.onKeyMoveStart('actor:1000');assert(lease);
  assert.equal(lease.onMove(500),true);assert.equal(lease.onMove(750),true);assert.equal(f.records().length,records);assert.equal(lease.onEnd(900),true);assert.equal(f.records().length,records+1);assert.equal(f.track().keys[1].timeMs,900);
  descriptor=f.host.read().track;await descriptor.onBeforeKeyMoveStart('actor:1000');const cancel=descriptor.onKeyMoveStart('actor:1000');cancel.onMove(9999);assert.equal(f.track().keys[1].timeMs,1999);assert.equal(cancel.onCancel(),true);assert.equal(f.track().keys[1].timeMs,900);
  f.schema.assertState(f.state);f.history.undo(`setup:${f.setupId}`);assert.deepEqual(f.state,before);await f.host.dispose();
});
test('play/seek never writes author state, capture pauses exact sample and fences all inputs',async()=>{
  const f=await fixture();f.seed('actor',0,0);f.seed('actor',1000,10);const before=f.state,records=f.records().length;await f.host.seek(500);await f.host.setPlaying(true);f.setTime(250);await f.host.playback.tick(250);
  const capture=await f.host.beforeCapture();assert.equal(capture.ok,true);assert.equal(capture.timeMs,750);assert.equal(f.host.playback.playing,false);assert.equal(await f.host.seek(0),false);assert.equal(await f.host.setPlaying(true),false);assert.equal((await f.host.beforeWrite()).ok,false);assert.deepEqual(f.state,before);assert.equal(f.records().length,records);
  assert.equal(capture.release(),true);await f.host.stop();assert.deepEqual(f.host.displayState,before);assert.deepEqual(f.applied.at(-1),before);await f.host.dispose();
});
test('stale modal, source change, external capture, and foreign transaction reject writes',async()=>{
  const f=await fixture();f.seed('actor',0,0);f.seed('actor',1000,10);await f.host.seek(500);const before=f.state;
  const pending=f.host.prepareEntityEdit({type:'update',entityId:'actor',patch:{pose:'Walking'}});await turn();assert(f.modal);f.setSource('source:b');f.host.refresh();assert.equal((await pending).ok,false);assert.deepEqual(f.state,before);assert.equal(f.modal,null);
  f.setBusy(true);assert.equal((await f.host.entityAction({type:'update',entityId:'actor',patch:{pose:'Walking'}})).ok,false);f.setBusy(false);
  f.history.begin('world','foreign',{kind:'world-space'});assert.equal(f.host.handleTransform({phase:'cancel',entityId:'actor'}),false);assert(f.history.getActiveTransaction());assert.equal((await f.host.beforeWrite()).ok,false);f.history.cancel();await f.host.dispose();
});
test('camera keyed clear-look-at writes typed none and leaves the base camera untouched',async()=>{
  const f=await fixture();f.select('camera');f.seed('camera',0,0);f.seed('camera',1000,10);await f.host.read().track.onSelectKey('camera:1000');assert.equal(await f.host.primeTransform('camera'),true);
  const subject=f.host.getSubject('camera'),camera={...subject.camera,position:vec(12)};delete camera.lookAt;
  assert.equal(f.host.handleCameraEdit({phase:'begin',entityId:'camera'}),true);assert.equal(f.host.handleCameraEdit({phase:'preview',entityId:'camera',camera,transform:{...subject.transform,position:vec(12)},clearLookAt:true}),true);
  assert.equal(f.host.handleCameraEdit({phase:'commit',entityId:'camera'}),true);assert.equal(f.local('camera').camera.lookAt.mode,'point');assert.equal(f.track('camera').channels.find(c=>c.property==='camera.lookAt').values.find(v=>v.keyId==='camera:1000').value.value.mode,'none');f.schema.assertState(f.state);await f.host.dispose();
});
test('scene-baseline base authoring remains available and temporal UI is hidden',async()=>{
  const f=await fixture({baseline:true});assert.equal(f.host.read().baseline,true);const result=await f.host.entityAction({type:'update',entityId:'actor',patch:{transform:{position:{x:4}}}});assert.equal(result.ok,true);assert.equal(f.local().transform.position.x,4);assert.equal(f.track(),undefined);assert.equal(await f.host.primeTransform('actor'),true);assert.equal(f.host.handleTransform({phase:'begin',entityId:'actor'}),true);assert.equal(f.host.handleTransform({phase:'preview',entityId:'actor',transform:{...f.local().transform,position:vec(9)}}),true);assert.equal(f.host.handleTransform({phase:'cancel',entityId:'actor'}),true);assert.equal(f.local().transform.position.x,4);await f.host.dispose();
});
test('real camera edit session checkpoints keyed capture and reopens the same approved key',async()=>{
  const f=await fixture(),{createCameraEditSession}=await import('../src/features/studio-v3/camera-edit-session.mjs');f.select('camera');f.seed('camera',0,0);f.seed('camera',1000,10);await f.host.read().track.onSelectKey('camera:1000');await f.host.primeTransform('camera');
  const cameraEdit=createCameraEditSession({getSubject:id=>f.host.isPrimed(id)?f.host.getSubject(id):null,getFence:()=>({owner:'owner'}),onEdit:f.host.handleCameraEdit});
  assert.equal(cameraEdit.start('camera'),true);assert.equal(cameraEdit.patchOptics({focalLength:85}),true);assert.equal(cameraEdit.checkpoint('capture'),true);assert.equal(f.history.getActiveTransaction(),null);assert.equal(f.host.isPrimed('camera'),true);
  const lease=await f.host.beforeCapture();assert.equal(lease.ok,true);assert.equal(cameraEdit.checkpoint('capture'),true);assert.equal(cameraEdit.refresh(),true);lease.release();assert.equal(cameraEdit.patchOptics({focalLength:120}),true);assert.equal(cameraEdit.finish(),true);
  assert.equal(f.track('camera').keys.length,2);assert.equal(f.track('camera').channels.find(c=>c.property==='camera.focalLength').values.find(v=>v.keyId==='camera:1000').value.value,120);assert.equal(f.local('camera').camera.focalLength,undefined);cameraEdit.dispose();await f.host.dispose();
});
test('first preview waits for native objects to load before capturing the reusable lease',async()=>{
  const f=await fixture();f.seed('actor',0,0);f.seed('actor',1000,10);const record={id:'actor',root:undefined,camera:undefined},entities=new Map([['actor',record]]);f.runtime.graph={entities,entity:id=>entities.get(id),source:null};
  let nativeLoaded=0;f.runtime.sync=async state=>{if(!record.root){await turn();record.root={};nativeLoaded++;}f.applied.push(structuredClone(state));};
  assert.equal(await f.host.seek(0),true);const native=record.root;assert.equal(await f.host.seek(500),true);await f.host.stop();assert.equal(record.root,native);assert.equal(nativeLoaded,1);assert.deepEqual(f.applied.at(-1),f.state);await f.host.dispose();
});
test('duration follows blocking keys, redistribution preserves channels, and deleting the track cleans selection',async()=>{
  const f=await fixture();f.seed('actor',0,0);f.seed('actor',1000,1);f.seed('actor',2500,10);let descriptor=f.host.read().track;
  assert.equal(f.host.read().durationMinimum.durationMs,2500);const channels=structuredClone(f.track().channels);await descriptor.onRedistributeTimingForUniformSpeed();assert(f.track().keys[1].timeMs>0&&f.track().keys[1].timeMs<1000);assert.deepEqual(f.track().channels,channels);
  await f.host.read().track.onDeleteKey('actor:2500');assert.equal(f.host.read().durationMinimum.durationMs,1000);await f.host.read().track.onDeleteTrack();assert.equal(f.track(),undefined);assert.equal(f.host.selectedKey,null);f.schema.assertState(f.state);await f.host.dispose();
});
test('dispose closes author input immediately while pending resource preparation drains',async()=>{
  const f=await fixture();f.seed('actor',0,0);f.seed('actor',1000,10);const before=f.state;let release;const gate=new Promise(resolve=>{release=resolve;});f.runtime.sync=async state=>{await gate;f.applied.push(structuredClone(state));};
  const seek=f.host.seek(500);await turn();const close=f.host.dispose();assert.equal((await f.host.entityAction({type:'update',entityId:'actor',patch:{pose:'Walking'}})).ok,false);release();assert.equal(await seek,false);await close;assert.deepEqual(f.state,before);assert.equal(f.host.playback.active,false);
});
test('cancelling implicit inspector or transform confirmation restores the previous paused composition without author writes',async()=>{
  for(const kind of ['inspector','transform']) {
    const f=await fixture();f.seed('actor',0,0);f.seed('actor',3000,3);await f.host.seek(1500);const before=f.state,records=f.records().length;
    assert.equal(f.host.getSubject('actor').transform.position.x,1.5);
    const pending=kind==='inspector'?f.host.entityAction({type:'update',entityId:'actor',patch:{transform:{position:{z:2}}}}):f.host.primeTransform('actor');await turn();assert(f.modal);f.cancel();await pending;
    assert.equal(f.host.getSubject('actor').transform.position.x,1.5);assert.equal(f.host.getSubject('actor').transform.position.z,0);assert.equal(f.host.read().playheadMs,1500);assert.equal(f.host.playback.playing,false);
    assert.equal(f.local().transform.position.x,0);assert.deepEqual(f.state,before);assert.equal(f.records().length,records);assert.equal(f.track().keys.length,2);await f.host.dispose();
  }
});
test('source changes during restore reject delayed definition edits and prevent cancelled view restoration',async()=>{
  const f=await fixture();f.seed('actor',0,0);f.seed('actor',1000,10);await f.host.seek(500);const before=f.state;let release;const gate=new Promise(resolve=>{release=resolve;});const sync=f.runtime.sync;
  f.runtime.sync=async state=>{await gate;return sync(state);};const edit=f.host.entityAction({type:'update',entityId:'actor',patch:{label:'Late'}});await turn();f.setSource('source:b');release();assert.equal((await edit).reason,'stale');assert.deepEqual(f.state,before);assert.equal(f.host.playback.active,false);await f.host.dispose();
  const g=await fixture();g.seed('actor',0,0);g.seed('actor',1000,10);await g.host.seek(500);const pending=g.host.primeTransform('actor');await turn();g.setSource('source:b');g.cancel();assert.equal(await pending,false);assert.equal(g.host.playback.active,false);await g.host.dispose();
});
test('rapid seeks accept superseded previews and scrub end retains the latest applied endpoint',async()=>{
  const f=await fixture();f.seed('actor',0,0);f.seed('actor',1000,10);await f.host.seek(0);const before=f.state,records=f.records().length;let release;const gate=new Promise(resolve=>{release=resolve;});const sync=f.runtime.sync;f.runtime.sync=async state=>{await gate;return sync(state);};
  const first=f.host.seek(100,{previewMode:'scrubbing'});await turn();const next=f.host.seek(400,{previewMode:'scrubbing'}),last=f.host.seek(800,{previewMode:'viewing'}),end=f.host.endScrub();release();
  assert.deepEqual(await first,{ok:true,superseded:true});assert.deepEqual(await next,{ok:true,superseded:true});assert.equal(await last,true);assert.equal(await end,true);
  assert.equal(f.host.read().playheadMs,800);assert.equal(f.host.getSubject('actor').transform.position.x,8);assert.equal(f.host.playback.status.scrubbing,false);assert.equal(f.host.playback.playing,false);assert.deepEqual(f.state,before);assert.equal(f.records().length,records);
  f.setBusy(true);assert.equal(await f.host.seek(200),false);f.setBusy(false);await f.host.dispose();
});
test('keyed camera capture survives pure save revision acknowledgements and clean checkpoints without losing possession',async()=>{
  const {createCameraEditSession}=await import('../src/features/studio-v3/camera-edit-session.mjs');
  for(const edited of [true,false]) {
    const f=await fixture();f.select('camera');f.seed('camera',0,0);await f.host.read().track.onSelectKey('camera:0');await f.host.primeTransform('camera');
    const cameraEdit=createCameraEditSession({getSubject:id=>f.host.isPrimed(id)?f.host.getSubject(id):null,getFence:()=>({owner:'owner'}),onEdit:f.host.handleCameraEdit});
    assert.equal(cameraEdit.start('camera'),true);const nativePossession=cameraEdit.active;
    if(edited)assert.equal(cameraEdit.patchOptics({focalLength:50}),true);
    const expected=f.host.getSubject('camera').camera.focalLength,epochBefore=f.session.getFence().editEpoch;
    assert.equal(cameraEdit.checkpoint('capture'),true);assert.equal(f.host.isPrimed('camera'),true);const afterCheckpoint=f.session.getFence();
    await f.session.flush();assert.equal(f.session.getFence().revision,afterCheckpoint.revision+1);assert.equal(f.session.getFence().editEpoch,afterCheckpoint.editEpoch);assert(f.session.getFence().editEpoch>=epochBefore);
    const capture=await f.host.beforeCapture();assert.equal(capture.ok,true);await f.session.flush();assert.equal(cameraEdit.refresh(),true);assert.equal(cameraEdit.active.entityId,nativePossession.entityId);assert.equal(cameraEdit.active.camera.focalLength,expected);assert.equal(f.host.isPrimed('camera'),true);
    capture.release();assert.equal(cameraEdit.patchOptics({focalLength:85}),true);assert.equal(cameraEdit.finish(),true);assert.equal(f.track('camera').keys.length,1);assert.equal(f.track('camera').channels.find(c=>c.property==='camera.focalLength').values[0].value.value,85);assert.equal(f.local('camera').camera.focalLength,undefined);
    assert.equal(f.host.isPrimed('camera'),true);f.session.change(state=>{state.scenePlay.worldSpace.entities.find(e=>e.id==='actor').label='external edit';return state;},{lane:'world',label:'external edit',scope:{kind:'world-space'}});assert.equal(f.host.isPrimed('camera'),false);
    f.setSource('source:b');f.host.refresh();assert.equal(f.host.isPrimed('camera'),false);cameraEdit.dispose();await f.host.dispose();
  }
});
test('real durable session and asynchronous author sync preserve keyed optical input through capture checkpoint and flush',async()=>{
  const f=await fixture();f.seed('camera',0,0);await f.host.dispose();
  const [{createStudioSession},{createTemporalWorkspace},{createCameraEditSession}]=await Promise.all(['session','temporal-workspace','camera-edit-session'].map(name=>import(`../src/features/studio-v3/${name}.mjs`)));
  const source={id:'source',worldResource:{url:'/scene.glb',format:'glb'}},target={id:'world',studioV3:{version:3,state:f.state,revision:0,sourceBinding:{sourceNodeId:'source',sourceKind:'world',sourceSnapshot:structuredClone(source.worldResource)}}};
  let host,cameraEdit,registered,selected='camera',nativePossession=null,starts=0,ends=0;const renders=[],syncs=[],errors=[];
  const app={getState:()=>({nodes:[source,target]}),projectIdentity:()=>({id:'project'}),registerNodeWriteGuard(id,guard){registered=guard;return()=>{registered=null;};}};
  const runtime={get possessing(){return cameraEdit?.active;},async sync(value){renders.push(structuredClone(value));await Promise.resolve();if(cameraEdit?.active)assert.equal(cameraEdit.refresh(),true);},render(){}};
  const session=createStudioSession({nodeId:'world',app,store:{flush:async()=>{}},autosaveMs:null,getSourceSnapshot:node=>node.worldResource,
    publishNode:async(id,patch,{beforeCommit})=>{assert.equal(beforeCommit(),true);const candidate={...target,studioV3:structuredClone(patch.studioV3)};assert.equal(registered(candidate),true);target.studioV3=candidate.studioV3;},
    onChange:()=>{host?.onAuthorStateChanged();const pending=runtime.sync(host?.displayState??session.getState());syncs.push(pending.catch(error=>errors.push(error)));},onStatus:()=>host?.refresh()});
  host=createTemporalWorkspace({getState:session.getState,session,getRuntime:()=>runtime,readCurrentSelection:()=>selected,select:id=>{selected=id;return true;},getSourceKey:()=>source.worldResource,now:()=>10});
  await host.seek(0);await host.primeTransform('camera');
  cameraEdit=createCameraEditSession({getSubject:id=>host.isPrimed(id)?host.getSubject(id):null,getFence:()=>{const {revision,editEpoch,...identity}=session.getFence();return identity;},onEdit:host.handleCameraEdit,
    onStart(){nativePossession={};starts++;},onEnd(){nativePossession=null;ends++;}});
  assert.equal(cameraEdit.start('camera'),true);const opticalObject=nativePossession;assert.equal(cameraEdit.patchOptics({focalLength:50}),true);await Promise.all(syncs);
  const cameraTrack=()=>session.getState().scenePlay.worldSpace.setups.find(s=>s.id===f.setupId).temporal.tracks.find(t=>t.owner.entityId==='camera');
  assert.equal(cameraTrack().channels.find(c=>c.property==='camera.focalLength').values[0].value.value,50);assert.equal(cameraEdit.active.camera.focalLength,50);assert.equal(host.getSubject('camera').camera.focalLength,50);
  assert.equal(cameraEdit.checkpoint('capture'),true);await Promise.all(syncs);const lease=await host.beforeCapture();assert.equal(lease.ok,true);assert.equal(cameraEdit.checkpoint('capture'),true);
  assert.deepEqual(await session.flush(),{ok:true});await runtime.sync(host.displayState);assert.equal(nativePossession,opticalObject);assert.equal(starts,1);assert.equal(ends,0);assert.equal(cameraEdit.active.camera.focalLength,50);assert.equal(host.isPrimed('camera'),true);
  lease.release();assert.equal(cameraEdit.patchOptics({focalLength:85}),true);await Promise.all(syncs);assert.equal(cameraEdit.active.camera.focalLength,85);assert.equal(cameraTrack().keys.length,1);assert.equal(cameraTrack().channels.find(c=>c.property==='camera.focalLength').values[0].value.value,85);assert.deepEqual(errors,[]);
  cameraEdit.finish();await Promise.all(syncs);await host.dispose();await session.closeGuard();
});
