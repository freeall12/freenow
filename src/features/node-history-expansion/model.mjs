import * as images from '../../../image-history-core.mjs';
import * as videos from '../video-history/core.mjs';

const clone=value=>structuredClone(value);
const media=(node,item)=>node.type==='video'?item?.video||item?.url:item?.fullImage||item?.image||item?.url;

export function historyBatches(node,legacy=[]){
  if(!['image','video'].includes(node.type))throw Error('仅图片和视频节点支持应用历史');
  const core=node.type==='image'?images:videos;
  const stored=node.type==='image'||node.videoHistory?.length?core.batches(node):[];
  if(stored.length)return stored;
  // Legacy history has one row and deduplicates the current source, as Bat does.
  const seen=new Set(),current=node.type==='video'?{video:node.video,poster:node.image,width:node.videoMetadata?.width,height:node.videoMetadata?.height,duration:node.videoMetadata?.duration}:{image:node.fullImage||node.image,width:node.pixelWidth,height:node.pixelHeight};
  const options=[current,...legacy].map((value,index)=>core.option(typeof value==='string'?{[node.type]:value}:value,index)).filter(item=>item&&!seen.has(media(node,item))&&seen.add(media(node,item)));
  return options.length>1?[{id:'legacy',prompt:node.generation?.prompt||'',parameters:clone(node.generation||{}),toolParameters:clone(node.params||null),options}]:[];
}

export function expandHistory(node,batches,{id=()=>crypto.randomUUID()}={}){
  const core=node.type==='image'?images:videos;
  const group={id:id(),type:'group',title:node.title||'历史',x:node.x+node.width+200,y:node.y,width:160,height:160,color:'#3A3A3A'},children=[];
  let y=80;
  for(const [batchIndex,batch]of batches.entries()){
    let x=80,height=0;
    for(const [optionIndex,item]of batch.options.entries()){
      if(!media(node,item))continue;
      const config={...clone(node.generation||{}),...clone(batch.parameters||{})};
      // Uat constructs a fresh generation node: editor documents and task identities
      // belong to the source and must never hitchhike on an expanded historical output.
      const child={type:node.type,params:clone(node.params||{}),...core.primaryPatch(node,batch,item,config),id:id(),parentId:group.id,x:group.x+x,y:group.y+y,title:`${node.title||node.type} ${batchIndex+1}-${optionIndex+1}`,imageHistory:[],videoHistory:[],versions:[],...(item.sourceRange?{sourceRange:clone(item.sourceRange)}:{})};
      if(![child.width,child.height].every(value=>Number.isFinite(value)&&value>0))throw Error('历史结果尺寸无效');
      children.push(child);x+=child.width+56;height=Math.max(height,child.height);
    }
    if(height){group.width=Math.max(group.width,x-56+80);y+=height+72;}
  }
  if(!children.length)throw Error('无可应用历史');
  group.height=y-72+80;
  return {group,nodes:[group,...children],edges:[]};
}
