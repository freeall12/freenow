import {isGenerationMediaRef} from '../generation-results/media-ref.mjs';
import {captureResultSnapshot,assertResultSnapshot} from '../generation-results/plan.mjs';
import {characterBlockingUri,characterBlockingLimits as limits,characterBlockingPortrait,prepareCharacterBlocking,validateCharacterBlockingState,resolveCharacterBlockingReply} from './character-blocking.mjs';
const fail=(code,message)=>{throw Object.assign(Error(message),{code});},clone=value=>structuredClone(value);
const object=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
const hash=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
function fields(value,keys){if(!object(value)||Object.keys(value).some(k=>!keys.includes(k)))fail('invalid_source','人物头像来源字段无效');}
function crop(value){if(value===undefined)return null;fields(value,['x','y','w','h']);if(['x','y','w','h'].some(k=>!Number.isInteger(value[k]))||value.x<0||value.y<0||value.w<1||value.h<1||value.x+value.w>1000||value.y+value.h>1000)fail('invalid_crop','人物头像裁切须为范围内的千分比矩形');return {...value};}
function abort(signal){if(signal?.aborted)throw signal.reason||new DOMException('人物站位已取消','AbortError');}
function wait(promise,signal,disposeLate){
  const cleanup=value=>{try{Promise.resolve(disposeLate?.(value)).catch(()=>{});}catch{}};
  if(signal.aborted){Promise.resolve(promise).then(cleanup,()=>{});abort(signal);}
  return new Promise((resolve,reject)=>{let settled=false;const cancel=()=>{if(settled)return;settled=true;reject(signal.reason||Error('人物站位已取消'));};signal.addEventListener('abort',cancel,{once:true});Promise.resolve(promise).then(value=>{signal.removeEventListener('abort',cancel);if(settled){cleanup(value);return;}settled=true;resolve(value);},error=>{signal.removeEventListener('abort',cancel);if(settled)return;settled=true;reject(error);});});
}
function timed(signal){return signal?AbortSignal.any([signal,AbortSignal.timeout(limits.timeoutMs)]):AbortSignal.timeout(limits.timeoutMs);}
// Canvas pixels are always decoded from the selected local asset. No remote
// preview URL, initials, or unrelated generated image is substituted as a portrait.
export async function renderCharacterBlockingPortrait(blob,{crop:region=null,signal}={}){
  signal=timed(signal);abort(signal);const url=URL.createObjectURL(blob),image=new Image();
  try{
    await new Promise((resolve,reject)=>{const cleanup=()=>{image.onload=image.onerror=null;signal.removeEventListener('abort',cancel);};const cancel=()=>{cleanup();image.src='';reject(signal.reason||Error('头像解码已取消'));};image.onload=()=>{cleanup();resolve();};image.onerror=()=>{cleanup();reject(Error('本地人物图片解码失败'));};signal.addEventListener('abort',cancel,{once:true});image.src=url;});abort(signal);
    const width=image.naturalWidth,height=image.naturalHeight;if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||width>16384||height>16384||width*height>40000000)fail('image_dimensions','人物图片尺寸超过本地裁切限制');
    const r=region?{x:region.x/1000*width,y:region.y/1000*height,w:region.w/1000*width,h:region.h/1000*height}:{x:0,y:0,w:width,h:height},side=Math.min(r.w,r.h);
    const canvas=document.createElement('canvas');canvas.width=128;canvas.height=128;const context=canvas.getContext('2d');if(!context)fail('canvas_unavailable','无法读取本地头像像素');context.drawImage(image,r.x+(r.w-side)/2,r.y+(r.h-side)/2,side,side,0,0,128,128);
    for(const quality of [.82,.65,.45]){abort(signal);const data_uri=canvas.toDataURL('image/webp',quality);if(data_uri.length<=limits.portraitChars)return characterBlockingPortrait({data_uri,source:'image-crop'});}
    fail('portrait_limit','本地头像编码超过官方容量限制');
  }finally{image.src='';URL.revokeObjectURL(url);}
}
export function createCharacterBlockingRuntime({app,localAssets,getProjectId,fetchImpl=(...args)=>fetch(...args),renderPortrait=renderCharacterBlockingPortrait}={}){
  for(const [name,fn]of Object.entries({'app.getState':app?.getState,'localAssets.url':localAssets?.url,getProjectId,fetchImpl,renderPortrait}))if(typeof fn!=='function')throw TypeError(name+' adapter is required');
  const preparations=new WeakMap(),graph=()=>app.getState();
  function node(ref){if(typeof ref!=='string'||!/^node\/[A-Za-z0-9_-]{1,180}$/.test(ref))fail('invalid_source','人物参考须为当前图片节点');const value=graph().nodes.find(n=>n.id===ref.slice(5));if(value?.type!=='image')fail('invalid_source','人物参考须为当前真实图片节点');const media=value.fullImage||value.image;if(typeof media!=='string'||!(/^asset:[A-Za-z0-9_-]+$/.test(media)||isGenerationMediaRef(media)))fail('local_import_required','人物图片须先导入本地素材；不读取原站或外域URL');return {value,media};}
  async function read(media,signal,check,budget){
    abort(signal);check();const url=await wait(isGenerationMediaRef(media)?media:localAssets.url(media),signal);check();abort(signal);
    if(typeof url!=='string'||!(/^blob:/.test(url)||isGenerationMediaRef(url)))fail('local_asset_url','人物头像须为可读取的本地图片');
    const response=await wait(fetchImpl(url,{signal,...(isGenerationMediaRef(url)?{redirect:'error',mode:'same-origin',credentials:'same-origin'}:{})}),signal,value=>value?.body?.cancel?.());try{check();abort(signal);}catch(error){await response?.body?.cancel?.().catch(()=>{});throw error;}if(!response?.ok){await response?.body?.cancel?.();fail('media_unavailable','本地人物图片读取失败');}
    const size=response.headers?.get?.('content-length');if(size!==null&&size!==undefined&&(!/^\d+$/.test(size)||Number(size)>limits.sourceBytes)){await response.body?.cancel?.();fail('media_limit','人物图片超过本地读取限制');}
    if(!response.body?.getReader){await response.body?.cancel?.();fail('bounded_stream_required','人物图片读取必须支持有界流');}
    const reader=response.body.getReader(),chunks=[];let total=0;const cancel=()=>{reader.cancel(signal.reason).catch(()=>{});};signal.addEventListener('abort',cancel,{once:true});
    try{while(true){const item=await wait(reader.read(),signal);check();if(item.done)break;total+=item.value.length;budget.used+=item.value.length;if(total>limits.sourceBytes||budget.used>limits.totalSourceBytes)fail('media_limit','人物参考图片超过本地读取容量');chunks.push(item.value);}if(!total||size!==null&&size!==undefined&&Number(size)!==total)fail('media_invalid','本地图片实际字节与声明不一致');}
    catch(error){await reader.cancel(error).catch(()=>{});throw error;}finally{signal.removeEventListener('abort',cancel);reader.releaseLock();}
    const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}const type=response.headers?.get?.('content-type')?.split(';')[0];if(!['image/png','image/jpeg','image/webp'].includes(type))fail('media_invalid','人物参考须为真实PNG、JPEG或WebP');
    const source_sha256=await wait(hash(bytes),signal);check();return {blob:new Blob([bytes],{type}),source_sha256};
  }
  async function prepareAppArgs(args,{isCurrent=()=>true,signal}={}){
    if(args.resource_uri!==characterBlockingUri)return args;signal=timed(signal);fields(args.data,['locale','target','aspect_ratio','scene','characters']);if(!Array.isArray(args.data.characters))fail('invalid_source','人物站位缺少人物列表');
    const sources=[],characters=args.data.characters.map(c=>{fields(c,['id','name','role','x','y','facing','portrait_source']);const {portrait_source,...plain}=c;if(portrait_source!==undefined){fields(portrait_source,['node_ref','crop']);const actual=node(portrait_source.node_ref);sources.push({character_id:c.id,node_ref:portrait_source.node_ref,crop:crop(portrait_source.crop),media:actual.media,snapshot:captureResultSnapshot(graph().nodes,graph().edges,actual.value.id)});}return plain;});
    // Validate the textual board before reading any assets, including zero portraits.
    prepareCharacterBlocking({...args.data,characters},args.title);const projectId=getProjectId(),budget={used:0};
    const check=()=>{abort(signal);if(!isCurrent()||projectId!==getProjectId())fail('stale_blocking_app','人物站位所属画布或会话已切换');for(const s of sources){assertResultSnapshot(s.snapshot,graph().nodes,graph().edges);if(node(s.node_ref).media!==s.media)fail('source_changed','人物参考图片已替换');}};check();
    for(const source of sources){const actual=await read(source.media,signal,check,budget),portrait=characterBlockingPortrait(await wait(renderPortrait(actual.blob,{crop:source.crop,signal}),signal));check();source.source_sha256=actual.source_sha256;source.portrait_sha256=await wait(hash(Uint8Array.from(atob(portrait.data_uri.split(',')[1]),c=>c.charCodeAt(0))),signal);characters.find(c=>c.id===source.character_id).portrait=portrait;}
    check();const prepared={...clone(args),data:{...clone(args.data),characters}},response=prepareCharacterBlocking(prepared.data,args.title);preparations.set(prepared,{projectId,responseFingerprint:JSON.stringify(response),sources:clone(sources)});return prepared;
  }
  function bindPreparedResult(result,args){if(args.resource_uri!==characterBlockingUri)return result;const binding=preparations.get(args);if(!binding||binding.projectId!==getProjectId()||JSON.stringify(result.response)!==binding.responseFingerprint)fail('invalid_source','人物站位缺少实际本地来源绑定');for(const s of binding.sources)assertResultSnapshot(s.snapshot,graph().nodes,graph().edges);return {...result,characterBlockingSourceContext:clone(binding)};}
  function capture(data,{trace,chat,isCurrent}={}){
    const binding=trace?.result?.characterBlockingSourceContext;if(typeof isCurrent!=='function'||!trace?.id||!chat?.id||!binding||binding.projectId!==getProjectId()||JSON.stringify(data)!==binding.responseFingerprint)fail('invalid_source','人物站位缺少当前会话来源');
    const scope={projectId:getProjectId(),traceId:trace.id,chatId:chat.id},lifetime=new AbortController();
    const current=()=>{abort(lifetime.signal);if(!isCurrent()||scope.projectId!==getProjectId()||trace.result.response!==data||JSON.stringify(data)!==binding.responseFingerprint)fail('stale_blocking_app','人物站位卡片已重载或来源已替换');for(const s of binding.sources){assertResultSnapshot(s.snapshot,graph().nodes,graph().edges);if(node(s.node_ref).media!==s.media)fail('source_changed','人物参考已替换');}return true;};
    async function guard(signal){signal=timed(signal?AbortSignal.any([signal,lifetime.signal]):lifetime.signal);current();const budget={used:0};for(const s of binding.sources){const actual=await read(s.media,signal,current,budget);if(actual.source_sha256!==s.source_sha256)fail('source_changed','人物图片实际字节已变化，请重新打开站位板');}current();return true;}
    async function reply(message,state){await guard();const receipt=await resolveCharacterBlockingReply(message,data,state);current();if(receipt.kind!=='confirmed')return receipt;const portrait_sources=binding.sources.map(s=>({character_id:s.character_id,node_ref:s.node_ref,crop:s.crop,source_sha256:s.source_sha256,portrait_sha256:s.portrait_sha256}));if(!portrait_sources.length)return receipt;
      const result={...receipt.result,portrait_sources},text=receipt.text+'\n真实本地人物参考来源：'+JSON.stringify(portrait_sources);if(text.length>limits.replyChars)fail('reply_limit','人物参考交接超过容量限制');return {...receipt,result,text,metadata:{handoffId:'blocking_'+await hash(new TextEncoder().encode(JSON.stringify(result)))}};
    }
    current();return {scope,binding,guard,reply,validateState:value=>{current();return validateCharacterBlockingState(value,data);},isCurrent:()=>{try{return current();}catch{return false;}},dispose:()=>lifetime.abort(new DOMException('人物站位页面已关闭','AbortError'))};
  }
  return {prepareAppArgs,bindPreparedResult,capture};
}
