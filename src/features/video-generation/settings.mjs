import {videoModels} from '../agent-generation/video-catalog.mjs';
import {isDraftConfig,isFinalConfig} from './draft-final.mjs';
import {assertMinimaxVideoChoices,isMinimaxH3} from './minimax-native.mjs';
export const modelFor=value=>videoModels.find(m=>m.id===value||m.name===value||m.aliases.includes(value));
export function shapeOf(inputs=[]){return Object.fromEntries(['image','video','audio'].map(type=>[type,new Set(inputs.filter(i=>i.type===type).map(i=>i.id||i.nodeId||i.key||i.url)).size]));}
export function supports(variant,shape){
  const {image=0,video=0,audio=0}=shape;
  if(variant.modelType==='TEXT_TO_VIDEO')return !image&&!video&&!audio;
  if(variant.modelType==='IMAGE_TO_VIDEO')return image===1&&!video&&!audio;
  if(variant.modelType==='START_END_TO_VIDEO')return image>=1&&image<=2&&!video&&!audio;
  if(variant.referenceAudioRequiresCompanion&&audio&&!image&&!video)return false;
  return ['image','video','audio'].every(type=>{const range=variant['reference'+type[0].toUpperCase()+type.slice(1)+'Range'];return range?shape[type]>=(range.min||0)&&shape[type]<=(range.max??Infinity):!shape[type];});
}
const family=type=>['TEXT_TO_VIDEO','IMAGE_TO_VIDEO','START_END_TO_VIDEO'].includes(type)?'首尾帧':type==='VIDEO_EDIT'?'视频编辑':'全能参考';
// UI settings use undefined for inapplicable controls; durable wire records must
// contain JSON values, just like an actual browser POST after JSON.stringify.
const wireSettings=value=>Object.fromEntries(Object.entries(value).filter(([,entry])=>entry!==undefined));
export function variantsFor(model,mode,shape){return model.variants.filter(v=>family(v.modelType)===mode).sort((a,b)=>{
  const score=v=>v.modelType==='REFERENCE_VIDEO_TO_VIDEO'?(shape.video?0:4):v.modelType==='REFERENCE_TO_VIDEO'?1:0;
  return score(a)-score(b);
});}
export function configuration(config,inputs=[]){
  const model=modelFor(config.model||config.modelId);if(!model)return null;
  if(config.draftVideoId!==undefined&&config.draftVideoId!==null){
    if(!isFinalConfig(config))throw Object.assign(new Error('正式片需要有效的 Seedance 2.5 样片引用'),{code:'draft_reference_unavailable'});
    const variant=model.variants.find(v=>v.modelType===config.videoMode)||model.variants[0];
    const settings={...config,model:model.name,modelId:model.id,draft:false,quality:'1080p',resolution:'1080p',count:1,times:1,prompt:''};
    return {model,variant,options:{resolutions:['1080p']},settings,modeOptions:[],hint:'沿用样片内容生成正式片',error:''};
  }
  const draft=isDraftConfig(config);
  const shape=shapeOf(inputs),modes=['首尾帧','全能参考','视频编辑'].filter(mode=>model.variants.some(v=>family(v.modelType)===mode));
  const requested=config.videoMode?family(config.videoMode):config.mode;
  const emptyMinimax=isMinimaxH3(model)&&!shape.image&&!shape.video&&!shape.audio;
  const mode=emptyMinimax&&(!requested||requested==='全能参考')?'首尾帧':modes.includes(requested)?requested:(modes.includes('全能参考')?'全能参考':modes[0]);
  const candidates=variantsFor(model,mode,shape);
  const variant=candidates.find(v=>v.modelType===config.videoMode&&supports(v,shape))||candidates.find(v=>supports(v,shape))||candidates[0];
  const options=draft?{...variant.options,resolutions:['480p']}:variant.options,defaults=variant.defaults;
  const pick=(values,current,fallback)=>values?.includes(current)?current:values?.includes(fallback)?fallback:values?.[0];
  const settings={...config,model:model.name,mode,videoMode:variant.modelType,variant:variant.key,
    ratio:pick(options.aspectRatios,config.ratio??config.aspectRatio??config.aspect,defaults.aspectRatio),
    quality:pick(options.resolutions,options.resolutions?.includes(config.quality)?config.quality:config.resolution,defaults.resolution),
    duration:pick(options.durations,config.duration,defaults.duration),
    generateMode:pick(options.modes,config.generateMode??config.quality,defaults.generateMode),
    audio:options.supportsAudio?(config.audio??config.generateAudio??defaults.generateAudio??false):undefined};
  settings.audioLabel=settings.audio?'开启':'关闭';
  if(draft)Object.assign(settings,{draft:true,quality:'480p',resolution:'480p'});
  const modeOptions=modes.map(label=>({label,disabled:emptyMinimax&&label==='全能参考'||!variantsFor(model,label,shape).some(v=>supports(v,shape))}));
  const hints=[...new Set(model.variants.filter(v=>family(v.modelType)==='全能参考').map(v=>['image','video','audio'].map(type=>{const r=v['reference'+type[0].toUpperCase()+type.slice(1)+'Range'];return r?.max?`最多${r.max}${{image:'张图',video:'个视频',audio:'段音频'}[type]}`:null;}).filter(Boolean).join(' + ')).filter(Boolean))];
  const hint=hints.length>1?'支持以下任一种模式：\n'+hints.map(value=>'• '+value).join('\n'):hints[0]||'';
  return {model,variant,options,settings,modeOptions,hint,error:supports(variant,shape)?'':'所选生成方式不支持当前参考素材'};
}
export function prepareVideoRequest(request){
  if(request.kind!=='video.generate')return request;
  if((Object.hasOwn(request.parameters||{},'draftVideoId')||Object.hasOwn(request.parameters?.providerParameters||{},'draft_video_id'))&&!isFinalConfig(request.parameters))throw Object.assign(new Error('正式片需要有效的 Seedance 2.5 样片引用'),{code:'draft_reference_unavailable'});
  const data=configuration(request.parameters||{},request.inputs||[]);if(!data)return request;
  assertMinimaxVideoChoices(request.parameters||{},data);
  if(data.error)throw Error(data.error);
  const s=data.settings;
  if(isFinalConfig(s)){
    const providerParameters={model:data.model.id,draft_video_id:s.draftVideoId,resolution:'1080p',times:1};
    const parameters={...s,providerParameters};
    for(const key of ['elementRefs','element_refs','elementList','subjects','refs','referenceBindings','referenceOrder','referenceIds','images','videos','audios'])delete parameters[key];
    const prepared={...request,prompt:'',inputs:[],parameters:wireSettings(parameters)};
    delete prepared.elementRefs;delete prepared.element_refs;
    return prepared;
  }
  const providerParameters=Object.fromEntries(Object.entries({model:data.model.id,modelType:s.videoMode,variant:s.variant,aspectRatio:s.ratio,resolution:s.quality,duration:s.duration,generateAudio:s.audio,generateMode:s.generateMode,times:s.count??1,...isDraftConfig(s)?{draft:true}:{}}).filter(([,value])=>value!==undefined));
  const draftEstimateMedia=isDraftConfig(s)?Object.fromEntries(['image','video','audio'].map(type=>[type+'s',(request.inputs||[]).filter(input=>input.type===type).map(input=>input.url||input[type]).filter(url=>typeof url==='string'&&url.trim())])):undefined;
  return {...request,parameters:wireSettings({...s,modelId:data.model.id,providerParameters,...draftEstimateMedia?{draftEstimateMedia}:{}})};
}
export function triggerLabel(data){const s=data.settings;return [s.generateMode&&({std:'标准',pro:'专业','4k':'4K'}[s.generateMode]||s.generateMode),data.modeOptions.length>1?s.mode:null,s.ratio==='adaptive'?'自适应':s.ratio||'自动',s.quality||'自动',s.duration===-1?'自动':s.duration?`${s.duration}s`:null].filter(Boolean).join(' · ');}
