(() => {
 'use strict';
 const app=window.CanvasApp;let host,helpers;const ready=Promise.all([import('./src/features/workflow-recovery/context.mjs'),import('./src/features/workflow-recovery/host.mjs')]).then(async([context,runtime])=>{helpers=context;host=runtime.createWorkflowHost({root:window,app,prepare,config});await host.ready;return host;});ready.catch(error=>app.notify('分组恢复记录读取失败：'+error.message));const el=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;};
 const config=n=>n.type==='text'?window.CanvasText.config(n):n.type==='audio'?window.AudioCore.transition(n.audioConfig||{}):window.NodeEditor.getConfig(n);
 const executable=n=>!n.tool&&(n.type==='audio'?n.audioMode!=='upload':['image','video'].includes(n.type)?!!(n.generation||window.EDITOR_DATA?.nodes[n.id]||/generation|生成/i.test(n.title)||!(n.image||n.video)):n.type==='text'&&window.CanvasText.mode(n)==='generate');
 function ref(n){return {id:n.id,type:n.type,url:n.type==='video'?(n.video||window.EDITOR_DATA?.nodes[n.id]?.video):n.type==='audio'?n.audio:n.fullImage||n.image,text:n.content,title:n.title};}
 function signature(n,edges){if(!helpers)throw Error('分组恢复记录正在读取，请稍后重试');return helpers.nodeVersion(n,edges,config);}
 function prepare(groupId){
  const state=app.getState(),group=state.nodes.find(n=>n.id===groupId&&n.type==='group');if(!group)throw Error('分组已不存在');
  const nodes=state.nodes.filter(n=>n.parentId===groupId&&n.type!=='pile'&&!window.CanvasPiles.index(state.nodes).owner.has(n.id)),ids=new Set(nodes.map(n=>n.id)),edges=state.edges.filter(e=>ids.has(e.source)&&ids.has(e.target));
  // Explicit reference IDs have the same ordering requirement as visible edges.
  for(const n of nodes){const cfg=config(n);for(const r of [...(cfg.references||cfg.refs||[]),...(cfg.referenceIds||[]).map(id=>({id})),...(cfg.referenceBindings||[]).filter(Boolean).map(id=>({id}))]){const id=typeof r==='object'?r.id:null;if(id&&ids.has(id)&&!edges.some(e=>e.source===id&&e.target===n.id))edges.push({source:id,target:n.id});}}
  const plan=window.WorkflowCore.plan(nodes,edges,executable),enabled=new Set(plan.executable);
  const tracked=new Map(nodes.map(n=>[n.id,signature(n,state.edges)]));
  const refSpecs=new Map();
  function references(n){if(refSpecs.has(n.id))return refSpecs.get(n.id);const cfg=config(n),refs=[...(cfg.references||cfg.refs||[]),...(cfg.referenceIds||[]).map(id=>({id}))],incoming=state.edges.filter(e=>e.target===n.id).map(e=>e.source),ordered=[];
   for(const [index,value] of refs.entries()){if(typeof value==='string'){const bound=cfg.referenceBindings?.[index];if(bound){ordered.push({id:bound});continue;}const source=incoming.map(id=>state.nodes.find(n=>n.id===id)).find(n=>n&&(ref(n).url===value||n.image===value));ordered.push(source?{id:source.id}:{url:value});}else if(value?.id)ordered.push({id:value.id});}
   for(const id of incoming)if(!ordered.some(r=>r.id===id))ordered.push({id});const result={sources:[...new Set(ordered.filter(r=>r.id).map(r=>r.id))],urls:ordered.filter(r=>r.url).map(r=>r.url),ordered};refSpecs.set(n.id,result);return result;
  }
  for(const n of nodes.filter(n=>enabled.has(n.id))){const cfg=config(n),{sources,urls}=references(n),refs=sources.map(id=>{const source=state.nodes.find(n=>n.id===id);if(!source)throw Error('参考节点已不存在');tracked.set(id,signature(source,state.edges));if(!enabled.has(id)&&!ref(source).url&&!ref(source).text)throw Error(source.title+'：参考节点没有内容');return ref(source);});
   if(!cfg.model)throw Error(n.title+'：请选择模型');
   if(!cfg.prompt?.trim()&&!refs.some(r=>r.text||r.url||enabled.has(r.id))&&!urls.length)throw Error(n.title+'：缺少提示词或参考素材');
   if(n.type==='text')window.CanvasText.validateInputs(cfg,refs,enabled);
   if(n.type==='audio'){const validationRefs=refs.map(r=>enabled.has(r.id)&&r.type==='text'?{...r,text:'待生成文本'}:r);window.AudioCore.validate(cfg,validationRefs);}
  }
  const membership=nodes.map(n=>n.id).sort().join('|');
  function guard(){const current=app.getState();if(!current.nodes.some(n=>n.id===groupId&&n.type==='group')||current.nodes.filter(n=>n.parentId===groupId&&n.type!=='pile'&&!window.CanvasPiles.index(current.nodes).owner.has(n.id)).map(n=>n.id).sort().join('|')!==membership)throw Error('分组成员已更改，请重新执行');for(const [id,value]of tracked){const n=current.nodes.find(n=>n.id===id);if(!n||signature(n,current.edges)!==value)throw Error('节点或参考内容已更改，请重新执行');}}
  async function execute(id,durable){guard();let n=app.getState().nodes.find(n=>n.id===id),request;
   if(n.type==='text')request=await window.TextAPI.buildRequest(id,{count:1});
   else if(n.type==='audio')request=await window.AudioAPI.buildRequest(id);
   else{const cfg=config(n),{ordered}=references(n),current=app.getState();const {orderInputs}=await import('./src/features/node-composer/reference-model.mjs');const {projectGenerationPrompt}=await import('./src/features/node-composer/prompt-state.mjs');const {libraryPolicy}=await import('./src/features/node-composer/library-mentions.mjs');const policy=libraryPolicy(n.type,cfg.model,cfg.mode);const inputs=orderInputs(cfg,ordered.map(r=>r.id?ref(current.nodes.find(n=>n.id===r.id)):{type:'image',url:r.url}));for(const input of inputs)if(!input.url&&!input.text)throw Error('上游节点未返回有效内容');request={kind:n.type+'.generate',label:n.title,nodeId:id,...projectGenerationPrompt(cfg.prompt,inputs,policy.enabled?policy.allowed:[]),parameters:{...structuredClone(cfg),refs:inputs.filter(r=>r.url).map(r=>r.url),count:1}};}
   request.parameters={...request.parameters,count:1,...(durable?{workflowRecovery:durable.identity(id)}:{})};request.workflowId=groupId;guard();
   const target=targetFor(id,request);
   const job=await durable.run(request,target);return job;

  }
  function targetFor(id,request){const n=app.getState().nodes.find(n=>n.id===id);if(!n)throw Error('原节点已不存在');return {guard,type:n.type,patch:['image','video'].includes(n.type)?{generation:{...config(n),refs:(request.inputs||[]).filter(r=>r.type==='image').map(r=>r.url),referenceBindings:(request.inputs||[]).filter(r=>r.type==='image').map(r=>r.id||null)}}:{},didApply:()=>{const current=app.getState();tracked.set(id,signature(current.nodes.find(n=>n.id===id),current.edges));}};}
  const context=()=>helpers.readContext({state:app.getState(),projectId:window.CanvasProjectContext.resolve().id,groupId,trackedIds:[...tracked.keys()],config,piles:window.CanvasPiles});
  return {plan,execute,guard,targetFor,context,members:nodes.map(n=>n.id).sort(),versions:Object.fromEntries(tracked)};
 }
 function isRunning(id){return host?.isRunning(id)||false;}
 function start(groupId,onChange){if(!host)throw Error('分组恢复记录正在读取，请稍后重试');return host.start(groupId,onChange);}
 async function run(groupId,onChange){await ready;const execution=start(groupId,onChange);await execution.completion;return execution;}
 async function open(groupId){
  try{await ready;if(isRunning(groupId)){await host.stop(groupId);return;}const recovery=host.recovery(groupId);if(recovery){await import('./src/features/workflow-recovery/dialog.mjs').then(({openRecoveryDialog})=>openRecoveryDialog({root:window,app,host,groupId,run:recovery}));return;}
  const d=el('dialog');d.className='workflow-confirm api-dialog';d.setAttribute('aria-label','执行分组');const heading=el('h2','运行整组？'),cost=el('p','本次执行暂时无法预估花费。'),status=el('p'),actions=el('div');actions.className='workflow-actions';const cancel=el('button','取消'),startButton=el('button','确认');cancel.onclick=()=>d.close();startButton.className='solid-button';
  let prepared;try{prepared=prepare(groupId);status.textContent=`${prepared.plan.executable.length} 个生成节点 · ${prepared.plan.layers.length} 层依赖`;if(!host.writable)throw Error(host.error||'另一窗口正在使用此项目，当前只能查看恢复记录');}catch(e){status.textContent=e.message;startButton.disabled=true;}
  if(!window.GenerationAPI.isConfigured()){const connect=el('button','连接 API');connect.onclick=()=>{d.close();window.GenerationAPI.configure();};actions.append(connect);status.textContent+=' · 尚未连接生成服务';startButton.disabled=true;}
  startButton.onclick=async()=>{try{prepared.guard();d.close();const result=await run(groupId);app.notify(result.status==='succeeded'?'模板执行完成':result.status==='stopped'?'模板已停止，已启动的任务已完成':result.errors.map(e=>e.message).join('；'));}catch(e){app.notify(e.message);}};
  actions.append(cancel,startButton);d.append(heading,cost,status,actions);document.body.append(d);d.onclose=()=>d.remove();d.showModal();
  }catch(error){app.notify(error.message);}
 }
 window.WorkflowAPI={prepare,start,run,open,isRunning,stop:id=>host?.stop(id),getRun:id=>host?.getRun(id),executable,ready,query:id=>ready.then(()=>host.query(id)),continue:id=>ready.then(()=>host.continue(id)),recoverable:id=>host?.recovery(id)};
})();
