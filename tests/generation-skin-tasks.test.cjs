'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createTasksProvider}=require('../server/generation-router.cjs');
const {createSkinTasksProvider}=require('../server/generation-skin-tasks.cjs');
const {validateSkinRequest,skinCapabilities,PROFILES}=require('../server/generation-skin-profile.cjs');
const {encodeRGBA,decodePNG,crc32}=require('../server/generation-png-alpha.cjs');
const {deflateSync}=require('node:zlib');
const {randomFillSync}=require('node:crypto');
const key='synthetic-skin-tasks-key',source=encodeRGBA(13,9,Buffer.alloc(13*9*4,240)),output=encodeRGBA(17,11,Buffer.alloc(17*11*4,210));
const url=bytes=>'data:image/png;base64,'+bytes.toString('base64');
const request=(mode='detailed')=>({kind:'image.skin',nodeId:'target',sourceNodeId:'source',prompt:'',inputs:[{type:'image',role:'source_image',url:url(source),nodeId:'source',width:13,height:9}],parameters:{mode}});
const done=(bytes=output,patch={})=>({id:'original-skin',status:'succeeded',outputs:[{type:'image',url:url(bytes),...patch}]});
function provider(fetchImpl,options={}){return createSkinTasksProvider({apiKey:key,transport:createTasksProvider({baseUrl:'https://skin-gateway.test/v1',apiKey:key,fetchImpl,rejectCredentialEcho:true,maxResponseBytes:64*1024*1024}),...options});}
function wire(calls=[],results){return async(target,options)=>{calls.push({url:String(target),method:options.method,headers:new Headers(options.headers),body:options.body&&JSON.parse(options.body)});return Response.json(results?.(calls.length,options)|| (options.method==='POST'?{id:'original-skin',status:'queued'}:done()));};}
function chunk(type,data){const b=Buffer.alloc(data.length+12);b.writeUInt32BE(data.length);b.write(type,4);data.copy(b,8);b.writeUInt32BE(crc32(b.subarray(4,-4)),b.length-4);return b;}
function metadataPNG(type,data){return Buffer.concat([source.subarray(0,33),chunk(type,data),source.subarray(33)]);}
function replaceIDAT(bytes,data){let offset=8;const parts=[bytes.subarray(0,8)];while(offset+12<=bytes.length){const end=offset+12+bytes.readUInt32BE(offset),type=bytes.toString('ascii',offset+4,offset+8);parts.push(type==='IDAT'?chunk(type,data):bytes.subarray(offset,end));offset=end;}return Buffer.concat(parts);}

test('dedicated configuration declares an external contract without a native or key-only claim',()=>{
 const p=provider(()=>assert.fail());assert.equal(p.configured,true);assert.equal(p.metadata.protocol,'skin-tasks-v1');
 assert.deepEqual(p.metadata.capabilities.kinds,['image.skin']);assert.deepEqual(p.metadata.capabilities.models,{'image.skin':{kind:'image.skin'}});
 const caps=p.metadata.capabilities.skin;assert.equal(caps.implementation,'external-gateway-contract');assert.equal(caps.semantics,'gateway-defined');assert.equal(caps.publicNativeProtocolVerified,false);assert.equal(caps.vendorIntegrationRequired,true);assert.deepEqual(caps.profiles,PROFILES);
 assert.equal(JSON.stringify(p.metadata).includes(key),false);
 for(const modelMap of [{skin:{kind:'image.skin'}},'[]','{"model":"enhancorv1"}'])assert.equal(provider(()=>assert.fail(),{modelMap}).configured,false);
 assert.equal(provider(()=>assert.fail(),{apiKey:' bad-key\n'}).configured,false);
 assert.equal(createSkinTasksProvider({transport:createTasksProvider({})}).configured,false);
 assert.notEqual(p.fingerprint,provider(()=>assert.fail(),{transport:{...createTasksProvider({}),fingerprint:'changed'}}).fingerprint);
});

test('all three modes traverse actual tasks HTTP wire with full source bytes and no prompt compilation',async()=>{
 for(const mode of ['detailed','standard','heavy']){
  const calls=[],p=provider(wire(calls)),r=request(mode),before=structuredClone(r);
  assert.equal(p.prepare(r),r);assert.equal(calls.length,0);const accepted=await p.submit(r);assert.equal(accepted.id,'original-skin');assert.equal(accepted.status,'queued');
  assert.deepEqual(calls[0].body,r);assert.deepEqual(r,before);assert.equal(calls[0].url,'https://skin-gateway.test/v1/tasks');assert.equal(calls[0].method,'POST');assert.equal(calls[0].headers.get('authorization'),'Bearer '+key);assert.deepEqual(Buffer.from(calls[0].body.inputs[0].url.split(',')[1],'base64'),source);
  const completed=await provider(wire(calls)).poll(accepted.id);assert.equal(completed.id,accepted.id);assert.deepEqual([completed.outputs[0].width,completed.outputs[0].height],[17,11]);assert.equal(completed.outputs[0].mime,'image/png');assert.equal(completed.outputs[0].url,url(output));
  assert.equal(calls[1].url,'https://skin-gateway.test/v1/tasks/original-skin');assert.equal(calls[1].method,'GET');assert.equal(calls.filter(c=>c.method==='POST').length,1);
 }
});

test('strict source, mode, count and codec validation rejects before any outbound request',async()=>{
 let calls=0;const p=provider(async()=>{calls++;assert.fail();}),r=request();
 const invalid=[{...r,kind:'image.generate'},{...r,prompt:'enhance skin'},{...r,count:2},{...r,references:[{}]},{...r,parameters:{mode:'standard',seed:1}},{...r,parameters:{mode:'auto'}},{...r,parameters:{}},{...r,inputs:[...r.inputs,...r.inputs]},{...r,sourceNodeId:'wrong'},
  {...r,inputs:[{...r.inputs[0],role:'reference'}]},{...r,inputs:[{...r.inputs[0],width:14}]},{...r,inputs:[{...r.inputs[0],url:'https://skin-gateway.test/source.png'}]},{...r,apiKey:'not-allowed'}];
 for(const field of ['selection','sourceBox','clip','sourceClip','crop','projection','fullImage'])invalid.push({...r,inputs:[{...r.inputs[0],[field]:null}]});
 const corrupt=Buffer.from(source);corrupt[40]^=1;
 for(const bytes of [corrupt,source.subarray(0,-1),Buffer.concat([source,Buffer.from('trailing')]),metadataPNG('iTXt',Buffer.from('harmless')),metadataPNG('zTXt',Buffer.from('harmless')),metadataPNG('iCCP',Buffer.from('harmless'))])invalid.push({...r,inputs:[{...r.inputs[0],url:url(bytes)}]});
 for(const input of invalid)await assert.rejects(()=>p.submit(input));assert.equal(calls,0);
 assert.equal(p.prepare({...r,count:1,references:[]}).count,1);
});

test('complete decoded source pixels and metadata cannot carry credentials',()=>{
 const pixels=Buffer.alloc(13*9*4,0);pixels.write(key);const encoded=encodeRGBA(13,9,pixels);assert.equal(encoded.includes(Buffer.from(key)),false);
 const p=provider(()=>assert.fail());for(const bytes of [encoded,metadataPNG('tEXt',Buffer.from('label\0'+key))])assert.throws(()=>p.prepare({...request(),inputs:[{...request().inputs[0],url:url(bytes)}]}),error=>!error.message.includes(key));
 assert.deepEqual(decodePNG(encoded).pixels,pixels);assert.equal(validateSkinRequest(request()).image.width,13);
});

test('successful receipts require one complete PNG with actual dimensions and no credential echo',async()=>{
 const corrupt=Buffer.from(output);corrupt[40]^=1;
 const pixels=Buffer.alloc(17*11*4,0);pixels.write(key);
 const invalid=[done(corrupt),done(output,{width:13}),done(output,{height:9}),done(output,{mime:'image/jpeg'}),done(output,{sourceFileId:encodeURIComponent(key)}),done(encodeRGBA(17,11,pixels)),{...done(),outputs:[]},{...done(),outputs:[...done().outputs,...done().outputs]},done(output,{url:'https://example.test/output.png'}),done(output,{image:url(output)}),{...done(),id:'other-task'},{...done(),status:'running'}];
 for(const value of invalid){let calls=0;const p=provider(async()=>{calls++;return Response.json(value);});await assert.rejects(()=>p.poll('original-skin'),error=>!error.message.includes(key));assert.equal(calls,1);}
});

test('unknown original tasks and accepted cancellation never resubmit or claim success',async()=>{
 const calls=[],p=provider(wire(calls,(_i,options)=>options.method==='POST'?{id:'original-skin',status:'queued'}:{id:'original-skin',status:'unknown'}));
 const accepted=await p.submit(request());assert.equal((await p.poll(accepted.id)).status,'unknown');assert.equal((await p.poll(accepted.id)).status,'unknown');assert.deepEqual(await p.cancel(accepted.id),{id:'original-skin',status:'unknown'});assert.equal(calls.filter(c=>c.method==='POST').length,1);assert.equal(calls.at(-1).method,'DELETE');
 let posts=0;await assert.rejects(()=>provider(async()=>{posts++;throw Error('lost-response '+key);}).submit(request()),{code:'unknown'});assert.equal(posts,1);
 await assert.rejects(()=>provider(()=>assert.fail()).poll('..'),{code:'provider_identity_mismatch'});
});

test('frontend readiness rejects ordinary image/tasks fallbacks and preserves unsupported mode reasons',async()=>{
 const {skinRequestState}=await import('../src/features/image-skin/native-profile.mjs');
 const p=provider(()=>assert.fail()),r=request();assert.equal(skinRequestState(p.metadata,{kind:'image.skin'}).ready,true);assert.equal(skinRequestState(p.metadata,r).ready,true);
 assert.equal(skinRequestState({...p.metadata,protocol:'tasks-v1'},r).ready,false);
 for(const change of [{skin:undefined},{skin:{...p.metadata.capabilities.skin,promptEditable:true}},{skin:{...p.metadata.capabilities.skin,profiles:{detailed:{model:'gpt-image-2'}}}}])assert.equal(skinRequestState({...p.metadata,capabilities:{...p.metadata.capabilities,...change}},r).ready,false);
 const partial=structuredClone(p.metadata);partial.capabilities.skin.modes=['standard'];partial.capabilities.skin.profiles={standard:PROFILES.standard};partial.capabilities.skin.disabledModes={detailed:'Detailed vendor mapping not verified'};
 assert.equal(skinRequestState(partial,request('standard')).ready,true);assert.equal(skinRequestState(partial,r).reason,'Detailed vendor mapping not verified');assert.equal(skinCapabilities().publicNativeProtocolVerified,false);
});

test('media readiness and unmaterialized selection fail before reading source bytes',async()=>{
 const {prepareSkinMedia}=await import('../src/features/image-skin/media.mjs');
 const reads=()=>assert.fail('must fail before any source read');
 await assert.rejects(()=>prepareSkinMedia(request(),{nativeConfiguration:{configured:true,protocol:'tasks-v1'},resolveMedia:reads,transport:reads}));
 await assert.rejects(()=>prepareSkinMedia({...request(),inputs:[{...request().inputs[0],selection:{x:1}}]},{nativeConfiguration:provider(()=>assert.fail()).metadata,resolveMedia:reads,transport:reads}));
 const r=request(),p=provider(()=>assert.fail()),checks=[];
 const result=await prepareSkinMedia(r,{nativeConfiguration:p.metadata,baseUrl:'http://127.0.0.1:4173',resolveMedia:async()=>({url:r.inputs[0].url}),transport:async(value,options)=>{assert.equal(options.inlineImages,true);assert.equal(options.maxMediaBytes,32*1024*1024);return value;},normalizePng:async(input,options)=>{checks.push(options);return input;}});
 assert.deepEqual(result,r);assert.notEqual(result,r);assert.equal(checks.length,1);
});

test('generate preserves task callbacks and validates final complete image through actual polling wire',async()=>{
 const calls=[],ids=[],p=provider(wire(calls));
 const result=await p.generate(request('heavy'),{pollInterval:1,timeout:1000,onTaskIdentity:id=>ids.push(id)});
 assert.deepEqual(ids,['original-skin']);assert.equal(result.status,'succeeded');assert.equal(result.outputs[0].width,17);assert.equal(calls.filter(c=>c.method==='POST').length,1);
});

test('source normalization decodes dimensions, preserves native PNG bytes and closes original bitmap',async()=>{
 const {normalizeSkinPng}=await import('../src/features/image-skin/media.mjs');let closes=0;
 const result=await normalizeSkinPng(request().inputs[0],{fetchImpl:async()=>new Response(source,{headers:{'content-type':'image/png'}}),decode:async blob=>{assert.deepEqual(Buffer.from(await blob.arrayBuffer()),source);return {width:13,height:9,close:()=>closes++};},canvasFactory:()=>assert.fail('already supported PNG needs no recoding')});
 assert.equal(result.url,url(source));assert.deepEqual([result.width,result.height],[13,9]);assert.equal(closes,1);
 await assert.rejects(()=>normalizeSkinPng({...request().inputs[0],width:12},{fetchImpl:async()=>new Response(source,{headers:{'content-type':'image/png'}}),decode:async()=>({width:13,height:9,close:()=>closes++})}));assert.equal(closes,2);
 await assert.rejects(()=>normalizeSkinPng(request().inputs[0],{fetchImpl:async()=>new Response(source,{headers:{'content-type':'image/png'}}),decode:async()=>({width:65535,height:65535,close:()=>closes++})}));assert.equal(closes,3);
});

test('valid CRC containers with broken zlib, invalid filters or wrong decoded length cannot claim skin pixels',async()=>{
 const invalid=[replaceIDAT(source,Buffer.from('invalid-zlib')),replaceIDAT(source,deflateSync(Buffer.from([0,1]))),replaceIDAT(source,deflateSync(Buffer.alloc((13*4+1)*9,5)))];
 for(const bytes of invalid){assert.throws(()=>provider(()=>assert.fail()).prepare({...request(),inputs:[{...request().inputs[0],url:url(bytes)}]}),{code:'unsupported_generation'});await assert.rejects(()=>provider(async()=>Response.json(done(bytes))).poll('original-skin'),{code:'unknown'});}
});

test('dedicated response budget accepts real complete PNG above ordinary task 1 MiB limit',async()=>{
 const bytes=encodeRGBA(640,480,randomFillSync(Buffer.alloc(640*480*4)));assert.ok(Buffer.byteLength(JSON.stringify(done(bytes)))>1024*1024);
 const result=await provider(async()=>Response.json(done(bytes))).poll('original-skin');assert.deepEqual([result.outputs[0].width,result.outputs[0].height],[640,480]);assert.equal(result.outputs[0].url,url(bytes));
 await assert.rejects(()=>createTasksProvider({baseUrl:'https://skin-gateway.test/v1',apiKey:key,fetchImpl:async()=>Response.json(done(bytes))}).poll('original-skin'),{code:'unknown'});
});

test('input size errors name skin 32 MiB while retaining the strict relight 50 MiB default',async()=>{
 const {normalizeSkinPng}=await import('../src/features/image-skin/media.mjs'),{normalizeRelightPng}=await import('../src/features/image-relight/media.mjs');
 for(const [normalize,size,message]of [[normalizeSkinPng,33*1024*1024,/皮肤来源图片.*不超过 32 MiB/],[normalizeRelightPng,50*1024*1024,/打光来源图片.*小于 50 MiB/]])await assert.rejects(()=>normalize(request().inputs[0],{fetchImpl:async()=>({ok:true,blob:async()=>({type:'image/png',size})}),decode:()=>assert.fail('oversized envelope must fail before allocation/decode')}),error=>message.test(error.message));
});

test('converted size errors name the actual operation and budget without allocating a large image',async()=>{
 const {normalizeSkinPng}=await import('../src/features/image-skin/media.mjs'),{normalizeRelightPng}=await import('../src/features/image-relight/media.mjs');let closes=0;
 for(const [normalize,size,message]of [[normalizeSkinPng,33*1024*1024,/皮肤来源图片转换后超过 32 MiB/],[normalizeRelightPng,50*1024*1024,/打光来源图片转换后超过 50 MiB/]])await assert.rejects(()=>normalize({url:'data:image/jpeg;base64,c3ludGhldGlj'},{fetchImpl:async()=>({ok:true,blob:async()=>({type:'image/jpeg',size:1})}),decode:async()=>({width:1,height:1,close:()=>closes++}),canvasFactory:()=>({getContext:()=>({drawImage(){}}),toBlob:callback=>callback({type:'image/png',size})}),serialize:()=>assert.fail('oversized output must not serialize')}),error=>message.test(error.message));
 assert.equal(closes,2);
});

test('submission checkpoints await only a trusted identity before validating damaged output',async()=>{
 const ids=[];let release;const pending=provider(async()=>Response.json(done(output.subarray(0,40)))).submit(request(),{onTaskIdentity:async id=>{ids.push(id);await new Promise(resolve=>{release=resolve;});}});
 await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(ids,['original-skin']);let settled=false;pending.catch(()=>{settled=true;});await new Promise(resolve=>setImmediate(resolve));assert.equal(settled,false);release();await assert.rejects(()=>pending,{code:'unknown'});
 for(const bad of [{...done(),id:'..'},{...done(),id:encodeURIComponent(key)}])await assert.rejects(()=>provider(async()=>Response.json(bad)).submit(request(),{onTaskIdentity:()=>assert.fail('untrusted identity must not be saved')}));
});
