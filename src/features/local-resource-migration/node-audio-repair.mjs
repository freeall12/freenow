import {isOriginalMediaRef} from './display-media.mjs';
import {imageRepairBusy} from './node-image-repair.mjs';


const maxBytes=50*1024*1024;
const fail=(code,message)=>Object.assign(Error(message),{code});
const signature=node=>JSON.stringify(Object.fromEntries(Object.entries(node).filter(([key])=>!['x','y','selected'].includes(key))));
const hash=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(value=>value.toString(16).padStart(2,'0')).join('');
export const audioSource=node=>node?.audio;
export function isRepairableAudio(node,getAudioSource=audioSource){return node?.type==='audio'&&isOriginalMediaRef(getAudioSource(node));}

export async function decodeRepairAudio(blob,{createContext=()=>new (globalThis.AudioContext||globalThis.webkitAudioContext)(),core=globalThis.AudioCore}={}){
 if(typeof core?.peaks!=='function')throw fail('decoder_unavailable','音频波形探测器不可用');
 const context=createContext();let timer;
 try{
  const bytes=await blob.arrayBuffer(),buffer=await Promise.race([context.decodeAudioData(bytes),new Promise((_,reject)=>{timer=setTimeout(()=>reject(fail('decode_timeout','音频解码超时')),15000);})]);
  if(!Number.isSafeInteger(buffer.numberOfChannels)||buffer.numberOfChannels<1||buffer.numberOfChannels>32||!Number.isSafeInteger(buffer.length)||buffer.length<1||buffer.length*buffer.numberOfChannels>67108864)throw fail('decode_budget','解码音频超过通道或采样预算');
  const peaks=core.peaks(Array.from({length:buffer.numberOfChannels},(_,index)=>buffer.getChannelData(index)),600);
  return {duration:buffer.duration,sampleRate:buffer.sampleRate,channels:buffer.numberOfChannels,peaks};
 }finally{clearTimeout(timer);try{await context.close();}catch{/* Preserve decoder failure while releasing its private context. */}}
}
async function savedBlob(ref,assets){
 const url=await assets.url(ref);
 if(typeof url!=='string'||!url.startsWith('blob:'))throw fail('asset_read','本地素材没有可回读的 Blob');
 const response=await fetch(url);if(!response.ok)throw fail('asset_read','本地素材回读失败');return response.blob();
}

export function createNodeAudioRepair({nodeId,getNode,getProjectId,isCurrent=()=>true,getJobs=()=>[],getAudioSource=audioSource,assets,updateNode,saveProject,readProject,decodeAudio=decodeRepairAudio,hashBytes=hash,readAsset=ref=>savedBlob(ref,assets)}={}){
 if(!nodeId||![getNode,getProjectId,isCurrent,getJobs,getAudioSource,updateNode,saveProject,readProject,decodeAudio,hashBytes,readAsset].every(value=>typeof value==='function')||typeof assets?.put!=='function')throw fail('adapter','本地音频修复接口不完整');
 const target=getNode(nodeId),projectId=getProjectId(),source=getAudioSource(target),token=target&&signature(target);
 if(!isRepairableAudio(target,getAudioSource))throw fail('not_pending','此节点没有待修复的旧音频');
 let busy=false,applied=null,appliedPatch=null;
 const patchMatches=node=>!!node&&Object.entries(appliedPatch).every(([key,value])=>JSON.stringify(node[key])===JSON.stringify(value));
 function guard(){
  const node=getNode(nodeId);
  if(isCurrent()!==true||getProjectId()!==projectId||node!==target||signature(node)!==token||getAudioSource(node)!==source)throw fail('target_changed','目标节点、音频来源或画布已变化，请重新打开修复操作');
  if(imageRepairBusy(node,getJobs()))throw fail('target_busy','节点正在执行任务，请等待完成或取消任务');
 }
 function confirmApplied(){
  if(getProjectId()!==projectId||isCurrent()!==true)throw fail('project_changed','画布已切换；请返回原画布重试保存');
  const node=getNode(nodeId);
  if(node!==target||!patchMatches(node))throw fail('applied_changed','替换后的音频节点已变化，请使用画布保存操作保存当前编辑');
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
   if(!(file instanceof Blob)||!/^(?:audio\/[a-z0-9.+-]+|video\/webm|application\/ogg)$/i.test(file.type)||!Number.isSafeInteger(file.size)||file.size<1||file.size>maxBytes)throw fail('file_invalid','请选择 50 MiB 以内、浏览器可解码的音频文件');
   const metadata=await decodeAudio(file),{duration,sampleRate,channels,peaks}=metadata||{};
   if(!Number.isFinite(duration)||!Number.isFinite(duration*1000)||duration<=0||!Number.isFinite(sampleRate)||sampleRate<8000||sampleRate>192000||!Number.isSafeInteger(channels)||channels<1||channels>32||!Array.isArray(peaks)||!peaks.length||peaks.length>600||peaks.some(value=>!Number.isFinite(value)||value<0||value>1))throw fail('metadata_invalid','音频时长、采样率、通道或波形无效');
   const audio=await storeVerified(file);guard();
   const patch={audio:audio.ref,audioMode:'upload',audioDuration:duration,durationMs:duration*1000,provenance:{kind:'imported',mediaSource:audio.ref,model:null}};
   appliedPatch=structuredClone(patch);updateNode(nodeId,patch);
   applied={nodeId,projectId,ref:audio.ref,sha256:audio.sha256,bytes:audio.bytes,duration,sampleRate,channels,waveformBins:peaks.length,applied:true,persisted:false};
   try{return await confirmSaved();}catch(error){return {...applied,saveError:error.message};}
  }finally{busy=false;}
 }
 async function retrySave(){
  if(busy||!applied)throw fail('retry_invalid','没有可重试保存的替换');if(applied.persisted)return {...applied};
  busy=true;try{return await confirmSaved();}catch(error){return {...applied,persisted:false,saveError:error.message};}finally{busy=false;}
 }
 return {repair,retrySave,status:()=>applied?{...applied}:null};
}
