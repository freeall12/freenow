'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),vm=require('node:vm');
const {once}=require('node:events'),{TaskService}=require('../generation-api.js'),{parse}=require('../agent-tools.js'),{createFalProvider}=require('../server/generation-fal.cjs');
const root=path.resolve(__dirname,'..'),clientSource=fs.readFileSync(path.join(root,'agent-client.js'),'utf8'),uiSource=fs.readFileSync(path.join(root,'generation-ui.js'),'utf8');
const input={kind:'image.remove-background',nodeId:'source',prompt:''},angles={rotate_right_left:-30,move_forward:2,vertical_angle:.5,wide_angle_lens:false};
const bytes=name=>fs.readFileSync(path.join(root,'qa','agent-image-processing-'+name+'.png'));
const tick=()=>new Promise(resolve=>setTimeout(resolve,5));
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
async function fixture(t,options={}){
 const {prepareImageToolMedia}=await import('../src/features/image-editor/task-media.mjs'),{createApplicationRunner}=await import('../src/features/generation-results/application.mjs'),{resultProvenance}=await import('../src/features/media-preview/provenance.mjs');
 const {providerConfigured}=await import('../src/features/node-composer/provider-configuration.mjs');
 const {prepareWorkflowInputs}=await import('../src/features/agent-workflows/media-transport.mjs');
 const source={id:'source',type:'image',image:'asset:thumbnail',fullImage:'asset:full',x:10,y:20,width:250,height:150},state={nodes:[source],edges:[]},posts=[],assetReads=[],derivedTargets=new Map();let project='project-a',saveFails=false,configured=true,applies=0,persisted;
 const provider=http.createServer(async(req,res)=>{
  if(req.url==='/result.png'){res.writeHead(200,{'content-type':'image/png'});res.end(bytes('result'));return;}
  let text='';for await(const chunk of req)text+=chunk;
  if(req.method==='POST'){assert(persisted?.submittedTaskId,'receipt must be saved before queue POST');posts.push(JSON.parse(text));res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({request_id:'local-native-task'}));return;}
  res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(req.url.includes('/status')?{status:'COMPLETED',request_id:'local-native-task'}:{image:{url:'https://fixture.invalid/result.png',content_type:'image/png',width:512,height:320},images:[{url:'https://fixture.invalid/result.png',content_type:'image/png',width:512,height:320}]}));
 });provider.listen(0,'127.0.0.1');await once(provider,'listening');const base='http://127.0.0.1:'+provider.address().port;t.after(()=>{provider.closeAllConnections();provider.close();});
 const native=createFalProvider({apiKey:'nonsecret-local-fixture',modelMap:{'image.remove-background':{kind:'image.remove-background',model:'fal-ai/birefnet'},'image.upscale':{kind:'image.upscale',model:'fal-ai/topaz/upscale/image'},'image.multiAngle':{kind:'image.multiAngle',model:'fal-ai/qwen-image-edit-2511-multiple-angles'}},fetchImpl:(url,init)=>fetch(base+new URL(url).pathname,init)});
 const app={getState:()=>state,projectIdentity:()=>({id:project}),createConnected:(id,outputs)=>{applies++;return outputs.map(output=>{const node={id:'result-'+applies,...output};state.nodes.push(node);state.edges.push({source:id,target:node.id});return node;});}};
 const blob=URL.createObjectURL(new Blob([bytes('source')],{type:'image/png'}));t.after(()=>URL.revokeObjectURL(blob));
 const service=new TaskService({prepareInputs:(request,context)=>prepareImageToolMedia(request,{...context,nativeConfiguration:native.metadata,baseUrl:base,transport:(value,settings)=>prepareWorkflowInputs(value,{...settings,serialize:async blob=>'data:'+blob.type+';base64,'+Buffer.from(await blob.arrayBuffer()).toString('base64')}),localAssets:{url:async key=>{assetReads.push(key);if(options.assetGate)await options.assetGate.promise;return key==='asset:full'?blob:assert.fail('thumbnail must not be read');}}})});service.setProvider(native);
 const targetContext={service,derivedTargets,submitJob:(request,opts)=>service.submit(request,options.historyFailure?{...opts,beforeDispatchReady:async()=>{throw Error('history gate failed');}}:opts)};
 vm.runInNewContext(uiSource.slice(uiSource.indexOf('  function submitDerived('),uiSource.indexOf('  window.GenerationAPI=')),targetContext);
 const applyStart=uiSource.indexOf('      if(!stored.resultIds&&derivedTargets.has(job.id))'),applyEnd=uiSource.indexOf('      if(ordinaryAudio)',applyStart);
 const applyContext={derivedTargets,app,resultProvenance,window:{},audioGuard:()=>{},recordSubtitleMedia:()=>{},validateJobMedia:async output=>{const actual=Buffer.from(await fetch(base+new URL(output.url).pathname).then(r=>r.arrayBuffer()));assert.deepEqual(actual,bytes('result'));}};
 vm.runInNewContext('async function apply(job){const stored=job;'+uiSource.slice(applyStart,applyEnd)+'}',applyContext);
 const runner=createApplicationRunner({getJob:id=>service.jobs.get(id),apply:async job=>{await applyContext.apply(job);if(saveFails)throw Error('save failed');},changed:job=>{if(trace)(awaitJobModule).attachGenerationJob(trace,job);}});
 service.subscribe(job=>{if(job.status==='succeeded')void runner.run(job.id);});
 let trace;const awaitJobModule=await import('../src/features/agent-generation/jobs.mjs');
 const api={submitDerived:targetContext.submitDerived,subscribe:fn=>service.subscribe(fn),cancel:id=>service.cancel(id),availability:async({request})=>{if(options.availabilityGate)await options.availabilityGate.promise;return {configured:configured&&providerConfigured(native.metadata,request)};}};
 const fragment=clientSource.slice(clientSource.indexOf("  case 'generation_submit':{"),clientSource.indexOf('   if(a.draftSourceId)',clientSource.indexOf("  case 'generation_submit':{"))).replace("await import('./src/features/agent-generation/image-processing.mjs')",'await imageProcessingModule');
 const dispatchContext={app,window:{GenerationAPI:api},imageProcessingModule:import('../src/features/agent-generation/image-processing.mjs')};
 vm.runInNewContext('async function dispatch(name,a,{signal,onDepthSubmitted}){switch(name){'+fragment+'}default:throw Error("unhandled fixture tool");}}',dispatchContext);
 const {executeTracedCall,needsToolConfirmation}=await import('../src/features/agent-execution/trace.mjs');
 async function execute(args=input,{mode='ask',confirm=async()=>true,signal}={}){
  const call={name:'generation_submit',callId:'tool-call',args:parse('generation_submit',args).args},definition=parse(call.name,args).definition;
  const acknowledgeStart=clientSource.indexOf('       const onDepthSubmitted=async job=>'),acknowledgeEnd=clientSource.indexOf('\n       return execute(',acknowledgeStart);
  const ackContext={d:{messages:[]},call,generationJobs:awaitJobModule,save:()=>{if(options.receiptFailure)return false;persisted=structuredClone(trace);return true;},flushConversation:async()=>{if(options.receiptGate)await options.receiptGate.promise;},executionRenderer:{updateTrace:()=>{}}};
  vm.runInNewContext(clientSource.slice(acknowledgeStart,acknowledgeEnd)+'\nthis.acknowledge=onDepthSubmitted;',ackContext);
  return executeTracedCall(call,{signal,confirm:needsToolConfirmation(definition,mode)?confirm:null,changed:value=>{trace=value;ackContext.d.messages=[value];},execute:(name,a)=>dispatchContext.dispatch(name,a,{signal,onDepthSubmitted:ackContext.acknowledge})});
 }
 async function settled(){for(let i=0;i<600;i++){const job=[...service.jobs.values()][0];if(job&&(['failed','unknown','cancelled','configuration_required'].includes(job.status)||job.status==='succeeded'&&!job.applying&&job.applicationStatus))return job;await tick();}throw Error('task did not settle');}
 return {execute,settled,service,state,source,posts,assetReads,runner,get trace(){return trace;},get persisted(){return persisted;},setProject:value=>{project=value;},setConfigured:value=>{configured=value;},setSaveFailure:value=>{saveFails=value;}};
}

test('actual schema/dispatch/approval/receipt -> native fal HTTP bytes -> connected result, without changing source', {timeout:10000},async t=>{
 const confirmation=deferred(),f=await fixture(t),pending=f.execute(input,{confirm:async()=>{await confirmation.promise;return true;}});await tick();assert.equal(f.trace.status,'pending');assert.equal(f.service.jobs.size,0);confirmation.resolve();const result=await pending;assert.equal(result.result.taskId,f.persisted.submittedTaskId);assert.equal(result.result.status==='succeeded',false);const job=await f.settled();assert.equal(job.status,'succeeded',job.error);assert.equal(job.applied,true,job.applicationError);assert.equal(f.posts.length,1);assert.deepEqual(Buffer.from(f.posts[0].image_url.split(',')[1],'base64'),bytes('source'));assert.deepEqual(f.assetReads,['asset:full']);assert.equal(f.source.fullImage,'asset:full');assert.equal(f.state.nodes.length,2);assert.equal(f.state.edges[0].source,'source');assert.deepEqual(Array.from(job.resultIds),['result-1']);assert.equal(f.trace.generationJob.applied,true);
});
test('automatic multi-angle uses explicit Qwen controls with actual full-image transport, no silent defaults',{timeout:10000},async t=>{
 const f=await fixture(t),args={...input,kind:'image.multiAngle',...angles};await f.execute(args,{mode:'auto',confirm:()=>assert.fail('auto must not ask again')});const job=await f.settled();assert.equal(job.status,'succeeded',job.error);assert.equal(job.applied,true,job.applicationError);assert.equal(job.request.kind,'image.multiAngle');assert.equal(job.request.label,'多角度调整');assert.equal(f.state.nodes[1].title,'多角度调整');const sent=f.posts[0];assert.equal(sent.horizontal_angle,330);assert.equal(sent.vertical_angle,22.5);assert.equal(sent.zoom,2);assert.equal(sent.num_images,1);assert.deepEqual(Buffer.from(sent.image_urls[0].split(',')[1],'base64'),bytes('source'));
});
test('schema rejects missing/invalid angle controls, unrelated operation fields and multiple cutout sources',()=>{
 const full={...input,kind:'image.multiAngle',...angles};for(const key of Object.keys(angles)){const invalid={...full};delete invalid[key];assert.throws(()=>parse('generation_submit',invalid));}
 for(const patch of [{rotate_right_left:91},{vertical_angle:-.7},{move_forward:11},{wide_angle_lens:true},{prompt:'another scene'},{count:2}])assert.throws(()=>parse('generation_submit',{...full,...patch}));
 for(const args of [{...input,count:2},{...input,referenceIds:['other']},{...input,referenceIds:[]},{...input,rotate_right_left:1},{...input,generateAudio:true}])assert.throws(()=>parse('generation_submit',args));
});
test('denial and missing operation configuration never read media or create a task',async t=>{
 const f=await fixture(t);await f.execute(input,{confirm:async()=>false});assert.equal(f.trace.status,'denied');assert.equal(f.service.jobs.size,0);f.setConfigured(false);const result=await f.execute(input,{mode:'auto'});assert.equal(result.result.status,'configuration_required');assert.equal(f.service.jobs.size,0);assert.deepEqual(f.assetReads,[]);assert.equal(f.posts.length,0);
});
test('late configuration and asset reads reject source replacement, crop or project changes before HTTP dispatch',async t=>{
 for(const mutation of ['replacement','crop','project']){const gate=deferred(),f=await fixture(t,{availabilityGate:gate}),pending=f.execute(input,{mode:'auto'});await tick();if(mutation==='replacement')f.state.nodes[0]={...f.source};else if(mutation==='crop')f.source.crop={x:1,y:1,width:2,height:2};else f.setProject('other');gate.resolve();assert.match((await pending).result.error,/修改或替换/);assert.equal(f.posts.length,0);assert.equal(f.assetReads.length,0);}
 const gate=deferred(),f=await fixture(t,{assetGate:gate});await f.execute(input,{mode:'auto'});await tick();f.source.fullImage='asset:changed';gate.resolve();assert.equal((await f.settled()).status,'failed');assert.equal(f.posts.length,0);
});
test('failed durable receipt or upstream history gate blocks all media/HTTP, and abort releases a waiting receipt',async t=>{
 for(const option of ['receiptFailure','historyFailure']){const f=await fixture(t,{[option]:true});assert.match((await f.execute(input,{mode:'auto'})).result.error,/记录|history/);assert.equal(f.posts.length,0);assert.equal(f.assetReads.length,0);}
 const gate=deferred(),f=await fixture(t,{receiptGate:gate}),controller=new AbortController(),pending=f.execute(input,{mode:'auto',signal:controller.signal});await tick();controller.abort();await assert.rejects(pending,{name:'AbortError'});gate.resolve();await tick();assert.equal(f.posts.length,0);assert.equal(f.assetReads.length,0);
});
test('application save retry retains the same result ID without another native request',{timeout:10000},async t=>{
 const f=await fixture(t);f.setSaveFailure(true);await f.execute(input,{mode:'auto'});const job=await f.settled();assert.equal(job.status,'succeeded',job.error);assert.equal(job.applied,false);assert.deepEqual(Array.from(job.resultIds),['result-1']);f.setSaveFailure(false);await f.runner.run(job.id);assert.equal(job.applied,true,job.applicationError);assert.deepEqual(Array.from(job.resultIds),['result-1']);assert.equal(f.state.nodes.length,2);assert.equal(f.posts.length,1);
});
