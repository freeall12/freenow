const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const transport=import('../src/features/agent-workflows/media-transport.mjs'),serialization=import('../src/features/agent-workflows/local-clip-resolver.mjs');
const source=fs.readFileSync(require.resolve('../video-analysis-ui.mjs'),'utf8').replace(/^import[^\n]+\n/,'').replace('export async function analyze','async function analyze');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function fixture({resolveUrl=async src=>src,availability=async()=>({configured:true}),fetchImpl,manualMetadata=false,manualReader=false,initialJobs=[]}={}){
 const [{prepareWorkflowInputs},{serializeClipBlob}]=await Promise.all([transport,serialization]);
 const nodes=[{id:'video',type:'video',video:'asset:original',clip:{start:2.125,end:5.5},x:12.25,y:44.375}],state={nodes},notices=[],players=[],readers=[],calls=[],jobs=[...initialJobs],targets=new Map(),cancelled=[],timers=new Map(),navigation=[],availabilityCalls=[],configurationCalls=[],resolveCalls=[];
 let project='project-a',subscriber,timerId=0;
 const events=()=>{const listeners=new Map();return{addEventListener(name,fn){if(!listeners.has(name))listeners.set(name,[]);listeners.get(name).push(fn);},emit(name){for(const fn of listeners.get(name)||[])fn();}};};
 const document={...events(),baseURI:'http://localhost:4173/',createElement(tag){assert.equal(tag,'video');const player={duration:8,videoWidth:640,videoHeight:360,releases:0,removeAttribute(){this._src='';},load(){this.releases++;},set src(value){this._src=value;if(!manualMetadata)queueMicrotask(()=>this.onloadedmetadata?.());},get src(){return this._src;}};players.push(player);return player;}};
 class Reader{
  constructor(){this.aborted=false;readers.push(this);}
  readAsDataURL(blob){this.blob=blob;if(!manualReader)queueMicrotask(()=>{this.result='data:video/mp4;base64,AAAA';this.onload?.();});}
  abort(){this.aborted=true;this.onabort?.();}
 }
 const response=()=>({ok:true,headers:{get:()=>null},blob:async()=>new Blob(['video-bytes'],{type:'video/mp4'})});
 const window={...events(),CanvasApp:{getState:()=>state,notify:text=>notices.push(text)},CanvasProjects:{id:()=>project,registerNavigationGuard:guard=>navigation.push(guard)},LocalAssets:{url:src=>{resolveCalls.push(src);return resolveUrl(src);}},GenerationAPI:{getJobs:()=>jobs,availability(options){availabilityCalls.push(options);return availability(options);},configure(){configurationCalls.push(true);},subscribe:fn=>{subscriber=fn;},submitDerived(request,target){target.guard();const job={id:'job-'+jobs.length,request,status:'queued'};jobs.push(job);targets.set(job.id,target);subscriber(job);job.status='running';subscriber(job);return job;},cancel(id){cancelled.push(id);const job=jobs.find(j=>j.id===id);job.status='cancelled';subscriber(job);}}};
 const ctx={window,document,AbortController,DOMException,URL,structuredClone,console,setTimeout(fn,ms){const id=++timerId;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id),prepareWorkflowInputs:(request,options)=>prepareWorkflowInputs(request,{...options,fetchImpl:(url,options)=>{calls.push({url,options});return (fetchImpl||(()=>response()))(url,options);},serialize:(blob,options)=>serializeClipBlob(blob,{...options,createReader:()=>new Reader()})})};
 // Stored assets resolve to the host's Blob URL; original asset identities remain in guards.
 const resolver=window.LocalAssets.url;window.LocalAssets.url=async src=>{const url=await resolver(src);return url==='asset:original'?'blob:http://localhost:4173/original':url;};
 vm.runInNewContext(source,ctx);
 return{window,document,state,notices,players,readers,calls,jobs,targets,cancelled,timers,navigation,availabilityCalls,configurationCalls,resolveCalls,analyze:()=>window.VideoAnalysis.analyze('video'),render:()=>document.emit('canvas:render'),setProject:id=>{project=id;},fire(ms){for(const [id,timer]of [...timers])if(timer.ms===ms&&timers.has(id)){timers.delete(id);timer.fn();}},emitJob(job){subscriber(job);},close(){window.emit('pagehide');}};
}

test('unconfigured analysis opens existing configuration without reading media or submitting a task',async()=>{
 const f=await fixture({availability:async()=>({configured:false})});
 const result=await f.analyze();assert.equal(result.status,'configuration_required');
 assert.equal(f.availabilityCalls.length,1);assert.equal(f.configurationCalls.length,1);
 assert.equal(f.availabilityCalls[0].kind,'video.analyze');
 assert.equal(f.resolveCalls.length,0);assert.equal(f.players.length,0);assert.equal(f.calls.length,0);assert.equal(f.readers.length,0);assert.equal(f.jobs.length,0);
 assert.match(f.notices.at(-1),/待连接/);assert.equal(f.notices.some(text=>text.includes('正在解析')),false);
 assert.equal(f.timers.size,0);assert.equal(f.navigation[0](),null);f.close();
});

test('source changes and page exit cancel delayed availability without late configuration or media reads',async()=>{
 for(const change of ['source','clip','delete','project','pagehide']){
  const held=deferred(),f=await fixture({availability:()=>held.promise}),operation=f.analyze();await tick();
  assert.equal(f.availabilityCalls.length,1);assert.ok(f.navigation[0]());
  if(change==='source')f.state.nodes[0].video='https://media.example/new.mp4';
  else if(change==='clip')f.state.nodes[0].clip.end=7;
  else if(change==='delete')f.state.nodes.length=0;
  else if(change==='project')f.setProject('project-b');
  else f.window.emit('pagehide');
  if(change!=='pagehide')f.render();
  await operation;assert.equal(f.availabilityCalls[0].signal.aborted,true,change);
  held.resolve({configured:false});await tick();
  assert.equal(f.configurationCalls.length,0,change);assert.equal(f.resolveCalls.length,0,change);assert.equal(f.players.length,0,change);assert.equal(f.calls.length,0,change);assert.equal(f.jobs.length,0,change);assert.equal(f.notices.length,0,change);assert.equal(f.timers.size,0,change);assert.equal(f.navigation[0](),null,change);f.close();
 }
});

test('configured retry rereads the current video and builds the complete analysis request',async()=>{
 let configured=false;const f=await fixture({availability:async()=>({configured})});
 assert.equal((await f.analyze()).status,'configuration_required');
 configured=true;f.state.nodes[0].clip={start:1,end:6};f.state.nodes[0].x=45.5;
 const job=await f.analyze();assert.equal(f.availabilityCalls.length,2);assert.equal(f.configurationCalls.length,1);assert.equal(f.resolveCalls.length,1);assert.equal(f.players.length,1);assert.equal(f.calls.length,1);assert.equal(f.jobs.length,1);
 assert.deepEqual(job.request.inputs[0].clip,{start:1,end:6});assert.equal(job.request.inputs[0].duration,8);assert.equal(job.request.inputs[0].width,640);assert.equal(job.request.parameters.nodePosition.x,45.5);assert.equal(job.request.inputs[0].url,'data:video/mp4;base64,AAAA');f.close();
});

test('analysis prepares real bytes once with a fixed clip snapshot and latest fractional position',async()=>{
 const blob=deferred();const f=await fixture({fetchImpl:()=>({ok:true,headers:{get:()=>null},blob:()=>blob.promise})});
 const operation=f.analyze();await tick();assert.equal(f.navigation[0]()!=null,true);assert.equal(f.calls.length,1);f.state.nodes[0].x=71.625;f.state.nodes[0].y=-12.375;
 blob.resolve(new Blob(['pixels'],{type:'video/mp4'}));const job=await operation;
 assert.equal(job.request.inputs[0].url,'data:video/mp4;base64,AAAA');assert.deepEqual(job.request.inputs[0].clip,{start:2.125,end:5.5});assert.notEqual(job.request.inputs[0].clip,f.state.nodes[0].clip);
 assert.equal(job.request.inputs[0].duration,8);assert.deepEqual({...job.request.parameters.nodePosition},{x:71.625,y:-12.375});assert.equal(job.request.parameters.operation,'film_scene_breakdown');assert.equal(job.request.inputs[0].width,640);assert.equal(f.players[0].src,'');assert.equal(f.players[0].releases,1);assert.equal(f.timers.size,0);assert.equal(f.navigation[0](),null);f.close();
});

test('duplicate preparation is blocked and cancelling a pending resolver releases only its own attempt',async()=>{
 const old=deferred(),fresh=deferred();let count=0;const f=await fixture({resolveUrl:()=>++count===1?old.promise:fresh.promise});
 const first=f.analyze();await tick();await f.analyze();assert.equal(count,1);assert.match(f.navigation[0](),/正在准备/);
 f.state.nodes[0].video='https://media.example/new.mp4';f.render();f.state.nodes[0].video='asset:original';f.render();const second=f.analyze();await tick();assert.equal(count,2);await first;assert.match(f.navigation[0](),/正在准备/);
 old.resolve('https://media.example/old.mp4');await tick();assert.equal(f.players.length,0);assert.match(f.navigation[0](),/正在准备/);
 fresh.resolve('https://media.example/current.mp4');const job=await second;assert.equal(job.request.inputs[0].url,'https://media.example/current.mp4');assert.equal(f.jobs.length,1);assert.equal(f.calls.length,0);f.close();
});

test('source or clip replacement and deletion cancel metadata and cannot revive an old metadata handler',async()=>{
 for(const change of ['source','clip','delete']){
  const f=await fixture({manualMetadata:true}),operation=f.analyze();await tick();const player=f.players[0],late=player.onloadedmetadata;
  if(change==='source')f.state.nodes[0].video='https://media.example/changed.mp4';else if(change==='clip')f.state.nodes[0].clip.end=7;else f.state.nodes.length=0;
  f.render();await operation;late();assert.equal(f.jobs.length,0,change);assert.equal(f.calls.length,0,change);assert.equal(player.src,'');assert.equal(player.onloadedmetadata,null);assert.equal(player.onerror,null);assert.equal(player.releases,1);assert.equal(f.timers.size,0);assert.equal(f.navigation[0](),null);f.close();
 }
});

test('project identity rejects equal node IDs and sources during preparation and result application',async()=>{
 for(const stage of ['resolver','submitted']){
  const held=deferred(),f=await fixture(stage==='resolver'?{resolveUrl:()=>held.promise}:{});const operation=f.analyze();await tick();
  if(stage==='resolver'){f.setProject('project-b');held.resolve('https://media.example/same.mp4');await operation;assert.equal(f.jobs.length,0);assert.equal(f.players.length,0);}
  else{const job=await operation;f.setProject('project-b');assert.throws(()=>f.targets.get(job.id).guard(),/来源视频已变化/);f.setProject('project-a');assert.throws(()=>f.targets.get(job.id).guard(),/来源视频已变化/);}
  f.close();
 }
});

test('source restored after submission never revives a stale job or its retry guard',async()=>{
 const f=await fixture(),job=await f.analyze(),target=f.targets.get(job.id);f.state.nodes[0].clip.end=7;f.render();f.state.nodes[0].clip.end=5.5;f.render();assert.throws(target.guard,/来源视频已变化/);assert.throws(()=>f.window.GenerationAPI.submitDerived(job.request,target),/来源视频已变化/);assert.equal(f.jobs.length,1);f.close();
});

test('pagehide aborts metadata, fetch body and serialization without stale notices or writes',async()=>{
 for(const stage of ['metadata','fetch','body','reader']){
  const held=deferred(),options=stage==='metadata'?{manualMetadata:true}:stage==='fetch'?{fetchImpl:()=>held.promise}:stage==='body'?{fetchImpl:()=>({ok:true,headers:{get:()=>null},blob:()=>held.promise})}:{manualReader:true};
  const f=await fixture(options),operation=f.analyze();await tick();const before=f.notices.length;f.window.emit('pagehide');await operation;
  assert.equal(f.jobs.length,0,stage);assert.equal(f.notices.length,before,stage);assert.equal(f.timers.size,0,stage);assert.equal(f.navigation[0](),null,stage);
  if(f.calls.length)assert.equal(f.calls[0].options.signal.aborted,true,stage);if(stage==='reader'){assert.equal(f.readers.length,1);assert.equal(f.readers[0].aborted,true);assert.equal(f.readers[0].onload,null);}
  held.resolve(stage==='fetch'?{ok:true,blob:async()=>new Blob(['late'],{type:'video/mp4'})}:new Blob(['late'],{type:'video/mp4'}));await tick();assert.equal(f.jobs.length,0);f.close();
 }
});

test('preparation deadline settles noncooperative resolver and fetch, reports failure and permits retry',async()=>{
 for(const stage of ['resolver','fetch']){
  const held=deferred(),f=await fixture(stage==='resolver'?{resolveUrl:()=>held.promise}:{fetchImpl:()=>held.promise}),operation=f.analyze();await tick();f.fire(60000);await operation;
  assert.equal(f.jobs.length,0);assert.equal(f.navigation[0](),null);assert.equal(f.timers.size,0);assert.match(f.notices.at(-1),/视频素材准备超时/);if(f.calls.length)assert.equal(f.calls[0].options.signal.aborted,true);f.close();
 }
});

test('metadata timeout, empty dimensions and invalid clip fail before Blob loading or submit',async()=>{
 for(const kind of ['timeout','dimensions','negative','reversed','overrun','nan']){
  const f=await fixture({manualMetadata:true});if(kind==='negative')f.state.nodes[0].clip.start=-1;if(kind==='reversed')f.state.nodes[0].clip.end=1;if(kind==='overrun')f.state.nodes[0].clip.end=9;if(kind==='nan')f.state.nodes[0].clip.end=NaN;
  const operation=f.analyze();await tick();if(kind==='timeout')f.fire(15000);else{if(kind==='dimensions')f.players[0].videoWidth=0;f.players[0].onloadedmetadata();}await operation;
  assert.equal(f.jobs.length,0,kind);assert.equal(f.calls.length,0,kind);assert.match(f.notices.at(-1),kind==='timeout'||kind==='dimensions'?/获取视频时长失败/:/裁切区间无效/);assert.equal(f.players[0].src,'');assert.equal(f.timers.size,0);f.close();
 }
});

test('shared transport refuses oversize inline media before Blob allocation or FileReader',async()=>{
 let reads=0;const f=await fixture({fetchImpl:()=>({ok:true,headers:{get:()=>String(64*1024*1024)},blob:()=>{reads++;return new Blob(['bad']);}})});await f.analyze();assert.equal(reads,0);assert.equal(f.readers.length,0);assert.equal(f.jobs.length,0);assert.match(f.notices.at(-1),/内联预算/);assert.equal(f.calls[0].options.signal.aborted,true);f.close();
});

test('unknown and unapplied successful jobs block duplicate submits; application failure allows a fresh source',async()=>{
 for(const status of ['queued','running','unknown','succeeded']){
  const f=await fixture({initialJobs:[{id:'existing',status,request:{kind:'video.analyze',nodeId:'video'}}]});await f.analyze();assert.equal(f.players.length,0,status);assert.equal(f.jobs.length,1,status);assert.equal(f.timers.size,0);f.close();
 }
 const f=await fixture({initialJobs:[{id:'failed-application',status:'succeeded',applied:false,applicationError:'来源视频已变化',request:{kind:'video.analyze',nodeId:'video'}}]});assert.ok(await f.analyze());assert.equal(f.jobs.length,2);f.close();
});

test('pagehide cancels submitted work, BFCache restore permits fresh work and terminal jobs stop watching',async()=>{
 const f=await fixture(),job=await f.analyze(),target=f.targets.get(job.id),before=f.notices.length;f.window.emit('pagehide');assert.deepEqual(f.cancelled,[job.id]);assert.equal(f.notices.length,before);assert.throws(target.guard,/来源视频已变化/);f.window.emit('pageshow');const next=await f.analyze();assert.ok(next);const currentNotices=f.notices.length;target.didApply();assert.equal(f.notices.length,currentNotices);assert.equal(f.cancelled.length,1);next.status='succeeded';next.applied=true;f.emitJob(next);f.window.emit('pagehide');assert.equal(f.cancelled.length,1);
});

test('retry lifecycle follows the new job ID and observes source edits after a failed provider attempt',async()=>{
 const f=await fixture(),first=await f.analyze(),target=f.targets.get(first.id);first.status='failed';f.emitJob(first);const retry=f.window.GenerationAPI.submitDerived(first.request,target);
 f.state.nodes[0].video='https://media.example/replaced.mp4';f.render();f.state.nodes[0].video='asset:original';f.render();assert.throws(target.guard,/来源视频已变化/);f.window.emit('pagehide');assert.deepEqual(f.cancelled,[retry.id]);
});

test('source changes cancel queued native media reads before provider dispatch and restoration stays invalid',async()=>{
 const f=await fixture({resolveUrl:async()=> 'https://media.example/full.mp4'}),job=await f.analyze(),held=deferred(),controller=new AbortController(),{prepareVideoAnalysisMedia}=await import('../src/features/node-composer/video-analysis-media.mjs'),{prepareWorkflowInputs}=await transport;
 job.status='queued';const cancel=f.window.GenerationAPI.cancel;f.window.GenerationAPI.cancel=id=>{controller.abort(new DOMException('cancelled','AbortError'));cancel(id);};
 const pending=prepareVideoAnalysisMedia(job.request,{signal:controller.signal,baseUrl:f.document.baseURI,nativeConfiguration:{protocol:'openai-native',capabilities:{videoAnalysis:{'video.analyze':{kind:'video.analyze',transport:'inline'}}}},validateSources:f.targets.get(job.id).guard,transport:(request,options)=>prepareWorkflowInputs(request,{...options,fetchImpl:()=>held.promise})});await tick();f.state.nodes[0].clip.end=7;f.render();await assert.rejects(pending,{name:'AbortError'});
 assert.deepEqual(f.cancelled,[job.id]);assert.equal(job.status,'cancelled');f.state.nodes[0].clip.end=5.5;f.render();assert.throws(f.targets.get(job.id).guard,/来源视频已变化/);f.close();
});
