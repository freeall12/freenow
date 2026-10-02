const test=require('node:test'),assert=require('node:assert/strict');
const modulePromise=import('../studio-timeline.mjs');
const frame=(id,time,position,extra={})=>({id,entityId:'actor',time,state:{position,rotation:[0,0,0],scale:[1,1,1]},interpolation:'linear',...extra});
test('object tracks stay independent and preserve base state before first key',async()=>{const {sampleTrack,trackFrames}=await modulePromise;const records=[frame('a',1,[0,0,0]),frame('b',3,[2,0,0]),{...frame('other',2,[99,0,0]),entityId:'other'}];const track=trackFrames(records,'actor');assert.equal(sampleTrack(track,.5),null);assert.deepEqual(sampleTrack(track,2).position,[1,0,0]);assert.deepEqual(sampleTrack(track,4).position,[2,0,0]);assert.equal(track.length,2);});
test('hold preserves transform until the next key and rotations use shortest quaternion path',async()=>{const {sampleTrack}=await modulePromise;const frames=[frame('a',0,[0,0,0],{interpolation:'hold'}),frame('b',1,[4,0,0])];assert.deepEqual(sampleTrack(frames,.9).position,[0,0,0]);assert.deepEqual(sampleTrack(frames,1).position,[4,0,0]);frames[0].interpolation='linear';frames[0].state.rotation=[0,179*Math.PI/180,0];frames[1].state.rotation=[0,-179*Math.PI/180,0];const {Quaternion,Euler}=await import('three');const sampled=new Quaternion().setFromEuler(new Euler(...sampleTrack(frames,.5).rotation)),expected=new Quaternion().setFromEuler(new Euler(0,Math.PI,0));assert.ok(sampled.angleTo(expected)<1e-7);});
test('redistribution uses path length while preserving stationary holds and endpoint times',async()=>{const {redistributeTimes}=await modulePromise;const frames=[frame('a',0,[0,0,0]),frame('b',2,[1,0,0]),frame('c',4,[4,0,0])];const result=redistributeTimes(frames);assert.ok(Math.abs(result[1].time-1)<.01);assert.equal(result[2].time,4);const held=[frame('a',0,[0,0,0],{interpolation:'hold'}),frame('b',1,[0,0,0]),frame('c',3,[1,0,0]),frame('d',5,[4,0,0])];const r=redistributeTimes(held);assert.equal(r[1].time,1);assert.equal(r.at(-1).time,5);});
test('legacy whole-scene snapshots migrate without losing camera or actor motion',async()=>{const {migrateKeyframes,VIEWER_TRACK}=await modulePromise;const old=[{id:'old',time:2,camera:{position:[1,2,3],quaternion:[0,0,0,1],focal:24},objects:[{id:'actor',position:[2,0,1],rotation:[0,0,0]}]}];const r=migrateKeyframes(old);assert.equal(r.length,2);assert.equal(r[0].entityId,'actor');assert.equal(r[1].entityId,VIEWER_TRACK);assert.deepEqual(migrateKeyframes(r),r);});
test('dragging prevents same-track collisions but allows simultaneous keys on different objects',async()=>{const {moveKey}=await modulePromise;const r=[frame('a',0,[0,0,0]),frame('b',1,[1,0,0]),{...frame('c',2,[2,0,0]),entityId:'other'}];assert.throws(()=>moveKey(r,'a',1,3),/已有/);assert.equal(moveKey(r,'a',2,3)[0].time,2);assert.equal(moveKey(r,'a',99,3)[0].time,3);assert.equal(r[0].time,0);});
test('bending a path preserves endpoints, passes through its anchor and reparameterizes by distance',async()=>{
 const {buildSegments,sampleTrack,nearestPathParameter}=await modulePromise;
 const frames=[frame('a',0,[0,0,0],{bendConstraint:{point:[1,0,2],t:.5,toKeyId:'b'}}),frame('b',4,[2,0,0])];
 const segments=buildSegments(frames),curve=segments[0].curve;
 assert.deepEqual(curve.getPoint(0).toArray(),[0,0,0]);assert.deepEqual(curve.getPoint(1).toArray(),[2,0,0]);assert.deepEqual(curve.getPoint(.5).toArray(),[1,0,2]);
 assert.ok(Math.abs(nearestPathParameter(curve,[1,0,2])-.5)<.001);
 const distances=[];for(let i=1;i<=40;i++){const a=sampleTrack(frames,(i-1)/10,segments).position,b=sampleTrack(frames,i/10,segments).position;distances.push(Math.hypot(...a.map((v,j)=>v-b[j])));}
 assert.ok(Math.max(...distances)/Math.min(...distances)<1.06);
 // Inserting a key must not apply a constraint belonging to the old segment.
 const inserted=[frames[0],frame('middle',2,[1,0,0]),frames[1]];assert.deepEqual(buildSegments(inserted)[0].curve.getPoint(.5).toArray(),[.5,0,0]);
});

async function playbackFixture(){
 const THREE=await import('three'),{ScenePlayback}=await import('../src/features/studio-v2/playback.mjs'),{controlScenePlayback}=await import('../src/features/studio-v2/scene-playback.mjs');
 const content=new THREE.Scene(),camera=new THREE.PerspectiveCamera(),otherCamera=new THREE.PerspectiveCamera(),mesh=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial());
 camera.userData.studioId='camera';otherCamera.userData.studioId='other';mesh.userData.studioId='mesh';camera.position.set(1.125,2,3);mesh.position.set(.25,0,0);content.add(camera,otherCamera,mesh);content.updateMatrixWorld(true);
 const animations=[new THREE.AnimationClip('shot',4,[new THREE.VectorKeyframeTrack(camera.uuid+'.position',[0,4],[1.125,2,3,5.125,2,3])]),new THREE.AnimationClip('object',2,[new THREE.VectorKeyframeTrack(mesh.uuid+'.position',[0,2],[.25,0,0,2.25,0,0])])];
 const runtime={nodeId:'studio',content,animations,shotId:'camera',motionIndex:-1,closed:false,exporting:false,loadStatus:'ready',transform:{dragging:false},motion:{open:false,gesture:null,close(){this.open=false;}},assertReady(){if(this.closed||this.exporting||this.loadStatus!=='ready')throw Error('not ready');},find:id=>content.children.find(object=>object.userData.studioId===id),commits:0,commit(){this.commits++;},onChange(){}};
 runtime.playback=new ScenePlayback(runtime);return {runtime,camera,mesh,control:args=>controlScenePlayback(runtime,args)};
}
test('Studio 2 Agent playback uses real Three animation, idempotent controls and exact seek endpoints',async()=>{
 const {runtime,camera,control}=await playbackFixture();
 const selected=control({action:'select',animationIndex:0,target:'camera',cameraId:'camera'});assert.equal(selected.playback.duration,4);assert.equal(selected.playback.time,0);assert.equal(selected.playback.playing,false);assert.equal(runtime.motionIndex,0);assert.equal(runtime.commits,1);
 control({action:'play'});runtime.playback.update(.125);control({action:'play'});assert.equal(runtime.playback.time,.125);assert.equal(runtime.playback.playing,true);assert.equal(camera.position.x,1.25);
 control({action:'pause'});control({action:'pause'});assert.equal(runtime.playback.time,.125);assert.equal(runtime.playback.playing,false);
 control({action:'seek',time:0});assert.equal(camera.position.x,1.125);control({action:'seek',time:4});assert.equal(camera.position.x,5.125);assert.equal(runtime.playback.playing,false);
 control({action:'play'});assert.equal(runtime.playback.time,0);runtime.playback.update(5);assert.equal(runtime.playback.time,4);assert.equal(runtime.playback.playing,false);control({action:'play'});assert.equal(runtime.playback.time,0);assert.equal(runtime.playback.playing,true);
 const original=runtime.animations[0].tracks[0].values.slice();control({action:'seek',time:.375});assert.equal(camera.position.x,1.5);control({action:'stop'});assert.equal(camera.position.x,1.125);assert.equal(runtime.motionIndex,0);assert.equal(runtime.playback.index,-1);assert.deepEqual(runtime.animations[0].tracks[0].values,original);
 control({action:'seek',time:4});assert.equal(camera.position.x,5.125);assert.equal(runtime.playback.playing,false);
});
test('Studio 2 object playback preserves the chosen shot and invalid or busy requests mutate nothing',async()=>{
 const {runtime,camera,mesh,control}=await playbackFixture();control({action:'select',animationIndex:0,target:'camera'});control({action:'seek',time:2});const held=camera.matrixWorld.clone();control({action:'select',animationIndex:1,target:'objects'});assert.equal(runtime.shotId,'camera');assert.equal(runtime.motionIndex,0);assert.ok(runtime.playback.previewCameraMatrix.equals(held));control({action:'seek',time:1.125});assert.equal(mesh.position.x,1.375);
 const snapshot=()=>JSON.stringify({shot:runtime.shotId,motion:runtime.motionIndex,index:runtime.playback.index,time:runtime.playback.time,target:runtime.playback.target,playing:runtime.playback.playing,commits:runtime.commits,camera:camera.position.toArray(),mesh:mesh.position.toArray()}),before=snapshot();
 for(const args of [{action:'select',animationIndex:0,target:'camera',cameraId:'other'},{action:'select',animationIndex:0,target:'objects'},{action:'select',animationIndex:99,target:'camera'},{action:'seek',time:2.01},{action:'seek',time:NaN},{action:'play',time:1}]){assert.throws(()=>control(args));assert.equal(snapshot(),before);}
 for(const field of ['closed','exporting']){runtime[field]=true;assert.throws(()=>control({action:'stop'}));runtime[field]=false;assert.equal(snapshot(),before);}
 runtime.motion.gesture={};assert.throws(()=>control({action:'play'}));runtime.motion.gesture=null;runtime.transform.dragging=true;assert.throws(()=>control({action:'pause'}));runtime.transform.dragging=false;runtime.restoring=true;assert.throws(()=>control({action:'seek',time:0}));runtime.restoring=false;assert.equal(snapshot(),before);
 control({action:'stop'});assert.equal(mesh.position.x,.25);control({action:'play'});assert.equal(runtime.playback.index,0);assert.equal(runtime.playback.target,'camera');
});
