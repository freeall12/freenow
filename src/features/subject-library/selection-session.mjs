// Official sgt/HH: only selection changes roll back; uploads/manual removals survive.
export function restoreOrder(current,removed,originalIds) {
  const result=[...current],rank=new Map(originalIds.map((id,index)=>[id,index]));
  for(const asset of [...removed].sort((a,b)=>(rank.get(a.id)??Infinity)-(rank.get(b.id)??Infinity))){
    if(result.some(item=>item.id===asset.id))continue;
    const at=rank.get(asset.id);
    if(at===undefined){result.push(asset);continue;}
    const next=originalIds.slice(at+1).find(id=>result.some(item=>item.id===id));
    if(next){result.splice(result.findIndex(item=>item.id===next),0,asset);continue;}
    const previous=originalIds.slice(0,at).reverse().find(id=>result.some(item=>item.id===id));
    result.splice(previous?result.findIndex(item=>item.id===previous)+1:result.length,0,asset);
  }
  return result;
}

export function selectionSession({getAssets:readAssets,setAssets:writeAssets,sourceId,toAsset}) {
  let batchAssets=null,batchChanged=false;
  const getAssets=()=>batchAssets??readAssets();
  const setAssets=assets=>{if(batchAssets){batchAssets=assets;batchChanged=true;}else writeAssets(assets);};
  const order=getAssets().map(asset=>asset.id),added=new Set(),removed=new Map(),manual=new Set();
  const selected=new Set(getAssets().map(sourceId).filter(Boolean));let closed=false;
  function toggle(node){
    if(closed)return;
    const assets=getAssets();
    if(selected.has(node.id)){
      const matches=assets.filter(asset=>sourceId(asset)===node.id),ids=new Set(matches.map(asset=>asset.id));
      for(const asset of matches)if(!added.delete(asset.id))removed.set(asset.id,asset);
      selected.delete(node.id);setAssets(assets.filter(asset=>!ids.has(asset.id)));return;
    }
    const restoring=[...removed.values()].filter(asset=>sourceId(asset)===node.id);
    if(restoring.length){
      for(const asset of restoring)removed.delete(asset.id);
      selected.add(node.id);setAssets(restoreOrder(assets,restoring,order));return;
    }
    const asset=toAsset(node);if(!asset)return;
    const duplicate=assets.some(item=>item.id===asset.id||sourceId(item)===node.id||(asset.url&&item.url===asset.url&&item.type===asset.type));
    if(!duplicate){if(!manual.delete(asset.id))added.add(asset.id);selected.add(node.id);setAssets([...assets,asset]);}
    else if(assets.some(item=>sourceId(item)===node.id))selected.add(node.id);
  }
  function addMany(nodes){
    if(closed)return;
    const ownsBatch=batchAssets===null;
    if(ownsBatch)batchAssets=readAssets();
    try{for(const node of nodes)if(!selected.has(node.id))toggle(node);}
    finally{
      if(ownsBatch){
        const assets=batchAssets,changed=batchChanged;batchAssets=null;batchChanged=false;
        // Keep each toggle's duplicate/restoration rules while publishing only
        // the final list, so a marquee does not rebuild the editor per hit.
        if(changed)writeAssets(assets);
      }
    }
  }
  return {selected,toggle,addMany,
    remove(asset){added.delete(asset.id);manual.add(asset.id);const nodeId=sourceId(asset);if(nodeId&&!getAssets().some(item=>sourceId(item)===nodeId))selected.delete(nodeId);},
    finish(commit){if(closed)return;closed=true;if(!commit)setAssets(restoreOrder(getAssets().filter(asset=>!added.has(asset.id)),removed.values(),order));added.clear();removed.clear();manual.clear();}
  };
}
