export const relightSource=node=>node?.fullImage||node?.image;
const fields=['id','image','fullImage','crop','imageCrop','clip','trim','selection','imageSelection','region','metadata'];
const signature=node=>JSON.stringify(fields.map(key=>node?.[key]??null));
export function assertRelightSourceScope(node){
 if(['crop','imageCrop','clip','trim','selection','imageSelection','region'].some(key=>node?.[key]!=null))throw Error('打光编辑完整图片；请先将裁切或选区导出为图片');
 return node;
}
// The original object, project and full media intent authorize delayed work.
// A same-id replacement or changed crop cannot inherit that authority.
export function createRelightSourceGuard(app,node,{signal,isAlive=()=>true,requireSelection=false}={}){
 const projectId=app.projectIdentity().id,expected=signature(node);
 return ()=>{
  if(signal?.aborted)throw signal.reason??new DOMException('打光准备已取消','AbortError');
  if(!isAlive())throw new DOMException('打光面板已关闭','AbortError');
  const state=app.getState();
  if(app.projectIdentity().id!==projectId||!state.nodes.includes(node)||node.type!=='image'||signature(node)!==expected)throw Error('来源图片、选区或项目已变化，请重新打开打光');
  if(requireSelection&&(state.selected?.length!==1||state.selected[0]!==node.id))throw Error('图片选择已变化，请重新打开打光');
 };
}
export function createRelightConfigurationGuard(api,metadata,request){
 const expected=JSON.stringify(metadata);
 return ()=>{if(typeof api.configurationSnapshot!=='function'||JSON.stringify(api.configurationSnapshot())!==expected)throw Object.assign(Error('打光配置已变化，请重新确认生成'),{code:'configuration_required',providerDispatched:false});};
}
