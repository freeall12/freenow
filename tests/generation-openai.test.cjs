const test=require('node:test'),assert=require('node:assert/strict');
const {createOpenAINativeProvider}=require('../server/generation-openai.cjs');
const {createGenerationGateway}=require('../server/generation.cjs');
const {createDurableGenerationService}=require('../server/generation-durable.cjs');
const {httpProvider}=require('../generation-api.js');
const map={text:{kind:'text.generate',model:'actual-text-model',reasoningMap:{high:'high'},maxCount:2},image:{kind:'image.generate',model:'actual-image-model',sizeMap:{'1:1|1K':'1024x1024'},qualityMap:{high:'high'},maxCount:2}};
const textRequest={kind:'text.generate',prompt:'写一段文字',parameters:{model:'text',count:1,reasoning_effort:'high'}};
function memoryStore(){const data=new Map();return {data,readAll:async()=>[...data.values()],write:async value=>{data.set(value.id,structuredClone(value));}};}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function settle(service,id){for(let index=0;index<20;index++){const job=await service.get(id);if(!['queued','running'].includes(job.status))return job;await tick();}assert.fail('native task did not settle');}
test('native configuration rejects malformed maps and URLs without throwing or exposing credentials',()=>{
 for(const modelMap of ['{broken','[]','{"alias":"model"}',{text:{kind:'text.generate',model:'m',maxCount:0}}]){const provider=createOpenAINativeProvider({apiKey:'private-key',modelMap});assert.equal(provider.configured,false);assert.equal(provider.metadata.configurationError,'configuration_invalid');assert.ok(!JSON.stringify(provider.metadata).includes('private-key'));}
 for(const baseUrl of ['https://key:secret@host.test','https://host.test?token=secret','ftp://host.test'])assert.equal(createOpenAINativeProvider({apiKey:'private-key',baseUrl,modelMap:map}).configured,false);
 assert.equal(createOpenAINativeProvider({apiKey:'private-key',modelMap:map}).configured,true);
});
test('installed SDK uses Responses and Images paths with injected fetch and never retries uncertain 429',async()=>{
 const calls=[],provider=createOpenAINativeProvider({apiKey:'test-key-only',baseUrl:'https://isolated-provider.test/v1',modelMap:map,fetchImpl:async(url,options)=>{
  calls.push({url:String(url),body:JSON.parse(options.body)});assert.equal(new Headers(options.headers).get('authorization'),'Bearer test-key-only');
  const result=String(url).endsWith('/responses')?{id:'response-id',status:'completed',output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:'SDK正文',annotations:[]}]}]}:{data:[{b64_json:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jCn0AAAAASUVORK5CYII='}]};
  return new Response(JSON.stringify(result),{status:200,headers:{'content-type':'application/json'}});
 }});
 assert.equal((await provider.submit(textRequest)).outputs[0].text,'SDK正文');await provider.submit({kind:'image.generate',prompt:'树',parameters:{model:'image'}});assert.deepEqual(calls.map(call=>call.url),['https://isolated-provider.test/v1/responses','https://isolated-provider.test/v1/images/generations']);assert.equal(calls[1].body.n,1);
 let attempts=0;const limited=createOpenAINativeProvider({apiKey:'test-key-only',baseUrl:'https://isolated-provider.test/v1',modelMap:map,fetchImpl:async()=>{attempts++;return new Response(JSON.stringify({error:{message:'test 429',type:'rate_limit_error'}}),{status:429,headers:{'content-type':'application/json'}});}});await assert.rejects(()=>limited.submit(textRequest),{code:'unknown'});assert.equal(attempts,1);
});
test('Responses uses only explicit alias mapping, reasoning, ordered count and zero SDK retries',async()=>{
 const calls=[],provider=createOpenAINativeProvider({modelMap:map,client:{responses:{create:async(body,options)=>{calls.push({body,options});return {status:'completed',output_text:'正文 '+calls.length};}}}});
 const request={...textRequest,inputs:[{type:'text',text:'参考正文'}],parameters:{...textRequest.parameters,count:2}};
 const result=await provider.submit(request,{signal:new AbortController().signal});assert.deepEqual(result.outputs.map(item=>item.text),['正文 1','正文 2']);assert.equal(calls[0].body.model,'actual-text-model');assert.equal(calls[0].body.input,'参考正文\n\n写一段文字');assert.deepEqual(calls[0].body.reasoning,{effort:'high'});assert.equal(calls[0].body.store,false);assert.equal(calls[0].options.maxRetries,0);
});
test('Images maps exact presentation dimensions and quality and returns actual media output',async()=>{
 let called;const provider=createOpenAINativeProvider({modelMap:map,client:{images:{generate:async(body,options)=>{called={body,options};return {data:[{b64_json:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jCn0AAAAASUVORK5CYII='}]};}}}});
 const result=await provider.submit({kind:'image.generate',prompt:'一棵树',parameters:{modelId:'image',providerParameters:{model:'image',mode:'text_to_image',aspectRatio:'1:1',imageSize:'1K',quality:'high',times:1}}});
 assert.deepEqual(called.body,{model:'actual-image-model',prompt:'一棵树',size:'1024x1024',quality:'high',n:1});assert.equal(called.options.maxRetries,0);assert.match(result.outputs[0].url,/^data:image\/png;base64,/);assert.equal(result.outputs[0].width,1);assert.equal(result.outputs[0].height,1);
});
test('unsupported inputs, operations, model aliases, dimensions and counts fail before any SDK call',()=>{
 const provider=createOpenAINativeProvider({modelMap:map,client:{responses:{create:()=>assert.fail()},images:{generate:()=>assert.fail()}}});
 for(const request of [{...textRequest,kind:'video.generate'},{...textRequest,inputs:[{type:'image',url:'https://image.test/real.png'}]},{...textRequest,parameters:{model:'unmapped'}},{...textRequest,parameters:{model:'text',count:3}},{...textRequest,parameters:{model:'text',reasoning_effort:'max'}},{kind:'image.generate',prompt:'树',parameters:{model:'image',ratio:'16:9',imageSize:'1K'}},{kind:'image.generate',prompt:'树',parameters:{model:'image',webSearch:true}},{kind:'image.generate',prompt:'树',parameters:{model:'image',providerParameters:{model:'image',mode:'image_to_image'}}},{kind:'image.generate',prompt:'树',parameters:{model:'image',providerParameters:{model:'image',seed:1}}}])assert.throws(()=>provider.prepare(request));
});
test('incomplete or empty Responses and wrong image output counts stay unknown with no automatic resubmission',async()=>{
 let calls=0;const provider=createOpenAINativeProvider({modelMap:map,client:{responses:{create:async()=>{calls++;return {status:'incomplete',output_text:'部分'};}},images:{generate:async()=>({data:[]})}}});
 await assert.rejects(()=>provider.submit(textRequest),{code:'unknown'});assert.equal(calls,1);await assert.rejects(()=>provider.submit({kind:'image.generate',prompt:'树',parameters:{model:'image'}}),{code:'unknown'});
});
test('native refuses extra parameters and contradictory quality rather than dropping requested options',()=>{
 const provider=createOpenAINativeProvider({modelMap:map,client:{images:{generate:()=>assert.fail()}}});
 for(const extra of [{extra:1},{refs:['https://example.test/image.png']},{mode:'image_to_image'},{quality:'max',imageSize:'1K',providerParameters:{model:'image',imageSize:'1K',quality:'high'}},{ratio:'16:9',providerParameters:{model:'image',aspectRatio:'1:1'}},{ratio:'1:1',imageSize:'1K',size:'1536x1024'},{count:1,times:2},{duration:7}])assert.throws(()=>provider.prepare({kind:'image.generate',prompt:'树',parameters:{model:'image',...extra}}));
 assert.doesNotThrow(()=>provider.prepare({kind:'image.generate',prompt:'树',parameters:{model:'image',ratio:'1:1',imageSize:'1K',quality:'1K',outputQuality:'high',duration:5,audio:true,audioLabel:'开启',thinking:'high',mode:'全能参考',providerParameters:{model:'image',aspectRatio:'1:1',imageSize:'1K',quality:'high',mode:'text_to_image'}}}));
});
test('non-PNG base64 is unknown and URL outputs do not invent dimensions from the requested size',async()=>{
 for(const b64_json of ['bm90IGFuIGltYWdl','/9j/4AAQSkZJRgABAQAAAQABAAD/2Q==']){const provider=createOpenAINativeProvider({modelMap:map,client:{images:{generate:async()=>({data:[{b64_json}]})}}});await assert.rejects(()=>provider.submit({kind:'image.generate',prompt:'树',parameters:{model:'image'}}),{code:'unknown'});}
 const provider=createOpenAINativeProvider({modelMap:map,client:{images:{generate:async()=>({data:[{url:'https://example.test/result.png'}]})}}}),result=await provider.submit({kind:'image.generate',prompt:'树',parameters:{model:'image',ratio:'1:1',imageSize:'1K'}});assert.equal(result.outputs[0].width,undefined);assert.equal(result.outputs[0].height,undefined);
});
test('SDK URL field cannot bypass PNG validation using data URIs or contain URL credentials',async()=>{
 for(const url of ['data:image/png;base64,'+Buffer.from('plain non-image bytes').toString('base64'),'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jCn0AAAAASUVORK5CYII=','blob:https://provider.test/opaque','https://user:private-key@provider.test/result.png']){const provider=createOpenAINativeProvider({modelMap:map,client:{images:{generate:async()=>({data:[{url}]})}}});await assert.rejects(()=>provider.submit({kind:'image.generate',prompt:'树',parameters:{model:'image'}}),{code:'unknown'});}
});
test('native durable success and unknown preserve idempotency across restarts without another POST',async()=>{
 for(const fail of [false,true]){let calls=0;const store=memoryStore(),provider=createOpenAINativeProvider({modelMap:map,client:{responses:{create:async()=>{calls++;if(fail)throw Error('network lost');return {output_text:'真实结果'};}}}});
 let service=createDurableGenerationService({store,provider}),job=await service.submit(textRequest,{idempotencyKey:'native-key-1'});job=await settle(service,job.id);assert.equal(job.status,fail?'unknown':'succeeded');assert.equal(job.providerTaskId,undefined);await service.close();service=createDurableGenerationService({store,provider});const restored=await service.lookup('native-key-1');assert.equal(restored.status,job.status);assert.equal((await service.submit(textRequest,{idempotencyKey:'native-key-1'})).id,job.id);assert.equal(calls,1);await service.close();}
});
test('unsupported native request is recorded as failed before dispatch, unmapped model as configuration_required',async()=>{
 const provider=createOpenAINativeProvider({modelMap:map,client:{responses:{create:()=>assert.fail()}}}),service=createDurableGenerationService({store:memoryStore(),provider});
 for(const [kind,model,status]of [['video.generate','text','failed'],['text.generate','unmapped','configuration_required']]){const job=await service.submit({...textRequest,kind,parameters:{model}},{idempotencyKey:'blocked-'+kind});assert.equal((await settle(service,job.id)).status,status);}
 await service.close();
});
test('native cancellation discards late SDK output and never claims provider cancellation',async()=>{
 let release,started;const began=new Promise(resolve=>started=resolve),pending=new Promise(resolve=>release=resolve);const provider=createOpenAINativeProvider({modelMap:map,client:{responses:{create:async()=>{started();await pending;return {output_text:'迟到正文'};}}}}),service=createDurableGenerationService({store:memoryStore(),provider});
 const job=await service.submit(textRequest,{idempotencyKey:'cancel-native-1'});await began;assert.equal((await service.get(job.id)).status,'running');const receipt=await service.cancel(job.id);assert.equal(receipt.cancellation.providerCancellation,'unconfirmed');release();await tick();await tick();const final=await service.get(job.id);assert.equal(final.status,'cancelled');assert.equal(final.outputs,undefined);await service.close();
});
test('generation configuration reports protocol and actionable missing fields without keys or endpoint',async()=>{
 for(const protocol of ['openai-native','bad-protocol']){const gateway=createGenerationGateway({protocol,apiKey:'private-key',modelMap:'{broken',baseUrl:'https://provider.test'});let config;await gateway.handle({method:'GET'},{},'/api/generation/config',{json:(_res,status,value)=>{assert.equal(status,200);config=value;}});assert.equal(config.configured,false);assert.equal(config.configurationError,'configuration_invalid');assert.ok(!JSON.stringify(config).includes('private-key'));assert.ok(!JSON.stringify(config).includes('https://provider.test'));await gateway.close();}
});
test('browser task gateway rejects URL credentials and query tokens before creating transport',()=>{
 for(const baseUrl of ['https://user:secret@provider.test','https://provider.test?api_key=secret','https://provider.test#secret'])assert.throws(()=>httpProvider({baseUrl}));
 assert.doesNotThrow(()=>httpProvider({baseUrl:'http://localhost:4174/api/'}));
});
test('tasks-v1 malformed operator endpoints report invalid configuration without crashing server construction',async()=>{
 for(const baseUrl of ['not-an-address','ftp://provider.test','https://user:private@provider.test','https://provider.test?token=private']){const gateway=createGenerationGateway({protocol:'tasks-v1',baseUrl,apiKey:'test-key-only',fetchImpl:()=>assert.fail('invalid configuration must not dispatch')});let config;await gateway.handle({method:'GET'},{},'/api/generation/config',{json:(_res,status,value)=>{assert.equal(status,200);config=value;}});assert.equal(config.configured,false);assert.equal(config.configurationError,'configuration_invalid');await gateway.close();}
});
