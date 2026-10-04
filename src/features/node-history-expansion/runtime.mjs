import {historyBatches,expandHistory} from './model.mjs';

const project=app=>app.projectIdentity?.().id;
const display=value=>window.CanvasResourceDisplay?.displayMediaRef(value)??(typeof value==='string'&&!/^(?:\s*https?:|\s*[\/\\]{2})/i.test(value)?value:'');

export async function applyNodeHistory(node,{app,legacy=[],expected=JSON.stringify(node),projectId=project(app),decodeImage}={}){
  const valid=()=>app.getState().nodes.includes(node)&&JSON.stringify(node)===expected&&project(app)===projectId;
  const assertCurrent=()=>{if(!valid())throw Error('节点或项目已变化，请重新应用历史');};
  assertCurrent();
  const batches=historyBatches(node,legacy);
  if(!batches.length)throw Error('无可应用历史');
  if(node.type==='image'){
    await window.CanvasResourceDisplayReady;
    assertCurrent();
    await Promise.all(batches.flatMap(batch=>batch.options.map(async item=>{
      if(item.width>0&&item.height>0)return;
      const source=display(item.fullImage||item.image);
      if(!source)throw Error('原站媒体待导入本地，请导入后再应用历史');
      const resolved=display(source.startsWith('asset:')?await window.LocalAssets.url(source):source);
      if(!resolved)throw Error('原站媒体待导入本地，请导入后再应用历史');
      const size=decodeImage?await decodeImage(resolved):await (async()=>{const image=new Image();image.src=resolved;await image.decode();return {width:image.naturalWidth,height:image.naturalHeight};})();
      if(![size.width,size.height].every(value=>Number.isFinite(value)&&value>0))throw Error('历史图片无法读取尺寸');
      Object.assign(item,{width:size.width,height:size.height});
    })));
  }
  assertCurrent();
  const graph=expandHistory(node,batches),group=app.insertGraph(graph);
  await window.CanvasStore?.flush();
  if(project(app)!==projectId||!app.getState().nodes.includes(group))throw Error('历史分组或项目已变化，已停止视图跳转');
  // Fit changes only the viewport; graph insertion owns one undo/save transaction.
  app.fitNode?.(group.id,{padding:.2,duration:800});
  return group;
}
