import {audioSubtitleEnabled,subtitleText} from '../audio-subtitles/core.mjs';
export const audioGenerationSignature=node=>JSON.stringify(Object.fromEntries(Object.entries(node).filter(([key])=>!['x','y','selected'].includes(key))));
const localRef=value=>typeof value==='string'&&/^asset:[^\s]+$/.test(value);
const clone=value=>structuredClone(value);
const stale=()=>Error('音频节点、参数或项目已变化，旧生成结果未应用');

// Ordinary generation owns the submitted audio object. Workflow, derived and
// explicit recovery imports keep their own application contracts.
export async function applyOrdinaryAudioResult({job,receipt,app,isCurrent,localize,inspect,hasPendingEdits=()=>false,onApplied=()=>{}}){
 if(job?.status!=='succeeded'||!job.outputs?.length||job.outputs.some(output=>output.type!=='audio'))throw Error('音频节点需要实际音频生成结果');
 if(receipt?.source?.type!=='audio'||typeof isCurrent!=='function'||typeof localize!=='function'||typeof inspect!=='function')throw Error('原位音频应用接口不完整');
 const source=receipt.source;
 const outputSignature=receipt.audioApplied?.outputSignature??JSON.stringify(job.outputs),outputs=clone(job.outputs);
 const guard=()=>{
  const expected=receipt.audioApplied?.signature??receipt.signature;
  if(!isCurrent()||!app.getState().nodes.includes(source)||audioGenerationSignature(source)!==expected||hasPendingEdits(source.id))throw stale();
  if(JSON.stringify(job.outputs)!==outputSignature)throw Error('音频任务输出在应用期间已变化，旧结果未应用');
 };
 const subtitleGuard=()=>{
  if(!audioSubtitleEnabled(receipt.request)||subtitleText(outputs[0])===null)return;
  const candidates=app.getState().nodes.filter(node=>node.type==='text'&&node.sourceAudioNodeId===source.id),snapshot=receipt.subtitleSnapshot;
  if(!snapshot||candidates.length!==snapshot.count||snapshot.count>1||snapshot.node&&(candidates[0]!==snapshot.node||snapshot.node.content!==snapshot.content))throw Error('原音频字幕已编辑或替换，旧生成结果未应用');
 };
 guard();
 if(receipt.audioApplied){
  if(receipt.audioApplied.outputSignature!==JSON.stringify(job.outputs))throw Error('音频任务输出已变化，不能重写旧应用收据');
  await app.saveProject();guard();return receipt.audioApplied;
 }
 subtitleGuard();
 // Localize and inspect every option before mutating the source; provider
 // durations never substitute for decoding the stored media bytes.
 const options=[];
 for(let index=0;index<outputs.length;index++){
  const output=outputs[index],text=subtitleText(output),audio=await localize(output.audio||output.url);guard();subtitleGuard();
  if(!localRef(audio))throw Error('生成音频未成功写入本地素材');
  const metadata=await inspect(audio);guard();subtitleGuard();
  if(!Number.isFinite(metadata?.duration)||metadata.duration<=0||!Number.isFinite(metadata.duration*1000))throw Error('生成音频实际时长无效');
  options.push({id:job.id+':'+index,type:'audio',audio,audioDuration:metadata.duration,durationMs:metadata.duration*1000,
   provenance:{kind:'generation-result',taskId:job.id,requestKind:'audio.generate',mediaSource:audio,model:output.model||receipt.request.parameters?.model||null,prompt:receipt.request.prompt||''},...(text!==null?{subtitle:{text}}:{})});
 }
 guard();subtitleGuard();
 const history=clone(source.audioHistory||[]);
 if(!history.length&&localRef(source.audio))history.push({id:'previous:'+source.id,options:[{id:'previous:'+source.id,type:'audio',audio:source.audio,audioDuration:source.audioDuration??null,durationMs:source.durationMs??null,provenance:clone(source.provenance||{kind:'imported',mediaSource:source.audio,model:null})}]});
 history.push({id:job.id,createdAt:job.createdAt,prompt:receipt.request.prompt||'',parameters:clone(receipt.request.parameters||{}),options:clone(options)});
 const first=options[0],patch={audio:first.audio,audioDuration:first.audioDuration,durationMs:first.durationMs,provenance:clone(first.provenance),options:options.map(option=>option.audio),audioResultMetadata:clone(options),audioHistory:history,currentAudioOptionId:first.id};
 app.updateNode(source.id,patch);
 receipt.audioApplied={source,audio:first.audio,options,outputSignature,signature:audioGenerationSignature(source)};
 // Capture subtitle ownership in the same turn as the audio update, before a
 // save allows user edits or undo to interleave.
 onApplied(receipt.audioApplied);
 await app.saveProject();guard();return receipt.audioApplied;
}
