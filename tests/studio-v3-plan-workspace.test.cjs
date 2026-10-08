const {test} = require('node:test'), assert = require('node:assert/strict');
const modules=Promise.all(['schema','world-space','session','temporal-workspace','plan-workspace','temporal-actions','transform-coordinates','camera-optics'].map(name=>import(`../src/features/studio-v3/${name}.mjs`)));
const turn=()=>new Promise(resolve=>setImmediate(resolve));
const vec=(x,y=0,z=0)=>({x,y,z});
async function fixture({baseline=false}={}) {
  const [schema,world,{createStudioSession},{createTemporalWorkspace},{createPlanWorkspace},actions,coordinates,optics]=await modules;
  let state=schema.createState({worldNodeId:'world',now:1}),selected=null,current=true,busy=false,saveAck=0,host,plan,guard,modal=null;const errors=[],syncs=[];
  const setupId=baseline?'setup-default':state.scenePlay.worldSpace.activeSetupId;if(baseline)state=world.setActiveSetup(state,setupId);
  const transform={position:vec(2,5,7),rotation:{x:.2,y:-.4,z:.1,order:'ZXY'},scale:vec(2,3,4)};
  const camera={position:vec(4,1.6,9),rotation:{x:.25,y:.3,z:-.15,order:'ZYX'},fov:optics.focalLengthToFov(35,2),focalLength:35,frameAspectRatio:2,focus:{mode:'point',target:vec(9,3,1)},focusDistance:null,depthOfFieldMode:'aperture',apertureFNumber:2.8,lookAt:{mode:'point',target:vec(5,2,5)}};
  for(const [id,kind] of [['actor','actor'],['prop','prop'],['camera','camera'],['shared','prop']])state=world.addEntity(state,schema.createEntity({id,kind,label:id,now:1,...id==='prop'?{color:'#abc123'}:{},...kind==='prop'?{asset:{sourceFormat:'glb',sourceUrl:'/prop.glb'}}:{}}),
    {setupId:id==='shared'?'setup-default':setupId,setupState:{...schema.createSetupState(id,1),transform:structuredClone(transform),...kind==='actor'?{pose:'Standing'}:{},...kind==='camera'?{camera}:{} }});
  const source={id:'source',worldResource:{url:'/scene.glb',format:'glb'}},target={id:'world',studioV3:{version:3,state,revision:0,sourceBinding:{sourceNodeId:'source',sourceKind:'world',sourceSnapshot:structuredClone(source.worldResource)}}};
  const app={getState:()=>({nodes:[source,target]}),projectIdentity:()=>({id:'project'}),registerNodeWriteGuard(id,value){guard=value;return()=>{guard=null;};}};
  const runtime={graph:{source:{}},async sync(value){await Promise.resolve();return value;},render(){}};
  const session=createStudioSession({nodeId:'world',app,store:{flush:async()=>{}},autosaveMs:null,getSourceSnapshot:node=>node.worldResource,
    publishNode:async(id,patch,{beforeCommit})=>{assert.equal(beforeCommit(),true);const candidate={...target,studioV3:structuredClone(patch.studioV3)};assert.equal(guard(candidate),true);target.studioV3=candidate.studioV3;},
    onChange:()=>{host?.onAuthorStateChanged();syncs.push(runtime.sync(host?.displayState??session.getState()));},onStatus:()=>host?.refresh()});
  const timeline={refresh(){},dispose(){},get confirming(){return !!modal;},handleEscape(){if(!modal)return false;const old=modal;modal=null;old.onCancel();return true;},requestKeyCreationConfirmation(value){modal=value;return false;}};
  host=createTemporalWorkspace({getState:session.getState,session,getRuntime:()=>runtime,readCurrentSelection:()=>selected,select:id=>{selected=id;return true;},isCurrent:()=>current,getBusy:()=>busy,getSourceKey:()=>source.worldResource,now:()=>10,createTimelineView:()=>timeline,playbackOptions:{autoSchedule:false}});host.mount();
  const planSession={...session,getFence:()=>({...session.getFence(),revision:session.getFence().revision+saveAck})};
  plan=createPlanWorkspace({getState:()=>host.displayState,getAuthorState:session.getState,session:planSession,temporal:host,getRuntime:()=>runtime,isCurrent:()=>current,getSelected:()=>selected,onSelect:id=>{selected=id;return true;},getBusy:()=>busy,onError:error=>errors.push(error)});
  const local=(id='actor',value=session.getState())=>value.scenePlay.worldSpace.setups.find(s=>s.id===setupId).entityStates.find(e=>e.entityId===id);
  const seed=(id,timeMs,x)=>{const snapshot=local(id);snapshot.transform.position.x=x;if(snapshot.camera)snapshot.camera.position.x=x;const result=actions.reduceTemporalAction(session.getState(),{type:'save-key',setupId,entityId:id,timeMs,snapshot,keyId:`${id}:${timeMs}`},{now:10});session.change(()=>result.state,{lane:result.lane,label:'seed',scope:result.scope});};
  return {plan,host,session,runtime,schema,world,coordinates,optics,setupId,local,seed,errors,syncs,get state(){return session.getState();},get modal(){return modal;},select:id=>{selected=id;},setBusy:value=>{busy=value;},expire:()=>{current=false;},records:()=>session.history.getHistory().lanes[baseline?'world':`setup:${setupId}`]?.undoStack??[],
    acknowledge:()=>{saveAck++;},async confirm(){const old=modal;modal=null;return old.onConfirm();},async close(){plan.dispose();current=true;await host.dispose();await Promise.all(syncs);await session.closeGuard();}};
}
test('real markers join shared and local state, use optical camera pose, official colors and world headings',async()=>{
  const f=await fixture();f.select('camera');const markers=f.plan.readMarkers();assert.equal(markers.length,4);const actor=markers.find(m=>m.id==='actor'),prop=markers.find(m=>m.id==='prop'),camera=markers.find(m=>m.id==='camera'),shared=markers.find(m=>m.id==='shared');
  assert.equal(actor.kind,'person');assert.equal(prop.kind,'object');assert.equal(prop.color,'#abc123');assert.equal(actor.color,f.plan.readMarkers().find(m=>m.id==='actor').color);
  assert.deepEqual(camera.position,f.local('camera').camera.position);assert.equal(camera.heading,f.coordinates.entityStateHeadingRadians('camera',f.local('camera')));assert.equal(camera.selected,true);assert.equal(camera.focalLength,35);assert.equal(camera.frameAspectRatio,2);assert.deepEqual(camera.camera,{fov:camera.fov,frameAspectRatio:2,focalLength:35});assert.equal(shared.readOnly,true);assert.equal(shared.draggable,false);assert.deepEqual(f.errors,[]);await f.close();
});
test('move and heading use the fixed original transform, preserve height tilt scale, and commit one undo step',async()=>{
  for(const id of ['actor','prop']) {
    const f=await fixture(),before=f.state,original=f.local(id),records=f.records().length,lease=await f.plan.beginEdit({entityId:id,kind:'move',marker:f.plan.readMarkers().find(m=>m.id===id)});assert(lease);
    assert.equal(lease.onMove({position:{x:10,y:-999,z:20},heading:1.2}),true);assert.equal(lease.onMove({position:{x:15,z:25},heading:-.7}),true);
    const authored=f.local(id);assert.deepEqual(authored.transform.position,vec(15,5,25));assert.deepEqual(authored.transform.scale,original.transform.scale);assert(f.coordinates.sameRotation(authored.transform.rotation,f.coordinates.setEntityHeading(id,original.transform,-.7).rotation));assert.equal(f.records().length,records);
    assert.equal(lease.onEnd(),true);assert.equal(f.records().length,records+1);assert.equal(f.session.history.undo(`setup:${f.setupId}`).ok,true);assert.deepEqual(f.state,before);await f.close();
  }
});
test('camera heading and fov author atomically from optical pose, preserve height scale tracking and other optics',async()=>{
  const f=await fixture(),before=f.state,original=f.local('camera'),lease=await f.plan.beginEdit({entityId:'camera',kind:'fov'});assert(lease);
  assert.equal(lease.onMove({heading:1.1,fov:40,position:{x:8,y:900,z:12}}),true);const next=f.local('camera');assert.deepEqual(next.camera.position,vec(8,1.6,12));assert.deepEqual(next.transform.position,next.camera.position);assert.deepEqual(next.transform.scale,original.transform.scale);
  assert(f.coordinates.sameRotation(next.camera.rotation,f.coordinates.setRotationHeading(original.camera.rotation,1.1)));assert(f.coordinates.sameRotation(next.transform.rotation,f.coordinates.cameraRotationToPlan(next.camera.rotation)));
  assert.deepEqual(next.camera.lookAt,original.camera.lookAt);assert.deepEqual(next.camera.focus,original.camera.focus);assert.equal(next.camera.apertureFNumber,2.8);assert.equal(next.camera.frameAspectRatio,2);assert.equal(next.camera.fov,40);assert.equal(next.camera.focalLength,f.optics.fovToFocalLength(40,2));
  assert.equal(lease.onMove({heading:-.5,fov:175}),true);assert.equal(f.local('camera').camera.focalLength,8);assert.equal(lease.onCancel(),true);assert.deepEqual(f.state,before);assert.equal(f.records().length,0);await f.close();
});
test('existing selected key edits only that key and keeps the base untouched',async()=>{
  const f=await fixture();f.seed('camera',0,4);f.seed('camera',3000,10);f.select('camera');await f.host.read().track.onSelectKey('camera:3000');const base=f.local('camera'),records=f.records().length;
  const lease=await f.plan.beginEdit({entityId:'camera',kind:'move'});assert(lease);assert.equal(lease.onMove({position:{x:12,z:15},heading:.8}),true);assert.equal(lease.onEnd(),true);assert.deepEqual(f.local('camera'),base);assert.equal(f.records().length,records+1);
  const track=f.state.scenePlay.worldSpace.setups.find(s=>s.id===f.setupId).temporal.tracks.find(t=>t.owner.entityId==='camera');assert.equal(track.keys.length,2);assert.equal(track.channels.find(c=>c.property==='entity.transform.position').values.find(v=>v.keyId==='camera:3000').value.value.x,12);await f.close();
});
test('implicit time-key waits for confirmation; pointer cancellation creates no state or transaction',async()=>{
  const f=await fixture();f.seed('actor',0,0);f.seed('actor',3000,3);await f.host.seek(1500);const before=f.state,records=f.records().length;
  const pending=f.plan.beginEdit({entityId:'actor',kind:'move'});await turn();assert(f.modal);assert.equal(f.session.history.getActiveTransaction(),null);assert.deepEqual(f.state,before);assert.equal(f.plan.cancel(),true);assert.equal(await pending,null);assert.deepEqual(f.state,before);assert.equal(f.records().length,records);
  const approved=f.plan.beginEdit({entityId:'actor',kind:'heading'});await turn();assert(f.modal);await f.confirm();const lease=await approved;assert(lease);assert.equal(lease.onMove({heading:1}),true);assert.equal(lease.onEnd(),true);assert.equal(f.local().transform.position.x,2);assert.equal(f.state.scenePlay.worldSpace.setups.find(s=>s.id===f.setupId).temporal.tracks[0].keys.length,3);await f.close();
});
test('save acknowledgement keeps gesture valid, while stale lifecycle cancels only its own transaction',async()=>{
  const f=await fixture(),before=f.state,lease=await f.plan.beginEdit({entityId:'prop',kind:'move'});assert(lease);assert.equal(lease.onMove({position:{x:9,z:10}}),true);f.acknowledge();assert.equal(lease.onMove({position:{x:10,z:11}}),true);f.expire();assert.equal(lease.onMove({position:{x:11,z:12}}),false);assert.deepEqual(f.state,before);assert.equal(f.session.history.getActiveTransaction(),null);
  await f.close();
  const g=await fixture(),own=await g.plan.beginEdit({entityId:'prop',kind:'move'});assert(own);g.session.history.cancel();g.session.history.begin('world','foreign',{kind:'world-space'});assert.equal(g.plan.cancel(),false);assert.equal(g.session.history.getActiveTransaction().label,'foreign');g.session.history.cancel();await g.close();
});
test('baseline edits remain base edits; shared locked busy and malformed inputs are refused',async()=>{
  const f=await fixture({baseline:true}),lease=await f.plan.beginEdit({entityId:'actor',kind:'heading'});assert(lease);assert.equal(lease.onMove({heading:.9}),true);assert.equal(lease.onEnd(),true);assert.equal(f.records().length,1);assert.equal(f.state.scenePlay.worldSpace.setups.find(s=>s.id===f.setupId).temporal,undefined);await f.close();
  const g=await fixture();assert.equal(await g.plan.beginEdit({entityId:'shared',kind:'move'}),null);assert.equal(await g.plan.beginEdit({entityId:'actor',kind:'fov'}),null);g.setBusy(true);assert.equal(await g.plan.beginEdit({entityId:'actor',kind:'move'}),null);g.setBusy(false);
  await g.host.entityAction({type:'update',entityId:'prop',patch:{locked:true}});assert.equal(await g.plan.beginEdit({entityId:'prop',kind:'move'}),null);
  const invalid=await g.plan.beginEdit({entityId:'actor',kind:'move'});assert.equal(invalid.onMove({position:{x:Infinity,z:1}}),false);assert.equal(invalid.onCancel(),true);g.plan.dispose();assert.equal(await g.plan.beginEdit({entityId:'actor',kind:'move'}),null);await g.close();
});
test('native source replacement rolls back its own gesture and cancelled pending preparation cannot leave a prime behind',async()=>{
  const f=await fixture(),before=f.state,lease=await f.plan.beginEdit({entityId:'actor',kind:'move'});assert.equal(lease.onMove({position:{x:12,z:13}}),true);f.runtime.graph.source={};assert.equal(lease.onEnd(),false);assert.deepEqual(f.state,before);assert.equal(f.session.history.getActiveTransaction(),null);await f.close();
  const g=await fixture();let release;const gate=new Promise(resolve=>{release=resolve;});g.runtime.sync=async()=>gate;const pending=g.plan.beginEdit({entityId:'actor',kind:'move'});await turn();g.plan.dispose();release();assert.equal(await pending,null);assert.equal(g.host.editing,false);assert.equal(g.session.history.getActiveTransaction(),null);await g.close();
});
test('a cancelled gesture lease accepts repeated cancellation without touching a later foreign transaction',async()=>{
  const f=await fixture(),before=f.state,lease=await f.plan.beginEdit({entityId:'actor',kind:'move'});assert(lease);assert.equal(lease.onMove({position:{x:12,z:13}}),true);assert.equal(f.plan.cancel(),true);assert.deepEqual(f.state,before);
  assert.equal(f.session.history.begin('world','foreign',{kind:'world-space'}),true);assert.equal(lease.onCancel(),true);assert.equal(lease.onCancel(),true);assert.equal(f.session.history.getActiveTransaction().label,'foreign');assert.deepEqual(f.state,before);f.session.history.cancel();await f.close();
});
