import {productionProgressUri,prepareProductionProgress,validateProductionProgressRequest,normalizeProductionProgressResult} from './production-progress.mjs';
import {materializationScope} from '../world-node/materialization.mjs';
export const productionPreviewBudget=Object.freeze({imageBytes:8*1024*1024,videoBytes:8*1024*1024,totalBytes:16*1024*1024,responseBytes:15*1024*1024,timeoutMs:30000});
const inlineBytes=384*1024;
const failure = message => {throw Error(message);};
const overBudget=message=>{throw Object.assign(Error(message),{code:'production_preview_budget'});};
const clone = value => structuredClone(value);
const media = node => node?.type === 'image' ? node.fullImage || node.image : node?.type === 'video' ? node.video : null;
const outputMedia=output=>output?.type==='video'?output.video||output.url:output?.fullImage||output?.image||output?.url;
const actualAppliedMedia=(node,job)=>!!media(node)&&(node.provenance?.taskId===job.id&&node.provenance.mediaSource===media(node)||job.outputs?.some(output=>output.type===node.type&&outputMedia(output)===media(node)));
const taskId = trace => trace?.result?.taskId || trace?.submittedTaskId;
const generationNames = new Set(['generation_submit','depth_video_convert','depth_video_recast']);
function generationTraces(chat) {return (chat?.messages || []).flatMap(trace => trace.batchItems || [trace]).filter(trace => generationNames.has(trace.name) && trace.status==='done' && typeof taskId(trace) === 'string' && !trace.error && !trace.result?.error);}
async function inlineMedia(blob,scope,maxInline) {
 if(blob.size>maxInline)overBudget('制作预览媒体超过有界显示大小');
 const bytes=new Uint8Array(await scope.wait(()=>blob.arrayBuffer()));let text='';
 for(let at=0;at<bytes.length;at+=32768)text+=String.fromCharCode(...bytes.subarray(at,at+32768));
 return 'data:'+blob.type+';base64,'+btoa(text);
}
async function inlineImage(blob,scope,maxInline=inlineBytes) {
 if(!['image/png','image/jpeg','image/webp','image/gif'].includes(blob.type)||blob.size>maxInline)failure('制作预览图片超过有界内联大小或格式不受支持');
 return inlineMedia(blob,scope,maxInline);
}
async function frameImage(media,scope,maxInline) {
 const width=media.videoWidth||media.width,height=media.videoHeight||media.height;if(!width||!height)failure('制作预览没有可解码的实际画面');
 for(const side of [768,512,320,192,128,96,64]){
  scope.check();const ratio=Math.min(1,side/Math.max(width,height)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(width*ratio));canvas.height=Math.max(1,Math.round(height*ratio));
  const context=canvas.getContext('2d');if(!context)failure('制作预览画面无法读取');context.drawImage(media,0,0,canvas.width,canvas.height);
  const blob=await scope.wait(()=>new Promise((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(Error('实际制作预览编码失败')),'image/jpeg',.7)));
  if(blob.size<=maxInline)return inlineImage(blob,scope,maxInline);
 }
 failure('实际制作预览超过有界内联大小');
}
async function visiblePreview(blob,type,scope,createObjectURL,revokeObjectURL,maxInline) {
 if(type==='image'){
  if(blob.size<=maxInline&&['image/png','image/jpeg','image/webp','image/gif'].includes(blob.type))return {url:await inlineImage(blob,scope,maxInline),mediaType:'image'};
  if(typeof createImageBitmap!=='function')failure('当前环境无法生成有界制作图片预览');
  const bitmap=await scope.wait(()=>createImageBitmap(blob),{disposeLate:value=>value.close()});try{return {url:await frameImage(bitmap,scope,maxInline),mediaType:'image'};}finally{bitmap.close();}
 }
 // An oversized per-card transport may display an explicit actual still; it
 // never changes the source video or claims playback was verified.
 const url=createObjectURL(blob),video=document.createElement('video');video.muted=true;video.preload='auto';
 try{
  await scope.wait(()=>new Promise((resolve,reject)=>{video.onloadeddata=()=>resolve();video.onerror=()=>reject(Error('实际制作视频预览解码失败'));video.src=url;video.load();}));
  if(!video.videoWidth||!video.videoHeight||!Number.isFinite(video.duration)||video.duration<=0)failure('实际制作视频没有可解码的完整画面或时长');
  if(['video/mp4','video/webm'].includes(blob.type)&&blob.size<=maxInline)return {url:await inlineMedia(blob,scope,maxInline),mediaType:'video'};
  return {url:await frameImage(video,scope,Math.min(inlineBytes,maxInline)),mediaType:'image',still:true};
 }finally{video.onloadeddata=video.onerror=null;video.removeAttribute('src');video.load();revokeObjectURL(url);}
}
async function boundedPreviewBlob(response,scope,maxBytes,type) {
 const cancel=()=>response?.body?.cancel?.().catch(()=>{});
 if(!response?.ok){cancel();failure('实际制作结果媒体读取失败');}
 if(Number(response.headers?.get?.('content-length'))>maxBytes){cancel();overBudget('实际制作媒体超过预览读取预算；原生成任务保持不变');}
 if(!response.body?.getReader){cancel();failure('当前环境无法有界读取实际制作媒体');}
 const reader=response.body.getReader(),parts=[];let size=0,complete=false;
 try{for(;;){const chunk=await scope.wait(()=>reader.read());if(chunk.done){complete=true;break;}size+=chunk.value.byteLength;if(size>maxBytes)overBudget('实际制作媒体超过预览读取预算；原生成任务保持不变');parts.push(chunk.value);}
  const mime=response.headers?.get?.('content-type')?.split(';')[0]||'';if(!size||!mime.startsWith(type+'/'))failure('实际制作结果媒体格式无效');scope.check();return new Blob(parts,{type:mime});
 }finally{if(!complete)reader.cancel().catch(()=>{});reader.releaseLock();}
}
/** Read-only projection of submitted tasks in this conversation. Provider success
 * becomes done only after an actual result node has been applied; no recovery,
 * task submission, cancellation or canvas mutation is reachable from this app. */
export function createProductionProgressRuntime({app,generationAPI,getProjectId,localAssets,fetchImpl=globalThis.fetch,createObjectURL=blob=>URL.createObjectURL(blob),revokeObjectURL=url=>URL.revokeObjectURL(url),previewBudget=productionPreviewBudget} = {}) {
 for(const [name,fn] of Object.entries({'app.getState':app?.getState,'generationAPI.getJobs':generationAPI?.getJobs,getProjectId}))if(typeof fn!=='function')throw TypeError(name+' adapter is required');
 for(const [key,value] of Object.entries(productionPreviewBudget)){if(!Number.isSafeInteger(previewBudget[key])||previewBudget[key]<1||previewBudget[key]>value)throw TypeError('invalid production preview budget');}
 const preparations=new WeakMap();
 function bindings(data,chat) {
  const {title,...payload}=data||{},response=prepareProductionProgress(payload,title),projectId=getProjectId();
  if(response.status==='blocked'||response.project_url!==undefined||response.project_id!==undefined&&response.project_id!==projectId)failure('制作进度必须来自当前画布真实已提交的任务');
  const jobs=generationAPI.getJobs(),sources=generationTraces(chat);
  return response.node_ids.map(nodeId=>{
   const matches=sources.map(trace=>{const job=jobs.find(value=>value.id===taskId(trace)),request=job?.request;
    const ids=[...(job?.resultIds||trace.generationJob?.resultIds||[]),...(request?.parameters?.canvasResults?.targetNodeIds||[]),request?.nodeId||trace.args?.nodeId||trace.result?.nodeId].filter(Boolean);
    return ids.includes(nodeId)?{trace,job,nodeId,taskId:taskId(trace)}:null;
   }).filter(Boolean);
   if(!matches.length)failure('制作进度节点没有当前会话真实生成回执');
   // Repeated generations of a node bind the latest actual submitted task.
   const match=matches.at(-1);if(match.job&&!['image.generate','video.generate','depth.video.convert','depth.video.recast'].includes(match.job.request?.kind))failure('制作进度仅支持实际图片或视频制作任务');
   return {node_id:nodeId,task_id:match.taskId,trace_id:match.trace.id};
  });
 }
 async function prepareAppArgs(args,{chat,isCurrent=()=>true,signal}={}) {
  if(args.resource_uri!==productionProgressUri)return args;
  if(signal?.aborted)throw signal.reason;if(!isCurrent())failure('制作进度所属会话已切换');
  const projectId=getProjectId(),requested=bindings(args.data,chat),jobs=generationAPI.getJobs();
  const expanded=requested.flatMap(item=>{const job=jobs.find(job=>job.id===item.task_id),ids=job?.request?.parameters?.canvasResults?.targetNodeIds||job?.resultIds||[];return job?.request?.nodeId===item.node_id&&ids.length?ids:[item.node_id];});
  const items=bindings({node_ids:[...new Set(expanded)],project_id:projectId},chat),prepared={...clone(args),data:{node_ids:items.map(item=>item.node_id),project_id:projectId}};
  preparations.set(prepared,{projectId,items});return prepared;
 }
 function bindPreparedResult(result,args) {
  if(args.resource_uri!==productionProgressUri)return result;
  const binding=preparations.get(args);if(!binding||binding.projectId!==getProjectId())failure('制作进度展示缺少真实来源绑定');
  return {...result,productionSourceContext:clone(binding)};
 }
 function capture(response,{trace,chat,isCurrent}={}) {
  if(typeof isCurrent!=='function'||!trace?.id||!chat?.id||!trace.result?.productionSourceContext)failure('制作进度缺少实际会话来源');
  const binding=clone(trace.result.productionSourceContext),sourceResult=trace.result,sourceContext=sourceResult.productionSourceContext,urls=new Map(),downloads=new Set();let disposed=false,cachedBytes=0,reservedBytes=0,querying=false;
  if(binding.projectId!==getProjectId()||response.project_id!==binding.projectId||JSON.stringify(binding.items)!==JSON.stringify(bindings(response,chat)))failure('制作进度原始任务来源已变化');
  const sources=binding.items.map(item=>({item,trace:generationTraces(chat).find(value=>value.id===item.trace_id&&taskId(value)===item.task_id)}));
  function guard() {try{return !disposed&&isCurrent()===true&&getProjectId()===binding.projectId&&trace.result===sourceResult&&sourceResult.response===response&&sourceResult.productionSourceContext===sourceContext&&sources.every(source=>generationTraces(chat).includes(source.trace)&&taskId(source.trace)===source.item.task_id);}catch{return false;}}
  const check=operationCurrent=>{if(!guard()||operationCurrent()!==true)failure('制作进度所属任务、画布或应用来源已切换');};
  async function preview(node,scope) {
   const source=media(node);if(!source)failure('已应用结果缺少实际媒体');
   const cached=urls.get(node.id);if(cached?.source===source)return cached;
   const available=previewBudget.totalBytes-scope.downloadedBytes-reservedBytes,maxBytes=Math.min(node.type==='video'?previewBudget.videoBytes:previewBudget.imageBytes,available);
   if(maxBytes<1)overBudget('制作预览缓存超过总读取预算；原生成任务保持不变');reservedBytes+=maxBytes;
   try{
    const resolved=typeof localAssets?.url==='function'?await scope.wait(()=>localAssets.url(source)):source;
    const response=await scope.wait(()=>fetchImpl(resolved,{signal:scope.signal}),{disposeLate:response=>response?.body?.cancel?.().catch(()=>{})}),blob=await boundedPreviewBlob(response,scope,maxBytes,node.type);scope.downloadedBytes+=blob.size;
    const prepared=await visiblePreview(blob,node.type,scope,createObjectURL,revokeObjectURL,Math.min(node.type==='video'?previewBudget.videoBytes:inlineBytes,Math.floor((previewBudget.responseBytes-sources.length*1024)*.75/sources.length)));scope.check();
    const stored={source,...prepared,bytes:prepared.url.length};if(cachedBytes-(cached?.bytes||0)+stored.bytes>previewBudget.responseBytes)overBudget('实际制作预览超过本次有界显示预算；原生成任务保持不变');if(cached)cachedBytes-=cached.bytes;cachedBytes+=stored.bytes;urls.set(node.id,stored);return stored;
   }finally{reservedBytes-=maxBytes;}
  }
  async function query(args,{isCurrent:operationCurrent=()=>true}={}) {
   validateProductionProgressRequest(args,response);check(operationCurrent);if(querying)failure('制作预览查询正在读取，请等待本次只读查询');querying=true;
   const controller=new AbortController();downloads.add(controller);const scope=materializationScope({signal:controller.signal,validateSources:()=>check(operationCurrent),timeoutMs:previewBudget.timeoutMs});scope.downloadedBytes=0;
   try{const items=[];
   for(const {item} of sources){
    check(operationCurrent);const job=generationAPI.getJobs().find(value=>value.id===item.task_id),requested=app.getState().nodes.find(node=>node.id===item.node_id);
    const type=job?.request?.kind?.startsWith('video.')||job?.request?.kind?.startsWith('depth.video')?'video':job?.request?.kind?.startsWith('image.')?'image':requested?.type;
    const value={node_id:item.node_id,...['image','video'].includes(type)?{media_type:type}:{},...(requested?.title?{title:requested.title}:{})};
    if(!job)value.status='unknown';
    else if(['failed','cancelled','configuration_required'].includes(job.status)||job.applicationError)value.status='failed';
    else if(job.status==='succeeded'&&job.applied===true&&!job.applying){
     const ids=job.resultIds||[],aggregate=job.request.nodeId===item.node_id&&!ids.includes(item.node_id),targetId=ids.includes(item.node_id)?item.node_id:aggregate?ids[0]:null;
     if(aggregate&&ids.length>1&&ids.some(id=>!app.getState().nodes.some(node=>node.id===id&&['image','video'].includes(node.type)&&actualAppliedMedia(node,job))))failure('制作任务部分结果尚未在当前画布中找到，不能宣称完整完成');
     const target=app.getState().nodes.find(node=>node.id===targetId);
     if(!target)value.status='not_found';
     else if(!['image','video'].includes(target.type)||!actualAppliedMedia(target,job))value.status='unknown';
     else{
      const source=media(target),resultIds=JSON.stringify(ids),resultNodes=(aggregate?ids:[target.id]).map(id=>{const node=app.getState().nodes.find(node=>node.id===id);return {node,source:media(node)};});
      let projected;try{projected=await preview(target,scope);}catch(error){if(error?.code!=='production_preview_budget'||target.type!=='video')throw error;
       const output=job.outputs?.find(output=>output.type==='video'&&outputMedia(output)===source),poster=output?.poster||output?.image;
       if(typeof poster==='string'&&poster&&poster!==source){try{projected={...await preview({id:target.id+'-poster',type:'image',image:poster},scope),still:true,budgetLimited:true};}catch(posterError){if(posterError?.code!=='production_preview_budget')throw posterError;}}
       if(!projected)projected={mediaType:'video',budgetLimited:true};
      }check(operationCurrent);
      const currentJob=generationAPI.getJobs().find(value=>value.id===item.task_id);
      if(currentJob?.status!=='succeeded'||!currentJob.applied||currentJob.applying||!currentJob.resultIds?.includes(target.id)||!app.getState().nodes.includes(target)||media(target)!==source||!actualAppliedMedia(target,currentJob)||JSON.stringify(currentJob.resultIds)!==resultIds||resultNodes.some(value=>!app.getState().nodes.includes(value.node)||media(value.node)!==value.source||!actualAppliedMedia(value.node,currentJob)))failure('读取期间实际制作结果已变化');
      value.status='done';value.media_type=projected.mediaType;if(projected.url)value.media_url=projected.url;value.title=(target.title||'已应用的真实制作结果')+(projected.still?' · 视频首帧预览（非完整播放）':projected.budgetLimited?' · 视频预览超限，未加载播放':'')+(aggregate&&ids.length>1?' · '+ids.length+' 个已应用结果':'');
     }
    }else value.status=job.status==='unknown'?'unknown':'running';
    items.push(value);
   }
   check(operationCurrent);return normalizeProductionProgressResult({content:[],structuredContent:{items}},response);
   }catch(error){if(error?.code==='world_materialization_timeout')failure('制作预览读取或解码超时；原生成任务保持不变');throw error;}finally{controller.abort(Error('本次制作预览读取已结束'));scope.close();downloads.delete(controller);querying=false;}
  }
  function dispose(){disposed=true;for(const controller of downloads)controller.abort(Error('制作预览应用已关闭，已中止只读下载'));urls.clear();cachedBytes=0;}
  return {guard,query,dispose};
 }
 return {prepareAppArgs,bindPreparedResult,capture};
}
