export function createImporter({app,prepare,persist,position}) {
  let pending = null;
  const finishPending=async()=>{await persist();const graph=pending.graph;pending=null;return graph;};
  const apply=async function apply(rows) {
    const signature=rows.map(row=>row.id).sort().join('|');
    if (pending) { if(pending.signature!==signature)throw Error('上一批历史素材已插入但尚未保存，请先重试保存');return finishPending(); }
    if (!rows.length) throw Error('请先选择历史素材');
    const nodes = await Promise.all(rows.map(prepare));
    const columns=Math.min(4,Math.ceil(Math.sqrt(nodes.length))), gap=40;
    const columnWidth=Math.max(...nodes.map(node=>node.width))+gap, rowHeight=Math.max(...nodes.map(node=>node.height))+gap;
    nodes.forEach((node,index)=>Object.assign(node,{id:'history-import-'+index,x:(index%columns)*columnWidth,y:Math.floor(index/columns)*rowHeight}));
    const point=position(); pending={signature,graph:app.pasteGraph({nodes,edges:[]},point)};
    return finishPending();
  };
  Object.defineProperty(apply,'pending',{get:()=>!!pending});
  apply.retrySave=()=>pending?finishPending():Promise.resolve(null);
  return apply;
}
