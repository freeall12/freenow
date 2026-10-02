import {icons} from './icons.mjs';
import {appendRecoveryActions} from '../agent-generation/recovery-actions.mjs';

export const depthActions={video_analyze:'解析视频分镜',world_generate:'生成3D资产或世界',depth_video_prepare:'准备深度视频参考',depth_video_convert:'转换视频深度',depth_video_recast:'制作深度视频重演'};
export const isDepthTool=trace=>Object.hasOwn(depthActions,trace.name);
const el=(tag,cls,text)=>{const node=document.createElement(tag);node.className=cls;if(text!==undefined)node.textContent=text;return node;};
const message=value=>typeof value==='string'?value:typeof value?.message==='string'?value.message:'';
const glyph=name=>{const node=el('span','execution-icon');node.innerHTML=icons[name];return node;};
const taskId=trace=>trace.result?.taskId||trace.submittedTaskId||trace.generationJob?.id;
export function depthToolDetails(trace){
 const args=trace.args||{},values=[];
 if(trace.name==='video_analyze')return ['来源视频：'+args.nodeId,'操作：'+args.operationId,'按来源当前片段解析，创建真实分镜视频；可能调用已配置的视觉模型。'];
 if(trace.name==='world_generate')return ['3D节点：'+args.nodeId,...['model','material'].filter(key=>args[key]).map(key=>(key==='model'?'模型：':'材质：')+args[key]),...(args.isPano?['全景图片输入']:[]),...(args.referenceIds?['参考节点：'+(args.referenceIds.join('、')||'无')]:['使用节点当前参考']),...(args.prompt?['提示词：'+args.prompt]:[])];
 for(const [name,label]of [['sourceId','来源视频'],['depthNodeId','深度视频'],['model','模型'],['modelId','深度模型'],['formCallId','参考表单']])if(typeof args[name]==='string'&&args[name])values.push(label+'：'+args[name]);
 for(const [name,label]of [['character','人物'],['setting','环境']]){const role=args[name];if(role&&typeof role==='object'){const parts=[role.nodeId,role.description].filter(value=>typeof value==='string'&&value);if(parts.length)values.push(label+'：'+parts.join(' · '));}}
 if(args.formCallId&&(!args.character||!args.setting))values.push('人物与环境参考：读取该表单的用户确认提交，执行时校验');
 if(Number.isFinite(args.duration))values.push('时长：'+args.duration+' 秒');
 if(!args.formCallId&&trace.result?.formCallId)values.push('参考表单：'+trace.result.formCallId);
 return values;
}
export function depthTaskState(trace){
 const id=taskId(trace),job=trace.generationJob?.id===id?trace.generationJob:null;
 if(id){
  if(job?.applicationError)return{id,job,state:'failed',label:'结果应用失败',error:message(job.applicationError)};
  if(job?.status==='succeeded')return{id,job,state:'done',label:job.applying?'结果应用中':job.applied?(trace.name==='video_analyze'?'解析完成并应用':'已生成并应用'):job.recovered?'结果待取回':trace.name==='video_analyze'?'解析完成，待应用':'已生成，待应用'};
  const labels={queued:'排队中',running:'生成中',unknown:'状态未确认',failed:'生成失败',cancelled:'生成任务已取消',configuration_required:'等待配置生成服务'};
  if(trace.name==='video_analyze')Object.assign(labels,{running:'解析中',failed:'解析失败',cancelled:'解析任务已取消'});
  const status=job?.status||'unknown',progress=status==='running'&&Number.isFinite(job?.progress)?' '+Math.max(0,Math.min(99,Math.round(job.progress)))+'%':'';
  return{id,job:job||{id,status:'unknown'},state:status,label:(labels[status]||'状态未确认')+progress,error:message(job?.error)};
 }
 if(trace.result?.status==='configuration_required')return{state:'configuration_required',label:'等待配置生成服务',error:message(trace.result.error)};
 if(trace.result?.reused)return{state:'done',label:'已复用现有深度视频'};
 const labels={pending:'等待确认',running:trace.name==='depth_video_prepare'?'正在准备参考':'正在准备生成请求',done:trace.name==='depth_video_prepare'?'参考已准备':'操作已返回，尚无任务回执',error:'操作失败',denied:'已拒绝',cancelled:'工具已停止',interrupted:'工具已中断'};
 return{state:trace.status,label:labels[trace.status]||'状态未确认',error:message(trace.error)||message(trace.result?.error)};
}

// This local workflow reuses the existing execution line, confirmation and
// recovery controls. A tool finishing/stopping never proves remote completion.
export function createDepthExecutionCard(initial,{key=initial.id||'depth',onConfirm}={}){
 let trace=initial,recoverySignature='',confirmationPending=false;
 const element=el('div','execution-tool'),disclosure=el('div','execution-disclosure'),trigger=el('button','execution-line'),title=el('span','execution-label');
 trigger.type='button';trigger.dataset.executionControl=key;trigger.append(glyph(initial.name==='depth_video_prepare'?'read':'command'),title,glyph('chevron'));
 const content=el('div','execution-content'),clip=el('div','execution-content-clip'),body=el('div','execution-detail'),details=el('div','execution-description'),status=el('p','execution-description'),note=el('p','execution-description'),error=el('p','execution-error'),recovery=el('div','');
 content.id='depth-execution-'+crypto.randomUUID();trigger.setAttribute('aria-controls',content.id);content.append(clip);clip.append(body);body.append(details,status,note,error,recovery);disclosure.append(trigger,content);element.append(disclosure);
 const open=value=>{disclosure.dataset.open=String(value);trigger.setAttribute('aria-expanded',String(value));content.setAttribute('aria-hidden',String(!value));content.inert=!value;};open(false);trigger.onclick=()=>open(disclosure.dataset.open!=='true');
 const confirmation=el('section','execution-confirmation'),heading=el('strong',''),summary=el('p',''),actions=el('div','execution-confirm-actions');confirmation.ariaLabel='确认操作';confirmation.append(heading,summary,actions);
 for(const [label,allowed]of [['拒绝',false],['确认',true]]){const button=el('button',allowed?'execution-allow':'',label);button.type='button';button.ariaLabel=allowed?'允许此操作':'拒绝此操作';button.dataset.executionControl=key+(allowed?':allow':':deny');button.onclick=()=>{if(trace.status!=='pending'||confirmationPending)return;confirmationPending=true;for(const b of actions.children)b.disabled=true;try{Promise.resolve(onConfirm?.(trace,allowed)).catch(reason=>{error.textContent=message(reason);error.hidden=false;confirmationPending=false;for(const b of actions.children)b.disabled=false;});}catch(reason){error.textContent=message(reason);error.hidden=false;confirmationPending=false;for(const b of actions.children)b.disabled=false;}};actions.append(button);}
 function update(value){
  const previous=trace;trace=value;if(previous.status!==trace.status)confirmationPending=false;
  const state=depthTaskState(trace),action=depthActions[trace.name],detail=depthToolDetails(trace);
  title.textContent=action+' · '+state.label;trigger.title=title.textContent;title.style.setProperty('--spread',`${title.textContent.length*1.1}px`);
  disclosure.dataset.status=state.state==='running'?'running':trace.status;disclosure.dataset.traceId=trace.id||key;
  details.replaceChildren(...detail.map(text=>el('div','',text)));status.textContent=state.id?'生成任务：'+state.id+' · '+state.label:state.label;
  note.textContent=[state.id&&['cancelled','interrupted'].includes(trace.status)?'工具已停止等待；生成任务状态以实际查询结果为准。':'',state.job?.status==='unknown'&&state.job.recovery?.pollable===false?'暂无可查询的供应商任务标识；查询仅核对本机记录，不会重新发起任务。':''].filter(Boolean).join(' ');note.hidden=!note.textContent;
  const applied=state.job?.status==='succeeded'&&state.job.applied===true;
  error.textContent=state.error||message(state.job?.error)||(applied?'':message(trace.error)||message(trace.result?.error));error.hidden=!error.textContent;
  const signature=JSON.stringify([state.id,state.job?.status,state.job?.recovered,state.job?.applied,state.job?.applying,state.job?.hasResultPlan,!!state.job?.applicationError]);
  if(signature!==recoverySignature){
   recoverySignature=signature;recovery.replaceChildren();
   if(state.id)appendRecoveryActions(recovery,{...trace,result:{...trace.result,taskId:state.id},generationJob:state.job},{onError:reason=>{error.textContent=message(reason);error.hidden=false;}});
   if(state.id&&state.job?.applicationError&&!state.job.recovered&&window.GenerationAPI?.retryApplication){
    const footer=el('footer','generation-confirm-footer'),retry=el('button','generation-small-button','重试应用结果');retry.type='button';
    const id=state.id;retry.onclick=async()=>{retry.disabled=true;try{await window.GenerationAPI.retryApplication(id);}catch(reason){error.textContent=message(reason);error.hidden=false;}finally{retry.disabled=false;}};
    footer.append(retry);recovery.append(footer);
   }
   for(const [index,button]of [...recovery.querySelectorAll('button')].entries())button.dataset.executionControl=key+':recovery:'+index;
  }
  if(trace.status==='pending'&&!state.id){heading.textContent=action;summary.textContent=detail.join('\n')||'确认后提交生成请求。';summary.style.whiteSpace='pre-wrap';for(const button of actions.children)button.disabled=confirmationPending;if(!confirmation.isConnected)element.append(confirmation);}
  else confirmation.remove();
 }
 update(initial);return{element,update,suspend(){},destroy(){element.remove();}};
}
