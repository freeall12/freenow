'use strict';
// Production canvas/gateway, isolated loopback fixture. Never reads user keys.
const http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createGenerationGateway}=require('../server/generation.cjs');
const root=path.resolve(__dirname,'..'),key='explicit-elevenlabs-music-local-fixture-key',audit=[];
let gateway,server,upstream;
const log=value=>{audit.push({at:new Date().toISOString(),...value});if(audit.length>200)audit.shift();};
const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
const listen=listener=>new Promise(resolve=>listener.listen(0,'127.0.0.1',()=>resolve(listener.address().port)));
const body=async req=>{const chunks=[];let count=0;for await(const chunk of req){count+=chunk.length;if(count>65536)throw Error('Bounded fixture request');chunks.push(chunk);}return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');};
(async()=>{
 const bytes=await fs.readFile(path.join(root,'tests/fixtures/elevenlabs-tone-44100.mp3')),directory=await fs.mkdtemp(path.join(os.tmpdir(),'elevenlabs-music-native-browser-'));
 upstream=http.createServer(async(req,res)=>{try{const url=new URL(req.url,'http://fixture');if(req.headers['xi-api-key']!==key)return json(res,401,{error:'Fixture authentication mismatch'});if(req.method!=='POST'||url.pathname!=='/v1/music')return json(res,404,{error:'Fixture route unavailable'});
  const value=await body(req);log({source:'fixture-upstream',method:'POST',path:url.pathname,model:value.model_id,mode:value.composition_plan?'custom':value.force_instrumental?'instrumental':'auto',duration:value.music_length_ms??value.composition_plan?.sections[0]?.duration_ms??null,outputFormat:url.searchParams.get('output_format'),bytes:bytes.length,lyrics:value.composition_plan?.sections[0]?.lines});
  if(value.model_id!=='music_v1'||url.searchParams.get('output_format')!=='mp3_44100_128'||!!value.prompt===!!value.composition_plan)return json(res,422,{error:'Fixture accepts exact Music v1 contract only'});
  res.writeHead(200,{'Content-Type':'audio/mpeg','Content-Length':bytes.length});return res.end(bytes);
 }catch{return json(res,400,{error:'Fixture body invalid'});}});
 const upstreamPort=await listen(upstream),baseUrl=`http://127.0.0.1:${upstreamPort}`;
 const gateways={};let mode='ready';
 for(const name of ['ready','unconfigured','unmapped']){gateways[name]=createGenerationGateway({directory:path.join(directory,name,'tasks'),mediaDirectory:path.join(directory,name,'media'),providers:{music:{protocol:'elevenlabs-music-native',apiKey:name==='unconfigured'?'':key,baseUrl}},routes:{'audio.generate':{models:{[name==='unmapped'?'different-model':'music_v1']:'music'}}}});await gateways[name].ready;}
 gateway=gateways.ready;
 server=http.createServer(async(req,res)=>{try{const host=req.headers.host,port=server.address().port;if(![`127.0.0.1:${port}`,`localhost:${port}`].includes(host))return json(res,403,{error:'Loopback only'});if(req.headers.origin&&req.headers.origin!=='http://'+host)return json(res,403,{error:'Same origin only'});const pathname=decodeURIComponent(new URL(req.url,'http://'+host).pathname);if(pathname.startsWith('/api/'))log({source:'browser',method:req.method,path:pathname});
  if(pathname==='/api/qa/elevenlabs-music-audit')return json(res,200,{fixture:true,realSupplier:false,directory,mode,audit});
  if(pathname==='/api/qa/elevenlabs-music-mode'&&req.method==='POST'){const value=await body(req);if(!Object.hasOwn(gateways,value.mode))return json(res,400,{error:'Invalid fixture mode'});mode=value.mode;gateway=gateways[mode];log({source:'fixture-mode',mode});return json(res,200,{mode});}
  if(pathname==='/api/generation/config'&&req.method!=='GET')return json(res,405,{error:'Fixture configuration is fixed'});
  if(pathname.startsWith('/api/generation/voices'))return json(res,200,{configured:false,voices:[],missing:['VOICE_CATALOG_NOT_CONFIGURED']});
  if(pathname.startsWith('/api/generation/'))return gateway.handle(req,res,pathname,{json,body});
  if(pathname==='/api/agent/config')return json(res,200,{configured:false,missing:['OPENAI_API_KEY','OPENAI_MODEL'],configurationError:null});
  if(pathname.startsWith('/api/'))return json(res,503,{configured:false,code:'configuration_required',error:'本地fixture仅接ElevenLabs音乐合同，其他API未配置'});
  const relative=pathname==='/'?'index.html':pathname.replace(/^\/+/, '');if(!['GET','HEAD'].includes(req.method)||relative.split('/').some(v=>v==='..'||v.startsWith('.'))||relative.startsWith('server/')||relative.startsWith('tests/')||relative.startsWith('scripts/')||relative.startsWith('node_modules/')&&!relative.startsWith('node_modules/three/'))return json(res,403,{error:'Not fixture public source'});
  const file=path.resolve(root,relative);if(!file.startsWith(root+path.sep))return json(res,403,{error:'Invalid public source'});let content=await fs.readFile(file);
  if(relative==='index.html'){
   let html=content.toString('utf8');
   for(const name of ['canvas-data','editor-data','sidebar-data','versions-data'])html=html.replace(new RegExp('src="'+name+'\\.js[^\"]*"'),'src="defaults/'+name+'.js"');
   html=html.replace('<script src="defaults/canvas-data.js"></script>','<script src="defaults/canvas-data.js"></script><script>window.CANVAS_DATA.nodes=[];window.CANVAS_DATA.edges=[];</script>');
   content=Buffer.from(html.replace(/<title>[^<]*<\/title>/,'<title>ElevenLabs音乐原生合同fixture · 非真实供应商</title>').replace('</body>','<script type="module" src="/src/features/audio-generation/qa/native-elevenlabs-music.mjs"></script></body>'));
  }
  const mime={'.js':'text/javascript','.mjs':'text/javascript','.html':'text/html; charset=utf-8','.css':'text/css','.json':'application/json','.mp3':'audio/mpeg','.wav':'audio/wav','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.woff2':'font/woff2','.glb':'model/gltf-binary','.wasm':'application/wasm'};res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Content-Length':content.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; connect-src 'self' data: blob:; img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self' data: blob:; worker-src 'self' blob:; frame-src 'self' blob:; object-src 'none'; base-uri 'self'"});res.end(req.method==='HEAD'?undefined:content);
 }catch{if(!res.headersSent)json(res,404,{error:'Fixture resource unavailable'});else res.end();}});
 const port=await listen(server);console.log(JSON.stringify({fixture:true,realSupplier:false,url:`http://127.0.0.1:${port}/`,audit:`http://127.0.0.1:${port}/api/qa/elevenlabs-music-audit`,upstreamPort,directory}));
 const close=async()=>{server.closeAllConnections();upstream.closeAllConnections();server.close();upstream.close();for(const value of Object.values(gateways))await value.close();};for(const event of ['SIGTERM','SIGINT'])process.once(event,()=>void close());
})().catch(()=>{console.error('Native ElevenLabs music fixture could not start');process.exitCode=1;});
