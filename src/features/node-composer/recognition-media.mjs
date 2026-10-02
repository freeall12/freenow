import {createWorkflowMediaResolver} from '../agent-workflows/media-resolver.mjs';
import {prepareWorkflowInputs,assertWorkflowRequestBudget} from '../agent-workflows/media-transport.mjs';

// Point recognition keeps the original coordinates and binding. Only the media
// transport changes for the explicitly configured native Responses adapter.
export async function prepareRecognitionMedia(request,{
  signal,localAssets=globalThis.LocalAssets,baseUrl=globalThis.document?.baseURI,
  nativeConfiguration,validateSources=()=>{},
  resolveMedia=createWorkflowMediaResolver({localAssets,baseUrl}),transport=prepareWorkflowInputs
}={}){
  if(request.kind!=='image.recognize'||nativeConfiguration?.protocol!=='openai-native')return request;
  const check=()=>{if(signal?.aborted)throw signal.reason??new DOMException('识别准备已取消','AbortError');validateSources();};
  check();
  const p=request.parameters||{},alias=p.modelId??p.model??request.kind;
  const profiles=nativeConfiguration.capabilities?.analysis;
  const profile=profiles&&Object.hasOwn(profiles,alias)?profiles[alias]:null;
  if(!profile||profile.kind!==request.kind||profile.operation!=='point-detection'||profile.transport!=='inline'||profile.maxImages!==1)throw Error('尚未配置原生焦点识别模型，请检查服务端映射');
  if(!Array.isArray(request.inputs)||request.inputs.length!==1||request.inputs[0]?.type!=='image')throw Error('焦点识别需要一张完整图片');
  const prepared=structuredClone(request),input=prepared.inputs[0],id=p.binding?.targetNodeId||request.nodeId||'recognition-image';
  const source=await resolveMedia({id,type:'image',image:input.url},{signal,decodeImage:false});check();
  input.url=source.url;
  const transferred=await transport(prepared,{signal,baseUrl,inlineImages:true,validateSources});check();
  const submitted=transferred.inputs[0];
  if(!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(submitted.url))throw Error('焦点识别需要 PNG、JPEG 或 WebP 图片');
  // Decode exactly the submitted bytes, never probe an unchecked external URL.
  const actual=await resolveMedia({id,type:'image',image:submitted.url},{signal});check();
  submitted.width=actual.width;submitted.height=actual.height;
  assertWorkflowRequestBudget(transferred);return transferred;
}
