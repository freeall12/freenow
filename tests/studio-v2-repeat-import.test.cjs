const test=require('node:test'),assert=require('node:assert/strict');

test('the same exported GLB imported twice gets independent Studio IDs while UUID animation and camera associations remain intact',async t=>{
  const THREE=await import('three'),{SceneRuntime}=await import('../src/features/studio-v2/runtime.mjs'),{ScenePlayback}=await import('../src/features/studio-v2/playback.mjs'),io=await import('../src/features/studio-v2/model-io.mjs');
  const oldReader=global.FileReader;global.FileReader=class {readAsArrayBuffer(blob){blob.arrayBuffer().then(value=>{this.result=value;this.onloadend?.();});}};t.after(()=>global.FileReader=oldReader);
  const source=new THREE.Group(),rig=new THREE.Group(),camera=new THREE.PerspectiveCamera(),cube=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial());source.add(rig);rig.add(camera,cube);
  const oldIds=['export-root','export-rig','export-camera','export-cube'];[source,rig,camera,cube].forEach((node,index)=>node.userData.studioId=oldIds[index]);
  rig.userData.importProvenance={source:'local-export'};camera.userData.tapnow_motion_source_node=7;
  const clip=new THREE.AnimationClip('move',2,[new THREE.VectorKeyframeTrack(rig.uuid+'.position',[0,2],[0,0,0,2,0,0])]),blob=await io.exportGlb(source,[clip]);
  const first=await io.inspectModel(new File([blob],'first.glb')),second=await io.inspectModel(new File([blob],'second.glb'));
  const content=new THREE.Scene(),runtime=Object.assign(Object.create(SceneRuntime.prototype),{content,scene:new THREE.Scene(),animations:[],revision:0,selected:null,shotId:null,shotRatios:{},motionIndex:-1,
    loadStatus:'ready',undoStack:[],redoStack:[],motion:{close(){}},transform:{detach(){},attach(){}},centeredTransform:{detach(){},attach(){}},box:{setFromObject(){}},
    snapshot:()=>({}),focus(){},commit(){this.revision++;},async flush(){this.savedRevision=this.revision;}});
  runtime.playback=new ScenePlayback(runtime);
  t.after(()=>{io.disposeLoadedModel(first.loaded);io.disposeLoadedModel(second.loaded);io.disposeModel(source);});
  const firstUUIDs=[];first.loaded.scene.traverse(node=>firstUUIDs.push(node.uuid));const secondUUIDs=[];second.loaded.scene.traverse(node=>secondUUIDs.push(node.uuid));
  await runtime.importPrepared(first,first.defaultScene);await runtime.importPrepared(second,second.defaultScene);
  assert.equal(content.children.length,2);const objects=runtime.objects(),ids=objects.map(node=>node.id);assert.equal(new Set(ids).size,ids.length);assert.equal(ids.some(id=>oldIds.includes(id)),false);
  const afterFirst=[];first.loaded.scene.traverse(node=>afterFirst.push(node.uuid));const afterSecond=[];second.loaded.scene.traverse(node=>afterSecond.push(node.uuid));assert.deepEqual(afterFirst,firstUUIDs);assert.deepEqual(afterSecond,secondUUIDs);
  const rigs=[];for(const imported of content.children){let importedRig;imported.traverse(node=>{if(node.userData.importProvenance)importedRig=node;});assert.ok(importedRig);assert.deepEqual(importedRig.userData.importProvenance,{source:'local-export'});rigs.push(importedRig);const importedCamera=imported.getObjectByProperty('isCamera',true);assert.equal(importedCamera.userData.tapnow_motion_source_node,7);}
  const catalog=runtime.playback.catalog();assert.equal(catalog.length,2);assert.equal(catalog[0].cameraIds.length,1);assert.equal(catalog[1].cameraIds.length,1);assert.notEqual(catalog[0].cameraIds[0],catalog[1].cameraIds[0]);
  runtime.shotId=catalog[1].cameraIds[0];runtime.playback.select(1,'camera',{play:false});runtime.playback.seek(1);
  assert.equal(rigs[1].position.x,1);assert.equal(rigs[0].position.x,0);runtime.playback.stop();
});
