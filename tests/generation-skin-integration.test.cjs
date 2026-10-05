'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createGenerationGateway}=require('../server/generation.cjs');
const {createGenerationRouter}=require('../server/generation-router.cjs');
const {encodeRGBA}=require('../server/generation-png-alpha.cjs');
const key='synthetic-skin-integration-key',source=encodeRGBA(13,9,Buffer.alloc(13*9*4,250)),output=encodeRGBA(17,11,Buffer.alloc(17*11*4,220));
const url=bytes=>'data:image/png;base64,'+bytes.toString('base64');
const request=mode=>({kind:'image.skin',nodeId:'target',sourceNodeId:'source',prompt:'',inputs:[{type:'image',role:'source_image',nodeId:'source',url:url(source),width:13,height:9}],parameters:{mode}});
const direct=extra=>({protocol:'skin-tasks-v1',apiKey:key,baseUrl:'https://skin-integration.test/v1',...extra});
const routed=extra=>({providers:{skin:direct(extra)},routes:{'image.skin':'skin'}});
async function send(gateway,route,method='GET',input,id='skin-integration',configurationId){let value;await gateway.handle({method,headers:{'idempotency-key':id,...configurationId?{'x-generation-configuration-id':configurationId}:{}}},{},route,{json:(_res,status,body)=>{value={status,body};},body:async()=>input});return value;}
async function settle(gateway,id){for(let i=0;i<100;i++){const value=(await send(gateway,'/api/generation/tasks/'+id)).body;if(!['queued','running'].includes(value.status))return value;await new Promise(resolve=>setTimeout(resolve,3));}assert.fail('skin integration did not settle');}
async function harness(t,configuration,fetchImpl){const root=await fs.mkdtemp(path.join(os.tmpdir(),'freenow-skin-integration-'));let gateway;const open=async()=>{gateway=createGenerationGateway({...configuration,directory:path.join(root,'tasks'),fetchImpl});await gateway.ready;};await open();t.after(async()=>{await gateway.close();await fs.rm(root,{recursive:true,force:true});});return {get gateway(){return gateway;},async restart(){await gateway.close();await open();},bytes:value=>fs.readFile(path.join(root,'tasks-media',value.url.split('/').at(-1)+'.bin'))};}

test('direct and routed registrations expose dedicated gateway capabilities with no model map or media calls',async t=>{
 const ui=await import('../src/features/node-composer/provider-configuration.mjs'),skin=await import('../src/features/image-skin/native-profile.mjs'),r=request('standard');
 const router=createGenerationRouter({...routed(),fetchImpl:()=>assert.fail('metadata must not dispatch')});
 assert.equal(router.configured,true);assert.equal(router.protocolFor(r),'skin-tasks-v1');assert.equal(ui.providerConfigurationStatus(router.metadata,r).configured,true);assert.equal(skin.skinRequestState(router.metadata,r).ready,true);
 const row=ui.generationOperationReadiness(router.metadata).find(item=>item.kind==='image.skin');assert.equal(row.state,'gateway');assert.equal(row.configured,false);
 const gateway=createGenerationGateway({...direct(),fetchImpl:()=>assert.fail('metadata must not dispatch')});t.after(()=>gateway.close());const metadata=(await send(gateway,'/api/generation/config')).body;
 assert.equal(metadata.protocol,'skin-tasks-v1');assert.equal(skin.skinRequestState(metadata,r).ready,true);assert.equal(JSON.stringify(metadata).includes(key),false);
 const plain=createGenerationRouter({providers:{skin:{...direct(),protocol:'tasks-v1'}},routes:{'image.skin':'skin'}});assert.equal(skin.skinRequestState(plain.metadata,r).ready,false);
 for(const options of [{apiKey:''},{baseUrl:''},{modelMap:{skin:{kind:'image.skin',model:'guessed'}}}])assert.equal(skin.skinRequestState(createGenerationRouter(routed(options)).metadata,r).ready,false);
});

test('three selected modes preserve actual POST source, archive decoded output and survive restart without another POST',async t=>{
 for(const mode of ['detailed','standard','heavy']){
  const calls=[],h=await harness(t,routed(),async(target,options)=>{calls.push({url:String(target),method:options.method});if(options.method==='POST'){const body=JSON.parse(options.body);assert.deepEqual(body,request(mode));assert.equal(new Headers(options.headers).get('authorization'),'Bearer '+key);return Response.json({id:'remote-'+mode,status:'queued'});}assert.equal(String(target),'https://skin-integration.test/v1/tasks/remote-'+mode);return Response.json({id:'remote-'+mode,status:'succeeded',outputs:[{type:'image',url:url(output)}]});});
  const metadata=(await send(h.gateway,'/api/generation/config')).body,id='skin-'+mode,created=await send(h.gateway,'/api/generation/tasks','POST',request(mode),id,metadata.configurationId);assert.equal(created.status,202);
  const done=await settle(h.gateway,created.body.id);assert.equal(done.status,'succeeded');assert.deepEqual([done.outputs[0].width,done.outputs[0].height],[17,11]);assert.deepEqual(await h.bytes(done.outputs[0]),output);assert.match(done.outputs[0].url,/^\/api\/generation\/media\//);
  await h.restart();const restored=(await send(h.gateway,'/api/generation/tasks/by-key/'+id)).body;assert.equal(restored.id,done.id);assert.equal(restored.status,'succeeded');assert.deepEqual(restored.request.parameters,{mode});assert.deepEqual(await h.bytes(restored.outputs[0]),output);
  const duplicate=(await send(h.gateway,'/api/generation/tasks','POST',request(mode),id)).body;assert.equal(duplicate.id,done.id);assert.equal(calls.filter(c=>c.method==='POST').length,1);
 }
});

test('lost POST and accepted unknown original receipts remain unknown across restart and never submit again',async t=>{
 for(const accepted of [false,true]){
  let posts=0,gets=0;const h=await harness(t,routed(),async(_target,options)=>{if(options.method==='POST'){posts++;if(!accepted)throw Error('synthetic lost POST');return Response.json({id:'original-unknown',status:'queued'});}gets++;return Response.json({id:'original-unknown',status:'unknown'});});
  const id='unknown-'+accepted,created=(await send(h.gateway,'/api/generation/tasks','POST',request('heavy'),id)).body,done=await settle(h.gateway,created.id);assert.equal(done.status,'unknown');
  await h.restart();const restored=(await send(h.gateway,'/api/generation/tasks/by-key/'+id)).body;assert.equal(restored.id,done.id);assert.equal(restored.status,'unknown');const duplicate=(await send(h.gateway,'/api/generation/tasks','POST',request('heavy'),id)).body;assert.equal(duplicate.id,done.id);assert.equal(posts,1);if(accepted)assert.ok(gets>=1);
 }
});

test('source mismatch, extra selection and stale configuration are rejected before model POST',async t=>{
 let posts=0;const h=await harness(t,direct(),async()=>{posts++;assert.fail('invalid input must not dispatch');});
 const stale=await send(h.gateway,'/api/generation/tasks','POST',request('detailed'),'stale-skin','stale-config');assert.equal(stale.status,409);assert.equal(stale.body.providerDispatched,false);
 for(const [index,input]of [{...request('detailed'),prompt:'make skin'},{...request('standard'),inputs:[{...request('standard').inputs[0],sourceBox:{x:0,y:0,width:1,height:1}}]},{...request('heavy'),inputs:[{...request('heavy').inputs[0],width:99}]}].entries()){
  const created=(await send(h.gateway,'/api/generation/tasks','POST',input,'invalid-skin-'+index)).body,done=await settle(h.gateway,created.id);assert.equal(done.status,'failed');assert.equal(done.code,'request_preparation_failed');
 }
 assert.equal(posts,0);
});

test('supplier success with wrong actual dimensions cannot publish media or trigger a second generation',async t=>{
 let posts=0;const h=await harness(t,direct(),async(_target,options)=>{if(options.method==='POST'){posts++;return Response.json({id:'wrong-output-size',status:'queued'});}return Response.json({id:'wrong-output-size',status:'succeeded',outputs:[{type:'image',url:url(output),width:13,height:9}]});});
 const created=(await send(h.gateway,'/api/generation/tasks','POST',request('standard'),'bad-output-size')).body,done=await settle(h.gateway,created.id);assert.equal(done.status,'unknown');assert.equal(done.outputs,undefined);assert.equal(posts,1);
 await h.restart();const duplicate=(await send(h.gateway,'/api/generation/tasks','POST',request('standard'),'bad-output-size')).body;assert.equal(duplicate.id,done.id);assert.equal(posts,1);
});

test('accepted immediate success with damaged PNG persists original identity before output validation and recovers after restart',async t=>{
 let posts=0,gets=0,repaired=false;const h=await harness(t,routed(),async(target,options)=>{
  if(options.method==='POST'){posts++;return Response.json({id:'accepted-bad-png',status:'succeeded',outputs:[{type:'image',url:url(output.subarray(0,40))}]});}
  gets++;assert.equal(String(target),'https://skin-integration.test/v1/tasks/accepted-bad-png');return Response.json(repaired?{id:'accepted-bad-png',status:'succeeded',outputs:[{type:'image',url:url(output)}]}:{id:'accepted-bad-png',status:'unknown'});
 });
 const created=(await send(h.gateway,'/api/generation/tasks','POST',request('standard'),'accepted-bad-png')).body,unknown=await settle(h.gateway,created.id);
 assert.equal(unknown.status,'unknown');assert.equal(unknown.outputs,undefined);assert.equal(unknown.recovery.pollable,true);assert.equal(posts,1);
 await h.restart();repaired=true;let restored;
 for(let i=0;i<100;i++){restored=(await send(h.gateway,'/api/generation/tasks/'+created.id)).body;if(restored.status==='succeeded')break;await new Promise(resolve=>setTimeout(resolve,3));}
 assert.equal(restored.id,created.id);assert.equal(restored.status,'succeeded');assert.deepEqual(await h.bytes(restored.outputs[0]),output);assert.ok(gets>=1);assert.equal(posts,1);
 const duplicate=(await send(h.gateway,'/api/generation/tasks','POST',request('standard'),'accepted-bad-png')).body;assert.equal(duplicate.id,created.id);assert.equal(posts,1);
});
