import * as THREE from 'three';
import {loadSaved,disposeModel} from './model-io.mjs';
import {validateLighting,validateViewport} from './scene-settings.mjs';
import {ScenePlayback} from './playback.mjs';

function validateSavedScene(saved){
  const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
  const vector=(value,size)=>Array.isArray(value)&&value.length===size&&Array.from(value).every(Number.isFinite);
  if(!object(saved)||saved.version!==undefined&&saved.version!==2||saved.asset!==undefined&&(typeof saved.asset!=='string'||!saved.asset)||saved.grid!==undefined&&typeof saved.grid!=='boolean'||saved.shotId!=null&&typeof saved.shotId!=='string'||saved.motionIndex!==undefined&&(!Number.isInteger(saved.motionIndex)||saved.motionIndex< -1))throw Error('已保存的片场设置无效，本地修改已保留');
  if(saved.viewer!=null&&(!object(saved.viewer)||!vector(saved.viewer.position,3)||!vector(saved.viewer.quaternion,4)||!Number.isFinite(Math.hypot(...saved.viewer.quaternion))||Math.abs(Math.hypot(...saved.viewer.quaternion)-1)>.001))throw Error('已保存的片场视角无效，本地修改已保留');
  if(saved.lighting!==undefined)validateLighting({azimuth:0,elevation:0},saved.lighting);
  if(saved.shotRatios!==undefined){if(!object(saved.shotRatios))throw Error('已保存的片场画幅无效，本地修改已保留');for(const viewport of Object.values(saved.shotRatios))validateViewport(viewport);}
}

export async function readCommittedProject(runtime){
  // CanvasStore.load also advances its whole-graph CAS revision. A scoped scene
  // read must not authorize this editor's older graph to replace another tab.
  return new Promise((resolve,reject)=>{
    const request=window.indexedDB.open(runtime.projectDatabase);
    request.onupgradeneeded=()=>{request.transaction.abort();};
    request.onerror=()=>reject(request.error||Error('无法读取已保存的画布'));
    request.onblocked=()=>reject(Error('已保存的画布读取被阻塞，本地修改已保留'));
    request.onsuccess=()=>{
      const db=request.result;let tx,value;
      try{tx=db.transaction('documents');const read=tx.objectStore('documents').get(runtime.projectId==='canvas'?'canvas':'project:'+runtime.projectId);read.onsuccess=()=>{value=read.result;};read.onerror=()=>tx.abort();}
      catch(error){db.close();reject(error);return;}
      tx.oncomplete=()=>{db.close();resolve(value);};
      tx.onabort=tx.onerror=()=>{db.close();reject(tx.error||Error('已保存的画布读取失败，本地修改已保留'));};
    };
  });
}

// The host node may already hold a failed write. Read the committed project,
// then load its asset before releasing any recoverable editor resources.
export async function prepareSavedScene(runtime){
  runtime.assertTargetNode();
  const project=await readCommittedProject(runtime);
  runtime.assertTargetNode();
  if(project?.project?.id&&project.project.id!==runtime.projectId)throw Error('已保存的画布与当前项目不匹配，本地修改已保留');
  const node=project?.nodes?.find(value=>value.id===runtime.nodeId);
  if(node?.type!=='studio'||node.studio&&!node.studioV2||node.studioV2?.version&&node.studioV2.version!==2)throw Error('已保存的片场节点不存在或版本已变化，本地修改已保留');
  const saved=structuredClone(node.studioV2||{});validateSavedScene(saved);
  const content=new THREE.Scene();content.name='Scene';
  try{
    const loaded=saved.asset?await loadSaved(saved.asset):null;
    if(loaded)for(const child of loaded.scene.children.slice())content.add(child);
    runtime.assertTargetNode();
    if(runtime.closed)throw Error('片场已关闭，本次未重新加载');
    const animations=loaded?.animations||[];
    // Exercise animation binding before adopting the tree. Malformed metadata
    // or a bad animation must fail while the old editor is still untouched.
    const candidate={content,animations,shotId:saved.shotId,motionIndex:saved.motionIndex,find(id){let found;content.traverse(object=>{if(object.userData.studioId===id)found=object;});return found;}};
    const playback=new ScenePlayback(candidate);
    try{if(playback.selectedMotion())playback.select(saved.motionIndex,'camera',{play:false});}finally{playback.stop();}
    return {saved,content,animations};
  }catch(error){disposeModel(content);throw error;}
}
