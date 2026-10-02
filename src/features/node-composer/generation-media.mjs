import {configuration} from '../video-generation/settings.mjs';
import {prepareGenerationRequest} from './generation-request.mjs';
import {createWorkflowMediaResolver} from '../agent-workflows/media-resolver.mjs';
import {prepareWorkflowInputs,assertWorkflowRequestBudget} from '../agent-workflows/media-transport.mjs';

// Subject/library IDs name immutable submitted assets, not live canvas nodes. Canvas
// identity checks belong to the submit-time host guard, never synthetic subject IDs.
export async function prepareGenerationMediaRequest(request,{
  signal,localAssets=globalThis.LocalAssets,baseUrl=globalThis.document?.baseURI,
  resolveMedia=createWorkflowMediaResolver({localAssets,baseUrl}),transport=prepareWorkflowInputs,
  nativeConfiguration,validateSources=()=>{}
}={}){
  if(!['image.generate','video.generate'].includes(request.kind))return request;
  const check=()=>{if(signal?.aborted)throw signal.reason??new DOMException('素材准备已取消','AbortError');validateSources();};
  check();
  let prepared=prepareGenerationRequest(structuredClone(request));
  const inlineImages=prepared.kind==='image.generate'&&nativeConfiguration?.protocol==='openai-native';
  if(inlineImages){
    const images=(prepared.inputs||[]).filter(input=>input.type==='image');
    const alias=prepared.parameters?.providerParameters?.model??prepared.parameters?.modelId??prepared.parameters?.model;
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
  if(prepared.kind==='video.generate'){
    const variant=configuration(prepared.parameters||{},resolved)?.variant;
    for(const type of ['video','audio']){
      const range=variant?.['reference'+type[0].toUpperCase()+type.slice(1)+'DurationRange'];if(!range)continue;
      const durations=resolved.filter(input=>input.type===type).map(input=>input.duration),tolerance=range.maxTolerance||0;
      if(durations.some(value=>!Number.isFinite(value)||value<(range.min||0)-tolerance||value>(range.max??Infinity)+tolerance)||durations.reduce((sum,value)=>sum+value,0)>(range.totalMax??Infinity)+tolerance)throw Error('实际'+(type==='video'?'视频':'音频')+'参考时长超出模型限制，未自动截短');
    }
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
  const transferred=await transport(prepared,{signal,baseUrl,...inlineImages?{inlineImages:true,validateSources}:{}});check();
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
