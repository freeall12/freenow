import {providerConfigurationStatus,resolveProviderConfiguration} from '../node-composer/provider-configuration.mjs';
const fail=message=>Object.assign(Error(message),{code:'unsupported_generation',providerDispatched:false});
export const panoramaEditDisclosure='独立 OpenAI 全景局部编辑：把当前可见框选区域转成透视图编辑，再投回原全景；区域外像素保留。仅支持局部框选，硬边回投可能出现接缝，效果需验收。';
export function panoramaEditRequestState(metadata,request){
 const selected=resolveProviderConfiguration(metadata,request),status=providerConfigurationStatus(metadata,request),native=selected?.protocol==='openai-panorama-edit-native';
 const reject=reason=>({ready:false,reason,hint:panoramaEditDisclosure,label:'全景编辑待配置'});
 if(status.configured!==true)return reject(status.message);
 if(native){
  const p=selected.capabilities?.panoramaEdit;
  if(p?.kind!=='panorama.edit'||p.semantics!=='perspective-mask-reproject'||p.tapNowEquivalent!==false||p.globalEditing!==false||p.regionPolicy!=='visible-convex-four-unit-directions'||p.minRegions!==1||p.maxRegions!==32||p.cropSize!=='1024x1024'||p.sourceWidth!==2048||p.sourceHeight!==1024||p.sourceProjection!=='equirectangular'||p.outputProjection!=='equirectangular'||p.outputSize!=='2048x1024'||p.composite!==true||!['low','medium','high','auto'].includes(p.quality)||p.outsideRegionPixels!=='exact-source-rgba'||p.sampling!=='nearest-pixel-center'||p.edgePolicy!=='hard-spherical-pixel-center-no-feather'||p.mask!=='alpha-zero'||p.maskPrecision!=='provider-guidance'||p.maxMaskBytes!==4*1024*1024||p.maxInputImages!==1||p.maxCount!==1||p.maxInputBytes!==32*1024*1024||p.maxInputPixels!==2048*1024||p.inputMimeTypes?.length!==1||p.inputMimeTypes[0]!=='image/png'||p.inputCodec!=='complete-noninterlaced-8bit-rgb-rgba-png'||JSON.stringify([...(p.rejectedPNGMetadataChunks||[])].sort())!==JSON.stringify(['iCCP','iTXt','zTXt']))return reject('全景服务未完整声明透视蒙版、回投、像素保留及独立编辑边界');
  if(request?.parameters&&!request.parameters.regions?.length)return reject('独立全景编辑需要先框选局部区域；整图编辑尚未支持');
 }
 return {ready:true,reason:'',hint:native?panoramaEditDisclosure:'全景编辑使用已配置的独立任务服务。',label:native?'独立全景局部编辑':'全景编辑已配置'};
}
export function assertPanoramaEditConfiguration(metadata,request){const state=panoramaEditRequestState(metadata,request);if(!state.ready)throw fail(state.reason);return request;}
