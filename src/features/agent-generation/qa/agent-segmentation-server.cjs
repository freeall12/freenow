'use strict';
// Operator-only QA host. Fixed Responses adapter, real AgentRuntime/session
// checkpoints, and a separate real native SAM2 host with explicit cloud fixture.
const http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'../../../..');
const {startSam2NativeServer}=require(path.join(root,'src/features/video-mask/qa/sam2-native-server.cjs'));
const {AgentRuntime}=require(path.join(root,'server/agent.cjs'));
const {createAgentSessionStore}=require(path.join(root,'server/agent-session-store.cjs'));
const {wantsAgentStream,writeAgentStream}=require(path.join(root,'server/agent-stream.cjs'));
const {isPublicStaticPath}=require(path.join(root,'server/static-public-path.cjs'));
const tools=['video_segment_target','video_segmentation_recover','video_segmentation_resume','video_segmentation_cancel','video_segmentation_retry_save'];
async function startAgentSegmentationServer({port=0,directory,nativePort=0}={}){
 if(!Number.isSafeInteger(port)||port<0||port>65535||[4173,62798].includes(port))throw Error('Use an independent dynamic QA port.');
 require(path.join(root,'scripts/build-agent-segmentation-fixture.cjs')).build();
 const installedThreeRoot=await fs.realpath(path.join(root,'node_modules/three'));
 const native=await startSam2NativeServer({port:nativePort,...directory?{directory}:{}}),sessionStore=createAgentSessionStore({directory:path.join(native.directory,'private-agent-sessions')});
 const savedAudit=await fs.readFile(path.join(native.directory,'agent-qa-audit-checkpoint.json'),'utf8').catch(error=>{if(error.code==='ENOENT')return null;throw error;}),history=savedAudit?JSON.parse(savedAudit):null;
 const llmAudit=history?.llm??{fixedAdapter:true,calls:0,tools:[],plans:0};let plan={tool:'video_segment_target',operationId:llmAudit.tools.at(-1)?.args?.operationId??randomUUID()};
 const gitPublicFiles=()=>new Set(execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean));let publicFiles=gitPublicFiles();
 const client={responses:{async create(request){
  llmAudit.calls++;const afterTool=request.input.at(-1)?.type==='function_call_output';
  const args=plan.tool==='video_segment_target'?{operationId:plan.operationId,nodeId:'agent-segmentation-source',rect:{x:120,y:60,width:40,height:50},time:2.5}:{nodeId:'agent-segmentation-source',taskId:plan.taskId};
  const text=afterTool?'固定LLM已收到工具回执；请检查真实任务、applied/saved和本地蒙层保存状态。':'固定LLM方案：按提供的源像素矩形及绝对2.5秒调用SAM2；上传和最多两次计费需生产卡片明确确认。只保存蒙层。';
  const response={status:'completed',output_text:text,output:afterTool?[{type:'message',role:'assistant',content:[{type:'output_text',text}]}]:[{type:'function_call',call_id:'agentsegmentation-'+randomUUID(),name:plan.tool,arguments:JSON.stringify(args)}]};
  if(!afterTool)llmAudit.tools.push({name:plan.tool,args});
  return request.stream?(async function*(){yield {type:'response.output_text.delta',delta:text};yield {type:'response.completed',response};})():response;
 }}};
 const runtime=new AgentRuntime({client,model:'fixed-sam2-qa',sessionStore,providerIdentity:'agent-segmentation-1005o-fixed-local',toolNames:tools,reasoning:{auto:{off:'none',enabled:'low',low:'low',medium:'medium',high:'high'}}});await runtime.ready;
 const json=(res,status,value)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(value));};
 const body=async(req,max=1024*1024)=>{const parts=[];let bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>max)throw Error('QA request exceeds budget.');parts.push(chunk);}return JSON.parse(Buffer.concat(parts).toString()||'{}');};
 const server=http.createServer((req,res)=>{void(async()=>{
  const pathname=new URL(req.url,'http://127.0.0.1').pathname;
  if(req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`)return json(res,403,{error:'Cross-origin QA request rejected.'});
  if(pathname==='/qa/agent-segmentation-audit'&&req.method==='GET')return json(res,200,{fixture:true,supplier:await native.audit(),llm:llmAudit,agentSessions:(await sessionStore.list()).map(record=>({id:record.id,status:record.status,pending:record.pending?.map(call=>({callId:call.callId,name:call.name})),receipts:record.receiptLedger?.length}))});
  if(pathname==='/qa/agent-segmentation-plan'&&req.method==='POST'){
   const input=await body(req,1024);if(!tools.includes(input.tool)||Object.keys(input).some(key=>!['tool','taskId'].includes(key))||input.tool!=='video_segment_target'&&!/^[a-f0-9-]{36}$/.test(input.taskId||''))return json(res,400,{error:'Expected one of the five pinned segmentation tools and original UUID.'});
   plan={tool:input.tool,...input.tool==='video_segment_target'?{operationId:randomUUID()}:{taskId:input.taskId}};llmAudit.plans++;return json(res,200,plan);
  }
  if(pathname==='/api/agent/config'&&req.method==='GET')return json(res,200,{configured:true,model:'固定LLM适配 · 实际AgentRuntime',missing:[],configurationError:null});
  if(pathname.startsWith('/api/agent/')){
   if(req.method!=='POST'||!['turn','continue','state','cancel'].includes(pathname.split('/').at(-1)))return json(res,403,{error:'Other Agent endpoints disabled in QA.'});
   const input=await body(req),controller=new AbortController();res.on('close',()=>{if(!res.writableEnded)controller.abort();});runtime.prune();
   if(['turn','continue'].includes(pathname.split('/').at(-1))&&wantsAgentStream(req))return writeAgentStream(res,onEvent=>pathname.endsWith('/turn')?runtime.start(input,controller.signal,onEvent):runtime.resume(input.sessionId,input.results,controller.signal,onEvent,input.binding),{signal:controller.signal});
   const result=pathname.endsWith('/turn')?await runtime.start(input,controller.signal):pathname.endsWith('/continue')?await runtime.resume(input.sessionId,input.results,controller.signal,undefined,input.binding):pathname.endsWith('/state')?await runtime.readState(input):await runtime.cancelDurable(input.sessionId,input.binding);return json(res,200,result);
  }
  if(['GET','HEAD'].includes(req.method)&&pathname.startsWith('/node_modules/three/')){
   const relative=decodeURIComponent(pathname).slice(1);if(!isPublicStaticPath(relative))return json(res,403,{error:'Private package path rejected.'});
   // pnpm's package symlink resolves through a hidden storage directory. Bind
   // only this public Three URL prefix to the exact installed package root.
   const file=await fs.realpath(path.join(installedThreeRoot,relative.slice('node_modules/three/'.length)));
   if(!file.startsWith(installedThreeRoot+path.sep))return json(res,403,{error:'Package symlink escaped installed Three.'});
   const bytes=await fs.readFile(file),extension=path.extname(file);res.writeHead(200,{'content-type':extension==='.wasm'?'application/wasm':extension==='.json'?'application/json':'text/javascript; charset=utf-8','cache-control':'no-store'});return res.end(req.method==='HEAD'?undefined:bytes);
  }
  if(['GET','HEAD'].includes(req.method)&&['/','/src/features/agent-generation/qa/agent-segmentation-app.html','/src/features/agent-generation/qa/agent-segmentation-fixture.js','/src/features/agent-generation/qa/agent-segmentation-controls.mjs'].includes(pathname)){
   const relative=pathname==='/'?'src/features/agent-generation/qa/agent-segmentation-app.html':pathname.slice(1);if(!isPublicStaticPath(relative))throw Error('Private static path rejected.');
   const bytes=await fs.readFile(path.join(root,relative));res.writeHead(200,{'content-type':relative.endsWith('.html')?'text/html; charset=utf-8':'text/javascript; charset=utf-8','cache-control':'no-store','content-security-policy':"default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; connect-src 'self' data: blob:; img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self' data:; worker-src 'self' blob:; frame-src 'self'; object-src 'none'; form-action 'none'; base-uri 'self'"});return res.end(req.method==='HEAD'?undefined:bytes);
  }
  if(['GET','HEAD'].includes(req.method)&&/\.(?:mjs|js)$/.test(pathname)){
   const relative=decodeURIComponent(pathname).slice(1);if(!isPublicStaticPath(relative)||relative.startsWith('node_modules/'))return json(res,403,{error:'Private script path rejected.'});
   // Development can create a public module after host startup. Refresh only
   // on a whitelist miss; ignored/private paths never acquire static access.
   if(!publicFiles.has(relative))publicFiles=gitPublicFiles();
   if(!publicFiles.has(relative))return json(res,404,{error:'Script is outside the Git-listed public checkout.'});
   const file=await fs.realpath(path.resolve(root,relative)),actual=path.relative(root,file);
   if(path.isAbsolute(actual)||!isPublicStaticPath(actual))return json(res,403,{error:'Script symlink target is private.'});
   const bytes=await fs.readFile(file);res.writeHead(200,{'content-type':'text/javascript; charset=utf-8','cache-control':'no-store'});return res.end(req.method==='HEAD'?undefined:bytes);
  }
  // Proxy only this separately owned loopback native fixture. No URL from a
  // browser/provider can choose another host, and no external fallback exists.
  const nativeAPI=pathname.startsWith('/api/video-segmentation/')||pathname==='/api/generation/config';
  const nativeQA=['/qa/sam2-audit','/qa/sam2-mode','/qa/sam2-restart','/qa/sam2-source.mp4'].includes(pathname);
  const relative=decodeURIComponent(pathname==='/'?'/src/features/agent-generation/qa/agent-segmentation-app.html':pathname).replace(/^\//,'');
  if(!nativeAPI&&!nativeQA&&(!['GET','HEAD'].includes(req.method)||!isPublicStaticPath(relative)||path.extname(relative)==='.cjs'))return json(res,403,{error:'Undeclared QA endpoint blocked.'});
  const target=pathname==='/'?'/src/features/agent-generation/qa/agent-segmentation-app.html':req.url,headers={...req.headers,host:new URL(native.origin).host};delete headers.origin;
  const upstream=http.request(native.origin+target,{method:req.method,headers},response=>{res.writeHead(response.statusCode,response.headers);response.pipe(res);});upstream.on('error',()=>{if(res.headersSent)res.destroy();else json(res,502,{error:'Owned native loopback host unavailable.'});});req.pipe(upstream);
 })().catch(error=>{if(res.headersSent)res.destroy();else json(res,error.status||400,{error:error.message,code:error.code||'qa_failed'});});});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
 const origin=`http://127.0.0.1:${server.address().port}`;
 async function close(){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await runtime.close();await sessionStore.close();await native.close();}
 return {url:origin+'/src/features/agent-generation/qa/agent-segmentation-app.html?session=agent-sam2-1005o',origin,nativeOrigin:native.origin,close};
}
if(require.main===module)startAgentSegmentationServer({port:Number(process.argv[2]??0),...process.argv[3]?{directory:process.argv[3],nativePort:Number(process.argv[4]??0)}:{}}).then(host=>{console.log(host.url+'\n'+host.origin+'/qa/agent-segmentation-audit\nOwned native fixture: '+host.nativeOrigin+'; fixed LLM only; no external model or supplier calls.');const stop=()=>{void host.close().then(()=>process.exit(0));};process.once('SIGINT',stop);process.once('SIGTERM',stop);}).catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={startAgentSegmentationServer};
