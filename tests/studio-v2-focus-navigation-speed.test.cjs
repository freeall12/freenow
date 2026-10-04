const test=require('node:test'),assert=require('node:assert/strict');
async function fixture(){
  const [THREE,{SceneRuntime},{Navigation},{createFocusNavigationSpeedModel}]=await Promise.all([import('three'),import('../src/features/studio-v2/runtime.mjs'),import('../src/features/studio-v2/navigation.mjs'),import('../src/features/studio-v2/qa/focus-navigation-speed-model.mjs')]);
  const model=createFocusNavigationSpeedModel(),runtime=Object.assign(Object.create(SceneRuntime.prototype),{content:model.scene,camera:new THREE.PerspectiveCamera(50,16/9,.01,10000),controls:{speed:3},revision:7,undoStack:[],redoStack:[{keep:true}],dirty:false});
  const transforms=()=>model.scene.children.map(object=>({position:object.position.toArray(),quaternion:object.quaternion.toArray(),scale:object.scale.toArray()}));
  return {THREE,Navigation,model,runtime,transforms};
}
function near(actual,expected){assert.ok(Math.abs(actual-expected)<1e-10,`${actual} vs ${expected}`);}

test('whole-scene framing sets navigation speed; successive small, large and empty-camera object frames preserve it and authored data',async()=>{
  const f=await fixture(),{THREE,runtime,model}=f,before=f.transforms(),redo=runtime.redoStack[0];
  runtime.focus(model.scene);const radius=new THREE.Box3().setFromObject(model.scene).getSize(new THREE.Vector3()).length()/2;near(runtime.controls.speed,radius);
  for(const object of [model.small,model.large,model.camera]){runtime.focus(object);near(runtime.controls.speed,radius);}
  assert.deepEqual(f.transforms(),before);assert.equal(runtime.revision,7);assert.equal(runtime.undoStack.length,0);assert.equal(runtime.redoStack[0],redo);
  model.large.scale.setScalar(2);runtime.focus(model.large);near(runtime.controls.speed,radius);
  runtime.focus(model.scene);near(runtime.controls.speed,new THREE.Box3().setFromObject(model.scene).getSize(new THREE.Vector3()).length()/2);assert.ok(runtime.controls.speed>radius);
});

test('object framing uses official world bounds, aspect-limited FOV, near/far and world look-at on portrait and landscape viewports',async()=>{
  const f=await fixture(),{THREE,runtime,model}=f;model.scene.position.set(9,2,-7);model.scene.rotation.y=.35;
  for(const aspect of [16/9,9/16])for(const object of [model.small,model.large,model.camera]){
    runtime.camera.aspect=aspect;const box=new THREE.Box3().setFromObject(object),center=box.isEmpty()?object.getWorldPosition(new THREE.Vector3()):box.getCenter(new THREE.Vector3()),radius=Math.max(.5,box.getSize(new THREE.Vector3()).length()/2),vertical=50*Math.PI/180,horizontal=2*Math.atan(Math.tan(vertical/2)*aspect),distance=radius/Math.sin(Math.min(vertical,horizontal)/2)*1.15;
    runtime.focus(object);near(runtime.camera.position.distanceTo(center),distance);near(runtime.camera.near,Math.max(.001,radius/1000));near(runtime.camera.far,Math.max(1000,distance*100));
    near(runtime.camera.getWorldDirection(new THREE.Vector3()).dot(center.clone().sub(runtime.camera.position).normalize()),1);near(runtime.controls.speed,3);
  }
});

test('actual Navigation integration keeps scene-scale one-second WASD distance and Shift multiplier after object focus',async()=>{
  const f=await fixture(),{THREE,runtime,model,Navigation}=f;runtime.focus(model.scene);const speed=runtime.controls.speed;
  for(const object of [model.small,model.large])for(const shift of [false,true]){
    runtime.focus(object);const before=runtime.camera.position.clone(),navigation=Object.assign(Object.create(Navigation.prototype),{camera:runtime.camera,enabled:true,speed:runtime.controls.speed,keys:new Set(['KeyW',...(shift?['ShiftLeft']:[])]),direction:new THREE.Vector3()});
    navigation.update(1);near(runtime.camera.position.distanceTo(before),speed*(shift?3:1));
  }
});
