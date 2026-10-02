import {createGenerationCard,supportsCard} from '../agent-generation/card.mjs';
import {icons} from './icons.mjs';
import {reconcileConnectedChildren as reconcile} from '../agent-messages/reconcile.mjs';
import {activeTrace,elapsedMs,durationLabel} from './trace.mjs';
import {toolPresentation} from './presentation.mjs';
import {renderQuestionSummary} from '../agent-questions/view.mjs';
import {createFormCard,renderFormSummary} from '../agent-forms/view.mjs';
import {createDelegationCard} from '../agent-delegation/view.mjs';
import {createDepthExecutionCard,isDepthTool} from './depth-card.mjs';
export {renderFormSummary};
export {executeTracedCall,recoverTraces,needsToolConfirmation} from './trace.mjs';
const el=(tag,cls,text)=>{const node=document.createElement(tag);node.className=cls;if(text!==undefined)node.textContent=text;return node;};
const icon=name=>{const node=el('span','execution-icon');node.innerHTML=icons[name];return node;};
const json=value=>typeof value==='string'?value:JSON.stringify(value,null,2);

export function createExecutionRenderer({onConfirm,appendResults=()=>{},generation={},forms={},renderArtifact=()=>null}={}){
 const states=new Map(),timers=new Set(),cards=new Map(),formCards=new Map(),delegationCards=new Map(),depthCards=new Map(),resultSlots=new Map(),groups=new Map();let focusedKey;
 const displayTool=trace=>['show_html','show_widget','show_app','prepare_widget'].includes(trace.name)&&!trace.result?.error&&!trace.error&&!['error','denied','cancelled','interrupted'].includes(trace.status);
 function stopTimers(group){for(const timer of group.timers){clearInterval(timer);timers.delete(timer);}group.timers.clear();}
 function paintResults(entry,trace,streaming){
  entry.trace=trace;entry.streaming=streaming;
  if(trace.name==='agent_delegate'){entry.regular.replaceChildren();reconcile(entry.artifact,[]);return;}
  entry.regular.replaceChildren();appendResults(entry.regular,trace.result,trace);
  const artifact=renderArtifact(trace,{streaming});reconcile(entry.artifact,artifact?[artifact]:[]);
 }
 if(!document.querySelector('link[data-agent-generation]')){const css=document.createElement('link');css.rel='stylesheet';css.href=new URL('../agent-generation/styles.css',import.meta.url).href;css.dataset.agentGeneration='';document.head.append(css);}
 function disclosure(key,label,{summary=false,open=false}={}){
  const root=el('div',summary?'execution-summary':'execution-disclosure'),trigger=el('button',summary?'execution-summary-trigger':'execution-line');
  trigger.type='button';trigger.dataset.executionControl=key;
  const content=el('div','execution-content'),clip=el('div','execution-content-clip'),body=el('div',summary?'execution-summary-body':'execution-detail');
  content.id='execution-'+crypto.randomUUID();trigger.setAttribute('aria-controls',content.id);
  trigger.append(label,icon('chevron'));content.append(clip);clip.append(body);root.append(trigger,content);
  const apply=value=>{states.set(key,value);root.dataset.open=String(value);trigger.setAttribute('aria-expanded',String(value));content.setAttribute('aria-hidden',String(!value));content.inert=!value;};
  apply(states.get(key)??open);trigger.onclick=()=>apply(root.dataset.open!=='true');
  if(focusedKey===key)queueMicrotask(()=>{if(trigger.isConnected)trigger.focus({preventScroll:true});});
  return {root,trigger,body};
 }
 function tool(trace,key,group){
  if(isDepthTool(trace)){const id=trace.id||key;let card=depthCards.get(id);if(!card){card=createDepthExecutionCard(trace,{key,onConfirm});depthCards.set(id,card);}else card.update(trace);return card.element;}
  if(trace.name==='agent_delegate'){const id=trace.id||key;let card=delegationCards.get(id);if(!card){card=createDelegationCard(trace,{key});delegationCards.set(id,card);}else card.update(trace);return card.element;}
  if(trace.name==='show_form'){const id=trace.id||key;let card=formCards.get(id);if(!card){card=createFormCard({trace,onSubmit:(...args)=>forms.onSubmit?.(...args),onDraftChange:(...args)=>forms.onDraftChange?.(...args),onEdit:(...args)=>forms.onEdit?.(...args),resolveImage:(...args)=>forms.resolveImage?.(...args),isBusy:()=>forms.isBusy?.(trace)??false});formCards.set(id,card);}else card.update?.(trace);return card.element;}
  if(supportsCard(trace)){let card=cards.get(trace.id||key);if(!card){card=createGenerationCard(trace,{...generation,onConfirm});cards.set(trace.id||key,card);}else card.update(trace);return card.element;}
  const info=toolPresentation(trace),label=el('span','execution-label',info.label),part=disclosure(key,label);
  part.root.dataset.status=trace.status;part.root.dataset.traceId=trace.id||key;
  part.trigger.prepend(icon(info.icon));part.trigger.title=info.label;
  if(trace.status==='running'){
   part.trigger.setAttribute('aria-live','polite');label.style.setProperty('--spread',`${info.label.length*1.1}px`);
   const time=el('span','execution-time');part.trigger.insertBefore(time,part.trigger.lastChild);
   const tick=()=>{const ms=Date.now()-trace.startedAt;time.textContent=Number.isFinite(ms)&&ms>=5000?'· '+durationLabel(ms):'';};tick();
   const timer=setInterval(tick,1000);timers.add(timer);group.timers.add(timer);
  }
  const description=el('div','execution-description',info.action+(info.detail?' · '+info.detail:''));
  part.body.append(description);
  const raw=el('details','execution-raw');raw.open=states.get(key+':raw')||false;
  raw.append(el('summary','','调用详情'),el('pre','',json({tool:trace.name,arguments:trace.args,...(trace.result!==undefined?{result:trace.result}:{})})));
  raw.ontoggle=()=>states.set(key+':raw',raw.open);part.body.append(raw);
  const row=el('div','execution-tool');row.append(part.root);
  if(trace.name==='ask_question'){const summary=renderQuestionSummary(trace);if(summary)row.append(summary);}
  if(trace.status==='pending'){
   const card=el('section','execution-confirmation');card.setAttribute('aria-label','确认操作');
   card.append(el('strong','',info.action),el('p','',info.detail||'此操作会修改当前画布或任务。展开调用详情可查看参数。'));
   if(trace.name==='skills_save'){
    card.append(el('p','',trace.args.description),el('p','execution-confirm-prompt',trace.args.instructions));
    const files=trace.args.files;card.append(el('p','',files===undefined?'保留现有参考文件':files.length?'参考文件：'+files.map(file=>file.path).join('、'):'无参考文件'));
   }
   if(trace.args?.prompt)card.append(el('p','execution-confirm-prompt',trace.args.prompt));
   const actions=el('div','execution-confirm-actions');
   for(const [text,allowed] of [['拒绝',false],['确认',true]]){
    const button=el('button',allowed?'execution-allow':'',text);button.type='button';button.setAttribute('aria-label',allowed?'允许此操作':'拒绝此操作');
    button.dataset.executionControl=key+(allowed?':allow':':deny');
    button.onclick=()=>{actions.querySelectorAll('button').forEach(b=>b.disabled=true);onConfirm?.(trace,allowed);};actions.append(button);
   }
   card.append(actions);row.append(card);
  }else if(trace.result?.error||trace.error){const error=trace.result?.error||trace.error;row.append(el('p','execution-error',typeof error==='string'?error:error.message||json(error)));}
  return row;
 }
 return {
  reset(){focusedKey=document.activeElement?.dataset.executionControl;for(const group of groups.values())stopTimers(group);for(const card of cards.values())card.suspend();for(const card of formCards.values())card.suspend?.();},
  prune(activeGroupKeys){
   const active=new Set(activeGroupKeys),liveCards=new Set();
   for(const [key,group]of groups){if(active.has(key)){for(const entry of group.entries.values())liveCards.add(entry.cardKey);continue;}stopTimers(group);group.outer.remove();groups.delete(key);for(const stateKey of states.keys())if(stateKey===key+':summary'||stateKey.startsWith(key+':'))states.delete(stateKey);}
   for(const cache of [cards,formCards,delegationCards,depthCards])for(const [key,card]of cache)if(!liveCards.has(key)){card.destroy();cache.delete(key);}
   resultSlots.clear();for(const group of groups.values())for(const entry of group.entries.values())if(entry.trace.id)resultSlots.set(entry.trace.id,entry);
  },
  destroy(){this.reset();this.prune([]);states.clear();},
  updateTrace(trace,{streaming}={}){cards.get(trace.id)?.update(trace);formCards.get(trace.id)?.update?.(trace);delegationCards.get(trace.id)?.update(trace);depthCards.get(trace.id)?.update(trace);const entry=resultSlots.get(trace.id);if(entry?.slot.isConnected)paintResults(entry,trace,streaming??entry.streaming);},
  render(traces,{key='execution',collapse=false,streaming=false}={}){
   let group=groups.get(key);
   if(!group){group={outer:el('div','agent-message tool execution-group'),activity:el('div','execution-activity'),list:el('div','execution-list'),summary:null,entries:new Map(),timers:new Set()};groups.set(key,group);group.outer.append(group.activity);}
   stopTimers(group);
   const ordinary=traces.filter(trace=>!displayTool(trace)),tools=[];
   for(const [index,trace]of traces.entries())if(!displayTool(trace))tools.push(tool(trace,`${key}:${trace.id||index}`,group));
   reconcile(group.list,tools);
   if(ordinary.length&&collapse&&ordinary.every(t=>!activeTrace(t)&&t.status==='done'&&!t.result?.error&&!t.error&&!supportsCard(t)&&t.name!=='ask_question'&&t.name!=='show_form'&&t.name!=='agent_delegate'&&!isDepthTool(t))){
    const duration=durationLabel(elapsedMs(ordinary)),text=duration?'处理了 '+duration:'已处理';
    if(!group.summary)group.summary=disclosure(key+':summary',el('span','execution-label',text),{summary:true});
    else group.summary.trigger.querySelector('.execution-label').textContent=text;
    reconcile(group.summary.body,[group.list]);reconcile(group.activity,[group.summary.root]);
   }else reconcile(group.activity,ordinary.length?[group.list]:[]);
   group.activity.hidden=!ordinary.length;
   // Result slots stay outside activity folding and keep their artifact child connected.
   const activeEntries=new Set(),slots=[];
   for(const [index,trace]of traces.entries()){
    const id=trace.id||index;activeEntries.add(id);let entry=group.entries.get(id);
    if(!entry){entry={slot:el('div','execution-results'),regular:el('div','execution-regular-results'),artifact:el('div','execution-artifact-results'),cardKey:trace.id||`${key}:${index}`};entry.slot.append(entry.regular,entry.artifact);group.entries.set(id,entry);}
    paintResults(entry,trace,streaming);if(trace.id)resultSlots.set(trace.id,entry);slots.push(entry.slot);
   }
   for(const [id,entry]of group.entries)if(!activeEntries.has(id)){entry.slot.remove();group.entries.delete(id);if(entry.trace.id&&resultSlots.get(entry.trace.id)===entry)resultSlots.delete(entry.trace.id);for(const cache of [cards,formCards,delegationCards,depthCards]){cache.get(entry.cardKey)?.destroy();cache.delete(entry.cardKey);}}
   reconcile(group.outer,[group.activity,...slots]);return group.outer;
  }
 };
}
