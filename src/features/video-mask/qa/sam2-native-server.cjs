'use strict';

// Isolated native host. The only simulated layer is sam2-fixture's explicit
// cloud fetch/downloader boundary; browser HTTP, store and FFmpeg are real.
const http=require('node:http'),fs=require('node:fs/promises'),fsSync=require('node:fs'),path=require('node:path'),os=require('node:os');
const {execFileSync}=require('node:child_process'),{createHash}=require('node:crypto');
const root=path.resolve(__dirname,'../../../..');
const {createVideoSegmentationService}=require(path.join(root,'server/video-segmentation.cjs'));
const {createGenerationStore}=require(path.join(root,'server/generation-store.cjs'));
const {createVideoSegmentationMediaTools}=require(path.join(root,'server/video-segmentation-media.cjs'));
const {isPublicStaticPath}=require(path.join(root,'server/static-public-path.cjs'));
const {createSam2Fixture}=require('./sam2-fixture.cjs');
const CSP="default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; connect-src 'self' data: blob:; img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self' data:; worker-src 'self' blob:; frame-src 'self'; object-src 'none'; form-action 'none'; base-uri 'self'";
const TYPES={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.mp4':'video/mp4','.woff2':'font/woff2','.gltf':'model/gltf+json','.glb':'model/gltf-binary'};
const hash=value=>createHash('sha256').update(value).digest('hex');
async function startSam2NativeServer({port=0,mode='success',ffmpegPath='ffmpeg',ffprobePath='ffprobe',directory:existingDirectory}={}){
 if(!Number.isSafeInteger(port)||port<0||port>65535||port===4173)throw Error('Use a dynamic independent loopback port, never 4173.');
 if(existingDirectory!==undefined&&(!path.isAbsolute(existingDirectory)||path.dirname(existingDirectory)!==os.tmpdir().replace(/\/$/,'')||!path.basename(existingDirectory).startsWith('freenow-sam2-native-qa-')))throw Error('Only an existing isolated QA temp directory can be reused.');
 const directory=existingDirectory??await fs.mkdtemp(path.join(os.tmpdir(),'freenow-sam2-native-qa-'));await fs.mkdir(directory,{recursive:true,mode:0o700});await fs.chmod(directory,0o700);
 const checkpoint=await fs.readFile(path.join(directory,'qa-audit-checkpoint.json'),'utf8').catch(error=>{if(error.code==='ENOENT')return null;throw error;}),history=checkpoint?JSON.parse(checkpoint):undefined;
 const fixture=await createSam2Fixture({directory,ffmpegPath,ffprobePath,mode,history}),tasksDirectory=path.join(directory,'private-tasks');
 let service,restarting=false,closed=false;const httpAudit={taskPosts:0,taskGets:0,resumePosts:0,cancelPosts:0,restarts:0,...history?.browserHTTP};
 async function initialize(){const store=createGenerationStore({directory:tasksDirectory});service=createVideoSegmentationService({protocol:'replicate-sam2-native',replicateApiToken:fixture.apiKey,directory:tasksDirectory,store,mediaTools:createVideoSegmentationMediaTools({ffmpegPath,ffprobePath}),fetchImpl:fixture.fetchImpl,downloader:fixture.downloader});await service.ready;}
 await initialize();
 const json=(res,status,value)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store','content-security-policy':CSP});res.end(JSON.stringify(value));};
 const body=async(req,maxBytes=1024)=>{const parts=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>maxBytes)throw Error('Fixture body budget exceeded.');parts.push(chunk);}return JSON.parse(Buffer.concat(parts).toString('utf8'));};
 async function auditSnapshot(){
  const records=[];for(const name of await fs.readdir(tasksDirectory)){if(!/^[a-f0-9-]{36}\.json$/.test(name))continue;const task=JSON.parse(await fs.readFile(path.join(tasksDirectory,name),'utf8'));records.push({id:task.id,status:task.status,code:task.code,prompt:task.prompt?{frameIndex:task.prompt.frameIndex,time:task.prompt.time,pts:task.prompt.pts}:null,source:task.source?{width:task.source.width,height:task.source.height,fps:task.source.fps,numFrames:task.source.numFrames,sha256:task.source.sha256}:null,branches:task.branches.map(b=>({direction:b.direction,status:b.status,predictionId:b.predictionId??null,numFrames:b.numFrames,sourceIndices:b.sourceIndices,firstFrameSha256:b.firstFrameSha256,sha256:b.sha256,downloadedFrames:b.archives.length,remoteCancellation:b.remoteCancellation??null})),mask:task.mask?{encoding:task.mask.encoding,width:task.mask.width,height:task.mask.height,fps:task.mask.fps,numFrames:task.mask.frames.length,rleSha256:hash(JSON.stringify(task.mask.frames)),selectedRle:[0,25,49].map(frameIndex=>({frameIndex,rle:task.mask.frames[frameIndex]}))}:null});}
  return {...fixture.snapshot(),browserHTTP:structuredClone(httpAudit),privateStore:{real:true,persistentAcrossBrowserReload:true,records},modes:fixture.modes};
 }
 async function sendFile(req,res,file,mime){const stat=await fs.stat(file);let start=0,end=stat.size-1,status=200;const range=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range??'');if(range){start=Number(range[1]);end=range[2]?Math.min(Number(range[2]),end):end;if(start>end||start>=stat.size){res.writeHead(416,{'content-range':'bytes */'+stat.size});return res.end();}status=206;}res.writeHead(status,{'content-type':mime,'content-length':end-start+1,'accept-ranges':'bytes','cache-control':'no-store','content-security-policy':CSP,...status===206?{'content-range':`bytes ${start}-${end}/${stat.size}`}:{}});if(req.method==='HEAD')return res.end();fsSync.createReadStream(file,{start,end}).on('error',()=>res.destroy()).pipe(res);}
 const publicFiles=new Set(execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean));
 // The sibling frontend owner may finish these after the host starts.
 for(const name of ['segmentation-app.html','segmentation-app.mjs','segmentation-controls.mjs','segmentation-fixture.js'])publicFiles.add('src/features/video-mask/qa/'+name);
 const server=http.createServer((req,res)=>{void(async()=>{
  const pathname=new URL(req.url,'http://127.0.0.1').pathname;
  if(pathname==='/qa/sam2-audit'&&req.method==='GET')return json(res,200,await auditSnapshot());
  if(pathname==='/qa/sam2-mode'&&req.method==='POST'){const value=await body(req);if(Object.keys(value).join(',')!=='mode')return json(res,400,{error:'Expected mode only.'});fixture.setMode(value.mode);return json(res,200,await auditSnapshot());}
  if(pathname==='/qa/sam2-restart'&&req.method==='POST'){const value=await body(req);if(Object.keys(value).length||restarting)return json(res,409,{error:'Restart expects {} and no concurrent restart.'});restarting=true;try{await service.close();await initialize();httpAudit.restarts++;return json(res,200,await auditSnapshot());}finally{restarting=false;}}
  if(pathname.startsWith('/api/video-segmentation/')){
   if(restarting)return json(res,503,{error:'Local fixture restarting.'});
   if(pathname==='/api/video-segmentation/tasks'&&req.method==='POST')httpAudit.taskPosts++;
   if(/^\/api\/video-segmentation\/tasks\/[a-f0-9-]+$/.test(pathname)&&req.method==='GET')httpAudit.taskGets++;
   if(pathname.endsWith('/resume')&&req.method==='POST')httpAudit.resumePosts++;
   if(pathname.endsWith('/cancel')&&req.method==='POST')httpAudit.cancelPosts++;
   return service.handle(req,res,pathname,{json,body});
  }
  if(pathname==='/api/generation/config'&&req.method==='GET')return json(res,200,{configured:false,missing:['QA_GENERATION_DISABLED'],configurationError:null,protocol:null,availabilityVerified:false});
  if(!['GET','HEAD'].includes(req.method)||pathname.startsWith('/api/'))return json(res,403,{error:'Only native segmentation is enabled on this isolated host.'});
  if(['/qa/sam2-source.mp4','/qa/trim-scenes.mp4'].includes(pathname))return sendFile(req,res,fixture.sourceFile,'video/mp4');
  if(pathname==='/assets/local-resource-index.json')return json(res,200,{version:1,algorithm:'sha256-exact-utf8',entries:{}});
  const name=decodeURIComponent(pathname==='/'?'/src/features/video-mask/qa/segmentation-app.html':pathname).replace(/^\//,''),file=path.resolve(root,name),relative=path.relative(root,file);
  if(path.isAbsolute(relative)||!isPublicStaticPath(relative)||path.extname(relative)==='.cjs'||!publicFiles.has(relative)&&!relative.startsWith('node_modules/three/'))return json(res,404,{error:'Only public checkout static files are served.'});
  const real=await fs.realpath(file),realRelative=path.relative(root,real);if(!isPublicStaticPath(realRelative)||path.isAbsolute(realRelative))return json(res,404,{error:'Static symlink target is not public.'});
  return sendFile(req,res,real,TYPES[path.extname(file)]??'application/octet-stream');
 })().catch(()=>{if(res.headersSent)res.destroy();else json(res,500,{error:'Isolated SAM2 fixture request failed.'});});});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
 const origin=`http://127.0.0.1:${server.address().port}`;fixture.setOrigin(origin);
 async function close(){if(closed)return;closed=true;await service.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await fs.rm(directory,{recursive:true,force:true});}
 return {url:origin+'/src/features/video-mask/qa/segmentation-app.html?mode=native&session=sam2-native',origin,directory,audit:auditSnapshot,close};
}
if(require.main===module)startSam2NativeServer({port:Number(process.argv[2]??0),mode:process.argv[3]??'success',...process.argv[4]?{directory:process.argv[4]}:{}}).then(host=>{console.log(host.url+'\n'+host.origin+'/qa/sam2-audit\nNative HTTP/store/FFmpeg; explicit synthetic supplier boundary; no external network fallback.');const stop=()=>{void host.close().then(()=>process.exit(0));};process.once('SIGINT',stop);process.once('SIGTERM',stop);}).catch(error=>{console.error('Unable to start isolated SAM2 native fixture:',error.message);process.exitCode=1;});
module.exports={startSam2NativeServer};
