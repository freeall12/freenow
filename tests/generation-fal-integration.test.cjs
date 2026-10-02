const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {createGenerationRouter}=require('../server/generation-router.cjs');
const {createGenerationGateway}=require('../server/generation.cjs');
const {readGenerationRoutingConfig}=require('../server/generation-routing-config.cjs');
const map={'image.remove-background':{kind:'image.remove-background',model:'fal-ai/birefnet'},'image.upscale:topazlabs':{kind:'image.upscale',model:'fal-ai/topaz/upscale/image'}};
const config=()=>readGenerationRoutingConfig({GENERATION_PROVIDERS:JSON.stringify({fal:{protocol:'fal-native',apiKeyEnv:'FAL_KEY',modelMapEnv:'FAL_MODEL_MAP'}}),GENERATION_ROUTES:JSON.stringify({'image.remove-background':'fal','image.upscale':{models:{'image.upscale:topazlabs':'fal'}}}),FAL_KEY:'fixture-private-key',FAL_MODEL_MAP:JSON.stringify(map)});
const request={kind:'image.upscale',prompt:'',inputs:[{type:'image',url:'https://media.example.test/input.png'}],parameters:{provider:'topazlabs',style:'text_refine',scale:4}};
async function send(gateway,url,method='GET',input){let value;await gateway.handle({method,headers:{'idempotency-key':'fal-integration-1'}},{},url,{json:(_res,status,body)=>{value={status,body};},body:async()=>input});return value;}
async function settled(gateway,id,statuses){for(let i=0;i<50;i++){const {body}=await send(gateway,'/api/generation/tasks/'+id);if(statuses.includes(body.status))return body;await new Promise(resolve=>setTimeout(resolve,3));}throw Error('task did not settle');}

test('operator config and frontend use the same operation aliases without falling through to another model',async()=>{
 const ui=await import('../src/features/node-composer/provider-configuration.mjs'),router=createGenerationRouter({...config(),fetchImpl:()=>assert.fail('readiness does not dispatch')});
 assert.equal(router.configured,true);
 for(const [input,ready]of [[request,true],[{kind:'image.remove-background'},true],[{...request,parameters:{...request.parameters,provider:'magnific'}},false],[{...request,parameters:{...request.parameters,modelId:'missing'}},false],[{kind:'image.skin'},false]]){
  assert.equal(ui.providerConfigured(router.metadata,input),ready);assert.equal(router.protocolFor(input),ready?'fal-native':null);
 }
 const direct=router.metadata.providers.fal;assert.equal(ui.providerConfigured(direct,request),true);assert.equal(ui.providerConfigured(direct,{kind:'image.skin'}),false);
 assert.equal(ui.requestModelAlias({...request,parameters:{...request.parameters,providerParameters:{model:'explicit'}}}),'explicit');
 const publicData=JSON.stringify(router.metadata);for(const hidden of ['fixture-private-key','queue.fal.run','fal-ai/topaz','fal-ai/birefnet'])assert.ok(!publicData.includes(hidden));
 assert.ok(ui.configurationReadiness(router.metadata).some(row=>row.operation==='图片超分'&&row.configured));
});

test('native fal gateway persists one POST and recovers from the original model after route removal',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'freenow-fal-integration-')),calls=[];let complete=false;
 const fetchImpl=async(url,options)=>{
  calls.push({url:String(url),method:options.method,body:options.body&&JSON.parse(options.body)});
  assert.equal(new Headers(options.headers).get('authorization'),'Key fixture-private-key');
  if(options.method==='POST')return Response.json({request_id:'original-fal-task',queue_position:0});
  if(String(url).includes('/status'))return Response.json({request_id:'original-fal-task',status:complete?'COMPLETED':'IN_PROGRESS'});
  return Response.json({image:{url:'https://media.example.test/result.png',content_type:'image/png',width:1024,height:1024}});
 };
 let gateway=createGenerationGateway({directory,...config(),fetchImpl});
 t.after(async()=>{await gateway.close();await fs.rm(directory,{recursive:true,force:true});});
 const created=await send(gateway,'/api/generation/tasks','POST',request);assert.equal(created.status,202);await settled(gateway,created.body.id,['queued','running']);
 await gateway.close();complete=true;
 gateway=createGenerationGateway({directory,...config(),routes:{},fetchImpl});
 const recovered=(await send(gateway,'/api/generation/tasks/by-key/fal-integration-1')).body;assert.equal(recovered.status,'succeeded');assert.equal(recovered.outputs[0].url,'https://media.example.test/result.png');
 assert.equal(calls.filter(call=>call.method==='POST').length,1);assert.equal(calls[0].url,'https://queue.fal.run/fal-ai/topaz/upscale/image');assert.equal(calls[0].body.model,'Text Refine');assert.equal(calls[0].body.upscale_factor,4);
 assert.ok(calls.slice(1).every(call=>call.url.startsWith('https://queue.fal.run/fal-ai/topaz/requests/original-fal-task')));
});
