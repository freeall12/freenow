import {createWorkflowMediaResolver} from '../agent-workflows/media-resolver.mjs';
import {createLocalClipResolver} from '../agent-workflows/local-clip-resolver.mjs';
import {prepareWorkflowInputs} from '../agent-workflows/media-transport.mjs';
import {isNativePanoramaModel} from '../image-generation/panorama-native.mjs';

// Media can contain large data URLs; compare the existing field values without
// repeatedly serializing their bytes during asynchronous reference preparation.
const signature=node=>[node.type,node.video,node.fullImage,node.image,node.audio,node.content,JSON.stringify(node.clip),JSON.stringify(node.trim),JSON.stringify(node.crop),JSON.stringify(node.imageCrop)];
export async function prepareAgentMediaInputs(refs,{getNode,signal,localAssets,localMedia,baseUrl,
 resolveMedia,deferTransport=false,guardNodes=[],panoramaModel,transport=prepareWorkflowInputs,getLegacyVideo=node=>globalThis.EDITOR_DATA?.nodes?.[node.id]?.video}={}){
 const targetSignature=node=>JSON.stringify([node.generation,node.params,node.prompt,node.settings]);
 const hasInput=node=>!!(node.type==='video'&&(node.video||getLegacyVideo(node))||node.type==='image'&&(node.fullImage||node.image)||node.audio||node.content);
 const snapshots=[...new Set([...refs,...guardNodes])].map(node=>({node,reference:refs.includes(node)&&hasInput(node),signature:signature(node),target:guardNodes.includes(node),editing:targetSignature(node),legacy:getLegacyVideo(node)}));
 const guard=()=>{
  if(signal?.aborted)throw new DOMException('媒体参考准备已取消','AbortError');
  for(const snapshot of snapshots)if(getNode(snapshot.node.id)!==snapshot.node||signature(snapshot.node).some((value,index)=>value!==snapshot.signature[index])||getLegacyVideo(snapshot.node)!==snapshot.legacy||snapshot.target&&targetSignature(snapshot.node)!==snapshot.editing)throw Error('参考节点已被修改或替换，请重新提交');
 };
 guard.acceptReplacements=receipts=>{
  if(!Array.isArray(receipts))throw Error('缺少宿主节点替换回执');
  for(const snapshot of snapshots){
   const receipt=receipts.find(value=>value.before===snapshot.node);if(!receipt)continue;
   if(getNode(receipt.after?.id)!==receipt.after||receipt.after.id!==snapshot.node.id||signature(snapshot.node).some((value,index)=>value!==snapshot.signature[index])||snapshot.target&&targetSignature(snapshot.node)!==snapshot.editing||snapshot.reference&&(signature(receipt.after).some((value,index)=>value!==snapshot.signature[index])||getLegacyVideo(receipt.after)!==snapshot.legacy))throw Error('宿主节点替换与原始参考不一致');
   snapshot.node=receipt.after;snapshot.signature=signature(receipt.after);snapshot.legacy=getLegacyVideo(receipt.after);snapshot.editing=targetSignature(receipt.after);
  }
  guard();
 };
 guard();
 if(!resolveMedia){
  const clip=refs.some(node=>node.type==='video'&&(node.clip!=null||node.trim!=null))?createLocalClipResolver({getNode,localMedia,getLegacyVideo}):undefined;
  resolveMedia=createWorkflowMediaResolver({localAssets,baseUrl,resolveClip:clip,timeoutMs:clip?120000:20000,getLegacyVideo});
 }
 const inputs=[];
 for(const node of refs){
  guard();
  if(node.type==='video'&&(node.video||getLegacyVideo(node))||node.type==='image'&&(node.fullImage||node.image)){
   inputs.push({...await resolveMedia(node,{signal}),sourceUrl:node.type==='video'?(node.clip||node.trim?undefined:node.video||getLegacyVideo(node)):(node.fullImage||node.image)});
  }else if(node.audio){inputs.push({...await resolveMedia({...node,type:'audio'},{signal}),sourceUrl:node.audio});}
  else if(node.content){inputs.push({id:node.id,type:'text',text:node.content});}
  guard();
 }
 // sourceUrl is a local source identity, not a native provider field. Keep it
 // in the node snapshots above while submitting only measured image metadata.
 if(isNativePanoramaModel(panoramaModel)){
  if(inputs.length!==1||inputs[0].type!=='image'||!Number.isSafeInteger(inputs[0].width)||inputs[0].width<1||!Number.isSafeInteger(inputs[0].height)||inputs[0].height<1)throw Error('图生全景需要一张已读取真实像素尺寸的图片');
  inputs[0]=Object.fromEntries(['type','id','url','width','height'].map(key=>[key,inputs[0][key]]));
 }
 if(deferTransport)return {inputs,guard};
 const media=inputs.filter(input=>input.type!=='text');
 const prepared=await transport({inputs:media},{signal,baseUrl});guard();
 let index=0;
 return {inputs:inputs.map(input=>input.type==='text'?input:prepared.inputs[index++]),guard};
}
