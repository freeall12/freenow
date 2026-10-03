const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const modules=Promise.all([import('three'),import('../src/features/studio-v2/model-io.mjs'),import('../src/features/studio-v2/runtime.mjs'),import('../src/features/studio-v2/scene-animation-bindings.mjs'),import('../src/features/studio-v2/motion-easing.mjs')]);
async function fixture(t){
  const [THREE,io,{SceneRuntime},bindings,easing]=await modules;
  const previous={ProgressEvent:global.ProgressEvent,FileReader:global.FileReader};
  global.ProgressEvent=class extends Event {constructor(type,fields){super(type);Object.assign(this,fields);}};
  global.FileReader=class {readAsArrayBuffer(blob){blob.arrayBuffer().then(value=>{this.result=value;this.onloadend?.();});}};
  t.after(()=>Object.assign(global,previous));
  const file=new File([fs.readFileSync(require.resolve('../qa/studio-v2-multi-scene.gltf'))],'multi.gltf');
  const prepared=await io.inspectModel(file);t.after(()=>io.disposeLoadedModel(prepared.loaded));
  return {THREE,io,SceneRuntime,bindings,easing,prepared};
}

test('a later default scene and either selected scene animate their own shared-node clone, excluding foreign scene tracks',async t=>{
  const f=await fixture(t),{prepared:p,THREE}=f;
  assert.equal(p.defaultScene,1);assert.equal(p.sceneAnimations[0].length,2);assert.equal(p.sceneAnimations[1].length,1);
  assert.equal(p.loaded.animations.length,1);assert.equal(p.loaded.animations,p.sceneAnimations[1]);
  assert.notEqual(p.sceneAnimations[0][0].tracks[0].name,p.sceneAnimations[1][0].tracks[0].name);
  for(let index=0;index<2;index++){
    const scene=p.loaded.scenes[index],clip=p.sceneAnimations[index][0],node=THREE.PropertyBinding.findNode(scene,THREE.PropertyBinding.parseTrackName(clip.tracks[0].name).nodeName),mixer=new THREE.AnimationMixer(scene);
    assert.ok(node);mixer.clipAction(clip).setLoop(THREE.LoopOnce,1).play();mixer.setTime(1);
    assert.equal(node.position.x,1);mixer.stopAllAction();mixer.uncacheRoot(scene);
    let adopted;const runtime=Object.assign(Object.create(f.SceneRuntime.prototype),{addObject:async(...args)=>{adopted=args;return {id:'adopted'};}});
    await runtime.importPrepared(p,index);assert.equal(adopted[0],scene);assert.equal(adopted[2],p.sceneAnimations[index]);
  }
});

test('scoped clip clones preserve custom easing and cubic interpolation while remaining independent',async t=>{
  const f=await fixture(t),{THREE}=f,source=f.prepared.sceneAnimations[0][0];
  f.easing.installEasing(source.tracks[0],{curve:[.42,0,.58,1],duration:2});
  const sets=f.bindings.cloneSceneAnimations([source],[[['a.position']],[['b.position']]]);
  for(const clips of sets)assert.deepEqual(f.easing.easingOf(clips[0].tracks[0]),{curve:[.42,0,.58,1],duration:2});
  sets[0][0].tracks[0].values[0]=99;assert.equal(sets[1][0].tracks[0].values[0],0);
  const cubic=new THREE.VectorKeyframeTrack('source.position',[0,1],[0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0]);
  cubic.createInterpolant=function(){return {evaluate:()=>[.25,0,0]};};cubic.createInterpolant.isInterpolantFactoryMethodGLTFCubicSpline=true;
  const cloned=f.bindings.cloneSceneAnimations([new THREE.AnimationClip('cubic',1,[cubic])],[[['target.position']]])[0][0].tracks[0];
  assert.equal(cloned.createInterpolant,cubic.createInterpolant);assert.deepEqual(cloned.createInterpolant().evaluate(.5),[.25,0,0]);
});

test('official sampler easing extras survive shared-root cloning even when scene associations were reduced',async t=>{
  const f=await fixture(t),json=JSON.parse(fs.readFileSync(require.resolve('../qa/studio-v2-multi-scene.gltf'),'utf8'));
  json.animations[0].samplers[0].extras={tapnow_easing_v1:{times:[0,1,2],values:[0,0,0,1,0,0,2,0,0],interpolation:'LINEAR',easing:{curve:[.52,0,.67,.91],duration:2}}};
  const p=await f.io.inspectModel(new File([JSON.stringify(json)],'easing-multi.gltf'));t.after(()=>f.io.disposeLoadedModel(p.loaded));
  for(const clips of p.sceneAnimations){const track=clips[0].tracks[0];assert.deepEqual(f.easing.easingOf(track),{curve:[.52,0,.67,.91],duration:2});assert.deepEqual([...track.times],[0,1,2]);}
});

test('easing binds the canonical source even when the later scene finishes first and adopts the original rig',async t=>{
  const f=await fixture(t),{GLTFLoader}=await import('three/addons/loaders/GLTFLoader.js'),original=GLTFLoader.prototype.parseAsync;
  GLTFLoader.prototype.parseAsync=function(...args){
    this.register(parser=>{const read=parser.getDependency;parser.getDependency=function(type,index){const value=read.apply(this,arguments);return type==='node'&&index===3?Promise.resolve(value).then(result=>new Promise(resolve=>setTimeout(()=>resolve(result),10))):value;};return {name:'qa_scene_parse_order'};});
    return original.apply(this,args);
  };
  t.after(()=>GLTFLoader.prototype.parseAsync=original);
  const json=JSON.parse(fs.readFileSync(require.resolve('../qa/studio-v2-multi-scene.gltf'),'utf8'));
  json.animations[0].samplers[0].extras={tapnow_easing_v1:{times:[0,1,2],values:[0,0,0,1,0,0,2,0,0],interpolation:'LINEAR',easing:{curve:[.52,0,.67,.91],duration:2}}};
  const p=await f.io.inspectModel(new File([JSON.stringify(json)],'parse-order.gltf'));t.after(()=>f.io.disposeLoadedModel(p.loaded));
  const source=await p.loaded.parser.getDependency('node',2);assert.equal(source.parent,p.loaded.scenes[1]);
  for(const clips of p.sceneAnimations)assert.deepEqual(f.easing.easingOf(clips[0].tracks[0]),{curve:[.52,0,.67,.91],duration:2});
});

test('unnamed shared roots and child animation targets bind to the later scene clone by source hierarchy',async t=>{
  const f=await fixture(t),json=JSON.parse(fs.readFileSync(require.resolve('../qa/studio-v2-multi-scene.gltf'),'utf8'));
  delete json.nodes[2].name;delete json.nodes[1].name;
  const child=structuredClone(json.animations[0]);child.name='unnamed child';child.channels[0].target.node=1;json.animations.push(child);
  const p=await f.io.inspectModel(new File([JSON.stringify(json)],'unnamed-multi.gltf'));t.after(()=>f.io.disposeLoadedModel(p.loaded));
  assert.equal(p.sceneAnimations[1].length,2);
  for(const clip of p.sceneAnimations[1]){
    const track=clip.tracks[0],node=f.THREE.PropertyBinding.findNode(p.loaded.scene,f.THREE.PropertyBinding.parseTrackName(track.name).nodeName);assert.ok(node);
    const mixer=new f.THREE.AnimationMixer(p.loaded.scene);mixer.clipAction(clip).setLoop(f.THREE.LoopOnce,1).play();mixer.setTime(1);assert.equal(node.position.x,1);mixer.stopAllAction();mixer.uncacheRoot(p.loaded.scene);
  }
});

test('the selected scene survives unchosen-scene cleanup and exports with its matching camera motion',async t=>{
  const f=await fixture(t),{THREE,prepared:p}=f,content=new THREE.Scene(),selected=p.loaded.scenes[1];content.add(selected);
  const unused=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial());p.loaded.scenes[0].add(unused);
  const counters={keptGeometry:0,keptMaterial:0,unusedGeometry:0,unusedMaterial:0};let retainedMesh;selected.traverse(node=>{if(node.isMesh)retainedMesh=node;});
  retainedMesh.geometry.addEventListener('dispose',()=>counters.keptGeometry++);retainedMesh.material.addEventListener('dispose',()=>counters.keptMaterial++);
  unused.geometry.addEventListener('dispose',()=>counters.unusedGeometry++);unused.material.addEventListener('dispose',()=>counters.unusedMaterial++);
  f.io.disposeLoadedModel(p.loaded,{retain:content});assert.deepEqual(counters,{keptGeometry:0,keptMaterial:0,unusedGeometry:1,unusedMaterial:1});
  const glb=await f.io.exportGlb(content,p.sceneAnimations[1]),roundtrip=await f.io.inspectModel(new File([glb],'restored.glb'));t.after(()=>f.io.disposeLoadedModel(roundtrip.loaded));
  assert.equal(roundtrip.loaded.animations.length,1);const clip=roundtrip.loaded.animations[0],node=THREE.PropertyBinding.findNode(roundtrip.loaded.scene,THREE.PropertyBinding.parseTrackName(clip.tracks[0].name).nodeName);
  assert.ok(node);const mixer=new THREE.AnimationMixer(roundtrip.loaded.scene);mixer.clipAction(clip).setLoop(THREE.LoopOnce,1).play();mixer.setTime(1);assert.equal(node.position.x,1);mixer.stopAllAction();mixer.uncacheRoot(roundtrip.loaded.scene);
});
