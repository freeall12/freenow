import {animaticV1Uri,initialAnimaticV1State,validateAnimaticV1State} from './animatic-v1.mjs';
import {characterBlockingV1Uri,initialCharacterBlockingV1State,validateCharacterBlockingV1State} from './character-blocking-v1.mjs';
import {animaticUri,initialAnimaticState} from './animatic.mjs';
import {previsUri,initialPrevisState} from './previs.mjs';
import {ecommercePhotosetUri,initialEcommercePhotosetState} from './ecommerce-photoset.mjs';
const generationAppUris=[animaticUri,previsUri,ecommercePhotosetUri];
import {creativePickerUri,websitePickerUri,resolveCreativePickerReply} from './creative-picker.mjs';
import {createMcpAppCard} from './card.mjs';
import {templatePickerUris} from './template-source.mjs';
import {createTemplateSourceControls} from './template-source-controls.mjs';
import {createMcpAppHost} from './host.mjs';
import {prepareApp,appPolicy,getApp,copyAppState} from './registry.mjs';
import {resolveDirectorMarkupReply} from './director-markup.mjs';
import {performanceRhythmUri,validatePerformanceRhythmState,resolvePerformanceRhythmReply} from './performance-rhythm.mjs';
import {storyRoomUri,initialStoryRoomState,validateStoryRoomState,resolveStoryRoomReply} from './story-room.mjs';
import {actorEmotionUri,initialActorEmotionState,validateActorEmotionState,resolveActorEmotionReply} from './actor-emotion.mjs';
import {productionProgressUri,validateProductionProgressRequest,normalizeProductionProgressResult} from './production-progress.mjs';
import {interactiveLearningUri,initialInteractiveLearningState,validateInteractiveLearningState,resolveInteractiveLearningReply} from './interactive-learning.mjs';
import {libraryPickerUri,initialLibraryPickerState,validateLibraryPickerFindResult,libraryPickerName} from './library-picker.mjs';
import {colorAdjustUri,initialColorAdjustState,validateColorAdjustState,resolveColorAdjustReply} from './color-adjust.mjs';
import {platformResizeUri} from './platform-resize.mjs';
import {cutlistReviewUri,initialCutlistReviewState,validateCutlistReviewState,resolveCutlistReviewReply} from './cutlist-review.mjs';
import {characterBlockingUri,initialCharacterBlockingState,validateCharacterBlockingState} from './character-blocking.mjs';
import {productKitUri,initialProductKitState,validateProductKitState} from './product-kit.mjs';
import {adReviewUri,initialAdReviewState,validateAdReviewState} from './ad-review.mjs';
import {layerComposerUri,initialLayerComposerState,validateLayerComposerState} from './layer-composer.mjs';
const sourceWorkflowUris=[animaticV1Uri,characterBlockingV1Uri,characterBlockingUri,productKitUri,adReviewUri];
export {prepareApp};

// The iframe keeps its real preview bytes; model continuation receives only
// the app contract. Media previews and host source snapshots are not evidence.
export function projectAppModelResult(entry){
 if(entry?.result?.kind!=='mcp_app')return entry;
 function project(value){
  if(typeof value==='string'&&/^(?:data:|blob:)/i.test(value))return '[local preview omitted]';
  if(Array.isArray(value))return value.map(project);
  if(!value||typeof value!=='object')return value;
  return Object.fromEntries(Object.entries(value).filter(([key])=>!['preview','preview_url','media_url','media_ref','poster_ref','portrait','thumbnail_url','poster_url','sourceContext'].includes(key)&&!key.endsWith('SourceContext')).map(([key,item])=>[key,project(item)]));
 }
 const result=project(entry.result);
 if(templatePickerUris.includes(result.resource_uri))result.local_template_body={status:'configuration_required',reference_only:true,reason:'Automatic retrieval of exact template HTML is not configured. Object keys and SHA256 are identities, not URLs. If current host-verified template source metadata is available in artifact context, read and edit its latest editable artifact revision; preserve the original source. Otherwise request an authorized local file matching the selected SHA256 before claiming an edit of that exact template. Independent free HTML creation remains available without template import. Do not contact TapNow services or fabricate missing original template bytes.'};
 return {...entry,result};
}

/** Normal mutation continuation; the model supplies only durable identities.
 * Actual review text/state and execution authority remain in the host. */
export function createCutlistAssemblyRoute({getContext,getSourceContext,executor,persistConversation}){
 const clone=value=>structuredClone(value),same=(left,right)=>JSON.stringify(left)===JSON.stringify(right);
 return async function assemble(args,{approved=false,signal}={}){
  if(!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).length!==3||Object.keys(args).some(key=>!['trace_id','handoff_id','operation_id'].includes(key))||!['trace_id','operation_id'].every(key=>typeof args[key]==='string'&&/^[A-Za-z0-9_-]{1,180}$/.test(args[key]))||typeof args.handoff_id!=='string'||!/^cutlist_[a-f0-9]{64}$/.test(args.handoff_id))throw Error('拼装执行只接受已保存审核与操作标识');
  args=clone(args);if(approved!==true)throw Error('拼装执行尚未通过正常画布修改确认');
  const context=getContext(),chat=context.chat,trace=chat?.messages?.find(item=>item.id===args.trace_id);
  if(!context.panelActive||context.pageLeaving||trace?.name!=='show_app'||trace.status!=='done'||trace.error||trace.result?.error||trace.result?.kind!=='mcp_app'||trace.result.resource_uri!==cutlistReviewUri||trace.args?.resource_uri!==cutlistReviewUri||!trace.appHandoffs?.includes(args.handoff_id))throw Error('缺少当前会话已保存的拼装审核交接');
  const matches=[...(chat.messages||[]).filter(item=>item.role==='user'),...(chat.queuedMessages||[])].filter(item=>item.widgetOrigin?.traceId===trace.id&&item.widgetOrigin.resourceUri===cutlistReviewUri&&item.widgetOrigin.handoffId===args.handoff_id&&item.widgetOrigin.callId===trace.callId);
  if(!matches.length)throw Error('拼装计划尚未作为真实用户审核交接保存');
  const accepted=matches[0],acceptedText=accepted.text,acceptedOrigin=clone(accepted.widgetOrigin),result=trace.result,response=result.response,state=clone(trace.appState),sourceBinding=result.cutlistSourceContext;
  if(typeof acceptedText!=='string'||matches.some(item=>item.text!==acceptedText))throw Error('拼装审核交接内容冲突');
  const priorReceipt=clone(trace.cutlistAssemblyReceipts?.find(item=>item.operationId===args.operation_id)||null);
  if(priorReceipt&&(priorReceipt.trace_id!==trace.id||priorReceipt.handoff_id!==args.handoff_id))throw Error('已有拼装操作与本次审核交接不一致');
  const message=acceptedText.split('\n')[0],reply=await resolveCutlistReviewReply(message,response,state);
  if(reply.kind!=='confirmed'||reply.metadata.handoffId!==args.handoff_id||reply.text!==acceptedText)throw Error('原审核交接与当前已保存拼装计划不一致');
  const guard=()=>{const now=getContext();if(signal?.aborted)throw signal.reason||new DOMException('拼装已取消','AbortError');if(now.chat!==chat||!now.panelActive||now.pageLeaving||!chat.messages.includes(trace)||trace.status!=='done'||trace.result!==result||trace.result.response!==response||trace.result.cutlistSourceContext!==sourceBinding||!same(trace.appState,state)||!trace.appHandoffs?.includes(args.handoff_id)||accepted.text!==acceptedText||!same(accepted.widgetOrigin,acceptedOrigin)||!(chat.messages.includes(accepted)||chat.queuedMessages?.includes(accepted)))throw Error('拼装执行期间会话、审核状态或交接来源已变化');return true;};
  guard();if(await persistConversation()===false)throw Error('拼装审核与会话尚未实际保存');guard();
  const source=getSourceContext(response,trace,chat),sourceContext={guard:async options=>{guard();await source.guard(options);guard();return true;},isCurrent:()=>{try{return guard()&&source.isCurrent();}catch{return false;}}};
  try{
   await sourceContext.guard({verifyBytes:true});
   const receipt=await executor.execute({operationId:args.operation_id,message,response,state,authorization:{kind:'local_cutlist_assembly',handoffId:args.handoff_id},...(priorReceipt?{expectedReceipt:priorReceipt}:{})},{sourceContext,signal});
   if(typeof executor.validateReceiptCurrent!=='function')throw Error('拼装执行器缺少真实产物回执校验');
   if(await executor.validateReceiptCurrent(receipt,{sourceContext,signal})===false)throw Error('拼装实际产物回执失效');
   // A visible saved result remains real if the review became stale after save.
   if(!sourceContext.isCurrent())throw Error('拼装结果已入图并保存，但来源已变化；请核对实际节点 '+(receipt.nodeIds||[]).join(', '));
   if(receipt.applied!==true||receipt.saved!==true||!Array.isArray(receipt.nodeIds)||!receipt.nodeIds.length)throw Error('拼装执行未返回实际已保存的视频节点');
   if(priorReceipt&&['nodeIds','mediaSha256','duration','width','height'].some(key=>!same(priorReceipt[key],receipt[key])))throw Error('已有拼装产物与原持久回执不一致，不会重新声明成功');
   const saved={...clone(receipt),trace_id:trace.id,handoff_id:args.handoff_id},previousRecords=trace.cutlistAssemblyReceipts,next=[...(previousRecords||[]).filter(item=>item.operationId!==args.operation_id),saved];trace.cutlistAssemblyReceipts=next;
   try{if(await persistConversation()===false)throw Error('会话回执保存未提交');guard();if(await executor.validateReceiptCurrent(receipt,{sourceContext,signal})===false)throw Error('会话保存期间拼装实际产物回执失效');guard();}
   catch(error){
    // Only undo this write. A later successful operation owns its own receipt.
    if(trace.cutlistAssemblyReceipts===next){if(previousRecords===undefined)delete trace.cutlistAssemblyReceipts;else trace.cutlistAssemblyReceipts=previousRecords;}
    else if(Array.isArray(trace.cutlistAssemblyReceipts))trace.cutlistAssemblyReceipts=trace.cutlistAssemblyReceipts.filter(item=>item!==saved);
    try{if(await persistConversation()===false)throw Error('补偿保存未提交');}
    catch(failure){throw Error('拼装结果已入图并保存，但会话回执及补偿保存失败，请保留本页核对节点 '+receipt.nodeIds.join(', ')+'：'+failure.message);}
    throw Error('拼装结果已入图并保存，会话回执保存失败并已撤销该回执，请核对节点 '+receipt.nodeIds.join(', ')+'：'+error.message);
   }
   return saved;
  }finally{source.dispose?.();}
 };
}

export function createAppController({getContext,onQueuePrompt,onSaveState,getActorSourceContext,onSaveExpressionGuide,getProductionSourceContext,onProductionProgressQuery,getLibrarySourceContext,onLibraryAddToCanvas,getColorAdjustSourceContext,onApplyColorAdjust,onColorAdjustContext,getPlatformResizeSourceContext,onPlatformResizeApply,getCutlistSourceContext,getAnimaticV1SourceContext,getCharacterBlockingSourceContext,getProductKitSourceContext,getAdReviewSourceContext,getLayerComposerSourceContext,onApplyLayerComposer,onLayerComposerContext,getGenerationAppSourceContext,onGenerationAppTool,onGenerationAppContext,onValidateAppReply,onAppReply,onAppReplyRunStatus,templateSourceRuntime,onOpenTemplateArtifact,onDiscussTemplateArtifact,onError=()=>{}}){
 const records=new Map();
 let closeWork=null,closeToken=null;
 async function validateGenerationSource(record){const source=record.generationContext;if(!source)throw Error('生成应用缺少真实来源绑定');await source.guard();await source.validateSourcesCurrent?.();}
 async function validateWorkflowSource(record){const source=record.workflowContext;if(!source)throw Error('应用缺少真实来源绑定');if(record.resourceUri===productKitUri){await source.guard();await source.validateSourceCurrent();}else await source.guard(record.resourceUri===adReviewUri?{verifyBytes:true}:undefined);}
 const validTrace=trace=>trace?.name==='show_app'&&trace.status==='done'&&!trace.error&&!trace.result?.error&&trace.result?.kind==='mcp_app'&&trace.args?.resource_uri===trace.result.resource_uri&&!!getApp(trace.result.resource_uri);
 function current(record){const context=getContext();return !record.disposed&&records.get(record.trace.id)===record&&context.chat===record.chat&&context.panelActive&&!context.pageLeaving&&record.chat.messages.includes(record.trace)&&validTrace(record.trace)&&record.card?.element.isConnected;}
 function dispose(record){record.disposed=true;record.templateControls?.destroy();record.productionContext?.dispose?.();record.colorContext?.dispose?.();record.resizeContext?.dispose?.();record.cutlistContext?.dispose?.();record.workflowContext?.dispose?.();record.layerContext?.dispose?.();record.generationContext?.dispose?.();record.card.destroy();records.delete(record.trace.id);}
 function persistState(record,value,{initialize=false,restore=false}={}){
  const {trace}=record,result=trace.result,response=result.response;
  // Official story/actor pages debounce state updates and do not flush on
  // confirmation. Serialize real commits; a default is never a saved receipt.
  const work=record.stateWork.catch(()=>{}).then(async()=>{
   if(!current(record)||trace.result!==result||trace.result.response!==response)throw Error('应用所属会话已切换');
   if(initialize&&trace.appState!=null)return;
   let state=copyAppState(restore?trace.appState:value,getApp(record.resourceUri).stateLimit);
   if(generationAppUris.includes(record.resourceUri)){await validateGenerationSource(record);if(!current(record))throw Error('生成应用来源已切换');state=await record.generationContext.validateState(state);}
   if(sourceWorkflowUris.includes(record.resourceUri)){if(!record.workflowContext)throw Error('应用缺少真实来源绑定');await validateWorkflowSource(record);if(!current(record))throw Error('应用来源已切换');state=record.workflowContext.validateState?record.workflowContext.validateState(state):new Map([[animaticV1Uri,validateAnimaticV1State],[characterBlockingV1Uri,validateCharacterBlockingV1State],[characterBlockingUri,validateCharacterBlockingState],[productKitUri,validateProductKitState],[adReviewUri,validateAdReviewState]]).get(record.resourceUri)(state,response);}
   if(record.resourceUri===performanceRhythmUri)state=validatePerformanceRhythmState(state,response.duration_ms);
   if(record.resourceUri===storyRoomUri)state=validateStoryRoomState(state,response);
   if(record.resourceUri===actorEmotionUri)state=validateActorEmotionState(state,response);
   if(record.resourceUri===layerComposerUri){if(!record.layerContext)throw Error('图层缺少真实来源绑定');await record.layerContext.guard();if(!current(record))throw Error('图层来源已切换');state=validateLayerComposerState(state,response);}
   if(record.resourceUri===colorAdjustUri)state=validateColorAdjustState(state,response);
   if(record.resourceUri===cutlistReviewUri){await record.cutlistContext?.guard();if(!current(record))throw Error('审片来源已切换');state=validateCutlistReviewState(state,response);}
   if(record.resourceUri===interactiveLearningUri)state=validateInteractiveLearningState(state,response);
   if(record.resourceUri===libraryPickerUri){await record.libraryContext?.guard();if(!current(record))throw Error('素材库所属会话已切换');state=record.libraryContext.validateState(state);}
   if(await onSaveState(record.chat,trace,state)===false)throw Error('应用状态未能保存');
   if(generationAppUris.includes(record.resourceUri)){await validateGenerationSource(record);if(trace.appState!==state)throw Error('生成应用实际保存状态已被替换');}
   if(record.resourceUri===layerComposerUri){await record.layerContext.guard();if(trace.appState!==state)throw Error('图层实际保存状态已被替换');}
   if(sourceWorkflowUris.includes(record.resourceUri)){await validateWorkflowSource(record);if(trace.appState!==state)throw Error('应用实际保存状态已被替换');}
   if(!current(record)||trace.result!==result||trace.result.response!==response)throw Error('应用所属会话已切换');
  });
  record.stateWork=work;
  void work.then(()=>{if(record.stateWork===work)record.stateError=null;},error=>{if(record.stateWork===work)record.stateError=error;});
  return work;
 }
 async function waitForState(record){
  let work;do{work=record.stateWork;await work;}while(work!==record.stateWork);
 }
 function sourceGuard(record,isSourceCurrent=()=>true,{ignoreState=false}={}){
  const {trace}=record,savedState=trace.appState,appResult=trace.result,response=appResult.response,stateWork=record.stateWork;
  return ()=>{try{return current(record)&&isSourceCurrent()&&(ignoreState||record.stateWork===stateWork&&!record.stateError&&trace.appState===savedState)&&trace.result===appResult&&trace.result.response===response&&trace.result.resource_uri===record.resourceUri&&(record.resourceUri!==actorEmotionUri||record.actorContext?.guard()===true)&&(record.resourceUri!==libraryPickerUri||record.libraryContext?.isCurrent()===true)&&(record.resourceUri!==productionProgressUri||record.productionContext?.guard()===true)&&(record.resourceUri!==colorAdjustUri||record.colorContext?.isCurrent()===true)&&(record.resourceUri!==layerComposerUri||record.layerContext?.isCurrent()===true)&&(record.resourceUri!==platformResizeUri||record.resizeContext?.isCurrent()===true)&&(record.resourceUri!==cutlistReviewUri||record.cutlistContext?.isCurrent()===true)&&(!generationAppUris.includes(record.resourceUri)||record.generationContext?.isCurrent()===true)&&(!sourceWorkflowUris.includes(record.resourceUri)||record.workflowContext?.isCurrent()===true);}catch{return false;}};
 }
 function syncPrevisReplyStatus(record){if(record.resourceUri!==previsUri)return;const receipt=record.trace.appReplyReceipts?.at(-1);if(receipt&&['running','waiting','completed','unknown'].includes(receipt.status))record.card?.updateAppReplyStatus?.(receipt.reply_id,receipt.status);}
 function render(trace){
  const context=getContext();if(trace.name!=='show_app')return null;
  let record=records.get(trace.id);
  if(record&&(record.chat!==context.chat||record.trace!==trace||record.resourceUri!==trace.result?.resource_uri)){dispose(record);record=null;}
  if(!validTrace(trace)||!context.panelActive||context.pageLeaving||!context.chat.messages.includes(trace)){if(record)dispose(record);return null;}
  const policy=appPolicy(trace.result.resource_uri);
  if(!record){
   record={trace,chat:context.chat,resourceUri:trace.result.resource_uri,disposed:false,card:null,stateWork:Promise.resolve(),stateError:null,actorContext:null,generationResult:trace.result};records.set(trace.id,record);
   if(generationAppUris.includes(record.resourceUri)){try{record.generationContext=getGenerationAppSourceContext?.(trace.result.response,trace,record.chat);}catch(error){onError(error.message);}}
   if(record.resourceUri===actorEmotionUri){try{record.actorContext=getActorSourceContext?.(trace.result.response,trace,record.chat);}catch(error){onError(error.message);}}
   if(record.resourceUri===productionProgressUri){try{record.productionContext=getProductionSourceContext?.(trace.result.response,trace,record.chat);}catch(error){onError(error.message);}}
   if(record.resourceUri===libraryPickerUri){try{record.libraryContext=getLibrarySourceContext?.(trace.result.response,trace,record.chat);}catch(error){onError(error.message);}}
   if(record.resourceUri===colorAdjustUri){try{record.colorContext=getColorAdjustSourceContext?.(trace.result.response,trace,record.chat);}catch(error){onError(error.message);}}
   if(record.resourceUri===layerComposerUri){try{record.layerContext=getLayerComposerSourceContext?.(trace.result.response,trace,record.chat);}catch(error){onError(error.message);}}
   if(record.resourceUri===platformResizeUri){try{record.resizeContext=getPlatformResizeSourceContext?.(trace.result.response,trace,record.chat);}catch(error){onError(error.message);}}
   if(record.resourceUri===cutlistReviewUri){try{record.cutlistContext=getCutlistSourceContext?.(trace.result.response,trace,record.chat);}catch(error){onError(error.message);}}
   if(sourceWorkflowUris.includes(record.resourceUri)){try{const getSource=new Map([[animaticV1Uri,getAnimaticV1SourceContext],[characterBlockingV1Uri,getCharacterBlockingSourceContext],[characterBlockingUri,getCharacterBlockingSourceContext],[productKitUri,getProductKitSourceContext],[adReviewUri,getAdReviewSourceContext]]).get(record.resourceUri);record.workflowContext=getSource?.(trace.result.response,trace,record.chat);}catch(error){onError(error.message);}}
   record.card=createMcpAppCard({trace,policy,createHost:createMcpAppHost,hostOptions:{isCurrent:()=>current(record),allowResource:uri=>!!getApp(uri),widgetStateLimit:getApp(record.resourceUri).stateLimit,csp:getApp(record.resourceUri).csp,callbacks:{
    onReady:()=>{
     syncPrevisReplyStatus(record);
     // A reload restores the committed UI state. Retry its real save after a
     // failure, reading at execution time so newer queued edits are preserved.
     if(trace.appState!=null){if(record.stateError)void persistState(record,null,{restore:true}).catch(error=>{if(current(record))onError(error.message);});return;}
     const initial=record.resourceUri===animaticV1Uri?initialAnimaticV1State:record.resourceUri===characterBlockingV1Uri?initialCharacterBlockingV1State:record.resourceUri===storyRoomUri?initialStoryRoomState:record.resourceUri===actorEmotionUri?initialActorEmotionState:record.resourceUri===interactiveLearningUri?initialInteractiveLearningState:record.resourceUri===libraryPickerUri?initialLibraryPickerState:record.resourceUri===colorAdjustUri?initialColorAdjustState:record.resourceUri===cutlistReviewUri?initialCutlistReviewState:record.resourceUri===characterBlockingUri?initialCharacterBlockingState:record.resourceUri===productKitUri?initialProductKitState:record.resourceUri===adReviewUri?initialAdReviewState:record.resourceUri===layerComposerUri?initialLayerComposerState:record.resourceUri===animaticUri?initialAnimaticState:record.resourceUri===previsUri?initialPrevisState:record.resourceUri===ecommercePhotosetUri?initialEcommercePhotosetState:null;
     const value=initial?.(trace.result.response);
     if(value)void persistState(record,value,{initialize:true}).catch(error=>{if(current(record))onError(error.message);});
    },
    ...(![productionProgressUri,platformResizeUri].includes(record.resourceUri)?{onSetWidgetState:value=>persistState(record,value)}:{}),
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
    ...(generationAppUris.includes(record.resourceUri)?{
     onGenerationAppTool:async(name,args,options,isSourceCurrent=()=>true)=>{
      await waitForState(record);await validateGenerationSource(record);const sourceCurrent=sourceGuard(record,isSourceCurrent,{ignoreState:record.resourceUri!==ecommercePhotosetUri});if(!sourceCurrent()||!name.endsWith('_lookup')&&getContext().streaming)throw Error('生成应用来源或状态已切换');
      const receipt=await onGenerationAppTool(name,args,trace,record.chat,{...options,isCurrent:sourceCurrent,sourceContext:record.generationContext});if(!sourceCurrent())throw Error('生成操作期间来源或状态已切换');return {content:[],structuredContent:receipt?.structuredContent??receipt,...(receipt?.isError?{isError:true}:{})};
     },
     onGenerationAppContext:async(params,options,isSourceCurrent=()=>true)=>{
      await waitForState(record);await validateGenerationSource(record);const sourceCurrent=sourceGuard(record,isSourceCurrent,{ignoreState:true});if(!sourceCurrent()||getContext().streaming)throw Error('生成上下文来源已切换');
      const receipt=await onGenerationAppContext(params,trace,record.chat,{...options,isCurrent:sourceCurrent,sourceContext:record.generationContext});if(!sourceCurrent())throw Error('生成上下文保存期间来源已切换');return receipt;
     },
    }:{}),
    ...(record.resourceUri===previsUri?{
     onValidateAppReply:async(details,options,isSourceCurrent=()=>true)=>{await waitForState(record);await validateGenerationSource(record);const sourceCurrent=sourceGuard(record,isSourceCurrent);if(!sourceCurrent())throw Error('预演回复来源已切换');return onValidateAppReply(details,trace,record.chat,{...options,isCurrent:sourceCurrent,sourceContext:record.generationContext});},
     onAppReply:async(details,options,isSourceCurrent=()=>true)=>{await waitForState(record);await validateGenerationSource(record);const sourceCurrent=sourceGuard(record,isSourceCurrent);if(!sourceCurrent())throw Error('预演回复来源已切换');return onAppReply(details,trace,record.chat,{...options,isCurrent:sourceCurrent,sourceContext:record.generationContext});},
     onAppReplyRunStatus:async(params,isSourceCurrent=()=>true)=>{if(!current(record)||!isSourceCurrent())throw Error('预演回复查询来源已切换');return onAppReplyRunStatus(params,trace,record.chat);},
    }:{}),
    ...(record.resourceUri===colorAdjustUri?{
     onApplyColorAdjust:async(args,{callId,userAction},isSourceCurrent=()=>true)=>{
      const sourceCurrent=sourceGuard(record,isSourceCurrent,{ignoreState:true});if(!sourceCurrent()||getContext().streaming)throw Error('调色来源已切换或会话正在运行');
      const receipt=await onApplyColorAdjust(args,trace,record.chat,{callId,userAction,isCurrent:sourceCurrent,sourceContext:record.colorContext});
      if(!sourceCurrent()||getContext().streaming)throw Error('调色保存期间来源已切换');return {content:[],structuredContent:receipt};
     },
     onColorAdjustContext:async(params,options,isSourceCurrent=()=>true)=>{
      const sourceCurrent=sourceGuard(record,isSourceCurrent,{ignoreState:true});if(!sourceCurrent()||getContext().streaming)throw Error('调色来源已切换或会话正在运行');
      const receipt=await onColorAdjustContext(params,trace,record.chat,{...options,isCurrent:sourceCurrent,sourceContext:record.colorContext});
      if(!sourceCurrent()||getContext().streaming)throw Error('调色上下文保存期间来源已切换');return receipt;
     },
    }:{}),
    ...(record.resourceUri===layerComposerUri?{
     onApplyLayerComposer:async(args,{callId,userAction},isSourceCurrent=()=>true)=>{
      await waitForState(record);await record.layerContext?.guard();const sourceCurrent=sourceGuard(record,isSourceCurrent);if(!sourceCurrent()||getContext().streaming)throw Error('图层来源已切换或会话正在运行');
      const receipt=await onApplyLayerComposer(args,trace,record.chat,{callId,userAction,isCurrent:sourceCurrent,sourceContext:record.layerContext});
      if(!sourceCurrent()||getContext().streaming)throw Error('图层合成保存期间来源或状态已切换');return {content:[],structuredContent:receipt};
     },
     onLayerComposerContext:async(params,options,isSourceCurrent=()=>true)=>{
      await waitForState(record);await record.layerContext?.guard();const sourceCurrent=sourceGuard(record,isSourceCurrent);if(!sourceCurrent()||getContext().streaming)throw Error('图层来源已切换或会话正在运行');
      const receipt=await onLayerComposerContext(params,trace,record.chat,{...options,isCurrent:sourceCurrent,sourceContext:record.layerContext});
      if(!sourceCurrent()||getContext().streaming)throw Error('图层上下文保存期间来源或状态已切换');return receipt;
     },
    }:{}),
    ...(record.resourceUri===platformResizeUri?{onPlatformResizeApply:async(args,{callId,userAction},isSourceCurrent=()=>true)=>{
     await record.resizeContext?.guard();const sourceCurrent=sourceGuard(record,isSourceCurrent);if(!sourceCurrent()||getContext().streaming)throw Error('平台裁切来源已切换或会话正在运行');
     const receipt=await onPlatformResizeApply(args,trace,record.chat,{callId,userAction,isCurrent:sourceCurrent,sourceContext:record.resizeContext});
     if(!sourceCurrent()||getContext().streaming)throw Error('平台裁切保存期间来源已切换');return {content:[],structuredContent:receipt};
    }}:{}),
    ...(record.resourceUri===actorEmotionUri&&typeof onSaveExpressionGuide==='function'?{onSaveExpressionGuide:async(args,{callId},isSourceCurrent=()=>true)=>{
     await waitForState(record);const sourceCurrent=sourceGuard(record,isSourceCurrent);
     if(!sourceCurrent()||getContext().streaming)throw Error('人物情绪来源已切换或会话正在运行');
     const receipt=await onSaveExpressionGuide(args,trace,record.chat,{callId,isCurrent:sourceCurrent,sourceContext:record.actorContext});
     if(!sourceCurrent()||getContext().streaming)throw Error('保存期间人物情绪来源已切换');
     return {content:[],structuredContent:receipt};
    }}:{}),
    ...(![productionProgressUri,platformResizeUri].includes(record.resourceUri)?{onSendPrompt:async(text,metadata,isSourceCurrent=()=>true)=>{if(!current(record)||!isSourceCurrent())return false;try{
     await waitForState(record);
     if(generationAppUris.includes(record.resourceUri)){await validateGenerationSource(record);if(!current(record))throw Error('生成应用来源已切换');record.generationContext.validateState(trace.appState);}
   if(sourceWorkflowUris.includes(record.resourceUri)){if(!record.workflowContext)throw Error('应用缺少真实来源绑定');await validateWorkflowSource(record);}
     if(record.resourceUri===libraryPickerUri)await record.libraryContext?.guard();
     if(record.resourceUri===layerComposerUri)await record.layerContext?.guard();
     if(record.resourceUri===cutlistReviewUri)await record.cutlistContext?.guard({verifyBytes:true});
     const savedState=trace.appState,appResult=trace.result,response=appResult.response;
     const baseCurrent=sourceGuard(record,isSourceCurrent),savedGuide=record.resourceUri===actorEmotionUri?record.actorContext?.readGuide():null;
     const sourceCurrent=()=>baseCurrent()&&(record.resourceUri!==actorEmotionUri||record.actorContext.readGuide()===savedGuide);
     if(!sourceCurrent()||getContext().streaming)return false;
     if([creativePickerUri,websitePickerUri].includes(record.resourceUri)){const reply=resolveCreativePickerReply(text,response,savedState,metadata,record.resourceUri,getContext().locale||'zh-CN');text=reply.text;metadata=reply.metadata;}
     if(['ui://tapnow/director-markup@v1',performanceRhythmUri,storyRoomUri,actorEmotionUri,interactiveLearningUri,libraryPickerUri,colorAdjustUri,layerComposerUri,cutlistReviewUri,...sourceWorkflowUris,...generationAppUris].includes(record.resourceUri)){
      let reply;
      if(record.resourceUri===actorEmotionUri){
       const guide=savedGuide;
       await record.actorContext.validateGuideCurrent(guide);
       if(!sourceCurrent()||record.actorContext.readGuide()!==guide)return false;
       reply=await resolveActorEmotionReply(text,response,savedState,guide);
       if(record.actorContext.readGuide()!==guide)return false;
      }else if(generationAppUris.includes(record.resourceUri))reply=await record.generationContext.reply(text,savedState,metadata);
      else if(sourceWorkflowUris.includes(record.resourceUri))reply=await record.workflowContext.reply(text,savedState);
      else if(record.resourceUri===layerComposerUri)reply=await record.layerContext.reply(text);
      else if(record.resourceUri===colorAdjustUri)reply=await resolveColorAdjustReply(text,response);
      else if(record.resourceUri===cutlistReviewUri)reply=await resolveCutlistReviewReply(text,response,savedState);
      else if(record.resourceUri===interactiveLearningUri)reply=await resolveInteractiveLearningReply(text,response,savedState);
      else if(record.resourceUri===libraryPickerUri)reply=await record.libraryContext.reply(text,savedState,{locale:getContext().locale||'zh-CN',userAction:true,isCurrent:sourceCurrent});
      else if(record.resourceUri===storyRoomUri)reply=await resolveStoryRoomReply(text,response,savedState);
      else if(record.resourceUri===performanceRhythmUri)reply=await resolvePerformanceRhythmReply(text,response,savedState);
      else reply=await resolveDirectorMarkupReply(text,response.draft,savedState);
      if(sourceWorkflowUris.includes(record.resourceUri))await validateWorkflowSource(record);
      if(!sourceCurrent()||getContext().streaming)return false;
      text=reply.text;metadata={...metadata,...reply.metadata};
      if(record.resourceUri===libraryPickerUri){const asset=reply.result.asset;metadata.libraryReference={kind:'library',id:asset.asset_id,scope:'personal',label:libraryPickerName(asset.name),mediaType:asset.type};}
     }
     return await onQueuePrompt(text,trace,record.chat,metadata,sourceCurrent,generationAppUris.includes(record.resourceUri)?async()=>{await validateGenerationSource(record);if(!sourceCurrent())throw Error('生成应用消息保存期间真实来源或状态已切换');}:sourceWorkflowUris.includes(record.resourceUri)?async()=>{await validateWorkflowSource(record);if(!sourceCurrent())throw Error('应用消息保存期间真实来源或状态已切换');}:record.resourceUri===layerComposerUri?async()=>{await record.layerContext.validateSourcesCurrent();if(!sourceCurrent())throw Error('图层跳过消息保存期间来源或状态已切换');}:undefined)!==false;
    }catch(error){if(current(record))onError(error.message);return false;}}}:{}),
   }}});
  }
  if(generationAppUris.includes(record.resourceUri)&&record.generationResult!==trace.result){record.generationContext?.dispose?.();record.generationContext=getGenerationAppSourceContext?.(trace.result.response,trace,record.chat);record.generationResult=trace.result;record.stateWork=Promise.resolve();record.stateError=null;}
  if(templateSourceRuntime&&templatePickerUris.includes(record.resourceUri)&&!record.templateControls){record.templateControls=createTemplateSourceControls({trace,runtime:templateSourceRuntime,onOpenArtifact:onOpenTemplateArtifact,onDiscussArtifact:onDiscussTemplateArtifact,onError});record.card.element.append(record.templateControls.element);}
  void record.templateControls?.refresh();
  record.card.update(trace,{policy,runActive:!!context.streaming,locale:'zh-CN'});syncPrevisReplyStatus(record);return record.card.element;
 }
 function prune(traces){const context=getContext(),live=new Set(traces);for(const record of [...records.values()])if(record.chat!==context.chat||!context.panelActive||context.pageLeaving||!live.has(record.trace)||!validTrace(record.trace))dispose(record);}
 function cancelClose(){closeToken=null;closeWork=null;for(const record of records.values())record.card?.cancelClose?.();}
 function prepareToClose(){
  if(closeWork)return closeWork;const token={},snapshot=[...records.values()];closeToken=token;
  // Keep the original chat/panel identity live until every supported iframe has
  // acknowledged the storage transaction. Any failed card unlocks all peers.
  const work=Promise.resolve().then(async()=>{
   for(const record of snapshot){if(closeToken!==token||!current(record))throw Error('关闭前应用所属会话已切换');await record.card.prepareToClose();await waitForState(record);}
   if(closeToken!==token||records.size!==snapshot.length||snapshot.some(record=>!current(record)))throw Error('关闭前应用来源已变化');return true;
  }).catch(error=>{if(closeToken===token)cancelClose();onError(error.message);throw error;});closeWork=work;return work;
 }
 function reset(){cancelClose();for(const record of [...records.values()])dispose(record);}
 const hasPendingCloseApps=()=>[...records.values()].some(record=>['ui://tapnow/performance-rhythm@v3','ui://tapnow/story-room@v1','ui://tapnow/character-blocking@v3','ui://tapnow/cutlist-review@v1','ui://tapnow/product-kit@v1','ui://tapnow/director-markup@v1','ui://tapnow/color-adjust@v2'].includes(record.resourceUri)&&!record.disposed);
 return {render,prune,reset,prepareToClose,cancelClose,hasPendingCloseApps};
}
