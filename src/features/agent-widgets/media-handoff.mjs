import {createWorkflowMediaResolver} from '../agent-workflows/media-resolver.mjs';
import {openVideoFrames} from '../../../video-frames.mjs';

const kind='widget-media-handoff';
const fail=(code,message,details={})=>Object.assign(Error(message),{code,...details});
const abort=signal=>{if(signal?.aborted)throw signal.reason||new DOMException('上传已取消','AbortError');};
const text=(value,name,max=180)=>{if(typeof value!=='string'||!value.trim()||value.length>max||/[\u0000-\u001f\u007f]/.test(value))throw fail('invalid_binding',name+' 无效');return value;};
const mime=blob=>blob.type.toLowerCase().split(';')[0].trim();
const dimensions=info=>Number.isInteger(info?.width)&&info.width>0&&info.width<=16384&&Number.isInteger(info.height)&&info.height>0&&info.height<=16384&&info.width*info.height<=64*1024*1024;
const duration=value=>Number.isFinite(value)&&value>=.1&&value<=120;
const hashBytes=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),value=>value.toString(16).padStart(2,'0')).join('');

function checkedBlob(blob,type){
  if(!(blob instanceof Blob)||!blob.size||blob.size>(type==='image'?32:80)*1024*1024)throw fail('invalid_blob','请提供一张不超过 32 MB 的 PNG，或一个不超过 80 MB 的视频');
  if(type==='image'?mime(blob)!=='image/png':!['video/webm','video/mp4'].includes(mime(blob)))throw fail('invalid_type','仅接受 PNG 图片、WebM 或 MP4 视频实际数据');
}
function checkedPng(bytes){
  const data=new Uint8Array(bytes),view=new DataView(bytes);
  if(data.length<33||[137,80,78,71,13,10,26,10].some((n,i)=>data[i]!==n)||view.getUint32(8)!==13||String.fromCharCode(...data.slice(12,16))!=='IHDR')throw fail('invalid_png','PNG 文件头无效');
  const result={width:view.getUint32(16),height:view.getUint32(20)};
  if(!dimensions(result))throw fail('invalid_dimensions','PNG 像素尺寸超出支持范围');return result;
}
async function defaultVideoDecode(url,{signal}={}){
  const reader=await openVideoFrames(url,signal);
  try{const frame=await reader.at(0,320);return {width:reader.width,height:reader.height,duration:reader.duration,poster:frame.toDataURL('image/jpeg',.85)};}
  finally{reader.dispose();}
}

// This factory is host-only. An iframe supplies bytes, never binding, placement, node patches or URLs.
export function createWidgetMediaHandoff({app=globalThis.CanvasApp,localMedia=globalThis.LocalMedia,localAssets=globalThis.LocalAssets,store=globalThis.CanvasStore,
  decodeImage,decodeVideo=defaultVideoDecode,hash=hashBytes,fetchImpl=(...args)=>fetch(...args),
  createObjectURL=blob=>URL.createObjectURL(blob),revokeObjectURL=url=>URL.revokeObjectURL(url),onChange=()=>{},timeoutMs=120000}={}){
  for(const [name,fn]of Object.entries({'app.getState':app?.getState,'app.createConnected':app?.createConnected,'app.addNode':app?.addNode,'LocalMedia.process':localMedia?.process,'LocalAssets.put':localAssets?.put,'LocalAssets.url':localAssets?.url,'CanvasStore.save':store?.save}))if(typeof fn!=='function')throw TypeError(name+' adapter is required');
  if(!Number.isFinite(timeoutMs)||timeoutMs<1||timeoutMs>120000)throw TypeError('timeoutMs must be between 1 and 120000');
  const imageResolver=createWorkflowMediaResolver({localAssets});
  decodeImage??=(url,options)=>imageResolver({id:'widget-image',type:'image',image:url},options);
  const operations=new Map(),nodes=()=>app.getState().nodes;
  const receipt=op=>({operationId:op.id,type:op.type,status:op.status,saved:op.saved===true,applied:!!op.node,nodeIds:op.node?[op.node.id]:[],
    ...(op.metadata?{width:op.metadata.width,height:op.metadata.height,dimensions:{width:op.metadata.width,height:op.metadata.height},...(op.type==='video'?{duration:op.metadata.duration}:{} )}:{}),
    ...(op.timing||{}),...(op.error?{error:op.error.message,code:op.error.code||'handoff_failed'}:{})});
  function changed(op){try{onChange(receipt(op));}catch{/* Rendering errors cannot cause duplicate media application. */}}
  function setStatus(op,status){op.status=status;changed(op);}
  function existing(id){const found=nodes().filter(node=>node.provenance?.kind===kind&&node.provenance.operationId===id);if(found.length>1)throw fail('ambiguous_operation','同一上传操作出现多个结果，请检查画布');return found[0];}
  function outputGuard(op){const media=op.type==='image'?(op.node?.fullImage||op.node?.image):op.node?.video;if(!nodes().includes(op.node)||op.node.type!==op.type||media!==op.asset||op.node.clip!=null||op.node.trim!=null)throw fail('output_changed','已上传结果被删除或修改，不会自动重复创建');}
  async function persist(op){
    outputGuard(op);setStatus(op,'saving');
    try{const state=app.getState();if(await store.save({version:1,nodes:state.nodes,edges:state.edges})===false)throw Error('画布未保存');op.saved=true;delete op.error;setStatus(op,'succeeded');return receipt(op);}
    catch(error){op.saved=false;op.error=fail('save_failed','媒体已添加到画布，但保存失败：'+error.message);setStatus(op,'save_failed');throw Object.assign(op.error,{operationId:op.id,applied:true,nodeIds:[op.node.id],receipt:receipt(op)});}
  }
  function bind(input){
    if(typeof input?.isCurrent!=='function')throw TypeError('Host isCurrent callback is required');
    const version=typeof input.version==='number'&&Number.isSafeInteger(input.version)&&input.version>=0?input.version:text(input.version,'version',256);
    const allowedTypes=[...new Set(input.allowedTypes||[])].sort();if(!allowedTypes.length||allowedTypes.some(type=>!['image','video'].includes(type)))throw fail('invalid_binding','宿主必须明确允许的上传媒体类型');
    const position=input.position&&{x:input.position.x,y:input.position.y};
    const sourceNodeId=input.sourceNodeId==null?null:text(input.sourceNodeId,'sourceNodeId');
    if(!sourceNodeId&&(!position||!Number.isFinite(position.x)||!Number.isFinite(position.y)))throw fail('invalid_binding','宿主必须提供来源节点或世界坐标位置');
    if(input.expectedDuration!=null&&!duration(input.expectedDuration))throw fail('invalid_binding','已确认视频时长须为 0.1–120 秒');
    if(input.fps!=null&&(!Number.isFinite(input.fps)||input.fps<1||input.fps>120))throw fail('invalid_binding','已确认帧率须为 1–120');
    const binding={chatId:text(input.chatId,'chatId'),traceId:text(input.traceId,'traceId'),version,sourceNodeId,position:sourceNodeId?null:position,allowedTypes,
      title:input.title==null?null:text(input.title,'title',120),expectedDuration:input.expectedDuration??null,fps:input.fps??null};
    const bindingKey=JSON.stringify(binding),source=sourceNodeId?nodes().find(node=>node.id===sourceNodeId):null;
    const isCurrent=input.isCurrent;
    function guard(signal){abort(signal);if(isCurrent()!==true)throw fail('stale_widget','互动作品、对话或代码版本已变化');if(sourceNodeId&&(!source||!nodes().includes(source)))throw fail('source_changed','上传来源节点被删除或替换');}
    function belongs(op){if(op.bindingKey!==bindingKey)throw fail('operation_conflict','上传 operationId 已绑定另一个作品或版本');}
    function checkProvenance(node){const p=node.provenance;if(p.bindingKey!==bindingKey)throw fail('operation_conflict','已有上传属于另一个作品或版本');if(!allowedTypes.includes(p.mediaType)||!['image','video'].includes(p.mediaType)||!p.outputHash?.match(/^[a-f0-9]{64}$/)||!p.inputHash?.match(/^[a-f0-9]{64}$/)||typeof p.outputMedia!=='string'||!p.outputMedia.startsWith('asset:'))throw fail('invalid_receipt','已有上传记录不完整');return p;}
    async function work(op,blob,signal){
      const controller=new AbortController(),cancel=()=>controller.abort(signal?.reason||new DOMException('上传已取消','AbortError'));
      if(signal?.aborted)cancel();else signal?.addEventListener('abort',cancel,{once:true});
      const timer=setTimeout(()=>controller.abort(fail('handoff_timeout','媒体上传处理超时')),timeoutMs);
      let rejectAbort;const interrupted=new Promise((_,reject)=>{rejectAbort=reject;});interrupted.catch(()=>{});
      const onAbort=()=>rejectAbort(controller.signal.reason);controller.signal.addEventListener('abort',onAbort,{once:true});
      const current=()=>guard(controller.signal);
      const wait=async fn=>{current();const result=await Promise.race([Promise.resolve().then(()=>{current();return fn();}),interrupted]);current();return result;};
      async function decode(bytes,type){const url=createObjectURL(bytes);try{return await wait(()=>type==='image'?decodeImage(url,{signal:controller.signal}):decodeVideo(url,{signal:controller.signal}));}finally{revokeObjectURL(url);}}
      try{
        current();setStatus(op,'validating');const prior=existing(op.id);
        if(prior){
          const p=checkProvenance(prior);if(p.mediaType!==op.type||op.inputHash&&p.inputHash!==op.inputHash)throw fail('operation_conflict','相同上传 operationId 不可替换媒体数据');
          const asset=op.type==='image'?(prior.fullImage||prior.image):prior.video;
          if(prior.type!==op.type||asset!==p.outputMedia||prior.clip!=null||prior.trim!=null)throw fail('output_changed','已有上传结果被修改');
          const response=await wait(async()=>fetchImpl(await localAssets.url(asset),{signal:controller.signal}));if(!response?.ok)throw fail('asset_unavailable','已有上传素材无法读取');
          const savedBlob=await wait(()=>response.blob());checkedBlob(savedBlob,op.type);
          const bytes=await wait(()=>savedBlob.arrayBuffer());if(await wait(()=>hash(bytes))!==p.outputHash)throw fail('output_changed','已有上传素材字节已变化');
          if(op.type==='image')checkedPng(bytes);
          const actual=await decode(savedBlob,op.type);
          if(!dimensions(actual)||actual.width!==p.width||actual.height!==p.height||op.type==='video'&&(!duration(actual.duration)||Math.abs(actual.duration-p.duration)>.1))throw fail('output_changed','已有上传内容与记录不符');
          if(!nodes().includes(prior)||(op.type==='image'?(prior.fullImage||prior.image):prior.video)!==asset||prior.clip!=null||prior.trim!=null)throw fail('output_changed','验证期间已有上传结果被修改');
          op.inputHash=p.inputHash;op.asset=asset;op.metadata=actual;op.timing=p.timing;op.node=prior;
        }else{
          if(!blob)throw fail('operation_missing','没有可恢复的上传节点');
          let output=blob,actual=await decode(blob,op.type);
          if(!dimensions(actual))throw fail('invalid_dimensions','实际媒体像素尺寸超出支持范围');
          if(op.type==='video'){
            const raw=actual,inputDuration=Number.isFinite(raw.duration)?raw.duration:null,expected=binding.expectedDuration??raw.duration;
            if(!duration(expected))throw fail('invalid_duration','视频没有有效有限时长，请确认 0.1–120 秒的录制时长后重试');
            setStatus(op,'processing');output=await wait(()=>localMedia.process('finalize',blob,{duration:expected,signal:controller.signal}));checkedBlob(output,'video');
            if(mime(output)!=='video/mp4')throw fail('invalid_output','本地转换没有返回 MP4 视频');
            actual=await decode(output,'video');
            if(!dimensions(actual)||!duration(actual.duration)||Math.abs(actual.duration-expected)>.1||actual.width!==Math.floor(raw.width/2)*2||actual.height!==Math.floor(raw.height/2)*2)throw fail('invalid_output','转换后视频实际时长或尺寸不符合本地处理结果');
            op.timing={inputDuration,expectedDuration:expected,durationAdjusted:inputDuration===null?null:Math.abs(inputDuration-expected)>.1,durationNormalized:true,dimensionsAdjusted:actual.width!==raw.width||actual.height!==raw.height,outputFps:30,...(binding.fps?{requestedFps:binding.fps}:{})};
          }
          const outputBytes=await wait(()=>output.arrayBuffer()),outputHash=await wait(()=>hash(outputBytes));
          const asset=await wait(()=>localAssets.put(output));if(typeof asset!=='string'||!asset.startsWith('asset:'))throw fail('asset_save_failed','媒体未写入本地素材存储');
          op.asset=asset;op.metadata=actual;current();
          const provenance={kind,operationId:op.id,bindingKey,binding,mediaType:op.type,inputHash:op.inputHash,outputHash,outputMedia:asset,width:actual.width,height:actual.height,...(op.type==='video'?{duration:actual.duration,timing:op.timing}:{})};
          const width=Math.min(446,actual.width),height=width*actual.height/actual.width,title=binding.title||(op.type==='image'?'白模画面':'白模视频');
          const patch={type:op.type,title,width,height,provenance,...(op.type==='image'?{image:asset,fullImage:asset}:{video:asset,image:actual.poster,duration:actual.duration,videoMetadata:{width:actual.width,height:actual.height,duration:actual.duration}})};
          let added;
          if(sourceNodeId)added=app.createConnected(sourceNodeId,[patch])[0];
          else{const view=app.getState().view;if(!view||!Number.isFinite(view.x)||!Number.isFinite(view.y)||!Number.isFinite(view.scale)||view.scale<=0)throw fail('invalid_view','当前画布视口无效');added=app.addNode(op.type,{x:position.x*view.scale+view.x,y:position.y*view.scale+view.y},op.type==='image'?asset:null,title,patch);}
          if(!added?.id)throw fail('apply_failed','上传节点创建失败');op.node=added;
        }
        // An applied node must be saved even if its widget closes after insertion.
        return await persist(op);
      }catch(error){if(op.status!=='save_failed'){op.error=error;setStatus(op,controller.signal.aborted?'cancelled':'failed');}throw error;}
      finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);controller.signal.removeEventListener('abort',onAbort);if(!controller.signal.aborted)controller.abort();}
    }
    async function submit(payload,{signal}={}){
      guard(signal);
      if(!payload||Object.keys(payload).some(key=>!['operationId','type','blob'].includes(key)))throw fail('invalid_payload','上传只能携带 operationId、媒体类型和实际 Blob');
      const id=text(payload.operationId,'operationId'),type=payload.type,blob=payload.blob;
      if(!allowedTypes.includes(type))throw fail('type_not_allowed','宿主未允许上传此类媒体');checkedBlob(blob,type);
      const bytes=await blob.arrayBuffer();guard(signal);if(type==='image')checkedPng(bytes);
      const inputHash=await hash(bytes);guard(signal);let op=operations.get(id);
      if(op){belongs(op);if(op.type!==type||op.inputHash!==inputHash)throw fail('operation_conflict','相同上传 operationId 不可替换媒体数据');if(op.pending)return op.pending;if(op.node){outputGuard(op);if(op.saved)return receipt(op);return retrySave(id,{signal});}}
      // A new host-confirmed submit retries an unapplied failure with a fresh controller.
      // work() first reconciles provenance in case insertion succeeded before an adapter threw.
      op={id,type,bindingKey,inputHash,status:'queued',saved:false};operations.set(id,op);op.pending=work(op,blob,signal).finally(()=>{delete op.pending;});return op.pending;
    }
    async function retrySave(id,{signal}={}){
      guard(signal);text(id,'operationId');let op=operations.get(id);
      if(op){belongs(op);if(op.pending)return op.pending;if(op.node){op.pending=persist(op).finally(()=>{delete op.pending;});return op.pending;}}
      const prior=existing(id);if(!prior)throw fail('operation_missing','没有可重试保存的上传节点');const p=checkProvenance(prior);
      op={id,type:p.mediaType,bindingKey,inputHash:p.inputHash,status:'queued',saved:false};operations.set(id,op);op.pending=work(op,null,signal).finally(()=>{delete op.pending;});return op.pending;
    }
    return {submit,retrySave,get:id=>{const op=operations.get(id);return op?.bindingKey===bindingKey?receipt(op):null;}};
  }
  return {bind};
}
