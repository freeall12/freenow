import {validateMask} from './core.mjs';

const stable=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
// Inline media may already exist in a node. Receipts contain only a compact
// identity; actual upload bytes are separately bound by cryptographic SHA256.
const sourceIdentity=value=>{if(typeof value!=='string'||!value.startsWith('data:'))return value;let hash=2166136261;for(let index=0;index<value.length;index++)hash=Math.imul(hash^value.charCodeAt(index),16777619);return 'inline:'+value.length+':'+(hash>>>0).toString(16);};
const compactMedia=value=>JSON.parse(JSON.stringify(value,(_key,item)=>sourceIdentity(item)));
// Position and the mask produced by this operation are not source identity.
// Other content (including immutable asset refs, clip and provenance) is bound.
export const sourceFingerprint=node=>stable(compactMedia(Object.fromEntries(Object.entries(node).filter(([key])=>!['x','y','selected','videoMask'].includes(key)))));
export async function fingerprintSourceData(dataUrl,{subtle=globalThis.crypto.subtle}={}){
 if(typeof dataUrl!=='string'||!/^data:video\/[A-Za-z0-9.+-]+;base64,/.test(dataUrl))throw Error('原生识别需要已读取的实际视频字节');const encoded=dataUrl.slice(dataUrl.indexOf(',')+1),binary=atob(encoded),bytes=Uint8Array.from(binary,char=>char.charCodeAt(0));return Array.from(new Uint8Array(await subtle.digest('SHA-256',bytes)),value=>value.toString(16).padStart(2,'0')).join('');
}
const keyFor=(projectId,nodeId)=>'freenow:video-segmentation:v1:'+encodeURIComponent(projectId)+':'+encodeURIComponent(nodeId);
export function createReceiptStore(storage=globalThis.localStorage){
 const read=(projectId,nodeId)=>{const raw=storage.getItem(keyFor(projectId,nodeId));if(!raw)return null;let value;try{value=JSON.parse(raw);}catch{throw Error('本机识别记录损坏，请保留原记录并检查存储');}if(value?.version!==1||value.projectId!==projectId||value.nodeId!==nodeId||typeof value.taskId!=='string')throw Error('本机识别记录无效');return value;};
 return {read,save(receipt){const key=keyFor(receipt.projectId,receipt.nodeId),previous=read(receipt.projectId,receipt.nodeId);if(previous&&(previous.taskId!==receipt.taskId||previous.revision!==receipt.revision))throw Error('另一窗口已更新原识别任务，请重新打开后恢复');const next={...receipt,revision:(previous?.revision||0)+1},raw=JSON.stringify(next);try{storage.setItem(key,raw);if(storage.getItem(key)!==raw)throw Error();}catch{throw Object.assign(Error('识别意图或任务标识尚未保存；未继续派发或查询，请保留此页面并重试原任务'),{code:'segmentation_receipt_save_failed'});}Object.assign(receipt,next);return receipt;},remove(receipt){const current=read(receipt.projectId,receipt.nodeId);if(current?.taskId!==receipt.taskId||current.revision!==receipt.revision)throw Error('原识别任务记录已变化，未丢弃');storage.removeItem(keyFor(receipt.projectId,receipt.nodeId));if(read(receipt.projectId,receipt.nodeId))throw Error('原识别任务记录未能清除');}};
}
export function createSegmentationReceipt({app,node,source,rect,time,configuration,uuid=()=>crypto.randomUUID()}){
 return {version:1,taskId:uuid(),revision:0,projectId:app.projectIdentity().id,nodeId:node.id,source:sourceIdentity(source),sourceFingerprint:sourceFingerprint(node),clip:JSON.stringify(node.clip||null),baselineMask:node.videoMask?.asset??null,baselineMaskSnapshot:stable(compactMedia(node.videoMask??null)),rect:{...rect},time,modelVersion:configuration.version,providerFingerprint:configuration.providerFingerprint??null,status:'intent',dispatched:false,createdAt:new Date().toISOString()};
}
export function assertReceiptCurrent(app,node,receipt,{sourceOf=n=>n.video,allowApplied=true}={}){
 if(app.projectIdentity().id!==receipt.projectId||!app.getState().nodes.includes(node)||node.id!==receipt.nodeId||sourceIdentity(sourceOf(node))!==receipt.source||sourceFingerprint(node)!==receipt.sourceFingerprint||JSON.stringify(node.clip||null)!==receipt.clip)throw Error('原识别任务来源或项目已变化，结果未应用');
 const actual=node.videoMask?.asset??null;
 if(actual!==receipt.baselineMask&&!(allowApplied&&receipt.maskAsset&&actual===receipt.maskAsset&&node.videoMask?.taskId===receipt.taskId))throw Error('来源蒙层已变化，原识别结果未应用');
 if(actual===receipt.baselineMask&&stable(compactMedia(node.videoMask??null))!==receipt.baselineMaskSnapshot)throw Error('来源蒙层字段已变化，原识别结果未应用');
}
export function assertResumeConfiguration(receipt,configuration){
 if(configuration?.protocol!=='replicate-sam2-native'||configuration.configured!==true||configuration.version!==receipt.modelVersion||receipt.providerFingerprint&&configuration.providerFingerprint!==receipt.providerFingerprint)throw Error('识别配置或模型版本已变化，不能续发旧任务；仍可查询原任务');
}
export function taskMessage(task){
 const states={preparing:'正在校验全源视频并准备分割片段',running:'原识别任务正在运行',needs_resume:'原任务有未派发分支；继续需要再次确认上传与推理',unknown:'供应商回执未确认；仅查询原任务，不会重新推理',succeeded:'完整蒙层已归档，正在保存到画布',failed:'原识别任务失败；未重新推理',cancelled:'已请求取消原任务；供应商取消状态见各分支'};
 const branches=(task.branches||[]).map(branch=>`${branch.direction==='reverse'?'倒序':'前向'}：${branch.status}${Number.isInteger(branch.downloadedFrames)?'，已下载 '+branch.downloadedFrames+' / '+branch.numFrames+' 帧':''}${branch.remoteCancellation?'，取消 '+branch.remoteCancellation:''}`);
 return [states[task.status]||'原识别意图已保存',...branches,task.error||''].filter(Boolean).join('；');
}
export function createTaskObservation({api,store,receipt,guard=()=>{},onStatus=()=>{},delay=ms=>new Promise(resolve=>setTimeout(resolve,ms)),pollMs=1500}){
 let knownTask;
 const check=signal=>{guard();if(signal?.aborted)throw signal.reason??new DOMException('已停止查看原任务','AbortError');};
 const accept=task=>{if(task.id!==receipt.taskId||task.version!==receipt.modelVersion||receipt.providerFingerprint&&task.providerFingerprint!==receipt.providerFingerprint||receipt.inputSha256&&task.source?.sha256&&task.source.sha256!==receipt.inputSha256)throw Error('原识别任务身份、来源字节或模型版本不一致');knownTask=task;onStatus(task);return task;};
 return {get task(){return knownTask;},async create(request,{signal}={}){check(signal);store.save(receipt);check(signal);const previousStatus=receipt.status;receipt.dispatched=true;receipt.status='unknown';try{store.save(receipt);}catch(error){receipt.dispatched=false;receipt.status=previousStatus;throw error;}check(signal);const response=await api.create(request,{signal,idempotencyKey:receipt.taskId,configuration:{version:receipt.modelVersion,providerFingerprint:receipt.providerFingerprint}});check(signal);const task=accept(response);receipt.status=task.status;store.save(receipt);return task;},async observe({signal,initial}={}){check(signal);store.save(receipt);let task=initial;
  while(true){check(signal);const response=task||await api.get(receipt.taskId,{signal});check(signal);task=accept(response);if(!['preparing','running'].includes(task.status))return task;await delay(pollMs);task=null;}
 },async resume({signal,configuration}={}){check(signal);assertResumeConfiguration(receipt,configuration);store.save(receipt);check(signal);const task=await api.resume(receipt.taskId,{signal,configuration:{version:receipt.modelVersion,providerFingerprint:receipt.providerFingerprint}});check(signal);return accept(task);},async cancel({signal}={}){store.save(receipt);const task=await api.cancel(receipt.taskId,{signal});if(signal?.aborted)throw signal.reason;return accept(task);}};
}

// A disk failure retains the asset and exact patch. A retry saves that patch;
// it never calls the segmentation provider or inserts a second history step.
export function createMaskApplication({app,node,store,localAssets,receipt,receiptStore,guard=()=>{},sourceOf=n=>n.video}){
 let mask,asset=receipt.maskAsset,patch;
 const current=()=>{guard();assertReceiptCurrent(app,node,receipt,{sourceOf});};
 return {get mask(){return mask;},get asset(){return asset;},async apply(value,media){
  current();const checked=validateMask(value,media);if(mask&&stable(mask)!==stable(checked))throw Error('原任务蒙层结果已变化，未覆盖');mask??=checked;
  if(!asset){asset=await localAssets.put(new Blob([JSON.stringify(mask)],{type:'application/json'}));current();}
  patch??={source:sourceOf(node),clip:receipt.clip,asset,time:receipt.time,width:mask.width,height:mask.height,duration:media.duration,timeline:'full-source',taskId:receipt.taskId};
  if((node.videoMask?.asset??null)===receipt.baselineMask){current();receipt.maskAsset=asset;receiptStore?.save(receipt);current();app.updateNode(node.id,{videoMask:patch});}
  current();if(stable(node.videoMask)!==stable(patch))throw Error('来源蒙层已被修改，未覆盖原结果');const beforeCommit=()=>{current();if(stable(node.videoMask)!==stable(patch))throw Error('蒙层已变化，已停止旧结果保存');return true;};
  // The canvas host owns complete history/view snapshots and its save-failure
  // state. Use its real guarded retry so success also releases leave protection.
  if(typeof app.saveProject==='function')await app.saveProject({beforeCommit});
  else {const state=app.getState();await store.save({version:1,nodes:state.nodes,edges:state.edges},receipt.projectId,{beforeCommit});await store.flush();}
  current();receipt.status='applied';return mask;
 }};
}
