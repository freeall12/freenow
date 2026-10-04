export const directions=['片头延长','片尾延长'];
export const modes=['自然延续','动作接续','延续运镜','推进场景'];
export const clampDuration=value=>Math.max(4,Math.min(30,Math.round(value!==null&&String(value).trim()!==''&&Number.isFinite(Number(value))?Number(value):8)));
export const mediaSource=n=>n?.video||globalThis.EDITOR_DATA?.nodes[n?.id]?.video;
// The official toolbar selects this public catalog alias, independently of the
// source generation model. A server mapping supplies the actual provider ID.
export function extensionSettings(node){
  const params=node?.generation??node?.params??{},resolution=params.resolution??(/^(480p|720p|1080p|4k)$/i.test(params.quality??'')?params.quality:'720p');
  const audio=params.generateAudio??params.generate_audio??params.audio;
  return {direction:'片尾延长',duration:8,mode:'自然延续',modelId:'seedance-2.5',capabilityMode:'prompt_simulation',resolution:typeof resolution==='string'?resolution.toLowerCase():resolution,generateAudio:typeof audio==='boolean'?audio:true};
}
export function fitCreation(node,width,height){
  const availableHeight=height-88-176,reserved=236+8;
  const scale=Math.max(.01,Math.min((width-192)/node.width,Math.max(1,availableHeight-reserved)/node.height)*.75);
  return {scale,x:width/2-(node.x+node.width/2)*scale,y:88+availableHeight/2-reserved/2-(node.y+node.height/2)*scale};
}
export function extendRequest(node,settings,references,subjects,prompt,source){
  if(!source)throw Error('来源视频尚不可用，请先上传或生成视频');
  if(references.length+subjects.length>4)throw Error('最多添加 4 个参考素材或主体');
  if(!directions.includes(settings.direction)||!modes.includes(settings.mode))throw Error('延长参数无效');
  const direction=settings.direction==='片尾延长'?'forward':'backward';
  return {kind:'video.extend',label:'延长视频',nodeId:node.id,prompt,inputs:[{type:'video',url:source,nodeId:node.id,role:'source_video'},...references.map(r=>({type:r.type,nodeId:r.id,url:r.url,role:'reference',...(r.clip?{clip:r.clip}:{})})),...subjects.flatMap(s=>s.assets.map(a=>({type:a.type,url:a.url,text:a.text,subjectId:s.id,role:'subject_reference'})))],parameters:{...extensionSettings(node),...settings,duration:clampDuration(settings.duration),ratio:'自适应',extendDirection:direction,sourceClip:node.clip||null,subjects:subjects.map(s=>({id:s.id,name:s.name,description:s.description})),referenceIds:references.map(r=>r.id),candidateCount:1}};
}
