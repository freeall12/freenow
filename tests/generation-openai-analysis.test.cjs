const test=require('node:test'),assert=require('node:assert/strict'),OpenAI=require('openai');
const {validateAnalysisProfile,analysisCapabilities,prepareAnalysisRequest,submitAnalysis,MAX_IMAGE_BYTES}=require('../server/generation-openai-analysis.cjs');
const {createDurableGenerationService}=require('../server/generation-durable.cjs');
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jCn0AAAAASUVORK5CYII=';
const imageUrl='data:image/png;base64,'+png;
const profile={kind:'image.recognize',model:'operator-selected-vision-model',detail:'high',maxOutputTokens:3000};
// The focus UI intentionally sends no model or prompt; operator mapping chooses it.
const request={kind:'image.recognize',label:'焦点编辑识别',nodeId:'source',inputs:[{type:'image',url:imageUrl}],parameters:{point:{x:.4,y:.3},binding:{sourceNodeId:'source',targetNodeId:'target',markId:'mark'},output:{format:'json',boxOrder:['top','left','bottom','right'],coordinates:'normalized-0-1'}}};
const items=[{label_name:'测试候选',label_desc:'测试供应商回应，不是视觉效果验收',box_2d:[.1,.2,.5,.6]}];
const response=value=>({id:'test-response',status:'completed',output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify(value),annotations:[]}]}]});
const sdkFor=create=>({responses:{create}});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function settled(service,id){for(let i=0;i<30;i++){const job=await service.get(id);if(!['queued','running'].includes(job.status))return job;await tick();}assert.fail('recognition did not settle');}
function memoryStore(){const records=new Map();return {readAll:async()=>[...records.values()],write:async value=>records.set(value.id,structuredClone(value))};}

test('real focus contract prepares original inline image, normalized point and strict Responses JSON schema',async()=>{
 const prepared=prepareAnalysisRequest(request,profile);assert.deepEqual(prepared.point,request.parameters.point);assert.deepEqual(prepared.binding,request.parameters.binding);assert.equal(prepared.body.model,profile.model);assert.equal(prepared.body.store,false);assert.equal(prepared.body.max_output_tokens,3000);assert.equal(prepared.body.text.format.type,'json_schema');assert.equal(prepared.body.text.format.strict,true);assert.equal(prepared.body.text.format.schema.additionalProperties,false);
 const content=prepared.body.input[0].content;assert.equal(content.length,2);assert.equal(content[1].type,'input_image');assert.equal(content[1].image_url,imageUrl);assert.equal(content[1].detail,'high');assert.deepEqual(JSON.parse(content[0].text).point,{x:.4,y:.3});assert.deepEqual(JSON.parse(content[0].text).imageDimensions,{width:1,height:1});assert.ok(!JSON.stringify(prepared.body).includes('targetNodeId'));
 const result=await submitAnalysis(prepared,{sdk:sdkFor(async(_body,options)=>{assert.equal(options.maxRetries,0);assert.ok(options.signal instanceof AbortSignal);return response({items});})});
 assert.deepEqual(result,{status:'succeeded',outputs:[{type:'text',text:JSON.stringify({items})}]});const focus=await import('../src/features/focus-edit/model.mjs');assert.deepEqual(focus.detections(JSON.parse(result.outputs[0].text)),items);
});

test('analysis config is explicit, capability reports no actual model and video is rejected',()=>{
 for(const extra of [{kind:'video.analyze'},{model:''},{detail:'crop'},{maxOutputTokens:511},{maxOutputTokens:16001},{maxOutputTokens:1.5},{maxCount:2},{supportsVideo:true},{reasoningMap:{high:'high'}}])assert.throws(()=>validateAnalysisProfile({...profile,...extra}),{code:'configuration_invalid'});
 assert.deepEqual(analysisCapabilities(profile),{kind:'image.recognize',operation:'point-detection',transport:'inline',maxImages:1,mimeTypes:['image/png','image/jpeg','image/webp'],maxImageBytes:MAX_IMAGE_BYTES});assert.ok(!JSON.stringify(analysisCapabilities(profile)).includes(profile.model));
 assert.equal(validateAnalysisProfile({kind:'image.recognize',model:'operator-model'}).detail,'high');
 assert.throws(()=>prepareAnalysisRequest({...request,kind:'video.analyze',inputs:[{type:'video',url:'data:video/mp4;base64,AAAA'}]},profile),/视频/);
});

test('input bytes, full-frame identity, point binding and exact output convention fail before SDK',()=>{
 for(const url of ['https://public.test/image.png','asset:image','blob:https://app.test/image','data:image/svg+xml;base64,PHN2Zz4=','data:image/png;base64,bm90IGFuIGltYWdl'])assert.throws(()=>prepareAnalysisRequest({...request,inputs:[{type:'image',url}]},profile));
 for(const change of [{prompt:'额外任务'},{inputs:[]},{inputs:[request.inputs[0],request.inputs[0]]},{inputs:[{...request.inputs[0],crop:{x:0,y:0,width:.5,height:.5}}]},{inputs:[{...request.inputs[0],width:99,height:1}]},{inputs:[{type:'text',text:'仅文字'}]},{parameters:{...request.parameters,point:{x:1.01,y:.3}}},{parameters:{...request.parameters,point:{x:.4,y:.3,z:1}}},{parameters:{...request.parameters,binding:{...request.parameters.binding,sourceNodeId:'wrong'}}},{parameters:{...request.parameters,binding:{...request.parameters.binding,targetNodeId:'source'}}},{parameters:{...request.parameters,output:{...request.parameters.output,boxOrder:['left','top','right','bottom']}}},{parameters:{...request.parameters,output:{...request.parameters.output,coordinates:'pixels'}}},{parameters:{...request.parameters,seed:1}},{parameters:{...request.parameters,model:'A',modelId:'B'}}])assert.throws(()=>prepareAnalysisRequest({...request,...change},profile));
 assert.throws(()=>prepareAnalysisRequest({...request,inputs:[{type:'image',url:'data:image/png;base64,'+'A'.repeat(64*1024*1024)}]},profile),/64 MiB/);
 assert.doesNotThrow(()=>prepareAnalysisRequest({...request,inputs:[{...request.inputs[0],width:1,height:1}]},profile));
});

test('installed SDK posts one Responses image request and extracts actual completed JSON message',async()=>{
 let attempts=0;const prepared=prepareAnalysisRequest(request,profile);
 const sdk=new OpenAI({apiKey:'test-key-only',baseURL:'https://isolated-provider.test/v1',fetch:async(url,options)=>{attempts++;assert.equal(String(url),'https://isolated-provider.test/v1/responses');assert.equal(new Headers(options.headers).get('authorization'),'Bearer test-key-only');assert.deepEqual(JSON.parse(options.body),prepared.body);return new Response(JSON.stringify(response({items})),{headers:{'content-type':'application/json'}});}});
 assert.deepEqual((await submitAnalysis(prepared,{sdk})).outputs,[{type:'text',text:JSON.stringify({items})}]);assert.equal(attempts,1);
 let retries=0;const limited=new OpenAI({apiKey:'test-key-only',baseURL:'https://isolated-provider.test/v1',fetch:async()=>{retries++;return new Response(JSON.stringify({error:{message:'private provider detail'}}),{status:429,headers:{'content-type':'application/json'}});}});
 await assert.rejects(submitAnalysis(prepared,{sdk:limited}),error=>error.code==='unknown'&&!error.message.includes('private'));assert.equal(retries,1);
});

test('refusal, incomplete, invalid JSON and any invalid candidate cannot turn into invented or filtered boxes',async()=>{
 const prepared=prepareAnalysisRequest(request,profile),invalid=[{items:[{...items[0],box_2d:[.1,.5,.5,.7]}]},{items:[items[0],{...items[0],box_2d:[.5,.2,.1,.6]}]},{items:[{...items[0],box_2d:[0,-.1,.5,.6]}]},{items:[{...items[0],box_2d:[0,.1,.5]}]},{items:[{...items[0],label_name:''}]},{items:[{...items[0],box_2d:[.1,.2,Infinity,.6]}]},{items:Array.from({length:9},()=>items[0])},{items,extra:true},{items:[{...items[0],tool:'edit'}]}];
 for(const value of invalid)await assert.rejects(submitAnalysis(prepared,{sdk:sdkFor(async()=>response(value))}),{code:'unknown'});
 for(const value of [{...response({items}),status:'incomplete'},{...response({items}),status:'failed'},{...response({items}),output:[{type:'message',status:'completed',content:[{type:'refusal',refusal:'cannot'}]}]},{...response({items}),output:[{type:'function_call',name:'edit',arguments:'{}'}]},{...response({items}),output:[{type:'message',status:'incomplete',content:[{type:'output_text',text:JSON.stringify({items})}]}]},{...response({items}),output:[{type:'message',status:'completed',content:[{type:'output_text',text:'```json\n{}\n```'}]}]}])await assert.rejects(submitAnalysis(prepared,{sdk:sdkFor(async()=>value)}),{code:'unknown'});
 assert.equal((await submitAnalysis(prepared,{sdk:sdkFor(async()=>response({items:[]}))})).outputs[0].text,'{"items":[]}');
 const boundary=prepareAnalysisRequest({...request,parameters:{...request.parameters,point:{x:.2,y:.1}}},profile);assert.equal((await submitAnalysis(boundary,{sdk:sdkFor(async()=>response({items}))})).status,'succeeded');
});

test('cancel before call, ignored-signal late response and timeout cannot return a successful recognition',async()=>{
 const prepared=prepareAnalysisRequest(request,profile),before=new AbortController();before.abort(Error('cancel before recognition'));await assert.rejects(submitAnalysis(prepared,{sdk:sdkFor(()=>assert.fail()),signal:before.signal}),/cancel before/);
 let release,started;const began=new Promise(resolve=>started=resolve),controller=new AbortController();
 const pending=submitAnalysis(prepared,{sdk:sdkFor(()=>{started();return new Promise(resolve=>release=resolve);}),signal:controller.signal});await began;controller.abort(Error('cancel recognition'));await assert.rejects(pending,/cancel recognition/);release(response({items}));
 let late;const timeout=submitAnalysis(prepared,{sdk:sdkFor(()=>new Promise(resolve=>late=resolve)),timeoutMs:10});await assert.rejects(timeout,{code:'unknown'});late(response({items}));
});

test('durable successful/unknown recognition receipts survive restart without another model POST',async()=>{
 for(const uncertain of [false,true]){
  let attempts=0;const store=memoryStore(),sdk=sdkFor(async()=>{attempts++;if(uncertain)throw Error('lost response');return response({items});});
  const provider={configured:true,fingerprint:'point-detection-profile',prepare:value=>{prepareAnalysisRequest(value,profile);return value;},submit:(value,{signal})=>submitAnalysis(prepareAnalysisRequest(value,profile),{sdk,signal})};
  let service=createDurableGenerationService({store,provider});const first=await service.submit(request,{idempotencyKey:'recognition-receipt'}),job=await settled(service,first.id);assert.equal(job.status,uncertain?'unknown':'succeeded');await service.close();service=createDurableGenerationService({store,provider});assert.equal((await service.lookup('recognition-receipt')).status,job.status);assert.equal((await service.submit(request,{idempotencyKey:'recognition-receipt'})).id,first.id);assert.equal(attempts,1);await service.close();
 }
});
