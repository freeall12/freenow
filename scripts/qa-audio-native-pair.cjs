'use strict';
// Production canvas/gateway, isolated loopback fixture. Never reads user keys.
const http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const murekaModule=require('../server/generation-mureka.cjs'),{createGenerationMediaDownloader}=require('../server/generation-media-download.cjs');
const originalMurekaFactory=murekaModule.createMurekaProvider,mediaValidator=createGenerationMediaDownloader();
// QA-only trusted CDN seam: fixed HTTPS result identity is served through real
// loopback HTTP, then validated by the production downloader and native adapter.
// Production modules and their DNS/peer policy are not changed. No user keys.
let upstreamBase;
murekaModule.createMurekaProvider=options=>originalMurekaFactory({...options,download:async(url,context)=>{if(url!=='https://fixture-mureka.invalid/tone.mp3')throw Error('Unknown fixture media');const response=await fetch(upstreamBase+'/fixture-tone.mp3',{signal:context.signal,redirect:'error'});if(!response.ok)throw Error('Fixture media unavailable');const bytes=Buffer.from(await response.arrayBuffer());return mediaValidator.download('data:audio/mpeg;base64,'+bytes.toString('base64'),context);}});
const {createGenerationGateway}=require('../server/generation.cjs');
const root=path.resolve(__dirname,'..'),key='explicit-audio-native-pair-local-fixture-key',audit=[];
let gateway,server,upstream;
const log=value=>{audit.push({at:new Date().toISOString(),...value});if(audit.length>200)audit.shift();};
const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
const listen=listener=>new Promise(resolve=>listener.listen(0,'127.0.0.1',()=>resolve(listener.address().port)));
const body=async req=>{const chunks=[];let count=0;for await(const chunk of req){count+=chunk.length;if(count>65536)throw Error('Bounded fixture request');chunks.push(chunk);}return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');};
(async()=>{
 const bytes=await fs.readFile(path.join(root,'tests/fixtures/elevenlabs-tone-44100.mp3')),directory=await fs.mkdtemp(path.join(os.tmpdir(),'audio-native-pair-native-browser-'));
 const ogg=await fs.readFile(path.join(root,'tests/fixtures/seed-tone-48000.ogg')),tasks=new Map();let counter=0;
 function wave(rate){const samples=Math.round(rate*.12),audio=Buffer.alloc(44+samples*2);audio.write('RIFF');audio.writeUInt32LE(audio.length-8,4);audio.write('WAVEfmt ',8);audio.writeUInt32LE(16,16);audio.writeUInt16LE(1,20);audio.writeUInt16LE(1,22);audio.writeUInt32LE(rate,24);audio.writeUInt32LE(rate*2,28);audio.writeUInt16LE(2,32);audio.writeUInt16LE(16,34);audio.write('data',36);audio.writeUInt32LE(samples*2,40);for(let i=0;i<samples;i++)audio.writeInt16LE(Math.round(Math.sin(i*2*Math.PI*440/rate)*5000),44+i*2);return audio;}
 upstream=http.createServer(async(req,res)=>{try{
  const url=new URL(req.url,'http://fixture');
  if(url.pathname==='/fixture-tone.mp3'){log({source:'fixture-cdn',method:req.method,bytes:bytes.length,authorization:!!req.headers.authorization});res.writeHead(200,{'Content-Type':'audio/mpeg','Content-Length':bytes.length});return res.end(bytes);}
  if(url.pathname==='/api/v3/tts/create'&&req.method==='POST'){
   if(req.headers['x-api-key']!==key)return json(res,401,{code:45000000});const value=await body(req),config=value.audio_config;
   log({source:'fixture-upstream',protocol:'seed-audio-native',method:'POST',path:url.pathname,model:value.model,promptLength:value.text_prompt?.length,audioConfig:config,referenceCount:value.references?.length??0});
   const generated=config.format==='wav'?wave(config.sample_rate):config.format==='mp3'?bytes:ogg;
   return json(res,200,{audio:generated.toString('base64'),duration:.12,original_duration:.12,...(config.enable_subtitle?{subtitle:{text:'供应商 fixture 字幕，非提示词复制'}}:{})});
  }
  if(url.pathname.startsWith('/v1/song/')){
   if(req.headers.authorization!=='Bearer '+key)return json(res,401,{error:'Fixture authentication mismatch'});
   if(req.method==='POST'&&['/v1/song/easy-generate','/v1/song/generate'].includes(url.pathname)){
    const value=await body(req),id='fixture-mureka-'+(++counter);tasks.set(id,{id,model:value.model,status:'succeeded',choices:[{index:0,id:'song-'+counter,duration:200,url:'https://fixture-mureka.invalid/tone.mp3'}]});
    log({source:'fixture-upstream',protocol:'mureka-native',method:'POST',path:url.pathname,model:value.model,mode:value.lyrics?'custom':'auto',promptLength:value.prompt?.length,lyricsLength:value.lyrics?.length??0,n:value.n});return json(res,200,{id,model:value.model,status:'queued'});
   }
   if(req.method==='GET'){const id=url.pathname.split('/').at(-1);log({source:'fixture-upstream',protocol:'mureka-native',method:'GET',path:url.pathname});return json(res,tasks.has(id)?200:404,tasks.get(id)??{error:'unknown fixture task'});}
  }
  return json(res,404,{error:'Fixture route unavailable'});
 }catch{return json(res,400,{error:'Fixture body invalid'});}});
 const upstreamPort=await listen(upstream),baseUrl=upstreamBase=`http://127.0.0.1:${upstreamPort}`;
 const gateways={};let mode='ready';
 for(const name of ['ready','unconfigured','unmapped']){
  const providers={mureka:{protocol:'mureka-native',apiKey:name==='unconfigured'?'':key,baseUrl},seed:{protocol:'seed-audio-native',apiKey:name==='unconfigured'?'':key,baseUrl}},models=name==='unmapped'?{}:{'mureka-8':'mureka','mureka-o2':'mureka','doubao-seed-audio-1-0':'seed'};
  gateways[name]=createGenerationGateway({directory:path.join(directory,name,'tasks'),mediaDirectory:path.join(directory,name,'media'),providers,routes:{'audio.generate':{models}}});await gateways[name].ready;
 }
 gateway=gateways.ready;
 server=http.createServer(async(req,res)=>{try{const host=req.headers.host,port=server.address().port;if(![`127.0.0.1:${port}`,`localhost:${port}`].includes(host))return json(res,403,{error:'Loopback only'});if(req.headers.origin&&req.headers.origin!=='http://'+host)return json(res,403,{error:'Same origin only'});const pathname=decodeURIComponent(new URL(req.url,'http://'+host).pathname);if(pathname.startsWith('/api/'))log({source:'browser',method:req.method,path:pathname});
  if(pathname==='/api/qa/audio-native-pair-audit')return json(res,200,{fixture:true,realSupplier:false,fixtureDownloadSeam:true,directory,mode,audit});
  if(pathname==='/api/qa/audio-native-pair-mode'&&req.method==='POST'){const value=await body(req);if(!Object.hasOwn(gateways,value.mode))return json(res,400,{error:'Invalid fixture mode'});mode=value.mode;gateway=gateways[mode];log({source:'fixture-mode',mode});return json(res,200,{mode});}
  if(pathname==='/api/generation/config'&&req.method!=='GET')return json(res,405,{error:'Fixture configuration is fixed'});
  if(pathname.startsWith('/api/generation/voices'))return json(res,200,{configured:false,voices:[],missing:['VOICE_CATALOG_NOT_CONFIGURED']});
  if(pathname.startsWith('/api/generation/'))return gateway.handle(req,res,pathname,{json,body});
  if(pathname==='/api/agent/config')return json(res,200,{configured:false,missing:['OPENAI_API_KEY','OPENAI_MODEL'],configurationError:null});
  if(pathname.startsWith('/api/'))return json(res,503,{configured:false,code:'configuration_required',error:'本地fixture仅接Mureka与Seed Audio合同，其他API未配置'});
  const relative=pathname==='/'?'index.html':pathname.replace(/^\/+/, '');if(!['GET','HEAD'].includes(req.method)||relative.split('/').some(v=>v==='..'||v.startsWith('.'))||relative.startsWith('server/')||relative.startsWith('tests/')||relative.startsWith('scripts/')||relative.startsWith('node_modules/')&&!relative.startsWith('node_modules/three/'))return json(res,403,{error:'Not fixture public source'});
  const file=path.resolve(root,relative);if(!file.startsWith(root+path.sep))return json(res,403,{error:'Invalid public source'});let content=await fs.readFile(file);
  if(relative==='index.html'){
   let html=content.toString('utf8');
   for(const name of ['canvas-data','editor-data','sidebar-data','versions-data'])html=html.replace(new RegExp('src="'+name+'\\.js[^\"]*"'),'src="defaults/'+name+'.js"');
   html=html.replace('<script src="defaults/canvas-data.js"></script>','<script src="defaults/canvas-data.js"></script><script>window.CANVAS_DATA.nodes=[];window.CANVAS_DATA.edges=[];</script>');
   content=Buffer.from(html.replace(/<title>[^<]*<\/title>/,'<title>Mureka + Seed Audio原生合同fixture · 非真实供应商</title>').replace('</body>','<script type="module" src="/src/features/audio-generation/qa/native-pair.mjs"></script></body>'));
  }
  const mime={'.js':'text/javascript','.mjs':'text/javascript','.html':'text/html; charset=utf-8','.css':'text/css','.json':'application/json','.mp3':'audio/mpeg','.wav':'audio/wav','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.woff2':'font/woff2','.glb':'model/gltf-binary','.wasm':'application/wasm'};res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Content-Length':content.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; connect-src 'self' data: blob:; img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self' data: blob:; worker-src 'self' blob:; frame-src 'self' blob:; object-src 'none'; base-uri 'self'"});res.end(req.method==='HEAD'?undefined:content);
 }catch{if(!res.headersSent)json(res,404,{error:'Fixture resource unavailable'});else res.end();}});
 const port=await listen(server);console.log(JSON.stringify({fixture:true,realSupplier:false,url:`http://127.0.0.1:${port}/`,audit:`http://127.0.0.1:${port}/api/qa/audio-native-pair-audit`,upstreamPort,directory}));
 const close=async()=>{server.closeAllConnections();upstream.closeAllConnections();server.close();upstream.close();for(const value of Object.values(gateways))await value.close();};for(const event of ['SIGTERM','SIGINT'])process.once(event,()=>void close());
})().catch(()=>{console.error('Native Mureka and Seed Audio fixture could not start');process.exitCode=1;});
