import {isOriginalMediaRef} from './display-media.mjs';
import {imageRepairBusy} from './node-image-repair.mjs';
import {inspectVideoThumbnail} from '../generation-history/video-thumbnail.mjs';

const maxBytes=100*1024*1024;
const fail=(code,message)=>Object.assign(Error(message),{code});
const signature=node=>JSON.stringify(Object.fromEntries(Object.entries(node).filter(([key])=>!['x','y','selected'].includes(key))));
const hash=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(value=>value.toString(16).padStart(2,'0')).join('');
export const videoSource=node=>node?.video||globalThis.EDITOR_DATA?.nodes?.[node?.id]?.video;
export function isRepairableVideo(node,getVideoSource=videoSource){return node?.type==='video'&&isOriginalMediaRef(getVideoSource(node));}

// This reader decodes a real frame, rather than trusting container metadata.
export async function decodeRepairVideo(blob){
 const url=URL.createObjectURL(blob);
 try{const result=await inspectVideoThumbnail(url,{thumbnail:true});if(!result.thumbnailBlob)throw fail('frame_invalid',result.thumbnailError||'视频首帧不可解码');return result;}
 finally{URL.revokeObjectURL(url);}
}
async function savedBlob(ref,assets){
 const url=await assets.url(ref);
 if(typeof url!=='string'||!url.startsWith('blob:'))throw fail('asset_read','本地素材没有可回读的 Blob');
 const response=await fetch(url);if(!response.ok)throw fail('asset_read','本地素材回读失败');return response.blob();
}

export function createNodeVideoRepair({nodeId,getNode,getProjectId,isCurrent=()=>true,getJobs=()=>[],getVideoSource=videoSource,assets,updateNode,saveProject,readProject,decodeVideo=decodeRepairVideo,hashBytes=hash,readAsset=ref=>savedBlob(ref,assets)}={}){
 if(!nodeId||![getNode,getProjectId,isCurrent,getJobs,getVideoSource,updateNode,saveProject,readProject,decodeVideo,hashBytes,readAsset].every(value=>typeof value==='function')||typeof assets?.put!=='function')throw fail('adapter','本地视频修复接口不完整');
 const target=getNode(nodeId),projectId=getProjectId(),source=getVideoSource(target),token=target&&signature(target);
 if(!isRepairableVideo(target,getVideoSource))throw fail('not_pending','此节点没有待修复的旧视频');
 let busy=false,applied=null,appliedPatch=null;
 const patchMatches=node=>!!node&&Object.entries(appliedPatch).every(([key,value])=>JSON.stringify(node[key])===JSON.stringify(value));
 function guard(){
  const node=getNode(nodeId);
  if(isCurrent()!==true||getProjectId()!==projectId||node!==target||signature(node)!==token||getVideoSource(node)!==source)throw fail('target_changed','目标节点、视频来源或画布已变化，请重新打开修复操作');
  if(imageRepairBusy(node,getJobs()))throw fail('target_busy','节点正在执行任务，请等待完成或取消任务');
 }
 function confirmApplied(){
  if(getProjectId()!==projectId||isCurrent()!==true)throw fail('project_changed','画布已切换；请返回原画布重试保存');
  const node=getNode(nodeId);
  if(node!==target||!patchMatches(node))throw fail('applied_changed','替换后的视频节点已变化，请使用画布保存操作保存当前编辑');
 }
 async function confirmSaved(){
  confirmApplied();await saveProject();confirmApplied();
  const snapshot=await readProject(projectId);confirmApplied();const saved=snapshot?.nodes?.find(node=>node.id===nodeId);
  if(!patchMatches(saved))throw fail('save_unconfirmed','当前画布快照尚未确认这次替换');
  applied={...applied,persisted:true};return {...applied};
 }
 async function storeVerified(blob){
  let bytes=new Uint8Array(await blob.arrayBuffer());const size=bytes.byteLength,sha256=await hashBytes(bytes);bytes=null;guard();
  const ref=await assets.put(blob);
  if(typeof ref!=='string'||!/^asset:[^\s]+$/.test(ref))throw fail('asset_invalid','素材未写入本地存储');
  const back=await readAsset(ref);
  if(!(back instanceof Blob)||back.type!==blob.type||back.size!==size||await hashBytes(new Uint8Array(await back.arrayBuffer()))!==sha256)throw fail('asset_mismatch','本地素材回读与所选内容不一致');
  guard();return {ref,sha256,bytes:size};
 }
 async function repair(file){
  if(busy||applied)throw fail('already_started','此修复操作正在处理或已应用');busy=true;
  try{
   guard();
   if(!(file instanceof Blob)||!/^video\/[a-z0-9.+-]+$/i.test(file.type)||!Number.isSafeInteger(file.size)||file.size<1||file.size>maxBytes)throw fail('file_invalid','请选择 100 MiB 以内、浏览器可解码的视频文件');
   const metadata=await decodeVideo(file),{width,height,duration,thumbnailBlob}=metadata||{};
   if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||width>8192||height>8192||width*height>33554432||!Number.isFinite(duration)||!Number.isFinite(duration*1000)||duration<=0)throw fail('metadata_invalid','视频尺寸或时长无效，最多 8192 单边和 33554432 总像素');
   if(!(thumbnailBlob instanceof Blob)||thumbnailBlob.type!=='image/jpeg'||thumbnailBlob.size<1||thumbnailBlob.size>2*1024*1024)throw fail('frame_invalid','视频首帧封面不可读取');
   const video=await storeVerified(file),poster=await storeVerified(thumbnailBlob);guard();
   const patch={video:video.ref,image:poster.ref,pixelWidth:width,pixelHeight:height,durationMs:duration*1000,clip:null,provenance:{kind:'imported',mediaSource:video.ref,model:null}};
   // Cover aliases belong to the replaced video. Keep unrelated source journals,
   // histories and parameters intact; no old URL is fetched or indexed.
   for(const key of ['fullImage','poster','thumbnail'])if(Object.hasOwn(target,key))patch[key]=poster.ref;
   appliedPatch=structuredClone(patch);updateNode(nodeId,patch);
   applied={nodeId,projectId,ref:video.ref,posterRef:poster.ref,sha256:video.sha256,bytes:video.bytes,width,height,duration,applied:true,persisted:false};
   try{return await confirmSaved();}catch(error){return {...applied,saveError:error.message};}
  }finally{busy=false;}
 }
 async function retrySave(){
  if(busy||!applied)throw fail('retry_invalid','没有可重试保存的替换');if(applied.persisted)return {...applied};
  busy=true;try{return await confirmSaved();}catch(error){return {...applied,persisted:false,saveError:error.message};}finally{busy=false;}
 }
 return {repair,retrySave,status:()=>applied?{...applied}:null};
}
