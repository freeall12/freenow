const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');

test('timeline key drag QA loads real precise transforms and a three-key camera motion through production GLB IO',async t=>{
  const [{createTimelineKeyDragModel},{exportGlb,inspectModel,disposeModel,disposeLoadedModel},{ScenePlayback}]=await Promise.all([
    import('../src/features/studio-v2/qa/timeline-key-drag-model.mjs'),import('../src/features/studio-v2/model-io.mjs'),import('../src/features/studio-v2/playback.mjs')]);
  const prior=global.FileReader;global.FileReader=class{readAsArrayBuffer(blob){blob.arrayBuffer().then(value=>{this.result=value;this.onloadend?.();});}};t.after(()=>{global.FileReader=prior;});
  const model=createTimelineKeyDragModel();let blob;try{blob=await exportGlb(model.scene,model.animations);}finally{disposeModel(model.scene);}
  const {loaded}=await inspectModel(new File([blob],'timeline-key-drag.glb'));t.after(()=>disposeLoadedModel(loaded));
  const cube=loaded.scene.children.find(o=>o.userData.studioId==='qa-number-cube');assert.deepEqual(cube.position.toArray(),[2.375432109,.5,-.123456789]);assert.equal(cube.scale.x,1.234567891);
  const catalog=new ScenePlayback({content:loaded.scene,animations:loaded.animations}).catalog();assert.equal(catalog[0].duration,2);assert.deepEqual(catalog[0].cameraIds,['qa-number-camera']);
  assert.equal(loaded.animations.length,2);assert.equal(loaded.animations[0].name,loaded.animations[1].name);assert.deepEqual(catalog[1].cameraIds,['qa-number-camera']);assert.equal(loaded.animations[1].tracks[0].values[0],new Float32Array([15.375432109])[0]);
  const track=loaded.animations[0].tracks[0];assert.equal(track.values[0],new Float32Array([5.375432109])[0]);assert.notEqual(track.values[0],5.375);assert.deepEqual(Array.from(track.times),[0,1,2]);
});

test('timeline key drag QA keeps user storage intact, namespaces local persistence and prevents API/external dispatch',async()=>{
  const source=fs.readFileSync(require.resolve('../src/features/studio-v2/qa/timeline-key-drag-fixture.js'),'utf8'),requests=[],storage={sentinel:'keep'},window={localStorage:storage,fetch:async(...args)=>{requests.push(args[0]);return new Response('local');}},context={window,location:{href:'http://localhost:4173/qa?session=number-test',search:'?session=number-test',origin:'http://localhost:4173'},URL,URLSearchParams,Response,XMLHttpRequest:class{open(){}},navigator:{}};
  vm.runInNewContext(source,context);assert.equal(storage.sentinel,'keep');assert.equal(window.CANVAS_DB_NAME,'qa-studio-timeline-key-drag:number-test:canvas');assert.equal(window.LOCAL_ASSETS_DB_NAME,'qa-studio-timeline-key-drag:number-test:assets');
  assert.equal((await (await window.fetch('/api/agent/config')).json()).configured,false);await window.fetch('/style.css');
  await assert.rejects(()=>window.fetch('/api/generation/tasks'),/禁止/);await assert.rejects(()=>window.fetch('https://example.com/model.glb'),/禁止/);assert.deepEqual(requests,['/style.css']);
  assert.deepEqual(Array.from(window.StudioTimelineKeyDragFixture.blockedAPIs),['/api/generation/tasks']);assert.deepEqual(Array.from(window.StudioTimelineKeyDragFixture.externalAttempts),['example.com']);
  const html=fs.readFileSync(require.resolve('../src/features/studio-v2/qa/timeline-key-drag-main.html'),'utf8');assert.match(html,/Content-Security-Policy/);assert.match(html,/script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval';/);assert.doesNotMatch(html,/'unsafe-eval'/);assert.ok(html.indexOf('timeline-key-drag-fixture.js')<html.indexOf('app.js'));assert.match(html,/src="studio.mjs/);assert.match(html,/timeline-key-drag-controls.mjs/);
});
