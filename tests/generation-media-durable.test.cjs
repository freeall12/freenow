'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {createDurableGenerationService,checkedOutputs}=require('../server/generation-durable.cjs');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};}
function memoryStore(){const data=new Map();return {data,readAll:async()=>[...data.values()].map(value=>structuredClone(value)),write:async job=>data.set(job.id,structuredClone(job)),close:async()=>{}};}
const source='https://cdn.example.test/output.png?signature=private-capability';
const input={kind:'image.generate',prompt:'实际媒体'},privateOutputs=[{type:'image',url:source,mime:'image/png',title:'输出',width:4,height:3}];
function fixture(extra={}){
 const store=extra.store||memoryStore(),ref='/api/generation/media/'+randomUUID(),calls=[];
 const provider={configured:true,fingerprint:'fixed-provider',metadata:{protocol:'fixture'},submit:async()=>{calls.push('POST');return {status:'succeeded',outputs:privateOutputs};},poll:async()=>{calls.push('GET');return {status:'succeeded',outputs:privateOutputs};},cancel:async()=>{calls.push('DELETE');return {status:'cancelled'};}};
 const materializer=extra.materializer||{localize:async outputs=>({outputs:outputs.map(output=>({...output,url:ref})),resources:[ref.split('/').at(-1)]}),verify:async()=>({resources:[ref.split('/').at(-1)]})};
 return {service:createDurableGenerationService({store,provider,mediaMaterializer:materializer}),store,ref,calls};
}
async function submit(current){const job=await current.submit(input,{idempotencyKey:'media-stable-key'});return current.get(job.id);}
test('private descriptor checkpoint precedes download; public success waits for every localized resource',async()=>{
 const store=memoryStore(),gate=deferred(),entered=deferred(),resource=randomUUID();
 const materializer={localize:async(_outputs,{taskId})=>{const saved=store.data.get(taskId);assert.equal(saved.providerStatus,'succeeded');assert.equal(saved.status,'running');assert.equal(saved.providerResult.outputs[0].url,source);assert.equal(saved.outputs,undefined);entered.resolve();await gate.promise;return {outputs:[{...privateOutputs[0],url:'/api/generation/media/'+resource}],resources:[resource]};},verify:async()=>({resources:[resource]})};
 const f=fixture({store,materializer}),created=await f.service.submit(input,{idempotencyKey:'media-stable-key'});await entered.promise;
 assert.equal(store.data.get(created.id).status,'running');gate.resolve();const done=await f.service.get(created.id);
 assert.equal(done.status,'succeeded');assert.equal(done.outputs[0].url,'/api/generation/media/'+resource);assert.equal(done.localization.state,'ready');assert.equal(done.providerResult.outputs[0].url,source);assert.deepEqual(f.calls,['POST']);await f.service.close();
});
test('localization failure on a synchronous provider retries descriptor GET without a second POST',async()=>{
 let attempts=0;const resource=randomUUID(),materializer={localize:async()=>{attempts++;if(attempts===1)throw Object.assign(Error('unsafe message '+source),{code:'media_download_failed'});return {outputs:[{type:'image',url:'/api/generation/media/'+resource}],resources:[resource]};},verify:async()=>({resources:[resource]})};
 const f=fixture({materializer}),failed=await submit(f.service);assert.equal(failed.status,'unknown');assert.equal(failed.code,'media_localization_failed');assert.equal(failed.providerTaskId,undefined);assert.equal(failed.recovery.retryableLookup,true);assert.ok(!failed.error.includes(source));
 const [a,b]=await Promise.all([f.service.get(failed.id),f.service.lookup('media-stable-key')]);assert.equal(a.status,'succeeded');assert.equal(b.status,'succeeded');assert.equal(attempts,2);assert.deepEqual(f.calls,['POST']);await f.service.close();
});
test('restart with pending provider success only resumes its private bytes; cancellation prevents late publication',async()=>{
 const store=memoryStore(),entered=deferred(),resource=randomUUID();let pendingSignal;
 const first=fixture({store,materializer:{localize:async(_outputs,{signal})=>{pendingSignal=signal;entered.resolve();await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));throw Object.assign(Error('cancelled'),{code:'media_cancelled'});},verify:async()=>({resources:[resource]})}});
 const created=await first.service.submit(input,{idempotencyKey:'media-stable-key'});await entered.promise;await first.service.close();assert.equal(pendingSignal.aborted,true);assert.equal(store.data.get(created.id).providerStatus,'succeeded');
 const second=fixture({store});await second.service.ready;const done=await second.service.get(created.id);assert.equal(done.status,'succeeded');assert.deepEqual(second.calls,[]);await second.service.close();
 const late=deferred(),started=deferred(),third=fixture({materializer:{localize:async()=>{started.resolve();await late.promise;return {outputs:[{type:'image',url:'/api/generation/media/'+resource}],resources:[resource]};},verify:async()=>({resources:[resource]})}});
 const receipt=await third.service.submit(input,{idempotencyKey:'media-stable-key'});await started.promise;const cancel=await third.service.cancel(receipt.id);assert.equal(cancel.status,'cancelled');assert.equal(cancel.cancellation.providerCancellation,'already_succeeded');assert.equal(store.data.get(created.id).status,'succeeded');late.resolve();await tick();await tick();assert.equal((await third.service.get(receipt.id)).outputs,undefined);assert.deepEqual(third.calls,['POST']);await third.service.close();
});
test('missing ready media increments revision and recovers without reissuing generation',async()=>{
 let missing=false,downloads=0;const revisions=[],resource=randomUUID(),materializer={localize:async(_outputs,{revision})=>{downloads++;revisions.push(revision);missing=false;return {outputs:[{type:'image',url:'/api/generation/media/'+resource}],resources:[resource]};},verify:async()=>{if(missing)throw Object.assign(Error('missing'),{code:'media_integrity_error'});return {resources:[resource]};}};
 const f=fixture({materializer}),done=await submit(f.service);missing=true;const recovered=await f.service.get(done.id);assert.equal(recovered.status,'succeeded');assert.equal(recovered.localization.revision,1);assert.deepEqual(revisions,[0,1]);assert.equal(downloads,2);assert.deepEqual(f.calls,['POST']);await f.service.close();
});
test('close waits for active localization release before closing the task store',async()=>{
 const gate=deferred(),entered=deferred(),store=memoryStore();let released=false;store.close=async()=>{assert.equal(released,true);};
 const f=fixture({store,materializer:{localize:async(_outputs,{signal})=>{entered.resolve();await gate.promise;released=true;assert.equal(signal.aborted,true);throw Object.assign(Error('cancelled'),{code:'media_cancelled'});},verify:async()=>({resources:[]})}});
 await f.service.submit(input,{idempotencyKey:'media-stable-key'});await entered.promise;let closed=false;const closing=f.service.close().then(()=>closed=true);await tick();assert.equal(closed,false);gate.resolve();await closing;assert.equal(closed,true);
});
test('public validator accepts only exact local refs and retains metadata with no private URLs',()=>{
 const local='/api/generation/media/'+randomUUID();assert.equal(checkedOutputs([{type:'image',url:local,fullImage:local,poster:local,sourceUrl:local,mime:'image/png'}],{localOnly:true})[0].sourceUrl,local);
 for(const unsafe of [source,'http://localhost:4173'+local,local+'?url=x','/api/generation/media/not-a-uuid','blob:opaque'])assert.throws(()=>checkedOutputs([{type:'image',url:unsafe}],{localOnly:true}),{code:'invalid_outputs'});
 assert.throws(()=>checkedOutputs([{type:'image',url:local,poster:source}],{localOnly:true}),{code:'invalid_outputs'});
 assert.deepEqual(checkedOutputs([{type:'text',text:'文本无需媒体'}],{localOnly:true}),[{type:'text',text:'文本无需媒体'}]);
});

test('strict public world validation preserves representation, identity and every nested local resource',()=>{
 const ref=()=>'/api/generation/media/'+randomUUID(),selected=ref(),world={worldId:'world-1',model:'marble-1.1',marbleUrl:'https://marble.worldlabs.ai/world/world-1',coordinateSystem:'marble_raw_opencv',splatResolution:'500k',assets:{splats:{spzUrls:{'100k':ref(),'150k':ref(),'500k':selected,full_res:ref()},semanticsMetadata:{metricScaleFactor:1.25,groundPlaneOffset:-.5}},mesh:{colliderMeshUrl:ref(),fullResMeshUrl:ref(),hqMeshUrl:ref()},imagery:{panoUrl:ref()}}};
 const output={type:'model',url:selected,format:'spz',representation:'gaussianSplat',sourceFileId:'world-1',filename:'真实世界.spz',poster:ref(),world};assert.deepEqual(checkedOutputs([output],{localOnly:true}),[output]);
 for(const mutate of [v=>v.world.assets.mesh.hqMeshUrl=source,v=>v.world.assets.splats.spzUrls['100k']=source,v=>v.world.assets.imagery.panoUrl=source,v=>v.world.marbleUrl+='?signature=private',v=>v.world.assets.splats.spzUrls['500k']=ref()]){const copy=structuredClone(output);mutate(copy);assert.throws(()=>checkedOutputs([copy],{localOnly:true}),{code:'invalid_outputs'});}
});
test('a cancelled submission records late provider success without claiming upstream generation was cancelled',async()=>{
 const store=memoryStore(),sent=deferred(),gate=deferred(),calls=[];let localized=0;
 const provider={configured:true,fingerprint:'fixed',metadata:{protocol:'fixture'},submit:async()=>{calls.push('POST');sent.resolve();await gate.promise;return {id:'remote',status:'succeeded',outputs:privateOutputs};},cancel:async()=>{calls.push('DELETE');return {status:'cancelled'};},poll:async()=>assert.fail('cancelled task must not poll')};
 const service=createDurableGenerationService({store,provider,mediaMaterializer:{localize:async()=>{localized++;assert.fail('cancelled late result must not localize');},verify:async()=>({resources:[]})}}),job=await service.submit(input,{idempotencyKey:'late-success-cancel'});await sent.promise;const receipt=await service.cancel(job.id);assert.equal(receipt.status,'cancelled');gate.resolve();await tick();await tick();const done=await service.get(job.id);assert.equal(done.status,'cancelled');assert.equal(done.outputs,undefined);assert.equal(done.providerStatus,'succeeded');assert.equal(done.cancellation.providerCancellation,'already_succeeded');assert.deepEqual(calls,['POST']);assert.equal(localized,0);await service.close();
});
test('expired download refreshes only the original provider task once and persists a new descriptor revision',async()=>{
 const store=memoryStore(),calls=[],revisions=[],resource=randomUUID(),fresh='https://cdn.example.test/output.png?signature=refreshed';
 const provider={configured:true,fingerprint:'original',metadata:{protocol:'fixture'},submit:async()=>{calls.push('POST');return {id:'original-remote',status:'succeeded',outputs:privateOutputs};},poll:async id=>{calls.push('GET');assert.equal(id,'original-remote');return {id,status:'succeeded',outputs:[{...privateOutputs[0],url:fresh}]};}};
 const materializer={localize:async(outputs,{revision,taskId})=>{revisions.push(revision);assert.equal(store.data.get(taskId).providerResult.outputs[0].url,outputs[0].url);if(outputs[0].url===source)throw Object.assign(Error('expired '+source),{code:'media_download_expired'});return {outputs:[{...outputs[0],url:'/api/generation/media/'+resource}],resources:[resource]};},verify:async()=>({resources:[resource]})};
 let service=createDurableGenerationService({store,provider,mediaMaterializer:materializer});const created=await service.submit(input,{idempotencyKey:'refresh-signed-source'}),failed=await service.get(created.id);assert.equal(failed.localization.errorCode,'media_download_expired');await service.close();
 service=createDurableGenerationService({store,provider,mediaMaterializer:materializer});await service.ready;assert.equal(store.data.get(created.id).status,'unknown');assert.deepEqual(calls,['POST']);const [a,b]=await Promise.all([service.get(created.id),service.get(created.id)]);assert.equal(a.status,'succeeded');assert.equal(b.status,'succeeded');assert.equal(a.localization.revision,1);assert.deepEqual(revisions,[0,1]);assert.deepEqual(calls,['POST','GET']);await service.close();
});
test('expired descriptor without recovery identity, with changed provider, or mismatched refreshed task stays unknown without POST',async()=>{
 for(const scenario of ['no-id','no-poll','changed-provider','mismatched-id']){
  const store=memoryStore(),calls=[],resource=randomUUID();let downloads=0;
  const provider={configured:true,fingerprint:'original',metadata:{protocol:'fixture'},submit:async()=>{calls.push('POST');return {...(scenario==='no-id'?{}:{id:'original-remote'}),status:'succeeded',outputs:privateOutputs};},...(scenario==='no-poll'?{}:{poll:async()=>{calls.push('GET');return {id:'wrong-remote',status:'succeeded',outputs:[{type:'image',url:'https://cdn.example.test/new.png?signature=still-private'}]};}})};
  const mediaMaterializer={localize:async()=>{downloads++;throw Object.assign(Error('signed expired'),{code:'media_download_expired'});},verify:async()=>({resources:[resource]})};
  let service=createDurableGenerationService({store,provider,mediaMaterializer}),created=await service.submit(input,{idempotencyKey:'refresh-unavailable-key'});await service.get(created.id);for(let i=0;i<20&&store.data.get(created.id).localization?.state!=='failed';i++)await tick();
  if(scenario==='changed-provider'){await service.close();provider.fingerprint='changed';service=createDurableGenerationService({store,provider,mediaMaterializer});await service.ready;}
  const failed=await service.get(created.id);assert.equal(failed.status,'unknown');assert.equal(failed.code,'media_localization_failed');assert.equal(failed.providerStatus,'succeeded');assert.equal(failed.outputs,undefined);assert.equal(failed.providerResult.outputs[0].url,source);assert.equal(downloads,1);assert.equal(calls.filter(x=>x==='POST').length,1);
  assert.equal(failed.localization.errorCode,scenario==='mismatched-id'?'media_source_identity_mismatch':scenario==='changed-provider'?'media_source_provider_changed':'media_source_refresh_unavailable');assert.deepEqual(calls,scenario==='mismatched-id'?['POST','GET']:['POST']);await service.close();
 }
});
test('cancel during original-task signed URL refresh blocks its late descriptor and download publication',async()=>{
 const store=memoryStore(),sent=deferred(),gate=deferred(),calls=[];let downloads=0;
 const provider={configured:true,fingerprint:'original',metadata:{protocol:'fixture'},submit:async()=>{calls.push('POST');return {id:'original-remote',status:'succeeded',outputs:privateOutputs};},poll:async()=>{calls.push('GET');sent.resolve();await gate.promise;return {id:'original-remote',status:'succeeded',outputs:[{type:'image',url:'https://cdn.example.test/refreshed.png?signature=fresh'}]};},cancel:async()=>{calls.push('DELETE');return {status:'cancelled'};}};
 const service=createDurableGenerationService({store,provider,mediaMaterializer:{localize:async()=>{downloads++;throw Object.assign(Error('expired'),{code:'media_download_expired'});},verify:async()=>({resources:[]})}}),created=await service.submit(input,{idempotencyKey:'cancel-signed-refresh'});await service.get(created.id);const pending=service.get(created.id);await sent.promise;await service.cancel(created.id);gate.resolve();const cancelled=await pending;assert.equal(cancelled.status,'cancelled');assert.equal(cancelled.outputs,undefined);assert.equal(cancelled.providerResult.outputs[0].url,source);assert.equal(cancelled.localization.revision,0);assert.equal(downloads,1);assert.deepEqual(calls,['POST','GET']);await service.close();
});
