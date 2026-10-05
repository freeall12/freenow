'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{createHash,randomUUID}=require('node:crypto');
const {createDurableGenerationService}=require('../server/generation-durable.cjs');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
const request={kind:'video.erase',nodeId:'synthetic-source',prompt:'移除指定区域',inputs:[{type:'video',url:'data:video/mp4;base64,YQ=='}],parameters:{modelId:'synthetic-wan-mask'}};
const canonical=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
const hash=value=>createHash('sha256').update(canonical(value)).digest('hex');
const stage=(preparationId,phase='media-preparing',status='preparing',extra={})=>({version:1,protocol:'fal-video-mask-native',preparationId,kind:request.kind,stage:phase,status,requestHash:hash(request),...extra});
const storageError=()=>Object.assign(Error('synthetic storage failure'),{code:'storage_error'});
function store(){const data=new Map();let reject=()=>false;return {data,failWhen:fn=>reject=fn,readAll:async()=>[...data.values()].map(value=>structuredClone(value)),write:async value=>{if(reject(value))throw storageError();data.set(value.id,structuredClone(value));}};}
const provider=extra=>({configured:true,fingerprint:'synthetic-fingerprint',metadata:{protocol:'fal-video-mask-native'},prepare:value=>value,...extra});
async function submitted(storage,transport){const service=createDurableGenerationService({store:storage,provider:transport}),job=await service.submit(request,{idempotencyKey:'synthetic-mask-preparation'});await tick();return {service,id:job.id};}

test('each preparation checkpoint commits before the next upload or generation POST; storage failure prevents later network',async()=>{
 for(const failedStage of ['media-preparing','upload-initiating','uploaded','generation-dispatching']){
  const storage=store(),preparationId=randomUUID(),network=[];storage.failWhen(value=>value.providerPreparation?.stage===failedStage);
  const transport=provider({submit:async(_request,{onPreparationState,onTaskIdentity,localTaskId})=>{
   assert.ok(storage.data.has(localTaskId));
   await onPreparationState(stage(preparationId));network.push('inspect');
   await onPreparationState(stage(preparationId,'upload-initiating','dispatching'));network.push('upload');
   await onPreparationState(stage(preparationId,'uploaded','confirmed'));network.push('next-upload');
   await onPreparationState(stage(preparationId,'generation-dispatching','dispatching'));network.push('POST');
   await onTaskIdentity('original-queue-id');return {id:'original-queue-id',status:'queued'};
  },poll:()=>assert.fail('failed checkpoints cannot poll')});
  const {service,id}=await submitted(storage,transport),job=await service.get(id);assert.equal(job.status,'unknown');assert.equal(job.code,'storage_error');assert.equal(job.outputs,undefined);
  assert.deepEqual(network,{ 'media-preparing':[], 'upload-initiating':['inspect'], uploaded:['inspect','upload'], 'generation-dispatching':['inspect','upload','next-upload']}[failedStage]);
  await service.close();
 }
});

test('an acquired original task identity commits before provider polling or post-processing',async()=>{
 for(const fail of [false,true]){
  const storage=store(),preparationId=randomUUID(),operations=[];storage.failWhen(value=>fail&&value.providerTaskId==='original-queue-id');
  const transport=provider({submit:async(_request,{onPreparationState,onTaskIdentity})=>{
   await onPreparationState(stage(preparationId,'generation-dispatching','dispatching'));operations.push('POST');
   await onTaskIdentity('original-queue-id');assert.equal([...storage.data.values()][0].providerTaskId,'original-queue-id');operations.push('provider-after-identity');
   return {id:'original-queue-id',status:'queued'};
  },poll:async(id,context)=>{assert.equal([...storage.data.values()][0].providerTaskId,id);operations.push('GET');assert.deepEqual(context.request,request);assert.equal(context.preparationState.preparationId,preparationId);return {id,status:'running'};}});
  const {service,id}=await submitted(storage,transport);await service.get(id);
  assert.deepEqual(operations,fail?['POST']:['POST','provider-after-identity','GET']);await service.close();
 }
});

test('restart without a queue identity reads preparation evidence only and never uploads or resubmits',async()=>{
 const storage=store(),preparationId=randomUUID();let submits=0,reads=0;
 const transport=provider({submit:async(_request,{onPreparationState})=>{submits++;await onPreparationState(stage(preparationId,'uploaded','confirmed'));throw Error('crash before generation POST');},
  resumePreparation:async(state,context)=>{reads++;assert.equal(state.preparationId,preparationId);assert.deepEqual(context.request,request);return {status:'unknown'};},poll:()=>assert.fail('no accepted queue ID can poll')});
 const {service,id}=await submitted(storage,transport);await service.close();reads=0;
 const restored=createDurableGenerationService({store:storage,provider:transport});await restored.ready;await tick();assert.equal(reads,0);
 const job=await restored.get(id);assert.equal(job.status,'unknown');assert.equal(job.code,'preparation_unconfirmed');assert.equal(reads,1);assert.equal(submits,1);
 assert.equal((await restored.submit(request,{idempotencyKey:'synthetic-mask-preparation'})).id,id);assert.equal(submits,1);await restored.close();
});

test('restart discovers a manifest queue ID, persists it, and GETs only that original ID with request context',async()=>{
 for(const fail of [false,true]){
  const storage=store(),preparationId=randomUUID(),operations=[];
  const initial=provider({submit:async(_request,{onPreparationState})=>{await onPreparationState(stage(preparationId,'generation-dispatching','dispatching'));throw Error('crash after private queue receipt');}});
  const {service,id}=await submitted(storage,initial);await service.close();storage.failWhen(value=>fail&&value.providerTaskId==='original-queue-id');
  const captured=provider({submit:()=>assert.fail('recovery must not POST'),resumePreparation:async(state,context)=>{operations.push('read-manifest');assert.equal(state.preparationId,preparationId);assert.equal(context.localTaskId,id);return {id:'original-queue-id',status:'queued'};},
   poll:async(queueId,context)=>{operations.push('GET:'+queueId);assert.equal(storage.data.get(id).providerTaskId,queueId);assert.deepEqual(context.request,request);assert.equal(context.preparationState.requestHash,hash(request));return {id:queueId,status:'running'};}});
  const restored=createDurableGenerationService({store:storage,provider:captured});await restored.ready;await tick();assert.deepEqual(operations,[]);
  const job=await restored.get(id);assert.deepEqual(operations,fail?['read-manifest']:['read-manifest','GET:original-queue-id']);assert.equal(job.status,fail?'unknown':'running');if(fail)assert.equal(job.code,'storage_error');await restored.close();
 }
});

test('preparation schemas bind request and route and never persist signed URLs keys or changed preparation IDs',async()=>{
 const invalid=[stage(randomUUID(),'uploaded','confirmed',{url:'https://media.test/file?token=synthetic'}),stage(randomUUID(),'uploaded','confirmed',{apiKey:'synthetic-secret'}),stage(randomUUID(),'uploaded','confirmed',{requestHash:'0'.repeat(64)}),stage(randomUUID(),'uploaded','dispatching'),stage(randomUUID(),'uploaded','confirmed',{routing:{providerId:'bad/provider',providerFingerprint:'a'.repeat(64)}})];
 for(const value of invalid){
  const storage=store(),transport=provider({submit:async(_request,{onPreparationState})=>{await onPreparationState(value);assert.fail('invalid state cannot proceed');}}),{service,id}=await submitted(storage,transport);
  assert.equal((await service.get(id)).code,'invalid_preparation_state');assert.equal(storage.data.get(id).providerPreparation,undefined);assert.equal(JSON.stringify([...storage.data.values()]).includes('synthetic-secret'),false);await service.close();
 }
 const storage=store(),first=randomUUID(),transport=provider({submit:async(_request,{onPreparationState})=>{await onPreparationState(stage(first,'uploaded','confirmed',{routing:{providerId:'original',providerFingerprint:'a'.repeat(64)}}));await onPreparationState(stage(first,'generation-dispatching','dispatching',{routing:{providerId:'other',providerFingerprint:'a'.repeat(64)}}));assert.fail('changed route cannot proceed');}}),{service,id}=await submitted(storage,transport);
 assert.equal((await service.get(id)).code,'invalid_preparation_state');assert.equal(storage.data.get(id).providerPreparation.routing.providerId,'original');await service.close();
 const saved=storage.data.get(id);saved.providerPreparation.url='https://media.test/?token=synthetic';const corrupt=createDurableGenerationService({store:storage,provider:transport});await assert.rejects(corrupt.ready,{code:'storage_corrupt'});await corrupt.close();
 const identities=store(),original=randomUUID(),changed=provider({submit:async(_request,{onPreparationState})=>{await onPreparationState(stage(original));await onPreparationState(stage(randomUUID(),'media-ready','ready'));assert.fail('changed preparation ID cannot proceed');}}),second=await submitted(identities,changed);
 assert.equal((await second.service.get(second.id)).code,'invalid_preparation_state');assert.equal(identities.data.get(second.id).providerPreparation.preparationId,original);await second.service.close();
});

test('cancel or close blocks the next checkpoint and upload, while a late accepted ID is saved only to cancel it',async()=>{
 for(const stop of ['cancel','close']){
  const storage=store(),entered=deferred(),release=deferred(),operations=[],preparationId=randomUUID();
  const transport=provider({submit:async(_request,{onPreparationState})=>{await onPreparationState(stage(preparationId));entered.resolve();await release.promise;await onPreparationState(stage(preparationId,'upload-initiating','dispatching'));operations.push('upload');return {status:'queued'};},poll:()=>assert.fail('stopped preparation cannot poll')});
  const service=createDurableGenerationService({store:storage,provider:transport}),job=await service.submit(request,{idempotencyKey:'synthetic-mask-preparation'});await entered.promise;
  const stopped=stop==='close'?service.close():service.cancel(job.id);release.resolve();await stopped;await tick();assert.deepEqual(operations,[]);assert.equal(storage.data.get(job.id).providerPreparation.stage,'media-preparing');assert.notEqual((await service.get(job.id)).status,'succeeded');await service.close();
 }
 const storage=store(),entered=deferred(),release=deferred(),operations=[],preparationId=randomUUID();
 const transport=provider({submit:async(_request,{onPreparationState,onTaskIdentity})=>{await onPreparationState(stage(preparationId,'generation-dispatching','dispatching'));operations.push('POST');entered.resolve();await release.promise;await onTaskIdentity('late-original-id');operations.push('provider-after-identity');return {id:'late-original-id',status:'queued'};},cancel:async id=>{assert.equal(storage.data.values().next().value.providerTaskId,id);operations.push('DELETE:'+id);return {status:'cancelled'};},poll:()=>assert.fail('cancelled ID cannot poll')});
 const service=createDurableGenerationService({store:storage,provider:transport}),job=await service.submit(request,{idempotencyKey:'synthetic-mask-preparation'});await entered.promise;await service.cancel(job.id);release.resolve();await tick();assert.deepEqual(operations,['POST','DELETE:late-original-id']);assert.equal((await service.get(job.id)).status,'cancelled');assert.equal(storage.data.get(job.id).providerTaskId,'late-original-id');await service.close();
});

test('trusted local mask failures expose finite codes and a model dispatch flag without erasing upload evidence',async()=>{
 for(const scenario of ['local','uploaded','untrusted','unknown-code','already-accepted','returned']){
  const storage=store(),preparationId=randomUUID(),transport=provider({...(scenario==='untrusted'?{metadata:{protocol:'tasks-v1'}}:{}),submit:async(_request,{onPreparationState,onTaskIdentity})=>{
   if(scenario==='uploaded')await onPreparationState(stage(preparationId,'uploaded','confirmed'));
   if(scenario==='already-accepted')await onTaskIdentity('accepted-original-id');
   const value={code:scenario==='unknown-code'?'arbitrary_private_error':'invalid_video_mask_media',providerDispatched:false};if(scenario==='returned')return {status:'failed',...value};throw Object.assign(Error('https://private.test/?token=synthetic-secret'),value);
  }}),{service,id}=await submitted(storage,transport),job=await service.get(id),expected=['local','uploaded','returned'].includes(scenario)?'failed':'unknown';
  assert.equal(job.status,expected);assert.equal(job.providerDispatched,expected==='failed'?false:undefined);assert.equal(job.error.includes('synthetic-secret'),false);if(scenario==='uploaded')assert.equal(job.providerPreparation.stage,'uploaded');await service.close();
 }
});

test('a provider wrapping checkpoint failures cannot reopen network recovery in the current process',async()=>{
 const storage=store();storage.failWhen(value=>value.providerPreparation?.stage==='uploaded');const preparationId=randomUUID();
 const transport=provider({submit:async(_request,{onPreparationState})=>{await onPreparationState(stage(preparationId));try{await onPreparationState(stage(preparationId,'uploaded','confirmed'));}catch{throw Object.assign(Error('ambiguous upload'),{code:'provider_connection_unconfirmed'});}},resumePreparation:()=>assert.fail('storage failure cannot resume'),poll:()=>assert.fail('storage failure cannot poll')}),{service,id}=await submitted(storage,transport);
 assert.equal((await service.get(id)).code,'storage_error');assert.equal((await service.lookup('synthetic-mask-preparation')).code,'storage_error');await service.close();
});

test('preparation request hashes and recovery contexts use the entire prepared request',async()=>{
 const storage=store(),preparationId=randomUUID(),prepared={...request,parameters:{...request.parameters,sourceRange:{start:1,end:2}}};
 const transport=provider({submit:async(value,{request:context,onPreparationState})=>{assert.deepEqual(value,prepared);assert.deepEqual(context,prepared);await onPreparationState(stage(preparationId,'uploaded','confirmed',{requestHash:hash(prepared)}));throw Error('crash');},resumePreparation:async(state,{request:context})=>{assert.equal(state.requestHash,hash(prepared));assert.deepEqual(context,prepared);return {status:'unknown'};}});
 let service=createDurableGenerationService({store:storage,provider:transport,prepareRequest:async()=>prepared}),job=await service.submit(request,{idempotencyKey:'synthetic-mask-preparation'});await tick();await service.close();service=createDurableGenerationService({store:storage,provider:transport});assert.equal((await service.get(job.id)).code,'preparation_unconfirmed');await service.close();
});

test('read-only preparation recovery cannot smuggle outputs, terminal success, or unsafe task identities',async()=>{
 for(const value of [{status:'unknown',outputs:[{type:'text',text:'premature'}]},{status:'succeeded'},{id:'original-queue-id',status:'succeeded'},{id:'https://queue.test/?token=synthetic',status:'queued'}]){
  const storage=store(),preparationId=randomUUID(),initial=provider({submit:async(_request,{onPreparationState})=>{await onPreparationState(stage(preparationId,'generation-dispatching','dispatching'));throw Error('crash');}}),{service,id}=await submitted(storage,initial);await service.close();
  const restored=createDurableGenerationService({store:storage,provider:provider({resumePreparation:async()=>value,poll:()=>assert.fail('invalid preparation receipts cannot GET')})}),job=await restored.get(id);assert.equal(job.status,'unknown');assert.equal(job.code,value.id?.startsWith('https:')?'provider_identity_mismatch':'invalid_preparation_state');assert.equal(job.providerTaskId,undefined);assert.equal(job.outputs,undefined);await restored.close();
 }
});
