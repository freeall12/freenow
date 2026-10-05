import {createWorkflowMediaResolver} from '../agent-workflows/media-resolver.mjs';
import {prepareWorkflowInputs,assertWorkflowRequestBudget} from '../agent-workflows/media-transport.mjs';
import {isOriginalServiceHost} from '../local-resource-migration/origin-policy.mjs';
import {normalizeRelightPng} from '../image-relight/media.mjs';
import {assertSkinConfiguration,assertSkinRequest} from './native-profile.mjs';
const MAX_BYTES=32*1024*1024,MAX_PIXELS=32*1024*1024;
const fail=message=>Object.assign(Error(message),{code:'unsupported_generation',providerDispatched:false});

// Shared static-image normalization preserves supported PNG bytes and otherwise
// encodes at the decoded dimensions. It never shrinks or invents a source crop.
export function normalizeSkinPng(input,options={}){
 return normalizeRelightPng(input,{...options,maxBytes:MAX_BYTES,maxPixels:MAX_PIXELS,operationName:'皮肤'});
}

export async function prepareSkinMedia(request,{
 signal,validateSources=()=>{},localAssets=globalThis.LocalAssets,baseUrl=globalThis.document?.baseURI,nativeConfiguration,
 resolveMedia=createWorkflowMediaResolver({localAssets,baseUrl}),transport=prepareWorkflowInputs,
 fetchImpl=(...args)=>fetch(...args),normalizePng=normalizeSkinPng
}={}){
 if(request?.kind!=='image.skin')return request;
 const check=()=>{if(signal?.aborted)throw signal.reason??new DOMException('皮肤图片准备已取消','AbortError');validateSources();};
 const independent=value=>{
  let url;try{url=new URL(value,baseUrl);}catch{throw fail('皮肤来源图片地址无效');}
  if(url.username||url.password)throw fail('皮肤来源图片地址不能包含凭据');
  if(['http:','https:'].includes(url.protocol)&&isOriginalServiceHost(url.hostname))throw fail('原站皮肤来源图片须先导入本机，未读取或提交模型');
 };
 check();assertSkinRequest(request);
 // Readiness is required before resolving or fetching source media. A generic
 // configured task service is not permission to upload for an unsupported mode.
 assertSkinConfiguration(nativeConfiguration,request);
 const prepared=structuredClone(request),input=prepared.inputs[0];
 if(!input.url.startsWith('asset:'))independent(input.url);
 const actual=await resolveMedia({id:input.nodeId||'skin-source',type:'image',fullImage:input.url},{signal,decodeImage:false});
 check();independent(actual.url);input.url=actual.url;
 const boundedFetch=(url,options)=>{check();independent(url);return fetchImpl(url,{...options,redirect:'error',credentials:'omit'});};
 const transferred=await transport(prepared,{signal,baseUrl,validateSources:check,inlineImages:true,maxMediaBytes:MAX_BYTES,fetchImpl:boundedFetch});
 check();transferred.inputs[0]=await normalizePng(transferred.inputs[0],{signal,validateSources:check,fetchImpl:boundedFetch});
 check();assertSkinRequest(transferred);assertWorkflowRequestBudget(transferred);assertSkinConfiguration(nativeConfiguration,transferred);
 return transferred;
}
