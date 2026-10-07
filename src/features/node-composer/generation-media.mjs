import {configuration} from '../video-generation/settings.mjs';
import {prepareGenerationRequest} from './generation-request.mjs';
import {createWorkflowMediaResolver} from '../agent-workflows/media-resolver.mjs';
import {prepareWorkflowInputs,assertWorkflowRequestBudget} from '../agent-workflows/media-transport.mjs';
import {resolveProviderConfiguration,requestModelAlias} from './provider-configuration.mjs';
import {prepareMinimaxNativeInputs,assertMinimaxNativeMedia} from '../video-generation/minimax-native.mjs';
import {assertVideoReferenceDurations} from '../video-generation/reference-validation.mjs';
import {assertArkVideoPublication,arkVideoPublication,arkLocalVideo} from '../video-generation/ark-upload.mjs';

// Subject/library IDs name immutable submitted assets, not live canvas nodes. Canvas
// identity checks belong to the submit-time host guard, never synthetic subject IDs.
export async function prepareGenerationMediaRequest(request,{
  signal,localAssets=globalThis.LocalAssets,baseUrl=globalThis.document?.baseURI,
  resolveMedia=createWorkflowMediaResolver({localAssets,baseUrl}),transport=prepareWorkflowInputs,
  nativeConfiguration,validateSources=()=>{},onVideoPublication=()=>{}
}={}){
  if(!['image.generate','video.generate'].includes(request.kind))return request;
  nativeConfiguration=resolveProviderConfiguration(nativeConfiguration,request);
  const check=()=>{if(signal?.aborted)throw signal.reason??new DOMException('素材准备已取消','AbortError');validateSources();};
  check();
  let prepared=prepareGenerationRequest(structuredClone(request));
  if(prepared.kind==='video.generate')assertArkVideoPublication(nativeConfiguration,prepared,{baseUrl});
  const publication=arkVideoPublication(nativeConfiguration,prepared);
  if(prepared.kind==='video.generate'&&publication.enabled&&prepared.inputs?.some(input=>input.type==='video'&&arkLocalVideo(input.url,baseUrl)))onVideoPublication(publication.hint+' 生成结果将保存到本机。');
  const minimaxNative=prepared.kind==='video.generate'&&nativeConfiguration?.protocol==='minimax-native';
  const minimaxProfile=minimaxNative?nativeConfiguration.capabilities?.video?.[requestModelAlias(prepared)]:undefined;
  if(minimaxNative){
    prepared=prepareMinimaxNativeInputs(prepared,nativeConfiguration);
    assertWorkflowRequestBudget(prepared);
    // Asset identity is resolved without probing. Check other submitted URLs
    // before a browser media element can contact them.
    assertMinimaxNativeMedia((prepared.inputs||[]).filter(input=>!input.url?.startsWith('asset:')),{baseUrl,profile:minimaxProfile});
  }
  const inlineImages=prepared.kind==='image.generate'&&nativeConfiguration?.protocol==='openai-native';
  if(inlineImages){
    const images=(prepared.inputs||[]).filter(input=>input.type==='image');
    const alias=requestModelAlias(prepared);
    const profiles=nativeConfiguration.capabilities?.imageReferences;
    const profile=profiles&&Object.hasOwn(profiles,alias)?profiles[alias]:null;
    if(images.length&&(!profile||profile.transport!=='inline'||!Number.isSafeInteger(profile.maxImages)||profile.maxImages<1||profile.maxImages>16))throw Error('当前模型尚未配置图片参考能力，请检查服务端模型映射');
    if(images.length>profile?.maxImages)throw Error('图片参考超过当前模型配置上限，未提交模型');
    if((prepared.inputs||[]).some(input=>!['image','text'].includes(input.type)))throw Error('OpenAI 图片生成仅支持图片与文字参考');
  }
  const originals=prepared.inputs||[],subjects=prepared.parameters?.subjects,resolved=[];
  for(const [index,input]of originals.entries()){
    check();
    if(input.type==='text'){resolved.push({...input});continue;}
    if(!['image','video','audio'].includes(input.type)||!input.url)throw Error('参考素材没有有效媒体地址');
    const node={id:input.id||input.key||'generation-input:'+index,type:input.type,[{image:'image',video:'video',audio:'audio'}[input.type]]:input.url};
    const actual=await resolveMedia(node,{signal,...inlineImages&&input.type==='image'?{decodeImage:false}:{}});check();
    const value={...input,url:actual.url,...input.type==='image'||input.type==='video'?{width:actual.width,height:actual.height}:{},...input.type!=='image'?{duration:actual.duration,durationMs:Math.round(actual.duration*1000)}:{}};
    delete value.sourceUrl;resolved.push(value);
  }
  if(minimaxNative)assertMinimaxNativeMedia(resolved,{baseUrl,decoded:true,profile:minimaxProfile});
  if(prepared.kind==='video.generate'){
    const variant=configuration(prepared.parameters||{},resolved)?.variant;
    // This is the authoritative boundary: resolveMedia has read the actual bytes.
    // Missing/invalid duration must fail, never substitute the requested output length.
    assertVideoReferenceDurations(variant,resolved,{useDurationMs:false});
  }
  const indexPairs=originals.map((original,index)=>({original,index}));
  function alignSnapshots(inputs){
    if(!Array.isArray(subjects))return prepared.parameters;
    return {...prepared.parameters,subjects:subjects.map(subject=>({...subject,assets:subject.assets.map(asset=>{
      if(!['image','video','audio'].includes(asset.type)||!asset.url)return {...asset};
      const entry=indexPairs.find(({original})=>original.type===asset.type&&(original.url===asset.url||original.sourceUrl===asset.url));
      if(!entry)throw Error('主体素材没有绑定到实际参考输入');
      const input=inputs[entry.index],value={...asset,url:input.url,...input.durationMs?{durationMs:input.durationMs}:{}};
      delete value.image;return value;
    })}))};
  }
  // Transport sees the complete request, including subject snapshots, for the 64 MiB limit.
  prepared={...prepared,inputs:resolved,parameters:alignSnapshots(resolved)};
  const transferred=await transport(prepared,{signal,baseUrl,...inlineImages||minimaxNative?{validateSources}:{},...inlineImages?{inlineImages:true}:{}});check();
  if(minimaxNative)assertMinimaxNativeMedia(transferred.inputs,{baseUrl,decoded:true,transported:true,profile:minimaxProfile});
  // Native references were only resolved, never probed over the network. Decode
  // exactly the bytes produced by the constrained transport before dispatch.
  if(inlineImages)for(const [index,input]of transferred.inputs.entries()){
    if(input.type!=='image')continue;
    if(!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(input.url))throw Error('OpenAI 图片参考须为 PNG、JPEG 或 WebP，请先导入支持的图片格式');
    check();const actual=await resolveMedia({id:input.id||input.key||'generation-input:'+index,type:'image',image:input.url},{signal});check();
    input.width=actual.width;input.height=actual.height;
  }
  prepared=prepareGenerationRequest({...transferred,parameters:alignSnapshots(transferred.inputs)});
  assertWorkflowRequestBudget(prepared);check();
  return prepared;
}

export {assertWorkflowRequestBudget};
