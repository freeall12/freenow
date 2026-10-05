import {segmentationDisclosure,segmentationResultMessage} from './video-segmentation.mjs';
// Recovery actions use the original receipt, never a fresh generation request.
export function createSegmentationRecoveryCard(trace,{document=globalThis.document,disabled=false,onAction}={}){
 const record=trace.segmentationTask,taskId=record?.id||trace.result?.taskId,nodeId=record?.nodeId||trace.args?.nodeId;if(!taskId||!nodeId)return null;
 const el=(tag,text)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;};
 const status=trace.result?.status||record?.status;
 const root=el('section');root.className='execution-confirmation';root.setAttribute('aria-label','SAM2 原识别任务');root.append(el('strong','SAM2 原任务 · '+taskId),el('p',segmentationResultMessage(status,trace.result)),el('p',segmentationDisclosure));
 if(trace.segmentationRecoveryError){const stages={preflight:'检查当前执行状态',load_execution:'加载执行记录',load_native:'加载识别模块',load_receipt:'加载原回执模块',execute:'恢复原任务',persist_result:'保存恢复记录',stage_original_receipt:'核对原工具回执'},error=el('p','恢复操作未完成（'+(stages[trace.segmentationRecoveryError.stage]||'恢复检查')+'）：'+trace.segmentationRecoveryError.message);error.className='execution-error';error.setAttribute('role','alert');root.append(error);}
 const actions=el('div');actions.className='execution-confirm-actions';
 const choices=[['查询并保存原结果','video_segmentation_recover'],...(status==='save_failed'||status==='succeeded'&&record?.maskAsset?[['重试保存同一蒙层','video_segmentation_retry_save']]:[]),...(status==='needs_resume'?[['续发未派发分支（再次确认）','video_segmentation_resume']]:[]),...(!['applied','failed','cancelled','save_failed'].includes(status)?[['请求取消原任务','video_segmentation_cancel']]:[])];
 for(const [label,name]of choices){const button=el('button',label);button.type='button';button.disabled=disabled;button.onclick=()=>onAction?.(name,{nodeId,taskId});actions.append(button);}
 root.append(actions);return root;
}
