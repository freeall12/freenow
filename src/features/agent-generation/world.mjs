import {models,config,prepare,references,sourceReference} from '../world-node/model.mjs';
import {captureWorldSourceGuard} from '../world-node/media.mjs';
import {worldProviderPresentation} from '../world-node/provider-labels.mjs';
import {assertWorkflowRequestBudget} from '../agent-workflows/media-transport.mjs';
import {worldRendererCapabilities,worldRendererError,assertWorldRendererSupport} from '../world-node/render-capabilities.mjs';

const active=new WeakMap();
const fail=(code,message)=>Object.assign(Error(message),{code});
const busy=job=>['queued','running','unknown'].includes(job.status)||job.applying;
export const worldGenerationBusy=(app,id,api)=>active.get(app)?.has(id)||api.getJobs().some(job=>job.request?.kind==='world.generate'&&job.request.nodeId===id&&busy(job));
function target(app,id){const node=app.getState().nodes.find(node=>node.id===id);if(node?.type!=='world')throw fail('invalid_world_node','请选择独立 3D 世界节点；片场节点请使用 model.generate');return node;}
function resolveReferences(app,node,args){
 const state=app.getState();
 if(args.referenceIds===undefined)return references(node.id,state);
 if(!Array.isArray(args.referenceIds)||args.referenceIds.length>16||new Set(args.referenceIds).size!==args.referenceIds.length)throw fail('invalid_references','参考 ID 必须唯一且不超过16个');
 return args.referenceIds.map(id=>{
  if(id===node.id)throw fail('invalid_references','世界节点不能引用自身');
  const ref=state.nodes.find(item=>item.id===id);
  if(!ref||!['text','image','video'].includes(ref.type))throw fail('invalid_references','仅支持现有文字、图片和视频节点');
  return sourceReference(ref);
 });
}
export function readWorld({nodeId}={}, {app,metadata}={}){
 const node=nodeId?target(app,nodeId):null;
 const refs=node?references(node.id,app.getState()):[];
 return {models:models.map(({icon,...model})=>({...model,modes:model.provider==='tripo'?['TEXT_TO_WORLD','IMAGE_TO_WORLD']:['TEXT_TO_WORLD','IMAGE_TO_WORLD','MULTI_IMAGE_TO_WORLD','PANORAMA_TO_WORLD','VIDEO_TO_WORLD'],maxImages:model.provider==='tripo'?1:8,maxVideos:model.provider==='tripo'?0:1,materials:model.provider==='tripo'?['geometry','texture','pbr']:[],promptWithImage:model.provider!=='tripo',localRenderer:{supported:!worldRendererError(model),error:worldRendererError(model)},configuration:{text:worldProviderPresentation(model,metadata),image:worldProviderPresentation(model,metadata,{image:true})}})),
  source:'captured-official-catalog',liveProviderVerified:false,outputRenderer:worldRendererCapabilities(),
  ...(node?{nodeId:node.id,settings:config(node),references:refs.map(({url,text,...ref})=>({...ref,available:ref.type==='text'?!!text?.trim():!!url})),resource:node.worldResource?{format:node.worldResource.format,name:node.worldResource.name,bytes:node.worldResource.bytes,outputType:node.outputType}:null}:{}),
  note:'配置原生 Tripo 或支持该操作的网关后可提交。MiniMax H3 是独立视频模型，不属于本 3D 目录。当前本地仅能应用 GLB；高斯泼溅原生格式尚不能预览，不会伪装为成功。'};
}

export async function startWorldGeneration(args,{app,api,signal,onSubmitted,materialize}={}){
 const node=target(app,args.nodeId),getNode=id=>app.getState().nodes.find(item=>item.id===id);
 let locks=active.get(app);if(!locks){locks=new Set();active.set(app,locks);}
 if(worldGenerationBusy(app,node.id,api))throw fail('world_generation_busy','此世界节点已有生成任务，请查询已有任务');
 const settings={...config(node),...Object.fromEntries(['model','prompt','isPano','material'].filter(key=>args[key]!==undefined).map(key=>[key,args[key]]))};
 if(!models.some(model=>model.id===settings.model))throw fail('invalid_world_model','请先读取世界生成模型目录');
 if(typeof settings.prompt!=='string'||settings.prompt.length>12000||typeof settings.isPano!=='boolean'||!['geometry','texture','pbr'].includes(settings.material))throw fail('invalid_world_settings','世界生成参数无效');
 const refs=resolveReferences(app,node,args);
 if(refs.some(ref=>ref.type!=='text'&&!ref.url))throw fail('missing_reference_media','参考节点尚无实际媒体，不能退回纯文字生成');
  const plan=prepare({...node,worldConfig:settings},refs);
  assertWorldRendererSupport(plan.model);
 if(plan.error)throw fail('invalid_world_inputs',plan.error);
 if(plan.promptDisabled&&(settings.prompt.trim()||refs.some(ref=>ref.type==='text'&&ref.text?.trim())))throw fail('unsupported_world_prompt','此模型的图生3D不支持文字提示，请显式清空提示并移除文字参考');
 if(settings.isPano&&(plan.model.provider==='tripo'||plan.imageCount!==1||plan.videoCount))throw fail('invalid_panorama_input','全景输入仅适用于世界模型的一张图片');
 const guard=captureWorldSourceGuard(node,refs,{getNode,resolveReferences:()=>resolveReferences(app,node,args),signal});
 guard();locks.add(node.id);let launched=false;
 try{
  const availability=await api.availability({request:plan.request,signal});guard();
  if(availability?.configured===false)return {configurationRequired:true,nodeId:node.id};
  const checked=guard,request=plan.request;
  assertWorkflowRequestBudget(request);
  if(typeof materialize!=='function')throw fail('missing_world_renderer','世界结果渲染器不可用');
  let acknowledge,rejectReceipt;
  const receipt=new Promise((resolve,reject)=>{acknowledge=resolve;rejectReceipt=reject;});
  const completion=api.runInPlace(request,{type:'model',guard:checked,apply:async output=>{
   checked();const patch=await materialize(output,plan.model.outputType,{signal,validateSources:checked});checked();
   return app.updateNode(node.id,{...patch,worldConfig:settings});
  }},{signal,onSubmitted:async job=>{checked();await onSubmitted?.(job);checked();acknowledge(job);}});
  launched=true;
  completion.catch(rejectReceipt).finally(()=>locks.delete(node.id));
  return {job:await receipt,completion};
 }finally{if(!launched)locks.delete(node.id);}
}
