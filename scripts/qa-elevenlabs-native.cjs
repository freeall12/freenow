'use strict';
// Independent loopback contract fixture. Uses production browser/gateway code;
// synthetic upstream and private temporary stores never read user credentials.
const http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createGenerationGateway}=require('../server/generation.cjs');
const {createVoiceCatalog}=require('../server/voice-catalog.cjs');
const {createGenerationMediaDownloader}=require('../server/generation-media-download.cjs');
const root=path.resolve(__dirname,'..'),key='explicit-elevenlabs-native-local-fixture-key',previewUrl='https://elevenlabs-native-fixture.example/preview.mp3',audit=[];
let gateway,catalog,server,upstream;
const log=value=>{audit.push({at:new Date().toISOString(),...value});if(audit.length>200)audit.shift();};
const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
const listen=listener=>new Promise(resolve=>listener.listen(0,'127.0.0.1',()=>resolve(listener.address().port)));
(async()=>{
 const bytes=await fs.readFile(path.join(root,'tests/fixtures/elevenlabs-tone-44100.mp3')),directory=await fs.mkdtemp(path.join(os.tmpdir(),'elevenlabs-native-browser-'));
 upstream=http.createServer(async(req,res)=>{const url=new URL(req.url,'http://fixture');if(req.headers['xi-api-key']!==key)return json(res,401,{error:'Fixture authentication mismatch'});
  if(req.method==='GET'&&url.pathname==='/v2/voices'){log({source:'fixture-upstream',method:'GET',path:url.pathname});return json(res,200,{voices:[{voice_id:'qa_native_voice',name:'QA 原生合同音色 · 非真实供应商',labels:{language:'zh',fixture:'非真实供应商'},category:'premade',description:'本地实际440Hz MP3正弦音；仅验证合同，不证明模型质量。',preview_url:previewUrl}],has_more:false,next_page_token:null});}
  if(req.method==='POST'&&url.pathname==='/v1/text-to-speech/qa_native_voice'){let body='';for await(const chunk of req){body+=chunk;if(body.length>16384)return json(res,413,{error:'Fixture body too large'});}let value;try{value=JSON.parse(body);}catch{return json(res,400,{error:'Fixture body invalid'});}log({source:'fixture-upstream',method:'POST',path:url.pathname,model:value.model_id,voiceId:'qa_native_voice',stability:value.voice_settings?.stability,outputFormat:url.searchParams.get('output_format'),textLength:value.text?.length,bytes:bytes.length});if(value.model_id!=='eleven_v3'||url.searchParams.get('output_format')!=='mp3_44100_128')return json(res,422,{error:'Fixture accepts exact native model and format only'});res.writeHead(200,{'Content-Type':'audio/mpeg','Content-Length':bytes.length});return res.end(bytes);}
  return json(res,404,{error:'Fixture route not found'});
 });
 const upstreamPort=await listen(upstream),baseUrl=`http://127.0.0.1:${upstreamPort}`,validator=createGenerationMediaDownloader({limits:{audio:8*1024*1024}});
 gateway=createGenerationGateway({directory:path.join(directory,'tasks'),mediaDirectory:path.join(directory,'media'),providers:{eleven:{protocol:'elevenlabs-native',apiKey:key,baseUrl}},routes:{'audio.generate':{models:{eleven_v3:'eleven'}}}});await gateway.ready;
 catalog=createVoiceCatalog({apiKey:key,baseUrl,downloader:{download:async(url,options)=>{if(url!==previewUrl)throw Error('Unknown fixture preview');log({source:'fixture-preview',bytes:bytes.length,credentialForwarded:false});return validator.download('data:audio/mpeg;base64,'+bytes.toString('base64'),options);}}});
 const body=async req=>{const chunks=[];let count=0;for await(const chunk of req){count+=chunk.length;if(count>65536)throw Error();chunks.push(chunk);}return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');};
 server=http.createServer(async(req,res)=>{try{const host=req.headers.host,port=server.address().port;if(![`127.0.0.1:${port}`,`localhost:${port}`].includes(host))return json(res,403,{error:'Loopback only'});if(req.headers.origin&&req.headers.origin!=='http://'+host)return json(res,403,{error:'Same origin only'});const pathname=decodeURIComponent(new URL(req.url,'http://'+host).pathname);if(pathname.startsWith('/api/'))log({source:'browser',method:req.method,path:pathname});
  if(pathname==='/api/qa/elevenlabs-audit')return json(res,200,{fixture:true,realSupplier:false,directory,audit});
  if(pathname==='/api/generation/config'&&req.method!=='GET')return json(res,405,{error:'Fixture configuration is fixed'});
  if(pathname.startsWith('/api/generation/voices'))return catalog.handle(req,res,pathname,{json});
  if(pathname.startsWith('/api/generation/'))return gateway.handle(req,res,pathname,{json,body});
  if(pathname==='/api/agent/config')return json(res,200,{configured:false,missing:['OPENAI_API_KEY','OPENAI_MODEL'],configurationError:null});
  if(pathname.startsWith('/api/'))return json(res,503,{configured:false,code:'configuration_required',error:'本地fixture仅接音色与TTS，其他API未配置'});
  const relative=pathname==='/'?'index.html':pathname.replace(/^\/+/, '');if(!['GET','HEAD'].includes(req.method)||relative.split('/').some(v=>v==='..'||v.startsWith('.'))||relative.startsWith('server/')||relative.startsWith('tests/')||relative.startsWith('scripts/')||relative.startsWith('node_modules/')&&!relative.startsWith('node_modules/three/'))return json(res,403,{error:'Not fixture public source'});
  const file=path.resolve(root,relative);if(!file.startsWith(root+path.sep))return json(res,403,{error:'Invalid public source'});let content=await fs.readFile(file);
  if(relative==='index.html')content=Buffer.from(content.toString('utf8').replace(/<title>[^<]*<\/title>/,'<title>ElevenLabs原生合同fixture · 非真实供应商</title>').replace('</body>','<script type="module" src="/src/features/audio-voices/qa/native-elevenlabs.mjs"></script></body>'));
  const mime={'.js':'text/javascript','.mjs':'text/javascript','.html':'text/html; charset=utf-8','.css':'text/css','.json':'application/json','.mp3':'audio/mpeg','.wav':'audio/wav','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.woff2':'font/woff2','.glb':'model/gltf-binary','.wasm':'application/wasm'};res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Content-Length':content.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; connect-src 'self' data: blob:; img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self' data: blob:; worker-src 'self' blob:; frame-src 'self' blob:; object-src 'none'; base-uri 'self'"});res.end(req.method==='HEAD'?undefined:content);
 }catch{if(!res.headersSent)json(res,404,{error:'Fixture resource unavailable'});else res.end();}});
 const port=await listen(server);console.log(JSON.stringify({fixture:true,realSupplier:false,url:`http://127.0.0.1:${port}/`,audit:`http://127.0.0.1:${port}/api/qa/elevenlabs-audit`,upstreamPort,directory}));
 const close=async()=>{catalog.close();server.closeAllConnections();upstream.closeAllConnections();server.close();upstream.close();await gateway.close();};for(const event of ['SIGTERM','SIGINT'])process.once(event,()=>void close());
})().catch(()=>{console.error('Native TTS fixture could not start');process.exitCode=1;});
