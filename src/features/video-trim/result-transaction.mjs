const failure=(code,message,details={})=>Object.assign(Error(message),{code,...details});
const sourceSignature=(node,source)=>JSON.stringify([source(node),node.clip??null]);
const resultSignature=node=>JSON.stringify(Object.fromEntries(Object.entries(node).filter(([key])=>!['x','y','selected'].includes(key))));

// Capture ownership before any decode or lazy work. Equal IDs and media URLs
// in another project, or an undo-created replacement, are different owners.
export function captureTrimOwner(app,node,source){
 const projectId=app.projectIdentity().id,signature=sourceSignature(node,source);
 const sameProject=()=>app.projectIdentity().id===projectId;
 return {projectId,sameProject,assertCurrent(signal){
  if(signal?.aborted)throw signal.reason||new DOMException('视频处理已停止','AbortError');
  if(!sameProject()||!app.getState().nodes.includes(node)||sourceSignature(node,source)!==signature)throw failure('trim_source_changed','来源视频或画布已变化，未应用旧剪辑');
  return node;
 }};
}

// Application is synchronous and atomic through createConnected. A failed
// save keeps visible results; retries only save those exact objects and edges.
export function createTrimResultTransaction({app,owner,sourceId,signal}){
 let created=null,edges=null,signatures=null,pending=null,persisted=false;
 function assertResults(){
  if(!owner.sameProject())throw failure('trim_result_changed','画布已切换，不能保存旧剪辑结果');
  const state=app.getState();
  if(created.some((node,index)=>!state.nodes.includes(node)||resultSignature(node)!==signatures[index])||edges.some(edge=>!state.edges.includes(edge.object)||JSON.stringify(edge.object)!==edge.signature))throw failure('trim_result_changed','剪辑结果或连线已被撤销、删除或修改，不能自动重建');
 }
 async function persist(){
  assertResults();
  try{
   if(await app.saveProject()===false)throw Error('画布保存未完成');
  }catch(error){
   throw failure('trim_save_failed','本地剪辑结果已加入画布，保存未确认：'+error.message,{applied:true,nodeIds:created.map(node=>node.id)});
  }
  assertResults();persisted=true;
  return {applied:true,persisted:true,nodeIds:created.map(node=>node.id)};
 }
 function retrySave(){
  if(pending)return pending;
  if(!created)return Promise.reject(failure('trim_result_missing','尚无可保存的剪辑结果'));
  if(persisted){try{assertResults();return Promise.resolve({applied:true,persisted:true,nodeIds:created.map(node=>node.id)});}catch(error){return Promise.reject(error);}}
  pending=persist().finally(()=>{pending=null;});return pending;
 }
 return {apply(outputs){
  if(created)return retrySave();
  owner.assertCurrent(signal);
  if(!Array.isArray(outputs)||!outputs.length)throw failure('trim_result_missing','没有有效剪辑结果');
  const beforeEdges=new Set(app.getState().edges);
  const added=app.createConnected(sourceId,outputs);
  if(!Array.isArray(added)||added.length!==outputs.length||added.some(node=>!node?.id))throw failure('trim_apply_failed','剪辑结果节点未完整创建');
  created=added;signatures=created.map(resultSignature);
  const ids=new Set(created.map(node=>node.id));
  edges=app.getState().edges.filter(edge=>!beforeEdges.has(edge)&&edge.source===sourceId&&ids.has(edge.target)).map(object=>({object,signature:JSON.stringify(object)}));
  if(edges.length!==created.length)throw failure('trim_apply_failed','剪辑结果连线未完整创建');
  return retrySave();
 },retrySave,status:()=>({applied:!!created,persisted,nodeIds:created?.map(node=>node.id)||[]})};
}
