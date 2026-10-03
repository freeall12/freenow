const fs=require('node:fs'),vm=require('node:vm'),{performance}=require('node:perf_hooks');
const path=require('node:path'),source=fs.readFileSync(path.join(__dirname,'../../../../canvas-groups.js'),'utf8');
const current=require('../../../../canvas-groups.js');
// Keep the actual grid/Dagre calculation. Only restore the previous coordinate
// application loop to isolate the repeated full-graph traversal being removed.
const legacySource=source.replace(/  \/\/ Layout changes coordinates only\.[\s\S]*?  if\(groupNode\)/,
  '  for(const n of picked){const p=result.get(n.id),dx=origin.x+p.x-n.x,dy=origin.y+p.y-n.y;translate(nodes,positions(nodes,[n.id]),dx,dy);}if(groupNode)');
if(legacySource===source)throw Error('Production layout application loop not found');
const context={module:{exports:{}}};vm.runInNewContext(legacySource,context);const legacy=context.module.exports;
function measure(api,count,runs=3){
  const rows=[];
  for(let run=0;run<runs;run++){
    let idReads=0;
    const nodes=Array.from({length:count},(_,index)=>({get id(){idReads++;return 'n'+index;},type:'image',x:index*31.125,y:-index*20.375,width:320.125,height:180.25})),ids=nodes.map(node=>node.id);
    idReads=0;const start=performance.now();api.layout(nodes,[],ids,'grid');
    rows.push({idReads,elapsedMs:Number((performance.now()-start).toFixed(2))});
  }
  return {count,rows};
}
module.exports={current,legacy,measure};
if(require.main===module)for(const count of [1000,4000])console.log(JSON.stringify({before:measure(legacy,count),after:measure(current,count)}));
