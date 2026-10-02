import {icons} from '../agent-execution/icons.mjs';
import {toolPresentation} from '../agent-execution/presentation.mjs';
import {reconcileConnectedChildren as reconcile} from '../agent-messages/reconcile.mjs';

// Local inferred presentation: reuse execution geometry/icons, not a claim of
// official subagent UI parity. Only public summaries and read-only step labels
// are rendered; arguments, results, pixels and hidden reasoning are excluded.
const labels={queued:'排队中',blocked:'等待依赖',running:'进行中',waiting:'等待中',unknown:'状态未确认',completed:'已完成',failed:'失败',cancelled:'已取消',skipped:'已跳过',interrupted:'已中断',limited:'达到上限'};
const aliases={pending:'waiting',done:'completed',error:'failed',denied:'cancelled'};
const el=(tag,cls,text)=>{const node=document.createElement(tag);node.className=cls;if(text!==undefined)node.textContent=text;return node;};
const text=value=>typeof value==='string'?value.replace(/data:(?:image|video|audio)\/[^\s"'<>)]*/gi,'[媒体数据已省略]'):'';
const errorText=value=>text(typeof value==='string'?value:value?.message);
const statusOf=value=>Object.hasOwn(labels,value)?value:aliases[value]||'unknown';
function recordStatus(record){
 const state=record.reason==='limited'?'limited':statusOf(record.status);
 // Receipt uncertainty stays explicit; only the server confirms failure.
 return errorText(record.error)&&state==='completed'?'failed':state;
}
const setText=(node,value)=>{if(node.textContent!==value)node.textContent=value;};
function icon(name){const node=el('span','execution-icon');node.innerHTML=icons[name];return node;}
function disclosure(label,key,open=false){
 const element=el('div','execution-disclosure'),trigger=el('button','execution-line'),title=el('span','execution-label',label),status=el('span','delegation-status');
 trigger.type='button';trigger.dataset.executionControl=key;trigger.append(icon('read'),title,status,icon('chevron'));
 const content=el('div','execution-content'),clip=el('div','execution-content-clip'),body=el('div','execution-detail');
 content.id='delegate-'+crypto.randomUUID();trigger.setAttribute('aria-controls',content.id);content.append(clip);clip.append(body);element.append(trigger,content);
 const apply=value=>{element.dataset.open=String(value);trigger.setAttribute('aria-expanded',String(value));content.setAttribute('aria-hidden',String(!value));content.inert=!value;};
 trigger.onclick=()=>apply(element.dataset.open!=='true');apply(open);
 return{element,trigger,title,status,body};
}

export function createDelegationCard(trace,{key=trace.id||'delegation'}={}){
 if(!document.querySelector('link[data-agent-delegation]')){const css=document.createElement('link');css.rel='stylesheet';css.href=new URL('./styles.css',import.meta.url).href;css.dataset.agentDelegation='';document.head.append(css);}
 const group=disclosure('子任务',key+':delegation',true),element=el('div','execution-tool execution-delegation');element.append(group.element);
 const list=el('div','delegation-list'),empty=el('p','execution-description'),failure=el('p','execution-error');group.body.append(empty,list,failure);
 const tasks=new Map();
 function taskCard(id){
  const card=disclosure('子任务',key+':delegate:'+id),dependencies=el('p','delegation-dependencies'),summary=el('p','delegation-text'),error=el('p','execution-error'),calls=el('ol','delegation-calls');
  card.element.dataset.taskId=id;card.body.append(dependencies,summary,error,calls);return{...card,dependencies,summary,error,calls,steps:[]};
 }
 function update(value){
  const focus=element.contains(document.activeElement)?document.activeElement:null;
  const live=Array.isArray(value.delegates)?value.delegates:[],saved=Array.isArray(value.result?.tasks)?value.result.tasks:[];
  const finalResult=['completed','partial_failure','failed','cancelled'].includes(value.result?.status);
  const canonical=new Map(saved.filter(task=>task?.taskId).map(task=>[task.taskId,task]));
  const delegates=live.length?live.map(task=>{
   const result=finalResult&&canonical.get(task?.taskId);if(!result)return task;
   return {...task,...result,text:result.response?.text??task.text,calls:task.calls,error:result.error,
    reason:result.reason??(result.status==='failed'?task.reason:undefined)};
  }):saved.map(task=>({...task,text:task.response?.text}));
  if(live.length&&finalResult)for(const task of saved)if(!live.some(item=>item?.taskId===task?.taskId))delegates.push({...task,text:task.response?.text});
  const active=new Set(),rows=[],titles=new Map(delegates.map(task=>[task?.taskId,text(task?.title)||task?.taskId]));
  element.dataset.traceId=value.id||key;setText(group.title,'子任务'+(delegates.length?' · '+delegates.length:''));
  setText(failure,errorText(value.error)||errorText(value.result?.error));failure.hidden=!failure.textContent;
  const outcome=value.result?.status;
  const outcomeLabel={completed:'已完成',partial_failure:'部分失败',failed:'失败',cancelled:'已取消'}[outcome];
  const traceState=recordStatus(value),terminal=['cancelled','interrupted','limited'].includes(traceState)?traceState:outcome==='cancelled'?'cancelled':null;
  setText(group.status,terminal?labels[terminal]:failure.textContent?'失败':outcomeLabel||(value.status==='done'?'委派已结束':labels[traceState]||'状态未知'));
  group.status.dataset.status=terminal||(failure.textContent?'failed':outcome||traceState);
  empty.hidden=delegates.length>0;
  setText(empty,labels[statusOf(value.status)]||'等待子任务记录');
  if(!delegates.length&&statusOf(value.status)==='completed')setText(empty,'没有可用的子任务记录');
  for(const task of delegates){
   if(!task||typeof task.taskId!=='string'||!task.taskId||active.has(task.taskId))continue;
   const id=task.taskId;active.add(id);let card=tasks.get(id);if(!card){card=taskCard(id);tasks.set(id,card);}
   const error=errorText(task.error),state=recordStatus(task),title=text(task.title)||'子任务';
   card.element.dataset.status=state;setText(card.title,title);card.title.style.setProperty('--spread',`${title.length*1.1}px`);
   const round=Number.isInteger(task.round)&&task.round>0?' · 第 '+task.round+' 轮':'';
   setText(card.status,(labels[state]||'状态未知')+round);card.trigger.title=title+' · '+card.status.textContent;
   const dependencies=Array.isArray(task.dependsOn)?task.dependsOn:[],blockedBy=Array.isArray(task.blockedBy)?task.blockedBy:[];
   const dependencyTitles=dependencies.map(id=>titles.get(id)||text(id)).join('、');
   const blockedTitles=blockedBy.map(id=>titles.get(id)||text(id)).join('、');
   setText(card.dependencies,dependencies.length?'依赖：'+dependencyTitles+(state==='skipped'&&blockedTitles?'；未完成：'+blockedTitles:''):'');
   card.dependencies.hidden=!card.dependencies.textContent;
   if(card.dependencies.textContent)card.trigger.title+=' · '+card.dependencies.textContent;
   setText(card.summary,text(task.text));card.summary.hidden=!card.summary.textContent;setText(card.error,error);card.error.hidden=!error;
   const steps=Array.isArray(task.calls)?task.calls:[],visible=[];
   for(const [index,call]of steps.entries()){
    if(!call||typeof call.name!=='string')continue;
    let step=card.steps[index];if(!step){step=el('li','delegation-call');step.append(icon('read'),el('span','delegation-call-label'),el('span','delegation-status'),el('span','execution-error'));card.steps[index]=step;}
    const stepError=errorText(call.error),stepState=recordStatus(call);
    const label=toolPresentation({name:call.name,args:{}}).action;
    setText(step.children[1],text(label));setText(step.children[2],labels[stepState]||'状态未知');setText(step.children[3],stepError);step.children[3].hidden=!stepError;step.dataset.status=stepState;visible.push(step);
   }
   reconcile(card.calls,visible);card.calls.hidden=!visible.length;card.steps.length=steps.length;rows.push(card.element);
  }
  for(const [id,card]of tasks)if(!active.has(id)){card.element.remove();tasks.delete(id);}
  reconcile(list,rows);
  if(focus&&document.activeElement!==focus){if(focus.isConnected)focus.focus({preventScroll:true});else group.trigger.focus({preventScroll:true});}
 }
 update(trace);
 return{element,update,suspend(){},destroy(){tasks.clear();element.remove();}};
}
