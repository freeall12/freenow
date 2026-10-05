import {providerConfigurationStatus,resolveProviderConfiguration} from '../node-composer/provider-configuration.mjs';

export const magnificLimits=Object.freeze({maxInputBytes:32*1024*1024,maxInputPixels:32*1024*1024});
export const magnificDisclosure='Magnific Precision V2 按锐化、颗粒、细节和倍率处理完整图片。接口与四项参数已核实，真实效果和收费尚未验收；不保证与参考工具效果一致。图片以原尺寸规范为 PNG，可能改变编码和色彩配置；32 MiB / 32 MP 是本机限制。';
export const magnificProfile=Object.freeze({
 kind:'image.upscale',model:'magnific-v2',vendor:'Magnific',implementation:'public-vendor-native',publicNativeProtocolVerified:true,
 sourceRole:'source_image',sourceScope:'complete-image',maxInputImages:1,maxCount:1,promptEditable:false,
 inputSizePolicy:'original-dimensions',inputCodec:'complete-noninterlaced-8bit-rgb-rgba-png',inputMimeTypes:['image/png'],
 ...magnificLimits,preservesSubmittedSourceBytes:true,inputOriginalEncodingGuaranteed:false,rejectedPNGMetadataChunks:['iCCP','iTXt','zTXt'],budgetScope:'local-only',
 scaleFactors:Array.from({length:15},(_,index)=>index+2),uiScaleFactors:Array.from({length:7},(_,index)=>index+2),
 parameters:{scaleFactor:{min:2,max:16,default:2},sharpen:{min:0,max:100,default:7},smartGrain:{min:0,max:100,default:7},ultraDetail:{min:0,max:100,default:30}},
 defaults:{scaleFactor:2,sharpen:7,smartGrain:7,ultraDetail:30},
 outputCount:1,outputMimeTypes:['image/png','image/jpeg','image/webp'],outputSizePolicy:'actual-decoded-dimensions',outputCodecValidation:'complete-decode',vendorOutputMimeGuaranteed:false,tapNowEquivalent:false
});
const fail=message=>Object.assign(Error(message),{code:'unsupported_generation',providerDispatched:false});
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const exact=(value,allowed)=>object(value)&&Object.keys(value).every(key=>allowed.includes(key));
const canonical=value=>JSON.stringify(value,(_key,item)=>object(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);

// Native requests preserve explicit intent; UI normalization must never hide
// unsupported parameters or turn another model into Precision V2.
export function assertMagnificRequest(request){
 if(!exact(request,['kind','label','nodeId','sourceNodeId','prompt','inputs','parameters','count','references'])||request.kind!=='image.upscale'||request.prompt!==''||request.count!==undefined&&request.count!==1||request.references!==undefined&&(!Array.isArray(request.references)||request.references.length))throw fail('Magnific 需要空提示词、一个完整来源和单个结果');
 const p=request.parameters;
 if(!exact(p,['provider','scaleFactor','sharpen','smartGrain','ultraDetail'])||Object.keys(p).length!==5||p.provider!=='magnific')throw fail('Magnific 仅接受倍率、锐化、颗粒和细节四项明确设置');
 for(const [key,range]of Object.entries(magnificProfile.parameters))if(!Number.isSafeInteger(p[key])||p[key]<range.min||p[key]>range.max)throw fail('Magnific 倍率须为 2–16 整数，锐化、颗粒和细节须为 0–100 整数');
 if(!Array.isArray(request.inputs)||request.inputs.length!==1)throw fail('Magnific 需要一张完整来源图片');
 const input=request.inputs[0];
 if(!exact(input,['type','role','url','nodeId','width','height'])||input.type!=='image'||input.role!=='source_image'||typeof input.url!=='string'||!input.url)throw fail('Magnific 需要完整 source_image，选区和裁切须先明确保存为图片');
 if(request.sourceNodeId!==undefined&&input.nodeId!==undefined&&request.sourceNodeId!==input.nodeId)throw fail('Magnific 来源身份不一致');
 for(const key of ['width','height'])if(input[key]!==undefined&&(!Number.isSafeInteger(input[key])||input[key]<1))throw fail('Magnific 来源尺寸无效');
 return request;
}

export function magnificRequestState(metadata,request={kind:'image.upscale',parameters:{provider:'magnific'}}){
 const status=providerConfigurationStatus(metadata,request),selected=resolveProviderConfiguration(metadata,request),native=selected?.protocol==='magnific-native';
 const hint=native?magnificDisclosure:'Magnific 使用已配置任务网关；网关须实际实现倍率、锐化、颗粒和细节四项设置，真实效果待验。';
 const reject=(reason,label='Magnific 配置待完善')=>({ready:false,reason,hint,label});
 if(request.kind!=='image.upscale'||request.parameters?.provider!=='magnific')return reject('此合同只支持 Magnific 图片放大');
 if(status.configured!==true)return reject(status.message||'Magnific 服务尚未配置');
 if(request.inputs!==undefined){try{assertMagnificRequest(request);}catch(error){return reject(error.message,'请检查 Magnific 设置');}}
 if(!native){
  if(selected?.protocol!=='tasks-v1')return reject('当前服务未接入 Magnific Precision V2 或明确的任务网关');
  return {ready:true,reason:'',hint,label:'Magnific 任务网关 · 效果待验'};
 }
 const profile=selected.capabilities?.upscaleMagnific;
 if(!object(profile)||Object.entries(magnificProfile).some(([key,value])=>canonical(profile[key])!==canonical(value)))return reject('服务未声明精确四参数、完整原尺寸来源及真实图片结果的 Magnific 原生合同');
 if(selected.capabilities?.models?.['image.upscale:magnific']?.model!=='magnific-v2')return reject('Magnific 公开别名须明确映射到 magnific-v2');
 return {ready:true,reason:'',hint,label:'Magnific 原生接口 · 效果待验'};
}
export function assertMagnificConfiguration(metadata,request){const state=magnificRequestState(metadata,request);if(!state.ready)throw fail(state.reason);return request;}
