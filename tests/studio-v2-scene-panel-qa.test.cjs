const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('synthetic QA GLB reloads real 151 meshes, 120 cameras and 120 bound motions through production loader',async t=>{
 const [{createScenePanelModel},{exportGlb,inspectModel,disposeModel,disposeLoadedModel},{ScenePlayback}]=await Promise.all([import('../src/features/studio-v2/qa/scene-panel-model.mjs'),import('../src/features/studio-v2/model-io.mjs'),import('../src/features/studio-v2/playback.mjs')]);
 const previous=global.FileReader;global.FileReader=class{readAsArrayBuffer(blob){blob.arrayBuffer().then(value=>{this.result=value;this.onloadend?.();});}};t.after(()=>{global.FileReader=previous;});
 const model=createScenePanelModel();let blob;try{blob=await exportGlb(model.scene,model.animations);}finally{disposeModel(model.scene);}
 const {loaded}=await inspectModel(new File([blob],'panel.glb'));t.after(()=>disposeLoadedModel(loaded));
 assert.equal(new DataView(await blob.arrayBuffer()).getUint32(0,true),0x46546c67);assert.equal(loaded.scene.children.length,model.expected.rootChildren);
 let meshes=0,cameras=0,group;loaded.scene.traverse(object=>{if(object.isMesh)meshes++;if(object.isCamera)cameras++;if(object.userData.studioId===model.expected.modelGroupId)group=object;});
 assert.equal(meshes,model.expected.meshes);assert.equal(cameras,model.expected.cameras);assert.equal(group.name,'QA 分页模型组');assert.equal(group.children.length,151);assert.equal(group.children[150].name,'QA 模型 151');
 const runtime={content:loaded.scene,animations:loaded.animations},catalog=new ScenePlayback(runtime).catalog();assert.equal(catalog.length,120);
 assert.deepEqual(catalog.map(clip=>clip.cameraIds),Array.from({length:120},(_,i)=>['qa-panel-camera-'+i]));assert.deepEqual(catalog.map(clip=>clip.duration),Array(120).fill(2));assert.equal(catalog[119].name,'QA 运镜 120');
});
test('scene panel QA reads public active getter and actual renderer canvas instead of nonexistent runtime.canvas',()=>{
 const source=fs.readFileSync(require.resolve('../src/features/studio-v2/qa/scene-panel-controls.mjs'),'utf8'),entry=source.match(/const active=\(\)=>[^;]+;/)?.[0];assert.ok(entry);
 const runtime={nodeId:'scene'},context={window:{StudioAPI:{get active(){return this.instance;},instance:{runtime}}}};vm.runInNewContext(entry+'this.readActive=active;',context);assert.equal(context.readActive(),runtime);context.window.StudioAPI.instance=null;assert.equal(context.readActive(),undefined);delete context.window.StudioAPI;assert.equal(context.readActive(),undefined);
 assert.match(source,/runtime\.renderer\.domElement\.closest/);assert.doesNotMatch(source,/runtime\.canvas/);
});
test('QA isolation routes only local static and unconfigured reads, records forbidden attempts without sending them',async()=>{
 const source=fs.readFileSync(require.resolve('../src/features/studio-v2/qa/scene-panel-fixture.js'),'utf8'),requests=[],originalStorage={sentinel:'keep'},window={localStorage:originalStorage,fetch:async(...args)=>{requests.push(args[0]);return new Response('local');}},context={window,location:{href:'http://localhost:4173/qa?session=panel-test',search:'?session=panel-test',origin:'http://localhost:4173'},URL,URLSearchParams,Response,XMLHttpRequest:class{open(){}},navigator:{}};
 vm.runInNewContext(source,context);assert.equal(window.CANVAS_DB_NAME,'qa-studio-scene-panel:panel-test:canvas');assert.equal(window.LOCAL_ASSETS_DB_NAME,'qa-studio-scene-panel:panel-test:assets');assert.equal(originalStorage.sentinel,'keep');
 const config=await (await window.fetch('/api/generation/config')).json();assert.equal(config.configured,false);assert.equal(requests.length,0);
 await window.fetch('/style.css');assert.deepEqual(requests,['/style.css']);await assert.rejects(()=>window.fetch('/api/generation/tasks'),/禁止/);await assert.rejects(()=>window.fetch('https://example.com/image'),/禁止/);assert.deepEqual(requests,['/style.css']);assert.equal(window.StudioScenePanelFixture.blockedAPIs[0],'/api/generation/tasks');assert.equal(window.StudioScenePanelFixture.externalAttempts[0],'example.com');
});
