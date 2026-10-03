const test=require('node:test'),assert=require('node:assert/strict');
const modules=Promise.all([import('three'),import('../src/features/studio-v2/scene-export.mjs'),import('../src/features/studio-v2/playback.mjs'),import('three/addons/loaders/GLTFLoader.js')]);
const deferred=()=>{let resolve;const promise=new Promise(ready=>resolve=ready);return {promise,resolve};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function runtime(content){return {content,revision:3,sessionId:'session',closed:false,loadStatus:'ready',animations:[],hostNode:{title:'用户片场'},assertReady(){if(this.closed||this.loadStatus!=='ready')throw Error('场景未加载');},assertTargetNode(){if(this.targetChanged)throw Error('来源片场已变化');},async flush(){}};}
test('actual exported GLB reloads transformed mesh, camera, light and playable animation without exporting helpers',async t=>{
 const [THREE,exporter,{cloneDocument},{GLTFLoader}]=await modules,previous=global.FileReader;
 global.FileReader=class{readAsArrayBuffer(blob){blob.arrayBuffer().then(value=>{this.result=value;this.onloadend?.();});}};t.after(()=>{global.FileReader=previous;});
 const content=new THREE.Scene();content.name='用户片场 城市';const group=new THREE.Group();group.name='布景';group.position.set(2,1,-3);group.rotation.y=.4;
 const mesh=new THREE.Mesh(new THREE.BoxGeometry(1,2,3),new THREE.MeshStandardMaterial({color:0xd03827}));mesh.name='真实红色模型';mesh.position.set(1,.5,0);mesh.scale.set(2,1,.5);mesh.userData.studioId='model';group.add(mesh);
 const camera=new THREE.PerspectiveCamera(35,16/9,.1,600);camera.name='用户镜头';camera.position.set(4,3,8);camera.userData.studioId='camera';const light=new THREE.PointLight(0xffffff,2);light.name='用户灯光';light.position.set(1,5,2);content.add(group,camera,light);
 const rt=runtime(content);rt.animations=[new THREE.AnimationClip('用户运镜',2,[new THREE.VectorKeyframeTrack(camera.uuid+'.position',[0,2],[4,3,8,6,3,8])])];rt.playback={document:()=>cloneDocument(content)};
 const blob=await exporter.exportSceneDocument(rt),data=await blob.arrayBuffer();assert.equal(new DataView(data).getUint32(0,true),0x46546c67);assert.equal(new DataView(data).getUint32(8,true),blob.size);
 const loaded=await new GLTFLoader().parseAsync(data,'');loaded.scene.updateMatrixWorld(true);content.updateMatrixWorld(true);const model=loaded.scene.getObjectByName(mesh.name),lens=loaded.scene.getObjectByName(camera.name);
 assert.ok(model?.isMesh);assert.ok(lens?.isPerspectiveCamera);assert.ok(loaded.scene.getObjectByName(light.name)?.isPointLight);assert.deepEqual(model.scale.toArray(),mesh.scale.toArray());assert.ok(model.getWorldPosition(new THREE.Vector3()).distanceTo(mesh.getWorldPosition(new THREE.Vector3()))<1e-6);assert.equal(lens.fov,35);assert.equal(loaded.animations.length,1);
 const mixer=new THREE.AnimationMixer(loaded.scene);mixer.clipAction(loaded.animations[0]).setLoop(THREE.LoopOnce,1).play();mixer.setTime(1);assert.equal(lens.position.x,5);mixer.stopAllAction();assert.equal(lens.position.x,4);assert.equal(loaded.scene.getObjectByName('grid'),undefined);
});
test('size calculation and repeated clicks share one serialization and one download, with scene filename',async()=>{
 const [,exporter]=await modules,pending=deferred(),saved=[],states=[],rt=runtime({name:'城市 / 片场.glb',children:[{}]});let serializations=0;rt.export=async()=>{serializations++;return pending.promise;};
 const controller=exporter.createSceneExportController(rt,{saveFile:(blob,name)=>saved.push({size:blob.size,name}),onChange:state=>states.push(state)}),sizing=controller.prepare(),first=controller.download(),second=controller.download();
 assert.equal(await second,null);assert.equal(controller.state().busy,true);await tick();assert.equal(serializations,1);pending.resolve(new Blob(['GLB actual serialized contents']));await Promise.all([sizing,first]);assert.deepEqual(saved,[{size:30,name:'城市 _ 片场.glb'}]);assert.equal(controller.state().size,30);assert.equal(controller.state().busy,false);assert.ok(states.some(state=>state.calculating));assert.equal(exporter.sceneSize(1500),'1.5 KB');controller.dispose();
});
test('scene change, source replacement or closing while serializing prevents late download and supports a fresh retry',async()=>{
 const [,exporter]=await modules;
 for(const action of [rt=>rt.revision++,rt=>rt.targetChanged=true,rt=>rt.closed=true]){
  const waiting=deferred(),saved=[],rt=runtime({name:'Scene',children:[{}]});rt.export=()=>waiting.promise;const controller=exporter.createSceneExportController(rt,{saveFile:(blob,name)=>saved.push(name)}),operation=controller.download();await tick();action(rt);waiting.resolve(new Blob(['GLB bytes']));await assert.rejects(operation,/变化|更新|未就绪/);assert.deepEqual(saved,[]);controller.dispose();
 }
 const rt=runtime({name:'Scene',children:[{}]});let fails=true;rt.export=async()=>{if(fails)throw Error('encode failed');return new Blob(['retry GLB bytes']);};const saved=[],controller=exporter.createSceneExportController(rt,{saveFile:(_blob,name)=>saved.push(name)});await assert.rejects(()=>controller.download(),/encode/);assert.match(controller.state().error,/encode/);fails=false;await controller.download();assert.deepEqual(saved,['用户片场.glb']);controller.dispose();
});
test('runtime export rejects stale revision across flush or serialization and refuses provisional transform state',async()=>{
 const [,exporter]=await modules;
 for(const stage of ['flush','serialize']){const rt=runtime({children:[{}]});rt.playback={document:()=>({})};rt.flush=async()=>{if(stage==='flush')rt.revision++;};await assert.rejects(()=>exporter.exportSceneDocument(rt,{serialize:async()=>{if(stage==='serialize')rt.revision++;return new Blob(['GLB serialized bytes sufficient']);}}),/场景已更新/);}
 const rt=runtime({children:[{}]});rt.transform={dragging:true};await assert.rejects(()=>exporter.exportSceneDocument(rt),/正在编辑/);assert.equal(exporter.sceneFilename('../城\\市?.glb'),'_城_市_.glb');
});
test('back navigation cancels the pending download before close finishes and a failed close can retry',async()=>{
 const [,exporter]=await modules,waiting=deferred(),rt=runtime({name:'Scene',children:[{}]}),saved=[];rt.export=()=>waiting.promise;
 const controller=exporter.createSceneExportController(rt,{saveFile:(_blob,name)=>saved.push(name)}),operation=controller.download();await tick();controller.cancel();waiting.resolve(new Blob(['real serialized bytes']));await assert.rejects(operation,/场景已更新/);assert.deepEqual(saved,[]);
 rt.export=async()=>new Blob(['current serialized bytes']);await controller.download();assert.deepEqual(saved,['用户片场.glb']);controller.dispose();
});
