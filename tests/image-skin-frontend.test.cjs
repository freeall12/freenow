'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const guardReady=import('../src/features/image-skin/source-guard.mjs'),resultReady=import('../src/features/image-skin/result-application.mjs'),operationReady=import('../src/features/image-skin/operation.mjs');
function fixture(){
 const parent={id:'source',type:'image',image:'asset:thumb',fullImage:'asset:original'},node={id:'enhance',type:'image',tool:'enhance',params:{activeTab:'realistic-portrait',mode:'detailed'},image:'asset:previous'},nodes=[parent,node],edge={source:parent.id,target:node.id},edges=[edge];let project='p',selected=[node.id],updates=0,saves=0;
 const app={projectIdentity:()=>({id:project}),getState:()=>({nodes,edges,selected}),updateNode:(id,patch)=>{updates++;Object.assign(nodes.find(node=>node.id===id),patch);},saveProject:async()=>{saves++;}};
 const request={kind:'image.skin',label:'皮肤增强',nodeId:node.id,sourceNodeId:parent.id,prompt:'',inputs:[{type:'image',role:'source_image',nodeId:parent.id,url:parent.fullImage}],parameters:{mode:'detailed'}};
 return {app,node,parent,nodes,edges,edge,request,setProject:value=>project=value,setSelection:value=>selected=value,get updates(){return updates;},get saves(){return saves;}};
}
const metadataFixture=()=>require('../server/generation-skin-tasks.cjs').createSkinTasksProvider({transport:{configured:true,metadata:{missing:[]},prepare(){},submit(){},poll(){},cancel(){}}}).metadata;
const turn=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;return {promise:new Promise(done=>resolve=done),resolve:value=>resolve(value)};};
test('skin scope locks exact source/target objects, full media, params, edge and project',async()=>{
 const {createEnhanceSourceGuard}=await guardReady;
 for(const mutate of [s=>s.setProject('other'),s=>s.nodes[0]={...s.parent},s=>s.nodes[1]={...s.node},s=>s.parent.id='other',s=>s.parent.image='other-thumb',s=>s.parent.fullImage='other-full',s=>s.parent.crop={},s=>s.parent.imageSelection={},s=>s.parent.metadata={revision:2},s=>s.node.image='edited',s=>s.node.fullImage='edited-full',s=>s.node.params.mode='heavy',s=>s.node.params.extra='hidden',s=>s.node.selection={},s=>s.node.versions=[],s=>s.edges[0]={...s.edge},s=>s.edge.source='other',s=>s.edges.push({...s.edge}),s=>s.setSelection([])]){
  const s=fixture(),guard=createEnhanceSourceGuard(s.app,s.node,s.parent,{requireSelection:true});guard();mutate(s);assert.throws(guard,/变化/);
 }
});
test('skin guards reject closure/cancellation and require materialized full-image scope',async()=>{
 const {createEnhanceSourceGuard,assertEnhanceSourceScope}=await guardReady,s=fixture(),controller=new AbortController();let alive=true;
 const guard=createEnhanceSourceGuard(s.app,s.node,s.parent,{signal:controller.signal,isAlive:()=>alive});alive=false;assert.throws(guard,{name:'AbortError'});alive=true;controller.abort(Error('closed'));assert.throws(guard,/closed/);
 for(const field of ['crop','imageCrop','clip','trim','selection','imageSelection','region','sourceBox','imageRegion','selectedRegion','mask','projection'])assert.throws(()=>assertEnhanceSourceScope({[field]:{}}),/完整图片/);
});
test('save failure retries same output/version and resolves only after real save',async()=>{
 const {createEnhanceResultApplication}=await resultReady,{createApplicationRunner}=await import('../src/features/generation-results/application.mjs'),s=fixture(),saving=deferred();let attempts=0;
 s.app.saveProject=async()=>{if(++attempts===1)throw Error('disk failed');await saving.promise;};
 const target=createEnhanceResultApplication({...s,label:s.request.label,parameters:s.request.parameters}),output={type:'image',url:'asset:result',provenance:{prompt:'',provider:'fixture'}},job={id:'same-job',status:'succeeded',outputs:[output]},runner=createApplicationRunner({getJob:()=>job,apply:()=>target.apply(output)});
 await runner.run(job.id);assert.equal(job.applied,false);assert.match(job.applicationError,/disk failed/);assert.equal(s.updates,1);assert.equal(s.nodes.length,2);assert.equal(s.node.versions.length,2);assert.equal(s.node.versions[0].fullImage,'asset:result');
 const retry=runner.run(job.id);await turn();assert.equal(job.applied,false);assert.equal(s.updates,1);assert.equal(s.node.versions.length,2);saving.resolve();await retry;assert.equal(job.applied,true);assert.equal(attempts,2);
 await assert.rejects(()=>target.apply({...output,url:'asset:other'}),/原增强任务结果已变化/);s.node.versions.push({image:'user-version'});await assert.rejects(()=>target.apply(output),/变化/);
});
test('configuration preflight rejects unconfigured/closed/changed source before task/media preparation',async()=>{
 const {createEnhanceOperation}=await operationReady;
 for(const scenario of ['missing','closed','source','configuration']){
  const s=fixture(),checking=deferred();let alive=true,submits=0,metadata=metadataFixture();
  const api={availability:async()=>{await checking.promise;return {configured:scenario!=='missing'};},configuration:async()=>metadata,configurationSnapshot:()=>scenario==='configuration'?{...metadata,revision:2}:metadata,getJobs:()=>[],subscribe:()=>()=>{},runInPlace:async(_request,target)=>{target.dispatchGuard();submits++;}};
  const op=createEnhanceOperation({...s,api,isAlive:()=>alive});const work=op.run();
  if(scenario==='closed'){alive=false;op.cancelPreparation();}if(scenario==='source')s.parent.fullImage='asset:changed';checking.resolve();await work;assert.equal(submits,0);assert.equal(op.status,'failed');assert.equal(s.updates,0);
 }
});
test('save retry and unknown recovery only use original job, never resubmit model',async()=>{
 const {createEnhanceOperation}=await operationReady;
 for(const scenario of ['save','unknown']){
  const s=fixture(),metadata=metadataFixture();let submits=0,retries=0,recovers=0,stored,notify,target;
  const api={availability:async()=>({configured:true}),configuration:async()=>metadata,configurationSnapshot:()=>metadata,getJobs:()=>stored?[stored]:[],subscribe:fn=>{notify=fn;return ()=>{};},runInPlace:async(_request,options,hooks)=>{submits++;target=options;stored={id:'original-job',status:'queued',request:s.request};hooks.onSubmitted(stored);hooks.onPrepared(stored);if(scenario==='unknown'){stored.status='unknown';notify(stored);throw Error('timeout');}stored.status='succeeded';try{await options.apply({type:'image',url:'asset:result'});}catch(error){stored.applicationError=error.message;notify(stored);throw error;}},retryApplication:async id=>{assert.equal(id,'original-job');retries++;await target.apply({type:'image',url:'asset:result'});return {applied:true};},recover:async id=>{assert.equal(id,'original-job');recovers++;stored.status='succeeded';await target.apply({type:'image',url:'asset:result'});stored.applied=true;notify(stored);}};
  if(scenario==='save'){let saves=0;s.app.saveProject=async()=>{if(++saves===1)throw Error('disk failed');};}
  const op=createEnhanceOperation({...s,api});await op.run();assert.equal(op.status,scenario==='save'?'application_failed':'unknown');
  await op.run();assert.equal(submits,1);if(scenario==='save')await op.retryApplication();else await op.recover();assert.equal(op.status,'succeeded');assert.equal(submits,1);assert.equal(s.updates,1);assert.equal(s.node.versions.length,2);assert.equal(retries,scenario==='save'?1:0);assert.equal(recovers,scenario==='unknown'?1:0);
 }
});
test('final prepared request is verified before recovery emits or applies, including late source changes',async()=>{
 const {createEnhanceOperation}=await operationReady;
 for(const scenario of ['request','source','late-source']){
  const s=fixture(),metadata=metadataFixture();let stored,posts=0,applies=0,verifiedOptions,release;
  const paused=deferred();
  const api={availability:async()=>({configured:true}),configuration:async()=>metadata,configurationSnapshot:()=>metadata,getJobs:()=>[stored],subscribe:()=>()=>{},runInPlace:async(request,target,hooks)=>{posts++;verifiedOptions=target;stored={id:'same-job',status:'unknown',request:{...structuredClone(request),inputs:[{...request.inputs[0],url:'data:image/png;base64,PREPARED'}]}};hooks.onSubmitted(stored);hooks.onPrepared(stored);assert.equal(await target.verifyRequest(stored.request,stored),true);throw Error('timeout');},recover:async(id,options)=>{assert.equal(id,'same-job');options.guard();if(scenario==='late-source'){release=()=>paused.resolve();await paused.promise;}const candidate=structuredClone(stored);if(scenario==='request')candidate.request.parameters.mode='heavy';options.guard();await options.verifyRequest(candidate.request,candidate);applies++;await verifiedOptions.apply({type:'image',url:'asset:unexpected'});}};
  const op=createEnhanceOperation({...s,api});await op.run();assert.equal(op.status,'unknown');
  if(scenario==='source')s.parent.fullImage='changed-before-query';const query=op.recover();
  if(scenario==='late-source'){await turn();s.parent.fullImage='changed-during-query';release();}
  await query;assert.equal(posts,1);assert.equal(applies,0);assert.equal(s.updates,0);assert.equal(op.status,'unknown');assert.match(op.error,/变化/);
 }
});
