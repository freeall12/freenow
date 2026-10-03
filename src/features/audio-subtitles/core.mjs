export const audioSubtitleLimit=32768;
export function audioSubtitleEnabled(request){return request?.kind==='audio.generate'&&request.parameters?.model==='doubao-seed-audio-1-0'&&request.parameters?.enable_subtitle===true;}
export function subtitleText(output){
 if(output?.subtitle===undefined)return null;
 const value=output.subtitle;
 if(output.type!=='audio'||!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==1||typeof value.text!=='string'||!Object.hasOwn(value,'text')||new TextEncoder().encode(value.text).byteLength>audioSubtitleLimit||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value.text)||/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(value.text))throw Error('音频字幕结果格式无效');
 return value.text.trim()?value.text:null;
}
export const audioSubtitleSignature=node=>JSON.stringify(Object.fromEntries(Object.entries(node).filter(([key])=>!['x','y','selected'].includes(key))));
const matching=(nodes,id)=>nodes.filter(node=>node.type==='text'&&node.sourceAudioNodeId===id);
export function captureSubtitleBinding(source,nodes,acceptedAudioRef=source?.audio){
 if(source?.type!=='audio'||typeof acceptedAudioRef!=='string'||!acceptedAudioRef||source.audio!==acceptedAudioRef)throw Error('字幕来源音频尚未成功应用或已替换');
 const candidates=matching(nodes,source.id);if(candidates.length>1)throw Error('音频已有多个字幕节点，无法确定更新目标');
 const existing=candidates[0]||null;
 return {source,sourceAudio:source.audio,sourceSignature:audioSubtitleSignature(source),existing,existingContent:existing?.content??null,applied:null};
}
function assertBinding(binding,app,isCurrent){
 const nodes=app.getState().nodes;
 if(isCurrent()!==true||!nodes.includes(binding.source)||binding.source.type!=='audio'||binding.source.audio!==binding.sourceAudio||audioSubtitleSignature(binding.source)!==binding.sourceSignature)throw Error('字幕来源音频或画布已变化，旧结果未应用');
 const candidates=matching(nodes,binding.source.id),expected=binding.applied?.node||binding.existing;
 if(candidates.length>1||(expected?(candidates.length!==1||candidates[0]!==expected||expected.content!==(binding.applied?.text??binding.existingContent)):candidates.length!==0))throw Error('字幕节点已编辑、撤销或替换，旧结果未应用');
}

// Pair each explicit audio.subtitle with its successful audio result by index.
// Receipts retain live identities across retries so undo cannot resurrect text.
export async function applyAudioSubtitles({job,app,bindings,isCurrent=()=>true}={}){
 if(!audioSubtitleEnabled(job?.request))return [];
 if(job.status!=='succeeded'||!Array.isArray(job.outputs)||!Array.isArray(job.resultIds)||job.resultIds.length!==job.outputs.length)throw Error('音频结果尚未成功应用，不能应用字幕');
 const entries=[];
 for(let index=0;index<job.outputs.length;index++){
  const text=subtitleText(job.outputs[index]);if(text===null)continue;
  const binding=bindings?.[index];if(!binding||binding.source.id!==job.resultIds[index])throw Error('字幕与成功音频的对应关系无效');
  entries.push({binding,text});
 }
 if(!entries.length)return [];
 if(new Set(entries.map(({binding})=>binding.source.id)).size!==entries.length)throw Error('字幕结果重复指向同一个音频');
 for(const {binding}of entries)assertBinding(binding,app,isCurrent);
 for(const {binding,text}of entries){
  assertBinding(binding,app,isCurrent);
  if(binding.applied){if(binding.applied.text!==text)throw Error('任务字幕结果已变化，不能重写旧收据');continue;}
  const result=app.applyAudioSubtitle({source:binding.source,sourceAudio:binding.sourceAudio,existing:binding.existing,existingContent:binding.existingContent,text,title:'音频字幕'},{isCurrent:()=>{try{assertBinding(binding,app,isCurrent);return true;}catch{return false;}}});
  const node=app.getState().nodes.find(node=>node.id===(result?.id||result?.node?.id));
  if(!node||node.type!=='text'||node.sourceAudioNodeId!==binding.source.id||node.content!==text)throw Error('字幕节点未成功应用');
  binding.applied={node,text};
 }
 await app.saveProject();
 for(const {binding}of entries)assertBinding(binding,app,isCurrent);
 return entries.map(({binding})=>binding.applied.node.id);
}
