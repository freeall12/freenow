const signature=node=>JSON.stringify(Object.fromEntries(Object.entries(node).filter(([key])=>!['x','y','selected'].includes(key))));

// Retain the exact inserted nodes across a save failure. Application retries
// save those nodes again; they never create another graph or provider task.
export function createExtensionApplication({app,store,sourceId,projectId,settings,guard}){
  let receipt;
  const current=()=>{
    guard();if(app.projectIdentity().id!==projectId)throw Error('延长结果所属画布已切换，未重复写入');
    if(!receipt)return;
    const {nodes,edges}=app.getState();
    if(receipt.results.length!==1||receipt.results[0].node.type!=='video'||!receipt.edges.length)throw Error('延长结果节点或连线不完整，未重复创建');
    for(const result of receipt.results)if(!nodes.includes(result.node)||signature(result.node)!==result.signature)throw Error('延长结果已修改或移除，未重复创建');
    for(const edge of receipt.edges)if(!edges.includes(edge.node)||JSON.stringify(edge.node)!==edge.signature)throw Error('延长结果连线已修改或移除，未重复创建');
  };
  return async output=>{
    current();
    if(!receipt){
      const prepend=settings.direction==='片头延长',created=app.createConnected(sourceId,[{...output,video:output.video||output.url,image:output.poster,title:output.title||settings.direction}],{side:prepend?'left':'right',reverse:prepend});
      receipt={results:created.map(node=>({node,signature:signature(node)})),edges:app.getState().edges.filter(edge=>created.some(node=>edge.source===node.id||edge.target===node.id)).map(node=>({node,signature:JSON.stringify(node)}))};
      if(created.length!==1||created[0].type!=='video')throw Error('延长结果节点不完整，未重复创建');
    }
    current();const state=app.getState();
    await store.save({version:1,nodes:state.nodes,edges:state.edges},projectId,{beforeCommit:()=>{current();return true;}});
    await store.flush();current();return receipt.results.map(result=>result.node);
  };
}
