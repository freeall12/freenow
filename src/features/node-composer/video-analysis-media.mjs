import {prepareWorkflowInputs,assertWorkflowRequestBudget} from '../agent-workflows/media-transport.mjs';
import {resolveProviderConfiguration,requestModelAlias} from './provider-configuration.mjs';

// Scene detection needs the complete source stream. Preserve the non-destructive
// clip as absolute source times; the local decoder applies that interval once.
export async function prepareVideoAnalysisMedia(request,{
  signal,baseUrl=globalThis.document?.baseURI,nativeConfiguration,
  validateSources=()=>{},transport=prepareWorkflowInputs
}={}){
  nativeConfiguration=resolveProviderConfiguration(nativeConfiguration,request);
  if(request.kind!=='video.analyze'||nativeConfiguration?.protocol!=='openai-native')return request;
  const check=()=>{if(signal?.aborted)throw signal.reason??new DOMException('解析准备已取消','AbortError');validateSources();};
  check();
  const alias=requestModelAlias(request)??request.kind;
  const profiles=nativeConfiguration.capabilities?.videoAnalysis;
  const profile=profiles&&Object.hasOwn(profiles,alias)?profiles[alias]:null;
  if(!profile||profile.kind!==request.kind||profile.transport!=='inline')throw Object.assign(Error('尚未配置原生分镜解析模型，请检查服务端映射'),{code:'configuration_required'});
  if(!Array.isArray(request.inputs)||request.inputs.length!==1||request.inputs[0]?.type!=='video')throw Error('分镜解析需要一个完整来源视频');
  const prepared=await transport(request,{signal,baseUrl,inlineVideos:true,maxMediaBytes:40*1024*1024,validateSources});check();
  const url=prepared.inputs[0].url,match=/^data:video\/(mp4|webm);base64,([A-Za-z0-9+/]+={0,2})$/.exec(url);
  if(!match||match[2].length%4!==0)throw Error('原生分镜解析需要 MP4 或 WebM 视频');
  const bytes=match[2].length/4*3-(match[2].endsWith('==')?2:match[2].endsWith('=')?1:0);
  if(bytes>40*1024*1024)throw Error('原生分镜解析的来源视频不能超过 40 MiB');
  assertWorkflowRequestBudget(prepared);return prepared;
}
