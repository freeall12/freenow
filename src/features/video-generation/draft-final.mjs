import {videoModels} from '../agent-generation/video-catalog.mjs';

const modelFor=value=>videoModels.find(model=>model.id===value||model.name===value||model.aliases.includes(value));
const configOf=node=>node?.generation||node?.params||{};
const fileId=value=>typeof value==='string'?value.trim().length>0:typeof value==='number'&&Number.isFinite(value)&&value>0;
const media=value=>typeof value==='string'&&value.trim().length>0;
const purpose=edge=>edge.purpose??edge.data?.purpose;
const fail=message=>{throw Object.assign(new Error(message),{code:'draft_reference_unavailable'});};

export function isDraftConfig(config={}){
  const id=modelFor(config.model||config.modelId)?.id;
  return !config.draftVideoId&&(id==='seedance-2.5-draft'||id==='seedance-2.5'&&config.draft===true);
}
export function isFinalConfig(config={}){
  return modelFor(config.model||config.modelId)?.id==='seedance-2.5'&&fileId(config.draftVideoId);
}
export const isDraftNode=node=>node?.type==='video'&&isDraftConfig(configOf(node));
export const isFinalNode=node=>node?.type==='video'&&isFinalConfig(configOf(node));
export const hasDraftResult=node=>isDraftNode(node)&&media(node.video)&&fileId(node.currentSourceFileId);

// Never trust a detached node snapshot or a caller-supplied provider file ID.
export function requireDraftSource(source,nodes){
  const matches=nodes.filter(node=>node.id===source?.id);
  if(matches.length!==1)fail('样片来源已不存在，请重新选择');
  const live=matches[0];
  if(!isDraftNode(live))fail('请选择 Seedance 2.5 样片结果');
  if(!hasDraftResult(live))fail('样片尚无可用视频或文件标识，请先完成样片生成');
  return live;
}

function estimateMedia(source,nodes,edges=[]){
  const saved=configOf(source).draftEstimateMedia;
  if(saved)return Object.fromEntries(['images','videos','audios'].map(key=>[key,Array.isArray(saved[key])?saved[key].filter(media):[]]));
  const result={images:[],videos:[],audios:[]},byId=new Map(nodes.map(node=>[node.id,node]));
  for(const edge of edges){
    if(edge.target!==source.id||![undefined,null,'generation-input'].includes(purpose(edge)))continue;
    const node=byId.get(edge.source),key={image:'images',video:'videos',audio:'audios'}[node?.type];
    const url=node?.type==='image'?node.fullImage||node.image:node?.[node?.type];
    if(key&&media(url))result[key].push(url);
  }
  return result;
}

function finalParameters(source,draftEstimateMedia){
  const original=configOf(source),model=modelFor('seedance-2.5');
  const inherited={duration:original.duration,ratio:original.ratio??original.aspectRatio,videoMode:original.videoMode??original.modelType,
    mode:original.mode,audio:original.audio??original.generateAudio??original.generate_audio};
  return {...Object.fromEntries(Object.entries(inherited).filter(([,value])=>value!==undefined)),
    model:model.name,modelId:model.id,draft:false,draftVideoId:source.currentSourceFileId,draftEstimateMedia,
    quality:'1080p',resolution:'1080p',count:1,times:1,prompt:''};
}

export function resolveDraftReference(finalNode,nodes,edges){
  const matches=nodes.filter(node=>node.id===finalNode?.id),live=matches[0];
  if(matches.length!==1||!isFinalNode(live))fail('正式片节点无效，请从样片重新生成');
  const incoming=edges.filter(edge=>edge.target===live.id);
  if(incoming.length!==1||purpose(incoming[0])!=='draft-reference'||incoming[0].source===live.id)fail('正式片需要且只能引用一个有效样片');
  const source=requireDraftSource({id:incoming[0].source},nodes),draftEstimateMedia=estimateMedia(source,nodes,edges);
  return {source,draftVideoId:source.currentSourceFileId,draftEstimateMedia,parameters:finalParameters(source,draftEstimateMedia)};
}

export function createFinalPlan(source,nodes,{id,edgeId}){
  const live=requireDraftSource(source,nodes);
  if(!media(id)||!media(edgeId)||nodes.some(node=>node.id===id))fail('正式片节点标识无效或已存在');
  if(![live.x,live.y,live.width,live.height].every(Number.isFinite)||live.width<=0||live.height<=0)fail('样片画布尺寸无效');
  // Official ui() resolves absolute position, then adds width + 100 and zero y.
  // This project already stores absolute coordinates, including grouped nodes.
  const node={id,type:'video',title:'生成正式片',x:live.x+live.width+100,y:live.y,width:live.width,height:live.height,
    image:null,video:null,hide_inputbar:true,generation:finalParameters(live,estimateMedia(live,nodes))};
  const edge={id:edgeId,source:live.id,target:id,sourceHandle:'right',targetHandle:'left',purpose:'draft-reference'};
  return {node,edge};
}
