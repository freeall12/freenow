'use strict';
// Production gateway and canvas with isolated, explicitly synthetic HTTP media.
// No environment file, personal credential or paid supplier is read or called.
const http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{execFileSync}=require('node:child_process');
const {createGenerationGateway}=require('../server/generation.cjs'),{createGenerationMediaDownloader}=require('../server/generation-media-download.cjs');
const validator=createGenerationMediaDownloader(),root=path.resolve(__dirname,'..');
const fixtureKey='local-sonilo-contract-fixture-key',audit=[],gateways={};
let upstreamBase,gateway,server,upstream,closing=false;
const log=value=>{audit.push({at:new Date().toISOString(),...value});if(audit.length>300)audit.shift();};
const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
const listen=listener=>new Promise((resolve,reject)=>{listener.once('error',reject);listener.listen(0,'127.0.0.1',()=>resolve(listener.address().port));});
const bytesBody=async req=>{const chunks=[];let bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>64*1024*1024)throw Error('Bounded fixture body');chunks.push(chunk);}return Buffer.concat(chunks);};
const body=async req=>JSON.parse((await bytesBody(req)).toString('utf8')||'{}');
function wave(seconds){
 const rate=16000,samples=Math.round(rate*seconds),bytes=Buffer.alloc(44+samples*2);bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);bytes.writeUInt32LE(rate,24);bytes.writeUInt32LE(rate*2,28);bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(samples*2,40);
 for(let i=0;i<samples;i++){const edge=Math.min(1,i/800,(samples-i)/800);bytes.writeInt16LE(Math.round(Math.sin(i*2*Math.PI*440/rate)*4000*edge),44+i*2);}return bytes;
}
async function close(){if(closing)return;closing=true;server?.closeAllConnections();upstream?.closeAllConnections();server?.close();upstream?.close();for(const value of Object.values(gateways))await value.close();}
(async()=>{
 const video=await fs.readFile(path.join(root,'qa/trim-scenes.mp4'));
 const probed=JSON.parse(execFileSync('ffprobe',['-v','error','-show_entries','format=duration','-show_entries','stream=codec_type,width,height,duration','-of','json',path.join(root,'qa/trim-scenes.mp4')],{encoding:'utf8',timeout:10000}));
 const duration=Number(probed.format?.duration),stream=probed.streams?.find(value=>value.codec_type==='video');if(!stream||!Number.isFinite(duration)||duration<5||duration>360)throw Error('Video fixture duration unavailable');
 const audio=wave(duration),directory=await fs.mkdtemp(path.join(os.tmpdir(),'sonilo-sfx-browser-')),tasks=new Map();let counter=0,mode='ready';
 const mapping={'sonilo-sfx':{kind:'audio.generate',model:'sonilo-sfx'}};
 upstream=http.createServer(async(req,res)=>{try{
  const url=new URL(req.url,'http://fixture');
  if(url.pathname.startsWith('/fixture-audio/')){
   const task=tasks.get(url.pathname.split('/')[2]);if(!task||req.headers.authorization)return json(res,403,{error:'No API auth allowed on media'});
   log({source:'fixture-cdn',method:req.method,bytes:task.audio.length,authorizationPresent:false});res.writeHead(200,{'Content-Type':'audio/wav','Content-Length':task.audio.length});return res.end(task.audio);
  }
  if(req.headers.authorization!=='Bearer '+fixtureKey)return json(res,401,{error:'Fixture authentication mismatch'});
  if(['/v1/video-to-sfx','/v1/text-to-sfx'].includes(url.pathname)&&req.method==='POST'){
   const bytes=await bytesBody(req),form=await new Request('http://fixture',{method:'POST',headers:{'Content-Type':req.headers['content-type']},body:bytes}).formData();
   const isVideo=url.pathname==='/v1/video-to-sfx',files=form.getAll('video'),count=1,seconds=isVideo?duration:Number(form.get('duration'));
   if(form.get('audio_format')!=='wav'||isVideo&&files.length!==1||!isVideo&&files.length||[...form.keys()].some(key=>!['audio_format','video','duration','prompt','segments'].includes(key)))return json(res,400,{error:'Fixture wire mismatch'});
   if(isVideo&&!(Buffer.from(await files[0].arrayBuffer()).equals(video)))return json(res,400,{error:'Source MP4 bytes changed'});
   const segments=form.has('segments')?JSON.parse(form.get('segments')):undefined,id='fixture-sonilo-'+(++counter);tasks.set(id,{audio:wave(seconds),count,seconds,type:isVideo?'video_to_sfx':'text_to_sfx',reads:0});
   log({source:'fixture-upstream',protocol:'sonilo-native',method:'POST',path:url.pathname,taskId:id,inputVideo:isVideo,inputBytes:isVideo?video.length:0,videoFileCount:files.length,originalBytesEqual:isVideo?true:undefined,promptLength:(form.get('prompt')||'').length,sourceDuration:seconds,count,segments});
   return json(res,202,{task_id:id,status:'processing'});
  }
  const match=url.pathname.match(/^\/v1\/tasks\/(fixture-sonilo-\d+)$/);
  if(match&&tasks.has(match[1])&&req.method==='GET'){
   const task=tasks.get(match[1]);log({source:'fixture-upstream',protocol:'sonilo-native',method:'GET',path:url.pathname,taskId:match[1]});
   if(++task.reads===1)return json(res,200,{task_id:match[1],type:task.type,status:'processing'});
   return json(res,200,{task_id:match[1],type:task.type,status:'succeeded',duration_seconds:task.seconds,audio:{url:'https://fixture-sonilo.invalid/fixture-audio/'+match[1]+'/0.wav',content_type:'audio/wav',file_size:task.audio.length}});
  }
  return json(res,404,{error:'Fixture route unavailable'});
 }catch{return json(res,400,{error:'Fixture request invalid'});}});
 const upstreamPort=await listen(upstream);upstreamBase=`http://127.0.0.1:${upstreamPort}`;
 const options=name=>({directory:path.join(directory,name,'tasks'),mediaDirectory:path.join(directory,name,'media'),providers:{sonilo:{protocol:'sonilo-native',apiKey:name==='unconfigured'?'':fixtureKey,modelMap:mapping}},routes:{'audio.generate':{models:name==='unmapped'?{}:{'sonilo-sfx':'sonilo'}}},fetchImpl:(url,settings)=>{const parsed=new URL(url);if(parsed.origin!=='https://api.sonilo.com'||!parsed.pathname.startsWith('/v1/'))throw Error('Unknown fixture API identity');return fetch(upstreamBase+parsed.pathname,{...settings,redirect:'error'});},soniloDownloadImpl:async(url,context)=>{const parsed=new URL(url);if(parsed.origin!=='https://fixture-sonilo.invalid'||!parsed.pathname.startsWith('/fixture-audio/'))throw Error('Unknown fixture media identity');const response=await fetch(upstreamBase+parsed.pathname,{signal:context.signal,redirect:'error'});if(!response.ok)throw Error('Fixture media unavailable');const bytes=Buffer.from(await response.arrayBuffer());return validator.download('data:audio/wav;base64,'+bytes.toString('base64'),context);}});
 for(const name of ['ready','unconfigured','unmapped']){gateways[name]=createGenerationGateway(options(name));await gateways[name].ready;}
 gateway=gateways.ready;
 server=http.createServer(async(req,res)=>{try{
  const host=req.headers.host,port=server.address().port;if(![`127.0.0.1:${port}`,`localhost:${port}`].includes(host)||req.headers.origin&&req.headers.origin!=='http://'+host)return json(res,403,{error:'Same-origin loopback only'});
  const pathname=decodeURIComponent(new URL(req.url,'http://'+host).pathname);if(pathname.startsWith('/api/'))log({source:'browser',method:req.method,path:pathname});
  if(pathname==='/api/qa/sonilo-sfx-audit')return json(res,200,{fixture:true,realSupplier:false,fixtureDownloadSeam:true,directory,mode,video:{path:'/qa/trim-scenes.mp4',bytes:video.length,duration,width:stream.width,height:stream.height},audio:{fixedTone:true,format:'PCM16 WAV',duration,bytes:audio.length},tasksAccepted:counter,audit});
  if(pathname==='/api/qa/sonilo-sfx-mode'&&req.method==='POST'){const value=await body(req);if(!Object.hasOwn(gateways,value.mode))return json(res,400,{error:'Invalid mode'});mode=value.mode;gateway=gateways[mode];log({source:'fixture-mode',mode});return json(res,200,{mode});}
  if(pathname==='/api/qa/sonilo-sfx-restart'&&req.method==='POST'){await gateway.close();gateways[mode]=createGenerationGateway(options(mode));gateway=gateways[mode];await gateway.ready;log({source:'fixture-restart',mode,tasksAccepted:counter});return json(res,200,{reopened:true,tasksAccepted:counter});}
  if(pathname==='/api/generation/config'&&req.method!=='GET')return json(res,405,{error:'Fixture configuration is fixed'});
  if(pathname.startsWith('/api/generation/voices'))return json(res,200,{configured:false,voices:[],missing:['VOICE_CATALOG_NOT_CONFIGURED']});
  if(pathname.startsWith('/api/generation/'))return gateway.handle(req,res,pathname,{json,body});
  if(pathname==='/api/agent/config')return json(res,200,{configured:false,missing:['OPENAI_API_KEY','OPENAI_MODEL'],configurationError:null});
  if(pathname.startsWith('/api/'))return json(res,503,{configured:false,code:'configuration_required',error:'仅接Sonilo SFX原生音效HTTP合同fixture'});
  const relative=pathname==='/'?'index.html':pathname.replace(/^\/+/, '');if(!['GET','HEAD'].includes(req.method)||relative.split('/').some(value=>value==='..'||value.startsWith('.'))||['server/','tests/','scripts/'].some(prefix=>relative.startsWith(prefix))||relative.startsWith('node_modules/')&&!relative.startsWith('node_modules/three/'))return json(res,403,{error:'Not fixture public source'});
  const file=path.resolve(root,relative);if(!file.startsWith(root+path.sep))return json(res,403,{error:'Invalid public source'});let content=await fs.readFile(file);
  if(relative==='index.html'){
   let html=content.toString('utf8');for(const name of ['canvas-data','editor-data','sidebar-data','versions-data'])html=html.replace(new RegExp('src="'+name+'\\.js[^\"]*"'),'src="defaults/'+name+'.js"');
   html=html.replace('<script src="defaults/canvas-data.js"></script>','<script src="defaults/canvas-data.js"></script><script>window.CANVAS_DATA.nodes=[];window.CANVAS_DATA.edges=[];</script>');
   content=Buffer.from(html.replace(/<title>[^<]*<\/title>/,'<title>Sonilo SFX视频拟音HTTP合同fixture · 固定音频非模型效果</title>').replace('</body>','<script type="module" src="/src/features/audio-generation/qa/native-sonilo-sfx.mjs"></script></body>'));
  }
  const mime={'.js':'text/javascript','.mjs':'text/javascript','.html':'text/html; charset=utf-8','.css':'text/css','.json':'application/json','.mp4':'video/mp4','.wav':'audio/wav','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.woff2':'font/woff2','.glb':'model/gltf-binary','.wasm':'application/wasm'};
  res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Content-Length':content.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; connect-src 'self' data: blob:; img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self' data: blob:; worker-src 'self' blob:; frame-src 'self' blob:; object-src 'none'; base-uri 'self'"});res.end(req.method==='HEAD'?undefined:content);
 }catch{if(!res.headersSent)json(res,404,{error:'Fixture resource unavailable'});else res.end();}});
 const port=await listen(server);console.log(JSON.stringify({fixture:true,realSupplier:false,url:`http://127.0.0.1:${port}/`,audit:`http://127.0.0.1:${port}/api/qa/sonilo-sfx-audit`,upstreamPort,directory,sourceDuration:duration,fixedTone:true}));
 for(const event of ['SIGTERM','SIGINT'])process.once(event,()=>void close());
})().catch(async()=>{console.error('Sonilo SFX native HTTP fixture could not start');await close();process.exitCode=1;});
