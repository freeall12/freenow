import {createWorkflowMediaResolver} from '../agent-workflows/media-resolver.mjs';
import {createLocalClipResolver} from '../agent-workflows/local-clip-resolver.mjs';
import {prepareWorkflowInputs} from '../agent-workflows/media-transport.mjs';
import {assertReshootConfiguration} from './native-profile.mjs';
export async function prepareReshootMedia(request,{signal,validateSources=()=>{},localAssets=globalThis.LocalAssets,localMedia=globalThis.LocalMedia,baseUrl=globalThis.document?.baseURI,resolveMedia,transport=prepareWorkflowInputs,nativeConfiguration}={}){
 if(request.kind!=='video.reshoot')return request;
 const check=()=>{if(signal?.aborted)throw signal.reason;validateSources();};
 check();if(nativeConfiguration)assertReshootConfiguration(nativeConfiguration,request);
 const prepared=structuredClone(request),source=prepared.inputs?.[0];
 if(prepared.inputs?.length!==1||source?.type!=='video'||source.role!=='source_video')throw Error('重拍需要一个来源视频');
 const clip=prepared.parameters?.sourceClip,node={id:'reshoot-source',type:'video',video:source.url,...clip?{clip}:{}};
 if(!resolveMedia){const resolveClip=clip?createLocalClipResolver({getNode:()=>{check();return node;},localMedia}):undefined;resolveMedia=createWorkflowMediaResolver({localAssets,baseUrl,resolveClip,timeoutMs:clip?120000:20000});}
 const actual=await resolveMedia(node,{signal});check();
 if(!Number.isFinite(actual.duration)||actual.duration<=0||!Number.isInteger(actual.width)||!Number.isInteger(actual.height))throw Error('重拍来源缺少实际视频时长或尺寸');
 if(!Number.isFinite(prepared.parameters.duration)||Math.abs(actual.duration-prepared.parameters.duration)>.1)throw Error('相机分镜与实际来源视频时长不一致，未截短或拉伸');
 Object.assign(source,{url:actual.url,duration:actual.duration,durationMs:Math.round(actual.duration*1000),width:actual.width,height:actual.height});
 if(clip){if(Math.abs(clip.end-clip.start-actual.duration)>.1)throw Error('实际裁片时长与来源边界不一致');source.sourceRange={...clip};prepared.parameters.sourceClip=null;}
 if(nativeConfiguration)assertReshootConfiguration(nativeConfiguration,prepared,{prepared:true});
 const result=await transport(prepared,{signal,baseUrl,validateSources:check,timeoutMs:120000});check();
 if(nativeConfiguration)assertReshootConfiguration(nativeConfiguration,result,{prepared:true});return result;
}
