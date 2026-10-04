const test=require('node:test'),assert=require('node:assert/strict');
const {TaskService}=require('../generation-api.js');
const ready=Promise.all([import('../src/features/image-editor/task-media.mjs'),import('../src/features/agent-workflows/media-resolver.mjs'),import('../src/features/agent-workflows/media-transport.mjs')]);
const baseUrl='http://localhost:4173/',png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jCn0AAAAASUVORK5CYII=';
const data='data:image/png;base64,'+png,serialize=async blob=>'data:'+blob.type+';base64,'+Buffer.from(await blob.arrayBuffer()).toString('base64');
const request={kind:'image.upscale',nodeId:'target',sourceNodeId:'source',label:'高清放大',prompt:'',inputs:[{type:'image',nodeId:'source',url:'asset:full',sourceUrl:'asset:full',provenance:{origin:'generation',model:'original-model'}}],parameters:{provider:'topazlabs',style:'text_refine',scale:4}};
const terminal=(service,job)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>{off();reject(Error('task timeout'));},3000);const off=service.subscribe(value=>{if(value.id===job.id&&['failed','cancelled','configuration_required','succeeded'].includes(value.status)){clearTimeout(timer);off();resolve(value);}});});
function adapters(resolver,transport,extra={}){
 const reads=[],fetches=[];
 return {reads,fetches,options:{baseUrl,resolveMedia:resolver.createWorkflowMediaResolver({baseUrl,localAssets:{url:async source=>{reads.push(source);return 'blob:http://localhost:4173/full';}},createImage:()=>assert.fail('image tools must not probe unchecked media')}),transport:(value,options)=>transport.prepareWorkflowInputs(value,{...options,serialize,fetchImpl:async(url,options)=>{fetches.push({url,options});return new Response(Buffer.from(png,'base64'),{headers:{'content-type':'image/png'}});},...extra})}};
}

test('image tools resolve full source after configuration, transport local bytes and preserve exact settings and provenance',async()=>{
 const [media,resolver,transport]=await ready;
 for(const [kind,parameters]of [['image.upscale',{provider:'magnific',scaleFactor:6,sharpen:7,smartGrain:8,ultraDetail:30}],['image.skin',{mode:'heavy'}],['image.remove-background',{}]]){
  const value={...request,kind,parameters,inputs:[{...request.inputs[0],url:'asset:thumbnail',fullImage:'asset:full'}]},before=structuredClone(value),o=adapters(resolver,transport);let guards=0;
  const result=await media.prepareImageToolMedia(value,{...o.options,nativeConfiguration:{protocol:'tasks-v1'},validateSources:()=>guards++});
  assert.deepEqual(o.reads,['asset:full']);assert.equal(o.fetches.length,1);assert.ok(o.fetches[0].options.signal instanceof AbortSignal);assert.deepEqual(result,{...value,inputs:[{...value.inputs[0],url:data}]});assert.deepEqual(value,before);assert.ok(guards>=5);
 }
 const o=adapters(resolver,transport),publicRequest={...request,inputs:[{...request.inputs[0],url:'https://public.test/full.png'}]};
 assert.deepEqual(await media.prepareImageToolMedia(publicRequest,{...o.options,nativeConfiguration:{protocol:'fal-native'}}),publicRequest);assert.deepEqual(o.fetches,[]);assert.deepEqual(o.reads,[]);
});

test('TaskService configuration gate skips all image source I/O and fal Topaz6x fails before resolution',async()=>{
 const [media]=await ready;let reads=0,calls=0;
 const prepareInputs=(value,{signal,validateSources})=>media.prepareImageToolMedia(value,{baseUrl,signal,validateSources,nativeConfiguration:{protocol:'fal-native'},resolveMedia:()=>{reads++;assert.fail('invalid configuration must not read source');}});
 const service=new TaskService({prepareInputs});service.setProvider({isConfigured:async()=>false,generate:()=>assert.fail('unconfigured provider must not dispatch')});
 for(const kind of ['image.upscale','image.skin','image.remove-background']){const job=service.submit({...request,kind});await terminal(service,job);assert.equal(job.status,'configuration_required');assert.equal(job.providerDispatched,undefined);}
 service.setProvider({isConfigured:async()=>true,generate:()=>{calls++;assert.fail('unsupported settings must not dispatch');}});
 const job=service.submit({...request,parameters:{...request.parameters,scale:6}});await terminal(service,job);assert.equal(job.status,'failed');assert.equal(job.code,'unsupported_generation');assert.equal(job.error,'当前 fal Topaz 接口只支持 2x、4x，6x 尚未配置');assert.equal(reads,0);assert.equal(calls,0);
 for(const value of [{...request,kind:'image.skin'},{...request,parameters:{provider:'magnific',scaleFactor:6}},{...request,parameters:{...request.parameters,style:'invented'}}])await assert.rejects(media.prepareImageToolMedia(value,{nativeConfiguration:{protocol:'fal-native'},resolveMedia:()=>assert.fail('unsupported operation must not read')}),{code:'unsupported_generation'});
});

test('cancellation and changed source during real stream transport prevent image tool dispatch',async()=>{
 const [media,resolver,transport]=await ready;
 for(const cancelled of [true,false]){
  let began,release,changed=false,calls=0;const started=new Promise(resolve=>began=resolve),o=adapters(resolver,transport,{fetchImpl:async()=>new Response(new ReadableStream({start(controller){release=()=>{controller.enqueue(Buffer.from(png,'base64'));controller.close();};began();}}),{headers:{'content-type':'image/png'}})});
  const service=new TaskService({prepareInputs:(value,{signal,validateSources})=>media.prepareImageToolMedia(value,{...o.options,signal,validateSources})});service.setProvider({generate:async()=>{calls++;return {outputs:[{type:'image',url:data}]};}});
  const job=service.submit(request,{beforeDispatch:()=>{if(changed)throw Error('source changed');}}),done=terminal(service,job);await started;
  if(cancelled)service.cancel(job.id);else changed=true;
  if(!cancelled)release();await done;assert.equal(job.status,cancelled?'cancelled':'failed');assert.equal(calls,0);assert.equal(job.providerDispatched,undefined);
 }
});

test('image tool uses transport budget and rejects invalid fal media without Image decoding',async()=>{
 const [media,resolver,transport]=await ready,o=adapters(resolver,transport,{maxRequestBytes:1000,fetchImpl:async()=>new Response(Buffer.alloc(1000),{headers:{'content-type':'image/png','content-length':'1000'}})});
 await assert.rejects(media.prepareImageToolMedia(request,o.options),{code:'media_request_too_large'});
 for(const url of ['https://user:secret@public.test/p.png','http://192.168.1.8/p.png','data:image/svg+xml;base64,PHN2Zz4=']){
  const o=adapters(resolver,transport);await assert.rejects(media.prepareImageToolMedia({...request,inputs:[{type:'image',url}]},{...o.options,nativeConfiguration:{protocol:'fal-native'}}));assert.deepEqual(o.fetches,[]);
 }
});

test('multi-angle native image follows local asset transport without losing camera parameters',async()=>{
 const [{prepareImageToolMedia}]=await ready;
 const parameters={rotate_right_left:30,vertical_angle:.5,move_forward:0,wide_angle_lens:false};
 const input={kind:'image.multiAngle',prompt:'',inputs:[{type:'image',nodeId:'source',url:'asset:full'}],parameters};
 let transferred;
 const result=await prepareImageToolMedia(input,{baseUrl,nativeConfiguration:{protocol:'fal-native'},resolveMedia:async value=>{assert.equal(value.image,'asset:full');return {url:'blob:http://localhost:4173/fixture'};},transport:async value=>{transferred=value;return {...value,inputs:[{...value.inputs[0],url:data}]};}});
 assert.deepEqual(result.parameters,parameters);assert.equal(result.inputs[0].url,data);assert.equal(transferred.inputs[0].nodeId,'source');assert.equal(input.inputs[0].url,'asset:full');
});
