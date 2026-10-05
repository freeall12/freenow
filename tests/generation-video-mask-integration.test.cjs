'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {execFileSync}=require('node:child_process'),{EventEmitter}=require('node:events'),{Readable,PassThrough}=require('node:stream');
const {createVideoMaskProvider}=require('../server/generation-video-mask.cjs');
const {createVideoMaskMediaTools}=require('../server/generation-video-mask-media.cjs');
const {createFalUpload}=require('../server/generation-fal-upload.cjs');
const {createDurableGenerationService}=require('../server/generation-durable.cjs');
const {createGenerationMediaStore}=require('../server/generation-media-store.cjs');
const {createGenerationMediaMaterializer}=require('../server/generation-media-materializer.cjs');
const {createGenerationMediaHttp}=require('../server/generation-media-http.cjs');
const {encodeRGBA}=require('../server/generation-png-alpha.cjs');
const KEY='fixture-wan-integration-only-key',MODEL='fal-ai/wan-vace-14b/inpainting';
const modelMap=Object.fromEntries(['video.erase','video.replace'].map(kind=>[kind,{kind,model:MODEL,semantics:'explicit-native-alternative'}]));
function uploadTransport(calls){return (url,options,callback)=>{
 const request=new EventEmitter();request.destroy=()=>{};request.end=body=>{
  calls.push({url:String(url),method:options.method,headers:options.headers,body:Buffer.from(body)});
  options.lookup(url.hostname,{all:true},(error,addresses)=>{assert.ifError(error);assert.deepEqual(addresses,[{address:'93.184.216.34',family:4}]);});
  const response=new PassThrough();response.socket={remoteAddress:'93.184.216.34'};response.rawHeaders=[];
  const receipt=options.method==='POST'?JSON.stringify({upload_url:'https://v3.fal.media/upload/'+JSON.parse(String(body)).file_name,file_url:'https://v3.fal.media/file/'+JSON.parse(String(body)).file_name}):'';
  response.statusCode=options.method==='POST'?200:204;response.headers={'content-type':'application/json','content-length':String(Buffer.byteLength(receipt))};callback(response);response.end(receipt);
 };
 const socket=new EventEmitter();Object.assign(socket,{remoteAddress:'93.184.216.34',encrypted:true,authorized:true,connecting:false});queueMicrotask(()=>request.emit('socket',socket));return request;
};}
for(const audio of [false,true])test(`real FFmpeg + native CDN transport + durable HTTP restart localizes exact 720p video (${audio?'original audio':'silent source'})`,{timeout:60000},async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'wan-mask-real-loopback-')),ffmpeg=process.env.FFMPEG_PATH||'ffmpeg',sourceFile=path.join(root,'source.mp4'),outputFile=path.join(root,'supplier.mp4');
 let cleanup=()=>fs.rm(root,{recursive:true,force:true});t.after(()=>cleanup());
 // A generated private test movie, never an account asset or model result.
 const sourceArgs=['-v','error','-nostdin','-f','lavfi','-i','testsrc2=size=320x180:rate=10:duration=10.1'];
 if(audio)sourceArgs.push('-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=10.1');
 sourceArgs.push('-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p');if(audio)sourceArgs.push('-c:a','aac','-b:a','128k');else sourceArgs.push('-an');sourceArgs.push('-movflags','+faststart',sourceFile);
 execFileSync(ffmpeg,sourceArgs,{stdio:'pipe',timeout:20000});
 execFileSync(ffmpeg,['-v','error','-nostdin','-f','lavfi','-i','color=c=green:size=1280x720:rate=10:duration=8.1','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-an','-movflags','+faststart',outputFile],{stdio:'pipe',timeout:20000});
 const sourceBytes=await fs.readFile(sourceFile),supplierBytes=await fs.readFile(outputFile),uploads=[],queueCalls=[];let complete=false,downloads=0;
 const tools=createVideoMaskMediaTools({maxOutputBytes:100*1024*1024});
 const reference=encodeRGBA(2,2,Buffer.alloc(16,200)),kind=audio?'video.replace':'video.erase';
 const input={kind,nodeId:'source',prompt:'',inputs:[{type:'video',role:'source_video',url:'data:video/mp4;base64,'+sourceBytes.toString('base64')},...(audio?[{type:'image',role:'replacement_image',url:'data:image/png;base64,'+reference.toString('base64')}]:[])],parameters:{action:audio?'replace':'remove',sourceClip:{start:1,end:9.1},mask:{encoding:'rle-zero-based-row-major',width:320,height:180,fps:10,frames:Array.from({length:101},(_,i)=>`${(i%100)*4} 4`)},aspectRatio:'adaptive',resolution:'720p',candidateCount:1}};
 const uploader=createFalUpload({apiKey:KEY,lookup:async()=>[{address:'93.184.216.34',family:4}],requestImpl:uploadTransport(uploads)});
 const fetchImpl=async(url,options)=>{queueCalls.push({url:String(url),method:options.method,body:options.body&&JSON.parse(options.body)});return Response.json(options.method==='POST'?{request_id:'real-local-mask-original',status:'IN_QUEUE'}:String(url).includes('/status')?{request_id:'real-local-mask-original',status:complete?'COMPLETED':'UNCONFIRMED'}:{video:{url:'https://v3.fal.media/model-output.mp4',content_type:'video/mp4',width:1280,height:720,num_frames:81,fps:10,duration:8.1,file_size:supplierBytes.length}});};
 const download=async()=>{downloads++;return {mime:'video/mp4',expectedBytes:supplierBytes.length,stream:Readable.from([supplierBytes])};};
 let service,store,mediaHttp;
 async function open(){store=createGenerationMediaStore({directory:path.join(root,'media')});await store.ready;const materializer=createGenerationMediaMaterializer({store});const provider=createVideoMaskProvider({apiKey:KEY,modelMap,directory:path.join(root,'preparation'),uploader,mediaTools:tools,fetchImpl,download});service=createDurableGenerationService({directory:path.join(root,'tasks'),provider,mediaMaterializer:materializer});await service.ready;mediaHttp=createGenerationMediaHttp({store,ownsResource:service.ownsResource});}
 async function close(){await service.close();await mediaHttp.close();await store.close();}
 await open();const json=(res,status,value)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};
 const publicTask=job=>({id:job.id,status:job.status,...job.status==='succeeded'?{outputs:job.outputs}:{}});
 const server=http.createServer((req,res)=>{void(async()=>{const pathname=new URL(req.url,'http://localhost').pathname,media=pathname.match(/^\/api\/generation\/media\/([^/]+)$/);if(media)return mediaHttp.handle(req,res,media[1],{json});if(pathname==='/tasks'&&req.method==='POST'){const parts=[];for await(const part of req)parts.push(part);return json(res,202,publicTask(await service.submit(JSON.parse(Buffer.concat(parts)),{idempotencyKey:'wan-real-loopback-key'})));}if(pathname==='/tasks/by-key')return json(res,200,publicTask(await service.lookup('wan-real-loopback-key')));json(res,404,{});})().catch(()=>json(res,500,{error:'isolated fixture error'}));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;cleanup=async()=>{await new Promise(resolve=>server.close(resolve));await close();await fs.rm(root,{recursive:true,force:true});};
 const accepted=await (await fetch(base+'/tasks',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)})).json();
 let pending;for(let i=0;i<5;i++){pending=await(await fetch(base+'/tasks/by-key')).json();if(pending.status==='unknown')break;}assert.equal(pending.status,'unknown');assert.equal(pending.outputs,undefined);
 const expectedFiles=audio?3:2;assert.equal(uploads.length,expectedFiles*2);assert.equal(queueCalls.filter(v=>v.method==='POST').length,1);assert.equal(downloads,0);
 for(const put of uploads.filter(v=>v.method==='PUT')){assert.equal(put.headers.Authorization,undefined);assert.ok(!JSON.stringify(put.headers).includes(KEY));}
 const videoUpload=uploads.find(v=>v.method==='PUT'&&v.url.endsWith('/video.mp4')),maskUpload=uploads.find(v=>v.method==='PUT'&&v.url.endsWith('/mask.mp4'));
 const sourceMeta=await tools.inspectVideo({bytes:videoUpload.body,mime:'video/mp4'}),maskMeta=await tools.inspectVideo({bytes:maskUpload.body,mime:'video/mp4'});assert.equal(sourceMeta.numFrames,81);assert.equal(maskMeta.numFrames,81);assert.deepEqual(sourceMeta.pts,maskMeta.pts);assert.equal(sourceMeta.hasAudio,false);assert.equal(sourceMeta.duration,8.1);
 const native=queueCalls.find(v=>v.method==='POST').body;assert.equal(native.video_url,'https://v3.fal.media/file/video.mp4');assert.equal(native.mask_video_url,'https://v3.fal.media/file/mask.mp4');assert.equal(native.match_input_frames_per_second,true);assert.equal(native.match_input_num_frames,true);assert.equal(native.ref_image_urls?.length,audio?1:undefined);
 await close();complete=true;await open();const recovered=await(await fetch(base+'/tasks/by-key')).json();assert.equal(recovered.id,accepted.id);assert.equal(recovered.status,'succeeded');assert.match(recovered.outputs[0].url,/^\/api\/generation\/media\/[a-f0-9-]+$/);assert.ok(!JSON.stringify(recovered).includes('fal.media'));
 const response=await fetch(base+recovered.outputs[0].url);assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'video/mp4');const localized=Buffer.from(await response.arrayBuffer()),actual=await tools.inspectVideo({bytes:localized,mime:'video/mp4'});assert.equal(actual.width,1280);assert.equal(actual.height,720);assert.equal(actual.numFrames,81);assert.equal(actual.fps,10);assert.equal(actual.duration,8.1);assert.equal(actual.hasAudio,audio);assert.deepEqual(recovered.outputs[0].sourceRange,{start:1,end:9.1});
 const same=await(await fetch(base+'/tasks/by-key')).json();assert.equal(same.status,'succeeded');assert.equal(uploads.length,expectedFiles*2);assert.equal(queueCalls.filter(v=>v.method==='POST').length,1);assert.equal(downloads,1);
});
