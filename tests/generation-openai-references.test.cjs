const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createOpenAINativeProvider}=require('../server/generation-openai.cjs');
const {createGenerationGateway}=require('../server/generation.cjs');
const {createDurableGenerationService}=require('../server/generation-durable.cjs');
const {createGenerationMediaStore}=require('../server/generation-media-store.cjs');
const {createGenerationMediaMaterializer}=require('../server/generation-media-materializer.cjs');
const os=require('node:os');
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jCn0AAAAASUVORK5CYII=';
const fixtures=[['png',Buffer.from(png,'base64')],['jpeg',fs.readFileSync(path.join(__dirname,'fixtures/red.jpg'))],['webp',fs.readFileSync(path.join(__dirname,'fixtures/blue.webp'))]];
const inputs=fixtures.map(([format,bytes])=>({type:'image',url:'data:image/'+format+';base64,'+bytes.toString('base64')}));
const profile={kind:'image.generate',model:'accessible-test-model',supportsImageReferences:true,maxImages:16,maxCount:2,sizeMap:{'1:1|1K':'1024x1024'},qualityMap:{high:'high'}};
const modelMap={image:profile};
const request={kind:'image.generate',prompt:'按顺序参考三张图片',inputs,parameters:{model:'image',providerParameters:{model:'image',mode:'image_to_image',aspectRatio:'1:1',imageSize:'1K',quality:'high',times:1}}};
const response=()=>new Response(JSON.stringify({data:[{b64_json:png}]}),{status:200,headers:{'content-type':'application/json'}});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function settled(service,id){for(let i=0;i<200;i++){const job=await service.get(id);if(!['queued','running'].includes(job.status))return job;await new Promise(resolve=>setTimeout(resolve,3));}assert.fail('task remained active');}
function memoryStore(){const records=new Map();return {readAll:async()=>[...records.values()],write:async value=>records.set(value.id,structuredClone(value))};}

test('installed SDK sends ordered real PNG/JPEG/WebP multipart uploads to Images edits',async()=>{
 let attempts=0;
 const provider=createOpenAINativeProvider({apiKey:'test-key-only',baseUrl:'https://isolated-provider.test/v1',modelMap,fetchImpl:async(url,options)=>{
  if(String(url)==='data:,')return new Response(''); // SDK's local FormData support probe.
  attempts++;assert.equal(String(url),'https://isolated-provider.test/v1/images/edits');assert.equal(new Headers(options.headers).get('authorization'),'Bearer test-key-only');
  const wire=new Request(url,{...options,duplex:'half'});assert.match(wire.headers.get('content-type'),/^multipart\/form-data; boundary=/);
  const form=await wire.formData(),uploads=form.getAll('image[]');assert.equal(uploads.length,3);
  for(const [index,file]of uploads.entries()){assert.equal(file.type,'image/'+fixtures[index][0]);assert.equal(file.name,'reference-'+(index+1)+'.'+(index===1?'jpg':fixtures[index][0]));assert.deepEqual(Buffer.from(await file.arrayBuffer()),fixtures[index][1]);}
  assert.deepEqual([...form.keys()].filter(key=>key!=='image[]'),['model','prompt','size','quality','n']);assert.equal(form.get('model'),profile.model);assert.equal(form.get('n'),'1');assert.equal(form.get('size'),'1024x1024');assert.equal(form.get('quality'),'high');assert.equal(form.get('mask'),null);assert.equal(form.get('input_fidelity'),null);
  return response();
 }});
 const result=await provider.submit(request);assert.equal(attempts,1);assert.equal(result.outputs[0].width,1);assert.equal(result.outputs[0].height,1);assert.equal(result.outputs[0].url,'data:image/png;base64,'+png);
});

test('reference capability is explicit, bounded and reported without actual model or credentials',async()=>{
 for(const extra of [{supportsImageReferences:true},{supportsImageReferences:'yes',maxImages:1},{supportsImageReferences:true,maxImages:0},{supportsImageReferences:true,maxImages:17},{supportsImageReferences:false,maxImages:1},{supportsImageReferences:true,maxImages:1.5}])assert.equal(createOpenAINativeProvider({apiKey:'private-key',modelMap:{image:{kind:'image.generate',model:'m',...extra}}}).metadata.configurationError,'configuration_invalid');
 const legacy=createOpenAINativeProvider({apiKey:'private-key',modelMap:{image:{kind:'image.generate',model:'m'}}});assert.equal(legacy.metadata.capabilities.references,false);assert.throws(()=>legacy.prepare(request),{code:'configuration_required'});
 const gateway=createGenerationGateway({protocol:'openai-native',apiKey:'private-key',modelMap});let config;
 await gateway.handle({method:'GET'},{},'/api/generation/config',{json:(_res,status,value)=>{assert.equal(status,200);config=value;}});
 assert.equal(config.capabilities.references,true);assert.deepEqual(config.capabilities.imageReferences.image,{maxImages:16,mimeTypes:['image/png','image/jpeg','image/webp'],transport:'inline'});assert.equal(config.capabilities.remoteCancellation,false);assert.ok(!JSON.stringify(config).includes('private-key'));assert.ok(!JSON.stringify(config).includes(profile.model));await gateway.close();
});

test('references fail closed for URLs, formats, encodings, bounds, modes and unsupported edits',()=>{
 const provider=createOpenAINativeProvider({modelMap,client:{images:{edit:()=>assert.fail('must not dispatch')}}});
 for(const url of ['https://public.test/image.png','http://localhost/image.png','blob:https://app.test/image','asset:image','data:image/svg+xml;base64,PHN2Zz4=','data:image/png;base64,'+fixtures[1][1].toString('base64'),'data:image/jpeg;base64,'+png,'data:image/png;base64,AA==','data:image/png;base64,'+png.slice(0,-1),'data:image/webp;base64,'+fixtures[2][1].subarray(0,22).toString('base64')])assert.throws(()=>provider.prepare({...request,inputs:[{type:'image',url}]}),{code:'unsupported_generation'});
 assert.doesNotThrow(()=>provider.prepare({...request,inputs:Array.from({length:16},()=>inputs[0])}));
 assert.throws(()=>provider.prepare({...request,inputs:Array.from({length:17},()=>inputs[0])}),/参考超过/);
 for(const change of [{inputs:[]},{parameters:{model:'image',mode:'text_to_image'}},{parameters:{model:'image',mask:inputs[0].url}},{inputs:[{type:'video',url:inputs[0].url}]},{kind:'image.redraw'},{kind:'image.outpaint'},{kind:'image.erase'},{prompt:'x'.repeat(32001)},{parameters:{model:'image',count:3}},{parameters:{model:'image',ratio:'16:9',imageSize:'1K'}}])assert.throws(()=>provider.prepare({...request,...change}));
 const bounded=createOpenAINativeProvider({modelMap:{image:{...profile,maxImages:1}},client:{images:{edit:()=>assert.fail()}}});assert.throws(()=>bounded.prepare(request),/参考超过/);
 const large='data:image/png;base64,'+'A'.repeat(64*1024*1024);assert.throws(()=>provider.prepare({...request,inputs:[{type:'image',url:large}]}),/64 MiB/);
});

test('no-reference request retains generate path while reference errors stay unknown without retry',async()=>{
 let generate=0,edit=0;
 const provider=createOpenAINativeProvider({modelMap,client:{images:{generate:async()=>{generate++;return {data:[{b64_json:png}]};},edit:async()=>{edit++;throw Error('uncertain');}}}});
 await provider.submit({...request,inputs:[],parameters:{model:'image',mode:'text_to_image'}});assert.equal(generate,1);
 await assert.rejects(provider.submit(request),{code:'unknown'});assert.equal(edit,1);
 let attempts=0;const sdk=createOpenAINativeProvider({apiKey:'test-key-only',baseUrl:'https://isolated-provider.test/v1',modelMap,fetchImpl:async url=>{if(String(url)==='data:,')return new Response('');attempts++;return new Response(JSON.stringify({error:{message:'429'}}),{status:429,headers:{'content-type':'application/json'}});}});
 await assert.rejects(sdk.submit(request),{code:'unknown'});assert.equal(attempts,1);
 for(const data of [[],[{b64_json:'bm90IGEgcG5n'}],[{url:'data:image/png;base64,'+png}]]){const bad=createOpenAINativeProvider({modelMap,client:{images:{edit:async()=>({data})}}});await assert.rejects(bad.submit(request),{code:'unknown'});}
 const controller=new AbortController();controller.abort(Error('cancelled before submit'));await assert.rejects(provider.submit(request,{signal:controller.signal}),/cancelled before/);assert.equal(edit,1);
});

test('reference durable success and unknown survive restart and never repeat the same submission',async t=>{
 const directory=await fs.promises.mkdtemp(path.join(os.tmpdir(),'openai-reference-media-')),mediaStore=createGenerationMediaStore({directory}),mediaMaterializer=createGenerationMediaMaterializer({store:mediaStore});
 t.after(async()=>{await mediaStore.close();await fs.promises.rm(directory,{recursive:true,force:true});});
 for(const uncertain of [false,true]){
  let attempts=0;const store=memoryStore(),provider=createOpenAINativeProvider({modelMap,client:{images:{edit:async()=>{attempts++;if(uncertain)throw Error('lost');return {data:[{b64_json:png}]};}}}});
  let service=createDurableGenerationService({store,provider,mediaMaterializer});const first=await service.submit(request,{idempotencyKey:'edit-idempotency'}),job=await settled(service,first.id);assert.equal(job.status,uncertain?'unknown':'succeeded');
  if(!uncertain){assert.match(job.outputs[0].url,/^\/api\/generation\/media\//);const saved=await mediaStore.open(job.outputs[0].url.split('/').at(-1),{taskId:job.id});try{assert.deepEqual(await saved.handle.readFile(),Buffer.from(png,'base64'));}finally{await saved.handle.close();}}
  await service.close();
  service=createDurableGenerationService({store,provider,mediaMaterializer});assert.equal((await service.lookup('edit-idempotency')).status,job.status);assert.equal((await service.submit(request,{idempotencyKey:'edit-idempotency'})).id,first.id);assert.equal(attempts,1);await service.close();
 }
});

test('cancelling an in-flight edit blocks late results without promising remote cancellation',async()=>{
 let release,started;const began=new Promise(resolve=>started=resolve),pending=new Promise(resolve=>release=resolve);
 const provider=createOpenAINativeProvider({modelMap,client:{images:{edit:async()=>{started();await pending;return {data:[{b64_json:png}]};}}}}),service=createDurableGenerationService({store:memoryStore(),provider});
 const job=await service.submit(request,{idempotencyKey:'edit-cancel'});await began;const receipt=await service.cancel(job.id);assert.equal(receipt.cancellation.providerCancellation,'unconfirmed');release();await tick();await tick();assert.equal((await service.get(job.id)).status,'cancelled');assert.equal((await service.get(job.id)).outputs,undefined);await service.close();
});

test('canonical model fields and mapped aliases cannot silently select a different model',()=>{
 const provider=createOpenAINativeProvider({modelMap:{A:{...profile,model:'actual-A'},B:{...profile,model:'actual-B'}},client:{images:{edit:()=>assert.fail('model mismatch must not dispatch')}}});
 for(const parameters of [{model:'A',modelId:'A',providerParameters:{model:'B',mode:'image_to_image'}},{modelId:'A',providerParameters:{model:'B',mode:'image_to_image'}},{model:'A',providerParameters:{model:'B',mode:'image_to_image'}},{model:'A',modelId:'B',providerParameters:{model:'B',mode:'image_to_image'}},{model:'unmapped-label',providerParameters:{model:'B',mode:'image_to_image'}}])assert.throws(()=>provider.prepare({...request,parameters}),/模型参数不一致/);
 assert.doesNotThrow(()=>provider.prepare({...request,parameters:{model:'画布展示名称',modelId:'A',providerParameters:{model:'A',mode:'image_to_image'}}}));
});
