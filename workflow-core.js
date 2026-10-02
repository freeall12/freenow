/* Layered scheduling follows the captured TapNow workflow. Coordinates never enter task ownership. */
(function(root){
 'use strict';
 function plan(nodes,edges,isExecutable){
  const byId=new Map(nodes.map(n=>[n.id,n]));if(byId.size!==nodes.length)throw Error('节点 ID 重复');
  const incoming=new Map(nodes.map(n=>[n.id,new Set()])),outgoing=new Map(nodes.map(n=>[n.id,new Set()]));
  for(const e of edges)if(byId.has(e.source)&&byId.has(e.target)){incoming.get(e.target).add(e.source);outgoing.get(e.source).add(e.target);}
  const remaining=new Set(byId.keys()),layers=[];
  while(remaining.size){const layer=[...remaining].filter(id=>!incoming.get(id).size);if(!layer.length)throw Error('工作流存在循环依赖，请检查节点连线');layers.push(layer);for(const id of layer){remaining.delete(id);for(const target of outgoing.get(id))incoming.get(target).delete(id);}}
  const executable=nodes.filter(isExecutable).map(n=>n.id);if(!executable.length)throw Error('分组中没有可执行的生成节点');return {layers,executable};
 }
 class Execution {
  constructor(plan,{execute,onChange=()=>{}}){this.plan=plan;this.execute=execute;this.onChange=onChange;this.status='ready';this.layer=0;this.completed=[];this.errors=[];this.stopping=false;}
  publish(){this.onChange({status:this.status,layer:this.layer,total:this.plan.layers.length,completed:[...this.completed],errors:[...this.errors]});}
  stop(){if(this.status!=='running')return;this.stopping=true;this.status='stopping';this.publish();}
  async run(){if(this.status!=='ready')throw Error('工作流已启动');this.status='running';this.publish();const enabled=new Set(this.plan.executable);
   for(const layer of this.plan.layers){if(this.stopping)break;this.layer++;this.publish();const ids=layer.filter(id=>enabled.has(id));const results=await Promise.allSettled(ids.map(id=>Promise.resolve().then(()=>this.execute(id))));for(let i=0;i<results.length;i++){const r=results[i];if(r.status==='fulfilled')this.completed.push(ids[i]);else this.errors.push({id:ids[i],message:r.reason?.message||String(r.reason)});}this.publish();if(this.errors.length)break;}
   this.status=this.errors.length?'failed':this.stopping?'stopped':'succeeded';this.publish();return this;
  }
 }
 const api={plan,Execution};if(typeof module!=='undefined')module.exports=api;else root.WorkflowCore=api;
})(typeof window!=='undefined'?window:globalThis);
