import {createMcpAppCard} from './card.mjs';
import {createMcpAppHost} from './host.mjs';
import {prepareApp,appPolicy,getApp,copyAppState} from './registry.mjs';
import {resolveDirectorMarkupReply} from './director-markup.mjs';
import {performanceRhythmUri,validatePerformanceRhythmState,resolvePerformanceRhythmReply} from './performance-rhythm.mjs';
import {storyRoomUri,initialStoryRoomState,validateStoryRoomState,resolveStoryRoomReply} from './story-room.mjs';
import {actorEmotionUri,initialActorEmotionState,validateActorEmotionState,resolveActorEmotionReply} from './actor-emotion.mjs';
import {productionProgressUri,validateProductionProgressRequest,normalizeProductionProgressResult} from './production-progress.mjs';
import {interactiveLearningUri,initialInteractiveLearningState,validateInteractiveLearningState,resolveInteractiveLearningReply} from './interactive-learning.mjs';
import {libraryPickerUri,initialLibraryPickerState,validateLibraryPickerFindResult,libraryPickerName} from './library-picker.mjs';
export {prepareApp};

export function createAppController({getContext,onQueuePrompt,onSaveState,getActorSourceContext,onSaveExpressionGuide,getProductionSourceContext,onProductionProgressQuery,getLibrarySourceContext,onLibraryAddToCanvas,onError=()=>{}}){
 const records=new Map();
 const validTrace=trace=>trace?.name==='show_app'&&trace.status==='done'&&!trace.error&&!trace.result?.error&&trace.result?.kind==='mcp_app'&&trace.args?.resource_uri===trace.result.resource_uri&&!!getApp(trace.result.resource_uri);
 function current(record){const context=getContext();return !record.disposed&&records.get(record.trace.id)===record&&context.chat===record.chat&&context.panelActive&&!context.pageLeaving&&record.chat.messages.includes(record.trace)&&validTrace(record.trace)&&record.card?.element.isConnected;}
 function dispose(record){record.disposed=true;record.productionContext?.dispose?.();record.card.destroy();records.delete(record.trace.id);}
 function persistState(record,value,{initialize=false,restore=false}={}){
  const {trace}=record,result=trace.result,response=result.response;
  // Official story/actor pages debounce state updates and do not flush on
  // confirmation. Serialize real commits; a default is never a saved receipt.
  const work=record.stateWork.catch(()=>{}).then(async()=>{
   if(!current(record)||trace.result!==result||trace.result.response!==response)throw Error('应用所属会话已切换');
   if(initialize&&trace.appState!=null)return;
   let state=copyAppState(restore?trace.appState:value,getApp(record.resourceUri).stateLimit);
   if(record.resourceUri===performanceRhythmUri)state=validatePerformanceRhythmState(state,response.duration_ms);
   if(record.resourceUri===storyRoomUri)state=validateStoryRoomState(state,response);
   if(record.resourceUri===actorEmotionUri)state=validateActorEmotionState(state,response);
   if(record.resourceUri===interactiveLearningUri)state=validateInteractiveLearningState(state,response);
   if(record.resourceUri===libraryPickerUri){await record.libraryContext?.guard();if(!current(record))throw Error('素材库所属会话已切换');state=record.libraryContext.validateState(state);}
   if(await onSaveState(record.chat,trace,state)===false)throw Error('应用状态未能保存');
   if(!current(record)||trace.result!==result||trace.result.response!==response)throw Error('应用所属会话已切换');
  });
  record.stateWork=work;
  void work.then(()=>{if(record.stateWork===work)record.stateError=null;},error=>{if(record.stateWork===work)record.stateError=error;});
  return work;
 }
 async function waitForState(record){
  let work;do{work=record.stateWork;await work;}while(work!==record.stateWork);
 }
 function sourceGuard(record,isSourceCurrent=()=>true){
  const {trace}=record,savedState=trace.appState,appResult=trace.result,response=appResult.response,stateWork=record.stateWork;
  return ()=>{try{return current(record)&&isSourceCurrent()&&record.stateWork===stateWork&&!record.stateError&&trace.appState===savedState&&trace.result===appResult&&trace.result.response===response&&trace.result.resource_uri===record.resourceUri&&(record.resourceUri!==actorEmotionUri||record.actorContext?.guard()===true)&&(record.resourceUri!==libraryPickerUri||record.libraryContext?.isCurrent()===true)&&(record.resourceUri!==productionProgressUri||record.productionContext?.guard()===true);}catch{return false;}};
 }
 function render(trace){
  const context=getContext();if(trace.name!=='show_app')return null;
  let record=records.get(trace.id);
  if(record&&(record.chat!==context.chat||record.trace!==trace||record.resourceUri!==trace.result?.resource_uri)){dispose(record);record=null;}
  if(!validTrace(trace)||!context.panelActive||context.pageLeaving||!context.chat.messages.includes(trace)){if(record)dispose(record);return null;}
  const policy=appPolicy(trace.result.resource_uri);
  if(!record){
   record={trace,chat:context.chat,resourceUri:trace.result.resource_uri,disposed:false,card:null,stateWork:Promise.resolve(),stateError:null,actorContext:null};records.set(trace.id,record);
   if(record.resourceUri===actorEmotionUri){try{record.actorContext=getActorSourceContext?.(trace.result.response,trace,record.chat);}catch(error){onError(error.message);}}
   if(record.resourceUri===productionProgressUri){try{record.productionContext=getProductionSourceContext?.(trace.result.response,trace,record.chat);}catch(error){onError(error.message);}}
   if(record.resourceUri===libraryPickerUri){try{record.libraryContext=getLibrarySourceContext?.(trace.result.response,trace,record.chat);}catch(error){onError(error.message);}}
   record.card=createMcpAppCard({trace,policy,createHost:createMcpAppHost,hostOptions:{isCurrent:()=>current(record),allowResource:uri=>!!getApp(uri),widgetStateLimit:getApp(record.resourceUri).stateLimit,csp:getApp(record.resourceUri).csp,callbacks:{
    onReady:()=>{
     // A reload restores the committed UI state. Retry its real save after a
     // failure, reading at execution time so newer queued edits are preserved.
     if(trace.appState!=null){if(record.stateError)void persistState(record,null,{restore:true}).catch(error=>{if(current(record))onError(error.message);});return;}
     const initial=record.resourceUri===storyRoomUri?initialStoryRoomState:record.resourceUri===actorEmotionUri?initialActorEmotionState:record.resourceUri===interactiveLearningUri?initialInteractiveLearningState:record.resourceUri===libraryPickerUri?initialLibraryPickerState:null;
     const value=initial?.(trace.result.response);
     if(value)void persistState(record,value,{initialize:true}).catch(error=>{if(current(record))onError(error.message);});
    },
    ...(record.resourceUri!==productionProgressUri?{onSetWidgetState:value=>persistState(record,value)}:{}),
    ...(record.resourceUri===productionProgressUri&&typeof onProductionProgressQuery==='function'?{onProductionProgressQuery:async(args,isSourceCurrent=()=>true)=>{
     const sourceCurrent=sourceGuard(record,isSourceCurrent);if(!sourceCurrent())throw Error('制作进度来源已切换');
     const request=validateProductionProgressRequest(args,trace.result.response),receipt=await onProductionProgressQuery(request,trace,record.chat,{isCurrent:sourceCurrent,sourceContext:record.productionContext});
     if(!sourceCurrent())throw Error('查询期间制作进度来源已切换');return normalizeProductionProgressResult(receipt,trace.result.response);
    }}:{}),
    ...(record.resourceUri===libraryPickerUri?{
     onLibraryFind:async(args,options,isSourceCurrent=()=>true)=>{
      await waitForState(record);await record.libraryContext?.guard();const sourceCurrent=sourceGuard(record,isSourceCurrent);if(!sourceCurrent())throw Error('素材库来源已切换');
      const result=await record.libraryContext.find(args,{...options,isCurrent:sourceCurrent});if(!sourceCurrent())throw Error('查询期间素材库来源已切换');return {content:[],structuredContent:validateLibraryPickerFindResult(result,trace.result.response)};
     },
     onLibraryModelContext:async(params,options,isSourceCurrent=()=>true)=>{
      await waitForState(record);await record.libraryContext?.guard();const sourceCurrent=sourceGuard(record,isSourceCurrent);if(!sourceCurrent()||getContext().streaming)throw Error('素材库来源已切换或会话正在运行');
      const receipt=await record.libraryContext.setModelContext(params,{...options,isCurrent:sourceCurrent});if(!sourceCurrent()||getContext().streaming)throw Error('素材库引用来源已切换');return receipt;
     },
     onLibraryAddToCanvas:async(params,options,isSourceCurrent=()=>true)=>{
      await waitForState(record);await record.libraryContext?.guard();const sourceCurrent=sourceGuard(record,isSourceCurrent);if(!sourceCurrent()||getContext().streaming)throw Error('素材库来源已切换或会话正在运行');
      const receipt=await (onLibraryAddToCanvas?onLibraryAddToCanvas(params,trace,record.chat,{...options,isCurrent:sourceCurrent,sourceContext:record.libraryContext}):record.libraryContext.addToCanvas(params,{...options,isCurrent:sourceCurrent}));
      if(!sourceCurrent()||getContext().streaming)throw Error('素材保存期间来源已切换');return receipt;
     },
    }:{}),
    ...(record.resourceUri===actorEmotionUri&&typeof onSaveExpressionGuide==='function'?{onSaveExpressionGuide:async(args,{callId},isSourceCurrent=()=>true)=>{
     await waitForState(record);const sourceCurrent=sourceGuard(record,isSourceCurrent);
     if(!sourceCurrent()||getContext().streaming)throw Error('人物情绪来源已切换或会话正在运行');
     const receipt=await onSaveExpressionGuide(args,trace,record.chat,{callId,isCurrent:sourceCurrent,sourceContext:record.actorContext});
     if(!sourceCurrent()||getContext().streaming)throw Error('保存期间人物情绪来源已切换');
     return {content:[],structuredContent:receipt};
    }}:{}),
    ...(record.resourceUri!==productionProgressUri?{onSendPrompt:async(text,metadata,isSourceCurrent=()=>true)=>{if(!current(record)||!isSourceCurrent())return false;try{
     await waitForState(record);
     if(record.resourceUri===libraryPickerUri)await record.libraryContext?.guard();
     const savedState=trace.appState,appResult=trace.result,response=appResult.response;
     const baseCurrent=sourceGuard(record,isSourceCurrent),savedGuide=record.resourceUri===actorEmotionUri?record.actorContext?.readGuide():null;
     const sourceCurrent=()=>baseCurrent()&&(record.resourceUri!==actorEmotionUri||record.actorContext.readGuide()===savedGuide);
     if(!sourceCurrent())return false;
     if(['ui://tapnow/director-markup@v1',performanceRhythmUri,storyRoomUri,actorEmotionUri,interactiveLearningUri,libraryPickerUri].includes(record.resourceUri)){
      let reply;
      if(record.resourceUri===actorEmotionUri){
       const guide=savedGuide;
       await record.actorContext.validateGuideCurrent(guide);
       if(!sourceCurrent()||record.actorContext.readGuide()!==guide)return false;
       reply=await resolveActorEmotionReply(text,response,savedState,guide);
       if(record.actorContext.readGuide()!==guide)return false;
      }else if(record.resourceUri===interactiveLearningUri)reply=await resolveInteractiveLearningReply(text,response,savedState);
      else if(record.resourceUri===libraryPickerUri)reply=await record.libraryContext.reply(text,savedState,{locale:getContext().locale||'zh-CN',userAction:true,isCurrent:sourceCurrent});
      else if(record.resourceUri===storyRoomUri)reply=await resolveStoryRoomReply(text,response,savedState);
      else if(record.resourceUri===performanceRhythmUri)reply=await resolvePerformanceRhythmReply(text,response,savedState);
      else reply=await resolveDirectorMarkupReply(text,response.draft,savedState);
      if(!sourceCurrent()||getContext().streaming)return false;
      text=reply.text;metadata={...metadata,...reply.metadata};
      if(record.resourceUri===libraryPickerUri){const asset=reply.result.asset;metadata.libraryReference={kind:'library',id:asset.asset_id,scope:'personal',label:libraryPickerName(asset.name),mediaType:asset.type};}
     }
     return await onQueuePrompt(text,trace,record.chat,metadata,sourceCurrent)!==false;
    }catch(error){if(current(record))onError(error.message);return false;}}}:{}),
   }}});
  }
  record.card.update(trace,{policy,runActive:!!context.streaming,locale:'zh-CN'});return record.card.element;
 }
 function prune(traces){const context=getContext(),live=new Set(traces);for(const record of [...records.values()])if(record.chat!==context.chat||!context.panelActive||context.pageLeaving||!live.has(record.trace)||!validTrace(record.trace))dispose(record);}
 function reset(){for(const record of [...records.values()])dispose(record);}
 return {render,prune,reset};
}
