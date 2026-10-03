import {imageRepairBusy} from '../local-resource-migration/node-image-repair.mjs';

const stale=()=>Object.assign(Error('上传目标或文件选择已变化，未应用旧文件'),{code:'audio_upload_stale'});
const signature=node=>JSON.stringify(Object.fromEntries(Object.entries(node).filter(([key])=>!['x','y','selected'].includes(key))));

// The caller captures target/snapshot/project synchronously when opening its
// native picker. Never reconstruct this receipt after a lazy import or decode.
export async function applyAudioUpload({file,target,snapshot,projectId,app,isLatest,validateFile,decodeFile,assets,getJobs=()=>[]}={}){
 if(!target||snapshot?.id!==target.id||![isLatest,validateFile,decodeFile].every(value=>typeof value==='function')||typeof assets?.put!=='function')throw Error('音频上传接口不完整');
 const token=signature(snapshot);
 const live=()=>app.getState().nodes.find(node=>node.id===target.id);
 function guard(){
  const node=live();
  if(!isLatest()||app.projectIdentity().id!==projectId||node!==target||signature(node)!==token)throw stale();
  if(imageRepairBusy(node,getJobs()))throw Object.assign(Error('音频节点正在执行任务，请等待完成或取消'),{code:'audio_upload_busy'});
 }
 guard();validateFile(file);
 const metadata=await decodeFile(file);guard();
 if(!Number.isFinite(metadata?.duration)||metadata.duration<=0||!Number.isFinite(metadata.duration*1000))throw Error('音频实际时长无效');
 const ref=await assets.put(file);guard();
 if(typeof ref!=='string'||!/^asset:[^\s]+$/.test(ref))throw Error('音频未写入本地素材存储');
 const patch={audio:ref,audioMode:'upload',title:file.name,audioDuration:metadata.duration,durationMs:metadata.duration*1000,width:300,height:300,provenance:{kind:'imported',mediaSource:ref,model:null}};
 app.updateNode(target.id,patch);
 const result={applied:true,persisted:false,ref,duration:metadata.duration};
 try{
  await app.saveProject();
  if(!isLatest()||app.projectIdentity().id!==projectId||live()!==target||Object.entries(patch).some(([key,value])=>JSON.stringify(target[key])!==JSON.stringify(value)))return {...result,saveError:'保存等待期间节点或画布状态已变化，请使用画布菜单保存当前编辑'};
  return {...result,persisted:true};
 }catch(error){return {...result,saveError:error.message};}
}
