import {imageResultPatch,imageResultVersion} from '../image-editor/generated-results.mjs';
import {createEnhanceSourceGuard,enhanceTargetSnapshot} from './source-guard.mjs';

export function createEnhanceResultApplication({app,node,parent,label,parameters,legacyVersions=[]}){
 const scope=createEnhanceSourceGuard(app,node,parent),oldImage=node.fullImage||node.image,oldVersions=structuredClone(node.versions||legacyVersions);
 let targetSnapshot,appliedOutput;
 const guard=()=>scope(targetSnapshot===undefined?{}:{targetSnapshot});
 return {guard,get applied(){return appliedOutput!==undefined;},async apply(output){
  guard();const actual=output.fullImage||output.image||output.url,preview=output.image||output.url||actual;
  if(output.type!=='image'||typeof actual!=='string'||!actual||typeof preview!=='string'||!preview)throw Error('增强任务缺少真实图片结果');
  if(typeof app.saveProject!=='function')throw Error('画布缺少持久保存入口');
  const identity=JSON.stringify(imageResultPatch(output));
  if(appliedOutput!==undefined&&appliedOutput!==identity)throw Error('原增强任务结果已变化，未覆盖或重复添加版本');
  if(appliedOutput===undefined){
   const versions=[imageResultVersion(output,{label,parameters:structuredClone(parameters),createdAt:Date.now()}),...oldVersions.map(version=>typeof version==='string'?{image:version}:version).map(version=>(version.fullImage||version.image)===oldImage&&!version.provenance&&!version.generation?.model&&!version.model?{...version,...imageResultVersion(node)}:version)];
   if(oldImage&&!versions.some(version=>(version.fullImage||version.image)===oldImage))versions.push(imageResultVersion(node,{label:'之前的版本'}));
   app.updateNode(node.id,{...imageResultPatch(output),versions});
   appliedOutput=identity;targetSnapshot=enhanceTargetSnapshot(node);
  }
  // updateNode autosave is not a persistence receipt. A retry saves this same
  // result and version without owning provider submission or history creation.
  guard();await app.saveProject();guard();return node;
 }};
}
