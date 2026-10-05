'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const {TaskService}=require('../generation-api.js');
const gate=()=>{let release;const promise=new Promise(r=>release=r);return {promise,release};},tick=()=>new Promise(r=>setImmediate(r));
async function setup({availability,configuration,isConfigured,resolveMedia,generate,failApply=false,failSave=false,beforeSave}={}){
 const core=await import('../src/features/video-creation/core.mjs'),{extensionRequestState}=await import('../src/features/video-creation/native-profile.mjs'),{prepareExtensionMedia}=await import('../src/features/video-creation/media.mjs'),{createApplicationRunner}=await import('../src/features/generation-results/application.mjs');
 const {createExtensionApplication}=await import('../src/features/video-creation/application.mjs');
 const node={id:'source',type:'video',video:'https://media.test/input.mp4',generation:{resolution:'1080p',generateAudio:false}},nodes=[node],edges=[],targets=new Map(),notifications=[];
 let project='p',reads=0,posts=0,connected=0,saves=0,flushes=0,lastRequest;
 const app={getState:()=>({nodes,edges}),projectIdentity:()=>({id:project}),render(){},notify:message=>notifications.push(message),createConnected(id,outputs){if(failApply){failApply=false;throw Error('fixture save rejected before graph insertion');}connected++;const added=outputs.map(output=>({...output,id:'derived',sourceId:id}));nodes.push(...added);edges.push({id:'edge',source:id,target:added[0].id});return added;}};
 const store={save:async(snapshot,id,{beforeCommit}={})=>{saves++;assert.equal(id,'p');assert.equal(snapshot.nodes,nodes);beforeSave?.({nodes,edges});beforeCommit?.();if(failSave){failSave=false;throw Error('CanvasStore transaction rejected');}},flush:async()=>{flushes++;}};
 const service=new TaskService({prepareInputs:(request,context)=>prepareExtensionMedia(request,{...context,resolveMedia:async()=>{reads++;return resolveMedia?resolveMedia():{url:node.video,width:1280,height:720,duration:5};},transport:async r=>r})});
 service.setProvider({isConfigured:isConfigured||(async()=>true),generate:async r=>{posts++;lastRequest=r;return generate?generate(r):{outputs:[{type:'video',url:'https://media.test/output.mp4'}]};}});
 const runner=createApplicationRunner({getJob:id=>service.jobs.get(id),apply:async job=>{const target=targets.get(job.id);target.guard();job.resultIds=(await target.apply(job.outputs[0])).map(node=>node.id);},changed:job=>{const target=targets.get(job.id);if(target&&!job.applying){if(job.applicationError)target.reject(Error(job.applicationError));else target.resolve(job);}}});
 service.subscribe(value=>{const target=targets.get(value.id);if(!target)return;if(value.status==='succeeded')void runner.run(value.id);else if(['failed','cancelled','unknown','configuration_required'].includes(value.status))target.reject(Object.assign(Error(value.error||value.status),{code:value.status}));});
 // Execute the exact shared receipt gate and signal bridge. Only DOM/media
 // application plumbing and provider/storage boundaries remain test doubles.
 const shared=fs.readFileSync(path.join(__dirname,'../generation-ui.js'),'utf8'),start=shared.indexOf('  function runInPlace('),end=shared.indexOf('  function recoverInPlace(',start);assert(start>=0&&end>start);
 const runInPlace=vm.runInNewContext('('+shared.slice(start,end).trim()+')',{app,service,inPlace:targets,submitJob:(request,options)=>service.submit(request,options),DOMException});
 const window={CanvasApp:app,CanvasStore:store,CANVAS_MENU_ICONS:{},GenerationAPI:{availability:availability||(async()=>({configured:true})),configuration:configuration||(async()=>null),runInPlace}};
 const sandbox={...core,extensionRequestState,createExtensionApplication,window,document:{body:{classList:{remove(){}}}},cancelAnimationFrame(){},AbortController,DOMException,structuredClone,crypto,console};vm.createContext(sandbox);
 const source=fs.readFileSync(path.join(__dirname,'../src/features/video-creation/ui.mjs'),'utf8').replace(/^import .*\n/gm,'').replace('export function openExtend','function openExtend');vm.runInContext(source+'\nglobalThis.ProductionCreation=Creation;',sandbox);
 const panel=Object.create(sandbox.ProductionCreation.prototype);Object.assign(panel,{sourceNode:node,projectId:'p',id:node.id,source:node.video,sourceClip:'null',settings:core.extensionSettings(node),references:[],referenceNodes:new Map(),subjects:[],alive:true,listeners:new AbortController(),editor:{getText:()=>'',destroy(){}},root:{remove(){}},paint(){},exitSelection(){},closeSettings(){},closeMentions(){},error(message){this.operationError=message;}});
 panel.sourceGuard=core.extensionSourceGuard(app,node);panel.lifetimeGuard=core.extensionLifetimeGuard(panel.sourceGuard,{signal:panel.listeners.signal,isAlive:()=>panel.alive});
 return {panel,node,nodes,edges,service,notifications,runner,setProject:value=>project=value,counts:()=>({reads,posts,connected}),saveCounts:()=>({saves,flushes}),lastRequest:()=>lastRequest};
}
test('closing a hung availability lookup settles preparation without waiting for the ignored network signal',async()=>{
 const start=gate(),unresolved=gate(),f=await setup({availability:async()=>{start.release();return unresolved.promise;}}),pending=f.panel.submit();await start.promise;f.panel.close();await pending;
 assert.equal(f.panel.busy,false);assert.equal(f.service.jobs.size,0);assert.deepEqual(f.counts(),{reads:0,posts:0,connected:0});assert.deepEqual(f.notifications,[]);unresolved.release({configured:true});await tick();assert.equal(f.service.jobs.size,0);
});
test('closing delayed configuration cannot create a task or late node',async()=>{
 const start=gate(),lookup=gate(),f=await setup({configuration:async()=>{start.release();return lookup.promise;}}),pending=f.panel.submit();await start.promise;f.panel.close();await pending;lookup.release(null);await tick();
 assert.equal(f.service.jobs.size,0);assert.deepEqual(f.counts(),{reads:0,posts:0,connected:0});
});
test('source generation resolution and audio drift during readiness block before media or task dispatch',async()=>{
 for(const field of ['resolution','generateAudio']){const start=gate(),lookup=gate(),f=await setup({availability:async()=>{start.release();return lookup.promise;}}),pending=f.panel.submit();await start.promise;f.node.generation[field]=field==='resolution'?'720p':true;lookup.release({configured:true});await pending;assert.match(f.panel.operationError,/生成设置/);assert.equal(f.service.jobs.size,0);assert.deepEqual(f.counts(),{reads:0,posts:0,connected:0});}
});
test('project, source object, URL, clip and selected extension settings drift all revoke pending ownership',async()=>{
 for(const change of [f=>f.setProject('other'),f=>f.nodes[0]={...f.node},f=>f.node.video='https://media.test/changed.mp4',f=>f.node.clip={start:0,end:5},f=>f.panel.settings.duration=30]){
  const start=gate(),lookup=gate(),f=await setup({availability:async()=>{start.release();return lookup.promise;}}),pending=f.panel.submit();await start.promise;change(f);lookup.release({configured:true});await pending;assert.equal(f.service.jobs.size,0);assert.deepEqual(f.counts(),{reads:0,posts:0,connected:0});
 }
});
test('reference replacement during readiness cannot authorize a reused node id',async()=>{
 const start=gate(),lookup=gate(),f=await setup({availability:async()=>{start.release();return lookup.promise;}}),ref={id:'reference',type:'image',image:'https://media.test/image.png'};f.nodes.push(ref);f.panel.references=[{id:ref.id,type:ref.type,url:ref.image}];f.panel.referenceNodes.set(ref.id,ref);
 const pending=f.panel.submit();await start.promise;f.nodes[1]={...ref};lookup.release({configured:true});await pending;assert.match(f.panel.operationError,/参考/);assert.deepEqual(f.counts(),{reads:0,posts:0,connected:0});
});
test('closing a submitted but not dispatched task cancels a delayed route lookup without any media read',async()=>{
 const start=gate(),lookup=gate(),f=await setup({isConfigured:async()=>{start.release();return lookup.promise;}}),pending=f.panel.submit();await start.promise;const job=[...f.service.jobs.values()][0];f.panel.close();await pending;lookup.release(true);await tick();assert.equal(job.status,'cancelled');assert.deepEqual(f.counts(),{reads:0,posts:0,connected:0});
});
test('closing during media preparation cancels before POST and suppresses late media completion',async()=>{
 const start=gate(),lookup=gate(),f=await setup({resolveMedia:async()=>{start.release();return lookup.promise;}}),pending=f.panel.submit();await start.promise;f.panel.close();await pending;lookup.release({url:f.node.video,width:1280,height:720,duration:5});await tick();assert.deepEqual(f.counts(),{reads:1,posts:0,connected:0});
});
test('source settings changed inside real media preparation block the final transport',async()=>{
 let f;f=await setup({resolveMedia:async()=>{f.node.generation.generateAudio=true;return {url:f.node.video,width:1280,height:720,duration:5};}});await f.panel.submit();assert.deepEqual(f.counts(),{reads:1,posts:0,connected:0});assert.match(f.panel.operationError,/生成设置/);
});
test('normal extension dispatches and applies exactly once with original inherited settings',async()=>{
 const f=await setup();await f.panel.submit();assert.deepEqual(f.counts(),{reads:1,posts:1,connected:1});assert.equal(f.lastRequest().parameters.resolution,'1080p');assert.equal(f.lastRequest().parameters.generateAudio,false);assert.equal(f.panel.submittedJob.status,'succeeded');assert.equal(f.panel.taskController.signal.aborted,false);
});
test('closing after dispatch retains original task receipt and allows its guarded result without another POST',async()=>{
 const start=gate(),result=gate(),f=await setup({generate:async()=>{start.release();return result.promise;}}),pending=f.panel.submit();await start.promise;const job=f.panel.submittedJob,id=job.id;f.panel.close();assert.equal(f.panel.taskController.signal.aborted,false);result.release({outputs:[{type:'video',url:'https://media.test/output.mp4'}]});await pending;assert.equal(job.id,id);assert.equal(job.status,'succeeded');assert.deepEqual(f.counts(),{reads:1,posts:1,connected:1});
});
test('completed output and same-task application retry survive closing after an application failure',async()=>{
 const f=await setup({failApply:true});await f.panel.submit();const job=f.panel.submittedJob;assert.equal(job.status,'succeeded');assert(job.outputs.length);assert(job.applicationError);f.panel.close();const retry=await f.runner.run(job.id);assert.equal(retry.applicationStatus,'applied');assert.deepEqual(f.counts(),{reads:1,posts:1,connected:1});assert.equal(job.applicationAttempts,2);
});
test('changed source after dispatch preserves outputs but blocks application until original ownership is restored',async()=>{
 const start=gate(),result=gate(),f=await setup({generate:async()=>{start.release();return result.promise;}}),pending=f.panel.submit();await start.promise;f.node.generation.resolution='720p';f.panel.close();result.release({outputs:[{type:'video',url:'https://media.test/output.mp4'}]});await pending;const job=f.panel.submittedJob;assert.equal(job.status,'succeeded');assert(job.outputs.length);assert.match(job.applicationError,/生成设置/);assert.deepEqual(f.counts(),{reads:1,posts:1,connected:0});f.node.generation.resolution='1080p';await f.runner.run(job.id);assert.deepEqual(f.counts(),{reads:1,posts:1,connected:1});
});
test('CanvasStore rejection retains inserted nodes and close then same-task retry saves without another POST or insertion',async()=>{
 const f=await setup({failSave:true});await f.panel.submit();const job=f.panel.submittedJob;
 assert.equal(job.status,'succeeded');assert.equal(job.applied,false);assert.match(job.applicationError,/CanvasStore transaction rejected/);assert.equal(f.nodes.length,2);assert.equal(f.edges.length,1);assert.deepEqual(f.saveCounts(),{saves:1,flushes:0});
 f.panel.close();await f.runner.run(job.id);assert.equal(job.applicationStatus,'applied');assert.deepEqual(f.counts(),{reads:1,posts:1,connected:1});assert.deepEqual(f.saveCounts(),{saves:2,flushes:1});assert.equal(job.applicationAttempts,2);assert.deepEqual(job.resultIds,['derived']);
});
test('save retry refuses deleted, replaced, edited results and removed connection without creating duplicates',async()=>{
 for(const change of [f=>f.nodes.pop(),f=>f.nodes[1]={...f.nodes[1]},f=>f.nodes[1].video='https://media.test/replacement.mp4',f=>f.edges.pop()]){
  const f=await setup({failSave:true});await f.panel.submit();change(f);f.panel.close();const receipt=await f.runner.run(f.panel.submittedJob.id);assert.equal(receipt.applicationStatus,'failed');assert.match(receipt.applicationError,/修改或移除/);assert.deepEqual(f.counts(),{reads:1,posts:1,connected:1});assert.deepEqual(f.saveCounts(),{saves:1,flushes:0});
 }
});
test('beforeCommit checks source ownership and result content again inside CanvasStore transaction',async()=>{
 const f=await setup({beforeSave:({nodes})=>{nodes[1].video='https://media.test/changed-in-save.mp4';}});await f.panel.submit();assert.match(f.panel.submittedJob.applicationError,/修改或移除/);assert.deepEqual(f.saveCounts(),{saves:1,flushes:0});assert.deepEqual(f.counts(),{reads:1,posts:1,connected:1});
});
