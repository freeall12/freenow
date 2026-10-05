'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const {createMagnificProvider,parseMagnificModelMap}=require('../server/generation-magnific.cjs');
const {magnificCapabilities}=require('../server/generation-magnific-profile.cjs');
const {encodeRGBA,decodePNG,crc32}=require('../server/generation-png-alpha.cjs');
const {createGenerationMediaStore}=require('../server/generation-media-store.cjs');
const {createGenerationMediaMaterializer}=require('../server/generation-media-materializer.cjs');
const key='synthetic-magnific-key',id='a126dafa-d7b4-4c87-95bd-21a75dbf0658';
const modelMap={'image.upscale:magnific':{kind:'image.upscale',model:'magnific-v2'}};
const source=encodeRGBA(13,9,Buffer.alloc(13*9*4,240)),result=encodeRGBA(21,15,Buffer.alloc(21*15*4,212));
const uri=bytes=>'data:image/png;base64,'+bytes.toString('base64');
const request=(patch={})=>({kind:'image.upscale',label:'Magnific 高清放大',nodeId:'target',sourceNodeId:'source',prompt:'',inputs:[{type:'image',role:'source_image',nodeId:'source',url:uri(source),width:13,height:9}],parameters:{provider:'magnific',scaleFactor:2,sharpen:7,smartGrain:7,ultraDetail:30},...patch});
const receipt=(status='CREATED',generated=[])=>({data:{task_id:id,status,generated}});
const completed=()=>receipt('COMPLETED',['https://result.vendor.test/original.jpg']);
const download=(bytes=result,mime='image/png',closed=()=>{})=>async(url,options)=>{assert.equal(url,completed().data.generated[0]);assert.equal(options.kind,'image');return {mime,expectedBytes:bytes.length,stream:(async function*(){yield bytes;})(),close:closed};};
const provider=(fetchImpl,options={})=>createMagnificProvider({apiKey:key,modelMap,fetchImpl,downloadImpl:download(),...options});
function wire(calls=[],value){return async(url,options)=>{calls.push({url,method:options.method,headers:new Headers(options.headers),body:options.body&&JSON.parse(options.body),redirect:options.redirect});return Response.json(typeof value==='function'?value(calls.length,options):value|| (options.method==='POST'?receipt():completed()));};}
function pngChunk(type,data){const bytes=Buffer.alloc(data.length+12);bytes.writeUInt32BE(data.length);bytes.write(type,4);data.copy(bytes,8);bytes.writeUInt32BE(crc32(bytes.subarray(4,-4)),bytes.length-4);return bytes;}

test('configuration permits only canonical Magnific origin and one explicit native alias',async()=>{
 let calls=0;const fetchImpl=async()=>{calls++;return Response.json(receipt());};
 for(const config of [{},{apiKey:key},{modelMap},{apiKey:' bad\n',modelMap}]){const p=createMagnificProvider({...config,fetchImpl});assert.equal(p.configured,false);await assert.rejects(()=>p.submit(request()),{code:'configuration_required'});}
 for(const baseUrl of ['https://api.freepik.com','http://api.magnific.com','https://local.test/v1','https://api.magnific.com/v2','https://api.magnific.com/v1?','https://key@api.magnific.com','https://tapnow.ai'])assert.equal(provider(fetchImpl,{baseUrl}).configured,false);
 for(const baseUrl of ['','https://api.magnific.com','https://api.magnific.com/','https://api.magnific.com/v1','https://api.magnific.com/v1/'])assert.equal(provider(fetchImpl,{baseUrl}).configured,true);
 for(const value of [[],{'image.upscale':modelMap['image.upscale:magnific']},{'image.upscale:magnific':{kind:'image.upscale',model:'magnific'}},{'image.upscale:magnific':{kind:'image.upscale',model:'magnific-v2',provider:'freepik'}}])assert.throws(()=>parseMagnificModelMap(value));
 assert.equal(calls,0);const p=provider(fetchImpl);assert.equal(p.cancel,undefined);assert.equal(p.metadata.protocol,'magnific-native');assert.equal(p.metadata.capabilities.remoteCancellation,false);assert.equal(JSON.stringify(p.metadata).includes(key),false);
 assert.equal(p.fingerprint,provider(fetchImpl,{apiKey:'rotated-secret'}).fingerprint);
});

test('shared public capabilities are identical to frontend required contract and budgets are local',async()=>{
 const {magnificProfile,magnificRequestState}=await import('../src/features/image-upscale/native-profile.mjs');
 const p=provider(()=>assert.fail());for(const [name,value]of Object.entries(magnificProfile))assert.deepEqual(magnificCapabilities()[name],value,name);
 assert.equal(magnificRequestState(p.metadata,request()).ready,true);assert.equal(p.metadata.capabilities.upscaleMagnific.budgetScope,'local-only');
 assert.equal(p.metadata.capabilities.upscaleMagnific.maxOutputBytes,100*1024*1024);assert.equal(p.metadata.capabilities.upscaleMagnific.vendorOutputMimeGuaranteed,false);
});

test('pure prepare checks complete original source and POST sends only documented raw base64 and four parameters',async()=>{
 const calls=[],p=provider(wire(calls)),r=request(),before=structuredClone(r);assert.equal(p.prepare(r),r);assert.equal(calls.length,0);
 const ids=[],accepted=await p.submit(r,{onTaskIdentity:async value=>{ids.push(value);}});assert.equal(accepted.id,id);assert.equal(accepted.status,'queued');assert.deepEqual(ids,[id]);assert.deepEqual(r,before);
 assert.equal(calls.length,1);assert.equal(calls[0].url,'https://api.magnific.com/v1/ai/image-upscaler-precision-v2');assert.equal(calls[0].method,'POST');assert.equal(calls[0].headers.get('x-magnific-api-key'),key);assert.equal(calls[0].headers.get('authorization'),null);assert.equal(calls[0].redirect,'error');
 assert.deepEqual(calls[0].body,{image:source.toString('base64'),scale_factor:2,sharpen:7,smart_grain:7,ultra_detail:30});assert.deepEqual(Buffer.from(calls[0].body.image,'base64'),source);
 for(const scaleFactor of [2,8,16])await p.submit(request({parameters:{...r.parameters,scaleFactor,sharpen:0,smartGrain:100,ultraDetail:100}}));
 assert.deepEqual(calls.at(-1).body,{image:source.toString('base64'),scale_factor:16,sharpen:0,smart_grain:100,ultra_detail:100});
});

test('unsupported provider, prompt, fields, counts, source envelope, nonexplicit or out-of-range settings never POST',async()=>{
 let calls=0;const p=provider(async()=>{calls++;assert.fail();}),r=request(),invalid=[{...r,kind:'image.generate'},{...r,prompt:'upscale'},{...r,count:2},{...r,references:[{}]},{...r,sourceNodeId:'other'},{...r,inputs:[...r.inputs,...r.inputs]},{...r,apiKey:'not-accepted'}];
 for(const [field,value]of [['provider','topazlabs'],['scaleFactor',1],['scaleFactor',17],['scaleFactor','2'],['scaleFactor',2.5],['sharpen',-1],['smartGrain',101],['ultraDetail',null],['model','magnific-v2'],['flavor','photo'],['output_format','png']])invalid.push({...r,parameters:{...r.parameters,[field]:value}});
 for(const field of ['scaleFactor','sharpen','smartGrain','ultraDetail']){const parameters={...r.parameters};delete parameters[field];invalid.push({...r,parameters},{...r,parameters:{...r.parameters,[field]:undefined}});}
 for(const [field,value]of [['role','reference'],['width',14],['selection',null],['crop',null],['fullImage',uri(source)],['url','https://tapnow.media/a.png'],['url','https://127.0.0.1/a.png'],['url','blob:local'],['url','asset:source'],['url','data:image/jpeg;base64,bm90LWpwZw==']])invalid.push({...r,inputs:[{...r.inputs[0],[field]:value}]});
 for(const candidate of invalid)await assert.rejects(()=>p.submit(candidate));assert.equal(calls,0);
});

test('source must decode every byte, dimensions and CRC before dispatch; compressed metadata and animations reject',async()=>{
 let calls=0;const p=provider(async()=>{calls++;assert.fail();}),r=request(),corrupt=Buffer.from(source);corrupt[40]^=1;
 const invalid=[corrupt,source.subarray(0,-1),Buffer.concat([source,Buffer.from('trailing')])];
 for(const type of ['iTXt','zTXt','iCCP','acTL','tRNS'])invalid.push(Buffer.concat([source.subarray(0,33),pngChunk(type,Buffer.from('sample')),source.subarray(33)]));
 const encodedKey=encodeRGBA(13,9,Buffer.concat([Buffer.from(key),Buffer.alloc(13*9*4-Buffer.byteLength(key))]));invalid.push(encodedKey);
 for(const bytes of invalid)await assert.rejects(()=>p.submit({...r,inputs:[{...r.inputs[0],url:uri(bytes)}]}));assert.equal(calls,0);
});

test('POST and restart GET preserve original identity, actual bytes and actual output dimensions without inferred scale',async()=>{
 const calls=[],first=provider(wire(calls)),accepted=await first.submit(request()),restarted=provider(wire(calls),{apiKey:'rotated-secret'}),value=await restarted.poll(accepted.id);
 assert.equal(value.id,id);assert.equal(value.status,'succeeded');assert.deepEqual(value.outputs,[{type:'image',url:uri(result),mime:'image/png',width:21,height:15}]);assert.deepEqual(decodePNG(Buffer.from(value.outputs[0].url.split(',')[1],'base64')).pixels,decodePNG(result).pixels);
 assert.deepEqual(calls.map(call=>call.method),['POST','GET']);assert.equal(calls[1].url,'https://api.magnific.com/v1/ai/image-upscaler-precision-v2/'+id);assert.equal(calls[1].headers.get('x-magnific-api-key'),'rotated-secret');assert.equal(first.fingerprint,restarted.fingerprint);
});

test('valid first identity is awaited before unknown status, malformed or secret-bearing output is rejected; GET recovery never POSTs',async()=>{
 const wrong=[receipt('NEW_STATUS'),receipt('COMPLETED',[]),receipt('COMPLETED',['https://tapnow.media/result.png']),receipt('COMPLETED',['https://cdn.test/a?key='+encodeURIComponent(key)]),receipt('COMPLETED',['https://cdn.test/a','https://cdn.test/b'])];
 for(const value of wrong){let release;const calls=[],ids=[],p=provider(wire(calls,(_n,o)=>o.method==='POST'?value:completed()));const pending=p.submit(request(),{onTaskIdentity:async saved=>{ids.push(saved);await new Promise(resolve=>{release=resolve;});}});pending.catch(()=>{});
  while(!release)await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(ids,[id]);let settled=false;pending.catch(()=>{settled=true;});await new Promise(resolve=>setImmediate(resolve));assert.equal(settled,false);release();await assert.rejects(()=>pending,{code:'unknown'});
  assert.equal((await p.poll(id)).status,'succeeded');assert.deepEqual(calls.map(call=>call.method),['POST','GET']);
 }
});

test('untrusted or mismatched UUID cannot be checkpointed or redirected into another task',async()=>{
 for(const task_id of ['not-a-uuid','../secret','https://cdn.test/task',key])await assert.rejects(()=>provider(wire([],{data:{task_id,status:'COMPLETED',generated:[]}})).submit(request(),{onTaskIdentity:()=>assert.fail('invalid UUID')}));
 let calls=0;const p=provider(async()=>{calls++;return Response.json({data:{...completed().data,task_id:randomUUID()}});});await assert.rejects(()=>p.poll(id),{code:'provider_identity_mismatch'});
 for(const bad of ['../'+id,'not-a-uuid',null])await assert.rejects(()=>p.poll(bad),{code:'provider_identity_mismatch'});assert.equal(calls,1);
});

test('documented progress has no fabricated percentage and FAILED redacts supplier diagnostics',async()=>{
 for(const status of ['CREATED','IN_PROGRESS','FAILED']){const value={...receipt(status),privateMessage:'opaque supplier diagnostics'},p=provider(wire([],value)),task=await p.submit(request());assert.equal(task.status,{CREATED:'queued',IN_PROGRESS:'running',FAILED:'failed'}[status]);assert.equal(task.progress,undefined);assert.equal(task.outputs,undefined);assert.equal(JSON.stringify(task).includes('opaque'),false);}
 await assert.rejects(()=>provider(wire([],receipt('IN_PROGRESS',completed().data.generated))).submit(request()),{code:'unknown'});
});

test('damaged media, format mismatch and encoded pixel credential cannot claim success or cause a second POST',async()=>{
 const corrupt=Buffer.from(result);corrupt[40]^=1;
 const secretPixels=encodeRGBA(21,15,Buffer.concat([Buffer.from(key),Buffer.alloc(21*15*4-Buffer.byteLength(key))]));
 for(const [bytes,mime]of [[corrupt,'image/png'],[result.subarray(0,-1),'image/png'],[Buffer.concat([result,Buffer.from('trailing')]),'image/png'],[Buffer.from('not an image'),'image/jpeg'],[result,'image/webp'],[secretPixels,'image/png']]){
  const calls=[],ids=[],p=provider(wire(calls,completed()),{downloadImpl:download(bytes,mime)});await assert.rejects(()=>p.submit(request(),{onTaskIdentity:value=>ids.push(value)}),{code:'unknown'});assert.deepEqual(ids,[id]);assert.equal(calls.length,1);
 }
});

test('existing local FFmpeg fully decodes actual JPEG and WebP bytes and preserves original returned encoding',async()=>{
 for(const [codec,mime]of [['mjpeg','image/jpeg'],['libwebp','image/webp']]){
  const rendered=spawnSync(process.env.FFMPEG_PATH||'ffmpeg',['-hide_banner','-loglevel','error','-f','image2pipe','-vcodec','png','-i','pipe:0','-frames:v','1','-c:v',codec,'-f','image2pipe','pipe:1'],{input:result,timeout:20000,maxBuffer:1024*1024});assert.equal(rendered.status,0,rendered.stderr?.toString());
  const bytes=rendered.stdout,calls=[],p=provider(wire(calls,completed()),{downloadImpl:download(bytes,mime)}),value=await p.submit(request());assert.equal(value.status,'succeeded');assert.equal(value.outputs[0].mime,mime);assert.deepEqual([value.outputs[0].width,value.outputs[0].height],[21,15]);assert.deepEqual(Buffer.from(value.outputs[0].url.split(',')[1],'base64'),bytes);
  const damaged=Buffer.from(bytes);if(mime==='image/jpeg'){damaged[damaged.length-2]=0;damaged[damaged.length-1]=0;}else damaged.writeUInt32LE(damaged.length+200,4);
  await assert.rejects(()=>provider(wire([],completed()),{downloadImpl:download(damaged,mime)}).submit(request()),{code:'unknown'});
 }
});

test('successful bytes are truly archived in existing local media store and remain readable across restart',async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'magnific-archive-test-')),taskId=randomUUID();let store=createGenerationMediaStore({directory});
 try{
  const value=await provider(wire([],completed())).submit(request()),materializer=createGenerationMediaMaterializer({store}),localized=await materializer.localize(value.outputs,{taskId});assert.match(localized.outputs[0].url,/^\/api\/generation\/media\//);assert.equal(localized.manifests[0].mime,'image/png');assert.equal(localized.manifests[0].bytes,result.length);
  const mediaId=localized.resources[0];await store.close();store=createGenerationMediaStore({directory});const resource=await store.open(mediaId,{taskId});try{assert.deepEqual(await resource.handle.readFile(),result);}finally{await resource.handle.close();}
 }finally{await store.close();await fs.rm(directory,{recursive:true,force:true});}
});

test('unknown POST, bounded response and abort do not retry; local cancellation does not invoke remote stop',async()=>{
 let posts=0;await assert.rejects(()=>provider(async()=>{posts++;throw Error('secret '+key);}).submit(request()),error=>error.code==='unknown'&&!error.message.includes(key));assert.equal(posts,1);
 for(const fetchImpl of [async()=>new Response('{}',{headers:{'Content-Length':String(1024*1024+1)}}),async()=>new Response('x'.repeat(1024*1024+1))])await assert.rejects(()=>provider(fetchImpl).submit(request()),{code:'unknown'});
 for(const fetchImpl of [()=>new Promise(()=>{}),async()=>new Response(new ReadableStream({pull:()=>new Promise(()=>{})}))]){const controller=new AbortController(),reason=Error('local cancel'),p=provider(fetchImpl),pending=p.submit(request(),{signal:controller.signal});setTimeout(()=>controller.abort(reason),5);await assert.rejects(()=>pending,error=>error===reason);assert.equal(p.cancel,undefined);}
 const calls=[],ids=[],controller=new AbortController(),p=provider(wire(calls,completed()),{downloadImpl:()=>new Promise(()=>{})}),pending=p.submit(request(),{signal:controller.signal,onTaskIdentity:value=>ids.push(value)});setTimeout(()=>controller.abort(Error('stop local waiting')),10);await assert.rejects(()=>pending,/stop local waiting/);assert.deepEqual(ids,[id]);assert.deepEqual(calls.map(call=>call.method),['POST']);
});

test('generate awaits checkpoint, polls original ID once per receipt and timeout remains queryable',async()=>{
 const calls=[],ids=[],progress=[],p=provider(wire(calls,(n,o)=>o.method==='POST'?receipt():n===2?receipt('IN_PROGRESS'):completed()));const value=await p.generate(request(),{pollInterval:1,onTaskIdentity:async saved=>{ids.push(saved);},onProgress:percentage=>progress.push(percentage)});assert.equal(value.status,'succeeded');assert.deepEqual(ids,[id]);assert.deepEqual(calls.map(call=>call.method),['POST','GET','GET']);assert.deepEqual(progress,[100]);
 const timeoutCalls=[],timeoutIds=[];await assert.rejects(()=>provider(wire(timeoutCalls,receipt())).generate(request(),{timeout:12,pollInterval:1,onTaskIdentity:saved=>timeoutIds.push(saved)}),{code:'unknown'});assert.deepEqual(timeoutIds,[id]);assert.equal(timeoutCalls.filter(call=>call.method==='POST').length,1);
});
