// These controls retrieve existing tasks; only explicit apply clicks change the graph.
export function appendRecoveryActions(root,trace,{onError=()=>{}}={}){
  const entries=trace.batchItems||[trace];
  for(const [index,item] of entries.entries()){
    const id=item.result?.taskId,job=item.generationJob;
    if(!id||!job||!window.GenerationAPI?.recover)continue;
    const query=job.status==='unknown',apply=job.recovered&&job.status==='succeeded'&&!job.applied&&!job.applying;
    const cleanup=job.recovered&&job.hasResultPlan&&['failed','cancelled','configuration_required'].includes(job.status);
    if(!query&&!apply&&!cleanup)continue;
    const footer=document.createElement('footer');footer.className='generation-confirm-footer';
    if(entries.length>1){const label=document.createElement('span');label.textContent=`第 ${index+1} 项`;footer.append(label);}
    const add=(label,action)=>{const button=document.createElement('button');button.type='button';button.className='generation-small-button';button.textContent=label;button.onclick=async()=>{for(const b of footer.querySelectorAll('button'))b.disabled=true;try{await action();}catch(error){onError(error);}finally{for(const b of footer.querySelectorAll('button'))b.disabled=false;}};footer.append(button);};
    if(cleanup)add('清理原占位',()=>window.GenerationAPI.cancel(id));
    if(query)add(job.providerStatus==='succeeded'?'重新取回素材':'查询恢复',()=>window.GenerationAPI.recover(id));
    if(apply){if(job.hasResultPlan)add('恢复到原占位',()=>window.GenerationAPI.applyRecovered(id,'existing'));add('作为新节点取回',()=>window.GenerationAPI.applyRecovered(id,'new_nodes'));}
    root.append(footer);
  }
}
