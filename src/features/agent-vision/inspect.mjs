import {prepareMediaInputs} from '../agent-attachments/media-inputs.mjs';

const visuals=new WeakMap();
const abort=signal=>{if(signal?.aborted)throw new DOMException('Aborted','AbortError');};
function mediaNode(node){
 if(!node)throw Error('要查看的画布节点不存在');
 const asset=node.type==='video'?node.video:node.type==='image'?(node.fullImage||node.image):null;
 if(!asset)throw Error('节点没有可查看的实际图片或视频：'+node.id);
 return {id:node.id,type:node.type,title:node.title||node.type,asset};
}
export async function inspectCanvasMedia(ids,{getNodes,resolveUrl,signal,visualBudget,prepare=prepareMediaInputs}){
 if(!Array.isArray(ids)||!ids.length||ids.length>4||new Set(ids).size!==ids.length)throw Error('每次查看1至4个不同的媒体节点');
 abort(signal);
 const selected=ids.map(id=>mediaNode(getNodes().find(node=>node.id===id)));
 const inputs=await prepare(selected.map(node=>({name:node.id,type:node.type,asset:node.asset})),{resolveUrl,signal});
 abort(signal);
 for(const node of selected){const latest=mediaNode(getNodes().find(item=>item.id===node.id));if(latest.type!==node.type||latest.asset!==node.asset)throw Error('查看期间节点媒体已变化，请重新查看：'+node.id);}
 const media=inputs.map(input=>{const node=selected.find(item=>item.id===input.name);if(!node)throw Error('视觉画面与来源节点不匹配');return {...input,nodeId:node.id};});
 const nodes=selected.map(node=>({id:node.id,type:node.type,title:node.title,samples:media.filter(frame=>frame.nodeId===node.id).map(frame=>({...('time' in frame?{time:frame.time}:{})}))}));
 if(nodes.some(node=>!node.samples.length))throw Error('媒体未返回真实画面');
 const bytes=media.reduce((sum,frame)=>sum+frame.imageUrl.length,0);
 if(visualBudget){if(!Number.isFinite(visualBudget.remaining)||visualBudget.remaining<bytes)throw Object.assign(Error('本轮画面预算已用完，请在下一轮工具调用继续查看这些节点。'),{code:'visual_budget_exceeded'});visualBudget.remaining-=bytes;}
 const result={nodes,visualInputCount:media.length,visualStatus:'prepared',videoNote:'视频仅提供带秒数的抽样帧，不代表完整观看或听取音频。'};
 // Actual pixels are transport-only. Persisted traces contain provenance and
 // sample times, never duplicate the base64 image bodies into chat storage.
 visuals.set(result,media);return result;
}
export const inspectionMedia=result=>visuals.get(result)||[];
export function withInspectionMedia(entry){const mediaInputs=inspectionMedia(entry.result);return mediaInputs.length?{...entry,mediaInputs}:entry;}
