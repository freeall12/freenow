import {isGenerationMediaRef} from '../generation-results/media-ref.mjs';
import {captureResultSnapshot,assertResultSnapshot} from '../generation-results/plan.mjs';
import {colorAdjustUri,colorAdjustTool,colorAdjustLimits as limits,colorAdjustNodeId,colorAdjustParams,colorAdjustPixels,prepareColorAdjust,validateColorAdjustApplyRequest,resolveColorAdjustContext,resolveColorAdjustReply,validateColorAdjustState} from './color-adjust.mjs';
const fail=(code,message)=>{throw Object.assign(Error(message),{code});};
const clone=value=>structuredClone(value),same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const hash=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
const abort=signal=>{if(signal?.aborted)throw signal.reason||new DOMException('调色已取消','AbortError');};
function cancellable(promise,signal){if(!signal)return promise;abort(signal);return new Promise((resolve,reject)=>{const cancel=()=>reject(signal.reason||new DOMException('调色已取消','AbortError'));signal.addEventListener('abort',cancel,{once:true});Promise.resolve(promise).then(value=>{signal.removeEventListener('abort',cancel);resolve(value);},error=>{signal.removeEventListener('abort',cancel);reject(error);});});}
const dimensions=(width,height)=>{if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||width>limits.maxSide||height>limits.maxSide||width*height>limits.maxPixels)fail('image_dimensions','源图尺寸超过本地调色限制');};
const png=bytes=>bytes.length>32&&[137,80,78,71,13,10,26,10].every((b,i)=>bytes[i]===b);
// The iframe previews M_; the host runs the identical transform on full source
// pixels. This function never substitutes the preview thumbnail as the output.
export async function renderColorAdjustImage(blob,{params,previewOnly=false,signal}={}) {
  abort(signal);const url=URL.createObjectURL(blob);let image;
  try {
    image=await new Promise((resolve,reject)=>{const item=new Image();const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',cancel);item.onload=item.onerror=null;};const cancel=()=>{cleanup();item.src='';reject(signal?.reason||Error('图片解码已取消'));};const timer=setTimeout(()=>{cleanup();item.src='';reject(Error('图片解码超时'));},limits.timeoutMs);item.onload=()=>{cleanup();resolve(item);};item.onerror=()=>{cleanup();reject(Error('真实源图解码失败'));};signal?.addEventListener('abort',cancel,{once:true});item.src=url;});
    abort(signal);const width=image.naturalWidth,height=image.naturalHeight;dimensions(width,height);
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d',{willReadFrequently:true});if(!ctx)fail('canvas_unavailable','无法读取本地图片像素');ctx.drawImage(image,0,0);
    if(!previewOnly){const pixels=ctx.getImageData(0,0,width,height),out=ctx.createImageData(width,height);const normalized=colorAdjustParams(params,true);for(let at=0;at<pixels.data.length;at+=65536*4){abort(signal);const end=Math.min(at+65536*4,pixels.data.length);colorAdjustPixels(pixels.data.subarray(at,end),normalized,out.data.subarray(at,end));if(end<pixels.data.length)await new Promise(resolve=>setTimeout(resolve,0));}abort(signal);ctx.putImageData(out,0,0);}
    const scale=Math.min(1,limits.previewSide/Math.max(width,height)),preview=document.createElement('canvas');preview.width=Math.max(1,Math.round(width*scale));preview.height=Math.max(1,Math.round(height*scale));preview.getContext('2d').drawImage(canvas,0,0,preview.width,preview.height);const data_uri=preview.toDataURL('image/png');if(data_uri.length>limits.previewChars)fail('preview_limit','真实预览超过允许容量');
    let output;if(!previewOnly)output=await cancellable(new Promise((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(Error('实际调色PNG编码失败')),'image/png')),signal);
    abort(signal);return {width,height,preview:{data_uri},...(output?{blob:output}:{})};
  } finally {URL.revokeObjectURL(url);if(image)image.src='';}
}
export function createColorAdjustRuntime({app,localAssets,store,getProjectId,persistConversation,fetchImpl=(...args)=>fetch(...args),renderImage=renderColorAdjustImage}={}) {
  for(const [name,fn]of Object.entries({'app.getState':app?.getState,'app.createConnected':app?.createConnected,'localAssets.put':localAssets?.put,'localAssets.url':localAssets?.url,'store.save':store?.save,getProjectId,persistConversation,renderImage}))if(typeof fn!=='function')throw TypeError(name+' adapter is required');
  const preparations=new WeakMap(),operations=new Map(),graph=()=>app.getState();
  async function read(media,limit,signal,check=()=>{}) {
    abort(signal);check();const url=await cancellable(isGenerationMediaRef(media)?media:localAssets.url(media),signal);abort(signal);check();if(typeof url!=='string'||!(/^(?:https?:|blob:|data:image\/(?:png|jpeg|webp);base64,)/.test(url)||isGenerationMediaRef(url)))fail('media_unavailable','真实图片没有可读取地址');
    const controller=new AbortController(),cancel=()=>controller.abort(signal.reason),timer=setTimeout(()=>controller.abort(Error('真实图片读取超时')),limits.timeoutMs);signal?.addEventListener('abort',cancel,{once:true});
    let reader,responseBody;
    try {
      const response=await cancellable(fetchImpl(url,{signal:controller.signal,...(isGenerationMediaRef(url)?{redirect:'error',mode:'same-origin',credentials:'same-origin'}:{})}),controller.signal);responseBody=response?.body;if(responseBody?.getReader)reader=responseBody.getReader();abort(signal);check();if(!response?.ok)fail('media_unavailable','真实图片读取失败');const declared=Number(response.headers?.get('content-length'));if(Number.isFinite(declared)&&declared>limit)fail('media_limit','图片字节超过允许容量');
      const mime=response.headers?.get('content-type')?.split(';')[0]||'application/octet-stream';let bytes;
      if(reader){let total=0;const chunks=[];for(;;){const item=await cancellable(reader.read(),controller.signal);abort(controller.signal);check();if(item.done)break;total+=item.value.byteLength;if(total>limit)fail('media_limit','真实图片字节超过允许容量');chunks.push(item.value);}bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}}
      else {bytes=new Uint8Array(await cancellable(response.arrayBuffer(),controller.signal));if(bytes.length>limit)fail('media_limit','图片字节超过允许容量');}
      abort(controller.signal);check();if(!bytes.length)fail('media_unavailable','真实图片为空');return {bytes,blob:new Blob([bytes],{type:mime}),sha256:await hash(bytes)};
    } catch(error){try{if(reader)Promise.resolve(reader.cancel()).catch(()=>{});else Promise.resolve(responseBody?.cancel?.()).catch(()=>{});}catch{}throw error;} finally {clearTimeout(timer);signal?.removeEventListener('abort',cancel);try{reader?.releaseLock();}catch{}}
  }
  function getSource(data){const id=colorAdjustNodeId(data.node_ref),node=graph().nodes.find(n=>n.id===id);if(node?.type!=='image'||!(node.fullImage||node.image))fail('invalid_source','调色来源须为当前真实图片节点');return node;}
  async function prepareAppArgs(args,{signal,isCurrent=()=>true}={}) {
    if(args.resource_uri!==colorAdjustUri)return args;const data=args.data;
    if(!data||Object.keys(data).some(k=>!['node_ref','params','suggested','locale'].includes(k)))fail('invalid_input','调色来源和预览须由宿主读取');
    const source=getSource(data),sourceSnapshot=captureResultSnapshot(graph().nodes,graph().edges,source.id),projectId=getProjectId();
    const guard=()=>{abort(signal);if(!isCurrent()||projectId!==getProjectId())fail('stale_color_app','调色所属画布或会话已切换');assertResultSnapshot(sourceSnapshot,graph().nodes,graph().edges);};
    guard();const media=await read(source.fullImage||source.image,limits.sourceBytes,signal,guard),rendered=await cancellable(renderImage(media.blob,{previewOnly:true,signal}),signal);guard();dimensions(rendered.width,rendered.height);
    const prepared={...clone(args),data:{...clone(data),preview:rendered.preview}};const canonical=prepareColorAdjust(prepared.data,args.title);preparations.set(prepared,{responseFingerprint:JSON.stringify(canonical),projectId,sourceSnapshot:clone(sourceSnapshot),source_sha256:media.sha256,width:rendered.width,height:rendered.height});return prepared;
  }
  function bindPreparedResult(result,args){if(args.resource_uri!==colorAdjustUri)return result;const binding=preparations.get(args);if(!binding||binding.projectId!==getProjectId()||JSON.stringify(result.response)!==binding.responseFingerprint)fail('invalid_source','缺少调色原始来源绑定或实际预览已变化');assertResultSnapshot(binding.sourceSnapshot,graph().nodes,graph().edges);return {...result,colorAdjustSourceContext:clone(binding)};}
  function capture(data,{trace,chat,isCurrent}={}) {
    const binding=trace?.result?.colorAdjustSourceContext;if(typeof isCurrent!=='function'||!trace?.id||!chat?.id||!binding||binding.projectId!==getProjectId()||binding.sourceSnapshot.sourceNodeId!==colorAdjustNodeId(data.node_ref)||JSON.stringify(data)!==binding.responseFingerprint)fail('invalid_source','调色缺少当前真实会话来源');
    const scope={projectId:getProjectId(),chatId:chat.id,traceId:trace.id},lifetime=new AbortController(),operationSignal=signal=>signal?AbortSignal.any([signal,lifetime.signal]):lifetime.signal;
    function dispose(){lifetime.abort(new DOMException('调色页面已关闭','AbortError'));for(const [key,op]of operations)if(op.scopeKey===JSON.stringify(scope))operations.delete(key);}
    const guard=(signal)=>{abort(lifetime.signal);abort(signal);if(!isCurrent()||scope.projectId!==getProjectId()||trace.result.response!==data||JSON.stringify(data)!==binding.responseFingerprint)fail('stale_color_app','调色来源卡片已替换或会话已切换');assertResultSnapshot(binding.sourceSnapshot,graph().nodes,graph().edges);return true;};
    function validateNode(receipt){const node=graph().nodes.find(n=>n.id===receipt?.node_id),p=node?.provenance;if(!node||node.type!=='image'||p?.kind!=='color-adjust'||!same(p.scope,scope)||!same(p.sourceSnapshot,binding.sourceSnapshot)||!same(p.receipt,receipt)||node.image!==p.outputMedia||node.fullImage!==p.outputMedia||!p.outputMedia?.startsWith('asset:'))fail('output_changed','实际调色节点已删除、撤销或修改');return node;}
    async function validateReceiptCurrent(receipt,{signal}={}) {signal=operationSignal(signal);guard(signal);const node=validateNode(receipt),check=()=>{guard(signal);validateNode(receipt);};if(receipt.source_sha256!==binding.source_sha256||receipt.source_node_ref!==data.node_ref)fail('source_changed','调色回执来源不一致');const src=await read(getSource(data).fullImage||getSource(data).image,limits.sourceBytes,signal,check);if(src.sha256!==binding.source_sha256)fail('source_changed','原始图片实际字节已变化');const actual=await read(node.fullImage,limits.outputBytes,signal,check);if(actual.sha256!==receipt.output_sha256||!png(actual.bytes))fail('output_changed','实际PNG字节与保存回执不符');check();return clone(receipt);}
    guard();return {scope,binding,guard,operationSignal,dispose,isCurrent:()=>{try{guard();return true;}catch{return false;}},validateReceiptCurrent,readReceipt:()=>trace.colorAdjustReceipt||null,validateState:value=>{guard();return validateColorAdjustState(value,data);},reply:message=>{guard();return resolveColorAdjustReply(message,data);}};
  }
  async function apply(args,trace,chat,{callId,signal,isCurrent,sourceContext,userAction}={}) {
    if(userAction!==true)fail('user_action_required','应用调色需要当前页面用户动作');const context=sourceContext,data=trace.result.response;if(!context||typeof isCurrent!=='function')fail('invalid_source','缺少调色当前操作来源');
    signal=context.operationSignal(signal);
    const current=()=>{context.guard(signal);if(!isCurrent()||trace.result.response!==data)fail('stale_color_action','调色应用已重载或状态已替换');};current();
    const request=validateColorAdjustApplyRequest({name:colorAdjustTool,arguments:args,_meta:{'tapnow/callId':callId}},data),fingerprint=JSON.stringify({source:context.binding.source_sha256,params:request.params}),key=JSON.stringify([context.scope,request.callId]),scopeKey=JSON.stringify(context.scope),previous=operations.get(key);
    if(previous&&previous.fingerprint!==fingerprint)fail('operation_conflict','同一调色调用不能更换参数');
    if(previous?.pending)return previous.pending;
    const equivalent=[...operations.values()].find(op=>op.scopeKey===scopeKey&&op.fingerprint===fingerprint&&op.pending);if(equivalent){operations.set(key,equivalent);return equivalent.pending;}
    if(!previous&&operations.size>=128){const idle=[...operations].find(([,candidate])=>!candidate.pending);if(idle)operations.delete(idle[0]);else fail('too_many_operations','调色操作过多，请等待当前操作完成');}
    const op=previous||{fingerprint,scopeKey};operations.set(key,op);op.pending=perform().finally(()=>{delete op.pending;});return op.pending;
    async function perform(){
      const matches=graph().nodes.filter(n=>n.provenance?.kind==='color-adjust'&&same(n.provenance.scope,context.scope)&&(n.provenance.callId===callId||n.provenance.requestFingerprint===fingerprint));if(matches.length>1)fail('ambiguous_operation','同一调色已有多个输出');let node=matches[0]||op.node,receipt;
      const committed=trace.colorAdjustReceipt;if(!node&&committed&&same(committed.params,request.params)&&committed.source_sha256===context.binding.source_sha256){await context.validateReceiptCurrent(committed,{signal});fail('output_changed','已有调色回执的节点失效，不会自动重建');}
      if(node){if(!graph().nodes.includes(node)||node.provenance?.requestFingerprint!==fingerprint)fail('output_changed','既有调色已删除、撤销或修改，不会自动重建');receipt=node.provenance.receipt;await context.validateReceiptCurrent(receipt,{signal});current();}
      else {
        const source=getSource(data),actual=await read(source.fullImage||source.image,limits.sourceBytes,signal,current);if(actual.sha256!==context.binding.source_sha256)fail('source_changed','原始图片实际字节已变化');
        const rendered=await cancellable(renderImage(actual.blob,{params:request.params,signal}),signal);current();dimensions(rendered.width,rendered.height);if(rendered.width!==context.binding.width||rendered.height!==context.binding.height||!(rendered.blob instanceof Blob)||!rendered.blob.size||rendered.blob.size>limits.outputBytes||rendered.blob.type!=='image/png')fail('invalid_output','本地调色输出必须为完整源图尺寸的真实PNG');
        const bytes=new Uint8Array(await rendered.blob.arrayBuffer());current();if(!png(bytes))fail('invalid_output','调色产物不是实际PNG');const output_sha256=await hash(bytes);current();const asset=await cancellable(localAssets.put(rendered.blob),signal);current();if(typeof asset!=='string'||!/^asset:[A-Za-z0-9_-]+$/.test(asset))fail('asset_save_failed','调色PNG未保存为本地素材');
        const saved=await read(asset,limits.outputBytes,signal,current);if(saved.sha256!==output_sha256)fail('asset_save_failed','实际保存调色图片字节不一致');const decoded=await cancellable(renderImage(saved.blob,{previewOnly:true,signal}),signal);current();if(decoded.width!==rendered.width||decoded.height!==rendered.height)fail('asset_save_failed','已保存PNG实际解码尺寸不一致');
        const patch={type:'image',title:'调色结果',image:asset,fullImage:asset,width:320,height:320*rendered.height/rendered.width,pixelWidth:rendered.width,pixelHeight:rendered.height,provenance:{kind:'color-adjust',callId,scope:clone(context.scope),sourceSnapshot:clone(context.binding.sourceSnapshot),requestFingerprint:fingerprint,outputMedia:asset}};
        const added=app.createConnected(source.id,[patch]);node=added?.[0];if(added?.length!==1||!node?.id||!graph().nodes.includes(node))fail('apply_failed','实际调色节点创建失败');colorAdjustNodeId('node/'+node.id);
        receipt={node_id:node.id,source_node_ref:data.node_ref,params:clone(request.params),source_sha256:actual.sha256,output_sha256,width:rendered.width,height:rendered.height};node.provenance.receipt=clone(receipt);op.node=node;
      }
      op.node=node;
      // Once visible, persist the graph even if the iframe closes during save.
      if(await store.save(app.projectSnapshot?.()||graph(),context.scope.projectId)===false)fail('save_failed','调色图片已加入画布，但画布保存失败');await store.flush?.();current();await context.validateReceiptCurrent(receipt,{signal});current();
      const old=trace.colorAdjustReceipt,next=clone(receipt);trace.colorAdjustReceipt=next;
      try {if(await persistConversation()===false)fail('conversation_save_failed','调色图片已保存，但会话回执保存失败');current();await context.validateReceiptCurrent(receipt,{signal});current();}
      catch(error){if(trace.colorAdjustReceipt===next){if(old===undefined)delete trace.colorAdjustReceipt;else trace.colorAdjustReceipt=old;}try{if(await persistConversation()===false)throw Error('补偿事务未提交');}catch{fail('conversation_rollback_failed','调色节点已保存，会话回执及补偿保存失败');}throw error;}
      return clone(receipt);
    }
  }
  async function setModelContext(value,trace,chat,{sourceContext,isCurrent,userAction,signal}={}) {if(userAction!==true||typeof isCurrent!=='function'||!isCurrent())fail('user_action_required','调色上下文需要当前页面用户动作');const receipt=sourceContext?.readReceipt();if(!receipt)fail('missing_receipt','没有实际保存的调色输出');await sourceContext.validateReceiptCurrent(receipt,{signal});if(!isCurrent())fail('stale_color_action','调色页面已重载');const context=resolveColorAdjustContext(value,trace.result.response,receipt),old=trace.colorAdjustContext,next=clone(context);trace.colorAdjustContext=next;try{if(await persistConversation()===false)fail('conversation_save_failed','调色上下文保存失败');if(!isCurrent()||sourceContext.readReceipt()!==receipt)fail('stale_color_action','保存期间调色页面或回执变化');await sourceContext.validateReceiptCurrent(receipt,{signal});}catch(error){if(trace.colorAdjustContext===next){if(old===undefined)delete trace.colorAdjustContext;else trace.colorAdjustContext=old;}try{if(await persistConversation()===false)throw Error('补偿事务未提交');}catch{fail('conversation_rollback_failed','调色上下文及补偿保存失败');}throw error;}return {};}
  return {prepareAppArgs,bindPreparedResult,capture,apply,setModelContext};
}
