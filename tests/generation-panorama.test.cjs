'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{Readable}=require('node:stream');
const {deflateSync}=require('node:zlib');
const {createPanoramaProvider,parsePanoramaModelMap}=require('../server/generation-panorama.cjs');
const MODEL='fal-ai/hunyuan_world',ALIAS='hunyuan-world-panorama';
const modelMap={[ALIAS]:{kind:'image.generate',model:MODEL}};
function crc(bytes){let n=0xffffffff;for(const byte of bytes){n^=byte;for(let j=0;j<8;j++)n=(n>>>1)^(n&1?0xedb88320:0);}return (n^0xffffffff)>>>0;}
function png(width=4,height=2){
 const chunk=(type,data)=>{const name=Buffer.from(type),head=Buffer.alloc(4),tail=Buffer.alloc(4);head.writeUInt32BE(data.length);tail.writeUInt32BE(crc(Buffer.concat([name,data])));return Buffer.concat([head,name,data,tail]);};
 const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=2;
 const rows=Buffer.alloc(height*(width*3+1),90);for(let y=0;y<height;y++)rows[y*(width*3+1)]=0;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);
}
const source='data:image/png;base64,'+png(2,2).toString('base64');
const request=(parameters={})=>({kind:'image.generate',prompt:'保持原房间，拓展为完整 360° 空间',inputs:[{type:'image',url:source}],parameters:{modelId:ALIAS,isPanoramaPrompt:true,ratio:'2:1',count:1,...parameters}});
const response=value=>Response.json(value);
const image=(patch={})=>({url:'https://v3.fal.media/panorama.png',content_type:'image/png',width:4,height:2,...patch});
const download=(bytes=png(),mime='image/png')=>async(url,options)=>{assert.equal(url,'https://v3.fal.media/panorama.png');assert.equal(options.kind,'image');assert.equal(options.headers,undefined);return {mime,stream:Readable.from([bytes]),expectedBytes:bytes.length};};
const provider=(fetchImpl,options={})=>createPanoramaProvider({apiKey:'fixture-panorama-key',modelMap,fetchImpl,download:download(),...options});
const queueMock=(calls=[],result={image:image()})=>async(url,options)=>{calls.push({url:String(url),method:options.method,body:options.body&&JSON.parse(options.body),headers:new Headers(options.headers)});return response(options.method==='POST'?{request_id:'original-pano',status:'IN_QUEUE'}:String(url).includes('/status')?{request_id:'original-pano',status:'COMPLETED'}:result);};

test('exact panorama opt-in publishes an honest image-only alternative and no private configuration',()=>{
 const p=provider(()=>assert.fail());assert.equal(p.configured,true);assert.equal(p.metadata.protocol,'fal-panorama-native');
 assert.deepEqual(p.metadata.capabilities.models,{[ALIAS]:{kind:'image.generate',label:'Hunyuan World Panorama'}});
 assert.deepEqual(p.metadata.capabilities.panorama[ALIAS],{semantics:'explicit-native-alternative',label:'Hunyuan World Panorama',source:'image',maxImages:1,maxCount:1,projection:'equirectangular',fixedAspectRatio:'2:1',nativeSize:true,editing:false,maxInputBytes:20*1024*1024,maxOutputBytes:32*1024*1024,inputMimeTypes:['image/png'],outputMimeTypes:['image/png'],pngProfile:'noninterlaced-8bit-rgb-rgba'});
 for(const map of [{old:modelMap[ALIAS]},{[ALIAS]:{kind:'panorama.edit',model:MODEL}},{[ALIAS]:{kind:'image.generate',model:MODEL+'/image-to-world'}},{[ALIAS]:{...modelMap[ALIAS],quality:'high'}}])assert.throws(()=>parsePanoramaModelMap(map));
 for(const options of [{apiKey:''},{modelMap:{}},{baseUrl:'https://queue.fal.run?key=fixture-panorama-key'},{baseUrl:'https://another.test/'},{baseUrl:'https://queue.fal.run/fal-ai/hunyuan_world'}])assert.equal(provider(()=>assert.fail(),options).configured,false);
 for(const hidden of ['fixture-panorama-key','queue.fal.run',MODEL])assert.ok(!JSON.stringify(p.metadata).includes(hidden));
});

test('prepare is pure and one native POST preserves source bytes and complete user prompt',async()=>{
 const calls=[],p=provider(queueMock(calls)),input=request({providerParameters:{model:ALIAS,mode:'image_to_image',aspectRatio:'2:1',times:1,isPanoramaPrompt:true}}),before=structuredClone(input);
 assert.equal(p.prepare(input),input);assert.equal(calls.length,0);const accepted=await p.submit(input);
 assert.equal(accepted.status,'queued');assert.deepEqual(input,before);
 assert.equal(calls.length,1);assert.equal(calls[0].url,'https://queue.fal.run/'+MODEL);assert.equal(calls[0].headers.get('authorization'),'Key fixture-panorama-key');
 assert.deepEqual(calls[0].body,{image_url:source,prompt:input.prompt});
});

test('missing source/prompt/full panorama intent and unsupported settings all reject before any HTTP',async()=>{
 let calls=0;const p=provider(async()=>{calls++;assert.fail();});
 const invalid=[
  request({isPanoramaPrompt:false}),request({isPanoramaPrompt:'true'}),request({ratio:'16:9'}),request({count:2}),request({times:2}),request({resultMode:'storyboard'}),request({canvasResults:{targetNodeIds:['a','b']}}),
  request({quality:'2K'}),request({imageSize:'2K'}),request({thinking:'high'}),request({cameraControl:{yaw:10}}),request({seed:1}),request({mode:'image_to_image'}),
  request({providerParameters:{model:ALIAS,quality:'high'}}),request({providerParameters:{model:'tap-image2'}}),request({providerParameters:{model:ALIAS,mode:'text_to_image'}}),request({providerParameters:{model:ALIAS,isPanoramaPrompt:false}}),
  {...request(),prompt:''},{...request(),prompt:'   '},{...request(),prompt:'x'.repeat(32769)},{...request(),inputs:[]},{...request(),inputs:[...request().inputs,...request().inputs]},
  {...request(),inputs:[{type:'video',url:source}]},{...request(),references:[{type:'image',url:source}]},{...request(),kind:'panorama.edit'},{...request(),kind:'world.generate'},
  {...request(),inputs:[{type:'image',url:source,projection:'equirectangular'}]},request({apiKey:'should-not-send'})
 ];
 const missing=request();delete missing.parameters.isPanoramaPrompt;invalid.push(missing);
 for(const input of invalid)await assert.rejects(()=>p.submit(input));assert.equal(calls,0);
});

test('source validation accepts only actually decoded inline PNG and rejects public URL shortcuts',()=>{
 const p=provider(()=>assert.fail());
 for(const url of ['asset:private','blob:https://local.test/id','http://public.test/image.png','https://localhost./image.png','https://100.64.0.1/image.png','https://tapnow.media/source.png','https://user:secret@public.test/image.png','data:image/png;base64,YQ==','data:image/svg+xml;base64,PHN2Zy8+'])assert.throws(()=>p.prepare({...request(),inputs:[{type:'image',url}]}));
 assert.throws(()=>p.prepare({...request(),inputs:[{type:'image',url:'https://public.test/source.png'}]}));
});

test('actual image bytes define verified 2:1 size and original task recovery never replays POST',async()=>{
 const calls=[],fetchImpl=queueMock(calls),first=provider(fetchImpl),accepted=await first.submit(request());
 const restarted=provider(fetchImpl,{apiKey:'rotated-key'}),value=await restarted.poll(accepted.id);
 assert.equal(first.fingerprint,restarted.fingerprint);assert.equal(value.id,accepted.id);assert.equal(value.status,'succeeded');
 assert.deepEqual(value.outputs,[{type:'image',url:'data:image/png;base64,'+png().toString('base64'),mime:'image/png',width:4,height:2,sourceFileId:'original-pano'}]);
 assert.deepEqual(calls.map(call=>call.url),['https://queue.fal.run/'+MODEL,'https://queue.fal.run/'+MODEL+'/requests/original-pano/status?logs=0','https://queue.fal.run/'+MODEL+'/requests/original-pano']);
 assert.equal(calls.filter(call=>call.method==='POST').length,1);
});

test('missing supplier dimensions are measured from actual dedicated panorama bytes without guessing',async()=>{
 const p=provider(queueMock([],{image:image({width:null,height:null,content_type:null})})),accepted=await p.submit(request());
 const value=await p.poll(accepted.id);assert.equal(value.outputs[0].width,4);assert.equal(value.outputs[0].height,2);assert.equal(value.outputs[0].mime,'image/png');
});

test('ordinary 2:1 labels, invalid bytes, wrong dimensions and MIME never publish success or resubmit',async()=>{
 const cases=[
  [{image:image()},download(png(2,2))],
  [{image:image()},download(Buffer.from('not an image'))],
  [{image:image()},download(png().subarray(0,40))],
  [{image:image({width:8,height:4})},download()],
  [{image:image({width:4,height:4})},download()],
  [{image:image({content_type:'image/jpeg'})},download()],
  [{image:image({file_size:999})},download()],
  [{image:image({width:0})},download()],
  [{image:image({url:'https://localhost/pano.png'})},download()],
  [{image:image({content_type:'application/json'})},download()],
  [{images:[image()]},download()],
  [{image:image(),images:[image()]},download()],
  [{image:image()},download(png(),'application/octet-stream')],
 ];
 for(const [result,downloadImpl]of cases){const calls=[],p=provider(queueMock(calls,result),{download:downloadImpl}),accepted=await p.submit(request());await assert.rejects(()=>p.poll(accepted.id),{code:'unknown'});assert.equal(calls.filter(call=>call.method==='POST').length,1);}
});

test('original identities, removed mappings and supplier mismatches reject rather than query a substitute',async()=>{
 const accepted=await provider(queueMock()).submit(request());
 const p=provider(()=>assert.fail('forged identities must not query'));
 for(const values of [[MODEL+'/image-to-world',ALIAS,'original-pano'],[MODEL,'other','original-pano'],[MODEL,ALIAS,'../elsewhere']])await assert.rejects(()=>p.poll('pn1.'+Buffer.from(JSON.stringify(values)).toString('base64url')),{code:'provider_identity_mismatch'});
 await assert.rejects(()=>provider(()=>assert.fail(),{modelMap:{}}).poll(accepted.id),{code:'configuration_required'});
 const mismatched=provider(async()=>response({request_id:'different-task',status:'COMPLETED'}));await assert.rejects(()=>mismatched.poll(accepted.id),{code:'provider_identity_mismatch'});
});

test('unknown remains pollable and cancellation acceptance makes no claim execution stopped',async()=>{
 const calls=[],p=provider(async(url,options)=>{calls.push({url,method:options.method});return options.method==='POST'?response({request_id:'original-pano'}):options.method==='PUT'?new Response(JSON.stringify({request_id:'original-pano',status:'CANCELLATION_REQUESTED'}),{status:202,headers:{'content-type':'application/json'}}):response({request_id:'original-pano',status:'UNCONFIRMED'});});
 const accepted=await p.submit(request());for(let i=0;i<2;i++)assert.equal((await p.poll(accepted.id)).status,'unknown');
 assert.deepEqual(await p.cancel(accepted.id),{id:accepted.id,status:'unknown'});assert.equal(calls.at(-1).method,'PUT');assert.equal(calls.at(-1).url,'https://queue.fal.run/'+MODEL+'/requests/original-pano/cancel');
 assert.equal(calls.filter(call=>call.method==='POST').length,1);
});

test('uncertain generation POST and failed image download never trigger another submission',async()=>{
 let posts=0;const p=provider(async()=>{posts++;throw Error('fixture transport failure');});await assert.rejects(()=>p.generate(request()),{code:'unknown'});assert.equal(posts,1);
 const calls=[],failed=provider(queueMock(calls),{download:async()=>{throw Error('fixture CDN failure');}}),accepted=await failed.submit(request());
 for(let i=0;i<2;i++)await assert.rejects(()=>failed.poll(accepted.id),{code:'unknown'});assert.equal(calls.filter(call=>call.method==='POST').length,1);
});

test('production media downloader pins DNS, enforces transport/byte boundaries and never forwards fal Key',async()=>{
 const {createGenerationMediaDownloader}=require('../server/generation-media-download.cjs'),{EventEmitter}=require('node:events'),{PassThrough}=require('node:stream');
 const mediaCalls=[],bytes=png();
 const transport=({remote='93.184.216.34',status=200,length=bytes.length}={})=>(url,options,callback)=>{
  const req=new EventEmitter();req.destroy=()=>{};req.end=()=>{mediaCalls.push({url,options});options.lookup(url.hostname,{all:true},(error,addresses)=>{assert.ifError(error);assert.deepEqual(addresses,[{address:'93.184.216.34',family:4}]);});queueMicrotask(()=>{const res=new PassThrough();res.statusCode=status;res.socket={remoteAddress:remote};res.headers={'content-type':'image/png','content-length':String(length)};callback(res);res.end(bytes);});};return req;
 };
 const lookup=async()=>[{address:'93.184.216.34',family:4}];
 const actual=createGenerationMediaDownloader({lookup,requestImpl:transport(),limits:{image:32*1024*1024}});
 const p=provider(queueMock(),{download:actual.download}),accepted=await p.submit(request());assert.equal((await p.poll(accepted.id)).status,'succeeded');
 assert.equal(mediaCalls[0].options.headers.Authorization,undefined);assert.equal(mediaCalls[0].options.headers['WLT-Api-Key'],undefined);assert.ok(!JSON.stringify(mediaCalls[0].options.headers).includes('fixture-panorama-key'));
 for(const options of [{remote:'127.0.0.1'},{status:302},{length:32*1024*1024+1},{length:bytes.length+1}]){
  const bad=createGenerationMediaDownloader({lookup,requestImpl:transport(options),limits:{image:32*1024*1024}}),calls=[],failed=provider(queueMock(calls),{download:bad.download}),job=await failed.submit(request());await assert.rejects(()=>failed.poll(job.id),{code:'unknown'});assert.equal(calls.filter(call=>call.method==='POST').length,1);
 }
});

function pngChunk(type,data){const name=Buffer.from(type),head=Buffer.alloc(4),tail=Buffer.alloc(4);head.writeUInt32BE(data.length);tail.writeUInt32BE(crc(Buffer.concat([name,data])));return Buffer.concat([head,name,data,tail]);}
function replaceIDAT(bytes,data){let offset=8;const parts=[bytes.subarray(0,8)];while(offset+12<=bytes.length){const end=offset+12+bytes.readUInt32BE(offset),type=bytes.toString('ascii',offset+4,offset+8);parts.push(type==='IDAT'?pngChunk(type,data):bytes.subarray(offset,end));offset=end;}return Buffer.concat(parts);}
function metadataPNG(type,data){const bytes=png(),ihdrEnd=33;return Buffer.concat([bytes.subarray(0,ihdrEnd),pngChunk(type,data),bytes.subarray(ihdrEnd)]);}

test('valid container/CRC but broken zlib, invalid filters or decompressed length fails real pixel decoding',async()=>{
 const invalid=[replaceIDAT(png(),Buffer.from('not-zlib-image-pixels')),replaceIDAT(png(),deflateSync(Buffer.from([0,1]))),replaceIDAT(png(),deflateSync(Buffer.alloc((4*3+1)*2,5)))];
 for(const bytes of invalid){
  const calls=[],p=provider(queueMock(calls),{download:download(bytes)}),accepted=await p.submit(request());await assert.rejects(()=>p.poll(accepted.id),{code:'unknown'});assert.equal(calls.filter(call=>call.method==='POST').length,1);
  const sourceRequest={...request(),inputs:[{type:'image',url:'data:image/png;base64,'+bytes.toString('base64')}]};
  assert.throws(()=>p.prepare(sourceRequest),error=>error.providerDispatched===false);
 }
});

test('unhandled request/input fields and malformed references cannot disappear before POST',async()=>{
 let posts=0;const p=provider(async()=>{posts++;assert.fail();});
 for(const input of [
  {...request(),regions:[{x:1}]},{...request(),camera:{yaw:1}},{...request(),references:{}},{...request(),references:null},
  {...request(),inputs:[{...request().inputs[0],sourceClip:{start:0,end:1}}]},
  {...request(),inputs:[{...request().inputs[0],mask:'ignored'}]},
  {...request(),inputs:[{...request().inputs[0],role:'style'}]},
  {...request(),inputs:[{type:'image',url:'https://public.test/source.png'}]},
  {...request(),inputs:[{...request().inputs[0],width:999}]},
 ])await assert.rejects(()=>p.submit(input),error=>error.providerDispatched===false);
 assert.equal(posts,0);
});

test('all JSON receipts including discarded metadata and encoded credential URLs reject before download',async()=>{
 const secret='fixture-panorama-key',encoded=Array.from(secret).map(char=>'%'+char.charCodeAt(0).toString(16)).join('');
 for(const [phase,payload]of [
  ['submit',{request_id:'original-pano',debug:secret}],
  ['status',{request_id:'original-pano',status:'COMPLETED',logs:{debug:secret}}],
  ['result',{image:image({url:'https://v3.fal.media/panorama.png?echo='+secret})}],
  ['result',{image:image({url:'https://v3.fal.media/panorama.png?echo='+encoded})}],
  ['result',{image:image(),unusedMetadata:{text:secret}}],
 ]){
  let downloads=0,posts=0;const p=provider(async(url,options)=>{if(options.method==='POST'){posts++;return response(phase==='submit'?payload:{request_id:'original-pano'});}return response(String(url).includes('/status')?phase==='status'?payload:{request_id:'original-pano',status:'COMPLETED'}:payload);},{download:async()=>{downloads++;assert.fail('credential receipt must not reach media URL');}});
  if(phase==='submit')await assert.rejects(()=>p.submit(request()),{code:'unknown'});else{const accepted=await p.submit(request());await assert.rejects(()=>p.poll(accepted.id),{code:'unknown'});}
  assert.equal(posts,1);assert.equal(downloads,0);
 }
});

test('source/output PNG metadata and decoded pixels cannot publish supplier credentials',async()=>{
 const secret='fixture-panorama-key',text=metadataPNG('tEXt',Buffer.from('Comment\0'+secret));
 const compressed=metadataPNG('zTXt',Buffer.concat([Buffer.from('Comment\0\0'),deflateSync(Buffer.from(secret))]));
 const {encodeRGBA}=require('../server/generation-png-alpha.cjs'),pixels=Buffer.alloc(8*4*4,255);Buffer.from(secret).copy(pixels);const pixelKey=encodeRGBA(8,4,pixels);
 for(const bytes of [text,compressed,pixelKey]){
  const calls=[],p=provider(queueMock(calls,{image:image({width:null,height:null})}),{download:download(bytes)}),accepted=await p.submit(request());await assert.rejects(()=>p.poll(accepted.id),{code:'unknown'});assert.equal(calls.filter(call=>call.method==='POST').length,1);
  assert.throws(()=>p.prepare({...request(),inputs:[{type:'image',url:'data:image/png;base64,'+bytes.toString('base64')}]}),error=>error.providerDispatched===false);
 }
});

test('HTTP durable task loopback restores the original panorama and archives/serves the verified bytes locally',async t=>{
 const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),http=require('node:http');
 const {createDurableGenerationService}=require('../server/generation-durable.cjs');
 const {createGenerationMediaStore}=require('../server/generation-media-store.cjs');
 const {createGenerationMediaMaterializer}=require('../server/generation-media-materializer.cjs');
 const {createGenerationMediaHttp}=require('../server/generation-media-http.cjs');
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'freenow-panorama-loopback-')),calls=[];let complete=false,downloads=0,service,store,mediaHttp;
 const fetchImpl=async(url,options)=>{calls.push({url:String(url),method:options.method});return response(options.method==='POST'?{request_id:'original-pano'}:String(url).includes('/status')?{request_id:'original-pano',status:complete?'COMPLETED':'UNCONFIRMED'}:{image:image()});};
 async function open(){
  store=createGenerationMediaStore({directory:directory+'-media'});
  const materializer=createGenerationMediaMaterializer({store});
  const p=provider(fetchImpl,{download:async(...args)=>{downloads++;return download()(...args);}});
  service=createDurableGenerationService({directory,provider:p,mediaMaterializer:materializer});await service.ready;
  mediaHttp=createGenerationMediaHttp({store,ownsResource:service.ownsResource});
 }
 async function close(){await service.close();await mediaHttp.close();await store.close();}
 await open();
 const json=(res,status,value)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};
 const publicTask=value=>({id:value.id,status:value.status,...value.status==='succeeded'?{outputs:value.outputs}: {}});
 const server=http.createServer((req,res)=>{void (async()=>{
  const pathname=new URL(req.url,'http://localhost').pathname,media=pathname.match(/^\/api\/generation\/media\/([^/]+)$/);
  if(media)return mediaHttp.handle(req,res,media[1],{json});
  if(pathname==='/tasks'&&req.method==='POST'){const parts=[];for await(const part of req)parts.push(part);return json(res,202,publicTask(await service.submit(JSON.parse(Buffer.concat(parts)),{idempotencyKey:'panorama-loopback-key'})));}
  if(pathname==='/tasks/by-key')return json(res,200,publicTask(await service.lookup('panorama-loopback-key')));
  return json(res,404,{});
 })().catch(()=>json(res,500,{error:'fixture gateway failure'}));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
 t.after(async()=>{await new Promise(resolve=>server.close(resolve));await close();await fs.rm(directory,{recursive:true,force:true});await fs.rm(directory+'-media',{recursive:true,force:true});});
 const created=await fetch(base+'/tasks',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(request())});assert.equal(created.status,202);const accepted=await created.json();
 let pending;
 for(let i=0;i<50;i++){pending=await (await fetch(base+'/tasks/by-key')).json();if(pending.status==='unknown')break;await new Promise(resolve=>setTimeout(resolve,3));}
 assert.equal(pending.status,'unknown');assert.equal(pending.outputs,undefined);
 for(let i=0;i<2;i++){const value=await (await fetch(base+'/tasks/by-key')).json();assert.equal(value.status,'unknown');assert.equal(value.outputs,undefined);}
 assert.equal(calls.filter(call=>call.method==='POST').length,1);assert.equal(downloads,0);
 await close();complete=true;await open();
 const recovered=await (await fetch(base+'/tasks/by-key')).json();assert.equal(recovered.id,accepted.id);assert.equal(recovered.status,'succeeded');assert.equal(recovered.outputs.length,1);
 assert.match(recovered.outputs[0].url,/^\/api\/generation\/media\/[a-f0-9-]+$/);assert.ok(!JSON.stringify(recovered.outputs).includes('fal.media'));assert.ok(!JSON.stringify(recovered.outputs).includes('data:'));
 const local=await fetch(base+recovered.outputs[0].url);assert.equal(local.status,200);assert.equal(local.headers.get('content-type'),'image/png');assert.deepEqual(Buffer.from(await local.arrayBuffer()),png());
 assert.deepEqual(await fs.readFile(path.join(directory+'-media',recovered.outputs[0].url.split('/').at(-1)+'.bin')),png());
 assert.equal(calls.filter(call=>call.method==='POST').length,1);assert.equal(downloads,1);assert.ok(calls.slice(1).every(call=>call.url.startsWith('https://queue.fal.run/'+MODEL+'/requests/original-pano')));
});
