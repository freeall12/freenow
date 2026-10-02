import {audioFields} from './audio.mjs';
import {createGenerationDraft,normalizeDraft,confirmedArguments,parameterOptions,findModel,compatibility,referenceShape} from './model.mjs';
import {executeTracedCall} from '../agent-execution/trace.mjs';
const fields=[...audioFields,'model','aspect','imageSize','quality','count','duration','resolution','generateAudio','videoMode'];
export const isBatch=trace=>trace.name==='generation_batch'&&Array.isArray(trace.batchItems);

// Only adjacent independent calls with matching settings share a confirmation.
// Never move a request across a canvas mutation or merge two writes to one target.
export function groupGenerationCalls(calls,{nodes=[],getConfig=()=>({})}={}){
 const groups=[];
 for(const call of calls){
  const eligible=call.name==='generation_submit'&&!call.args.draftSourceId&&['image.generate','video.generate','audio.generate'].includes(call.args.kind);
  const draft=eligible?createGenerationDraft(call.args,getConfig(call.args.nodeId),nodes):null;
  const key=eligible?JSON.stringify([call.args.kind,...fields.map(field=>draft[field]??null)]):null;
  const previous=groups.at(-1);
  if(key&&previous?.key===key&&!previous.calls.some(item=>item.args.nodeId===call.args.nodeId))previous.calls.push(call);
  else groups.push({key,calls:[call]});
 }
 return groups.map(group=>group.calls);
}
export function batchDraft(trace,getConfig,nodes){
 return trace.batchDraft||trace.batchItems.map(item=>({args:createGenerationDraft(item.args,getConfig(item.args.nodeId),nodes),rejected:item.status==='denied'}));
}
export function batchCompatibility(shared,items,nodes){
 const model=findModel(shared.kind,shared.model);if(!model)return '';
 const selected=items.filter(item=>!item.rejected);
 for(const item of selected){const reason=compatibility(shared.kind,model,referenceShape(item.args,nodes),shared);if(reason)return reason;}
 if(shared.kind==='video.generate'&&selected.length){
  const modes=selected.map(item=>parameterOptions({...item.args,model:shared.model},nodes).videoMode||[]);
  if(!modes[0].some(mode=>modes.every(values=>values.includes(mode))))return '这些参考素材需要不同的生成方式，请移除不兼容项或取消后重试。';
 }
 return '';
}
export function batchOptions(shared,items,nodes){
 const selected=items.filter(item=>!item.rejected),rows=(selected.length?selected:items.slice(0,1)).map(item=>parameterOptions({...item.args,...Object.fromEntries(fields.map(field=>[field,shared[field]]))},nodes));
 const result={};
 for(const key of Object.keys(rows[0]||{})){const values=rows[0][key];if(Array.isArray(values))result[key]=values.filter(value=>rows.every(row=>row[key]?.includes(value)));}
 return result;
}
export function changeBatch(shared,items,key,value,nodes){
 const active=items.find(item=>!item.rejected)||items[0];
 const next=normalizeDraft({...shared,nodeId:active.args.nodeId,referenceIds:active.args.referenceIds,[key]:value},nodes);
 const options=batchOptions(next,items,nodes);
 for(const [field,values]of Object.entries(options))if(!(shared.kind==='audio.generate'&&field==='duration')&&values.length&&!values.includes(next[field]))next[field]=values[0];
 return next;
}
export function batchDecisions(trace,shared,items,nodes){
 if(items.length!==trace.batchItems.length)throw Error('批量任务记录不完整');
 const issue=batchCompatibility(shared,items,nodes);if(issue)throw Error(issue);
 return trace.batchItems.map((item,index)=>{
  if(items[index].rejected)return {callId:item.callId,allowed:false};
  const draft={...items[index].args};
  for(const field of fields){if(shared[field]===undefined)delete draft[field];else draft[field]=shared[field];}
  return {callId:item.callId,allowed:true,args:confirmedArguments(item.args,draft,nodes)};
 });
}
export function sharedReferences(items){
 const refs=items.map(item=>item.args.referenceIds??(item.args.kind==='audio.generate'?[]:[item.args.nodeId])),keys=refs.map(ids=>[...ids].sort().join('|'));
 return keys.every(key=>key===keys[0])?refs[0]:null;
}

export async function executeGenerationBatch(calls,{runId,signal,confirm,execute,changed,validateConfirmed=(original,args)=>args,validate=()=>{},now=Date.now,createId=()=>crypto.randomUUID()}){
 const abort=()=>new DOMException('Aborted','AbortError');
 if(signal?.aborted)throw abort();
 if(calls.length<2||calls.some(call=>call.name!=='generation_submit'||call.args.draftSourceId||!['image.generate','video.generate','audio.generate'].includes(call.args.kind)||call.args.kind!==calls[0].args.kind)||new Set(calls.map(call=>call.args.nodeId)).size!==calls.length)throw Error('批量确认仅支持同类且目标独立的生成请求');
 // Validate the entire envelope before presenting or submitting any item.
 for(const call of calls)validate(call.name,call.args);
 const trace={role:'tool',id:createId(),name:'generation_batch',runId,args:structuredClone(calls[0].args),createdAt:now(),status:confirm?'pending':'running',batchItems:calls.map(call=>({role:'tool',id:createId(),callId:call.callId,runId,name:call.name,...(call.originalArgs?{originalArgs:structuredClone(call.originalArgs)}:{}),args:structuredClone(call.args),createdAt:now(),status:confirm?'pending':'waiting'}))};
 const publish=()=>changed(trace),results=[];
 try{
  publish();
  const decision=confirm?await confirm(trace):{allowed:true};
  if(signal?.aborted)throw abort();
  const allowed=decision===true||decision?.allowed===true;
  let decisions=allowed?(decision?.args?.decisions||calls.map(call=>({callId:call.callId,allowed:true,args:call.args}))):calls.map(call=>({callId:call.callId,allowed:false}));
  if(decisions.length!==calls.length||decisions.some((item,index)=>item.callId!==calls[index].callId))throw Error('批量确认与原始调用不匹配');
  decisions=decisions.map((decision,index)=>{
   if(!decision.allowed)return decision;
   const args=validateConfirmed(calls[index].args,decision.args||calls[index].args);validate(calls[index].name,args);return {...decision,args};
  });
  trace.status='running';publish();
  for(const [index,call]of calls.entries()){
   if(signal?.aborted)throw abort();
   const original=trace.batchItems[index],choice=decisions[index];
   if(choice.allowed&&trace.startedAt===undefined)trace.startedAt=now();
   const result=await executeTracedCall(call,{runId,signal,now,createId:()=>original.id,confirm:async()=>choice,execute,changed:item=>{trace.batchItems[index]=item;publish();}});
   results.push(result);
  }
  trace.status=trace.batchItems.every(item=>item.status==='denied')?'denied':trace.batchItems.some(item=>item.status==='error')?'error':'done';
 }catch(error){
  const stopped=error.name==='AbortError';trace.status=stopped?'cancelled':'error';trace.result={error:stopped?'批量提交已停止；已提交的生成任务请查看实际任务状态。':error.message};
  for(const item of trace.batchItems)if(['pending','waiting','running'].includes(item.status)){item.status=stopped?'cancelled':'error';item.result={error:trace.result.error};item.endedAt=now();}
  trace.endedAt=now();publish();if(stopped)throw error;
  return calls.map(call=>results.find(result=>result.callId===call.callId)||{callId:call.callId,result:{error:trace.result.error}});
 }
 trace.result={results};trace.endedAt=now();publish();return results;
}
