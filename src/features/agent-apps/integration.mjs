import {createMcpAppCard} from './card.mjs';
import {createMcpAppHost} from './host.mjs';
import {prepareApp,appPolicy,getApp,copyAppState} from './registry.mjs';
import {resolveDirectorMarkupReply} from './director-markup.mjs';
export {prepareApp};

export function createAppController({getContext,onQueuePrompt,onSaveState,onError=()=>{}}){
 const records=new Map();
 const validTrace=trace=>trace?.name==='show_app'&&trace.status==='done'&&!trace.error&&!trace.result?.error&&trace.result?.kind==='mcp_app'&&trace.args?.resource_uri===trace.result.resource_uri&&!!getApp(trace.result.resource_uri);
 function current(record){const context=getContext();return !record.disposed&&records.get(record.trace.id)===record&&context.chat===record.chat&&context.panelActive&&!context.pageLeaving&&record.chat.messages.includes(record.trace)&&validTrace(record.trace)&&record.card?.element.isConnected;}
 function dispose(record){record.disposed=true;record.card.destroy();records.delete(record.trace.id);}
 function render(trace){
  const context=getContext();if(trace.name!=='show_app')return null;
  let record=records.get(trace.id);
  if(record&&(record.chat!==context.chat||record.trace!==trace||record.resourceUri!==trace.result?.resource_uri)){dispose(record);record=null;}
  if(!validTrace(trace)||!context.panelActive||context.pageLeaving||!context.chat.messages.includes(trace)){if(record)dispose(record);return null;}
  const policy=appPolicy(trace.result.resource_uri);
  if(!record){
   record={trace,chat:context.chat,resourceUri:trace.result.resource_uri,disposed:false,card:null};records.set(trace.id,record);
   record.card=createMcpAppCard({trace,policy,createHost:createMcpAppHost,hostOptions:{isCurrent:()=>current(record),allowResource:uri=>!!getApp(uri),widgetStateLimit:getApp(record.resourceUri).stateLimit,callbacks:{
    onSetWidgetState:async value=>{if(!current(record))throw Error('应用所属会话已切换');const state=copyAppState(value,getApp(record.resourceUri).stateLimit);await onSaveState(record.chat,trace,state);if(!current(record))throw Error('应用所属会话已切换');},
    onSendPrompt:async(text,metadata,isSourceCurrent=()=>true)=>{if(!current(record)||!isSourceCurrent())return false;try{
     if(record.resourceUri==='ui://tapnow/director-markup@v1'){
      const savedState=trace.appState,reply=await resolveDirectorMarkupReply(text,trace.result.response.draft,savedState);
      if(!current(record)||!isSourceCurrent()||getContext().streaming||trace.appState!==savedState)return false;
      text=reply.text;metadata={...metadata,...reply.metadata};
     }
     return await onQueuePrompt(text,trace,record.chat,metadata,()=>current(record)&&isSourceCurrent())!==false;
    }catch(error){if(current(record))onError(error.message);return false;}},
   }}});
  }
  record.card.update(trace,{policy,runActive:!!context.streaming,locale:'zh-CN'});return record.card.element;
 }
 function prune(traces){const context=getContext(),live=new Set(traces);for(const record of [...records.values()])if(record.chat!==context.chat||!context.panelActive||context.pageLeaving||!live.has(record.trace)||!validTrace(record.trace))dispose(record);}
 function reset(){for(const record of [...records.values()])dispose(record);}
 return {render,prune,reset};
}
