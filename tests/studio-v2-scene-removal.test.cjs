const test=require('node:test'),assert=require('node:assert/strict');
const modules=Promise.all([import('three'),import('../src/features/studio-v2/scene-removal.mjs'),import('../src/features/studio-v2/model-io.mjs'),import('../src/features/studio-v2/runtime.mjs'),import('../src/features/studio-v2/playback.mjs')]);
async function fixture(){
  const [THREE,{planSceneRemoval},{disposeModel,exportGlb},{SceneRuntime},{ScenePlayback}]=await modules;
  const root=new THREE.Scene(),runtime=Object.create(SceneRuntime.prototype);
  Object.assign(runtime,{content:root,scene:new THREE.Scene(),animations:[],loadStatus:'ready',revision:0,undoStack:[],redoStack:[],lighting:{azimuth:0,elevation:30},grid:{visible:true},motionIndex:-1,shotId:null,shotRatios:{},selected:null,
    motion:{index:-1,close(){this.open=false;},restoreContext(){}},transform:{detach(){},attach(){}},centeredTransform:{detach(){},attach(){}},box:{visible:false,setFromObject(){}},commit(){this.revision++;}});
  runtime.scene.add(root);runtime.playback=new ScenePlayback(runtime);
  const add=(object,name)=>{object.name=name;object.userData.studioId=name;root.add(object);return object;};
  const track=(object,end=1)=>new THREE.VectorKeyframeTrack(object.uuid+'.position',[0,end],[0,0,0,1,0,0]);
  return {THREE,root,runtime,add,track,planSceneRemoval,disposeModel,exportGlb};
}

test('shared skeleton deletion is rejected before history, playback, selection or scene changes',async()=>{
  const f=await fixture(),bone=f.add(new f.THREE.Bone(),'shared-bone'),mesh=f.add(new f.THREE.SkinnedMesh(new f.THREE.BufferGeometry(),new f.THREE.MeshBasicMaterial()),'character');
  mesh.bind(new f.THREE.Skeleton([bone]));f.runtime.selected=bone;
  assert.throws(()=>f.runtime.remove('shared-bone'),/骨骼/);
  assert.equal(bone.parent,f.root);assert.equal(f.runtime.selected,bone);assert.equal(f.runtime.undoStack.length,0);assert.equal(f.runtime.revision,0);
  const complete=f.add(new f.THREE.Group(),'complete-character');complete.add(bone,mesh);
  assert.doesNotThrow(()=>f.planSceneRemoval(f.root,complete,[]));
  f.disposeModel(f.root);
});

test('deleting a subtree removes only its channels and remaps the retained motion, undo restores both',async()=>{
  const f=await fixture(),group=f.add(new f.THREE.Group(),'removed'),removedCamera=f.add(new f.THREE.PerspectiveCamera(),'removed-camera'),remaining=f.add(new f.THREE.PerspectiveCamera(),'remaining-camera');group.add(removedCamera);
  const cubic=f.track(remaining,2);cubic.setInterpolation(f.THREE.InterpolateSmooth);
  f.runtime.animations=[new f.THREE.AnimationClip('removed-only',-1,[f.track(removedCamera)]),new f.THREE.AnimationClip('mixed',-1,[f.track(removedCamera,5),cubic])];
  f.runtime.shotId='remaining-camera';f.runtime.motionIndex=1;f.runtime.motion.index=1;f.runtime.shotRatios={'removed-camera':{width:1,height:1},'remaining-camera':{width:9,height:16}};
  f.runtime.remove('removed');
  assert.equal(f.runtime.animations.length,1);assert.equal(f.runtime.animations[0].name,'mixed');assert.equal(f.runtime.animations[0].duration,2);assert.equal(f.runtime.motionIndex,0);
  assert.equal(f.runtime.animations[0].tracks[0].name,cubic.name);assert.equal(f.runtime.animations[0].tracks[0].getInterpolation(),f.THREE.InterpolateSmooth);
  assert.deepEqual(f.runtime.shotRatios,{'remaining-camera':{width:9,height:16}});assert.equal(f.runtime.undoStack.length,1);
  await f.runtime.undo();
  assert.ok(f.runtime.find('removed-camera'));assert.equal(f.runtime.animations.length,2);assert.equal(f.runtime.motionIndex,1);assert.deepEqual(f.runtime.shotRatios['removed-camera'],{width:1,height:1});
  await f.runtime.undo(true);assert.equal(f.runtime.find('removed-camera'),undefined);assert.equal(f.runtime.animations.length,1);assert.equal(f.runtime.motionIndex,0);
  f.disposeModel(f.runtime.content);
});

test('deletion releases only resources unused by surviving meshes',async()=>{
  const f=await fixture(),sharedGeometry=new f.THREE.BoxGeometry(),sharedTexture=new f.THREE.Texture(),sharedMaterial=new f.THREE.MeshStandardMaterial({map:sharedTexture}),exclusive=new f.THREE.MeshStandardMaterial({map:sharedTexture}),uniqueGeometry=new f.THREE.SphereGeometry();
  const removed=f.add(new f.THREE.Mesh(sharedGeometry,[sharedMaterial,exclusive]),'removed'),remaining=f.add(new f.THREE.Mesh(sharedGeometry,sharedMaterial),'remaining');removed.add(new f.THREE.Mesh(uniqueGeometry,exclusive));
  const events=[];for(const [label,resource]of [['geometry',sharedGeometry],['texture',sharedTexture],['material',sharedMaterial],['exclusive',exclusive],['unique',uniqueGeometry]])resource.addEventListener('dispose',()=>events.push(label));
  f.runtime.remove('removed');assert.deepEqual(events.sort(),['exclusive','unique']);assert.equal(remaining.material,sharedMaterial);
  f.disposeModel(f.root);assert.deepEqual(events.sort(),['exclusive','geometry','material','texture','unique']);
});

test('static gizmo clicks and returned poses preserve undo and redo, actual movement is one transaction',async()=>{
  const f=await fixture(),object=f.add(new f.THREE.Object3D(),'box');f.runtime.selected=object;f.runtime.redoStack.push({checkpoint:true});
  f.runtime.beginTransformGesture();f.runtime.endTransformGesture();assert.equal(f.runtime.undoStack.length,0);assert.equal(f.runtime.redoStack.length,1);assert.equal(f.runtime.revision,0);
  f.runtime.beginTransformGesture();object.position.x=1;object.position.x=0;f.runtime.endTransformGesture();assert.equal(f.runtime.undoStack.length,0);assert.equal(f.runtime.redoStack.length,1);
  f.runtime.beginTransformGesture();object.position.x=2.375;f.runtime.endTransformGesture();assert.equal(f.runtime.undoStack.length,1);assert.equal(f.runtime.redoStack.length,0);assert.equal(f.runtime.revision,1);
  await f.runtime.undo();assert.equal(f.runtime.find('box').position.x,0);await f.runtime.undo(true);assert.equal(f.runtime.find('box').position.x,2.375);
});

test('the remaining animation exports to real GLB channels with reachable target nodes',async t=>{
  const f=await fixture(),removed=f.add(new f.THREE.PerspectiveCamera(),'removed'),remaining=f.add(new f.THREE.PerspectiveCamera(),'remaining');
  f.runtime.animations=[new f.THREE.AnimationClip('removed',-1,[f.track(removed)]),new f.THREE.AnimationClip('remaining',-1,[f.track(remaining)])];f.runtime.remove('removed');
  const prior=global.FileReader;t.after(()=>{global.FileReader=prior;});
  global.FileReader=class{readAsArrayBuffer(blob){blob.arrayBuffer().then(value=>{this.result=value;this.onloadend?.();});}};
  const blob=await f.exportGlb(f.runtime.content,f.runtime.animations),data=await blob.arrayBuffer(),view=new DataView(data),json=JSON.parse(new TextDecoder().decode(data.slice(20,20+view.getUint32(12,true))));
  assert.equal(view.getUint32(0,true),0x46546c67);assert.equal(json.animations.length,1);assert.equal(json.animations[0].name,'remaining');assert.equal(json.animations[0].channels.length,1);
  for(const channel of json.animations[0].channels)assert.equal(json.nodes[channel.target.node].name,'remaining');
});
