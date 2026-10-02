import {isGenerationMediaRef} from '../generation-results/media-ref.mjs';
import {adReviewUri,adReviewBudget as budget,adReviewFields,adReviewText,prepareAdReview,resolveAdReviewReply} from './ad-review.mjs';
import {materializationScope} from '../world-node/materialization.mjs';
import {openVideoFrames} from '../../../video-frames.mjs';
const fail=message=>{throw Error(message);};
const hash=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
const clone=value=>structuredClone(value);
const signature=node=>JSON.stringify([node?.id,node?.type,node?.fullImage,node?.image,node?.video,node?.clip??null,node?.trim??null]);
const fingerprint=response=>JSON.stringify({...response,items:response.items.map(({preview_url,poster_url,...item})=>item)});
async function imageInfo(blob) {const image=await createImageBitmap(blob);try{return {width:image.width,height:image.height};}finally{image.close();}}
async function videoInfo(url,{signal}={}) {const reader=await openVideoFrames(url,signal);try{await reader.at(0,320);return {duration:reader.duration,width:reader.width,height:reader.height};}finally{reader.dispose();}}
function dimensions(actual,media) {if(!Number.isInteger(actual?.width)||actual.width<1||actual.width>16384||!Number.isInteger(actual.height)||actual.height<1||actual.height>16384||actual.width*actual.height>33554432||media==='video'&&(!Number.isFinite(actual.duration)||actual.duration<=0||actual.duration>36000))fail('广告审核来源无法真实解码或超过32MP限制');}
async function inline(blob,scope) {const bytes=new Uint8Array(await scope.wait(()=>blob.arrayBuffer()));let binary='';for(let at=0;at<bytes.length;at+=32768)binary+=String.fromCharCode(...bytes.subarray(at,at+32768));return {url:`data:${blob.type};base64,${btoa(binary)}`,sha256:await scope.wait(()=>hash(bytes))};}
function bytesFrom(url,media) {
  const pattern=media==='image'?/^data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/:/^data:video\/(?:mp4|webm);base64,([A-Za-z0-9+/]+={0,2})$/;
  const match=pattern.exec(url??'');if(!match||match[1].length%4||match[1].length>Math.ceil(budget.mediaBytes/3)*4)fail('广告审核缺少真实本地媒体字节');
  const binary=atob(match[1]);if(!binary.length||binary.length>budget.mediaBytes||btoa(binary)!==match[1])fail('广告审核预览字节无效');return Uint8Array.from(binary,char=>char.charCodeAt(0));
}
/** Host-owned source bytes only. No URL supplied by a model is fetched, and
 * local assets that still point to a remote provider must be localized first. */
export function createAdReviewRuntime({app,localAssets,getProjectId,fetchImpl=(...args)=>fetch(...args),decodeImage=imageInfo,decodeVideo=videoInfo,
  createObjectURL=blob=>URL.createObjectURL(blob),revokeObjectURL=url=>URL.revokeObjectURL(url),baseOrigin=globalThis.location?.origin,timeoutMs=budget.timeoutMs}={}) {
  for(const [name,fn]of Object.entries({'app.getState':app?.getState,'LocalAssets.url':localAssets?.url,getProjectId,fetchImpl,decodeImage,decodeVideo}))if(typeof fn!=='function')throw TypeError(name+' adapter is required');
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>budget.timeoutMs)throw TypeError('invalid ad review timeout');
  const preparations=new WeakMap(),nodes=()=>app.getState().nodes;
  function source(id,media) {const node=nodes().find(node=>node.id===id);if(node?.type!==media||typeof(media==='image'?node.fullImage||node.image:node.video)!=='string'||!(media==='image'?node.fullImage||node.image:node.video)||media==='video'&&(node.clip!=null||node.trim!=null))fail('广告审核node_ref必须对应当前真实完整图片或视频节点，虚拟裁剪请先导出');return node;}
  function localUrl(url) {
    if(typeof url!=='string')fail('广告审核来源地址无法解析');
    if(isGenerationMediaRef(url))return url;
    if(/^data:(?:image\/(?:png|jpeg|webp)|video\/(?:mp4|webm));base64,/.test(url))return url;
    if(/^blob:/.test(url)){if(baseOrigin&&!url.startsWith(`blob:${baseOrigin}/`))fail('广告审核Blob不属于当前本地宿主');return url;}
    let parsed;try{parsed=new URL(url,baseOrigin);}catch{fail('广告审核媒体须先保存为本地素材');}
    if(!baseOrigin||parsed.origin!==baseOrigin||!['http:','https:'].includes(parsed.protocol)||parsed.username||parsed.password)fail('广告审核禁止请求原站或外部媒体，请先完成本地素材保存');return parsed.href;
  }
  async function read(node,media,scope,limit) {
    const original=media==='image'?node.fullImage||node.image:node.video;
    const url=localUrl(isGenerationMediaRef(original)?original:await scope.wait(()=>localAssets.url(original)));
    const response=await scope.wait(()=>fetchImpl(url,{signal:scope.signal,redirect:'error',...(isGenerationMediaRef(url)?{mode:'same-origin',credentials:'same-origin'}:{})}),{disposeLate:value=>value?.body?.cancel?.().catch(()=>{})});let reader,complete=false;
    try {
      if(!response?.ok)fail('广告审核真实媒体读取失败');
      const type=response.headers?.get?.('content-type')?.split(';')[0]?.trim(),types=media==='image'?['image/png','image/jpeg','image/webp']:['video/mp4','video/webm'];
      if(!types.includes(type)||Number(response.headers?.get?.('content-length'))>limit)fail('广告审核媒体类型无效或超出8MiB单项/16MiB总量预算');
      if(!response.body?.getReader)fail('当前环境无法有界读取广告审核媒体');reader=response.body.getReader();const chunks=[];let size=0;
      for(;;){const chunk=await scope.wait(()=>reader.read());if(chunk.done){complete=true;break;}size+=chunk.value.byteLength;if(size>limit)fail('广告审核媒体实际字节超过预算');chunks.push(chunk.value);}
      if(!size)fail('广告审核真实媒体为空');return new Blob(chunks,{type});
    }finally{if(!complete){if(reader)reader.cancel().catch(()=>{});else response?.body?.cancel?.().catch(()=>{});}reader?.releaseLock();}
  }
  async function prepareAppArgs(args,{signal,isCurrent=()=>true}={}) {
    if(args.resource_uri!==adReviewUri)return args;
    adReviewFields(args.data,['stage','batch','items','locale']);if(!Array.isArray(args.data.items)||!args.data.items.length||args.data.items.length>48)fail('广告审核需要1–48个真实素材引用');
    const entries=args.data.items.map(item=>{
      adReviewFields(item,['combo','media','node_ref','node_title','hook','angle','persona','meta']);adReviewText(item.node_ref,185,true);
      const match=/^node\/([A-Za-z0-9][A-Za-z0-9_-]{0,179})$/.exec(item.node_ref);if(!match||!['image','video'].includes(item.media))fail('广告审核素材必须提供实际node/<id>');
      const node=source(match[1],item.media),{node_ref,...copy}=item;return {item:copy,node};
    });
    const response=prepareAdReview({...clone(args.data),items:entries.map(entry=>entry.item)},args.title||'广告创意审核'),projectId=getProjectId(),snapshots=entries.map(({node,item})=>({nodeId:node.id,combo:item.combo,media:item.media,signature:signature(node)}));
    if(typeof projectId!=='string'||!projectId)fail('广告审核缺少当前本地项目身份');
    const check=()=>{if(!isCurrent()||getProjectId()!==projectId||entries.some(({node,item},index)=>source(node.id,item.media)!==node||signature(node)!==snapshots[index].signature))fail('准备广告审核时项目或真实素材来源已切换');};
    const scope=materializationScope({signal,validateSources:check,timeoutMs});let total=0;const cached=new Map();
    try {
      for(let index=0;index<entries.length;index++){
        const {node,item}=entries[index],key=JSON.stringify([item.media,item.media==='image'?node.fullImage||node.image:node.video]);let actual=cached.get(key);
        if(!actual){const blob=await read(node,item.media,scope,Math.min(budget.mediaBytes,budget.totalBytes-total));total+=blob.size;let info;
          if(item.media==='image')info=await scope.wait(()=>decodeImage(blob,{signal:scope.signal}),{disposeLate:value=>value?.close?.()});
          else {const url=createObjectURL(blob);try{info=await scope.wait(()=>decodeVideo(url,{signal:scope.signal}));}finally{revokeObjectURL(url);}}
          dimensions(info,item.media);actual={...await inline(blob,scope),...info};cached.set(key,actual);
        }
        response.items[index].preview_url=actual.url;Object.assign(snapshots[index],{mediaSha256:actual.sha256,width:actual.width,height:actual.height,...item.media==='video'?{duration:actual.duration}:{}});
      }
      check();const {title,...rawData}=response,{title:validatedTitle,...data}=prepareAdReview(rawData,title),prepared={...clone(args),data};
      preparations.set(prepared,{projectId,responseFingerprint:fingerprint(response),sources:snapshots});return prepared;
    }finally{scope.close();}
  }
  function bindPreparedResult(result,args) {
    if(args.resource_uri!==adReviewUri)return result;const binding=preparations.get(args);
    if(!binding||binding.projectId!==getProjectId()||fingerprint(result.response)!==binding.responseFingerprint||binding.sources.some(item=>signature(source(item.nodeId,item.media))!==item.signature))fail('广告审核缺少有效真实来源绑定');
    return {...result,adReviewSourceContext:clone(binding)};
  }
  function capture(response,{trace,chat,isCurrent}={}) {
    const result=trace?.result,stored=result?.adReviewSourceContext;
    if(!trace?.id||!chat?.id||!stored||typeof isCurrent!=='function'||result.response!==response)fail('广告审核缺少当前会话真实来源绑定');
    const {title,...data}=response,canonical=prepareAdReview(data,title),binding=clone(stored),baseline=fingerprint(canonical),urls=response.items.map(item=>item.preview_url);
    if(!Array.isArray(binding.sources)||binding.responseFingerprint!==baseline||JSON.stringify(binding.sources.map(item=>[item.combo,item.media]))!==JSON.stringify(response.items.map(item=>[item.combo,item.media])))fail('广告审核来源与展示数据不一致');
    let disposed=false,previewVerified=false,pending=null,bytePending=null;const controllers=new Set();
    const current=()=>{try{return !disposed&&isCurrent()===true&&getProjectId()===binding.projectId&&trace.result===result&&result.response===response&&result.adReviewSourceContext===stored&&fingerprint(response)===baseline&&response.items.every((item,index)=>item.preview_url===urls[index]&&item.poster_url===undefined)&&binding.sources.every(item=>/^[a-f0-9]{64}$/.test(item.mediaSha256)&&signature(source(item.nodeId,item.media))===item.signature);}catch{return false;}};
    const check=()=>{if(!current())fail('广告审核所属项目、媒体或应用来源已变化');};
    async function verify(verifyBytes) {
      check();const controller=new AbortController();controllers.add(controller);const scope=materializationScope({signal:controller.signal,validateSources:check,timeoutMs});
      try {
        if(!previewVerified){for(let index=0;index<binding.sources.length;index++){const item=binding.sources[index];if(await scope.wait(()=>hash(bytesFrom(response.items[index].preview_url,item.media)))!==item.mediaSha256)fail('广告审核本地预览与原媒体哈希不符');}previewVerified=true;}
        if(verifyBytes){let total=0;const seen=new Map();for(const item of binding.sources){const node=source(item.nodeId,item.media),key=JSON.stringify([item.media,item.media==='image'?node.fullImage||node.image:node.video]);let digest=seen.get(key);if(!digest){const blob=await read(node,item.media,scope,Math.min(budget.mediaBytes,budget.totalBytes-total));total+=blob.size;digest=await scope.wait(async()=>hash(await blob.arrayBuffer()));seen.set(key,digest);}if(digest!==item.mediaSha256)fail('广告审核原媒体实际字节已变化，请重新打开审核');}}
        check();return true;
      }finally{scope.close();controllers.delete(controller);}
    }
    function guard({verifyBytes=false}={}) {if(verifyBytes){if(bytePending)return bytePending;bytePending=verify(true).finally(()=>{bytePending=null;});return bytePending;}if(bytePending)return bytePending;if(pending)return pending;pending=verify(false).finally(()=>{pending=null;});return pending;}
    async function reply(message,savedState) {
      check();const receipt=await resolveAdReviewReply(message,response,savedState);await guard({verifyBytes:true});check();
      const sources=binding.sources.map(item=>({combo:item.combo,node_ref:'node/'+item.nodeId,media:item.media,media_sha256:item.mediaSha256,width:item.width,height:item.height,...item.duration!==undefined?{duration_s:item.duration}:{}}));
      const text=receipt.text+'\n真实本地素材引用（已核对源字节，不含媒体载荷）：\n'+JSON.stringify({project_id:binding.projectId,sources});
      if(text.length>16384)fail('广告审核真实来源交接过长，请减少说明后重试');
      const handoffId='ad_review_'+await hash(new TextEncoder().encode(JSON.stringify({verdict:receipt.metadata.handoffId,project_id:binding.projectId,sources})));check();
      return {...receipt,text,metadata:{...receipt.metadata,handoffId},sources};
    }
    const dispose=()=>{disposed=true;for(const controller of controllers)controller.abort(Error('广告审核已关闭，读取已中止'));};check();return {guard,isCurrent:current,dispose,reply};
  }
  return {prepareAppArgs,bindPreparedResult,capture};
}
