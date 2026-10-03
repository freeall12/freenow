const labels={pending:'尚未提交',submitted:'原任务待查询',unknown:'状态待确认',failed:'执行失败',applying:'结果保存待确认',applied:'已完成并保存'};
export function openRecoveryDialog({root,app,host,groupId,run}) {
  const doc=root.document,el=(tag,text)=>{const node=doc.createElement(tag);if(text!==undefined)node.textContent=text;return node;};
  const dialog=el('dialog');dialog.className='workflow-confirm workflow-recovery api-dialog';dialog.setAttribute('aria-label','恢复分组执行');
  const heading=el('h2','恢复分组执行'),description=el('p','已提交的任务使用原任务记录查询。尚未提交的层需要明确继续。'),list=el('ol'),status=el('p'),actions=el('div');list.className='workflow-recovery-list';status.className='workflow-recovery-status';status.setAttribute('role','status');actions.className='workflow-actions';
  const close=el('button','关闭'),query=el('button','查询原任务'),resume=el('button','继续未发层'),stop=el('button','停止后续层'),restart=el('button','重新运行整组');resume.className='solid-button';restart.className='workflow-restart';close.onclick=()=>dialog.close();
  let busy=false,message='',snapshot=run;
  function render(){snapshot=host.snapshot(run.runId)||snapshot;list.replaceChildren();for(const [index,layer]of snapshot.plan.layers.entries())for(const id of layer){const task=snapshot.tasks[id];if(!task)continue;const node=app.getState().nodes.find(node=>node.id===id),row=el('li');row.dataset.nodeId=id;row.dataset.state=task.state;row.append(el('strong',`第 ${index+1} 层 · ${node?.title||id}`),el('span',labels[task.state]));if(task.taskId)row.append(el('code',task.taskId));if(task.error)row.append(el('p',task.error));list.append(row);}
    const allowed=host.continuation(groupId);status.textContent=message||host.error||allowed.reason||(snapshot.stopping?'工作流已停止，已启动的任务继续完成。':'原任务已确认，可以继续尚未提交的层。');
    query.disabled=busy||!host.writable||!Object.values(snapshot.tasks).some(task=>['submitted','unknown','applying'].includes(task.state));resume.disabled=busy||!host.writable||!allowed.ok;stop.disabled=busy||!host.writable||snapshot.stopping;restart.disabled=busy||!host.writable||!host.canRestart(groupId);restart.hidden=!host.canRestart(groupId);
    dialog.setAttribute('aria-busy',String(busy));
  }
  async function act(operation){if(busy)return;busy=true;message='';render();try{await operation();message='原任务记录已核对。';}catch(error){message=error.message;}finally{busy=false;render();}}
  query.onclick=()=>act(()=>host.query(groupId));stop.onclick=()=>act(()=>host.stop(groupId));
  resume.onclick=()=>act(async()=>{const execution=await host.continue(groupId);dialog.close();await execution.completion;app.notify(execution.status==='succeeded'?'分组执行完成':execution.status==='stopped'?'已停止后续层':execution.errors.map(error=>error.message).join('；'));});
  restart.onclick=()=>act(async()=>{const execution=await host.restart(groupId);dialog.close();await execution.completion;app.notify(execution.status==='succeeded'?'分组执行完成':execution.errors.map(error=>error.message).join('；'));});
  const changed=event=>{if(event.detail.groupId===groupId&&dialog.isConnected)render();};doc.addEventListener('workflow:change',changed);
  const previousFocus=doc.activeElement;
  actions.append(close,stop,query,resume);dialog.append(heading,description,list,status,actions,restart);doc.body.append(dialog);dialog.onclose=()=>{doc.removeEventListener('workflow:change',changed);dialog.remove();if(previousFocus?.isConnected)previousFocus.focus();};render();dialog.showModal();(query.disabled?resume.disabled?close:resume:query).focus();return dialog;
}
