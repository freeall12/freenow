import {videoModels} from './video-catalog.mjs';
import {supports,modelFor} from '../video-generation/settings.mjs';

export function videoModelContracts({model,referenceCounts}={}){
 if(model&&!modelFor(model))throw Error('未找到该视频模型，请先读取模型目录');
 if(referenceCounts&&Object.entries(referenceCounts).some(([key,value])=>!['image','video','audio'].includes(key)||!Number.isInteger(value)||value<0||value>100))throw Error('参考数量须为非负整数');
 const shape=referenceCounts?{image:0,video:0,audio:0,...referenceCounts}:null;
 const models=(model?[modelFor(model)]:videoModels).map(item=>({id:item.id,name:item.name,variants:item.variants.filter(variant=>!shape||supports(variant,shape)).map(variant=>{
  const {key,modelType,aspectRatioPolicy,referenceImageRange,referenceVideoRange,referenceAudioRange,referenceVideoDurationRange,options,defaults}=variant;
  return {key,mode:modelType,aspectRatioPolicy,referenceImageRange,referenceVideoRange,referenceAudioRange,referenceVideoDurationRange,options:structuredClone(options),defaults:structuredClone(defaults)};
 })})).filter(item=>item.variants.length);
 return {source:'captured-official-catalog',liveProviderVerified:false,...(shape?{referenceCounts:shape}:{}),models,
  note:'本地官方采集目录，不是供应商实时能力查询。生成时仍校验实际素材数量、时长与提供方配置；不可默默缩短素材。'};
}
