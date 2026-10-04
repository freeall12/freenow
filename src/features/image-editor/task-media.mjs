import {createWorkflowMediaResolver} from '../agent-workflows/media-resolver.mjs';
import {prepareWorkflowInputs,assertWorkflowRequestBudget} from '../agent-workflows/media-transport.mjs';
import {resolveProviderConfiguration} from '../node-composer/provider-configuration.mjs';

const kinds=['image.upscale','image.skin','image.remove-background','image.multiAngle'];
const styles=['general','low_resolution','animation_3d','high_fidelity','text_refine'];
const failure=(code,message)=>Object.assign(Error(message),{code,providerDispatched:false});

// The task service calls this after checking its captured provider configuration.
// Resolve identity without an Image network probe; local bytes use the shared
// bounded, abortable transport while public URLs retain their original quality.
export async function prepareImageToolMedia(request,{
  signal,validateSources=()=>{},localAssets=globalThis.LocalAssets,
  baseUrl=globalThis.document?.baseURI,nativeConfiguration,
  resolveMedia=createWorkflowMediaResolver({localAssets,baseUrl}),transport=prepareWorkflowInputs
}={}){
  if(!kinds.includes(request?.kind))return request;
  nativeConfiguration=resolveProviderConfiguration(nativeConfiguration,request);
  const native=nativeConfiguration?.protocol==='fal-native';
  const check=()=>{if(signal?.aborted)throw signal.reason??new DOMException('图片工具准备已取消','AbortError');validateSources();};
  check();
  if(native){
    const p=request.parameters||{};
    if(request.kind==='image.upscale'){
      if((p.provider??'topazlabs')!=='topazlabs')throw failure('unsupported_generation','当前 fal 接口尚未配置 Magnific 图片增强');
      if(p.scale===6)throw failure('unsupported_generation','当前 fal Topaz 接口只支持 2x、4x，6x 尚未配置');
      if(![2,4].includes(p.scale??2)||!styles.includes(p.style??'general'))throw failure('unsupported_generation','当前 fal Topaz 接口不支持所选放大倍数或风格');
    }else if(!['image.remove-background','image.multiAngle'].includes(request.kind))throw failure('unsupported_generation','当前 fal 接口尚未配置皮肤增强');
    if(!Array.isArray(request.inputs)||request.inputs.length!==1||request.inputs[0]?.type!=='image')throw failure('unsupported_generation','当前 fal 图片工具需要一张完整图片');
  }
  if(!Array.isArray(request.inputs))throw failure('invalid_media_request','图片工具缺少素材列表');
  assertWorkflowRequestBudget(request);
  const prepared=structuredClone(request);
  for(const [index,input]of prepared.inputs.entries()){
    check();
    if(input?.type!=='image'||typeof (input.fullImage||input.url)!=='string'||!(input.fullImage||input.url))throw failure('invalid_media_input','图片工具需要有效的来源图片');
    const actual=await resolveMedia({id:input.nodeId||input.id||input.key||request.sourceNodeId||'image-tool:'+index,type:'image',image:input.url,fullImage:input.fullImage},{signal,decodeImage:false});
    check();input.url=actual.url;
    if(native){
      const url=new URL(input.url,baseUrl),sameOrigin=!!baseUrl&&url.origin===new URL(baseUrl).origin;
      if(url.username||url.password)throw failure('invalid_media_url','图片工具素材地址不能包含用户名或密码');
      if(url.protocol==='http:'&&!sameOrigin)throw failure('invalid_media_url','fal 图片工具的公开素材需要 HTTPS 地址');
    }
  }
  const transferred=await transport(prepared,{signal,baseUrl,validateSources});check();
  if(native)for(const input of transferred.inputs){
    if(input.url.startsWith('data:')&&!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(input.url))throw failure('unsupported_generation','fal 图片工具需要 PNG、JPEG 或 WebP 图片');
  }
  assertWorkflowRequestBudget(transferred);check();return transferred;
}
