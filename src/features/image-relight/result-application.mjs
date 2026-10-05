import {createRelightSourceGuard} from './source-guard.mjs';
export function createRelightResultApplication({app,node,parameters,beforeCreate=()=>{}}){
 const guard=createRelightSourceGuard(app,node);let created,image,fullImage;
 const verify=()=>{guard();if(created&&(created.length!==1||!app.getState().nodes.includes(created[0])||created[0].type!=='image'||created[0].image!==image||created[0].fullImage!==fullImage))throw Error('打光结果节点已变化，未覆盖或重复创建');};
 return {guard,async apply(output){
  verify();const actual=output.fullImage||output.image||output.url,preview=output.image||output.url||actual;
  if(output.type!=='image'||typeof actual!=='string'||!actual||typeof preview!=='string'||!preview)throw Error('打光任务缺少真实图片结果');
  if(created&&(actual!==fullImage||preview!==image))throw Error('原打光任务结果已变化，未覆盖或重复创建');
  if(!created){
   if(typeof app.saveProject!=='function')throw Error('画布缺少持久保存入口');
   beforeCreate();created=app.createConnected(node.id,[{...output,image:preview,fullImage:actual,title:output.title||'打光',relightParameters:structuredClone(parameters)}],{gap:200});image=preview;fullImage=actual;
  }
  verify();await app.saveProject();verify();return created;
 }};
}
