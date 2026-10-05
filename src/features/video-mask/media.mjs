import {createWorkflowMediaResolver} from '../agent-workflows/media-resolver.mjs';
import {prepareWorkflowInputs,assertWorkflowRequestBudget} from '../agent-workflows/media-transport.mjs';
import {normalizeMaskReference} from './reference-png.mjs';
import {resolveProviderConfiguration} from '../node-composer/provider-configuration.mjs';
import {assertMaskedVideoConfiguration} from './native-profile.mjs';
import {validateMask} from './core.mjs';
import {openVideoFrames} from '../video-media/frames.mjs';
// Preserve the full source timeline and RLE here. The backend probes actual
// bytes and jointly crops source/mask before publishing any media to fal.
export async function prepareMaskedVideoMedia(request,{signal,validateSources=()=>{},localAssets=globalThis.LocalAssets,baseUrl=globalThis.document?.baseURI,resolveMedia,transport=prepareWorkflowInputs,nativeConfiguration,normalizeReference=normalizeMaskReference}={}){
 if(!['video.erase','video.replace'].includes(request.kind))return request;
 const check=()=>{if(signal?.aborted)throw signal.reason;validateSources();};check();
 if(nativeConfiguration)assertMaskedVideoConfiguration(nativeConfiguration,request);
 const native=nativeConfiguration&&resolveProviderConfiguration(nativeConfiguration,request).protocol==='fal-video-mask-native';
 const prepared=structuredClone(request),inputs=prepared.inputs;
 if(!Array.isArray(inputs)||inputs[0]?.type!=='video'||inputs[0].role!=='source_video'||inputs.length!==(prepared.kind==='video.replace'?2:1)||prepared.kind==='video.replace'&&(inputs[1]?.type!=='image'||inputs[1].role!=='replacement_image'))throw Error('遮罩编辑需要实际来源视频及明确替换图片');
 resolveMedia??=createWorkflowMediaResolver({localAssets,baseUrl,timeoutMs:20000});
 for(const [index,input]of inputs.entries()){
  check();const node={id:'mask-input:'+index,type:input.type,[input.type]:input.url};
  const actual=await resolveMedia(node,{signal});check();input.url=actual.url;
  if(actual.width!==undefined)input.width=actual.width;if(actual.height!==undefined)input.height=actual.height;
  if(index===0){if(!Number.isFinite(actual.duration)||actual.duration<=0)throw Error('来源视频实际时长不可用');input.duration=actual.duration;input.durationMs=Math.round(actual.duration*1000);validateMask(prepared.parameters?.mask,actual);}
 }
 if(nativeConfiguration)assertMaskedVideoConfiguration(nativeConfiguration,prepared);
 const result=await transport(prepared,{signal,baseUrl,validateSources:check,timeoutMs:120000,inlineImages:!!native,maxMediaBytes:native?32*1024*1024:Infinity});check();
 if(native&&result.kind==='video.replace'){result.inputs[1]=await normalizeReference(result.inputs[1],{signal,validateSources:check});check();assertWorkflowRequestBudget(result);}
 if(nativeConfiguration)assertMaskedVideoConfiguration(nativeConfiguration,result);return result;
}

// Native video results may omit a poster. Save a real decoded first frame so
// an unselected node stays recognizable after reload without a live player.
export async function captureMaskedVideoPoster(output,{signal,resolveSource=source=>globalThis.LocalAssets.url(source),openFrames=openVideoFrames}={}){
 if(output.type!=='video'||output.poster)return output;
 const check=()=>{if(signal?.aborted)throw signal.reason;};let reader;
 try{
  check();const source=output.video||output.url,url=await resolveSource(source);check();
  reader=await openFrames(url,signal);check();const frame=await reader.at(0,Math.min(320,reader.width));check();
  const poster=frame.toDataURL('image/jpeg',.85);if(!poster.startsWith('data:image/jpeg;base64,'))throw Error('视频结果封面读取失败');
  output.poster=poster;return output;
 }finally{reader?.dispose();}
}
