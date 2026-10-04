import {src,values} from './image-versions-core.mjs';
import {resultProvenance,retainedProvenance,historicalProvenance} from './src/features/media-preview/provenance.mjs';
export {copyPosition,grid} from './src/features/video-history/core.mjs';
const clone=value=>structuredClone(value);
export function option(value,index=0){
  if(!value)return null;
  const item=typeof value==='string'?{image:value}:clone(value),image=src(item)||item.url;
  return image?{...item,image,fullImage:image,id:item.id||item.sourceFileId||`${index}:${image}`,width:item.pixelWidth||item.width,height:item.pixelHeight||item.height}:null;
}
export function batches(node){return (node.imageHistory||[]).map((b,i)=>({...clone(b),id:b.id||`batch-${i}`,options:(b.options||[]).map(option).filter(Boolean)})).filter(b=>b.options.length);}
export const hasHistory=node=>batches(node).length>0;
export const count=node=>new Set([src(node),...batches(node).flatMap(b=>b.options.map(src))].filter(Boolean)).size;
export function selectedBatch(node,history=batches(node)){
  const exact=history.findIndex(b=>b.options.some(o=>o.id===node.currentImageOptionId));
  return Math.max(0,exact<0?history.findIndex(b=>b.options.some(o=>src(o)===src(node))):exact);
}
export function dimensions(node,item){
  if(!(item?.width>0&&item?.height>0))return {width:node.width,height:node.height};
  const ratio=item.width/item.height;
  return {width:Math.round(ratio>1?250*ratio:250),height:Math.round(ratio<1?250/ratio:250)};
}
// Historical aspect changes keep the bottom-center anchor, including fractional world coordinates.
export function anchored(node,size){return {...size,x:node.x+(node.width-size.width)/2,y:node.y+node.height-size.height};}
export function primaryPatch(node,batch,item,config=node.generation||{}){
  const generation={...clone(config),...clone(batch.parameters||{}),prompt:batch.prompt??batch.parameters?.prompt??''};
  for(const key of ['count','times'])if(config[key]!==undefined)generation[key]=config[key];
  return {...anchored(node,dimensions(node,item)),image:src(item),fullImage:src(item),pixelWidth:item.width||null,pixelHeight:item.height||null,provenance:historicalProvenance(batch,item,src(item)),
    currentImageOptionId:item.id,currentSourceFileId:item.sourceFileId||null,generation,
    ...(batch.toolParameters?{params:clone(batch.toolParameters)}:{}),versions:batch.options.map(o=>({...o,image:src(o)}))};
}
export function record(node,job,config=node.generation||{},fallback=[]){
  const history=batches(node),existing=history.find(b=>b.id===job.id);
  if(!history.length&&src(node)){
    const previous=values(node,fallback),current=option({image:src(node),width:node.pixelWidth,height:node.pixelHeight,id:node.currentImageOptionId||`previous:${node.id}`,sourceFileId:node.currentSourceFileId,provenance:retainedProvenance(node,src(node))});
    const options=[current,...previous.filter(o=>src(o)!==src(node)).map(option)];
    history.push({id:`previous:${node.id}`,prompt:config.prompt||'',parameters:clone(config),toolParameters:clone(node.params||null),options});
  }
  const batch=existing||{id:job.id,createdAt:job.createdAt,prompt:job.request.prompt||'',parameters:clone(job.request.parameters||{}),toolParameters:clone(node.params||null),options:job.outputs.filter(o=>o.type==='image').map((o,i)=>option({...o,...resultProvenance(job,o),id:o.id||`${job.id}:${i}`}))};
  if(!batch.options.length)throw Error('图片历史需要可读取的图片结果');
  if(!existing)history.unshift(batch);
  return {...primaryPatch(node,batch,batch.options[0],config),imageHistory:history};
}
export function flattened(node){return batches(node).flatMap(b=>b.options.map(o=>({...primaryPatch(node,b,o),label:node.title})));}
export function keepPrimary(node){
  const history=batches(node),batch=history[selectedBatch(node,history)],item=batch?.options.find(o=>o.id===node.currentImageOptionId)||batch?.options.find(o=>src(o)===src(node));
  const current=item||option({image:src(node),width:node.pixelWidth,height:node.pixelHeight});
  return {imageHistory:current?[{...batch,id:batch?.id||'primary',options:[current]}]:[],versions:current?[current]:[]};
}
