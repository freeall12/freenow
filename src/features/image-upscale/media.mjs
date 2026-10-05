import {createWorkflowMediaResolver} from '../agent-workflows/media-resolver.mjs';
import {prepareWorkflowInputs,assertWorkflowRequestBudget} from '../agent-workflows/media-transport.mjs';
import {resolveProviderConfiguration} from '../node-composer/provider-configuration.mjs';
import {isOriginalServiceHost} from '../local-resource-migration/origin-policy.mjs';
import {normalizeRelightPng} from '../image-relight/media.mjs';
import {magnificLimits,assertMagnificRequest,assertMagnificConfiguration} from './native-profile.mjs';
const fail=message=>Object.assign(Error(message),{code:'unsupported_generation',providerDispatched:false});

export function normalizeMagnificPng(input,options={}){return normalizeRelightPng(input,{...options,maxBytes:magnificLimits.maxInputBytes,maxPixels:magnificLimits.maxInputPixels,operationName:'Magnific'});}

export async function prepareMagnificMedia(request,{
 signal,validateSources=()=>{},localAssets=globalThis.LocalAssets,baseUrl=globalThis.document?.baseURI,nativeConfiguration,
 resolveMedia=createWorkflowMediaResolver({localAssets,baseUrl}),transport=prepareWorkflowInputs,
 fetchImpl=(...args)=>fetch(...args),normalizePng=normalizeMagnificPng
}={}){
 if(request?.kind!=='image.upscale'||request.parameters?.provider!=='magnific')return request;
 const check=()=>{if(signal?.aborted)throw signal.reason??new DOMException('Magnific 图片准备已取消','AbortError');validateSources();};
 const independent=value=>{let url;try{url=new URL(value,baseUrl);}catch{throw fail('Magnific 来源图片地址无效');}if(url.username||url.password)throw fail('Magnific 来源图片地址不能包含凭据');if(['http:','https:'].includes(url.protocol)&&isOriginalServiceHost(url.hostname))throw fail('原站 Magnific 来源图片须先导入本机，未读取或提交模型');};
 check();assertMagnificRequest(request);assertMagnificConfiguration(nativeConfiguration,request);
 if(resolveProviderConfiguration(nativeConfiguration,request)?.protocol!=='magnific-native')throw fail('此媒体准备只用于 Magnific 原生接口');
 const prepared=structuredClone(request),input=prepared.inputs[0];
 if(!input.url.startsWith('asset:'))independent(input.url);
 const actual=await resolveMedia({id:input.nodeId||'magnific-source',type:'image',fullImage:input.url},{signal,decodeImage:false});
 check();independent(actual.url);input.url=actual.url;
 const boundedFetch=(url,options)=>{check();independent(url);return fetchImpl(url,{...options,redirect:'error',credentials:'omit'});};
 const transferred=await transport(prepared,{signal,baseUrl,validateSources:check,inlineImages:true,maxMediaBytes:magnificLimits.maxInputBytes,fetchImpl:boundedFetch});
 check();transferred.inputs[0]=await normalizePng(transferred.inputs[0],{signal,validateSources:check,fetchImpl:boundedFetch});
 check();assertMagnificRequest(transferred);assertWorkflowRequestBudget(transferred);assertMagnificConfiguration(nativeConfiguration,transferred);return transferred;
}
