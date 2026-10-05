'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createGenerationGateway}=require('../server/generation.cjs');
const {createGenerationRouter}=require('../server/generation-router.cjs');
const {encodeRGBA}=require('../server/generation-png-alpha.cjs');
const source=encodeRGBA(13,9,Buffer.alloc(13*9*4,255)),output=encodeRGBA(20,12,Buffer.alloc(20*12*4,210));
const key='synthetic-relight-integration-key';
const profile={kind:'image.relight',model:'gpt-image-2',semantics:'parameter-prompt-edit',quality:'high',outputSize:'auto'};
const request={kind:'image.relight',sourceNodeId:'source',prompt:'',inputs:[{type:'image',role:'source_image',nodeId:'source',url:'data:image/png;base64,'+source.toString('base64'),width:13,height:9}],parameters:{angle:{preset:'top_front_left_45'},brightnessPercent:100,temperatureK:3000,rimEnabled:true,rimPreset:'low_back_45'}};
const direct=extra=>({protocol:'openai-relight-native',apiKey:key,modelMap:{'image.relight':profile},...extra});
const routed=extra=>({providers:{lighting:direct(extra)},routes:{'image.relight':'lighting'}});

async function send(gateway,url,method='GET',input,id='relight-integration',configurationId){
 let response;await gateway.handle({method,headers:{'idempotency-key':id,...(configurationId?{'x-generation-configuration-id':configurationId}:{})}},{},url,{json:(_res,status,body)=>{response={status,body};},body:async()=>input});return response;
}
async function settle(gateway,id){
 for(let i=0;i<100;i++){const value=(await send(gateway,'/api/generation/tasks/'+id)).body;if(!['queued','running'].includes(value.status))return value;await new Promise(resolve=>setTimeout(resolve,3));}
 assert.fail('relight integration did not settle');
}
async function harness(t,configuration,fetchImpl){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'freenow-relight-integration-'));let gateway;
 const open=async()=>{gateway=createGenerationGateway({...configuration,directory:path.join(root,'tasks'),fetchImpl});await gateway.ready;};await open();
 t.after(async()=>{await gateway.close();await fs.rm(root,{recursive:true,force:true});});
 return {get gateway(){return gateway;},root,async restart(){await gateway.close();await open();},bytes:value=>fs.readFile(path.join(root,'tasks-media',value.url.split('/').at(-1)+'.bin'))};
}

test('direct and routed registries expose the complete kind-only lighting profile without media or model calls',async t=>{
 const ui=await import('../src/features/node-composer/provider-configuration.mjs'),lighting=await import('../src/features/image-relight/native-profile.mjs');
 const router=createGenerationRouter({...routed(),fetchImpl:()=>assert.fail('readiness must not dispatch')});
 assert.equal(router.configured,true);assert.equal(router.protocolFor(request),'openai-relight-native');
 assert.equal(ui.providerConfigured(router.metadata,request),true);assert.equal(lighting.relightRequestState(router.metadata,request).ready,true);
 assert.equal(ui.generationOperationReadiness(router.metadata).find(item=>item.kind==='image.relight').state,'ready');
 assert.equal(router.metadata.providers.lighting.capabilities.relight.anglePresets.length,26);
 assert.equal(JSON.stringify(router.metadata).includes(key),false);
 const gateway=createGenerationGateway({...direct(),fetchImpl:()=>assert.fail('metadata must not dispatch')});t.after(()=>gateway.close());
 const metadata=(await send(gateway,'/api/generation/config')).body;
 assert.equal(metadata.protocol,'openai-relight-native');assert.equal(lighting.relightRequestState(metadata,request).ready,true);
 for(const config of [routed({apiKey:''}),routed({modelMap:{}}),routed({modelMap:{alias:profile}}),{...routed(),routes:{}}]){
  const unavailable=createGenerationRouter(config);assert.equal(ui.providerConfigured(unavailable.metadata,request),false);assert.throws(()=>unavailable.prepare(request));
 }
});

test('real SDK edit preserves nonstandard source size, all light parameters and actual output dimensions through archive and restart',async t=>{
 let calls=0;const current=await harness(t,routed(),async(url,options)=>{
  calls++;assert.equal(String(url),'https://api.openai.com/v1/images/edits');assert.equal(options.method,'POST');
  assert.equal(options.redirect,'error');assert.equal(new Headers(options.headers).get('authorization'),'Bearer '+key);
  const form=options.body;assert(form instanceof FormData);const images=form.getAll('image[]');assert.equal(images.length,1);assert.deepEqual(Buffer.from(await images[0].arrayBuffer()),source);
  for(const [name,value]of Object.entries({model:'gpt-image-2',size:'auto',quality:'high',n:'1',output_format:'png',stream:'false'}))assert.equal(form.get(name),value);
  const prompt=String(form.get('prompt')),compiled=JSON.parse(prompt.slice(prompt.indexOf('\n')+1));
  assert.deepEqual([compiled.source.widthPx,compiled.source.heightPx],[13,9]);
  assert.deepEqual([compiled.mainLight.preset,compiled.mainLight.azimuthDeg,compiled.mainLight.elevationDeg,compiled.mainLight.brightnessPercent,compiled.mainLight.temperatureK],['top_front_left_45',315,45,100,3000]);
  assert.deepEqual([compiled.rimLight.enabled,compiled.rimLight.preset,compiled.rimLight.elevationDeg],[true,'low_back_45',-45]);
  return Response.json({data:[{b64_json:output.toString('base64')}]});
 });
 const metadata=(await send(current.gateway,'/api/generation/config')).body;
 const created=await send(current.gateway,'/api/generation/tasks','POST',request,'accepted-lighting',metadata.configurationId);assert.equal(created.status,202);
 const done=await settle(current.gateway,created.body.id);assert.equal(done.status,'succeeded');assert.equal(done.outputs.length,1);
 assert.deepEqual([done.outputs[0].width,done.outputs[0].height],[20,12]);assert.deepEqual(await current.bytes(done.outputs[0]),output);
 assert.match(done.outputs[0].url,/^\/api\/generation\/media\//);assert.equal(calls,1);
 await current.restart();
 const restored=(await send(current.gateway,'/api/generation/tasks/by-key/accepted-lighting')).body;
 assert.equal(restored.id,done.id);assert.equal(restored.status,'succeeded');assert.deepEqual(restored.request.parameters,request.parameters);assert.deepEqual(await current.bytes(restored.outputs[0]),output);
 const duplicate=(await send(current.gateway,'/api/generation/tasks','POST',request,'accepted-lighting')).body;assert.equal(duplicate.id,done.id);assert.equal(calls,1);
});

test('changed approval configuration and unsupported controls do not dispatch paid edits',async t=>{
 let calls=0;const current=await harness(t,routed(),async()=>{calls++;assert.fail('invalid requests must not dispatch');});
 const changed=await send(current.gateway,'/api/generation/tasks','POST',request,'stale-lighting','stale-approved-configuration');
 assert.equal(changed.status,409);assert.equal(changed.body.code,'configuration_changed');assert.equal(changed.body.providerDispatched,false);
 for(const [id,delta]of Object.entries({extra:{model:'image.relight'},rim:{angle:{preset:'back_180'}},temperature:{temperatureK:5500}})){
  const created=(await send(current.gateway,'/api/generation/tasks','POST',{...request,parameters:{...request.parameters,...delta}},'invalid-'+id)).body;
  const done=await settle(current.gateway,created.id);assert.equal(done.status,'failed');assert.equal(done.code,'request_preparation_failed');
 }
 assert.equal(calls,0);
});

test('ambiguous synchronous provider result remains unknown after restart and repeated idempotent lookup',async t=>{
 let calls=0;const current=await harness(t,direct(),async()=>{calls++;throw Error('synthetic lost response');});
 const created=(await send(current.gateway,'/api/generation/tasks','POST',request,'unknown-lighting')).body,done=await settle(current.gateway,created.id);
 assert.equal(done.status,'unknown');assert.equal(done.recovery.pollable,false);assert.equal(calls,1);
 await current.restart();
 const restored=(await send(current.gateway,'/api/generation/tasks/by-key/unknown-lighting')).body;assert.equal(restored.id,done.id);assert.equal(restored.status,'unknown');
 const duplicate=(await send(current.gateway,'/api/generation/tasks','POST',request,'unknown-lighting')).body;assert.equal(duplicate.id,done.id);assert.equal(duplicate.status,'unknown');assert.equal(calls,1);
});
