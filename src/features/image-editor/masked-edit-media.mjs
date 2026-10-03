import {createWorkflowMediaResolver} from '../agent-workflows/media-resolver.mjs';
import {prepareWorkflowInputs,assertWorkflowRequestBudget} from '../agent-workflows/media-transport.mjs';
import {resolveProviderConfiguration,requestModelAlias} from '../node-composer/provider-configuration.mjs';
import {isOriginalServiceHost} from '../local-resource-migration/origin-policy.mjs';
const kinds=['image.erase','image.redraw','image.outpaint'];
const fail=(message,code='unsupported_generation')=>Object.assign(Error(message),{code,providerDispatched:false});
export async function prepareMaskedEditMedia(request,{
 signal,validateSources=()=>{},localAssets=globalThis.LocalAssets,
 baseUrl=globalThis.document?.baseURI,nativeConfiguration,
 resolveMedia=createWorkflowMediaResolver({localAssets,baseUrl}),transport=prepareWorkflowInputs,
 fetchImpl=(...args)=>fetch(...args)
}={}){
 if(!kinds.includes(request?.kind))return request;
 const selected=resolveProviderConfiguration(nativeConfiguration,request);if(selected?.protocol!=='openai-masked-edit-native')return request;
 const check=()=>{if(signal?.aborted)throw signal.reason??new DOMException('蒙版图片准备已取消','AbortError');validateSources();};
 const independent=source=>{let url;try{url=new URL(source,baseUrl);}catch{throw fail('图片参考地址无效');}if(['http:','https:'].includes(url.protocol)&&isOriginalServiceHost(url.hostname))throw fail('原站图片待本地导入，未读取或提交模型','original_service_blocked');if(url.username||url.password)throw fail('图片参考地址不能包含凭据');};
 check();const alias=requestModelAlias(request),profile=selected.capabilities?.maskedEdits?.[alias];if(!profile||profile.kind!==request.kind||profile.mask!=='derived-png-alpha-zero')throw fail('当前模型没有配置真实蒙版编辑能力','configuration_required');
 if(!Array.isArray(request.inputs)||request.inputs.length<1||request.inputs.length>(request.kind==='image.redraw'?2:1)||request.inputs.some(input=>input?.type!=='image'||typeof input.url!=='string'||!input.url))throw fail('蒙版编辑需要主图，重绘最多额外一张参考图');
 // The UI has already cut the alpha or positioned the outpaint canvas. Never redraw it here.
 if(!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(request.inputs.at(-1).url))throw fail('主图需要现有工具输出的真实透明 PNG');
 assertWorkflowRequestBudget(request);const prepared=structuredClone(request);
 for(const [index,input]of prepared.inputs.entries()){
  check();if(!input.url.startsWith('asset:'))independent(input.url);
  const actual=await resolveMedia({id:input.nodeId||input.id||'masked-edit:'+index,type:'image',image:input.url},{signal,decodeImage:false});check();independent(actual.url);input.url=actual.url;
 }
 check();const transferred=await transport(prepared,{signal,baseUrl,validateSources:check,inlineImages:true,maxMediaBytes:50*1024*1024-1,fetchImpl:(url,options)=>{check();independent(url);return fetchImpl(url,{...options,redirect:'error',credentials:'omit'});}});check();
 for(const [index,input]of transferred.inputs.entries()){
  if(!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(input.url))throw fail('图片参考需要 PNG、JPEG 或 WebP');
  check();const actual=await resolveMedia({id:input.nodeId||input.id||'masked-edit:'+index,type:'image',image:input.url},{signal});check();
  if(!Number.isSafeInteger(actual.width)||!Number.isSafeInteger(actual.height)||actual.width<1||actual.height<1)throw fail('图片实际解码尺寸无效');
  if(input.width!==undefined&&input.width!==actual.width||input.height!==undefined&&input.height!==actual.height)throw fail('图片实际解码尺寸与原声明不一致');
  input.width=actual.width;input.height=actual.height;
 }
 if(transferred.inputs.at(-1).url!==request.inputs.at(-1).url)throw fail('透明主图字节已变化，未重采样或提交');
 assertWorkflowRequestBudget(transferred);check();return transferred;
}
