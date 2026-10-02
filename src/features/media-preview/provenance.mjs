const text=value=>typeof value==='string'&&value.trim()?value.trim():null;
export const mediaSource=output=>output?.type==='video'?output.video||output.url:output?.fullImage||output?.image||output?.url;

// Composer settings describe the next request. Capture the dispatched request
// alongside its output so later edits cannot relabel an existing media file.
export function resultProvenance(job,output){
  if(!['image','video'].includes(output?.type))return {};
  const analysis=job.request?.kind==='video.analyze'||!!output.sourceRange;
  return {provenance:{kind:analysis?'video-analysis':'generation-result',taskId:job.id,requestKind:job.request?.kind,
    mediaSource:mediaSource(output),model:analysis?null:text(output.model)||text(job.request?.parameters?.model)||text(job.request?.parameters?.modelId),
    prompt:analysis?'':job.request?.prompt||'',...(output.sourceRange?{sourceRange:structuredClone(output.sourceRange)}:{})}};
}

export function retainedProvenance(node,source){
  if(node.sourceRange&&!node.provenance)return {kind:'video-analysis',mediaSource:source,model:null,sourceRange:structuredClone(node.sourceRange)};
  return node.provenance&&(!node.provenance.mediaSource||node.provenance.mediaSource===source)?structuredClone(node.provenance):{kind:'imported',mediaSource:source,model:null};
}

export function historicalProvenance(batch,item,source){
  if(item.provenance)return retainedProvenance(item,source);
  if(item.sourceRange)return {kind:'video-analysis',mediaSource:source,model:null,sourceRange:structuredClone(item.sourceRange)};
  const itemModel=text(item.generation?.model)||text(item.model);
  if(!itemModel&&(batch.id==='legacy'||batch.id?.startsWith('previous:')))return {kind:'imported',mediaSource:source,model:null};
  return {kind:'generation-result',mediaSource:source,model:itemModel||text(batch.parameters?.model)||text(batch.parameters?.modelId),prompt:item.generation?.prompt??batch.prompt??''};
}

export function previewModel(resource,source,fallback=null){
  const provenance=resource?.provenance;
  if(provenance){
    if(provenance.mediaSource&&provenance.mediaSource!==source)return null;
    return provenance.kind==='generation-result'?text(provenance.model):null;
  }
  if(resource?.sourceRange)return null;
  return text(fallback);
}
