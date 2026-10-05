import {sourceGuard} from './core.mjs';
// A save retry belongs to the original result and may outlive the editor that
// closes when createConnected selects it. Never create a second result node.
export function createMaskResultApplication({app,node,maskAsset,reference,referenceNode,sourceOf,label,beforeCreate=()=>{}}){
 const guard=sourceGuard(app,node,{maskAsset,reference,referenceNode,sourceOf});let created,video;
 const verify=()=>{guard();if(created&&(created.length!==1||!app.getState().nodes.includes(created[0])||created[0].type!=='video'||created[0].video!==video))throw Error('视频编辑结果节点已变化，未覆盖或重复创建');};
 return {guard,async apply(output){
  verify();const actual=output.video||output.url;if(typeof actual!=='string'||!actual||output.type!=='video')throw Error('视频编辑缺少实际视频结果');if(created&&actual!==video)throw Error('原任务结果已变化，未覆盖或重复创建');
  if(!created){if(typeof app.saveProject!=='function')throw Error('画布缺少持久保存入口');beforeCreate();created=app.createConnected(node.id,[{...output,video:actual,image:output.poster,title:output.title||label}]);video=actual;}
  verify();await app.saveProject();verify();return created;
 }};
}
