import {createAppController,prepareApp} from '../integration.mjs';
import {characterBlockingV1Uri} from '../character-blocking-v1.mjs';
import {createCharacterBlockingV1Runtime} from '../character-blocking-v1-runtime.mjs';
import {createTemplateQaChatStore} from './template-source-chat-store.mjs';
const $=id=>document.getElementById(id),projectId='character-blocking-v1-qa-project',chatStore=createTemplateQaChatStore({name:'tapnow-character-blocking-v1-qa-chat-v1',label:'历史人物站位验收'});
let chat,trace,streaming=false,failSave=false,pageLeaving=false;
const runtime=createCharacterBlockingV1Runtime({getProjectId:()=>projectId}),getContext=()=>({chat,panelActive:!pageLeaving,pageLeaving,streaming});
function persist(){return chatStore.save(chat);}
function report(error){$('receipt').textContent=JSON.stringify({error,source_uri:trace?.result.resource_uri,saved_state:trace?.appState,confirmed_handoffs:trace?.appHandoffs||[],saved_queue:chat?.queuedMessages||[]},null,2);}
const current=(response,record,owner)=>()=>!pageLeaving&&owner===chat&&chat.messages.includes(record)&&record.status==='done'&&record.result.response===response;
const controller=createAppController({getContext,getCharacterBlockingSourceContext:(response,record,owner)=>runtime.capture(response,{trace:record,chat:owner,isCurrent:current(response,record,owner)}),onSaveState:async(owner,record,state)=>{
 if(failSave)throw Error('模拟：历史人物站位状态事务保存失败');if(owner!==chat||pageLeaving)throw Error('历史人物站位会话已切换');
 const previous=record.appState;record.appState=state;
 try{await persist();report();return true;}catch(error){if(record.appState===state){if(previous===undefined)delete record.appState;else record.appState=previous;}throw error;}
},onQueuePrompt:async(text,record,owner,metadata,isCurrent)=>{
 if(owner!==chat||!isCurrent()||streaming||failSave)return false;if(metadata.handoffId&&record.appHandoffs?.includes(metadata.handoffId))return true;
 const previousQueue=chat.queuedMessages,previousHandoffs=record.appHandoffs,submission={id:crypto.randomUUID(),text,widgetOrigin:{traceId:record.id,callId:record.callId,resourceUri:record.result.resource_uri,...(metadata.handoffId?{handoffId:metadata.handoffId}:{})}},queue=[...(previousQueue||[]),submission],handoffs=metadata.handoffId?[...(previousHandoffs||[]),metadata.handoffId]:previousHandoffs;chat.queuedMessages=queue;if(metadata.handoffId)record.appHandoffs=handoffs;
 try{await persist();if(!isCurrent()||streaming||pageLeaving)throw Error('历史人物站位交接保存期间来源已变化');report();return true;}
 catch(error){if(chat.queuedMessages===queue)chat.queuedMessages=previousQueue;if(record.appHandoffs===handoffs){if(previousHandoffs===undefined)delete record.appHandoffs;else record.appHandoffs=previousHandoffs;}await persist();report(error.message);return false;}
},onError:report});
function render(){if(trace)$('card').replaceChildren(controller.render(trace));}
try{
 chat=await chatStore.load()||{id:'character-blocking-v1-qa-chat',messages:[],queuedMessages:[]};trace=chat.messages.filter(item=>item.name==='show_app').at(-1);
 $('input').value=JSON.stringify(trace?.args.data||{locale:'zh-CN',target:'image',aspect_ratio:'16:9',scene:'车站对望：两人处于不同景深。',characters:[{id:'lin',name:'林岚',role:'旅客',x:300,y:350},{id:'zhou',name:'周宁',role:'等车的人',x:750,y:700}]},null,2);
 $('open').onclick=async()=>{
  if(streaming||pageLeaving)return;const button=$('open');button.disabled=true;
  try{
   const args=await runtime.prepareAppArgs({resource_uri:characterBlockingV1Uri,title:'历史人物站位 v1 验收',data:JSON.parse($('input').value)},{isCurrent:()=>!pageLeaving&&!streaming}),result=runtime.bindPreparedResult(prepareApp(args),args),id=crypto.randomUUID(),next={id,callId:'blocking_v1_qa_'+id,role:'tool',name:'show_app',status:'done',args,result},previous=trace;
   chat.messages.push(next);try{if(failSave)throw Error('模拟：打开历史人物站位保存失败');await persist();if(pageLeaving)throw Error('验收页已关闭');}catch(error){chat.messages=chat.messages.filter(item=>item!==next);trace=previous;await persist();throw error;}
   trace=next;render();report();
  }catch(error){report(error.message);}finally{button.disabled=false;}
 };
 $('busy').onclick=()=>{streaming=!streaming;$('busy').textContent='运行状态：'+(streaming?'运行中':'空闲');render();report();};$('fail').onclick=()=>{failSave=!failSave;$('fail').textContent='保存状态：'+(failSave?'失败':'正常');report();};
 for(const id of ['open','busy','fail'])$(id).disabled=false;render();report();
}catch(error){report(error.message);}
window.addEventListener('pagehide',()=>{pageLeaving=true;controller.reset();chatStore.close();});
