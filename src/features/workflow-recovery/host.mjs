import {createWorkflowJournal, readWorkflowRuns, fingerprint} from './journal.mjs';
import {nodeVersion, groupMembers, readContext, contextMatches} from './context.mjs';

export function createWorkflowHost({root, app, prepare, config}) {
  const projectId=root.CanvasProjectContext.resolve().id, runs=new Map(), querying=new Set();
  let snapshots=[],readError=null,closed=false;
  const current=()=>!closed && root.CanvasProjectContext.resolve().id===projectId;
  const journal=createWorkflowJournal({store:root.CanvasStore,projectId,isCurrent:current,locks:root.navigator.locks});
  const refresh=()=>{if(journal.writable)snapshots=journal.list();};
  const notify=(groupId,state={})=>{refresh();root.document.dispatchEvent(new root.CustomEvent('workflow:change',{detail:{groupId,...state}}));app.render();};
  const structuralGuard=run=>()=>{
    if(!current())throw Error('工作流项目已变化');
    const members=groupMembers(app.getState(),run.groupId,root.CanvasPiles).map(node=>node.id).sort();
    if(JSON.stringify(members)!==JSON.stringify([...run.members].sort()))throw Error('分组成员已更改，旧工作流未继续');
  };
  const context=run=>()=>readContext({state:app.getState(),projectId,groupId:run.groupId,trackedIds:Object.keys(run.versions),config,piles:root.CanvasPiles});
  const identity=(runId,groupId,nodeId)=>({version:1,projectId,runId,groupId,nodeId});
  const active=(runId,{dispatch=false,execution,nodeId,taskId}={})=>{
    if(!journal.writable)throw Error(journal.persistenceError?.message||readError?.message||'另一页面正在执行或恢复此项目');
    const run=journal.get(runId),registered=taskId&&run.tasks[nodeId]?.taskId===taskId;
    if(dispatch&&!registered&&(execution?.stopping||run.stopping))throw Error('工作流已停止，新任务未发送');
    journal.assertActive?.(runId,{dispatch,nodeId,taskId});
  };
  const targetAdapter=(runId,nodeId,target,{recovery=false}={})=>{
    const run=journal.get(runId),structural=structuralGuard(run);
    return {...target,guard(){active(runId);structural();target.guard();},
      async beforeApply(proposedNode,job){
        active(runId);structural();target.guard();
        const resultVersion=await fingerprint(job.outputs);active(runId);target.guard();
        proposedNode.workflowRecoveryResult={...identity(runId,run.groupId,nodeId),taskId:job.id,resultVersion};
        const state=app.getState(),beforeVersion=nodeVersion(state.nodes.find(node=>node.id===nodeId),state.edges,config),afterVersion=nodeVersion(proposedNode,state.edges,config);
        const receipt={taskId:job.id,beforeVersion,afterVersion,resultVersion,proposedNode:structuredClone(proposedNode),createdAt:journal.get(runId).tasks[nodeId].createdAt};
        await journal.preparingApplication(runId,nodeId,receipt,()=>{active(runId);structural();target.guard();});
        notify(run.groupId);return receipt;
      },
      async onApplied(job,receipt){
        active(runId);structural();target.guard();
        if(!receipt||receipt.taskId!==job.id)throw Error('结果保存收据缺失');
        if(!recovery)await journal.applied(runId,nodeId,receipt,()=>{active(runId);structural();target.guard();});
        notify(run.groupId);
      }
    };
  };
  const adapter=(runId,groupId,execution)=>({
    identity:nodeId=>identity(runId,groupId,nodeId),
    async run(request,target){
      const nodeId=request.nodeId;let taskId;
      const dispatch=()=>{active(runId,{dispatch:true,execution,nodeId,taskId});target.guard();};
      dispatch();
      try{return await root.GenerationAPI.runInPlace(request,{...targetAdapter(runId,nodeId,target),dispatchGuard:dispatch},{
        onSubmitted:job=>{taskId=job.id;return journal.submitted(runId,nodeId,job,dispatch).then(()=>notify(groupId));},
        onPrepared:job=>journal.prepared(runId,nodeId,job,dispatch).then(()=>notify(groupId))
      });}catch(error){
        const task=journal.get(runId).tasks[nodeId];
        if(task.taskId&&task.state!=='applied'&&journal.writable){const job=root.GenerationAPI.getJobs().find(job=>job.id===task.taskId);await journal.settled(runId,nodeId,job?.status||'unknown',error.message,()=>active(runId));notify(groupId);}
        throw error;
      }
    }
  });
  function startExecution(groupId,prepared,{existing,onChange}={}) {
    if(api.isRunning(groupId)||[...runs.values()].some(run=>['running','stopping'].includes(run.status))||querying.size)throw Error('分组正在执行或查询，请等待完成');
    if(!journal.writable)throw Error(api.error||'当前页面没有分组执行权限');
    if(!root.GenerationAPI.isConfigured())throw Error('尚未配置生成服务，请先连接 API');
    const runId=existing?.runId||root.crypto.randomUUID();
    const plan=existing?{layers:existing.plan.layers.slice(journal.canContinue(runId,prepared.context()).nextLayer),executable:existing.plan.executable.filter(id=>existing.tasks[id].state==='pending')}:prepared.plan;
    let execution;
    const gate=(async()=>{await api.ready;prepared.guard();await app.saveProject();prepared.guard();
      if(existing)await journal.claim(runId,prepared.guard);
      else await journal.create({runId,groupId,plan:prepared.plan,members:prepared.members,versions:prepared.versions},prepared.guard);
      if(execution.stopping)await journal.stop(runId,prepared.guard);
      notify(groupId);})();
    gate.catch(()=>{});
    execution=new root.WorkflowCore.Execution(plan,{execute:async id=>{await gate;return prepared.execute(id,adapter(runId,groupId,execution));},onChange:state=>{notify(groupId,state);onChange?.(state);}});
    execution.runId=runId;execution.journalReady=gate;runs.set(groupId,execution);
    execution.completion=execution.run();execution.completion.catch(()=>{});return execution;
  }
  const api={
    get writable(){return journal.writable;},get error(){return journal.persistenceError?.message||readError?.message||null;},
    getRun(groupId){const execution=runs.get(groupId);if(execution)return execution;refresh();const run=api.recovery(groupId)||[...snapshots].reverse().find(run=>run.groupId===groupId);return run?{runId:run.runId,status:Object.values(run.tasks).every(task=>task.state==='applied')?'succeeded':'recoverable',plan:run.plan,layer:run.plan.layers.filter(layer=>layer.every(id=>!run.tasks[id]||run.tasks[id].state==='applied')).length,completed:Object.values(run.tasks).filter(task=>task.state==='applied').map(task=>task.nodeId),errors:Object.values(run.tasks).filter(task=>task.error).map(task=>({id:task.nodeId,message:task.error}))}:null;},
    recovery(groupId){refresh();return [...snapshots].reverse().find(run=>run.groupId===groupId&&Object.values(run.tasks).some(task=>task.state!=='applied'))||null;},
    snapshot(runId){refresh();const run=snapshots.find(run=>run.runId===runId);return run?structuredClone(run):null;},
    isRunning(groupId){return querying.has(groupId)||['running','stopping'].includes(runs.get(groupId)?.status);},
    start(groupId,onChange){return startExecution(groupId,prepare(groupId),{onChange});},
    continuation(groupId){const run=api.recovery(groupId);if(!run)return {ok:false,reason:'工作流已完成'};try{return journal.canContinue(run.runId,context(run)());}catch(error){return {ok:false,reason:error.message};}},
    canRestart(groupId){const run=api.recovery(groupId);return !!run&&Object.values(run.tasks).every(task=>['pending','applied','failed'].includes(task.state));},
    async continue(groupId){await api.ready;const run=api.recovery(groupId);if(!run)throw Error('没有待恢复的执行');const allowed=api.continuation(groupId);if(!allowed.ok)throw Error(allowed.reason);return startExecution(groupId,prepare(groupId),{existing:run});},
    async restart(groupId){await api.ready;if(!api.canRestart(groupId))throw Error('原任务状态尚待确认，请先查询恢复');const run=api.recovery(groupId);await journal.claim(run.runId,structuralGuard(run));await journal.stop(run.runId,structuralGuard(run));notify(groupId);return api.start(groupId);},
    async stop(groupId){const execution=runs.get(groupId);execution?.stop();await api.ready;
      if(execution)await execution.journalReady;const run=execution?journal.get(execution.runId):api.recovery(groupId);if(!run)return;
      await journal.claim(run.runId,structuralGuard(run));await journal.stop(run.runId,structuralGuard(run));notify(groupId,{status:execution?.status||'stopped'});
    },
    async query(groupId){await api.ready;if(api.isRunning(groupId))throw Error('分组正在执行或查询');const run=api.recovery(groupId);if(!run)throw Error('没有待恢复的原任务');
      const guard=structuralGuard(run);await journal.claim(run.runId,guard);querying.add(groupId);notify(groupId,{status:'running'});
      let recoveredPrepared;
      try{return await journal.reconcile(run.runId,{context:context(run),guard,query:id=>root.GenerationAPI.recover(id),
        apply:async(job,{node,application,resultVersion})=>{
          const state=app.getState(),currentNode=state.nodes.find(value=>value.id===node.nodeId);
          if(application&&nodeVersion(currentNode,state.edges,config)===application.afterVersion){
            const marker={...identity(run.runId,groupId,node.nodeId),taskId:job.id,resultVersion};
            if(JSON.stringify(currentNode.workflowRecoveryResult)!==JSON.stringify(marker))throw Error('已保存结果缺少原任务归属标记');
            if(typeof root.GenerationAPI.validateWorkflowProposal!=='function')throw Error('原位媒体验证入口尚未准备好');
            await root.GenerationAPI.validateWorkflowProposal(currentNode);
            const captured=context(run)(),proof=()=>{active(run.runId);guard();if(!contextMatches(captured,context(run)()))throw Error('结果或参考来源在保存期间变化');};
            proof();const graph=app.getState();
            await root.CanvasStore.save({version:1,nodes:graph.nodes,edges:graph.edges},projectId,{beforeCommit:()=>{proof();return true;}});
            await root.CanvasStore.flush();proof();
            return {taskId:job.id,...application};
          }
          const prepared=recoveredPrepared||(recoveredPrepared=prepare(groupId)),target=targetAdapter(run.runId,node.nodeId,prepared.targetFor(node.nodeId,job.request),{recovery:true});
          target.originalCreatedAt=node.createdAt;
          if(application?.proposedNode)target.restoredProposal={...structuredClone(application),taskId:job.id};
          const recovered=await root.GenerationAPI.recoverInPlace(job.id,target,{async verifyRequest(request,original){
            const expected=identity(run.runId,groupId,node.nodeId),binding=request.parameters?.workflowRecovery;
            if(original.id!==node.taskId||request.nodeId!==node.nodeId||request.kind!==node.kind||request.workflowId!==groupId||!binding||Object.keys(binding).length!==Object.keys(expected).length||Object.entries(expected).some(([key,value])=>binding[key]!==value)||await fingerprint(request)!==node.transportRequestVersion)throw Error('原任务身份或请求版本不符');return true;
          }});
          return recovered.workflowApplicationReceipt;
        }});
      }finally{querying.delete(groupId);notify(groupId);}
    },
    close(){closed=true;journal.close();}
  };
  api.ready=(async()=>{try{snapshots=await journal.open();}catch(error){readError=error;snapshots=await readWorkflowRuns(root.CanvasStore,projectId);}notify(null);return api;})();
  root.addEventListener('pagehide',api.close,{once:true});
  root.CanvasProjects?.registerNavigationGuard(async()=>{if([...runs.values()].some(run=>['running','stopping'].includes(run.status))||querying.size)return '分组正在执行或查询，请等待已启动的任务结束';try{await journal.flush();return null;}catch(error){return '分组执行记录尚未保存：'+error.message;}});
  return api;
}
