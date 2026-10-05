import {anglePresets,brightnessStops,temperatureStops,rimPresets,rimAllowed} from '../../../image-relight-core.mjs';
import {providerConfigurationStatus,resolveProviderConfiguration} from '../node-composer/provider-configuration.mjs';
const fail=message=>Object.assign(Error(message),{code:'unsupported_generation',providerDispatched:false});
export const relightDisclosure='独立打光：按所选光位、亮度、色温与轮廓光编辑图片；不保证与参考站的物理打光效果一致，结果尺寸由模型决定。';

// Validate explicit intent, without the core's UI normalization/defaulting.
export function assertRelightRequest(request){
 const p=request?.parameters,a=anglePresets.find(value=>value.key===p?.angle?.preset);
 if(request?.kind!=='image.relight'||!p||!a||Object.keys(p.angle).some(key=>key!=='preset')||!brightnessStops.includes(p.brightnessPercent)||!temperatureStops.includes(p.temperatureK)||typeof p.rimEnabled!=='boolean'||!Object.hasOwn(rimPresets,p.rimPreset))throw fail('请选择标准光位、亮度、色温及轮廓光设置');
 if(p.rimEnabled&&!rimAllowed(a.azimuthDeg,a.elevationDeg))throw fail('当前主光位不支持轮廓光，请关闭轮廓光或选择支持的光位');
 if(Object.keys(p).some(key=>!['angle','brightnessPercent','temperatureK','rimEnabled','rimPreset'].includes(key))||request.prompt!==''||request.inputs?.length!==1||request.inputs[0]?.type!=='image'||request.inputs[0]?.role!=='source_image'||typeof request.inputs[0]?.url!=='string'||!request.inputs[0].url)throw fail('打光需要完整来源图片及明确参数，不支持额外提示词、模型或选段');
 return request;
}
export function relightRequestState(metadata,request){
 const status=providerConfigurationStatus(metadata,request),selected=resolveProviderConfiguration(metadata,request),native=selected?.protocol==='openai-relight-native';
 const hint=native?relightDisclosure:'打光使用已配置的独立图片编辑服务，效果需以生成结果为准。';
 const reject=reason=>({ready:false,reason,hint,label:selected?.missing?.some(key=>key.includes('KEY'))?'缺少 Key':'打光配置待完善'});
 if(status.configured!==true)return reject(status.message);
 if(native){
  const profile=selected.capabilities?.relight;
  const eligible=anglePresets.filter(value=>rimAllowed(value.azimuthDeg,value.elevationDeg)).map(value=>value.key).sort();
  if(profile?.semantics!=='parameter-prompt-edit'||profile.kind!=='image.relight'||profile.sourceRole!=='source_image'||profile.maxInputImages!==1||profile.maxCount!==1||profile.promptEditable!==false||profile.sizePolicy!=='provider-native-output'||profile.physicalLightingGuaranteed!==false||profile.tapNowEquivalent!==false||profile.inputMimeTypes?.length!==1||profile.inputMimeTypes[0]!=='image/png'||JSON.stringify(profile.anglePresets)!==JSON.stringify(anglePresets)||JSON.stringify(profile.brightnessPercent)!==JSON.stringify(brightnessStops)||JSON.stringify(profile.temperatureK)!==JSON.stringify(temperatureStops)||JSON.stringify(profile.rimPresets)!==JSON.stringify(rimPresets))return reject('打光服务尚未声明完整光位、亮度、色温、轮廓光及独立编辑能力');
  if(profile.preservesSourceBytes!==true||profile.aspectMatchGuaranteed!==false||profile.inputCodec!=='complete-noninterlaced-8bit-rgb-rgba-png'||profile.maxInputBytes!==50*1024*1024-1||profile.maxInputPixels!==32*1024*1024||!Array.isArray(profile.rimEligibleAngles)||JSON.stringify([...profile.rimEligibleAngles].sort())!==JSON.stringify(eligible))return reject('打光服务未声明完整来源图片、像素预算及精确轮廓光限制');
  if(!Array.isArray(profile.rejectedPNGMetadataChunks)||JSON.stringify([...profile.rejectedPNGMetadataChunks].sort())!==JSON.stringify(['iCCP','iTXt','zTXt']))return reject('打光服务未声明精确的 PNG 压缩元数据限制');
 }
 if(request.parameters){try{assertRelightRequest(request);}catch(error){return {...reject(error.message),label:'请检查打光设置'};}}
 return {ready:true,reason:'',hint,label:native?'独立打光 · 效果待验':'打光服务已配置'};
}
export function assertRelightConfiguration(metadata,request){const state=relightRequestState(metadata,request);if(!state.ready)throw fail(state.reason);return request;}
