'use strict';
// QA-only host: actual gateway/adapter/codecs, with exact queue/CDN transport
// fixtures. It never reads supplier environment credentials or account assets.
const http=require('node:http'),fs=require('node:fs/promises'),fsSync=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const {execFileSync}=require('node:child_process'),{createRequire}=require('node:module'),{EventEmitter}=require('node:events'),{PassThrough,Readable}=require('node:stream'),{randomUUID}=require('node:crypto');
const root=path.resolve(__dirname,'../../../..'),nativeRequire=createRequire(path.join(root,'server/generation.cjs'));
const {createVideoMaskProvider}=nativeRequire('./generation-video-mask.cjs'),{createVideoMaskMediaTools}=nativeRequire('./generation-video-mask-media.cjs'),{createFalUpload}=nativeRequire('./generation-fal-upload.cjs');
const MODEL='fal-ai/wan-vace-14b/inpainting',KEY='synthetic-wan-video-mask-qa-only-key';
const ALLOWED_TYPES={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.mp4':'video/mp4','.woff2':'font/woff2','.gltf':'model/gltf+json','.glb':'model/gltf-binary'};
const CSP="default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; connect-src 'self' data: blob:; img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self' data:; worker-src 'self' blob:; frame-src 'self'; object-src 'none'; form-action 'none'; base-uri 'self'";
async function startNativeMaskServer({port=0}={}){
 if(!Number.isSafeInteger(port)||port<0||port>65535||port===4173)throw Error('Use an independent temporary port, never 4173.');
 require(path.join(root,'scripts/build-video-mask-native-fixture.cjs')).build();
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'freenow-mask-native-qa-')),ffmpeg=process.env.FFMPEG_PATH||'ffmpeg',sourceFile=path.join(directory,'source.mp4');
 execFileSync(ffmpeg,['-v','error','-nostdin','-f','lavfi','-i','testsrc2=size=320x180:rate=10:duration=10.1','-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=10.1','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-c:a','aac','-b:a','128k','-movflags','+faststart',sourceFile],{stdio:'pipe',timeout:20000});
 const source=await fs.readFile(sourceFile),tools=createVideoMaskMediaTools(),files=new Map(),tasks=new Map();
 const audit={fixture:true,externalNetwork:'blocked-by-injected-transports',source:{width:320,height:180,fps:10,numFrames:101,duration:10.1,hasAudio:true},uploadInitiations:0,uploadPuts:0,generationPosts:0,statusGets:0,resultGets:0,resultDownloads:0,requests:[]};
 const snapshot=()=>structuredClone(audit);
 const requestImpl=(url,options,callback)=>{
  const request=new EventEmitter();request.destroy=()=>{};
  request.end=body=>{void(async()=>{
   let receipt='',status=204;
   if(options.method==='POST'){
    if(String(url)!=='https://rest.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3'||options.headers.Authorization!=='Key '+KEY)throw Error('Wrong fixture CDN initialization.');
    const input=JSON.parse(String(body)),id=randomUUID();if(!['video.mp4','mask.mp4','reference.png'].includes(input.file_name))throw Error('Unexpected upload role.');
    files.set(id,{name:input.file_name,mime:input.content_type,bytes:null});audit.uploadInitiations++;
    receipt=JSON.stringify({upload_url:'https://v3.fal.media/upload/'+id,file_url:'https://v3.fal.media/file/'+id});status=200;
   }else{
    const match=/^\/upload\/([a-f0-9-]{36})$/.exec(url.pathname);if(options.method!=='PUT'||url.origin!=='https://v3.fal.media'||!match||!files.has(match[1])||Object.keys(options.headers).some(k=>k.toLowerCase()==='authorization'))throw Error('Wrong fixture upload destination.');
    const file=files.get(match[1]);if(options.headers['Content-Type']!==file.mime||body.length>90*1024*1024)throw Error('Invalid fixture upload bytes.');file.bytes=Buffer.from(body);audit.uploadPuts++;
   }
   const response=new PassThrough();response.statusCode=status;response.socket={remoteAddress:'93.184.216.34'};response.rawHeaders=[];response.headers={'content-type':'application/json','content-length':String(Buffer.byteLength(receipt))};callback(response);response.end(receipt);
  })().catch(()=>request.emit('error',Error('Isolated fixture transport rejected request.')));};
  const socket=new EventEmitter();Object.assign(socket,{encrypted:true,authorized:true,connecting:false,remoteAddress:'93.184.216.34'});queueMicrotask(()=>request.emit('socket',socket));return request;
 };
 const uploader=createFalUpload({apiKey:KEY,lookup:async()=>[{address:'93.184.216.34',family:4}],requestImpl});
 const uploaded=value=>{const url=new URL(value),match=/^\/file\/([a-f0-9-]{36})$/.exec(url.pathname),file=match&&files.get(match[1]);if(url.origin!=='https://v3.fal.media'||!file?.bytes)throw Error('Unconfirmed uploaded fixture.');return file;};
 const queueFetch=async(url,options)=>{
  const target=new URL(url);if(target.origin!=='https://queue.fal.run'||new Headers(options.headers).get('authorization')!=='Key '+KEY)throw Error('All external network is blocked.');
  if(options.method==='POST'&&target.pathname==='/'+MODEL){
   const body=JSON.parse(options.body),video=uploaded(body.video_url),mask=uploaded(body.mask_video_url),meta=await tools.inspectVideo({bytes:video.bytes,mime:video.mime});
   if(mask.mime!=='video/mp4'||body.ref_image_urls&&body.ref_image_urls.length!==1)throw Error('Incorrect fixture mask/reference contract.');if(body.ref_image_urls)uploaded(body.ref_image_urls[0]);
   const id=randomUUID(),inputFile=path.join(directory,id+'-prepared.mp4'),resultFile=path.join(directory,id+'-result.mp4');await fs.writeFile(inputFile,video.bytes,{mode:0o600});
   // Deterministic source colors are retained at actual 1280x720; this is a
   // codec/workflow fixture and deliberately does not simulate edited objects.
   execFileSync(ffmpeg,['-v','error','-nostdin','-i',inputFile,'-vf','scale=1280:720:flags=neighbor','-map','0:v:0','-an','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-fps_mode','passthrough','-movflags','+faststart',resultFile],{stdio:'pipe',timeout:20000});
   const bytes=await fs.readFile(resultFile);tasks.set(id,{bytes,metadata:{...meta,width:1280,height:720}});audit.generationPosts++;audit.requests.push({kind:body.ref_image_urls?'video.replace':'video.erase',sourceFrames:meta.numFrames,fps:meta.fps,duration:meta.duration,maskVideo:true,referenceCount:body.ref_image_urls?.length??0,matchFrames:body.match_input_num_frames,matchFps:body.match_input_frames_per_second});return Response.json({request_id:id,status:'IN_QUEUE'});
  }
  const match=/^\/fal-ai\/wan-vace-14b\/requests\/([a-f0-9-]{36})(\/status|\/cancel)?$/.exec(target.pathname),task=match&&tasks.get(match[1]);if(!task)throw Error('Unknown original fixture task.');
  if(options.method==='PUT'&&match[2]==='/cancel')return Response.json({request_id:match[1],status:'CANCELLATION_REQUESTED'},{status:202});
  if(options.method!=='GET')throw Error('Unsupported fixture method.');
  if(match[2]==='/status'){audit.statusGets++;return Response.json({request_id:match[1],status:'COMPLETED'});}
  if(match[2])throw Error('Unsupported fixture route.');audit.resultGets++;return Response.json({video:{url:'https://v3.fal.media/result/'+match[1],content_type:'video/mp4',file_size:task.bytes.length,width:task.metadata.width,height:task.metadata.height,num_frames:task.metadata.numFrames,fps:task.metadata.fps,duration:task.metadata.duration}});
 };
 const download=async(url)=>{const target=new URL(url),match=/^\/result\/([a-f0-9-]{36})$/.exec(target.pathname),task=match&&tasks.get(match[1]);if(target.origin!=='https://v3.fal.media'||!task)throw Error('No external fixture downloads.');audit.resultDownloads++;return {mime:'video/mp4',expectedBytes:task.bytes.length,stream:Readable.from([task.bytes])};};
 const filename=path.join(root,'server/generation.cjs'),module={exports:{}};
 // Trusted QA injection only; no new public config option or provider route
 // can choose a transport, filesystem path, or secret from the browser.
 vm.runInNewContext(fsSync.readFileSync(filename,'utf8'),{module,exports:module.exports,require:id=>id==='./generation-video-mask.cjs'?{createVideoMaskProvider:options=>createVideoMaskProvider({...options,uploader,mediaTools:tools,download})}:nativeRequire(id),Buffer,URL,structuredClone,fetch,AbortSignal,AbortController,Date,setTimeout,clearTimeout},{filename});
 const modelMap=Object.fromEntries(['video.erase','video.replace'].map(kind=>[kind,{kind,model:MODEL,semantics:'explicit-native-alternative'}]));
 const gateway=module.exports.createGenerationGateway({protocol:'fal-video-mask-native',apiKey:KEY,modelMap,fetchImpl:queueFetch,directory:path.join(directory,'tasks')});await gateway.ready;
 const publicFiles=new Set(execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean));publicFiles.add('qa/video-mask-native-app.html');
 const json=(res,status,value)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store','content-security-policy':CSP});res.end(JSON.stringify(value));};
 const body=async req=>{const parts=[];let size=0;for await(const chunk of req){if((size+=chunk.length)>64*1024*1024)throw Error('Fixture request too large.');parts.push(chunk);}return JSON.parse(Buffer.concat(parts));};
 async function sendFile(req,res,file,mime){const stat=await fs.stat(file);let start=0,end=stat.size-1,status=200;const range=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range??'');if(range){start=Number(range[1]);end=range[2]?Math.min(Number(range[2]),end):end;if(start>end||start>=stat.size){res.writeHead(416,{'content-range':'bytes */'+stat.size});return res.end();}status=206;}res.writeHead(status,{'content-type':mime,'content-length':end-start+1,'cache-control':'no-store','accept-ranges':'bytes','content-security-policy':CSP,...status===206?{'content-range':`bytes ${start}-${end}/${stat.size}`}:{}});if(req.method==='HEAD')return res.end();fsSync.createReadStream(file,{start,end}).on('error',()=>res.destroy()).pipe(res);}
 const server=http.createServer((req,res)=>{void(async()=>{
  const pathname=new URL(req.url,'http://127.0.0.1').pathname;
  if(pathname==='/api/generation/fixture-audit'&&req.method==='GET')return json(res,200,snapshot());
  if(pathname.startsWith('/api/generation/')){if(pathname==='/api/generation/config'&&req.method!=='GET')return json(res,403,{error:'Fixture configuration is immutable.'});return gateway.handle(req,res,pathname,{json,body});}
  if(!['GET','HEAD'].includes(req.method)||pathname.startsWith('/api/'))return json(res,403,{error:'No other API routes on this isolated host.'});
  if(pathname==='/qa/native-video-mask-source.mp4')return sendFile(req,res,sourceFile,'video/mp4');
  if(pathname==='/assets/local-resource-index.json')return json(res,200,{version:1,algorithm:'sha256-exact-utf8',entries:{}});
  const name=decodeURIComponent(pathname==='/'?'/qa/video-mask-native-app.html':pathname).replace(/^\//,''),file=path.resolve(root,name),relative=path.relative(root,file),three=relative.startsWith('node_modules/three/build/')||relative.startsWith('node_modules/three/examples/jsm/');
  if(relative.startsWith('..')||path.isAbsolute(relative)||!publicFiles.has(relative)&&!three)return json(res,404,{error:'Only public checkout files are served.'});return sendFile(req,res,file,ALLOWED_TYPES[path.extname(file)]??'application/octet-stream');
 })().catch(()=>{if(res.headersSent)res.destroy();else json(res,500,{error:'Isolated video-mask fixture request failed.'});});});
 await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));
 const close=async()=>{await new Promise(resolve=>server.close(resolve));await gateway.close();await fs.rm(directory,{recursive:true,force:true});};
 return {url:`http://127.0.0.1:${server.address().port}/qa/video-mask-native-app.html?mode=pipeline&session=unique`,audit:snapshot,close};
}
if(require.main===module)startNativeMaskServer({port:Number(process.argv[2]??0)}).then(host=>{console.log(host.url+'\nActual local codecs/gateway; synthetic source and queue/CDN fixtures; all external network blocked.');const stop=()=>{void host.close().then(()=>process.exit(0));};process.once('SIGINT',stop);process.once('SIGTERM',stop);}).catch(()=>{console.error('Unable to start isolated video-mask pipeline fixture.');process.exitCode=1;});
module.exports={startNativeMaskServer};
