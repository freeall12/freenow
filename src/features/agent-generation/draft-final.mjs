import {requireDraftSource,isDraftNode,hasDraftResult,isFinalNode,resolveDraftReference} from '../video-generation/draft-final.mjs';

export const isDraftFinal=args=>args?.kind==='video.generate'&&typeof args.draftSourceId==='string';
export function draftFinalSource(args,nodes,edges){
 const source=requireDraftSource(nodes.find(node=>node.id===args.draftSourceId),nodes);
 if(args.nodeId&&edges!==undefined){
  const target=nodes.find(node=>node.id===args.nodeId);
  if(!target||!isFinalNode(target))throw Error('正式片目标不存在或不是正式片节点');
  if(resolveDraftReference(target,nodes,edges).source.id!==source.id)throw Error('正式片目标与指定样片来源不一致');
 }
 return source;
}
const fingerprint=source=>JSON.stringify([source.id,source.video,source.currentSourceFileId,source.generation,source.params,source.draftEstimateMedia]);
export function createDraftFinalDraft(args,nodes){
 const draft=structuredClone(args);
 // A deleted/incomplete source should render an actionable confirmation error,
 // not prevent the entire execution history from rendering.
 try{const source=draftFinalSource(args,nodes);draft.draftSourceFingerprint=fingerprint(source);draft.draftSourceTitle=source.title||'样片';}catch{}
 return draft;
}
export function confirmDraftFinal(original,draft,nodes,edges=[]){
 if(!isDraftFinal(original)||Object.keys(original).some(key=>!['kind','draftSourceId','nodeId'].includes(key)))throw Error('正式片调用只能指定样片来源和可选正式片目标');
 if(draft.kind!==original.kind||draft.draftSourceId!==original.draftSourceId||draft.nodeId!==original.nodeId)throw Error('审批不能更换样片来源或正式片目标');
 if(Object.keys(draft).some(key=>!['kind','draftSourceId','nodeId','draftSourceFingerprint','draftSourceTitle'].includes(key)))throw Error('正式片继承样片，不能编辑普通生成参数');
 const source=draftFinalSource(original,nodes,edges);
 if(!draft.draftSourceFingerprint||draft.draftSourceFingerprint!==fingerprint(source))throw Error('样片版本或生成配置已变化，请取消后重新提交正式片操作');
 return structuredClone(original);
}

export function draftSummary(node){
 if(node?.type!=='video')return undefined;const config=node.generation||node.params||{},model=config.model||config.modelId;
 return {isDraft:isDraftNode(node),isFinal:isFinalNode(node),hasResult:hasDraftResult(node),...(typeof model==='string'?{model:model.slice(0,160)}:{})};
}
