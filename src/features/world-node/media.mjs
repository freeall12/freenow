import {signature} from './model.mjs';
import {createWorkflowMediaResolver} from '../agent-workflows/media-resolver.mjs';
import {createLocalClipResolver} from '../agent-workflows/local-clip-resolver.mjs';
import {prepareWorkflowInputs,assertWorkflowRequestBudget} from '../agent-workflows/media-transport.mjs';
import {resolveProviderConfiguration} from '../node-composer/provider-configuration.mjs';

const failure=(code,message)=>Object.assign(Error(message),{code,providerDispatched:false});
const mediaStamp=node=>[node?.type,node?.image,node?.fullImage,node?.video,node?.content,
  JSON.stringify(node?.clip??null),JSON.stringify(node?.trim??null),node?.duration,
  JSON.stringify(node?.videoMetadata??null),JSON.stringify(node?.imageMetadata??null)];
const refStamp=ref=>[ref.edgeId,ref.nodeId,ref.type,ref.title,ref.url,ref.text,ref.isPano,
  JSON.stringify(ref.clip??null),JSON.stringify(ref.trim??null)];
const equal=(a,b)=>a.length===b.length&&a.every((value,index)=>value===b[index]);

// Capture before configuration lookup: media edits, same-ID replacements and
// disconnected/reordered links must invalidate the submitted source snapshot.
export function captureWorldSourceGuard(node,refs,{getNode,resolveReferences,signal}={}) {
  const targetStamp=signature(node,[]),referenceStamps=refs.map(refStamp);
  const sources=refs.map(ref=>{const source=getNode(ref.nodeId);return {source,id:ref.nodeId,stamp:mediaStamp(source)};});
  return ()=>{
    if(signal?.aborted)throw new DOMException('世界生成已取消','AbortError');
    let currentRefs;
    try{currentRefs=resolveReferences();}catch{throw failure('world_source_changed','世界参考已被删除或替换，请重新生成');}
    if(getNode(node.id)!==node||signature(node,[])!==targetStamp||currentRefs.length!==referenceStamps.length||
      currentRefs.some((ref,index)=>!equal(refStamp(ref),referenceStamps[index]))||
      sources.some(({source,id,stamp})=>!source||getNode(id)!==source||!equal(mediaStamp(source),stamp)))
      throw failure('world_source_changed','世界节点或参考已变化，请重新生成');
  };
}

// TaskService invokes this only after the captured operation/model route is
// configured. UI and Agent submit source descriptors, so bytes are read once.
export async function prepareWorldMediaRequest(request,{
  signal,validateSources=()=>{},localAssets=globalThis.LocalAssets,localMedia=globalThis.LocalMedia,
  baseUrl=globalThis.document?.baseURI,nativeConfiguration,resolveMedia,transport=prepareWorkflowInputs
}={}) {
  if(request?.kind!=='world.generate')return request;
  const check=()=>{if(signal?.aborted)throw signal.reason??new DOMException('世界素材准备已取消','AbortError');validateSources();};
  check();assertWorkflowRequestBudget(request);
  const selected=resolveProviderConfiguration(nativeConfiguration,request),native=selected?.protocol==='tripo-native';
  if(!Array.isArray(request.inputs))throw failure('invalid_media_request','世界生成缺少素材列表');
  if(native&&(request.parameters?.provider!=='tripo'||!['TEXT_TO_WORLD','IMAGE_TO_WORLD'].includes(request.parameters?.modelType)||
    request.inputs.some(input=>input.type!=='image')||request.inputs.length>1||
    request.parameters.modelType==='IMAGE_TO_WORLD'&&request.inputs.length!==1||
    request.parameters.modelType==='TEXT_TO_WORLD'&&request.inputs.length!==0))
    throw failure('unsupported_generation','当前 Tripo 原生接口仅支持文字或单张图片生成');
  const prepared=structuredClone(request);
  const nodes=prepared.inputs.map((input,index)=>({id:input.nodeId||input.id||'world-input:'+index,type:input.type,
    ...input.type==='image'?{image:input.url,fullImage:input.fullImage||input.url}:input.type==='video'?{video:input.url,
      ...input.clip!=null?{clip:input.clip}:{},...input.trim!=null?{trim:input.trim}:{}}:{}}));
  if(!resolveMedia){
    const clips=nodes.some(node=>node.type==='video'&&(node.clip!=null||node.trim!=null));
    const resolveClip=clips?createLocalClipResolver({getNode:id=>{check();return nodes.find(node=>node.id===id);},localMedia}):undefined;
    resolveMedia=createWorkflowMediaResolver({localAssets,baseUrl,resolveClip,timeoutMs:clips?120000:20000});
  }
  for(const [index,input]of prepared.inputs.entries()){
    check();
    if(input.type==='text'){if(typeof input.text!=='string')throw failure('invalid_media_input','文字参考缺少内容');continue;}
    if(!['image','video'].includes(input.type)||typeof (input.fullImage||input.url)!=='string'||!(input.fullImage||input.url))
      throw failure('invalid_media_input','世界生成只支持完整图片或视频素材');
    const actual=await resolveMedia(nodes[index],{signal,...native?{decodeImage:false}:{}});check();
    input.sourceUrl=input.fullImage||input.url;input.url=actual.url;delete input.fullImage;
    if(native){
      const url=new URL(input.url,baseUrl),sameOrigin=!!baseUrl&&url.origin===new URL(baseUrl).origin;
      if(url.username||url.password||url.protocol==='http:'&&!sameOrigin)
        throw failure('invalid_media_url','Tripo 公开图片参考需要无凭据的 HTTPS 地址');
    }
    if(actual.width!==undefined)input.width=actual.width;
    if(actual.height!==undefined)input.height=actual.height;
    if(actual.duration!==undefined){input.duration=actual.duration;input.durationMs=Math.round(actual.duration*1000);}
    if(nodes[index].clip){input.sourceRange={...nodes[index].clip};delete input.clip;delete input.trim;}
  }
  // Public HTTPS references go directly to Tripo's URL contract; only local
  // media becomes inline bytes, avoiding unnecessary browser CORS reads.
  const transferred=await transport(prepared,{signal,baseUrl,validateSources:check,timeoutMs:120000});check();
  if(native)for(const [index,input]of transferred.inputs.entries()){
    if(!input.url.startsWith('data:'))continue;
    if(!/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(input.url))
      throw failure('unsupported_generation','Tripo 本地图片上传支持 PNG/JPEG，请先将此图片转换为 PNG 或 JPG');
    const actual=await resolveMedia({id:nodes[index].id,type:'image',image:input.url},{signal});check();
    input.width=actual.width;input.height=actual.height;
  }
  assertWorkflowRequestBudget(transferred);check();return transferred;
}
