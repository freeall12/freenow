import {createWorkflowMediaResolver} from '../agent-workflows/media-resolver.mjs';
import {prepareWorkflowInputs,assertWorkflowRequestBudget} from '../agent-workflows/media-transport.mjs';
import {isOriginalServiceHost} from '../local-resource-migration/origin-policy.mjs';
import {prepareDepthTaskRequest} from '../agent-workflows/depth-video.mjs';
import {assertDepthConfiguration} from './native-profile.mjs';
const fail=message=>Object.assign(Error(message),{code:'unsupported_generation',providerDispatched:false});
// Local browser decoding checks dimensions/duration. The native backend checks
// complete MP4 bytes, all frame timestamps, SAR and CFR before any fal upload.
export async function prepareDepthMedia(request,{signal,validateSources=()=>{},localAssets=globalThis.LocalAssets,baseUrl=globalThis.document?.baseURI,nativeConfiguration,resolveMedia=createWorkflowMediaResolver({localAssets,baseUrl}),transport=prepareWorkflowInputs,serialize,fetchImpl=(...args)=>fetch(...args)}={}){
 if(request?.kind!=='video.depth')return request;
 const check=()=>{if(signal?.aborted)throw signal.reason??fail('深度视频准备已取消');validateSources();};
 check();prepareDepthTaskRequest(request);const state=assertDepthConfiguration(nativeConfiguration,request),native=!!state.profile;
 const independent=value=>{let url;try{url=new URL(value,baseUrl);}catch{throw fail('深度视频来源地址无效');}if(url.username||url.password)throw fail('来源视频地址不能包含凭据');if(['http:','https:'].includes(url.protocol)&&isOriginalServiceHost(url.hostname))throw fail('原站视频需要先导入本机，未读取或提交模型');};
 const prepared=structuredClone(request),input=prepared.inputs[0];if(!input.url.startsWith('asset:'))independent(input.url);
 const actual=await resolveMedia({id:input.id,type:'video',video:input.url},{signal});check();independent(actual.url);
 if(actual.width!==input.width||actual.height!==input.height||Math.abs(actual.duration-input.duration)>.001)throw fail('来源视频实际尺寸或时长与请求不一致，未自动改动来源');input.url=actual.url;
 const boundedFetch=(url,options)=>{check();independent(url);return fetchImpl(url,{...options,redirect:'error',credentials:'omit'});};
 const transferred=await transport(prepared,{signal,baseUrl,validateSources:check,inlineVideos:native,maxMediaBytes:native?state.profile.maxInputBytes:Infinity,fetchImpl:boundedFetch,...serialize?{serialize}:{}});check();
 if(native){const video=transferred.inputs[0];if(!/^data:video\/mp4;base64,[A-Za-z0-9+/]+={0,2}$/.test(video.url))throw fail('原生深度转换须使用真实完整 MP4，未转码或截短');const length=video.url.slice(video.url.indexOf(',')+1),bytes=length.length*3/4-(length.endsWith('==')?2:length.endsWith('=')?1:0);if(!Number.isSafeInteger(bytes)||bytes<1||bytes>state.profile.maxInputBytes)throw fail('完整 MP4 大小无效或超过 32 MiB');}
 assertWorkflowRequestBudget(transferred);assertDepthConfiguration(nativeConfiguration,transferred);check();return transferred;
}
