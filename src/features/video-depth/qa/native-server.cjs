'use strict';
// Isolated QA runs the production gateway, adapter, codecs and media archive.
// Only queue/download boundaries return deterministic local contract media.
const http=require('node:http'),fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {execFileSync}=require('node:child_process'),{randomUUID,createHash}=require('node:crypto');
const root=path.resolve(__dirname,'../../../..'),{createGenerationGateway}=require(path.join(root,'server/generation.cjs'));
const {MODEL,ALIAS}=require(path.join(root,'server/generation-video-depth.cjs'));
const KEY='synthetic-depth-native-qa-only-key',CDN_ORIGIN='https://depth-fixture.example.test';
const ENTRY='/src/features/video-depth/qa/main.html';
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.mp4':'video/mp4','.woff2':'font/woff2','.glb':'model/gltf-binary'};
const CSP="default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; connect-src 'self' data: blob:; img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self' data:; worker-src 'self' blob:; frame-src 'self'; object-src 'none'; form-action 'none'; base-uri 'self'";
async function startNativeDepthServer({port=0,session='depth-native-1005-pipeline'}={}){
 if(!Number.isSafeInteger(port)||port<0||port>65535||port===4173||typeof session!=='string'||!/^depth-native-[A-Za-z0-9_-]{1,100}$/.test(session))throw Error('Use an independent QA port and depth-native session.');
 const directory=await fsp.mkdtemp(path.join(os.tmpdir(),'freenow-depth-native-qa-')),result=await fsp.readFile(path.join(__dirname,'media/depth-contract.mp4'));
 const tasks=new Map(),heldUnknown=new Set();let armUnknown=false,gateway,server,closed=false;
 const audit={fixture:true,session,externalNetwork:'blocked-by-injected-transports',supplierPosts:0,statusGets:0,resultGets:0,resultDownloads:0,requests:[],queriedIds:[],downloadedIds:[],syntheticOutput:{width:64,height:48,duration:2,fps:20,numFrames:40,bytes:result.length,sha256:createHash('sha256').update(result).digest('hex'),notVendorEffect:true,meaning:'FFmpeg grayscale fixture; not depth inference'}};
 const snapshot=()=>({...structuredClone(audit),heldUnknown:heldUnknown.size});
 const fetchImpl=async(url,options={})=>{
  const target=new URL(String(url));
  if(target.origin!=='https://queue.fal.run'||target.hash||new Headers(options.headers).get('authorization')!=='Key '+KEY||options.redirect!=='error')throw Error('All undeclared outbound requests are blocked by local fixture.');
  if(options.method==='POST'&&target.pathname==='/'+MODEL&&!target.search){
   const body=JSON.parse(options.body),keys=['video_url','model','colormap','resolution','max_frames','output_fps','side_by_side','include_raw_depths'];
   if(Object.keys(body).sort().join(',')!==keys.sort().join(',')||!/^data:video\/mp4;base64,[A-Za-z0-9+/]+={0,2}$/.test(body.video_url)||body.model!=='VDA-Large'||body.colormap!=='grayscale'||body.resolution!=='auto'||body.max_frames!==40||body.output_fps!==null||body.side_by_side!==false||body.include_raw_depths!==false)throw Error('Unexpected real native depth wire contract.');
   const bytes=Buffer.from(body.video_url.split(',')[1],'base64'),id=randomUUID();tasks.set(id,true);audit.supplierPosts++;
   audit.requests.push({id,model:body.model,colormap:body.colormap,resolution:body.resolution,maxFrames:body.max_frames,outputFps:body.output_fps,sideBySide:body.side_by_side,includeRawDepths:body.include_raw_depths,input:{mime:'video/mp4',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}});
   if(armUnknown){armUnknown=false;heldUnknown.add(id);}return Response.json({request_id:id,status:'IN_QUEUE'});
  }
  const prefix='/'+MODEL+'/requests/',rest=target.pathname.startsWith(prefix)?target.pathname.slice(prefix.length):'',match=/^([a-f0-9-]{36})(\/status|\/cancel)?$/.exec(rest),id=match?.[1];
  if(!id||!tasks.has(id))throw Error('Unknown original local fixture task.');
  if(options.method==='PUT'&&match[2]==='/cancel'&&!target.search)return Response.json({request_id:id,status:'CANCELLATION_REQUESTED'},{status:202});
  if(options.method!=='GET')throw Error('Unsupported local fixture method.');
  audit.queriedIds.push(id);
  if(match[2]==='/status'&&target.search==='?logs=0'){audit.statusGets++;if(heldUnknown.has(id))throw Error('Original fixture status unavailable until release.');return Response.json({request_id:id,status:'COMPLETED'});}
  if(match[2]||target.search)throw Error('Unsupported local fixture queue route.');audit.resultGets++;
  return Response.json({request_id:id,video:{url:CDN_ORIGIN+'/result/'+id+'.mp4',content_type:'video/mp4',file_size:result.length},raw_depths:null});
 };
 const videoDepthDownloadImpl=async(url,{kind,signal}={})=>{
  const target=new URL(String(url)),match=/^\/result\/([a-f0-9-]{36})\.mp4$/.exec(target.pathname),id=match?.[1];
  if(target.origin!==CDN_ORIGIN||target.search||target.hash||!id||!tasks.has(id)||kind!=='video'||signal?.aborted)throw Error('No external media download exists on this fixture host.');
  audit.resultDownloads++;audit.downloadedIds.push(id);return {mime:'video/mp4',expectedBytes:result.length,stream:(async function*(){yield result;})(),close(){}};
 };
 const publicFiles=new Set(execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean));
 const json=(res,status,value)=>{res.writeHead(status,{'content-type':MIME['.json'],'cache-control':'no-store','content-security-policy':CSP});res.end(JSON.stringify(value));};
 const body=async req=>{let size=0;const parts=[];for await(const chunk of req){if((size+=chunk.length)>64*1024*1024)throw Error('QA request exceeds budget.');parts.push(chunk);}return JSON.parse(Buffer.concat(parts));};
 async function sendFile(req,res,file,mime){
  const stat=await fsp.stat(file);if(!stat.isFile())return json(res,404,{error:'Public file only.'});let start=0,end=stat.size-1,status=200;
  if(req.headers.range){const range=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range);if(!range)return json(res,416,{error:'Only a single range is supported.'});start=Number(range[1]);end=range[2]?Math.min(Number(range[2]),end):end;if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=stat.size){res.writeHead(416,{'content-range':'bytes */'+stat.size});return res.end();}status=206;}
  res.writeHead(status,{'content-type':mime,'content-length':end-start+1,'cache-control':'no-store','accept-ranges':'bytes','content-security-policy':CSP,...status===206?{'content-range':`bytes ${start}-${end}/${stat.size}`}:{}});if(req.method==='HEAD')return res.end();fs.createReadStream(file,{start,end}).on('error',()=>res.destroy()).pipe(res);
 }
 async function close(){if(closed)return;closed=true;if(server?.listening){server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));}await gateway?.close();await fsp.rm(directory,{recursive:true,force:true});}
 try{
  gateway=createGenerationGateway({providers:{depth:{protocol:'fal-video-depth-native',apiKey:KEY,modelMap:{[ALIAS]:{kind:'video.depth',model:MODEL}}}},routes:{'video.depth':'depth'},fetchImpl,videoDepthDownloadImpl,directory:path.join(directory,'tasks')});await gateway.ready;
  server=http.createServer((req,res)=>{void(async()=>{
   const pathname=new URL(req.url,'http://127.0.0.1').pathname;
   if(pathname==='/api/generation/fixture-audit'&&req.method==='GET')return json(res,200,{...snapshot(),archiveEntries:(await fsp.readdir(path.join(directory,'tasks'))).length});
   if(pathname==='/api/generation/fixture-control'&&req.method==='POST'){const value=await body(req);if(!value||Object.keys(value).some(key=>key!=='mode')||!['unknown','release'].includes(value.mode))return json(res,400,{error:'Only explicit unknown/release fixture controls are supported.'});if(value.mode==='unknown')armUnknown=true;else heldUnknown.clear();return json(res,200,{armed:armUnknown,heldUnknown:heldUnknown.size});}
   if(pathname.startsWith('/api/generation/')){if(pathname==='/api/generation/config'&&req.method!=='GET')return json(res,403,{error:'Isolated fixture configuration is immutable.'});return gateway.handle(req,res,pathname,{json,body});}
   if(!['GET','HEAD'].includes(req.method)||pathname.startsWith('/api/'))return json(res,403,{error:'No other API routes on this isolated host.'});
   if(pathname==='/'){res.writeHead(302,{location:ENTRY+'?mode=pipeline&session='+encodeURIComponent(session),'cache-control':'no-store'});return res.end();}
   if(pathname==='/assets/local-resource-index.json')return json(res,200,{version:1,algorithm:'sha256-exact-utf8',entries:{}});
   const name=decodeURIComponent(pathname).replace(/^\//,''),file=path.resolve(root,name),relative=path.relative(root,file),extension=path.extname(relative),three=relative.startsWith('node_modules/three/build/')||relative.startsWith('node_modules/three/examples/jsm/'),qa=relative.startsWith('src/features/video-depth/qa/')||relative==='qa/video-depth-native-app.html';
   if(relative.startsWith('..')||path.isAbsolute(relative)||!MIME[extension]||!publicFiles.has(relative)&&!three&&!qa||['canvas-data.js','editor-data.js','sidebar-data.js','versions-data.js'].includes(relative))return json(res,404,{error:'Only public checkout files are served.'});
   return sendFile(req,res,file,MIME[extension]);
  })().catch(()=>{if(res.headersSent)res.destroy();else json(res,500,{error:'Isolated video-depth fixture request failed.'});});});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  const origin='http://127.0.0.1:'+server.address().port;return {url:origin+ENTRY+'?mode=pipeline&session='+encodeURIComponent(session),origin,session,audit:snapshot,close};
 }catch(error){await close();throw error;}
}
if(require.main===module)startNativeDepthServer({port:Number(process.argv[2]??0)}).then(host=>{console.log(host.url);console.log('PID '+process.pid+'; production gateway/codecs/archive with local queue and grayscale fixtures; no external transport.');let stopping=false;for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{if(stopping)return;stopping=true;void host.close().then(()=>process.exit(0));});}).catch(()=>{console.error('Unable to start isolated video-depth pipeline fixture.');process.exitCode=1;});
module.exports={startNativeDepthServer};
