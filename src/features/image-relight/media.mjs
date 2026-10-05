import {createWorkflowMediaResolver} from '../agent-workflows/media-resolver.mjs';
import {prepareWorkflowInputs,assertWorkflowRequestBudget} from '../agent-workflows/media-transport.mjs';
import {serializeClipBlob} from '../agent-workflows/local-clip-resolver.mjs';
import {resolveProviderConfiguration} from '../node-composer/provider-configuration.mjs';
import {isOriginalServiceHost} from '../local-resource-migration/origin-policy.mjs';
import {assertRelightConfiguration,assertRelightRequest} from './native-profile.mjs';
const fail=message=>Object.assign(Error(message),{code:'unsupported_generation',providerDispatched:false});
function nativePngCodec(bytes,operationName){
 if(bytes.length<33||![137,80,78,71,13,10,26,10].every((value,index)=>bytes[index]===value))throw fail('来源 PNG 文件头无效');
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let offset=8,normalize=false;
 while(offset+12<=bytes.length){
  const length=view.getUint32(offset),end=offset+12+length;if(end>bytes.length)throw fail('来源 PNG 数据不完整');
  const type=String.fromCharCode(...bytes.slice(offset+4,offset+8));
  if(['acTL','fcTL','fdAT'].includes(type))throw fail(operationName+'只编辑静态完整图片；请先将动画 PNG 导出为明确静态图片');
  if(['tRNS','zTXt','iTXt','iCCP'].includes(type))normalize=true;offset=end;if(type==='IEND')break;
 }
 return bytes[24]===8&&[2,6].includes(bytes[25])&&bytes[28]===0&&!normalize;
}

async function decodedBitmap(blob,decode,signal,operationName){
 if(signal?.aborted)throw signal.reason;
 let cancel;const aborted=new Promise((_,reject)=>{cancel=()=>reject(signal.reason??new DOMException(operationName+'准备已取消','AbortError'));signal?.addEventListener('abort',cancel,{once:true});});
 const pending=Promise.resolve().then(()=>decode(blob)).then(bitmap=>{if(signal?.aborted){bitmap.close();throw signal.reason;}return bitmap;});
 try{return await Promise.race([pending,aborted]);}finally{signal?.removeEventListener('abort',cancel);}
}
// Preserve directly supported PNG bytes. Other static formats and PNGs with
// transparency/compressed metadata normalize at full dimensions. Canvas may
// convert color profiles; original encoding, metadata and ICC color are not promised.
export async function normalizeRelightPng(input,{signal,validateSources=()=>{},fetchImpl=(...args)=>fetch(...args),decode=blob=>createImageBitmap(blob),canvasFactory=()=>document.createElement('canvas'),serialize=serializeClipBlob,maxBytes=50*1024*1024-1,maxPixels=32*1024*1024,operationName='打光'}={}){
 const unit=1024*1024,limit=Math.ceil(maxBytes/unit)+' MiB',sourceLimit=(maxBytes%unit===0?'不超过 ':'小于 ')+limit;
 const check=()=>{if(signal?.aborted)throw signal.reason??new DOMException(operationName+'图片准备已取消','AbortError');validateSources();};check();
 const response=await fetchImpl(input.url,{signal,credentials:'omit',redirect:'error'});check();if(!response.ok)throw fail('来源图片读取失败');
 const blob=await response.blob();check();if(!['image/png','image/jpeg','image/webp'].includes(blob.type)||!blob.size||blob.size>maxBytes)throw fail(operationName+'来源图片须为真实 PNG、JPEG 或 WebP，且'+sourceLimit);
 const codec=blob.type==='image/png'?nativePngCodec(new Uint8Array(await blob.arrayBuffer()),operationName):false;check();
 const bitmap=await decodedBitmap(blob,decode,signal,operationName);let width,height;
 try{
  check();({width,height}=bitmap);if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||width*height>maxPixels)throw fail('来源图片实际尺寸无效或超过'+operationName+'服务像素预算；未缩小图片');
  for(const key of ['width','height'])if(input[key]!==undefined&&input[key]!==bitmap[key])throw fail('来源图片实际尺寸与声明不一致');
  if(codec)return {...input,url:input.url,width,height};
  const canvas=canvasFactory();canvas.width=width;canvas.height=height;const context=canvas.getContext('2d');if(!context)throw fail('来源图片 PNG 转换不可用');context.drawImage(bitmap,0,0);
  const png=await new Promise((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(fail('来源图片 PNG 转换失败')),'image/png'));check();
  if(png.type!=='image/png'||!png.size||png.size>maxBytes)throw fail(operationName+'来源图片转换后超过 '+limit+'；未缩小图片');
  const url=await serialize(png,{signal});check();return {...input,url,width,height};
 }finally{bitmap.close();}
}

export async function prepareRelightMedia(request,{
 signal,validateSources=()=>{},localAssets=globalThis.LocalAssets,baseUrl=globalThis.document?.baseURI,nativeConfiguration,
 resolveMedia=createWorkflowMediaResolver({localAssets,baseUrl}),transport=prepareWorkflowInputs,
 fetchImpl=(...args)=>fetch(...args),normalizePng=normalizeRelightPng
}={}){
 if(request?.kind!=='image.relight')return request;
 const check=()=>{if(signal?.aborted)throw signal.reason??new DOMException('打光图片准备已取消','AbortError');validateSources();};
 const independent=value=>{let url;try{url=new URL(value,baseUrl);}catch{throw fail('来源图片地址无效');}if(url.username||url.password)throw fail('来源图片地址不能包含凭据');if(['http:','https:'].includes(url.protocol)&&isOriginalServiceHost(url.hostname))throw fail('原站图片需要先导入本机，未读取或提交模型');};
 check();assertRelightRequest(request);if(nativeConfiguration)assertRelightConfiguration(nativeConfiguration,request);
 const native=resolveProviderConfiguration(nativeConfiguration,request)?.protocol==='openai-relight-native',prepared=structuredClone(request),input=prepared.inputs[0];
 if(!input.url.startsWith('asset:'))independent(input.url);
 const actual=await resolveMedia({id:input.nodeId||'relight-source',type:'image',fullImage:input.url},{signal,decodeImage:false});check();independent(actual.url);input.url=actual.url;
 const boundedFetch=(url,options)=>{check();independent(url);return fetchImpl(url,{...options,redirect:'error',credentials:'omit'});};
 const transferred=await transport(prepared,{signal,baseUrl,validateSources:check,inlineImages:true,maxMediaBytes:50*1024*1024-1,fetchImpl:boundedFetch});check();
 if(native)transferred.inputs[0]=await normalizePng(transferred.inputs[0],{signal,validateSources:check,fetchImpl:boundedFetch});
 else{
  const decoded=await resolveMedia({id:input.nodeId||'relight-source',type:'image',fullImage:transferred.inputs[0].url},{signal});check();
  for(const key of ['width','height']){if(!Number.isSafeInteger(decoded[key])||decoded[key]<1||input[key]!==undefined&&input[key]!==decoded[key])throw fail('来源图片实际尺寸无效或与声明不一致');transferred.inputs[0][key]=decoded[key];}
 }
 check();assertWorkflowRequestBudget(transferred);if(nativeConfiguration)assertRelightConfiguration(nativeConfiguration,transferred);return transferred;
}
