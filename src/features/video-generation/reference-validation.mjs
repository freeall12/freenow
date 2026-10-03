const mediaTypes=['image','video','audio'];
const referenceModes=new Set(['REFERENCE_TO_VIDEO','REFERENCE_VIDEO_TO_VIDEO']);
const elements=value=>Array.isArray(value)&&value.length>0;
const token=value=>typeof value==='string'&&/\{\{ElementRef:[^:{}\s]+:[^{}]+\}\}/.test(value);

export function hasVideoSubjectReferences(request){
  const p=request.parameters||{},wire=p.providerParameters||{};
  return [request.elementRefs,request.element_refs,p.elementRefs,p.element_refs,p.elementList,wire.elementRefs,wire.element_refs].some(elements)||
    token(request.prompt)||token(p.subjectPrompt)||
    (Array.isArray(p.subjects)&&p.subjects.some(subject=>Array.isArray(subject?.assets)&&subject.assets.length>0));
}

// Official Zv checks media AND elements after prompt expansion. Plain upstream
// text is not a media reference; a projected text-only subject still is an element.
export function videoSubmissionMode(request,mode){
  if(!referenceModes.has(mode)||(request.inputs||[]).some(input=>mediaTypes.includes(input?.type))||hasVideoSubjectReferences(request))return mode;
  return 'TEXT_TO_VIDEO';
}

export function videoReferenceDurationViolation(variant,inputs=[],{allowUnknown=false,useDurationMs=true}={}){
  for(const type of ['video','audio']){
    const range=variant?.['reference'+type[0].toUpperCase()+type.slice(1)+'DurationRange'];
    if(!range)continue;
    const label=type==='video'?'视频':'音频',media=inputs.filter(input=>input?.type===type);
    let total=0;
    for(const [index,input]of media.entries()){
      const duration=input.duration!==undefined?input.duration:useDurationMs&&input.durationMs!==undefined?typeof input.durationMs==='number'?input.durationMs/1000:NaN:undefined;
      if(duration===undefined){
        if(allowUnknown)continue;
        return {code:'video_reference_duration_unknown',reason:'unknown',type,index,message:'无法确认第 '+(index+1)+' 段'+label+'参考的真实时长，请重新读取媒体后重试；未提交模型'};
      }
      if(typeof duration!=='number'||!Number.isFinite(duration)||duration<=0)return {code:'video_reference_duration_invalid',reason:'invalid_duration',type,index,message:'第 '+(index+1)+' 段'+label+'参考缺少有效的有限时长，未提交模型'};
      // Wde in the official vendor bundle applies tolerance only to upper bounds.
      const tolerance=range.maxTolerance??0;
      if(duration<(range.min??0)||duration>(range.max??Infinity)+tolerance)return {code:'video_reference_duration',reason:'single_out_of_range',type,index,message:'实际'+label+'参考时长超出模型限制：每段须为 '+(range.min??0)+'–'+(range.max??'不限')+' 秒'+(tolerance?'，上限容差 '+tolerance+' 秒':'')+'，未自动截短'};
      total+=duration;
    }
    if(total>(range.totalMax??Infinity)+(range.maxTolerance??0))return {code:'video_reference_duration',reason:'total_exceeded',type,message:'实际'+label+'参考时长超出模型限制：合计不超过 '+range.totalMax+' 秒'+(range.maxTolerance?'，上限容差 '+range.maxTolerance+' 秒':'')+'，未自动截短'};
  }
  return null;
}

export function assertVideoReferenceDurations(variant,inputs,options){
  const violation=videoReferenceDurationViolation(variant,inputs,options);
  if(violation)throw Object.assign(Error(violation.message),{code:violation.code,providerDispatched:false});
}
