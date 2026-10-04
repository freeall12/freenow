const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');

test('focus navigation speed QA imports real large/small GLB objects and preserves their IDs and bounds',async t=>{
 const [THREE,{createFocusNavigationSpeedModel},{exportGlb,inspectModel,disposeModel,disposeLoadedModel},{SceneRuntime}]=await Promise.all([import('three'),import('../src/features/studio-v2/qa/focus-navigation-speed-model.mjs'),import('../src/features/studio-v2/model-io.mjs'),import('../src/features/studio-v2/runtime.mjs')]);
 const prior=global.FileReader;global.FileReader=class{readAsArrayBuffer(blob){blob.arrayBuffer().then(value=>{this.result=value;this.onloadend?.();});}};t.after(()=>{global.FileReader=prior;});
 const model=createFocusNavigationSpeedModel();let blob;try{blob=await exportGlb(model.scene,model.animations);}finally{disposeModel(model.scene);}
 const {loaded}=await inspectModel(new File([blob],'focus-navigation-speed.glb'));t.after(()=>disposeLoadedModel(loaded));assert.equal(loaded.animations.length,0);
 const small=loaded.scene.children.find(o=>o.userData.studioId==='qa-focus-small'),large=loaded.scene.children.find(o=>o.userData.studioId==='qa-focus-large');assert.ok(small);assert.ok(large);assert.deepEqual(small.position.toArray(),[-4,.2,0]);assert.deepEqual(large.position.toArray(),[40,-.1,0]);
 assert.ok(new THREE.Box3().setFromObject(large).getSize(new THREE.Vector3()).length()>100*new THREE.Box3().setFromObject(small).getSize(new THREE.Vector3()).length());
 const runtime=Object.assign(Object.create(SceneRuntime.prototype),{content:loaded.scene,camera:new THREE.PerspectiveCamera(50,16/9),controls:{speed:3}});runtime.focus(loaded.scene);const speed=runtime.controls.speed;runtime.focus(small);assert.equal(runtime.controls.speed,speed);runtime.focus(large);assert.equal(runtime.controls.speed,speed);
});

test('focus navigation speed QA keeps user storage intact, namespaces local persistence and prevents API/external dispatch',async()=>{
  const source=fs.readFileSync(require.resolve('../src/features/studio-v2/qa/focus-navigation-speed-fixture.js'),'utf8'),requests=[],storage={sentinel:'keep'},window={localStorage:storage,fetch:async(...args)=>{requests.push(args[0]);return new Response('local');}},context={window,location:{href:'http://localhost:4173/qa?session=number-test',search:'?session=number-test',origin:'http://localhost:4173'},URL,URLSearchParams,Response,XMLHttpRequest:class{open(){}},navigator:{}};
  vm.runInNewContext(source,context);assert.equal(storage.sentinel,'keep');assert.equal(window.CANVAS_DB_NAME,'qa-studio-focus-navigation-speed:number-test:canvas');assert.equal(window.LOCAL_ASSETS_DB_NAME,'qa-studio-focus-navigation-speed:number-test:assets');
  assert.equal((await (await window.fetch('/api/agent/config')).json()).configured,false);await window.fetch('/style.css');
  await assert.rejects(()=>window.fetch('/api/generation/tasks'),/禁止/);await assert.rejects(()=>window.fetch('https://example.com/model.glb'),/禁止/);assert.deepEqual(requests,['/style.css']);
  assert.deepEqual(Array.from(window.StudioFocusNavigationSpeedFixture.blockedAPIs),['/api/generation/tasks']);assert.deepEqual(Array.from(window.StudioFocusNavigationSpeedFixture.externalAttempts),['example.com']);
  const html=fs.readFileSync(require.resolve('../src/features/studio-v2/qa/focus-navigation-speed-main.html'),'utf8');assert.match(html,/Content-Security-Policy/);assert.match(html,/script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval';/);assert.doesNotMatch(html,/'unsafe-eval'/);assert.ok(html.indexOf('focus-navigation-speed-fixture.js')<html.indexOf('app.js'));assert.match(html,/src="studio.mjs/);assert.match(html,/focus-navigation-speed-controls.mjs/);
});
