import {createWorkflowMediaResolver} from '../agent-workflows/media-resolver.mjs';
import {prepareWorkflowInputs,assertWorkflowRequestBudget} from '../agent-workflows/media-transport.mjs';
import {normalizeRelightPng} from '../image-relight/media.mjs';
import {resolveProviderConfiguration} from '../node-composer/provider-configuration.mjs';
import {isOriginalServiceHost} from '../local-resource-migration/origin-policy.mjs';
import {assertPanoramaEditConfiguration} from './native-profile.mjs';
const fail=message=>Object.assign(Error(message),{code:'unsupported_generation',providerDispatched:false});
// Keep the established panorama input.image contract. The generic transport
// receives a temporary url envelope only while materializing verified bytes.
export async function preparePanoramaEditMedia(request,{
 signal,validateSources=()=>{},localAssets=globalThis.LocalAssets,baseUrl=globalThis.document?.baseURI,nativeConfiguration,
 resolveMedia=createWorkflowMediaResolver({localAssets,baseUrl}),transport=prepareWorkflowInputs,
 fetchImpl=(...args)=>fetch(...args),normalizePng=normalizeRelightPng
}={}){
 if(request?.kind!=='panorama.edit'||resolveProviderConfiguration(nativeConfiguration,request)?.protocol!=='openai-panorama-edit-native')return request;
 const check=()=>{if(signal?.aborted)throw signal.reason;validateSources();};
 const independent=value=>{let u;try{u=new URL(value,baseUrl);}catch{throw fail('全景来源地址无效');}if(u.username||u.password)throw fail('全景来源地址含凭据');if(['http:','https:'].includes(u.protocol)&&isOriginalServiceHost(u.hostname))throw fail('全景来源须先导入本机，未读取原站素材');};
 check();assertPanoramaEditConfiguration(nativeConfiguration,request);
 if(request.inputs?.length!==1||request.inputs[0]?.type!=='image'||request.inputs[0]?.projection!=='equirectangular'||typeof request.inputs[0]?.image!=='string')throw fail('全景来源与片场输入合同不一致');
 const next=structuredClone(request),source=next.inputs[0].image;
 if(!source.startsWith('asset:'))independent(source);
 const actual=await resolveMedia({id:request.nodeId,type:'image',fullImage:source},{signal,decodeImage:false});check();independent(actual.url);
 const boundedFetch=(url,options)=>{check();independent(url);return fetchImpl(url,{...options,redirect:'error',credentials:'omit'});};
 const temporary={...next,inputs:[{type:'image',url:actual.url}]};
 const transferred=await transport(temporary,{signal,baseUrl,validateSources:check,inlineImages:true,maxMediaBytes:32*1024*1024,fetchImpl:boundedFetch});check();
 const normalized=await normalizePng(transferred.inputs[0],{signal,validateSources:check,fetchImpl:boundedFetch,maxBytes:32*1024*1024,maxPixels:2048*1024,operationName:'全景局部编辑'});check();
 if(normalized.width!==2048||normalized.height!==1024)throw fail('来源全景实际尺寸必须为 2048×1024；未缩放');
 next.inputs=[{type:'image',image:normalized.url,projection:'equirectangular'}];assertWorkflowRequestBudget(next);return next;
}
