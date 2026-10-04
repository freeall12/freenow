import {createWorkflowMediaResolver} from '../agent-workflows/media-resolver.mjs';
import {openVideoFrames} from '../video-media/frames.mjs';

const failure=(code,message,details={})=>Object.assign(Error(message),{code,...details});
const MAX_BYTES=80*1024*1024;
const kind='agent-video-trim';
const sourceOf=node=>node.video||globalThis.EDITOR_DATA?.nodes?.[node.id]?.video;
const sourceSignature=node=>JSON.stringify([sourceOf(node),node.clip??null,node.trim??null]);
const validMetadata=value=>Number.isFinite(value?.duration)&&value.duration>0&&Number.isInteger(value.width)&&value.width>0&&Number.isInteger(value.height)&&value.height>0;

export function trimRequest(input){
  if(!input||typeof input.operationId!=='string'||!input.operationId.trim()||input.operationId.length>180||typeof input.nodeId!=='string'||!input.nodeId.trim()||input.nodeId.length>180)throw failure('invalid_request','裁剪需要稳定的 operationId 和来源 nodeId');
  if(!['node','source'].includes(input.timeBasis)||!Number.isFinite(input.start)||!Number.isFinite(input.end)||input.start<0||input.end<=input.start||input.end-input.start>600||input.end>36000)throw failure('invalid_range','请明确 node/source 时间基准；裁剪范围须为正数、长度不超过 600 秒、结束不超过 36000 秒');
  return {operationId:input.operationId,nodeId:input.nodeId,start:input.start,end:input.end,timeBasis:input.timeBasis};
}

export function absoluteTrimRange(request,node,sourceDuration){
  if(!Number.isFinite(sourceDuration)||sourceDuration<=0)throw failure('invalid_source','来源视频没有有限时长');
  if(node.trim!=null)throw failure('invalid_clip','不支持此节点裁剪格式');
  const clip=node.clip;
  if(clip&&(!Number.isFinite(clip.start)||!Number.isFinite(clip.end)||clip.start<0||clip.end<=clip.start||clip.end>sourceDuration+.001))throw failure('invalid_clip','节点裁剪范围超出实际来源视频');
  const base=request.timeBasis==='node'?(clip?.start||0):0;
  const limit=request.timeBasis==='node'?(clip?clip.end-clip.start:sourceDuration):sourceDuration;
  if(request.end>limit+.001)throw failure('invalid_range','请求范围超出所选时间基准的实际视频长度');
  return {start:base+request.start,end:base+request.end};
}

async function decodeVideo(url,{signal}={}){
  const reader=await openVideoFrames(url,signal);
  try{
    const frame=await reader.at(0,320);
    return {duration:reader.duration,width:reader.width,height:reader.height,poster:frame.toDataURL('image/jpeg',.85)};
  }finally{reader.dispose();}
}

// The operation receipt owns application retries; no generation provider participates.
export function createAgentVideoTrim({app=globalThis.CanvasApp,localMedia=globalThis.LocalMedia,localAssets=globalThis.LocalAssets,store=globalThis.CanvasStore,
  fetchImpl=(...args)=>fetch(...args),resolveMedia=createWorkflowMediaResolver({localAssets}),decode=decodeVideo,
  createObjectURL=blob=>URL.createObjectURL(blob),revokeObjectURL=url=>URL.revokeObjectURL(url),timeoutMs=120000}={}){
  for(const [name,fn]of Object.entries({'app.getState':app?.getState,'app.createConnected':app?.createConnected,'LocalMedia.process':localMedia?.process,'LocalAssets.put':localAssets?.put,'LocalAssets.url':localAssets?.url,'CanvasStore.save':store?.save}))if(typeof fn!=='function')throw TypeError(name+' adapter is required');
  if(!Number.isFinite(timeoutMs)||timeoutMs<1||timeoutMs>120000)throw TypeError('timeoutMs must be between 1 and 120000');
  const operations=new Map(),nodes=()=>app.getState().nodes;
  const receipt=op=>({operationId:op.request.operationId,status:op.status,saved:op.saved===true,applied:!!op.created,nodeIds:op.created?[op.created.id]:[],
    ...(op.metadata?{duration:op.metadata.duration,width:op.metadata.width,height:op.metadata.height,dimensions:{width:op.metadata.width,height:op.metadata.height}}:{}),
    ...(op.range?{sourceRange:{...op.range},requestedRange:{start:op.request.start,end:op.request.end,timeBasis:op.request.timeBasis}}:{}),...(op.error?{error:op.error.message,code:op.error.code||'trim_failed'}:{})});
  function existing(operationId){
    const found=nodes().filter(node=>node.provenance?.kind===kind&&node.provenance.operationId===operationId);
    if(found.length>1)throw failure('ambiguous_operation','发现多个相同裁剪操作的结果，请先检查画布');
    return found[0];
  }
  function assertOutput(op){
    if(!nodes().includes(op.created)||op.created.type!=='video'||op.created.video!==op.video||op.created.clip!=null||op.created.trim!=null)throw failure('output_changed','已有裁剪结果被删除或修改，不能自动重建');
  }
  async function persist(op){
    assertOutput(op);op.status='saving';
    try{const state=app.getState();if(await store.save({version:1,nodes:state.nodes,edges:state.edges})===false)throw Error('画布保存未完成');op.saved=true;op.status='succeeded';delete op.error;return receipt(op);}
    catch(error){op.saved=false;op.status='save_failed';op.error=failure('save_failed','视频节点已创建，但保存失败：'+error.message,{operationId:op.request.operationId,applied:true,nodeIds:[op.created.id]});throw op.error;}
  }
  async function process(op,signal){
    const controller=new AbortController(),cancel=()=>controller.abort(signal?.reason||new DOMException('裁剪已取消','AbortError'));
    if(signal?.aborted)cancel();else signal?.addEventListener('abort',cancel,{once:true});
    const timer=setTimeout(()=>controller.abort(failure('trim_timeout','本地视频裁剪超时')),timeoutMs);
    let rejectAbort;const interrupted=new Promise((_,reject)=>{rejectAbort=reject;});interrupted.catch(()=>{});
    const onAbort=()=>rejectAbort(controller.signal.reason);controller.signal.addEventListener('abort',onAbort,{once:true});
    const active=()=>{if(controller.signal.aborted)throw controller.signal.reason;};
    const wait=async(fn,guard=active)=>{guard();const result=await Promise.race([Promise.resolve().then(()=>{guard();return fn();}),interrupted]);guard();return result;};
    try{
      active();const prior=existing(op.request.operationId);
      if(prior){
        const provenance=prior.provenance;
        if(JSON.stringify(trimRequest(provenance.request))!==op.fingerprint||provenance.requestFingerprint!==op.fingerprint)throw failure('operation_conflict','相同 operationId 不能用于不同裁剪请求');
        if(prior.type!=='video'||!prior.video||prior.video!==provenance.outputMedia||prior.clip!=null||prior.trim!=null||!validMetadata(provenance))throw failure('output_changed','已保存裁剪结果与操作记录不符，不能自动重新裁剪');
        const video=prior.video,guard=()=>{active();if(!nodes().includes(prior)||prior.video!==video||prior.clip!=null||prior.trim!=null)throw failure('output_changed','已有裁剪结果已变化');};
        const metadata=await wait(async()=>decode(await localAssets.url(video),{signal:controller.signal}),guard);
        if(!validMetadata(metadata)||Math.abs(metadata.duration-provenance.duration)>.1||metadata.width!==provenance.width||metadata.height!==provenance.height)throw failure('output_changed','已有裁剪视频实际内容与操作记录不符');
        op.created=prior;op.video=video;op.metadata=metadata;op.range=provenance.sourceRange;op.status='applied';
      }else{
        const node=nodes().find(value=>value.id===op.request.nodeId),source=node&&sourceOf(node);
        if(node?.type!=='video'||!source)throw failure('invalid_source','来源节点不是可读取的视频');
        const signature=sourceSignature(node),guard=()=>{active();if(!nodes().includes(node)||node.type!=='video'||sourceSignature(node)!==signature)throw failure('source_changed','来源节点被删除、替换或裁剪范围已变化');};
        op.status='processing';
        const metadata=await wait(()=>resolveMedia({id:node.id,type:'video',video:source},{signal:controller.signal}),guard);
        if(!validMetadata(metadata))throw failure('invalid_source','来源视频实际尺寸或时长无效');
        const range=absoluteTrimRange(op.request,node,metadata.duration);op.range=range;
        const url=await wait(()=>localAssets.url(source),guard),response=await wait(()=>fetchImpl(url,{signal:controller.signal}),guard);
        if(!response?.ok)throw failure('source_unavailable','来源视频读取失败');
        if(Number(response.headers?.get?.('content-length'))>MAX_BYTES)throw failure('media_too_large','本地裁剪最多支持 80 MB 视频');
        const blob=await wait(()=>response.blob(),guard);
        if(!(blob instanceof Blob)||!blob.size||blob.size>MAX_BYTES)throw failure('invalid_source','来源视频为空或超过 80 MB');
        const output=await wait(()=>localMedia.process('trim',blob,{...range,signal:controller.signal}),guard);
        if(!(output instanceof Blob)||!output.size||output.size>MAX_BYTES||!output.type.startsWith('video/')||output===blob)throw failure('invalid_output','本地裁剪未返回独立有效视频');
        const preview=createObjectURL(output);let actual;
        try{actual=await wait(()=>decode(preview,{signal:controller.signal}),guard);}finally{revokeObjectURL(preview);}
        if(!validMetadata(actual)||Math.abs(actual.duration-(range.end-range.start))>.1||actual.width!==metadata.width||actual.height!==metadata.height)throw failure('invalid_output','裁剪视频实际时长或尺寸与请求不符');
        const video=await wait(()=>localAssets.put(output),guard);
        if(typeof video!=='string'||!video.startsWith('asset:'))throw failure('asset_save_failed','裁剪素材未写入本地存储');
        guard();op.video=video;op.metadata=actual;
        const created=app.createConnected(node.id,[{type:'video',title:`剪辑结果 (${actual.duration.toFixed(2)}s)`,video,...(actual.poster?{image:actual.poster}:{}),
          width:node.width,height:node.height,duration:actual.duration,videoMetadata:{width:actual.width,height:actual.height,duration:actual.duration},
          provenance:{kind,operationId:op.request.operationId,request:{...op.request},requestFingerprint:op.fingerprint,sourceRange:{...range},sourceNodeId:node.id,outputMedia:video,duration:actual.duration,width:actual.width,height:actual.height}}]);
        if(!Array.isArray(created)||created.length!==1||!created[0]?.id)throw failure('apply_failed','裁剪结果节点创建失败');
        op.created=created[0];op.status='applied';
      }
      // After insertion, saving must finish even if the caller stops: stopping cannot undo a visible result.
      return await persist(op);
    }catch(error){if(op.status!=='save_failed'){op.status=controller.signal.aborted?'cancelled':'failed';op.error=error;}throw error;}
    finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);controller.signal.removeEventListener('abort',onAbort);if(!controller.signal.aborted)controller.abort();}
  }
  function execute(input,{signal}={}){
    if(signal?.aborted)return Promise.reject(signal.reason||new DOMException('裁剪已取消','AbortError'));
    const request=trimRequest(input),fingerprint=JSON.stringify(request);let op=operations.get(request.operationId);
    if(op&&op.fingerprint!==fingerprint)return Promise.reject(failure('operation_conflict','相同 operationId 不能用于不同裁剪请求'));
    if(op?.pending)return op.pending;
    if(op?.created){try{assertOutput(op);}catch(error){return Promise.reject(error);}if(op.saved)return Promise.resolve(receipt(op));return retrySave(request.operationId,{signal});}
    if(op?.error)return Promise.reject(op.error);
    op={request,fingerprint,status:'queued',saved:false};operations.set(request.operationId,op);
    op.pending=process(op,signal).finally(()=>{delete op.pending;});return op.pending;
  }
  function retrySave(operationId,{signal}={}){
    if(signal?.aborted)return Promise.reject(signal.reason||new DOMException('裁剪已取消','AbortError'));
    const op=operations.get(operationId);
    if(op?.pending)return op.pending;
    if(op?.created){op.pending=persist(op).finally(()=>{delete op.pending;});return op.pending;}
    const prior=existing(operationId);if(!prior)return Promise.reject(failure('operation_missing','此裁剪操作没有可保存的结果节点'));
    return execute(prior.provenance.request,{signal});
  }
  return {execute,retrySave,get:operationId=>operations.has(operationId)?receipt(operations.get(operationId)):null};
}
