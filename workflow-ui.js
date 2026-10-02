(() => {
 'use strict';
 const app=window.CanvasApp,runs=new Map(),el=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;};
 const config=n=>n.type==='text'?window.CanvasText.config(n):n.type==='audio'?window.AudioCore.transition(n.audioConfig||{}):window.NodeEditor.getConfig(n);
 const executable=n=>!n.tool&&(n.type==='audio'?n.audioMode!=='upload':['image','video'].includes(n.type)?!!(n.generation||window.EDITOR_DATA?.nodes[n.id]||/generation|生成/i.test(n.title)||!(n.image||n.video)):n.type==='text'&&window.CanvasText.mode(n)==='generate');
 function ref(n){return {id:n.id,type:n.type,url:n.type==='video'?(n.video||window.EDITOR_DATA?.nodes[n.id]?.video):n.type==='audio'?n.audio:n.fullImage||n.image,text:n.content,title:n.title};}
 function signature(n,edges){return JSON.stringify({type:n.type,parentId:n.parentId,tool:n.tool,generation:config(n),content:n.content,image:n.image,fullImage:n.fullImage,video:n.video,audio:n.audio,audioMode:n.audioMode,incoming:edges.filter(e=>e.target===n.id).map(e=>e.source).sort()});}
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
  function guard(){const current=app.getState();if(!current.nodes.some(n=>n.id===groupId&&n.type==='group')||current.nodes.filter(n=>n.parentId===groupId&&n.type!=='pile'&&!window.CanvasPiles.index(state.nodes).owner.has(n.id)).map(n=>n.id).sort().join('|')!==membership)throw Error('分组成员已更改，请重新执行');for(const [id,value]of tracked){const n=current.nodes.find(n=>n.id===id);if(!n||signature(n,current.edges)!==value)throw Error('节点或参考内容已更改，请重新执行');}}
  async function execute(id){guard();let n=app.getState().nodes.find(n=>n.id===id),request;
   if(n.type==='text')request=await window.TextAPI.buildRequest(id,{count:1});
   else if(n.type==='audio')request=await window.AudioAPI.buildRequest(id);
   else{const cfg=config(n),{ordered}=references(n),current=app.getState();const {orderInputs}=await import('./src/features/node-composer/reference-model.mjs');const {projectGenerationPrompt}=await import('./src/features/node-composer/prompt-state.mjs');const {libraryPolicy}=await import('./src/features/node-composer/library-mentions.mjs');const policy=libraryPolicy(n.type,cfg.model,cfg.mode);const inputs=orderInputs(cfg,ordered.map(r=>r.id?ref(current.nodes.find(n=>n.id===r.id)):{type:'image',url:r.url}));for(const input of inputs)if(!input.url&&!input.text)throw Error('上游节点未返回有效内容');request={kind:n.type+'.generate',label:n.title,nodeId:id,...projectGenerationPrompt(cfg.prompt,inputs,policy.enabled?policy.allowed:[]),parameters:{...structuredClone(cfg),refs:inputs.filter(r=>r.url).map(r=>r.url),count:1}};}
   request.parameters={...request.parameters,count:1};request.workflowId=groupId;guard();
   // Concurrent siblings may finish in either order. Advance the baseline synchronously with the write.
   let beforeWrite=false;const targetGuard=()=>{guard();if(beforeWrite)throw Error('结果已应用');};
   const job=await window.GenerationAPI.runInPlace(request,{guard:targetGuard,type:n.type,patch:['image','video'].includes(n.type)?{generation:{...config(n),refs:request.inputs.filter(r=>r.type==='image').map(r=>r.url),referenceBindings:request.inputs.filter(r=>r.type==='image').map(r=>r.id||null)}}:{},didApply:()=>{const updated=app.getState().nodes.find(n=>n.id===id);tracked.set(id,signature(updated,app.getState().edges));}});beforeWrite=true;n=app.getState().nodes.find(n=>n.id===id);tracked.set(id,signature(n,app.getState().edges));return job;
  }
  return {plan,execute,guard};
 }
 function isRunning(id){return ['running','stopping'].includes(runs.get(id)?.status);}
 function start(groupId,onChange){if(isRunning(groupId))throw Error('该分组正在执行');if([...runs.values()].some(r=>['running','stopping'].includes(r.status)))throw Error('另一个分组正在执行，请等待完成');const prepared=prepare(groupId);if(!window.GenerationAPI.isConfigured())throw Error('尚未配置生成服务，请先连接 API');const execution=new window.WorkflowCore.Execution(prepared.plan,{execute:prepared.execute,onChange:state=>{document.dispatchEvent(new CustomEvent('workflow:change',{detail:{groupId,...state}}));onChange?.(state);app.render();}});runs.set(groupId,execution);execution.completion=execution.run();return execution;}
 async function run(groupId,onChange){const execution=start(groupId,onChange);await execution.completion;return execution;}
 function open(groupId){
  if(isRunning(groupId)){runs.get(groupId).stop();return;}
  const d=el('dialog');d.className='workflow-confirm api-dialog';d.setAttribute('aria-label','执行分组');const heading=el('h2','运行整组？'),cost=el('p','本次执行暂时无法预估花费。'),status=el('p'),actions=el('div');actions.className='workflow-actions';const cancel=el('button','取消'),start=el('button','确认');cancel.onclick=()=>d.close();start.className='solid-button';
  let prepared;try{prepared=prepare(groupId);status.textContent=`${prepared.plan.executable.length} 个生成节点 · ${prepared.plan.layers.length} 层依赖`;}catch(e){status.textContent=e.message;start.disabled=true;}
  if(!window.GenerationAPI.isConfigured()){const connect=el('button','连接 API');connect.onclick=()=>{d.close();window.GenerationAPI.configure();};actions.append(connect);status.textContent+=' · 尚未连接生成服务';start.disabled=true;}
  start.onclick=async()=>{try{prepared.guard();d.close();const result=await run(groupId);app.notify(result.status==='succeeded'?'模板执行完成':result.status==='stopped'?'模板已停止，已启动的任务已完成':result.errors.map(e=>e.message).join('；'));}catch(e){app.notify(e.message);}};
  actions.append(cancel,start);d.append(heading,cost,status,actions);document.body.append(d);d.onclose=()=>d.remove();d.showModal();
 }
 window.WorkflowAPI={prepare,start,run,open,isRunning,stop:id=>runs.get(id)?.stop(),getRun:id=>runs.get(id),executable};
})();
