const test=require('node:test'),assert=require('node:assert/strict');
const modules=Promise.all([import('three'),import('../src/features/studio-v2/scene-picker.mjs'),import('../src/features/studio-v2/runtime.mjs')]);

async function fixture(t){
  const [THREE,{ScenePicker}, {SceneRuntime}]=await modules;
  const stage=new THREE.Scene(),content=new THREE.Group(),extras=new THREE.Group(),overlay=new THREE.Group();stage.background=new THREE.Color('#a0a0a0');stage.add(content,extras,overlay);overlay.visible=true;
  const source=new THREE.MeshBasicMaterial({transparent:true,opacity:.04}),mesh=new THREE.Mesh(new THREE.BoxGeometry(),source),line=new THREE.Line(new THREE.BufferGeometry(),new THREE.LineBasicMaterial()),points=new THREE.Points(new THREE.BufferGeometry(),new THREE.PointsMaterial());
  mesh.userData.studioId='mesh';line.userData.studioId='line';points.userData.studioId='points';content.add(mesh,line,points);
  const helper=new THREE.Mesh(new THREE.BoxGeometry(),[source,new THREE.MeshStandardMaterial()]);extras.userData.studioCameraId='camera';extras.add(helper);
  const target={fixture:'old-target'},viewport=new THREE.Vector4(2,3,50,60),scissor=new THREE.Vector4(4,5,20,30),clear=new THREE.Color('#223344'),reads=[];
  const canvas={width:200,height:200,rect:{left:10,top:20,width:100,height:100,right:110,bottom:120},getBoundingClientRect(){return {...this.rect};}};
  const renderer={domElement:canvas,shadowMap:{enabled:true},target,face:2,level:3,viewport:viewport.clone(),scissor:scissor.clone(),scissorTest:true,clearColor:clear.clone(),clearAlpha:.4,disposed:false,
    getRenderTarget(){return this.target;},getActiveCubeFace(){return this.face;},getActiveMipmapLevel(){return this.level;},getViewport(out){return out.copy(this.viewport);},getScissor(out){return out.copy(this.scissor);},getScissorTest(){return this.scissorTest;},getClearColor(out){return out.copy(this.clearColor);},getClearAlpha(){return this.clearAlpha;},
    setRenderTarget(value,face=0,level=0){this.target=value;this.face=face;this.level=level;},setViewport(...args){this.viewport=args.length===1?args[0].clone():new THREE.Vector4(...args);},setScissor(value){this.scissor=value.clone();},setScissorTest(value){this.scissorTest=value;},setClearColor(value,alpha){this.clearColor=new THREE.Color(value);this.clearAlpha=alpha;},clear(){},render(){},setAnimationLoop(){},dispose(){this.disposed=true;},
    readRenderTargetPixelsAsync(target,x,y,w,h,pixels,face,textureIndex=0){return new Promise((resolve,reject)=>reads.push({target,textureIndex,resolveBytes:value=>{pixels.set(value);resolve(pixels);},resolve:id=>{pixels.set([id&255,id>>8&255,id>>16&255,255]);resolve(pixels);},reject}));}};
  const camera=new THREE.PerspectiveCamera(50,1,.01,1000);camera.position.z=10;camera.updateMatrixWorld(true);
  const picker=new ScenePicker(renderer);let targetDisposes=0;picker.target.addEventListener('dispose',()=>targetDisposes++);
  const original={background:stage.background,source:mesh.material,line:line.material,points:points.material,helper:helper.material};
  const restored=()=>{assert.equal(stage.background,original.background);assert.equal(mesh.material,original.source);assert.equal(line.material,original.line);assert.equal(points.material,original.points);assert.equal(helper.material,original.helper);assert.equal(overlay.visible,true);assert.equal(renderer.shadowMap.enabled,true);assert.equal(renderer.target,target);assert.equal(renderer.face,2);assert.equal(renderer.level,3);assert.deepEqual(renderer.viewport.toArray(),viewport.toArray());assert.deepEqual(renderer.scissor.toArray(),scissor.toArray());assert.equal(renderer.scissorTest,true);assert.equal(renderer.clearColor.getHex(),clear.getHex());assert.equal(renderer.clearAlpha,.4);};
  const map=object=>object.parent===extras?'camera':object.userData.studioId;
  const pick=(mapper=map)=>picker.pick(stage,content,camera,.5,.5,mapper,[extras]);
  t.after(async()=>{for(const read of reads)read.resolve(0);await picker.dispose();stage.traverse(o=>{o.geometry?.dispose();for(const m of o.material?Array.isArray(o.material)?o.material:[o.material]:[])m.dispose();});});
  return {THREE,SceneRuntime,picker,renderer,canvas,stage,content,extras,overlay,mesh,line,points,helper,camera,reads,map,pick,restored,targetDisposes:()=>targetDisposes};
}

test('native Mesh, Line, Points and material arrays receive ID materials; the real shader pipelines keep alpha and original sources remain untouched',async t=>{
  const f=await fixture(t),compiled=[];
  f.renderer.render=(stage,camera)=>{
    assert.equal(f.overlay.visible,false);assert.equal(stage.background,null);assert.equal(camera.view,null);assert.deepEqual(f.picker.target.viewport.toArray(),[-100,-99,200,200]);assert.deepEqual(f.picker.target.scissor.toArray(),[0,0,1,1]);assert.equal(f.picker.target.scissorTest,true);assert.equal(f.picker.target.width,1);assert.equal(f.picker.target.height,1);
    for(const [object,shaderName] of [[f.mesh,'basic'],[f.line,'basic'],[f.points,'points'],[f.helper,'standard']]){
      for(const material of Array.isArray(object.material)?object.material:[object.material]){
        assert.equal(material.blending,f.THREE.NoBlending);assert.equal(material.transparent,false);assert.equal(material.depthWrite,true);assert.equal(material.toneMapped,false);
        const shader={uniforms:{},vertexShader:f.THREE.ShaderLib[shaderName].vertexShader,fragmentShader:f.THREE.ShaderLib[shaderName].fragmentShader};material.onBeforeCompile(shader,f.renderer);assert.match(shader.fragmentShader,/diffuseColor\.a < 0\.05/);assert.match(shader.fragmentShader,/gl_FragColor = vec4\(studioPickColor, 1\.0\)/);compiled.push(shader.uniforms.studioPickColor.value.toArray());
      }
    }
  };
  const pending=f.pick();f.restored();assert.equal(f.mesh.material.opacity,.04);assert.equal(f.picker.pending,1);assert.deepEqual(compiled,[[1/255,0,0],[2/255,0,0],[3/255,0,0],[4/255,0,0],[4/255,0,0]]);f.reads[0].resolve(4);assert.equal(await pending,'camera');f.restored();
});

test('cache reuse copies changed alphaTest, side, maps, alphaMap and colors even when source.version stays unchanged',async t=>{
  const f=await fixture(t),source=f.mesh.material;source.alphaTest=.1;source.map=new f.THREE.Texture();source.alphaMap=new f.THREE.Texture();const first=f.picker.material(source,1),version=source.version;
  source.alphaTest=.9;source.side=f.THREE.DoubleSide;source.map=new f.THREE.Texture();source.alphaMap=new f.THREE.Texture();source.color.set('red');assert.equal(source.version,version);
  const next=f.picker.material(source,1);assert.equal(next,first);assert.equal(next.alphaTest,.9);assert.equal(next.side,f.THREE.DoubleSide);assert.equal(next.map,source.map);assert.equal(next.alphaMap,source.alphaMap);assert.equal(next.color.getHex(),0xff0000);assert.equal(next.blending,f.THREE.NoBlending);assert.notEqual(next,source);
});

test('unmapped geometry is invisible in the ID pass without hiding a mapped descendant; blank or unknown pixels return null',async t=>{
  const f=await fixture(t),child=new f.THREE.Mesh(new f.THREE.BoxGeometry(),new f.THREE.MeshBasicMaterial());child.userData.studioId='child';f.mesh.add(child);f.renderer.render=()=>{assert.equal(f.mesh.visible,true);assert.equal(f.mesh.material.visible,false);assert.equal(child.material.visible,true);};
  for(const pixel of [0,0xffffff]){const pending=f.pick(object=>object===f.mesh?undefined:object.userData.studioId);f.reads.at(-1).resolve(pixel);assert.equal(await pending,null);f.restored();}
});

test('render and GPU read failures restore every changed state and do not strand pending disposal',async t=>{
  const f=await fixture(t);f.renderer.render=()=>{throw Error('render failed');};await assert.rejects(f.pick(),/render failed/);f.restored();assert.equal(f.picker.pending,0);
  f.renderer.render=()=>{};const pending=f.pick();f.restored();f.reads[0].reject(Error('GPU read failed'));await assert.rejects(pending,/GPU read failed/);assert.equal(f.picker.pending,0);await f.picker.dispose();assert.equal(f.targetDisposes(),1);
});

test('overlapping reads keep their own ID mappings and cache invalidation never disposes a pending read target',async t=>{
  const f=await fixture(t),first=f.pick(object=>'first-'+(object.userData.studioId||'helper')),second=f.pick(object=>'second-'+(object.userData.studioId||'helper'));f.restored();f.picker.invalidate();assert.equal(f.targetDisposes(),0);
  f.reads[1].resolve(2);f.reads[0].resolve(1);assert.equal(await first,'first-mesh');assert.equal(await second,'second-line');assert.equal(f.picker.pending,0);
});

test('dispose waits for every pending GPU read including a rejection and releases its target exactly once',async t=>{
  const f=await fixture(t),first=f.pick(),second=f.pick();let disposed=false;const drain=f.picker.dispose().then(()=>disposed=true);assert.equal(f.targetDisposes(),0);assert.equal(await f.pick(),null);
  f.reads[0].reject(Error('context read failed'));await assert.rejects(first,/context read failed/);assert.equal(disposed,false);f.reads[1].resolve(1);assert.equal(await second,null);await drain;assert.equal(disposed,true);assert.equal(f.targetDisposes(),1);await f.picker.dispose();assert.equal(f.targetDisposes(),1);
});

async function runtimeFixture(t){
  const f=await fixture(t),prior=global.window,node={id:'studio',type:'studio',studioV2:{version:2}},nodes=[node];global.window={CanvasApp:{getState:()=>({nodes})}};t.after(()=>global.window=prior);
  const rt=Object.assign(Object.create(f.SceneRuntime.prototype),{nodeId:node.id,hostNode:node,loadStatus:'ready',revision:0,pickRevision:0,closed:false,reloading:false,content:f.content,scene:f.stage,camera:f.camera,renderer:f.renderer,picker:f.picker,animations:[],shotId:null,motionIndex:-1,selected:null,motion:{pick:()=>false,close(){},dispose(){}},transform:{detach(){},attach(){},dispose(){}},centeredTransform:{detach(){},attach(){},dispose(){}},box:{visible:false,setFromObject(){},dispose(){}},cameraPresentations:{layer:f.extras,dispose(){}},playback:{index:-1,target:'camera',time:0,playing:false,catalog:()=>[],stop(){}},errors:[],onError(error){this.errors.push(error);},onChange(){}});
  rt.onChange=(await import('../src/features/studio-v2/scene-picker.mjs')).sceneChangeHandler(rt,rt.onChange);
  return {...f,rt,nodes};
}

test('runtime resolves helpers, prioritizes motion points, selects an actual GPU result and clears an empty click',async t=>{
  const f=await runtimeFixture(t),{rt}=f;rt.motion.pick=()=>true;assert.equal(await rt.pick(50,50),true);assert.equal(f.reads.length,0);rt.motion.pick=()=>false;
  const first=rt.pick(50,50);f.reads[0].resolve(2);assert.equal(await first,true);assert.equal(rt.selected,f.line);
  const second=rt.pick(50,50);f.reads[1].resolve(0);assert.equal(await second,true);assert.equal(rt.selected,null);
});

test('new clicks, explicit selection, document changes and same-ID host replacement invalidate older GPU results',async t=>{
  const f=await runtimeFixture(t),{rt}=f;const first=rt.pick(50,50),second=rt.pick(50,50);f.reads[0].resolve(1);assert.equal(await first,false);f.reads[1].resolve(3);assert.equal(await second,true);assert.equal(rt.selected,f.points);
  for(const change of [()=>rt.select('line'),()=>rt.revision++,()=>{f.nodes[0]={...rt.hostNode};}]){const pending=rt.pick(50,50);change();f.reads.at(-1).resolve(1);assert.equal(await pending,false);assert.notEqual(rt.selected,f.mesh);}assert.match(rt.errors.at(-1).message,/目标片场节点/);
});

test('viewer motion, projection, CSS viewport, drawing buffer and playback pose changes discard a pending pixel without blindly invalidating static frames',async t=>{
  const f=await runtimeFixture(t),{rt}=f;
  for(const change of [()=>rt.camera.position.x++,()=>rt.camera.quaternion.setFromAxisAngle(new f.THREE.Vector3(0,1,0),.2),()=>{rt.camera.fov++;rt.camera.updateProjectionMatrix();},()=>f.canvas.rect.left++,()=>f.canvas.rect.width++,()=>f.canvas.width++,()=>rt.playback.time++,()=>rt.playback.playing=!rt.playback.playing,()=>rt.playback.index++,()=>rt.playback.target='objects']){
    const pending=rt.pick(50,50);change();f.reads.at(-1).resolve(1);assert.equal(await pending,false);assert.equal(rt.selected,null);
  }
  const pending=rt.pick(50,50);rt.camera.updateMatrixWorld(true);f.reads.at(-1).resolve(1);assert.equal(await pending,true);assert.equal(rt.selected,f.mesh);
});

test('runtime close drains the picker before disposing the renderer and ignores the late result',async t=>{
  const f=await runtimeFixture(t),{rt}=f;Object.assign(rt,{saved:{viewer:{}},savedRevision:0,read:()=>({viewer:{}}),flush:async()=>{},abort:{abort(){}},resize:{disconnect(){}},controls:{dispose(){}},grid:{dispose(){}},displayMaterials:{dispose(){}},sun:{shadow:{dispose(){}}}});
  const pending=rt.pick(50,50),closing=rt.close();await Promise.resolve();assert.equal(rt.closed,true);assert.equal(f.renderer.disposed,false);assert.equal(f.targetDisposes(),0);f.reads[0].resolve(1);assert.equal(await pending,false);await closing;assert.equal(f.renderer.disposed,true);assert.equal(f.targetDisposes(),1);assert.equal(rt.selected,null);
});

test('pointer binding filters right clicks and canceled/lost gestures but preserves a left click when navigation releases capture during pointerup',async()=>{
  const {bindScenePicking}=await import('../src/features/studio-v2/scene-picker.mjs'),listeners=new Map(),calls=[];
  const canvas={addEventListener(type,fn,options){const entries=listeners.get(type)||[];entries.push({fn,capture:!!options?.capture});listeners.set(type,entries);}},runtime={invalidatePick(){},transform:{},pick(x,y){calls.push([x,y]);return true;}};bindScenePicking(canvas,runtime,new AbortController().signal);
  const send=(type,fields={},between)=>{const event={pointerId:1,button:0,clientX:20,clientY:30,...fields};for(const entry of listeners.get(type)||[])if(entry.capture)entry.fn(event);between?.();for(const entry of listeners.get(type)||[])if(!entry.capture)entry.fn(event);};
  send('pointerdown',{button:2});send('pointerup',{button:2});send('pointerdown');send('pointercancel');send('pointerup');send('pointerdown');send('lostpointercapture');send('pointerup');assert.equal(calls.length,0);
  send('pointerdown');send('pointerup',{},()=>send('lostpointercapture'));assert.deepEqual(calls,[[20,30]]);
  send('pointerdown');send('pointerup',{clientX:25});assert.equal(calls.length,1);
});


test('continuous playback advances keep click-frame selection, while explicit playback controls invalidate the pending result',async t=>{
  const f=await runtimeFixture(t),{rt}=f;rt.playback.stop=function(){this.playing=false;};rt.playback.playing=true;
  const first=rt.pick(50,50);rt.playback.time+=.02;rt.onChange('playback-tick');f.reads[0].resolve(1);assert.equal(await first,true);assert.equal(rt.selected,f.mesh);assert.equal(rt.playback.playing,false);
  rt.select(null);rt.playback.playing=true;const second=rt.pick(50,50);rt.playback.time=1;rt.playback.playing=false;rt.onChange('playback');rt.playback.playing=true;rt.onChange('playback');f.reads[1].resolve(1);assert.equal(await second,false);assert.equal(rt.selected,null);
});

test('ID rendering keeps real skinned and morph objects, skeleton bindings, influences and native deformation shader source',async t=>{
  const f=await fixture(t),THREE=f.THREE,geometry=new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,1,0,0,0,1,0],3));
  geometry.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(new Uint16Array(12),4));geometry.setAttribute('skinWeight',new THREE.Float32BufferAttribute([1,0,0,0,1,0,0,0,1,0,0,0],4));
  geometry.morphAttributes.position=[new THREE.Float32BufferAttribute([0,0,0,2,0,0,0,2,0],3)];
  const skinSource=new THREE.MeshStandardMaterial({opacity:.4,transparent:true}),skinned=new THREE.SkinnedMesh(geometry,skinSource),bone=new THREE.Bone();skinned.add(bone);skinned.bind(new THREE.Skeleton([bone]));skinned.userData.studioId='skinned';skinned.morphTargetInfluences[0]=.5;
  const morphSource=new THREE.MeshBasicMaterial(),morph=new THREE.Mesh(geometry,morphSource);morph.userData.studioId='morph';morph.morphTargetInfluences[0]=.75;f.content.add(skinned,morph);
  const skeleton=skinned.skeleton,bind=skinned.bindMatrix.clone(),influences=skinned.morphTargetInfluences;
  f.renderer.render=()=>{
    assert.equal(skinned.skeleton,skeleton);assert.ok(skinned.bindMatrix.equals(bind));assert.equal(skinned.geometry,geometry);assert.equal(skinned.morphTargetInfluences,influences);assert.equal(skinned.morphTargetInfluences[0],.5);assert.equal(morph.morphTargetInfluences[0],.75);
    assert.notEqual(skinned.material,skinSource);assert.notEqual(morph.material,morphSource);assert.equal(skinned.material.opacity,.4);
    for(const [object,name] of [[skinned,'standard'],[morph,'basic']]){const shader={uniforms:{},vertexShader:THREE.ShaderLib[name].vertexShader,fragmentShader:THREE.ShaderLib[name].fragmentShader};object.material.onBeforeCompile(shader,f.renderer);assert.equal(shader.vertexShader,THREE.ShaderLib[name].vertexShader);assert.match(shader.vertexShader,/<skinning_vertex>/);assert.match(shader.vertexShader,/<morphtarget_vertex>/);assert.match(shader.fragmentShader,/<alphamap_fragment>/);}
  };
  const pending=f.pick();assert.equal(skinned.material,skinSource);assert.equal(morph.material,morphSource);f.reads[0].resolve(4);assert.equal(await pending,'skinned');assert.equal(skinned.skeleton,skeleton);
});


test('mixed hit uses one native alpha/deformation pass with separate lossless ID and packed depth attachments',async t=>{const f=await fixture(t);f.renderer.render=()=>{assert.equal(f.renderer.target,f.picker.depthTarget);assert.equal(f.picker.depthTarget.textures.length,2);assert.equal(f.overlay.visible,false);const shader={uniforms:{},vertexShader:f.THREE.ShaderLib.basic.vertexShader,fragmentShader:f.THREE.ShaderLib.basic.fragmentShader};f.mesh.material.onBeforeCompile(shader,f.renderer);assert.match(shader.fragmentShader,/layout\(location = 1\) out highp vec4 studioPickDepth/);assert.match(shader.fragmentShader,/packDepthToRGBA\(gl_FragCoord.z\)/);assert.match(shader.fragmentShader,/diffuseColor.a < 0.05/);assert.equal(shader.vertexShader,f.THREE.ShaderLib.basic.vertexShader);};const pending=f.picker.pickHit(f.stage,f.content,f.camera,.5,.5,f.map,[f.extras]);f.restored();assert.deepEqual(f.reads.map(read=>read.textureIndex),[0,1]);f.reads[0].resolve(1);f.reads[1].resolveBytes([64,0,0,0]);assert.deepEqual(await pending,{id:'mesh',depth:.25});});
test('mixed picking drains both GPU fences after one rejects before releasing its MRT target',async t=>{const f=await fixture(t);let released=0;f.picker.depthTarget.addEventListener('dispose',()=>released++);const pending=f.picker.pickHit(f.stage,f.content,f.camera,.5,.5,f.map),closing=f.picker.dispose();f.reads[0].reject(Error('ID fence failed'));await Promise.resolve();assert.equal(released,0);assert.equal(f.picker.pending,1);f.reads[1].resolveBytes([64,0,0,0]);await assert.rejects(pending,/ID fence failed/);await closing;assert.equal(released,1);assert.equal(f.picker.pending,0);f.restored();});
test('mixed runtime compares mesh/Gaussian depth at one physical pixel and a mesh alpha hole exposes the real Gaussian ID',async t=>{const f=await runtimeFixture(t),proxy=new f.THREE.Group();proxy.userData.studioId='gaussian';f.content.add(proxy);let coords;f.rt.splatContext={async settle(){},pick(camera,u,v,options){coords={u,v,root:options.root};return {proxy,depth:.5};}};for(const [id,rgba,expected]of [[1,[64,0,0,0],f.mesh],[1,[192,0,0,0],proxy],[0,[0,0,0,0],proxy]]){const first=f.reads.length,pending=f.rt.pick(50,50);await new Promise(resolve=>setImmediate(resolve));assert.equal(coords.root,f.content);assert.equal(coords.u,.4025);assert.equal(coords.v,.3025);f.reads[first].resolve(id);f.reads[first+1].resolveBytes(rgba);assert.equal(await pending,true);assert.equal(f.rt.selected,expected);}});
