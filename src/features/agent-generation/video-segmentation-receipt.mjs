import {canCheck,sameBinding} from '../agent-recovery/model.mjs';
import {fingerprint,prepareReceiptJournal} from '../agent-recovery/journal.mjs';
import {createReceiptStore,assertReceiptCurrent} from '../video-mask/recovery.mjs';
import {mediaSource} from '../video-creation/core.mjs';

const canonical=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);

export function segmentationOriginFor(trace,chat){
 if(trace?.segmentationOrigin)return {...trace.segmentationOrigin};
 if(trace?.name==='video_segment_target'&&trace.id&&trace.runId&&trace.callId)return {traceId:trace.id,runId:trace.runId,callId:trace.callId};
 // A recovery card saved before lineage was introduced can still refer to one
 // exact durable original call; ambiguity never grants a new call identity.
 const taskId=trace?.segmentationTask?.id||trace?.result?.taskId,nodeId=trace?.segmentationTask?.nodeId||trace?.args?.nodeId;
 const originals=(chat?.messages||[]).filter(item=>item.role==='tool'&&item.name==='video_segment_target'&&item.id&&item.runId&&item.callId&&item.args?.operationId===taskId&&item.args.nodeId===nodeId);
 return originals.length===1?{traceId:originals[0].id,runId:originals[0].runId,callId:originals[0].callId}:null;
}

// Stages an actual saved result for the one original pending call. It does not
// replay the tool, send a model request or rewrite the original failure trace.
export async function prepareAppliedSegmentationReceipt({chat,originTrace,result,app,scope,sourceVersion,isCurrent,receiptStore=createReceiptStore(),now=Date.now}={}){
 if(result?.status!=='applied'||result.applied!==true||result.saved!==true||result.timeline!=='full-source')return false;
 const origin=segmentationOriginFor(originTrace,chat);if(!origin)return false;
 const traces=chat.messages.filter(trace=>trace.id===origin.traceId&&trace.role==='tool'&&trace.name==='video_segment_target'&&trace.runId===origin.runId&&trace.callId===origin.callId);
 const records=(chat.interruptedRuns||[]).filter(record=>record.submissionId===origin.runId);if(traces.length!==1||records.length!==1)return false;
 const trace=traces[0],record=records[0],journal=record.journal,node=app.getState().nodes.find(n=>n.id===result.nodeId),receipt=receiptStore.read(scope.projectId,result.nodeId);
 if(!receipt||receipt.taskId!==result.taskId||receipt.status!=='applied'||!receipt.maskAsset||node?.videoMask?.asset!==receipt.maskAsset||node.videoMask.taskId!==receipt.taskId||trace.args?.operationId!==receipt.taskId||trace.args.nodeId!==result.nodeId||receipt.agentArguments!==JSON.stringify(trace.args)||receipt.baselineMask!==null||receipt.baselineMaskSnapshot!=='null'||!canCheck(record,scope)||!sameBinding(journal?.binding,record.binding)||journal?.version!==1||journal.submission?.id!==record.submissionId||journal.receipts||!['tools_pending','tools_partial'].includes(journal.phase)||journal.pending?.length!==1||journal.pending[0].name!==trace.name||journal.pending[0].callId!==trace.callId||!journal.seenCallIds?.includes(trace.callId))return false;
 if(record.state&&(record.state.status!=='waiting_tools'||record.state.round!==journal.round||record.state.pending?.length!==1||record.state.pending[0].callId!==trace.callId||record.state.pending[0].name!==trace.name))return false;
 const check=()=>{if(!isCurrent())throw new DOMException('原 SAM2 回执恢复来源已变化','AbortError');assertReceiptCurrent(app,node,receipt,{sourceOf:mediaSource});const expectedMask={source:mediaSource(node),clip:receipt.clip,asset:receipt.maskAsset,time:receipt.time,width:receipt.media?.width,height:receipt.media?.height,duration:receipt.media?.duration,timeline:'full-source',taskId:receipt.taskId};if(canonical(node.videoMask)!==canonical(expectedMask))throw Error('已保存的完整 SAM2 蒙层字段已变化，未补原工具回执');const current=receiptStore.read(scope.projectId,node.id);if(current?.taskId!==receipt.taskId||current.revision!==receipt.revision||record.journal!==journal||!chat.interruptedRuns?.includes(record)||!chat.messages.includes(trace))throw Error('原 SAM2 回执或中断任务已变化，未补回执');};
 check();if(await fingerprint(journal.submission)!==journal.submissionHash)throw Error('原提交已变化，未补 SAM2 回执');check();
 // Only the mask created by this task may account for the source-version delta.
 // Old receipts may have represented no mask as an absent or null property.
 const baseline={nodeId:node.id,taskId:receipt.taskId,maskAsset:receipt.maskAsset};
 let baselineOption={...baseline,present:false},before=await sourceVersion({segmentationBaseline:baselineOption});check();
 if(before!==journal.sourceVersion){baselineOption={...baseline,present:true};before=await sourceVersion({segmentationBaseline:baselineOption});check();}
 if(before!==journal.sourceVersion)throw Error('除原 SAM2 蒙层之外的来源已变化，未补原工具回执');
 const version=await sourceVersion();check();
 if(await sourceVersion({segmentationBaseline:baselineOption})!==journal.sourceVersion)throw Error('核对来源期间其他内容已变化，未补原工具回执');check();const staged=structuredClone(record);
 await prepareReceiptJournal(staged,{results:[{callId:trace.callId,result:structuredClone(result)}],sourceVersion:version});check();
 if(await sourceVersion()!==version)throw Error('补 SAM2 回执期间来源已变化，未保存检查点');check();
 staged.journal.receipts.origin={kind:'applied_native_segmentation',sessionId:record.sessionId,callId:trace.callId,taskId:receipt.taskId,round:journal.round,recoveredAt:now()};
 record.journal=staged.journal;return {record,originalTrace:trace};
}
