import {isOriginalMediaRef} from './display-media.mjs';

const maxBytes=20*1024*1024;
const mimePattern=/^image\/(png|jpeg|webp)$/;
const fail=(code,message)=>Object.assign(Error(message),{code});
const signature=node=>JSON.stringify(Object.fromEntries(Object.entries(node).filter(([key])=>!['x','y','selected'].includes(key))));
const hash=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(value=>value.toString(16).padStart(2,'0')).join('');

export function repairableImageFields(node){
 return node?.type==='image'?['image','fullImage'].filter(key=>isOriginalMediaRef(node[key])):[];
}
export function imageRepairBusy(node,jobs=[]){
 if(node?.pendingOperation)return true;
 return jobs.some(job=>{
  const active=['queued','running'].includes(job.status)||job.status==='succeeded'&&job.applying&&!job.applied&&!job.applicationError;
  if(!active)return false;
  const targets=job.request?.parameters?.canvasResults?.targetNodeIds;
  return Array.isArray(targets)?targets.includes(node.id):job.request?.nodeId===node.id||job.id===node.generationRun?.runId;
 });
}
export async function decodeRepairImage(blob){
 const image=new Image(),url=URL.createObjectURL(blob);let timer;
 try{image.src=url;await Promise.race([image.decode(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(fail('decode_timeout','图片解码超时')),15000);})]);return {width:image.naturalWidth,height:image.naturalHeight};}
 finally{clearTimeout(timer);image.removeAttribute('src');URL.revokeObjectURL(url);}
}
async function savedBlob(ref,assets){
 const url=await assets.url(ref);
 if(typeof url!=='string'||!url.startsWith('blob:'))throw fail('asset_read','本地素材没有可回读的 Blob');
 const response=await fetch(url);
 if(!response.ok)throw fail('asset_read','本地素材回读失败');
 return response.blob();
}

// The user's file is a replacement, never a claim that an unknown URL has been
// recovered exactly. No source URL is read or added to the trusted index.
export function createNodeImageRepair({nodeId,getNode,getProjectId,isCurrent=()=>true,getJobs=()=>[],assets,updateNode,saveProject,readProject,decodeImage=decodeRepairImage,hashBytes=hash,readAsset=ref=>savedBlob(ref,assets)}={}){
 if(!nodeId||![getNode,getProjectId,isCurrent,getJobs,updateNode,saveProject,readProject,decodeImage,hashBytes,readAsset].every(value=>typeof value==='function')||typeof assets?.put!=='function')throw fail('adapter','本地图片修复接口不完整');
 const target=getNode(nodeId),fields=repairableImageFields(target),projectId=getProjectId(),token=target&&signature(target);
 if(!fields.length)throw fail('not_pending','此节点没有待修复的旧图片');
 let busy=false,applied=null;
 function guard(){
  const node=getNode(nodeId);
  if(isCurrent()!==true||getProjectId()!==projectId||node!==target||signature(node)!==token)throw fail('target_changed','目标节点或画布已变化，请重新打开修复操作');
  if(imageRepairBusy(node,getJobs()))throw fail('target_busy','节点正在执行任务，请等待完成或取消任务');
 }
 function confirmApplied(){
  if(getProjectId()!==projectId||isCurrent()!==true)throw fail('project_changed','画布已切换；请返回原画布重试保存');
  const node=getNode(nodeId);
  if(node!==target||fields.some(key=>node[key]!==applied.ref)||applied.primary&&node.provenance?.mediaSource!==applied.ref)throw fail('applied_changed','替换后的节点已变化，请使用画布保存操作保存当前编辑');
 }
 async function confirmSaved(){
  confirmApplied();
  await saveProject();
  confirmApplied();
  const snapshot=await readProject(projectId);confirmApplied();const saved=snapshot?.nodes?.find(node=>node.id===nodeId);
  if(!saved||fields.some(key=>saved[key]!==applied.ref)||applied.primary&&saved.provenance?.mediaSource!==applied.ref)throw fail('save_unconfirmed','当前画布快照尚未确认这次替换');
  applied={...applied,persisted:true};return {...applied};
 }
 async function repair(file){
  if(busy||applied)throw fail('already_started','此修复操作正在处理或已应用');
  busy=true;
  try{
   guard();
   if(!(file instanceof Blob)||!mimePattern.test(file.type)||!Number.isSafeInteger(file.size)||file.size<1||file.size>maxBytes)throw fail('file_invalid','请选择 20 MiB 以内的 PNG、JPEG 或 WebP 图片');
   const bytes=new Uint8Array(await file.arrayBuffer());
   if(bytes.byteLength!==file.size)throw fail('bytes_invalid','图片实际长度不符');
   const dimensions=await decodeImage(new Blob([bytes],{type:file.type}));
   if(!Number.isSafeInteger(dimensions?.width)||!Number.isSafeInteger(dimensions?.height)||dimensions.width<1||dimensions.height<1||dimensions.width>8192||dimensions.height>8192||dimensions.width*dimensions.height>16777216)throw fail('dimensions_invalid','图片尺寸超过 8192 单边或 16777216 总像素预算');
   const sha256=await hashBytes(bytes);guard();
   const ref=await assets.put(new Blob([bytes],{type:file.type}));
   if(typeof ref!=='string'||!/^asset:[^\s]+$/.test(ref))throw fail('asset_invalid','图片未写入本地素材存储');
   const back=await readAsset(ref);
   if(!(back instanceof Blob)||back.type!==file.type||back.size!==bytes.byteLength||await hashBytes(new Uint8Array(await back.arrayBuffer()))!==sha256)throw fail('asset_mismatch','本地素材回读与所选文件不一致');
   // All awaits finish before the final guard and synchronous single-undo edit.
   guard();
   const primary=fields.includes(target.fullImage?'fullImage':'image'),patch=Object.fromEntries(fields.map(key=>[key,ref]));
   if(primary){patch.pixelWidth=dimensions.width;patch.pixelHeight=dimensions.height;patch.provenance={kind:'imported',mediaSource:ref,model:null};}
   updateNode(nodeId,patch);
   applied={nodeId,projectId,ref,fields:[...fields],primary,sha256,bytes:bytes.byteLength,width:dimensions.width,height:dimensions.height,applied:true,persisted:false};
   try{return await confirmSaved();}catch(error){return {...applied,saveError:error.message};}
  }finally{busy=false;}
 }
 async function retrySave(){
  if(busy||!applied)throw fail('retry_invalid','没有可重试保存的替换');
  if(applied.persisted)return {...applied};
  busy=true;try{return await confirmSaved();}catch(error){return {...applied,persisted:false,saveError:error.message};}finally{busy=false;}
 }
 return {repair,retrySave,status:()=>applied?{...applied}:null,fields:[...fields]};
}
