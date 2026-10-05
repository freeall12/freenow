import {parentImage} from '../../../image-enhance-core.mjs';

const regionFields=['crop','imageCrop','clip','trim','selection','imageSelection','region','sourceBox','imageRegion','selectedRegion','mask','projection'];
const scopeFields=['id','type','image','fullImage',...regionFields,'metadata','params','generation','settings','prompt','provenance'];
const snapshot=(node,fields)=>JSON.stringify(fields.map(key=>node?.[key]??null));
export const enhanceTargetSnapshot=node=>snapshot(node,[...scopeFields,'tool','versions','provenance']);
export function assertEnhanceSourceScope(node){
 if(regionFields.some(key=>node?.[key]!=null))throw Error('图片增强编辑完整图片；请先将裁切或选区导出为图片');
 return node;
}

// A same-id replacement, reconnected edge or another project cannot inherit
// the original authorization after asynchronous preparation or provider work.
export function createEnhanceSourceGuard(app,node,parent,{signal,isAlive=()=>true,requireSelection=false}={}){
 const projectId=app.projectIdentity().id,sourceSnapshot=snapshot(parent,scopeFields),initialTarget=enhanceTargetSnapshot(node);
 const edges=app.getState().edges.filter(edge=>edge.target===node.id),edgeSnapshot=JSON.stringify(edges);
 return ({targetSnapshot=initialTarget}={})=>{
  if(signal?.aborted)throw signal.reason??new DOMException('增强准备已取消','AbortError');
  if(!isAlive())throw new DOMException('增强面板已关闭','AbortError');
  const state=app.getState(),incoming=state.edges.filter(edge=>edge.target===node.id);
  if(app.projectIdentity().id!==projectId||!state.nodes.includes(node)||node.tool!=='enhance'||node.type!=='image'||!state.nodes.includes(parent)||parentImage(state,node.id)!==parent||snapshot(parent,scopeFields)!==sourceSnapshot||enhanceTargetSnapshot(node)!==targetSnapshot||incoming.length!==edges.length||incoming.some((edge,index)=>edge!==edges[index])||JSON.stringify(incoming)!==edgeSnapshot)throw Error('来源图片、连线、参数、选区、增强节点或项目已变化，结果未覆盖');
  if(requireSelection&&(state.selected?.length!==1||state.selected[0]!==node.id))throw Error('图片选择已变化，请重新打开增强面板');
 };
}

export function createEnhanceConfigurationGuard(api,metadata){
 const expected=JSON.stringify(metadata);
 return ()=>{if(JSON.stringify(api.configurationSnapshot?.()??null)!==expected)throw Object.assign(Error('增强配置已变化，请重新确认生成'),{code:'configuration_required',providerDispatched:false});};
}
