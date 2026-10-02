import {isDraftFinal,createDraftFinalDraft,confirmDraftFinal} from './draft-final.mjs';
export {isDraftFinal};
export {draftSummary} from './draft-final.mjs';
import {audioModels,audioModel,createAudioDraft,normalizeAudio,audioOptions,audioCompatibility,validateAudioDraft,audioFields} from './audio.mjs';
export {audioModels};
import {models,modelFor,normalize,countsFor,sizesFor,inputCompatibility} from '../image-generation/catalog.mjs';
import {videoModels} from './video-catalog.mjs';
import {normalizeResultMode} from '../generation-results/counts.mjs';
export function generationResultMode(mode){
 if(mode!==undefined)return normalizeResultMode(mode);
 if(typeof window==='undefined')return 'variants';
 try{return normalizeResultMode(globalThis.localStorage?.getItem('tapnow.canvas.generation-result-mode'));}catch{return 'variants';}
}
const imageIds=['gpt-image-2.5-flare','gpt-image-2.5-sunburst','gpt-image-2','nano-banana-flash','nano-banana-flash-lite','tamar-google-gemini-pro','doubao-seedream-5.0-lite','doubao-seedream-5.0-pro','midjourney-v7','midjourney-v8.2','midjourney-v8.1'];
export const imageModels=imageIds.map(id=>models.find(m=>m.id===id)).filter(Boolean);
export {videoModels};
const aliases={'nano-banana-2':'nano-banana-flash','nano-banana-2-lite':'nano-banana-flash-lite','nano-banana-pro':'tamar-google-gemini-pro','seedream-5-lite':'doubao-seedream-5.0-lite','seedream-5-pro':'doubao-seedream-5.0-pro','wan-3.0':'wan3.0-video'};
export const supportsCard=trace=>['generation_submit','generation_batch'].includes(trace.name)&&['image.generate','video.generate','audio.generate'].includes(trace.args?.kind);
export function findModel(kind,value){
 if(kind==='audio.generate')return audioModel(value);
 const id=aliases[value]||value;
 return kind==='image.generate'?modelFor(id):videoModels.find(m=>m.id===id||m.name===id||m.aliases.includes(id));
}
export function referencesFor(args,nodes){
 if(isDraftFinal(args))return nodes.filter(node=>node.id===args.draftSourceId);
 return (args.referenceIds??(args.kind==='audio.generate'?[]:[args.nodeId])).map(id=>nodes.find(n=>n.id===id)).filter(Boolean).filter(n=>n.image||n.video||n.audio||n.content);
}
export function referenceShape(args,nodes){
 const refs=referencesFor(args,nodes);return {image:refs.filter(n=>!n.video&&!n.audio&&n.image).length,video:refs.filter(n=>n.video).length,audio:refs.filter(n=>n.audio&&!n.video).length};
}
function fits(shape,range,type){const n=shape[type];return range?n>=(range.min??0)&&n<=(range.max??Infinity):n===0;}
export function compatibleVariants(model,shape){
 return model.variants.filter(v=>{
  const {image,video,audio}=shape;
  if(v.modelType==='TEXT_TO_VIDEO')return !image&&!video&&!audio;
  if(v.modelType==='IMAGE_TO_VIDEO')return image===1&&!video&&!audio;
  if(v.modelType==='START_END_TO_VIDEO')return image>=1&&image<=2&&!video&&!audio;
  if(v.referenceAudioRequiresCompanion&&audio&&!image&&!video)return false;
  return image+video+audio>0&&fits(shape,v.referenceImageRange,'image')&&fits(shape,v.referenceVideoRange,'video')&&fits(shape,v.referenceAudioRange,'audio');
 });
}
export function compatibility(kind,model,shape,draft={}){
 if(kind==='audio.generate')return audioCompatibility(normalizeAudio({...draft,model:model.id}),shape);
 if(kind==='image.generate')return shape.video||shape.audio?'此图片模型不支持视频或音频参考':inputCompatibility(model,shape.image).supported?'':inputCompatibility(model,shape.image).reason;
 return compatibleVariants(model,shape).length?'':'所选模型不支持当前参考素材';
}
export function createGenerationDraft(args,config={},nodes=[]){
 if(isDraftFinal(args))return createDraftFinalDraft(args,nodes);
 if(args.kind==='audio.generate')return createAudioDraft(args,nodes);
 const model=findModel(args.kind,args.model||config.model);
 const draft={...structuredClone(args),model:args.model||model?.id||config.model,aspect:args.aspect??config.ratio,duration:args.duration??config.duration,count:args.count??(args.kind==='image.generate'?config.count??1:1),imageSize:args.imageSize??config.imageSize??(args.kind==='image.generate'?config.quality:undefined),quality:args.quality??config.outputQuality,resolution:args.resolution??(args.kind==='video.generate'?config.quality:undefined),generateAudio:args.generateAudio??config.audio};
 if(args.kind==='image.generate')draft.resultMode=generationResultMode(config.resultMode);
 return normalizeDraft(draft,nodes);
}
export function normalizeDraft(draft,nodes=[]){
 if(isDraftFinal(draft))return {...draft};
 if(draft.kind==='audio.generate')return normalizeAudio(draft);
 const next={...draft},model=findModel(next.kind,next.model);if(!model)return next;
 next.model=model.id;
 if(next.kind==='image.generate'){
  const config=normalize({model:model.id,ratio:next.aspect,imageSize:next.imageSize,outputQuality:next.quality,count:next.count,resultMode:generationResultMode(next.resultMode)},model);
  next.aspect=config.ratio;next.imageSize=config.imageSize;next.quality=config.outputQuality;next.count=config.count;next.resultMode=config.resultMode;
  delete next.duration;delete next.resolution;delete next.generateAudio;delete next.videoMode;
 }else{
  const variants=compatibleVariants(model,referenceShape(next,nodes));
  const variant=variants.find(v=>v.modelType===next.videoMode)||variants.find(v=>v.modelType==='REFERENCE_TO_VIDEO')||variants[0];
  if(!variant)return next;
  next.videoMode=variant.modelType;const {options:o,defaults:d}=variant;
  next.aspect=o.aspectRatios?.includes(next.aspect)?next.aspect:d.aspectRatio;
  next.duration=o.durations?.includes(next.duration)?next.duration:d.duration;
  next.resolution=o.resolutions?.includes(next.resolution)?next.resolution:d.resolution;
  next.quality=o.modes?.includes(next.quality)?next.quality:d.generateMode;
  next.generateAudio=o.supportsAudio?(typeof next.generateAudio==='boolean'?next.generateAudio:d.generateAudio):undefined;
  delete next.imageSize;delete next.count;
 }
 return Object.fromEntries(Object.entries(next).filter(([,v])=>v!==undefined));
}
export function parameterOptions(draft,nodes=[]){
 if(isDraftFinal(draft))return {};
 if(draft.kind==='audio.generate')return audioOptions(draft);
 const model=findModel(draft.kind,draft.model);if(!model)return {};
 if(draft.kind==='image.generate')return {aspect:model.ratios,imageSize:sizesFor(model,draft.aspect),quality:model.qualities,count:countsFor(model,generationResultMode(draft.resultMode)).reverse()};
 const variants=compatibleVariants(model,referenceShape(draft,nodes)),variant=variants.find(v=>v.modelType===draft.videoMode)||variants[0];
 if(!variant)return {};
 return {videoMode:variants.map(v=>v.modelType),aspect:variant.options.aspectRatios,duration:variant.options.durations,resolution:variant.options.resolutions,quality:variant.options.modes,generateAudio:variant.options.supportsAudio?[true,false]:undefined};
}
const editableFields=[...audioFields,'prompt','model','aspect','imageSize','quality','count','duration','resolution','generateAudio','videoMode'];
export function confirmedArguments(original,draft,nodes=[],edges=[]){
 if(isDraftFinal(original))return confirmDraftFinal(original,draft,nodes,edges);
 if(!nodes.some(n=>n.id===original.nodeId))throw Error('来源节点已删除');
 if((original.referenceIds||[]).some(id=>!nodes.some(n=>n.id===id)))throw Error('参考素材已删除，请取消后重新提交');
 if(typeof draft.prompt!=='string'||(original.kind!=='audio.generate'&&!draft.prompt.trim())||draft.prompt.length>12000)throw Error('提示词不能为空，且不能超过 12000 字');
 const next={...structuredClone(original)};
 for(const key of editableFields){if(draft[key]===undefined)delete next[key];else next[key]=draft[key];}
 // Never let confirmation editing change tool authority, target, or references.
 if(next.kind==='audio.generate'){validateAudioDraft(next,referencesFor(next,nodes));return next;}
 const model=findModel(next.kind,next.model);
 if(model){const error=compatibility(next.kind,model,referenceShape(next,nodes));if(error)throw Error(error);const options=parameterOptions({...next,...next.kind==='image.generate'?{resultMode:generationResultMode(draft.resultMode)}:{}},nodes);for(const [key,values]of Object.entries(options))if(values?.length&&next[key]!==undefined&&!values.includes(next[key]))throw Error('生成参数无效：'+key);}
 return next;
}
export function generationStatus(trace){
 if(trace.batchItems){
  if(trace.status==='cancelled'&&trace.batchItems.some(item=>item.result?.taskId))return {label:'已停止提交',state:'skipped',error:trace.result?.error};
  if(!['pending','denied','cancelled','interrupted'].includes(trace.status)){const failures=trace.batchItems.map((item,index)=>({index,status:generationStatus(item)})).filter(item=>item.status.error);if(failures.length)return {label:'失败',state:'failed',error:failures.map(item=>`第 ${item.index+1} 项：${item.status.error}`).join('\n')};}
 }
 if(trace.status==='pending')return {label:'',state:'pending'};
 if(trace.status==='denied'||trace.status==='cancelled')return {label:'已取消',state:'cancelled'};
 if(trace.status==='interrupted')return {label:'状态未恢复',state:'skipped',error:trace.result?.error};
 const job=trace.generationJob;
 if(job?.recovered&&job.status==='succeeded'&&!job.applied&&!job.applicationError)return {label:job.applying?'结果应用中':'结果待取回',state:'confirmed'};
 if(job?.status==='unknown')return {label:'状态未恢复',state:'skipped',error:job.error};
 if(trace.status==='error'||job?.error||job?.applicationError||['configuration_required','failed'].includes(job?.status))return {label:'失败',state:'failed',error:job?.applicationError||job?.error||trace.result?.error};
 if(job?.status==='cancelled')return {label:'已取消',state:'cancelled'};
 return {label:trace.confirmationMode==='auto'?'Act':'已确认',state:trace.confirmationMode==='auto'?'auto':'confirmed'};
}
