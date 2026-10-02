import * as THREE from 'three';
import {loadSaved,exportGlb,disposeModel} from './model-io.mjs';

// Results are retained on the canvas before this local scene application runs.
// A persisted job marker makes save-failure retries idempotent.
export async function applyGeneratedModels(job,{app,assets,store,current}){
  const nodeId=job.request.nodeId;
  const getNode=()=>app.getState().nodes.find(node=>node.id===nodeId);
  const node=getNode();
  if(!node||node.type!=='studio')throw Error('目标片场已删除；模型仍保留在画布中');
  const binding=job.request.parameters?.sceneBinding;
  if(binding&&(binding.version!==2||binding.nodeId!==nodeId))throw Error('模型任务的片场绑定无效');
  const instance=current()?.nodeId===nodeId?current():null,runtime=instance?.runtime;
  const saved=JSON.stringify(node.studioV2||{}),revision=runtime?.revision;
  const position=job.request.parameters?.position||[0,0,0];
  if(position.length!==3||position.some(value=>!Number.isFinite(value)))throw Error('模型放置坐标无效');
  const outputs=job.outputs.filter(output=>output.type==='model');
  if(!outputs.length)throw Error('生成结果没有可导入的模型');
  if(!job.id)throw Error('模型任务缺少唯一 ID');
  const assertCurrent=()=>{
    const latest=getNode();
    if(!latest||latest.type!=='studio'||latest.studio&&!latest.studioV2)throw Error('目标片场已删除或切换版本；模型仍保留在画布中');
    if(runtime){if(current()!==instance||runtime.closed||runtime.revision!==revision)throw Error('导入期间片场已更新，请重试应用模型');runtime.assertReady();}
    else if(current()?.nodeId===nodeId||JSON.stringify(latest.studioV2||{})!==saved)throw Error('导入期间片场已更新，请重试应用模型');
  };
  const findApplied=root=>{let found;root.traverse(object=>{if(object.userData.studioGenerationJob===job.id)found=object;});return found;};
  let document,loaded=[],batch=new THREE.Group(),adopted=false;
  batch.name=job.request.prompt?.slice(0,80)||'生成模型';batch.userData.studioGenerationJob=job.id;
  try{
    assertCurrent();
    if(runtime)document=runtime.content;
    else if(node.studioV2?.asset){const source=await loadSaved(node.studioV2.asset);document=source.scene;loaded.push(source);}
    else document=new THREE.Group();
    assertCurrent();
    const existing=findApplied(document);
    if(existing){if(runtime)await runtime.flush();else await store.flush();return {applied:true,nodeId,objectIds:[existing.userData.studioId],alreadyApplied:true};}
    for(const output of outputs){
      const url=output.url||output.sourceUrl;if(!url)throw Error('生成模型缺少 GLB 地址');
      const result=await loadSaved(url);loaded.push(result);assertCurrent();batch.add(result.scene);
    }
    const clips=loaded.filter(result=>result.scene!==document).flatMap(result=>result.animations);
    if(runtime){
      const result=await runtime.addObject(batch,{position},clips);adopted=true;
      return {applied:true,nodeId,objectIds:[result.id]};
    }
    batch.position.fromArray(position);document.add(batch);
    document.traverse(object=>{object.userData.studioId||=crypto.randomUUID();});
    const blob=await exportGlb(document,loaded.flatMap(result=>result.animations));assertCurrent();
    const asset=await assets.put(blob);assertCurrent();
    app.updateNode(nodeId,{studioV2:{...node.studioV2,version:2,asset}});
    await store.flush();return {applied:true,nodeId,objectIds:[batch.userData.studioId]};
  }catch(error){
    // addObject may commit to the live scene before persistence fails.
    if(runtime&&batch.parent===runtime.content)adopted=true;
    throw error;
  }finally{
    if(!adopted){if(!runtime&&document)disposeModel(document);if(runtime||!batch.parent)disposeModel(batch);}
    for(const result of loaded)for(const scene of result.scenes||[])if(scene!==document&&scene!==batch&&!scene.parent)disposeModel(scene);
  }
}
