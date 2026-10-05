import {providerConfigurationStatus,resolveProviderConfiguration} from '../node-composer/provider-configuration.mjs';

export const skinModes=Object.freeze(['detailed','standard','heavy']);
export const skinSemanticProfiles=Object.freeze({
 detailed:Object.freeze({provider:'enhancor',model:'enhancor-detailed'}),
 standard:Object.freeze({provider:'enhancor',model:'enhancor-realistic-skin',enhancement_mode:'standard',skin_texture_level:0.32,skin_realism_level:1.7,preserve_eyes:true,preserve_mouth:true}),
 heavy:Object.freeze({provider:'enhancor',model:'enhancor-realistic-skin',enhancement_mode:'heavy',skin_texture_level:0.42,skin_realism_level:2.3,portrait_depth:0.4,preserve_background:true})
});
export const skinDisclosure='皮肤编辑按所选档位处理完整图片。Enhancor 公开接口还需公网来源发布和回调，原工具三档的完整映射尚未核实；仅填写 Key 不能启用。自建网关须明确实现对应皮肤合同。';
const fail=message=>Object.assign(Error(message),{code:'unsupported_generation',providerDispatched:false});
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const exact=(value,allowed)=>object(value)&&Object.keys(value).every(key=>allowed.includes(key));
const canonical=value=>JSON.stringify(value,(_key,item)=>object(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);

export function assertSkinRequest(request){
 if(!exact(request,['kind','label','nodeId','sourceNodeId','prompt','inputs','parameters','count','references'])||request.kind!=='image.skin'||request.prompt!==''||request.count!==undefined&&request.count!==1||request.references!==undefined&&(!Array.isArray(request.references)||request.references.length))throw fail('皮肤编辑需要空提示词、一个完整来源和单个结果');
 if(!exact(request.parameters,['mode'])||Object.keys(request.parameters).length!==1||!skinModes.includes(request.parameters.mode))throw fail('请选择 detailed、standard 或 heavy；皮肤编辑不接受其他参数');
 if(!Array.isArray(request.inputs)||request.inputs.length!==1)throw fail('皮肤编辑需要一张完整来源图片');
 const input=request.inputs[0];
 if(!exact(input,['type','role','url','nodeId','width','height'])||input.type!=='image'||input.role!=='source_image'||typeof input.url!=='string'||!input.url)throw fail('皮肤编辑需要完整 source_image，选区和裁切须先明确保存为图片');
 if(request.sourceNodeId!==undefined&&input.nodeId!==undefined&&request.sourceNodeId!==input.nodeId)throw fail('皮肤编辑来源身份不一致');
 for(const key of ['width','height'])if(input[key]!==undefined&&(!Number.isSafeInteger(input[key])||input[key]<1))throw fail('皮肤编辑来源尺寸无效');
 return request;
}

export function skinRequestState(metadata,request={kind:'image.skin'}){
 const status=providerConfigurationStatus(metadata,request),selected=resolveProviderConfiguration(metadata,request),profile=selected?.capabilities?.skin;
 const hint=skinDisclosure,reject=(reason,label='皮肤配置待完善')=>({ready:false,reason,hint,label});
 if(request?.kind!=='image.skin')return reject('此合同只支持独立 image.skin 操作');
 if(selected?.protocol==='tasks-v1')return reject('请选择专用 skin-tasks-v1 协议并实现皮肤合同；普通任务或图片路由不会默认启用皮肤编辑');
 if(status.configured!==true)return reject(status.message||'皮肤编辑服务尚未配置');
 if(!object(profile)||profile.kind!=='image.skin'||profile.sourceRole!=='source_image'||profile.sourceScope!=='complete-image'||profile.maxCount!==1||profile.maxInputImages!==1||profile.promptEditable!==false||profile.inputSizePolicy!=='original-dimensions'||profile.inputCodec!=='complete-noninterlaced-8bit-rgb-rgba-png'||canonical(profile.inputMimeTypes)!==canonical(['image/png'])||profile.maxInputBytes!==32*1024*1024||profile.maxInputPixels!==32*1024*1024||profile.preservesSubmittedSourceBytes!==true||profile.outputCount!==1||profile.outputSizePolicy!=='actual-decoded-dimensions'||profile.outputCodecValidation!=='complete-decode'||profile.tapNowEquivalent!==false)return reject('服务未声明完整来源、原尺寸、单结果及真实像素校验的独立皮肤合同');
 if(!Array.isArray(profile.rejectedPNGMetadataChunks)||canonical([...profile.rejectedPNGMetadataChunks].sort())!==canonical(['iCCP','iTXt','zTXt']))return reject('服务未声明皮肤 PNG 压缩元数据限制');
 if(!Array.isArray(profile.modes)||!profile.modes.length||new Set(profile.modes).size!==profile.modes.length||profile.modes.some(mode=>!skinModes.includes(mode))||!object(profile.profiles)||Object.keys(profile.profiles).some(mode=>!profile.modes.includes(mode))||profile.modes.some(mode=>canonical(profile.profiles[mode])!==canonical(skinSemanticProfiles[mode])))return reject('服务未声明所支持档位的精确皮肤语义，不会自动换档');
 if(selected.protocol==='skin-tasks-v1'){
  if(profile.implementation!=='external-gateway-contract')return reject('tasks-v1 需要外部网关明确实现皮肤合同；通用图片模型或 Key 不足以启用');
 }else if(profile.implementation!=='public-vendor-native'||profile.publicNativeProtocolVerified!==true)return reject('供应商公开皮肤协议或三档映射尚未核实，未提交模型');
 if(request.parameters!==undefined){
  try{assertSkinRequest(request);}catch(error){return reject(error.message,'请检查皮肤设置');}
  if(!profile.modes.includes(request.parameters.mode))return reject(profile.disabledModes?.[request.parameters.mode]||'所选皮肤档位尚未接入，未更改档位或提交模型','此档位尚未配置');
 }
 return {ready:true,reason:'',hint,label:selected.protocol==='skin-tasks-v1'?'独立皮肤网关 · 效果待验':'独立皮肤编辑 · 效果待验'};
}
export function assertSkinConfiguration(metadata,request){const state=skinRequestState(metadata,request);if(!state.ready)throw fail(state.reason);return request;}
