'use strict';
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {processMedia}=require('./media.cjs');
const {isPublicStaticPath}=require('./static-public-path.cjs');
const {processPlaylist}=require('./playlist.cjs');
const {transcribeRequest}=require('./voice.cjs');
const {createVideoSegmentationService}=require('./video-segmentation.cjs');
const segmentationMedia=process.env.VIDEO_SEGMENTATION_PROTOCOL==='replicate-sam2-native'
 ?require('./video-segmentation-media.cjs').createVideoSegmentationMediaTools({ffmpegPath:process.env.FFMPEG_PATH||'ffmpeg',ffprobePath:process.env.FFPROBE_PATH||'ffprobe'}):undefined;
const videoSegmentation=createVideoSegmentationService({protocol:process.env.VIDEO_SEGMENTATION_PROTOCOL,baseUrl:process.env.VIDEO_SEGMENTATION_API_BASE_URL,apiKey:process.env.VIDEO_SEGMENTATION_API_KEY,replicateApiToken:process.env.REPLICATE_API_TOKEN,version:process.env.REPLICATE_SEGMENTATION_VERSION,directory:path.join(__dirname,'.segmentation-tasks'),mediaTools:segmentationMedia});
const {generateArtifactHtml}=require('./agent-artifacts.cjs');
const {createWebSearch}=require('./agent-search.cjs');
const {createAgentSessionStore}=require('./agent-session-store.cjs');
const {createHash}=require('node:crypto');
const {wantsAgentStream,writeAgentStream}=require('./agent-stream.cjs');
const {createGenerationGateway}=require('./generation.cjs');
const {readGenerationRoutingConfig}=require('./generation-routing-config.cjs');
const generation=createGenerationGateway({localPort:Number(process.env.PORT||4173),directory:path.join(__dirname,'.generation-tasks'),mediaDirectory:path.join(__dirname,'.generation-media'),baseUrl:process.env.GENERATION_API_BASE_URL,apiKey:process.env.GENERATION_API_KEY,protocol:process.env.GENERATION_API_PROTOCOL||'tasks-v1',modelMap:process.env.GENERATION_MODEL_MAP,...readGenerationRoutingConfig(process.env)});
const voiceCatalog=require('./voice-catalog.cjs').createVoiceCatalog({provider:process.env.VOICE_CATALOG_PROVIDER||'elevenlabs',apiKey:process.env.ELEVENLABS_API_KEY,baseUrl:process.env.ELEVENLABS_API_BASE_URL||'https://api.elevenlabs.io',localPort:Number(process.env.PORT||4173)});
const OpenAI=require('openai');const {AgentRuntime}=require('./agent.cjs');
const root=path.resolve(__dirname,'..'),port=Number(process.env.PORT||4173);
const localResourceIndexReady=require('../src/features/local-resource-migration/cli.cjs').writeLocalResourceIndex({root}).catch(()=>({published:false}));
const modelConnection=require('./outbound-client.cjs').createConfiguredModelClient({apiKey:process.env.OPENAI_API_KEY,baseUrl:process.env.OPENAI_BASE_URL,localPort:port});
const client=modelConnection.client,configured=modelConnection.configured&&!!process.env.OPENAI_MODEL;
const webSearch=createWebSearch({client,model:process.env.OPENAI_WEB_SEARCH_MODEL||process.env.OPENAI_MODEL,configurationError:modelConnection.configurationError});
const agentSessionStore=createAgentSessionStore({directory:path.join(__dirname,'.agent-sessions')});
// Provider identity excludes credentials: key rotation does not change a run's
// destination, while a different endpoint or model configuration cannot resume it.
const providerIdentity=createHash('sha256').update(JSON.stringify({baseURL:modelConnection.baseURL||'configuration-invalid',model:process.env.OPENAI_MODEL||null,models:process.env.AGENT_MODEL_MAP||null,reasoning:process.env.AGENT_REASONING_MAP||null})).digest('hex');
const runtime=new AgentRuntime({client,model:process.env.OPENAI_MODEL,models:process.env.AGENT_MODEL_MAP,reasoning:process.env.AGENT_REASONING_MAP,sessionStore:agentSessionStore,providerIdentity});
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.mp4':'video/mp4','.webm':'video/webm','.wav':'audio/wav','.mp3':'audio/mpeg','.ogg':'audio/ogg','.m4a':'audio/mp4','.aac':'audio/aac','.flac':'audio/flac','.glb':'model/gltf-binary','.woff2':'font/woff2','.wasm':'application/wasm'};
function json(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));}
async function body(req,limit=1000000){let text='';for await(const chunk of req){text+=chunk;if(Buffer.byteLength(text)>limit)throw Error('请求过大');}return JSON.parse(text||'{}');}
const server=http.createServer(async(req,res)=>{try{
 const host=req.headers.host;if(!['localhost:'+port,'127.0.0.1:'+port].includes(host))return json(res,403,{error:'仅支持本机访问'});
 const url=new URL(req.url,'http://'+host),pathname=decodeURIComponent(url.pathname);
 if(path.posix.normalize(pathname)==='/assets/local-resource-index.json'){
  if(req.method!=='GET')return json(res,405,{error:'Method not allowed'});
  const result=await localResourceIndexReady;
  return result.published?json(res,200,result.index):json(res,503,{code:'local_resource_index_unavailable',error:'本地资源索引校验失败，请检查本地映射资料后重启服务'});
 }
 if(pathname.startsWith('/api/')){
  if(req.headers.origin&&req.headers.origin!=='http://'+host)return json(res,403,{error:'跨域请求不允许'});
  if(pathname.startsWith('/api/video-segmentation/'))return await videoSegmentation.handle(req,res,pathname,{json,body});
  if(pathname==='/api/generation/voices'||pathname.startsWith('/api/generation/voices/'))return await voiceCatalog.handle(req,res,pathname,{json});
  if(pathname.startsWith('/api/generation/'))return await generation.handle(req,res,pathname,{json,body:req=>body(req,64*1024*1024)});
  if(pathname==='/api/agent/config'&&req.method==='GET')return json(res,200,{configured,configurationError:modelConnection.configurationError,model:process.env.OPENAI_MODEL||null,missing:[...(!process.env.OPENAI_API_KEY?['OPENAI_API_KEY']:[]),...(!process.env.OPENAI_MODEL?['OPENAI_MODEL']:[])]});
  if(pathname==='/api/agent/search/config'&&req.method==='GET')return json(res,200,webSearch.config());
  if(pathname==='/api/voice/config'&&req.method==='GET')return json(res,200,{configured:!!client&&!!process.env.OPENAI_TRANSCRIPTION_MODEL,configurationError:modelConnection.configurationError});
  if(pathname==='/api/media-reviews/config'&&req.method==='GET')return json(res,200,{configured:false,message:'待连接合规验证 API，尚未提交审核'});
  if(pathname==='/api/media-reviews'||pathname.startsWith('/api/media-reviews/'))return json(res,503,{code:'configuration_required',error:'待连接合规验证 API，尚未提交审核'});
  if(req.method!=='POST')return json(res,405,{error:'Method not allowed'});
  if(pathname==='/api/agent/search'){
   const input=await body(req,12000),abort=new AbortController();res.on('close',()=>{if(!res.writableEnded)abort.abort();});
   return json(res,200,await webSearch.search(input,{signal:abort.signal}));
  }
  if(pathname==='/api/media/playlist')return await processPlaylist(req,res);
  if(pathname.startsWith('/api/media/'))return await processMedia(req,res,pathname.slice('/api/media/'.length),url.searchParams);
  if(pathname==='/api/voice/transcribe'){const abort=new AbortController();res.on('close',()=>{if(!res.writableEnded)abort.abort();});try{return json(res,200,await transcribeRequest(req,{client,model:process.env.OPENAI_TRANSCRIPTION_MODEL,toFile:OpenAI.toFile,signal:abort.signal}));}catch(e){return json(res,e.code==='configuration_required'?503:[400,404,409,429,503].includes(e.status)?e.status:400,{error:e.status===401?'语音模型服务认证失败，请检查服务端 KEY。':e.code?e.message:'语音模型服务请求失败，请检查模型配置后重试。',code:e.code||'transcription_failed'});}}
  if(!configured&&!['/api/agent/state','/api/agent/cancel','/api/agent/delegated-state','/api/agent/delegated-result'].includes(pathname))return json(res,503,{error:'请在本地服务环境中配置 OPENAI_API_KEY 和 OPENAI_MODEL，然后重启服务。KEY 不会发送到浏览器。',code:'configuration_required'});
  const input=await body(req);if(!['/api/agent/state','/api/agent/delegated-state','/api/agent/delegated-result'].includes(pathname))runtime.prune();const abort=new AbortController();res.on('close',()=>{if(!res.writableEnded)abort.abort();});let result;
  if(['/api/agent/turn','/api/agent/continue'].includes(pathname)&&wantsAgentStream(req))return await writeAgentStream(res,onEvent=>pathname==='/api/agent/turn'?runtime.start(input,abort.signal,onEvent):runtime.resume(input.sessionId,input.results,abort.signal,onEvent,input.binding),{signal:abort.signal});
  if(pathname==='/api/agent/turn')result=await runtime.start(input,abort.signal);
  else if(pathname==='/api/agent/continue')result=await runtime.resume(input.sessionId,input.results,abort.signal,undefined,input.binding);
  else if(pathname==='/api/agent/state')result=await runtime.readState(input);
  else if(pathname==='/api/agent/delegated-start')result=await runtime.delegateStart(input,abort.signal);
  else if(pathname==='/api/agent/delegated-continue')result=await runtime.delegateContinue(input,abort.signal);
  else if(pathname==='/api/agent/delegated-state')result=await runtime.delegateState(input);
  else if(pathname==='/api/agent/delegated-result')result=await runtime.delegateResult(input);
  else if(pathname==='/api/agent/cancel')result=await runtime.cancelDurable(input.sessionId,input.binding);
  else if(pathname==='/api/agent/artifact-html')result=await generateArtifactHtml(input,{client,model:process.env.OPENAI_MODEL,signal:abort.signal});
  else return json(res,404,{error:'Unknown API route'});
  return json(res,200,result);
 }
 if(!['GET','HEAD'].includes(req.method))return json(res,405,{error:'Method not allowed'});
 // Only serve this project's public files and the browser Three.js runtime, never server/env/SDK files.
 const relative=pathname==='/'?'index.html':pathname==='/component-library/'?'component-library/index.html':pathname.replace(/^\/+/, '');
 if(!isPublicStaticPath(relative))return json(res,403,{error:'Not public'});
 const file=path.resolve(root,relative);if(!file.startsWith(root+path.sep))return json(res,403,{error:'Invalid path'});
 let stat;try{stat=await fs.promises.stat(file);}catch{return json(res,404,{error:'Not found'});}if(!stat.isFile())return json(res,404,{error:'Not found'});
 const headers={'Content-Type':mime[path.extname(file)]||'application/octet-stream','Accept-Ranges':'bytes','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'};
 // All configured generation and Agent requests now use this server; completed
 // media is localized before publication. Unknown legacy references remain in
 // storage, but cannot reconnect the main canvas to an external resource host.
 if(relative==='index.html')headers['Content-Security-Policy']="default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; connect-src 'self' data: blob:; img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self' data: blob:; worker-src 'self' blob:; frame-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'";
 // Bundled app sandboxes use local code/media, including standalone demos.
 // Generated result bytes are served by the private local media route.
 if(/^src\/features\/(?:agent-apps\/resources\/|agent-widgets\/widget-proxy\.html$)/.test(relative)&&path.extname(file)==='.html')headers['Content-Security-Policy']=`default-src 'self' http://${host} data: blob:; script-src 'self' http://${host} 'unsafe-inline' 'unsafe-eval' blob:; style-src 'self' http://${host} 'unsafe-inline'; connect-src 'self' http://${host} data: blob:; img-src 'self' http://${host} data: blob:; media-src 'self' http://${host} data: blob:; font-src 'self' http://${host} data:; frame-src 'self' http://${host} blob:; worker-src 'self' http://${host} blob:; object-src 'none'; base-uri 'self'; form-action 'self'`;
 // The opaque official app proxy may read only these bundled public templates.
 if(/^src\/features\/agent-apps\/resources\/apps\/(manifest\.json|[a-z0-9-]+@v[0-9]+\.[a-f0-9]{8}\.html)$/.test(relative)||[
  'src/features/agent-apps/animatic-local-errors.mjs',
  'src/features/agent-apps/actor-emotion-local-resources.mjs',
  'src/features/agent-apps/production-progress-local-brand.mjs',
  'src/features/agent-apps/local-lifecycle.mjs',
  'src/features/agent-apps/platform-resize-local-interactions.mjs',
  'src/features/agent-apps/performance-rhythm-local-interactions.mjs',
  'src/features/agent-apps/story-room-local-interactions.mjs',
  'src/features/agent-apps/character-blocking-local-interactions.mjs',
  'src/features/agent-apps/cutlist-review-local-interactions.mjs',
  'src/features/agent-apps/picker-local-presentation.mjs',
  'assets/branding/freenow-mark.svg',
 ].includes(relative))headers['Access-Control-Allow-Origin']='*';
 const range=req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);let start=0,end=stat.size-1,status=200;if(range){start=Number(range[1]);end=range[2]?Math.min(Number(range[2]),end):end;if(start>end||start>=stat.size){res.writeHead(416,{'Content-Range':`bytes */${stat.size}`});return res.end();}status=206;headers['Content-Range']=`bytes ${start}-${end}/${stat.size}`;}headers['Content-Length']=end-start+1;res.writeHead(status,headers);if(req.method==='HEAD')return res.end();fs.createReadStream(file,{start,end}).pipe(res);
 }catch(e){if(!res.headersSent)json(res,e.status===401?401:e.code==='configuration_required'?503:[400,404,409,429,503].includes(e.status)?e.status:400,{error:e.status===401?'模型服务认证失败，请检查服务端 KEY。':e.message||'请求失败',...(e.code?{code:e.code}:{})});else res.end();}});
Promise.all([generation.ready,runtime.ready,videoSegmentation.ready]).then(()=>server.listen(port,'127.0.0.1',()=>console.log(`Canvas replica: http://localhost:${port} | Agent ${configured?'configured':'requires OPENAI_API_KEY and OPENAI_MODEL'}`))).catch(async()=>{console.error('Local task stores unavailable; server was not started.');await Promise.allSettled([runtime.close(),agentSessionStore.close(),generation.close(),videoSegmentation.close?.()]);process.exitCode=1;});

let closing=false;
for(const event of ['SIGTERM','SIGINT'])process.once(event,async()=>{if(closing)return;closing=true;server.close();voiceCatalog.close();try{await runtime.close();await agentSessionStore.close();await generation.close();await videoSegmentation.close?.();process.exit(0);}catch{console.error('Local task shutdown could not confirm persistence.');process.exit(1);}});
