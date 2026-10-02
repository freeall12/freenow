// Persisted generation history is independent of the transient gallery preview.
import {resultProvenance,retainedProvenance,historicalProvenance} from './src/features/media-preview/provenance.mjs';
const clone=value=>structuredClone(value);
export const mediaSource=n=>n?.video||'';
export function option(value,index=0){
  if(!value)return null;
  const video=typeof value==='string'?value:value.video||value.url;
  if(!video)return null;
  return {...(typeof value==='object'?clone(value):{}),id:value.id||value.sourceFileId||`${index}:${video}`,video,poster:value.poster||value.image||null};
}
export function batches(node){
  const histories=(node.videoHistory||[]).map((b,i)=>({...clone(b),id:b.id||`batch-${i}`,options:(b.options||[]).map(option).filter(Boolean)})).filter(b=>b.options.length);
  if(histories.length)return histories;
  const options=(node.versions||[]).filter(v=>v.video).map(option);
  return options.length?[{id:'legacy',prompt:node.generation?.prompt||'',parameters:clone(node.generation||{}),options}]:[];
}
export const count=node=>batches(node).reduce((sum,b)=>sum+b.options.length,0);
export function selectedBatch(node,history=batches(node)){
  const exact=history.findIndex(b=>b.options.some(o=>o.id===node.currentVideoOptionId));
  return Math.max(0,exact<0?history.findIndex(b=>b.options.some(o=>o.video===node.video)):exact);
}
export function dimensions(node,item){
  const width=node.width||435;
  return {width,height:item.width>0&&item.height>0?width*item.height/item.width:node.height||250};
}
export function grid(size,total){
  const cols=Math.min(total,total>4?4:2),rows=Math.ceil(total/cols);
  return {cols,rows,width:cols*size.width+Math.max(0,cols-1)*16,top:-(rows-1)*(size.height+16),bottom:size.height,
    cells:Array.from({length:total},(_,i)=>({x:(size.width+16)*(i%cols),y:-(size.height+16)*Math.floor(i/cols)}))};
}
export function primaryPatch(node,batch,item,currentConfig=node.generation||{}){
  const generation={...clone(currentConfig),...clone(batch.parameters||{}),prompt:batch.prompt??batch.parameters?.prompt??''};
  // Output multiplicity belongs to the next run, not to a historical result.
  for(const key of ['count','times'])if(currentConfig[key]!==undefined)generation[key]=currentConfig[key];
  return {video:item.video,image:item.poster||null,fullImage:null,clip:clone(item.clip||null),provenance:historicalProvenance(batch,item,item.video),
    currentVideoOptionId:item.id,currentSourceFileId:item.sourceFileId||null,generation,
    ...(batch.toolParameters?{params:clone(batch.toolParameters)}:{}),...dimensions(node,item),
    videoMetadata:{width:item.width||null,height:item.height||null,duration:item.duration??null}};
}
export function record(node,job,config=node.generation||{}){
  const history=batches(node),existing=history.find(b=>b.id===job.id);
  if(!history.length&&node.video){history.push({id:'previous:'+node.id,prompt:config.prompt||'',parameters:clone(config),toolParameters:clone(node.params||null),options:[option({video:node.video,poster:node.image,width:node.videoMetadata?.width,height:node.videoMetadata?.height,clip:node.clip,id:node.currentVideoOptionId||'previous:'+node.id,sourceFileId:node.currentSourceFileId,provenance:retainedProvenance(node,node.video)})]});}
  const batch=existing||{id:job.id,createdAt:job.createdAt,prompt:job.request.prompt||'',parameters:clone(job.request.kind==='video.generate'?job.request.parameters||{}:config),toolParameters:clone(node.params||null),options:job.outputs.filter(o=>o.type==='video').map((o,i)=>option({...o,...resultProvenance(job,o),id:o.id||`${job.id}:${i}`}))};
  if(!batch.options.length)throw Error('视频历史需要可播放的生成结果');
  if(!existing)history.push(batch);
  return {...primaryPatch(node,batch,batch.options[0],config),videoHistory:history,versions:[]};
}
export function flattened(node){return batches(node).flatMap(b=>b.options.map(o=>({...primaryPatch(node,b,o),label:node.title})));}
export function keepPrimary(node){
  const history=batches(node),batch=history[selectedBatch(node,history)],item=batch?.options.find(o=>o.id===node.currentVideoOptionId)||batch?.options.find(o=>o.video===node.video);
  return {videoHistory:item?[{...batch,options:[item]}]:[],versions:[]};
}
export function copyPosition(node,size,existing){
  const p={x:node.x+1000,y:node.y,...size};
  for(let i=0;i<10000;i++){const hits=existing.filter(n=>p.x<n.x+n.width+24&&p.x+p.width+24>n.x&&p.y<n.y+n.height+56&&p.y+p.height+56>n.y);if(!hits.length)return p;p.y=Math.max(...hits.map(n=>n.y+n.height+65));}
  throw Error('没有可用的节点放置空间');
}
