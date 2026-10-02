const test=require('node:test'),assert=require('node:assert/strict');
const {TaskService}=require('../generation-api.js');
const ready=Promise.all([import('../src/features/node-composer/generation-media.mjs'),import('../src/features/agent-workflows/media-transport.mjs'),import('../src/features/agent-workflows/media-resolver.mjs')]);
const baseUrl='http://localhost:4173/';
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jCn0AAAAASUVORK5CYII=';
const data='data:image/png;base64,'+png;
const request={kind:'image.generate',prompt:'引用图片',inputs:[{id:'public',type:'image',url:'https://public.test/image.png'},{type:'text',text:'参考文字'},{id:'local',type:'image',url:'/assets/image.png'}],parameters:{model:'gpt-image-2'}};
const nativeConfiguration={protocol:'openai-native',capabilities:{imageReferences:{'gpt-image-2':{maxImages:16,transport:'inline',mimeTypes:['image/png','image/jpeg','image/webp']}}}};
const serialize=async blob=>'data:'+blob.type+';base64,'+Buffer.from(await blob.arrayBuffer()).toString('base64');
const resolveMedia=async node=>({url:new URL(node.image,baseUrl).href,width:1,height:1});
const transportOptions={baseUrl,serialize};
const terminal=(service,job)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>{off();reject(Error('task timeout'));},3000);const off=service.subscribe(value=>{if(value.id===job.id&&['failed','cancelled','configuration_required','succeeded'].includes(value.status)){clearTimeout(timer);off();resolve(value);}});});

test('native browser branch inlines public/local references in order and decodes transported bytes',async()=>{
 const [media,transport]=await ready;const fetched=[],decoded=[];let guards=0;
 const result=await media.prepareGenerationMediaRequest(request,{baseUrl,nativeConfiguration,validateSources:()=>guards++,resolveMedia:async node=>{decoded.push(node.image);return resolveMedia(node);},transport:(value,options)=>transport.prepareWorkflowInputs(value,{...transportOptions,...options,fetchImpl:async(url,options)=>{fetched.push({url,options});return new Response(Buffer.from(png,'base64'),{headers:{'content-type':'image/png'}});}})});
 assert.deepEqual(result.inputs.map(input=>input.type),['image','text','image']);assert.deepEqual(result.inputs.filter(input=>input.type==='image').map(input=>input.url),[data,data]);assert.equal(result.parameters.providerParameters.mode,'image_to_image');assert.equal(fetched.length,2);
 for(const fetch of fetched){assert.equal(fetch.options.mode,'cors');assert.equal(fetch.options.credentials,'omit');assert.equal(fetch.options.redirect,'error');assert.ok(fetch.options.signal instanceof AbortSignal);}
 assert.deepEqual(decoded,[request.inputs[0].url,request.inputs[2].url,data,data]);assert.ok(guards>=8);assert.equal(request.inputs[0].url,'https://public.test/image.png');
});

test('tasks-v1 retains public URLs and local transport and no-reference native needs no image profile',async()=>{
 const [media,transport]=await ready;const fetched=[];
 const result=await media.prepareGenerationMediaRequest(request,{baseUrl,nativeConfiguration:{protocol:'tasks-v1'},resolveMedia,transport:(value,options)=>transport.prepareWorkflowInputs(value,{...transportOptions,...options,fetchImpl:async(url,options)=>{fetched.push({url,options});return new Response(Buffer.from(png,'base64'),{headers:{'content-type':'image/png'}});}})});
 assert.equal(result.inputs[0].url,request.inputs[0].url);assert.equal(result.inputs[2].url,data);assert.equal(fetched.length,1);assert.equal(fetched[0].options.credentials,undefined);
 assert.doesNotThrow(()=>media.assertWorkflowRequestBudget(result));
 const noReferences=await media.prepareGenerationMediaRequest({...request,inputs:[]},{baseUrl,nativeConfiguration:{protocol:'openai-native'},resolveMedia:()=>assert.fail(),transport:transport.prepareWorkflowInputs});assert.equal(noReferences.parameters.providerParameters.mode,'text_to_image');
});

test('native reference capability and count fail before media I/O',async()=>{
 const [media]=await ready;
 for(const config of [{protocol:'openai-native'}, {...nativeConfiguration,capabilities:{imageReferences:{'gpt-image-2':{maxImages:1,transport:'inline'}}}}])await assert.rejects(media.prepareGenerationMediaRequest(request,{baseUrl,nativeConfiguration:config,resolveMedia:()=>assert.fail('no media reads')}),/配置|上限/);
});

test('CORS, HTTP, unsupported formats, corrupt decode, private URLs and budgets explicitly fail without dropping refs',async()=>{
 const [media,transport]=await ready;
 for(const fetchImpl of [()=>{throw TypeError('Failed to fetch');},()=>new Response('gone',{status:404}),()=>new Response('<svg/>',{headers:{'content-type':'image/svg+xml'}})])await assert.rejects(media.prepareGenerationMediaRequest(request,{baseUrl,nativeConfiguration,resolveMedia,transport:(value,options)=>transport.prepareWorkflowInputs(value,{...transportOptions,...options,fetchImpl})}),/CORS|读取失败|PNG/);
 await assert.rejects(media.prepareGenerationMediaRequest(request,{baseUrl,nativeConfiguration,resolveMedia:async node=>{if(node.image.startsWith('data:'))throw Error('图片解码失败');return resolveMedia(node);},transport:async value=>({...value,inputs:value.inputs.map(input=>input.type==='image'?{...input,url:data}:input)})}),/解码失败/);
 for(const url of ['http://192.168.1.4/image.png','https://user:pass@public.test/image.png'])await assert.rejects(transport.prepareWorkflowInputs({...request,inputs:[{type:'image',url}]},{...transportOptions,inlineImages:true,fetchImpl:()=>assert.fail('private/credential URL must not fetch')}),/本地|用户名/);
 await assert.rejects(transport.prepareWorkflowInputs({...request,inputs:[request.inputs[0]]},{...transportOptions,inlineImages:true,maxRequestBytes:1000,fetchImpl:()=>new Response(Buffer.alloc(1000),{headers:{'content-type':'image/png','content-length':'1000'}})}),/预算/);
});

test('cancel and source changes during native fetching never dispatch or create placeholders',async()=>{
 const [media,transport]=await ready;
 for(const cancel of [true,false]){
  let release,started;const began=new Promise(resolve=>started=resolve);let changed=false,calls=0;
  const service=new TaskService({prepareInputs:(request,{signal,validateSources})=>media.prepareGenerationMediaRequest(request,{baseUrl,nativeConfiguration,signal,validateSources,resolveMedia,transport:(value,options)=>transport.prepareWorkflowInputs(value,{...transportOptions,...options,fetchImpl:()=>{started();return new Promise(resolve=>release=()=>resolve(new Response(Buffer.from(png,'base64'),{headers:{'content-type':'image/png'}})));}})})});
  service.setProvider({generate:async()=>{calls++;return {outputs:[{type:'image',url:data}]};}});
  const job=service.submit(request,{beforeDispatch:()=>{if(changed)throw Error('来源已改变');}}),done=terminal(service,job);await began;
  if(cancel)service.cancel(job.id);else changed=true;release();await done;
  assert.equal(job.status,cancel?'cancelled':'failed');assert.equal(calls,0);assert.equal(job.providerDispatched,undefined);
 }
});

test('inline public fetch propagates timeout and cancellation even when fetch ignores its signal',async()=>{
 const [,transport]=await ready;let release;
 await assert.rejects(transport.prepareWorkflowInputs({...request,inputs:[request.inputs[0]]},{...transportOptions,inlineImages:true,timeoutMs:10,fetchImpl:()=>new Promise(resolve=>release=resolve)}),{code:'media_transport_timeout'});release(new Response('late'));
 const controller=new AbortController();controller.abort(Error('cancel native transport'));
 await assert.rejects(transport.prepareWorkflowInputs(request,{...transportOptions,inlineImages:true,signal:controller.signal,fetchImpl:()=>assert.fail()}),/cancel native transport/);
});

test('real native resolver applies URL boundary before any Image probe and decodes only submitted inline bytes',async()=>{
 const [media,transport,resolver]=await ready;const probed=[],fetched=[];
 const resolve=resolver.createWorkflowMediaResolver({baseUrl,localAssets:{url:async()=>URL.createObjectURL(new Blob([Buffer.from(png,'base64')],{type:'image/png'}))},createImage:()=>({naturalWidth:1,naturalHeight:1,decode:async()=>{},removeAttribute(){},set src(url){probed.push(url);queueMicrotask(()=>this.onload?.());}})});
 const prepare=value=>media.prepareGenerationMediaRequest(value,{baseUrl,nativeConfiguration,resolveMedia:resolve,transport:(value,options)=>transport.prepareWorkflowInputs(value,{...transportOptions,...options,fetchImpl:async(url,options)=>{fetched.push({url,options});return new Response(Buffer.from(png,'base64'),{headers:{'content-type':'image/png'}});}})});
 for(const url of ['http://192.168.1.4/image.png','https://user:pass@public.test/image.png'])await assert.rejects(prepare({...request,inputs:[{type:'image',url}]}),/本地|用户名/);
 assert.deepEqual(probed,[]);assert.deepEqual(fetched,[]);
 const publicResult=await prepare({...request,inputs:[request.inputs[0]]});assert.equal(publicResult.inputs[0].url,data);assert.deepEqual(probed,[data]);assert.equal(fetched[0].options.credentials,'omit');assert.equal(fetched[0].options.redirect,'error');
 probed.length=0;fetched.length=0;
 await assert.rejects(media.prepareGenerationMediaRequest({...request,inputs:[request.inputs[0]]},{baseUrl,nativeConfiguration,resolveMedia:resolve,transport:(value,options)=>transport.prepareWorkflowInputs(value,{...transportOptions,...options,fetchImpl:()=>{throw TypeError('redirect rejected');}})}),/CORS/);assert.deepEqual(probed,[]);
});
