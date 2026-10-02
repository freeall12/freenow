const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),{webcrypto}=require('node:crypto');
const path=require('node:path'),{pathToFileURL}=require('node:url');
const clientSource=fs.readFileSync(require.resolve('../agent-client.js'),'utf8');
function sourcePart(from,to){const start=clientSource.indexOf(from),end=clientSource.indexOf(to,start+from.length);assert.ok(start>=0&&end>start,'production dispatcher fragment must exist');return clientSource.slice(start,end);}
const dispatcherSource=[sourcePart(' function execute(...args)', ' function appendResultCards('),sourcePart(' async function graph(){',' let widgetMediaHost;'),sourcePart(' function taskSummary(', ' function close(){')].join('\n').replace(/import\((['"][^'"]+['"])\)/g,'loadModule($1)');
function fixture(){
 const nodes=[{id:'a',type:'text',title:'existing',x:100,y:200}],view={x:-12000,y:1100,scale:.23},calls=[];
 const app={getState:()=>({nodes,edges:[],selected:[],view}),addNode(type,point,image,title){const n={id:'created',type,title,x:(point.x-view.x)/view.scale,y:(point.y-view.y)/view.scale};nodes.push(n);return n;},updateNode(id,patch){Object.assign(nodes.find(n=>n.id===id),patch);},connect:(a,b)=>({source:a,target:b}),remove:ids=>calls.push(['remove',ids]),select:(...args)=>calls.push(['select',args]),undo:()=>calls.push(['undo'])};
 // Exercise the production dispatcher without booting unrelated UI modules.
 // The module loader imports real implementations; only the browser image probe
 // and local asset URL boundary are adapted for this Node-only fixture.
 const assetLookups=[],window={CanvasApp:app,AgentTools:require('../agent-tools.js'),LocalAssets:{url:async id=>{assetLookups.push(id);return 'data:image/png;base64,test';}}},context={window,app,structuredClone,crypto:webcrypto,document:{baseURI:'http://localhost:4173/'},console,DOMException,AbortController,setTimeout,clearTimeout,clone:structuredClone,controller:null,generationModel:null,track:operation=>operation(),flushConversation:async()=>{}};
 context.loadModule=async specifier=>{
  const module=await import(pathToFileURL(path.resolve(__dirname,'..',specifier)).href);
  if(specifier!=='./src/features/agent-generation/media-inputs.mjs')return module;
  const {createWorkflowMediaResolver}=await import('../src/features/agent-workflows/media-resolver.mjs');
  return {prepareAgentMediaInputs:(refs,options)=>module.prepareAgentMediaInputs(refs,{...options,resolveMedia:createWorkflowMediaResolver({...options,createImage:()=>({naturalWidth:640,naturalHeight:360,removeAttribute(){},set src(value){queueMicrotask(()=>this.onload?.());}})})})};
 };
 vm.runInNewContext(dispatcherSource,context);return {...context,app,nodes,view,calls,assetLookups,execute:context.execute};
}
test('new Agent motion and application recovery routes execute the correct APIs without a generation submission',async()=>{
 const f=fixture(),signal=new AbortController().signal;
 f.window.StudioAPI={getState:()=>({objects:[{id:'camera'}]}),execute:async(action,args,options)=>{f.calls.push({action,args,options});return {action};}};
 await f.execute('scene_motion_read',{cameraId:'camera',offset:2,limit:3});assert.equal(f.calls.at(-1).action,'motion');assert.equal(f.calls.at(-1).args.action,'read');
 await f.execute('scene_motion_edit',{action:'move',keyIndex:1,time:2});assert.equal(f.calls.at(-1).args.action,'move');
 await f.execute('scene_export_video',{}, {signal});assert.equal(f.calls.at(-1).action,'motion-export');assert.equal(f.calls.at(-1).options.signal,signal);
 await f.execute('scene_select',{id:'camera'});assert.equal(f.calls.at(-1).action,'select');await assert.rejects(()=>f.execute('scene_select',{id:'missing'}),/不存在/);
 f.window.GenerationAPI={submit:()=>assert.fail('must not regenerate'),retryApplication:async id=>({id,applied:false,applicationStatus:'failed',applicationError:'来源已改变'})};
 const result=await f.execute('generation_retry_application',{id:'existing-job'});assert.equal(result.id,'existing-job');assert.equal(result.applied,false);assert.match(result.applicationError,/来源/);
});
test('Agent panorama operations dispatch normalized regions and reject invalid coordinates',async()=>{const f=fixture();f.window.StudioAPI={execute:async(action,args)=>{f.calls.push([action,args]);return {sessionId:'pano'};}};const result=await f.execute('scene_panorama',{action:'region',rect:{x:.2,y:.3,width:.4,height:.2}});assert.equal(result.sessionId,'pano');assert.equal(f.calls[0][0],'panorama');assert.equal(f.calls[0][1].rect.x,.2);await assert.rejects(()=>f.execute('scene_panorama',{action:'region',rect:{x:-1,y:0,width:.3,height:.3}}),/number/);await assert.rejects(()=>f.execute('scene_panorama',{action:'eval',prompt:'code'}),/unsupported/);});
test('Agent world coordinates do not drift at a transformed canvas zoom',async()=>{const f=fixture();const n=await f.execute('canvas_add',{type:'text',title:'frame',x:52000.25,y:-1350.5,content:'test'});assert.ok(Math.abs(n.x-52000.25)<1e-8);assert.ok(Math.abs(n.y+1350.5)<1e-8);assert.equal(f.nodes.at(-1).content,'test');});
test('browser dispatcher enforces tool schema before mutation',async()=>{const f=fixture();await assert.rejects(()=>f.execute('canvas_update',{id:'a',patch:{x:Infinity}}),/number/);assert.equal(f.nodes[0].x,100);await assert.rejects(()=>f.execute('scene_eval',{code:'alert(1)'}),/Unknown/);});
test('canvas read excludes raw images and video payloads',async()=>{const f=fixture();f.nodes[0].image='data:image/png;base64,secret';const data=await f.execute('canvas_read',{});assert.ok(!JSON.stringify(data).includes('secret'));assert.equal(data.nodes[0].id,'a');});
test('scene tool dispatch reaches actual scene API and returns its result',async()=>{const f=fixture();f.window.StudioAPI={execute:async(action,args)=>{f.calls.push([action,args]);return {id:'actor-real'};}};const r=await f.execute('scene_add',{kind:'actor',properties:{position:[1,-1.7,2]}});assert.equal(r.id,'actor-real');assert.equal(f.calls[0][0],'add');assert.deepEqual(Array.from(f.calls[0][1].properties.position),[1,-1.7,2]);});
test('model generation binds setup, world position and requested media references',async()=>{const f=fixture();f.nodes.push({id:'studio',type:'studio',studio:{activeSetup:'shot-b',ground:{y:-2}}},{id:'ref',type:'image',image:'data:image/png;base64,test'});f.window.GenerationAPI={submit:r=>{f.calls.push(r);return {id:'job',status:'queued'};}};await f.execute('generation_submit',{nodeId:'studio',kind:'model.generate',prompt:'Chair',position:[2,-2,4],referenceIds:['ref']});assert.equal(f.calls[0].parameters.setupId,'shot-b');assert.deepEqual(Array.from(f.calls[0].parameters.position),[2,-2,4]);assert.equal(f.calls[0].inputs[0].url,'data:image/png;base64,test');});
test('agent reports application failure even when provider succeeded',async()=>{const f=fixture();f.window.GenerationAPI={getJobs:()=>[{id:'job',status:'succeeded',applicationError:'GLB invalid',applied:false,resultIds:['model']}]};const result=await f.execute('generation_wait',{id:'job'});assert.equal(result.applied,false);assert.equal(result.applicationError,'GLB invalid');});
test('Agent audio generation uses the shared audio configuration and materialized reference contract',async()=>{
 const f=fixture();f.window.AudioAPI={buildRequest:async(id,args)=>({kind:'audio.generate',nodeId:id,prompt:args.prompt,parameters:{model:'music_v1',music_length_ms:30000,lyrics:'saved lyrics'},inputs:[{type:'audio',url:'data:audio/wav;base64,sample'}]})};
 f.window.GenerationAPI={submit:r=>{f.calls.push(r);return {id:'audio-job',status:'queued'};}};
 const result=await f.execute('generation_submit',{nodeId:'a',kind:'audio.generate',prompt:'folk',duration:30});assert.equal(result.taskId,'audio-job');assert.equal(f.calls[0].parameters.lyrics,'saved lyrics');assert.equal(f.calls[0].parameters.music_length_ms,30000);assert.match(f.calls[0].inputs[0].url,/^data:audio/);
});
test('Agent sample model tools use the same validated scene dispatcher',async()=>{const f=fixture();f.window.StudioAPI={execute:async(action,args)=>{f.calls.push([action,args]);return {id:'sample'};}};await f.execute('scene_library',{query:'树'});await f.execute('scene_sample',{sampleId:'tree-broad-canopy-a',position:[1,-1.7,2],materialMode:'clay'});assert.equal(f.calls[0][0],'library');assert.equal(f.calls[1][0],'sample');assert.equal(f.calls[1][1].materialMode,'clay');assert.deepEqual(Array.from(f.calls[1][1].position),[1,-1.7,2]);});

test('Agent grouping and layout dispatch through the actual canvas interfaces with bounded IDs',async()=>{const f=fixture();f.app.group=ids=>{f.calls.push(['group',ids]);return {id:'g',type:'group',x:100,y:200,width:500,height:300};};f.app.ungroup=id=>f.calls.push(['ungroup',id]);f.app.layoutNodes=(mode,ids)=>{f.calls.push(['layout',mode,ids]);return {ids,width:1000,height:700};};assert.equal((await f.execute('canvas_group',{ids:['a','b']})).id,'g');assert.equal((await f.execute('canvas_layout',{ids:['g'],mode:'horizontal'})).width,1000);assert.equal((await f.execute('canvas_ungroup',{id:'g'})).ungrouped,'g');await assert.rejects(()=>f.execute('canvas_group',{ids:['a']}));await assert.rejects(()=>f.execute('canvas_layout',{ids:['g'],mode:'eval'}));});
test('Agent workflow tools preserve asynchronous status and bounded configuration',async()=>{const f=fixture(),run={status:'running',plan:{executable:['a','b'],layers:[['a'],['b']]},layer:1,completed:[],errors:[]};f.window.WorkflowAPI={start:id=>{f.calls.push(['start',id]);return run;},getRun:()=>run,stop:()=>{run.status='stopping';}};f.window.NodeEditor={setConfig:(id,patch)=>f.calls.push(['config',id,patch])};await f.execute('canvas_generation_config',{id:'a',prompt:'公园',model:'configured-model',duration:5});assert.equal(f.calls[0][2].prompt,'公园');assert.equal((await f.execute('workflow_run',{groupId:'g'})).status,'running');assert.equal((await f.execute('workflow_status',{groupId:'g'})).completed.length,0);assert.equal((await f.execute('workflow_stop',{groupId:'g'})).status,'stopping');await assert.rejects(()=>f.execute('canvas_generation_config',{id:'a',duration:-3}));});
test('Agent template tools return metadata without captured media or graph payload',async()=>{const f=fixture(),t={id:'t',name:'模板',graph:{nodes:[{image:'data:image/png;base64,private'}]}};f.window.TemplateAPI={ready:Promise.resolve(),list:()=>[t],save:async(id,meta)=>({...t,name:meta.name}),use:async()=>({id:'new-group',x:20000.25,y:-1500,width:500,height:500})};assert.ok(!JSON.stringify(await f.execute('templates_list',{})).includes('private'));assert.equal((await f.execute('template_save',{groupId:'g',name:'模板一'})).name,'模板一');assert.equal((await f.execute('template_use',{id:'t'})).x,20000.25);await assert.rejects(()=>f.execute('template_save',{groupId:'g',name:'模板',tags:['1','2','3','4','5','6']}));});

test('Agent text generation delegates to the shared text validator and keeps source-derived settings', async()=>{
 const f=fixture();f.window.TextAPI={setConfig:(id,patch)=>{f.calls.push(['configure',id,patch]);},buildRequest:async(id,overrides)=>({kind:'text.generate',nodeId:id,prompt:overrides.prompt,inputs:[{id:'a',type:'text',text:'reference'}],parameters:{model:'source-model',count:2,reasoning_effort:'high'}})};
 f.window.GenerationAPI={submit:request=>{f.calls.push(['submit',request]);return {id:'text-job',status:'queued'};}};
 await f.execute('canvas_generation_config',{id:'a',count:2,thinkingLevel:'HIGH'});assert.equal(f.calls[0][2].count,2);
 const job=await f.execute('generation_submit',{nodeId:'a',kind:'text.generate',prompt:'scene'});assert.equal(job.taskId,'text-job');assert.equal(f.calls[1][1].parameters.reasoning_effort,'high');
 await assert.rejects(()=>f.execute('canvas_generation_config',{id:'a',count:1.5}));
});

test('Studio 2 Agent generation uses origin and version binding, never a legacy setup',async()=>{
 const f=fixture();f.nodes.push({id:'v2',type:'studio',studioV2:{version:2}});f.window.GenerationAPI={submit:r=>{f.calls.push(r);return {id:'job',status:'queued'};}};
 await f.execute('generation_submit',{nodeId:'v2',kind:'model.generate',prompt:'chair'});
 assert.deepEqual(Array.from(f.calls[0].parameters.position),[0,0,0]);assert.equal(f.calls[0].parameters.sceneBinding.nodeId,'v2');assert.equal(f.calls[0].parameters.setupId,undefined);
 await assert.rejects(()=>f.execute('generation_submit',{nodeId:'v2',kind:'model.generate',prompt:'chair',setupId:'legacy'}),/状态 ID/);
 await assert.rejects(()=>f.execute('generation_submit',{nodeId:'a',kind:'model.generate',prompt:'chair'}),/绑定片场/);
});

test('Studio Agent boundary converts radians without rounding positions and rejects unsupported patches before mutation',async()=>{
 const {agentSceneState,executeStudioTool}=await import('../src/features/agent-scene/studio-bridge.mjs');
 const raw={version:2,capabilities:['read','add','update'],objects:[{id:'cube',rotation:[0,90,0],position:[.123456789,2,3]}]},calls=[];
 const instance={runtime:{read:()=>raw},execute:async(action,args)=>{calls.push({action,args});return {id:'cube',...args.patch};}};
 assert.equal(agentSceneState(instance.runtime).objects[0].rotation[1],Math.PI/2);assert.equal(raw.objects[0].rotation[1],90);
 const result=await executeStudioTool(instance,'update',{id:'cube',patch:{rotation:[0,Math.PI/2,0],position:[.123456789,2,3]}});
 assert.equal(calls[0].args.patch.rotation[1],90);assert.equal(calls[0].args.patch.position[0],.123456789);assert.equal(result.rotation[1],Math.PI/2);
 await assert.rejects(()=>executeStudioTool(instance,'add',{kind:'camera',properties:{focal:50}}),/尚不支持/);
 await assert.rejects(()=>executeStudioTool(instance,'capture'),/尚不支持/);assert.equal(calls.length,1);
});

test('Generated GLBs apply atomically to open/closed Studio 2, preserve coordinates and retry without duplicates',async()=>{
 const THREE=await import('three');const {applyGeneratedModels}=await import('../src/features/studio-v2/generated-models.mjs');const {exportGlb,loadSaved}=await import('../src/features/studio-v2/model-io.mjs');
 const priorWindow=global.window,priorReader=global.FileReader,urls=[];let beforeResolve=()=>{};
 global.FileReader=class{readAsArrayBuffer(blob){blob.arrayBuffer().then(value=>{this.result=value;this.onloadend?.();});}readAsDataURL(blob){blob.arrayBuffer().then(value=>{this.result='data:'+blob.type+';base64,'+Buffer.from(value).toString('base64');this.onloadend?.();});}};
 const objects=new Map(),assets={put:async blob=>{const id='asset:'+objects.size,url=URL.createObjectURL(blob);objects.set(id,url);urls.push(url);return id;},url:async id=>{beforeResolve();return objects.get(id)||id;}};global.window={LocalAssets:assets};
 try{
  const root=new THREE.Group();root.add(new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial()));const source=await assets.put(await exportGlb(root));
  const nodes=[{id:'s',type:'studio',studioV2:{version:2}}];let writes=0,failSave=false;
  const deps={app:{getState:()=>({nodes}),updateNode:(id,patch)=>{Object.assign(nodes.find(n=>n.id===id),patch);writes++;}},assets,store:{flush:async()=>{if(failSave)throw Error('disk full');}},current:()=>null};
  const job={id:'job-1',request:{nodeId:'s',parameters:{position:[2.375,0,-.123456789],sceneBinding:{version:2,nodeId:'s'}}},outputs:[{type:'model',url:source}]};
  failSave=true;await assert.rejects(()=>applyGeneratedModels(job,deps),/disk full/);failSave=false;
  const retry=await applyGeneratedModels(job,deps);assert.equal(retry.alreadyApplied,true);assert.equal(writes,1);
  const restored=await loadSaved(nodes[0].studioV2.asset),batch=restored.scene.getObjectByProperty('name','生成模型');assert.deepEqual(batch.position.toArray(),[2.375,0,-.123456789]);assert.equal(batch.children.length,1);
  const saved=nodes[0].studioV2.asset;await assert.rejects(()=>applyGeneratedModels({...job,id:'bad',outputs:[{type:'model',url:source},{type:'model',url:'data:text/plain,invalid'}]},deps),/无效|有效/);assert.equal(nodes[0].studioV2.asset,saved);
  beforeResolve=()=>{nodes[0].studioV2={...nodes[0].studioV2,grid:false};beforeResolve=()=>{};};await assert.rejects(()=>applyGeneratedModels({...job,id:'stale'},deps),/已更新/);assert.equal(writes,1);
  const {SceneRuntime}=await import('../src/features/studio-v2/runtime.mjs');
  const content=new THREE.Group(),runtime=Object.assign(Object.create(SceneRuntime.prototype),{nodeId:'s',content,animations:[],revision:0,loadStatus:'ready',closed:false,playback:{document:()=>content.clone(true),selectedMotion:()=>null},beginEdit(){this.historyCount=(this.historyCount||0)+1;},focus(){},select(object){this.selected=object;},resetMixer(){},commit(){this.revision++;},flush:async()=>{if(failSave)throw Error('live disk full');}}),instance={nodeId:'s',runtime};
  const live={...deps,current:()=>instance};failSave=true;
  await assert.rejects(()=>applyGeneratedModels({...job,id:'live'},live),/live disk full/);assert.equal(content.children.length,1);assert.equal(runtime.historyCount,1);
  failSave=false;assert.equal((await applyGeneratedModels({...job,id:'live'},live)).alreadyApplied,true);assert.equal(content.children.length,1);assert.deepEqual(content.children[0].position.toArray(),[2.375,0,-.123456789]);
  beforeResolve=()=>{runtime.revision++;beforeResolve=()=>{};};await assert.rejects(()=>applyGeneratedModels({...job,id:'live-stale'},live),/已更新/);assert.equal(content.children.length,1);
  const emptyAsset=await assets.put(await exportGlb(new THREE.Group()));
  const emptyRuntime=Object.assign(Object.create(SceneRuntime.prototype),{saved:{asset:emptyAsset},content:new THREE.Group(),animations:[],playback:{selectedMotion:()=>null},resetMixer(){},onChange(){}});
  emptyRuntime.content.add=object=>{assert.ok(object?.isObject3D,'empty scene restore must not add undefined');};
  await emptyRuntime.initialize();assert.equal(emptyRuntime.loadStatus,'ready');assert.equal(emptyRuntime.content.children.length,0);


 }finally{urls.forEach(URL.revokeObjectURL);global.window=priorWindow;global.FileReader=priorReader;}
});

test('Studio composer subscriptions keep scene drafts separate and unsubscribe on scene disposal',async()=>{
 const {createComposerChannel}=await import('../src/features/agent-scene/composer-channel.mjs');const channel=createComposerChannel(),drafts={a:{text:'one'},b:{text:'two'}},seenA=[],seenB=[];
 const stopA=channel.subscribe('a',value=>seenA.push(value?.text));channel.subscribe('b',value=>seenB.push(value?.text));
 channel.configure({read:id=>drafts[id],write(id,text){drafts[id].text=text;channel.publish();},open(){},submit(){}});
 channel.write('a','中文分镜\n镜头二');assert.equal(seenA.at(-1),'中文分镜\n镜头二');assert.equal(seenB.at(-1),'two');
 stopA();const count=seenA.length;channel.write('b','scene b edited');assert.equal(seenA.length,count);assert.equal(seenB.at(-1),'scene b edited');assert.equal(channel.read('a').text,'中文分镜\n镜头二');
});

test('Generation dispatcher forwards editable image and video parameters without changing references',async()=>{
 const f=fixture();f.nodes.push({id:'ref',type:'image',image:'asset:ref'});f.window.GenerationAPI={submit:request=>{f.calls.push(request);return {id:'job',status:'queued'};}};
 await f.execute('generation_submit',{nodeId:'a',referenceIds:['ref'],kind:'image.generate',prompt:'edited image',model:'nano-banana-flash',aspect:'16:9',count:2,imageSize:'2K',quality:'high'});
 const image=f.calls[0];assert.equal(image.parameters.outputQuality,'high');assert.equal(image.parameters.count,2);assert.equal(image.parameters.imageSize,'2K');assert.equal(image.inputs[0].id,'ref');assert.equal(image.inputs[0].sourceUrl,'asset:ref');assert.equal(image.inputs[0].url,'data:image/png;base64,test');assert.equal(f.nodes.at(-1).image,'asset:ref');assert.deepEqual(f.assetLookups,['asset:ref']);assert.equal(image.nodeId,'a');
 await f.execute('generation_submit',{nodeId:'a',referenceIds:['ref'],kind:'video.generate',prompt:'edited video',model:'seedance-2.0',videoMode:'IMAGE_TO_VIDEO',duration:8,resolution:'1080p',generateAudio:false});
 const video=f.calls[1];assert.equal(video.parameters.duration,8);assert.equal(video.parameters.generateAudio,false);assert.equal(video.parameters.videoMode,'IMAGE_TO_VIDEO');assert.equal(video.parameters.resolution,'1080p');
 await assert.rejects(()=>f.execute('generation_submit',{nodeId:'a',kind:'image.generate',prompt:'bad count',count:1.5}));assert.equal(f.calls.length,2);
});

test('Agent generation cancellation preserves the actual task-service receipt for every lifecycle outcome',async()=>{
 const fixtureValue=fixture(),receipts=[
  {id:'missing',outcome:'not_found',status:null,localCancellationRequested:false,lateResultBlocked:false,providerCancellation:'not_requested'},
  {id:'complete',outcome:'already_terminal',status:'succeeded',localCancellationRequested:false,lateResultBlocked:false,providerCancellation:'not_requested'},
  {id:'running',outcome:'cancel_requested',status:'cancelled',localCancellationRequested:true,lateResultBlocked:true,providerCancellation:'unconfirmed'}
 ];
 fixtureValue.window.GenerationAPI={cancel:id=>receipts.find(receipt=>receipt.id===id)};
 for(const receipt of receipts){const result=await fixtureValue.execute('generation_cancel',{id:receipt.id});assert.equal(result,receipt);assert.equal(result.cancelled,undefined);}
});

test('Agent playback schema rejects mixed semantics and dispatches only the explicit preview action',async()=>{
 const f=fixture();f.window.StudioAPI={execute:(action,args)=>{f.calls.push({action,args});return {version:2,playback:{time:args.time,playing:false}};}};
 const result=await f.execute('scene_playback',{action:'seek',time:.125});assert.equal(result.playback.time,.125);assert.equal(f.calls[0].action,'playback');
 for(const args of [{action:'select',animationIndex:.1,target:'camera'},{action:'select',animationIndex:0},{action:'select',animationIndex:0,target:'objects',cameraId:'camera'},{action:'seek'},{action:'seek',time:1,animationIndex:0},{action:'play',time:1},{action:'seek',time:Infinity}])await assert.rejects(()=>f.execute('scene_playback',args));assert.equal(f.calls.length,1);
 assert.equal(require('../agent-tools.js').parse('scene_playback',{action:'pause'}).definition.mutates,false);
 const {executeStudioTool}=await import('../src/features/agent-scene/studio-bridge.mjs');await assert.rejects(()=>executeStudioTool({runtime:{read:()=>({capabilities:['read']})}},'playback',{action:'play'}),/尚不支持/);
});

test('Agent V2 viewport and lighting use existing tools, keep degree lighting and preflight the entire mixed patch',async()=>{
 const {parse}=require('../agent-tools.js'),{agentSceneState,executeStudioTool,validateLegacyStudioTool}=await import('../src/features/agent-scene/studio-bridge.mjs');
 for(const viewport of [{width:1920,height:1080},{width:1,height:20},{width:20,height:1},null])assert.deepEqual(parse('scene_update',{id:'camera',patch:{viewport}}).args.patch.viewport,viewport);
 for(const viewport of [{width:1.5,height:1},{width:8193,height:8192},{width:1,height:21},{width:21,height:1},{width:10},'16:9'])assert.throws(()=>parse('scene_update',{id:'camera',patch:{viewport}}));
 assert.throws(()=>parse('scene_add',{kind:'camera',properties:{viewport:null}}));
 assert.equal(parse('scene_environment',{lighting:{azimuth:360,elevation:-90}}).args.lighting.elevation,-90);assert.throws(()=>parse('scene_environment',{lighting:{elevation:90.1}}));
 const state={version:2,capabilities:['read','update','environment'],supportedCameraProperties:['viewport'],objects:[{id:'camera',kind:'camera',rotation:[0,90,0]},{id:'mesh',kind:'model',rotation:[0,0,0]}]},calls=[],instance={runtime:{read:()=>state},execute:async(action,args)=>{calls.push({action,args});return action==='update'?{id:args.id,...args.patch}:{lighting:args.lighting};}};
 assert.equal(agentSceneState(instance.runtime).units.lighting,'degrees');assert.deepEqual(agentSceneState(instance.runtime).supportedCameraProperties,['viewport']);
 const result=await executeStudioTool(instance,'update',{id:'camera',patch:{name:'portrait',rotation:[0,Math.PI/2,0],viewport:{width:9,height:16}}});assert.equal(calls[0].args.patch.rotation[1],90);assert.equal(result.rotation[1],Math.PI/2);assert.deepEqual(result.viewport,{width:9,height:16});
 await executeStudioTool(instance,'update',{id:'camera',patch:{viewport:null}});assert.equal(calls[1].args.patch.viewport,null);
 await executeStudioTool(instance,'environment',{lighting:{azimuth:180.125,elevation:-30.25}});assert.equal(calls[2].args.lighting.azimuth,180.125);assert.equal(calls[2].args.lighting.elevation,-30.25);
 for(const [action,args]of [['update',{id:'mesh',patch:{name:'not changed',viewport:null}}],['update',{id:'camera',patch:{name:'not changed',focal:50}}],['environment',{lighting:{azimuth:1,intensity:2}}],['environment',{ground:{grid:false},lighting:{elevation:1}}],['environment',{lighting:{}}]])await assert.rejects(()=>executeStudioTool(instance,action,args));assert.equal(calls.length,3);
 state.supportedCameraProperties=[];await assert.rejects(()=>executeStudioTool(instance,'update',{id:'camera',patch:{viewport:null}}));assert.equal(calls.length,3);
 assert.doesNotThrow(()=>validateLegacyStudioTool('update',{id:'camera',patch:{focal:50,aspect:16/9}}));assert.doesNotThrow(()=>validateLegacyStudioTool('environment',{room:{enabled:true},lighting:{azimuth:359,preset:'studio-soft'}}));
 for(const [action,args]of [['update',{patch:{name:'unchanged',viewport:null}}],['environment',{room:{enabled:false},lighting:{elevation:0}}],['environment',{lighting:{azimuth:360}}]])assert.throws(()=>validateLegacyStudioTool(action,args));
});

test('Agent settings trace retains applied-but-unsaved failure instead of claiming success or safe replay',async()=>{
 const {executeStudioTool}=await import('../src/features/agent-scene/studio-bridge.mjs'),{executeTracedCall}=await import('../src/features/agent-execution/trace.mjs');
 const instance={runtime:{read:()=>({capabilities:['update','environment'],supportedCameraProperties:['viewport'],objects:[{id:'camera',kind:'camera'}]})},execute:async()=>{throw Object.assign(Error('quota'),{applied:true});}};
 let trace;const result=await executeTracedCall({callId:'settings',name:'scene_update',args:{id:'camera',patch:{viewport:null}}},{execute:(_name,args)=>executeStudioTool(instance,'update',args),changed:value=>trace=value});
 assert.equal(trace.status,'error');assert.equal(result.result.applied,true);assert.equal(result.result.entityId,'camera');assert.match(result.result.error,/保存失败/);
 const lighting=await executeStudioTool(instance,'environment',{lighting:{azimuth:1}});assert.equal(lighting.applied,true);assert.equal(lighting.settings,'lighting');
 instance.execute=async()=>{throw Error('invalid');};await assert.rejects(()=>executeStudioTool(instance,'update',{id:'camera',patch:{viewport:null}}),/invalid/);
});
