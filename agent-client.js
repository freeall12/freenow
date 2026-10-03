(() => {
 'use strict';
 const project=window.CanvasProjectContext?.resolve()||{id:window.CanvasProjects?.id()||'canvas',storageKey:key=>key,namespace:window.CANVAS_DB_NAME||'tapnow-canvas-replica'},operations=window.CanvasProjectContext?.createOperations();
 const track=operation=>operations?operations.track(operation):operation();
 const canvasPersistence={save:()=>app.saveProject(),flush:()=>window.CanvasStore.flush()};
 const app=window.CanvasApp,clone=v=>structuredClone(v),el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
 const btn=(icon,label,fn,cls='',text='')=>{const b=el('button',cls,text);b.type='button';if(icon)b.insertAdjacentHTML('afterbegin',window.STAGE_ICONS[label]||window.UI_ICONS[icon]||'');b.setAttribute('aria-label',label);b.title=label;b.onclick=fn;return b;};
 let panel=null,current=0,chats=[],skills=[],controller=null,busy=false,sessionId=null,pendingResolve=null,pendingTraceId=null;
 let messageRows=new WeakMap(),activeStream=null,streamSaveTimer=0,pageLeaving=false,appQueueSaving=false,migratingConversationAssets=false;
 let recoveryModule=null,recoveryController=null,recoveryEpoch=0,recoveryChatId=null,recoveryRunning=false,recoveryPreparing=false;
 const recoveryReady=Promise.all([import('./src/features/agent-recovery/model.mjs'),import('./src/features/agent-recovery/view.mjs'),import('./src/features/agent-recovery/journal.mjs'),import('./src/features/agent-recovery/generation-settlement.mjs')]).then(([model,view,journal,settlement])=>{recoveryModule={...model,...view,...journal,...settlement};const style=el('link');style.rel='stylesheet';style.href='src/features/agent-recovery/styles.css';document.head.append(style);recoveryController=model.createRecoveryController({request:data=>request('state',data),isCurrent:(record,scope)=>!pageLeaving&&!!panel&&!busy&&recoveryEpoch===scope.epoch&&project.id===scope.projectId&&draft()===scope.chat&&chats.includes(scope.chat)&&scope.chat.interruptedRuns?.includes(record),persist:async()=>{if(!save())throw Error('核对记录未能保存');await flushConversation();},changed:()=>{if(panel)render();}});return recoveryModule;});
 recoveryReady.catch(error=>notice('中断任务核对加载失败：'+error.message));
 let artifactCards=null,reconcileMessages=null;
 let searchResultView=null;
 import('./src/features/agent-search/view.mjs').then(module=>{searchResultView=module.createSearchResult;if(panel)render();}).catch(error=>notice('检索来源展示加载失败：'+error.message));
 const artifactCardsReady=Promise.all([import('./src/features/agent-widgets/integration.mjs'),import('./src/features/agent-messages/reconcile.mjs')]).then(([module,dom])=>{reconcileMessages=dom.reconcileConnectedChildren;artifactCards=module.createArtifactController({getContext:()=>({chat:draft(),panelActive:!!panel,pageLeaving,streaming:busy}),getStore:()=>artifactsReady,onQueuePrompt:queueWidgetPrompt,onUploadMedia:receiveWidgetMedia,onDownloadMedia:downloadWidgetMedia,onError:notice});if(panel)render();return module;});
 artifactCardsReady.catch(error=>notice('互动作品模块加载失败：'+error.message));
 // local-assets.js follows this client in the entrypoint. Resolve the live store
 // at use time so a cached actor module cannot break every app during startup.
 function actorAssetStore(){const assets=window.LocalAssets;if(typeof assets?.put!=='function'||typeof assets?.url!=='function')throw Error('本地素材存储尚未就绪，请等待页面加载完成后重试人物情绪应用');return assets;}
 const actorAssets={put:blob=>actorAssetStore().put(blob),url:asset=>actorAssetStore().url(asset)};
 let appCards=null,appCardsProjection=null,templateSourceRuntime=null,actorGuideRuntime=null,productionProgressRuntime=null,libraryPickerRuntime=null,colorAdjustRuntime=null,platformResizeRuntime=null,cutlistReviewRuntime=null,characterBlockingRuntime=null,characterBlockingV1Runtime=null,animaticV1Runtime=null,productKitRuntime=null,adReviewRuntime=null,layerComposerRuntime=null,animaticRuntime=null,previsRuntime=null,ecommercePhotosetRuntime=null,cutlistAssemblyRoute=null;
 function liveLibrary(){const library=window.CanvasLibrary;if(!Array.isArray(library?.items)||!Array.isArray(library?.folders))throw Error('个人素材库尚未就绪');return library;}
 const libraryAdapter={get items(){return liveLibrary().items;},get folders(){return liveLibrary().folders;}};
 function generationService(method,...args){if(typeof window.GenerationAPI?.[method]!=='function')throw Error('真实制作任务服务尚未就绪，请等待页面加载');return window.GenerationAPI[method](...args);}
 const liveGeneration={getJobs:()=>generationService('getJobs'),submit:(...args)=>generationService('submit',...args),recover:(...args)=>generationService('recover',...args),applyRecovered:(...args)=>generationService('applyRecovered',...args),retryApplication:(...args)=>generationService('retryApplication',...args),cancel:(...args)=>generationService('cancel',...args),availability:(...args)=>generationService('availability',...args),subscribe:(...args)=>generationService('subscribe',...args)};
 const appCardsReady=Promise.all([import('./src/features/agent-apps/integration.mjs'),import('./src/features/agent-apps/actor-guide-runtime.mjs'),import('./src/features/agent-apps/production-progress-runtime.mjs'),import('./src/features/agent-apps/library-picker-runtime.mjs'),import('./src/features/agent-apps/color-adjust-runtime.mjs'),import('./src/features/agent-apps/platform-resize-runtime.mjs'),import('./src/features/agent-apps/cutlist-review-runtime.mjs'),import('./src/features/agent-apps/character-blocking-runtime.mjs'),import('./src/features/agent-apps/product-kit-runtime.mjs'),import('./src/features/agent-apps/ad-review-runtime.mjs'),import('./src/features/agent-apps/layer-composer-runtime.mjs'),import('./src/features/agent-apps/animatic-runtime.mjs'),import('./src/features/agent-apps/previs-runtime.mjs'),import('./src/features/agent-apps/ecommerce-photoset-runtime.mjs'),import('./src/features/agent-apps/template-source-runtime.mjs'),import('./src/features/agent-apps/character-blocking-v1-runtime.mjs'),import('./src/features/agent-apps/animatic-v1-runtime.mjs')]).then(([module,actor,production,library,color,resize,cutlist,blocking,kit,ad,layer,animatic,previs,photoset,templates,blockingV1,animaticV1])=>{appCardsProjection=module.projectAppModelResult;const persistAppReceipt=async()=>{if(!save())throw Error('应用操作会话回执未能保存');await flushConversation();};animaticRuntime=animatic.createAnimaticRuntime({app,localAssets:actorAssets,store:canvasPersistence,getProjectId:()=>window.CanvasProjects?.id?.()||project.id,persistConversation:persistAppReceipt,generation:liveGeneration});previsRuntime=previs.createPrevisRuntime({app,localAssets:actorAssets,store:canvasPersistence,getProjectId:()=>window.CanvasProjects?.id?.()||project.id,persistConversation:persistAppReceipt,generationAPI:liveGeneration});ecommercePhotosetRuntime=photoset.createEcommercePhotosetRuntime({app,localAssets:actorAssets,store:canvasPersistence,getProjectId:()=>window.CanvasProjects?.id?.()||project.id,persistConversation:persistAppReceipt,generationAPI:liveGeneration});characterBlockingV1Runtime=blockingV1.createCharacterBlockingV1Runtime({getProjectId:()=>window.CanvasProjects?.id?.()||project.id});animaticV1Runtime=animaticV1.createAnimaticV1Runtime({app,localAssets:actorAssets,getProjectId:()=>window.CanvasProjects?.id?.()||project.id});characterBlockingRuntime=blocking.createCharacterBlockingRuntime({app,localAssets:actorAssets,getProjectId:()=>window.CanvasProjects?.id?.()||project.id});productKitRuntime=kit.createProductKitRuntime({app,localAssets:actorAssets,getProjectId:()=>window.CanvasProjects?.id?.()||project.id});adReviewRuntime=ad.createAdReviewRuntime({app,localAssets:actorAssets,getProjectId:()=>window.CanvasProjects?.id?.()||project.id});layerComposerRuntime=layer.createLayerComposerRuntime({app,localAssets:actorAssets,store:canvasPersistence,getProjectId:()=>window.CanvasProjects?.id?.()||project.id,persistConversation:persistAppReceipt});colorAdjustRuntime=color.createColorAdjustRuntime({app,localAssets:actorAssets,store:canvasPersistence,getProjectId:()=>window.CanvasProjects?.id?.()||project.id,persistConversation:persistAppReceipt});platformResizeRuntime=resize.createPlatformResizeRuntime({app,localAssets:actorAssets,store:canvasPersistence,getProjectId:()=>window.CanvasProjects?.id?.()||project.id,persistConversation:persistAppReceipt});cutlistAssemblyRoute=module.createCutlistAssemblyRoute({getContext:()=>({chat:draft(),panelActive:!!panel,pageLeaving}),getSourceContext:getCutlistSourceContext,executor:cutlist.createCutlistReviewExecutor({app,localAssets:actorAssets,store:canvasPersistence,getProjectId:()=>window.CanvasProjects?.id?.()||project.id}),persistConversation:persistAppReceipt});cutlistReviewRuntime=cutlist.createCutlistReviewRuntime({app,localAssets:actorAssets,getProjectId:()=>window.CanvasProjects?.id?.()||project.id});productionProgressRuntime=production.createProductionProgressRuntime({app,generationAPI:liveGeneration,getProjectId:()=>window.CanvasProjects?.id?.()||project.id,localAssets:actorAssets});libraryPickerRuntime=library.createLibraryPickerRuntime({app,library:libraryAdapter,localAssets:actorAssets,store:canvasPersistence,getProjectId:()=>window.CanvasProjects?.id?.()||project.id,persistConversation:async()=>{if(!save())throw Error('素材选择会话回执未能保存');await flushConversation();}});actorGuideRuntime=actor.createActorGuideRuntime({app,localAssets:actorAssets,store:canvasPersistence,getProjectId:()=>window.CanvasProjects?.id?.()||project.id,persistConversation:async()=>{if(!save())throw Error('表情参考会话记录未能保存');await flushConversation();}});templateSourceRuntime=templates.createTemplateSourceRuntime({getContext:()=>({chat:draft(),panelActive:!!panel,pageLeaving,streaming:busy,running:!!queueRunner?.running||recoveryRunning||recoveryPreparing}),store:artifactsReady,persistConversation:persistAppReceipt});const importTemplate=templateSourceRuntime.importFile;templateSourceRuntime.importFile=(...args)=>track(()=>importTemplate(...args));appCards=module.createAppController({templateSourceRuntime,onOpenTemplateArtifact:openTemplateArtifact,getContext:()=>({chat:draft(),panelActive:!!panel,pageLeaving,streaming:busy}),onQueuePrompt:queueWidgetPrompt,onSaveState:saveAppState,getActorSourceContext,onSaveExpressionGuide:saveExpressionGuide,getProductionSourceContext,onProductionProgressQuery:queryProductionProgress,getLibrarySourceContext,onLibraryAddToCanvas:addLibraryAsset,getColorAdjustSourceContext,onApplyColorAdjust:applyColorAdjust,onColorAdjustContext:setColorAdjustContext,getPlatformResizeSourceContext,onPlatformResizeApply:applyPlatformResize,getCutlistSourceContext,getAnimaticV1SourceContext,getCharacterBlockingSourceContext,getProductKitSourceContext,getAdReviewSourceContext,getLayerComposerSourceContext,onApplyLayerComposer:applyLayerComposer,onLayerComposerContext:setLayerComposerContext,getGenerationAppSourceContext,onGenerationAppTool,onGenerationAppContext,onValidateAppReply,onAppReply,onAppReplyRunStatus:appReplyRunStatus,onError:notice});if(panel)render();return module;});
 appCardsReady.catch(error=>notice('应用模块加载失败：'+error.message));
 try{chats=JSON.parse(localStorage.getItem(project.storageKey('tapnow-agent-chats'))||'[]');}catch{}if(!chats.length)chats=[newDraft()];
 try{const activeId=localStorage.getItem(project.storageKey('tapnow-agent-active-chat'));const index=chats.findIndex(chat=>chat.id===activeId);if(index>=0)current=index;}catch{}
 let conversations=window.CanvasProjectContext?.createConversations({project,storage:localStorage,store:window.CanvasStore}),conversationsLoaded=false;
 const conversationReady=Promise.all([conversations?.load(),recoveryReady]).then(([saved,recovery])=>{if(saved?.chats?.length){chats=saved.chats;current=Math.max(0,chats.findIndex(chat=>chat.id===saved.activeId));}conversations?.baseline(chats,draft().id);let recovered=false;for(const chat of chats)recovered=recovery.hydrateChat(chat)||recovered;conversationsLoaded=true;if(recovered)persistStreamingNow();return saved;}).catch(error=>{notice('会话读取失败：'+error.message);throw error;});conversationReady.catch(()=>{});
 async function flushConversation(){await conversationReady;await conversations?.flush();}
 async function migrateConversationAttachments(options={}){
  await conversationReady;
  if(migratingConversationAssets||!panel||pageLeaving||busy||queueRunner?.running||recoveryRunning||recoveryPreparing||operations?.pending||chats.some(chat=>chat.activeRun||(chat.queuedMessages?.length&&!chat.queuePauseReason)))throw Error('请先完成或停止当前任务，再迁移对话附件');
  const owner=panel,activeId=draft().id;
  const available=()=>panel===owner&&draft().id===activeId&&!pageLeaving&&!busy&&!queueRunner?.running&&!recoveryRunning&&!recoveryPreparing&&(!operations||operations.pending===1)&&!chats.some(chat=>chat.activeRun||(chat.queuedMessages?.length&&!chat.queuePauseReason));
  migratingConversationAssets=true;
  try{return await track(async()=>{
   composerEditor?.sync(draft());if(!save())throw Error('对话尚未保存，未开始附件迁移');await flushConversation();
   const {createConversationMigration}=await import('./src/features/local-resource-migration/conversations.mjs');
   if(!available())throw Error('当前会话已变化，附件迁移已暂停');
   notice('正在核对并迁移对话附件…');
   const report=await conversations.migrateResources({migrate:createConversationMigration({assets:window.LocalAssets,fetchImpl:options.fetch||window.fetch.bind(window),...(options.index?{index:options.index}:{})}),getCurrent:()=>({chats,activeId:draft().id}),canCommit:available,
    applyCommitted:record=>{
     artifactCards?.reset();appCards?.reset();messageRenderer?.reset();executionRenderer?.reset();queueView?.destroy();queueView=null;composerEditor?.destroy();composerEditor=null;messageRows=new WeakMap();
     chats=record.chats;current=Math.max(0,chats.findIndex(chat=>chat.id===record.activeId));recoveryEpoch++;render();studioChannel?.publish();
    }});
   const missing=report.summary?.unresolved||0,count=report.summary?.changed||0;
   const text=report.status==='local_edits'?'对话在迁移期间有新修改，已保留，请重新核对附件。':report.status?.startsWith('index_')?'本地资源索引暂不可用，原附件已保留。':`${count?'已迁移 '+count+' 项附件引用。':'没有新增可迁移的附件引用。'}${missing?'还有 '+missing+' 项需导入本地文件，原附件已保留。':''}`;
   notice(text);return report;
  });}finally{migratingConversationAssets=false;}
 }
 function newDraft(){return {queuedMessages:[],queuePauseReason:null,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),id:crypto.randomUUID(),title:'新建对话',text:'',refs:[],messages:[],autoConfirm:false,skills:[],selectedModelAtStart:null};}
 let studioChannel=null,composerModule=null,composerEditor=null;
 const conversationScopeReady=import('./src/features/agent-scene/conversation-scope.mjs');
 const composerReady=import('./assets/agent-editor.js').then(module=>{composerModule=module;const style=document.createElement('link');style.rel='stylesheet';style.href='src/features/agent-composer/editor.css';document.head.append(style);if(panel)render();return module;}).catch(error=>notice('输入编辑器加载失败：'+error.message));
 let messageModule=null,messageRenderer=null;
 const messageReady=Promise.all([import('./src/features/agent-messages/messages.mjs'),composerReady]).then(([module,composer])=>{if(!composer)throw Error('消息排版模块加载失败');messageModule=module;const style=el('link');style.rel='stylesheet';style.href='src/features/agent-messages/styles.css';document.head.append(style);messageRenderer=module.createMessageRenderer({renderMarkdown:composer.renderMessageMarkdown,renderComposer:composer.renderComposerDocument,onError:notice,onFeedback:()=>{if(!save())throw Error('反馈未能保存');},onFork:index=>{if(busy)return;const previous=current,fork=module.forkConversation(draft(),index);delete fork.interruptedRuns;chats.push(fork);current=chats.length-1;if(!save()){chats.pop();current=previous;return;}render();focusComposer();}});if(panel)render();});
 messageReady.catch(error=>notice(error.message));
 const streamReady=Promise.all([import('./src/features/agent-stream/transport.mjs'),import('./src/features/agent-stream/state.mjs')]).then(async([transport,state])=>{await conversationReady;
  let recovered=false;for(const chat of chats)recovered=state.recoverStreams(chat.messages)||recovered;
  if(recovered){persistStreamingNow();if(panel)render();}return {...transport,...state};
 });
 streamReady.catch(error=>notice('流式回复模块加载失败：'+error.message));
 function persistStreamingNow(){if(!conversationsLoaded)return;clearTimeout(streamSaveTimer);streamSaveTimer=0;if(conversations){if(!conversations.save(chats,draft().id))notice('回复未能保存');return;}try{localStorage.setItem(project.storageKey('tapnow-agent-chats'),JSON.stringify(chats));}catch{notice('回复未能写入本地存储');}}
 function persistStreamingSoon(){if(!streamSaveTimer)streamSaveTimer=setTimeout(persistStreamingNow,250);}
 function updateStreamRows(chat,messages){
  const list=panel?.querySelector('.agent-messages');if(!list||list.dataset.sessionId!==chat.id)return;
  const position=messageModule?.captureReaderPosition(list),lastAssistant=chat.messages.findLastIndex(message=>message.role==='assistant'&&message.hidden!==true);
  for(const message of messages){
   const index=chat.messages.indexOf(message);let row=messageRows.get(message);
   if(index<0||message.hidden===true){row?.remove();messageRows.delete(message);continue;}
   const options={key:chat.id+':'+index,index,busy,lastAssistant:index===lastAssistant,pendingQuestion:!!pendingQuestion()};
   if(!row?.isConnected||row.parentNode!==list){
    row=messageRenderer?messageRenderer.render(message,options):el('div','agent-message assistant',message.text);messageRows.set(message,row);
    const next=chat.messages.slice(index+1).map(item=>messageRows.get(item)).find(item=>item?.parentNode===list);list.insertBefore(row,next||null);
   }else if(messageRenderer?.updateStreaming)messageRenderer.updateStreaming(row,message,options);else row.textContent=message.text;
  }
  if(messageModule)messageModule.restoreReaderPosition(list,position);
 }
 window.addEventListener('beforeunload',event=>{if(conversations?.unsaved){event.preventDefault();event.returnValue='';}});
 window.addEventListener('pagehide',()=>{pageLeaving=true;templateSourceRuntime?.dispose();recoveryEpoch++;artifactCards?.reset();appCards?.reset();for(const chat of chats){if(chat.queuedMessages?.length||chat.activeRun)chat.queuePauseReason='页面已离开；编辑排队任务后重新发送以继续。';if(chat.activeRun)recoveryModule?.interruptRun(chat,chat.activeRun,{reason:'页面已离开，执行状态待核对'});}activeStream?.state.interrupt('页面已离开，流式回复未完成。请检查任务结果后继续。');controller?.abort();pendingResolve?.(false);persistStreamingNow();});
 window.addEventListener('pageshow',()=>{pageLeaving=false;if(panel)render();});
 let queueModule=null,queueView=null,queueRunner=null,queueHeight=0;
 Promise.all([import('./src/features/agent-queue/queue.mjs'),composerReady]).then(([module,composer])=>{queueModule=module;const style=el('link');style.rel='stylesheet';style.href='src/features/agent-queue/styles.css';document.head.append(style);queueRunner=module.createQueueRunner({getChat:draft,validate:validateSubmission,persist:persistQueue,run:runSubmission,changed:()=>{if(panel)render();},failed:error=>notice(error.message)});if(panel)render();}).catch(error=>notice('队列模块加载失败：'+error.message));
 let executionModule=null,executionRenderer=null,generationJobs=null,generationModel=null,generationBatch=null;
 const executionReady=Promise.all([import('./src/features/agent-execution/view.mjs'),import('./src/features/agent-generation/jobs.mjs'),import('./src/features/agent-generation/model.mjs'),import('./src/features/agent-generation/batch.mjs'),import('./src/features/agent-generation/audio.mjs')]).then(async([module,jobs,model,batch,audio])=>{await conversationReady;
  generationJobs=jobs;generationModel=model;generationBatch={...batch,snapshotAudioCall:audio.snapshotAudioCall};
  executionModule=module;for(const chat of chats){module.recoverTraces(chat.messages);jobs.recoverGenerationJobs(chat.messages,window.GenerationAPI?.getJobs()||[]);}
  const style=el('link');style.rel='stylesheet';style.href='src/features/agent-execution/styles.css';document.head.append(style);
  executionRenderer=module.createExecutionRenderer({onConfirm:(trace,allowed,args)=>{if(trace.id===pendingTraceId&&trace.status==='pending')pendingResolve?.({allowed,args});},appendResults:appendResultCards,renderArtifact:trace=>{if(trace.result?.resource_uri==='ui://tapnow/previs@v3')void restorePrevisSelectionProjection(trace,draft()).catch(error=>notice(error.message));return appCards?.render(trace)||artifactCards?.render(trace)||null;},forms:{onSubmit:submitForm,onDraftChange:saveFormDraft,onEdit:editForm,resolveImage:resolveFormImage,isBusy:()=>busy},generation:{getNodes:()=>app.getState().nodes,getEdges:()=>app.getState().edges,getConfig:id=>{const node=app.getState().nodes.find(n=>n.id===id);return node?window.NodeEditor?.getConfig(node)||{}:{};},getMode:()=>confirmationModule?.getMode()||'ask',setMode:mode=>confirmationModule?.setMode(mode),onChange:()=>save(),onOpenNode:id=>app.select(id,true),resolveAsset:url=>window.LocalAssets?.url(url)||url}});
  window.GenerationAPI?.subscribe(job=>{let updated=false;for(const chat of chats)for(const trace of chat.messages)if(jobs.attachGenerationJob(trace,job)){updated=true;executionRenderer.updateTrace(trace);}if(updated)save();if(job.status==='succeeded'&&job.applied&&!job.applying)for(const chat of chats)if(chat===draft()&&panel&&!pageLeaving)for(const trace of chat.messages)if(trace.result?.resource_uri==='ui://tapnow/previs@v3'&&trace.previsJobs?.some(row=>row.job_id===job.id))void refreshPrevisProjection(trace,chat).catch(error=>notice(error.message));});
  if(panel)render();return module;
 });
 executionReady.catch(error=>notice('执行记录加载失败：'+error.message));
 let questionModule=null,questionWaiter=null,questionView=null,questionHeight=0,questionChatId=null;
 const questionsReady=Promise.all([import('./src/features/agent-questions/view.mjs'),import('./src/features/agent-question-runtime/waiter.mjs')]).then(([view,runtime])=>{
  questionModule=view;questionWaiter=runtime.createQuestionWaiter({validate:window.AgentTools.validateQuestionAnswers,onChange:trace=>{if(!trace)questionChatId=null;if(panel)render();}});return questionWaiter;
 });
 questionsReady.catch(error=>notice('问题面板加载失败：'+error.message));
 function pendingQuestion(){return questionChatId===draft().id?questionWaiter?.current:null;}
 async function requestQuestion(trace,chat,signal){await questionsReady;if(signal?.aborted)throw new DOMException('Aborted','AbortError');questionChatId=chat.id;return questionWaiter.wait(trace,{signal});}
 function mountQuestion(compose,chat){
  const trace=pendingQuestion();if(!trace||!questionModule)return;
  questionView=questionModule.createQuestionSheet({trace,onSubmit:(current,result)=>{
   if(current!==pendingQuestion()||draft()!==chat)throw Error('当前问题已结束或对话已切换');
   const checked=window.AgentTools.validateQuestionAnswers(current.args,result),previous=current.questionDraft;
   current.questionDraft={step:current.args.questions.length-1,answers:checked.answers};if(!save()){current.questionDraft=previous;throw Error('回答未能保存，请重试');}
   return questionWaiter.submit(current,checked);
  },onDraftChange:(current,value)=>{if(current!==pendingQuestion())throw Error('此问题已结束');const previous=current.questionDraft;current.questionDraft=clone(value);if(!save()){current.questionDraft=previous;throw Error('回答草稿未能保存');}},onFreeTextStart:()=>focusComposer(),onHeightChange:height=>{questionHeight=height?height+8:0;updateQueueLayout();}});
  compose.prepend(questionView.element);
 }
 function currentFormChat(trace){const chat=draft();if(pageLeaving||!panel||trace.name!=='show_form'||!chat.messages.includes(trace))throw Error('表单所在对话已切换');return chat;}
 function editForm(trace){currentFormChat(trace);if(busy||trace.status!=='done')throw Error('请先完成或停止当前任务后再修改表单');return true;}
 function saveFormDraft(trace,value){currentFormChat(trace);if(busy)throw Error('当前表单不可修改');const previous=trace.formDraft;trace.formDraft=clone(value);if(!save()){trace.formDraft=previous;throw Error('表单草稿未能保存');}}
 async function resolveFormImage(id){const node=app.getState().nodes.find(node=>node.id===id),chat=draft();const upload=[...(chat.uploads||[]),...chat.messages.flatMap(message=>message.uploads||[])].find(item=>item.id===id&&item.type==='image');const asset=node?.fullImage||node?.image||upload?.asset;return asset?window.LocalAssets?.url(asset)||asset:null;}
 async function submitForm(trace,result,{submissionId}={}){
  const chat=currentFormChat(trace),checked=window.AgentTools.validateFormSubmission(trace.args,result,trace.callId);
  if(typeof submissionId!=='string'||!submissionId.trim()||submissionId.length>180)throw Error('表单提交标识无效');
  const receipt=trace.formSubmissionReceipts?.find(receipt=>receipt.id===submissionId);
  if(receipt){if(JSON.stringify(receipt.result)!==JSON.stringify(checked))throw Error('表单提交标识已用于不同答案');return clone(receipt.result);}
  editForm(trace);if(!queueModule||!queueRunner||!modelModule||!composerModule)throw Error('消息模块正在加载，请稍后再试');
  const text=(trace.formLatestSubmission||Array.isArray(trace.result?.values)?'我修改了表单「':'我提交了表单「')+trace.args.title+'」：'+(checked.skipped?'跳过此表单；这不代表批准依赖此表单的操作。':checked.values.map(value=>value.field_label+'：'+(value.display??'未填写')).join('；').slice(0,18000));
  const submission=queueModule.captureSubmission({...chat,text,composerDoc:composerModule.textDocument(text),uploads:[],refs:chat.studioNodeId?[chat.studioNodeId]:[],referencePins:[],artifactRefs:[],quotedText:''},{selection:modelModule.prepareSessionSelection(chat)});
  submission.formDefinition=clone(trace.args);submission.formSubmission=checked;submission.formRevisionOf=trace.id;submission.formSubmissionId=submissionId;
  validateSubmission(chat,submission);const previousQueue=chat.queuedMessages,previousPause=chat.queuePauseReason,previousLatest=trace.formLatestSubmission,previousReceipts=trace.formSubmissionReceipts;
  chat.queuedMessages=[...(chat.queuedMessages||[]),submission];chat.queuePauseReason=null;trace.formLatestSubmission=checked;trace.formSubmissionReceipts=[...(previousReceipts||[]),{id:submissionId,result:clone(checked)}];
  try{persistQueue();}catch(error){chat.queuedMessages=previousQueue;chat.queuePauseReason=previousPause;trace.formLatestSubmission=previousLatest;if(previousReceipts===undefined)delete trace.formSubmissionReceipts;else trace.formSubmissionReceipts=previousReceipts;throw error;}
  render();void queueRunner.drain();return checked;
 }
 function focusComposer(){composerEditor?.focus();}

 function studioChat(nodeId){if(!conversationsLoaded)throw Error('会话仍在加载，请稍后重试');let index=draft().studioNodeId===nodeId?current:chats.findIndex(chat=>chat.studioNodeId===nodeId);if(index<0){let text='';try{text=localStorage.getItem(project.storageKey('studio-v2-draft-'+nodeId))||'';}catch{}chats.push({...newDraft(),studioNodeId:nodeId,text,skills:['3d-scene-director'],refs:[nodeId]});index=chats.length-1;}return {chat:chats[index],index};}
 function studioSubmitted(nodeId){try{return localStorage.getItem(project.storageKey('studio-composer-sent:'+nodeId))==='true';}catch{return false;}}
 function syncStudioDraft(){composerEditor?.sync(draft());const send=panel?.querySelector('.agent-send');updateSendButton(send,draft());studioChannel?.publish();}
 import('./src/features/agent-scene/composer-channel.mjs').then(({studioComposer})=>{studioChannel=studioComposer;studioComposer.configure({
  read(nodeId){const {chat}=studioChat(nodeId);return {text:chat.text,session:chat,busy,blocked:busy&&draft().studioNodeId!==nodeId,open:!!panel&&draft()===chat,hasSubmitted:studioSubmitted(nodeId)};},
  write(nodeId,value){if(busy&&draft().studioNodeId!==nodeId)throw Error('其他对话正在执行');const {chat}=studioChat(nodeId);if(typeof value==='string')chat.text=value;else composerModule.applyComposerSnapshot(chat,value);save();},
  open(nodeId){return window.AgentUI.beginStudio({nodeId});},
  submit(nodeId){return window.AgentUI.beginStudio({nodeId,submit:true});},
  stop(nodeId){if(draft().studioNodeId!==nodeId)throw Error('当前任务属于另一个对话');stop();}
 });}).catch(error=>notice(error.message));
 function save(){if(!conversationsLoaded)return false;if(composerModule)composerModule.applyComposerSnapshot(draft(),{doc:composerModule.documentForDraft(draft())});if(conversations){const accepted=conversations.save(chats,draft().id);if(!accepted)notice('对话未能保存');syncStudioDraft();return accepted;}try{localStorage.setItem(project.storageKey('tapnow-agent-chats'),JSON.stringify(chats));}catch{notice('对话未能写入本地存储');return false;}saveActive();syncStudioDraft();return true;}
 function saveActive(){if(!conversationsLoaded)return;if(conversations){conversations.save(chats,draft().id);return;}try{localStorage.setItem(project.storageKey('tapnow-agent-active-chat'),draft().id);}catch{notice('当前对话位置未能保存');}}
 function draft(){return chats[current];}
 let artifactModule=null,artifactPanel=null,artifactStore=null,artifactGeneration=null,artifactAdapter={};
 const artifactsReady=Promise.all([import('./src/features/agent-artifacts/store.mjs'),import('./src/features/agent-artifacts/panel.mjs'),import('./src/features/agent-artifacts/generation.mjs')]).then(([storage,ui,generation])=>{artifactStore=storage.createStore({namespace:project.namespace});const write=artifactStore.write;artifactStore.write=input=>track(()=>write(input));artifactModule=ui;artifactGeneration=generation.createArtifactGeneration({store:artifactStore,getAdapter:()=>artifactAdapter.generateHtml||(({source,signal})=>request('artifact-html',{source:{artifact_path:source.artifact_path,title:source.title,content:source.content,revision:source.revision}},signal))});const generate=artifactGeneration.generate;artifactGeneration.generate=file=>track(()=>generate(file));if(panel)render();return artifactStore;});
 artifactsReady.catch(error=>notice('产物模块加载失败：'+error.message));
 async function artifactContext(submission=draft(),owner=draft()){
  const store=await artifactsReady;await appCardsReady;
  if(pageLeaving||draft()!==owner)throw Error('作品上下文所属会话已切换');
  const candidates=owner.messages.filter(trace=>trace.name==='show_app'&&trace.appHandoffs?.length&&['ui://tapnow/motion-picker@v1','ui://tapnow/creative-picker@v1','ui://tapnow/website-design-picker@v1'].includes(trace.result?.resource_uri)).slice(-12);
  const templates=templateSourceRuntime?await Promise.all(candidates.map(trace=>templateSourceRuntime.describe(trace))):[];
  if(pageLeaving||draft()!==owner)throw Error('读取本地模板期间会话已切换');
  const files=await store.list();if(pageLeaving||draft()!==owner)throw Error('作品列表所属会话已切换');
  if(templates.some(item=>item.status==='imported'&&!templateSourceRuntime.isDescriptionCurrent(item)))throw Error('本地模板选择或交接已变化，请重新核对作品');
  return {files,references:submission.artifactRefs||[],quotedText:submission.quotedText||'',localTemplates:templates.filter(item=>item.status==='imported').map(item=>({template_id:item.template_id,source_identity:item.source_identity,source:item.source,latest_artifact:item.artifact,receipt_status:item.receipt_status})),templateGuidance:'仅 localTemplates 中由宿主核验的原始模板可声明精确来源；编辑先 artifacts_read 最新 artifact_path/revision，保留原始 source。未取得原模板时仍可独立创作 HTML，但不能声称按原模板编辑。'};
 }
 async function openTemplateArtifact(file){
  const chat=draft(),owner=panel;await artifactsReady;
  if(!owner||panel!==owner||pageLeaving||draft()!==chat)throw Error('作品所属会话已切换');
  artifactButton();artifactPanel.open();await artifactPanel.select(file.artifact_path);
 }
 function addArtifactToCanvas(file){
  const bounds=document.querySelector('#canvas').getBoundingClientRect();
  const node=app.addNode('text',{x:bounds.left+bounds.width/2,y:bounds.top+bounds.height/2},null,file.title||file.artifact_path.split('/').at(-1),{textMode:'pure',content:file.content,artifactSource:{path:file.artifact_path,revision:file.revision}});
  notice('已添加到画布');return {nodeId:node.id};
 }
 function discussArtifact(file){
  const d=draft(),previous=d.artifactRefs;
  d.artifactRefs=[...(previous||[]).filter(ref=>ref.artifact_path!==file.artifact_path),{artifact_path:file.artifact_path,title:file.title||file.artifact_path.split('/').at(-1),revision:file.revision}];
  if(!save()){d.artifactRefs=previous;return;}
  if(!panel)open();else render();focusComposer();
 }
 function quoteArtifact(text){const d=draft(),previous=d.quotedText;d.quotedText=text;if(!save()){d.quotedText=previous;throw Error('引用未能保存');}if(!panel)open();else render();focusComposer();}
 function startBrainstorm(){draft().text=(draft().text?'Brainstorm\n'+draft().text:'Brainstorm\n请基于当前画布，提出几个差异明显、适合影像化的创意方向。');save();if(!panel)open();else render();focusComposer();}
 function artifactButton(){
  if(!artifactModule){const pending=btn(null,'侧边栏',null,'agent-artifact-trigger');pending.disabled=true;return pending;}
  if(!artifactPanel)artifactPanel=artifactModule.createPanel({store:artifactStore,anchor:panel,onAdd:addArtifactToCanvas,onDiscuss:discussArtifact,onQuote:quoteArtifact,onStart:startBrainstorm,generation:artifactGeneration,onError:notice,onShare:input=>{if(!artifactAdapter.share)throw Error('分享服务未配置');return artifactAdapter.share(input);}});
  return artifactPanel.createTrigger();
 }
 let attachmentInputAdapter=null;
 let attachmentMenuModule=null,attachmentUploadModule=null,attachmentPickerModule=null,attachmentMenu=null;
 const attachmentModules=Promise.all([import('./src/features/agent-attachments/menu.mjs'),import('./src/features/agent-attachments/uploads.mjs'),import('./src/features/agent-attachments/picker.mjs')]).then(([menu,uploads,picker])=>{attachmentMenuModule=menu;attachmentUploadModule=uploads;attachmentPickerModule=picker;if(panel)render();});
 attachmentModules.catch(error=>notice(error.message));
 let studioWelcome=null;
 import('./src/features/agent-scene/welcome.mjs').then(module=>{studioWelcome=module.createStudioWelcome;if(panel)render();}).catch(error=>notice('片场欢迎页加载失败：'+error.message));
 let historyModule=null,historyControls=[];
 import('./src/features/agent-history/menu.mjs').then(module=>{historyModule=module;if(panel)render();}).catch(error=>notice('聊天记录加载失败：'+error.message));
 let confirmationModule=null,confirmationControl=null,modelModule=null,modelControl=null,footerLayout=null,panelResize=null;
 import('./src/features/agent-composer/models.mjs').then(module=>{modelModule=module;if(panel)render();}).catch(error=>notice('模型菜单加载失败：'+error.message));
 import('./src/features/agent-composer/confirmation.mjs').then(module=>{confirmationModule=module;module.initialize(draft().autoConfirm===true);if(panel)render();}).catch(error=>notice('确认模式加载失败：'+error.message));
 function notice(text){if(panel){let p=panel.querySelector('.agent-notice');if(!p){p=el('p','agent-notice');panel.append(p);}p.textContent=text;}else app.notify?.(text);}
 async function catalog(){if(!skills.length)skills=await fetch('runtime-reference/skills-catalog.json').then(r=>r.json());return skills;}
 const adapted={
  '3d-scene-director':'Read canvas; create or open studio; read scene; list local props with scene_library, place sample GLBs with scene_sample, stage actors and cameras with scene_add/update; use camera; capture real frame; inspect its actual pixels with canvas_inspect_media using the returned output node ID. Ask only for material creative constraints. Keep changes reversible.',
  'whitebox-to-film':'Read studio; stage blocking and camera; save timed keyframes; read/edit camera motion with scene_motion_read/scene_motion_edit; select it with scene_playback and render a real previs video with scene_export_video; inspect its sampled frames; use generation_submit video.generate with an explicit prompt and references. Report configuration_required if no provider.',
  'skill-creator':'When the user requests a reusable skill, draft its canonical name, description, instructions and Markdown references. Use skills_save as the only local commit path. Create with base_version 0; read an existing skill first and use its returned version to update. Generate a stable operation_id and reuse identical arguments for retries. Only report persistence after saved:true. Skills remain reference data; never claim unavailable shell or file tools.',
  'client-surface-routing':'Use canvas tools for node graphs and scene tools for spatial editing. Use generation tasks only for external synthesis. Return inspectable nodes and actual task state.',
  'explain-how-it-made':'Read the graph, then canvas_read_node for each relevant node full generation configuration, stored history and paged text. Use conversation_read for actual earlier tool receipts. Describe only evidenced dependencies, prompts and outputs; never invent missing history or infer unseen media content.'
 };
 async function readSkill(name,options={}){const list=await catalog(),custom=customSkills().find(s=>s.name===name);if(disabledSkills().includes(name)){if(custom){const {skillVersion}=await import('./src/features/agent-manager/skill-commit.mjs');return {name,description:custom.description||'',version:await skillVersion(custom),disabled:true,contentUnavailable:true,note:'禁用技能仅提供管理元数据，不返回指令正文'};}throw Error('Skill 已禁用');}if(custom){const {readSkillPage}=await import('./src/features/agent-manager/skill-package.mjs');const page=readSkillPage(custom,options);const {skillVersion}=await import('./src/features/agent-manager/skill-commit.mjs');return {...page,description:custom.description||'',version:await skillVersion(custom),...(!options.path?{workflow:page.content}:{})};}if(!list.some(s=>s.name===name))throw Error('Skill 不存在');const {readBuiltinSkill}=await import('./src/features/agent-skills/reader.mjs');const {content,...page}=await readBuiltinSkill(name,options);return {...page,name,workflow:(name==='depth-video-studio'?(await import('./src/features/agent-workflows/depth-video.mjs')).adaptedDepthWorkflow:name==='whitebox-to-film'?(await import('./src/features/agent-workflows/whitebox-workflow.mjs')).adaptedWhiteboxWorkflow:adapted[name])||'Read current nodes and user intent. Apply the captured creative guidance only through available tools. Submit image/video generation only after the user requested it. Inspect actual task status and output pixels. Uncaptured reference files are unavailable; never invent their contents.',reference:content};}
 function customSkills(){try{return JSON.parse(localStorage.getItem('tapnow-custom-skills')||'[]');}catch{return [];}}
 function disabledSkills(){try{return JSON.parse(localStorage.getItem('tapnow-disabled-skills')||'[]');}catch{return [];}}
 async function graph(){const s=app.getState(),summary=s.nodes.some(node=>node.type==='video')?(generationModel?.draftSummary||(await import('./src/features/agent-generation/draft-final.mjs')).draftSummary):null;return {selected:s.selected,view:s.view,nodes:s.nodes.map(node=>{const {id,type,title,x,y,width,height,content,textMode,color,sourceId,parentId,groupColor,layoutType,memberIds,studio}=node;return {id,type,title,x,y,width,height,parentId,groupColor,layoutType,memberIds,textMode,color,content:content?.slice(0,2000),contentLength:content?.length||0,contentTruncated:(content?.length||0)>2000,sourceId,sceneObjectCount:studio?.objects?.length,...(type==='video'?{draftSummary:summary(node)}:{})};}),edges:s.edges.map(({id,source,target,purpose,data})=>({id,source,target,...(purpose||data?.purpose?{purpose:purpose||data.purpose}:{})}))};}
 let widgetMediaHost;
 const widgetMediaBindings=new Map();
 async function downloadWidgetMedia(original,filename,{receipt,isCurrent,signal}){
  if(!isCurrent()||signal.aborted)throw Error('媒体下载已取消');
  let blob=original;
  if(receipt?.applied){
   const node=app.getState().nodes.find(n=>n.id===receipt.nodeIds?.[0]);
   const asset=node?.type==='video'?node.video:node?.fullImage||node?.image;
   if(!node||node.provenance?.operationId!==receipt.operationId||asset!==node.provenance.outputMedia)throw Error('画布媒体已被修改，不能下载旧回执对应的产物');
   const response=await fetch(await window.LocalAssets.url(asset),{signal});
   if(!response.ok)throw Error('已保存媒体读取失败');blob=await response.blob();
   if(!app.getState().nodes.includes(node)||(node.type==='video'?node.video:node.fullImage||node.image)!==asset)throw Error('读取期间画布媒体已变化');
   filename=filename.replace(/\.[^.]*$/,'')+(node.type==='video'?'.mp4':'.png');
  }
  if(!isCurrent()||signal.aborted)throw Error('媒体下载已取消');
  window.LocalMedia.download(blob,filename);
 }
 function getActorSourceContext(response,trace,chat){
  const result=trace.result;
  return actorGuideRuntime.capture(response,{trace,chat,isCurrent:()=>!pageLeaving&&!!panel&&draft()===chat&&chat.messages.includes(trace)&&trace.result===result&&trace.result.response===response&&trace.status==='done'&&!trace.error&&!trace.result.error});
 }
 function saveExpressionGuide(args,trace,chat,options){return track(()=>actorGuideRuntime.save(args,trace,chat,options));}
 function appSourceCurrent(response,trace,chat){const result=trace.result;return ()=>!pageLeaving&&!!panel&&draft()===chat&&chat.messages.includes(trace)&&trace.result===result&&trace.result.response===response&&trace.status==='done'&&!trace.error&&!trace.result.error;}
 function getProductionSourceContext(response,trace,chat){return productionProgressRuntime.capture(response,{trace,chat,isCurrent:appSourceCurrent(response,trace,chat)});}
 function queryProductionProgress(args,trace,chat,{sourceContext,isCurrent}){return sourceContext.query(args,{isCurrent});}
 function getLibrarySourceContext(response,trace,chat){return libraryPickerRuntime.capture(response,{trace,chat,isCurrent:appSourceCurrent(response,trace,chat)});}
 function addLibraryAsset(args,trace,chat,{sourceContext,isCurrent,userAction}){return track(()=>sourceContext.addToCanvas(args,{isCurrent,userAction}));}
 function getColorAdjustSourceContext(response,trace,chat){return colorAdjustRuntime.capture(response,{trace,chat,isCurrent:appSourceCurrent(response,trace,chat)});}
 function applyColorAdjust(args,trace,chat,options){return track(()=>colorAdjustRuntime.apply(args,trace,chat,options));}
 function setColorAdjustContext(params,trace,chat,options){return track(()=>colorAdjustRuntime.setModelContext(params,trace,chat,options));}
 function generationAppRuntime(uri){const runtime={'ui://tapnow/animatic@v2':animaticRuntime,'ui://tapnow/previs@v3':previsRuntime,'ui://tapnow/ecommerce-photoset@v2':ecommercePhotosetRuntime}[uri];if(!runtime)throw Error('生成应用尚未接入');return runtime;}
 function getGenerationAppSourceContext(response,trace,chat){return generationAppRuntime(trace.result.resource_uri).capture(response,{trace,chat,isCurrent:appSourceCurrent(response,trace,chat)});}
 function onGenerationAppTool(name,args,trace,chat,options){return track(()=>{const uri=trace.result.resource_uri;if(uri==='ui://tapnow/animatic@v2'){if(name==='animatic_variants_submit')return animaticRuntime.submit(args,trace,chat,options);if(name==='animatic_variants_lookup')return animaticRuntime.lookup(args,trace,chat,options);}if(uri==='ui://tapnow/previs@v3'){if(name==='previs_variants_submit')return options.sourceContext.submitVariants(args,options);if(name==='previs_variants_lookup')return options.sourceContext.lookupVariants(args,options);}if(uri==='ui://tapnow/ecommerce-photoset@v2'&&name==='ecommerce_photoset_generate')return ecommercePhotosetRuntime.generate(args,trace,chat,options);throw Error('工具不属于当前生成应用');});}
 function onGenerationAppContext(params,trace,chat,options){return track(()=>generationAppRuntime(trace.result.resource_uri).setModelContext(params,trace,chat,options));}
 function onValidateAppReply(details,trace,chat,{sourceContext}){return sourceContext.preflightReply(details);}
 async function onAppReply(details,trace,chat,options){
  const context=options.sourceContext;if(options.userAction!==true||!options.isCurrent())throw Error('预演回复需要当前页面确认');const savedState=trace.appState,reply=await context.resolveReply(details,savedState);await context.applyReply(details,savedState);if(!options.isCurrent()||trace.appState!==savedState)throw Error('预演回复来源或保存状态已切换');
  const fingerprint=reply.result.manifest_revision,metadata={...reply.metadata,appReplyId:details.reply_id,appReplyFingerprint:fingerprint};
  const receipt=await queueWidgetPrompt(reply.text,trace,chat,metadata,options.isCurrent,async()=>{await context.validateReply(details,savedState);if(!options.isCurrent())throw Error('预演队列保存期间来源已切换');},async receipt=>{const entry=trace.previsReplies?.find(item=>item.reply_id===details.reply_id);if(!entry||entry.manifest_revision!==fingerprint)throw Error('预演确认身份未持久保存');const previous={status:entry.status,run_id:entry.run_id};entry.status='accepted';entry.run_id=receipt.run_id;try{if(!save())throw Error('预演运行绑定保存失败');await flushConversation();await context.validateReply(details,savedState);if(!options.isCurrent())throw Error('预演运行绑定保存期间来源已切换');}catch(error){Object.assign(entry,previous);throw error;}});
  if(receipt===false||!receipt?.run_id)throw Error('预演回复未进入真实持久队列');return receipt;
 }
 function getLayerComposerSourceContext(response,trace,chat){return layerComposerRuntime.capture(response,{trace,chat,isCurrent:appSourceCurrent(response,trace,chat)});}
 function applyLayerComposer(args,trace,chat,options){return track(()=>layerComposerRuntime.apply(args,trace,chat,options));}
 function setLayerComposerContext(params,trace,chat,options){return track(()=>layerComposerRuntime.setModelContext(params,trace,chat,options));}
 function getPlatformResizeSourceContext(response,trace,chat){return platformResizeRuntime.capture(response,{trace,chat,isCurrent:appSourceCurrent(response,trace,chat)});}
 function applyPlatformResize(args,trace,chat,{sourceContext,...options}){return track(()=>sourceContext.apply(args,options));}
 function getCutlistSourceContext(response,trace,chat){return cutlistReviewRuntime.capture(response,{trace,chat,isCurrent:appSourceCurrent(response,trace,chat)});}
 function getAnimaticV1SourceContext(response,trace,chat){return animaticV1Runtime.capture(response,{trace,chat,isCurrent:appSourceCurrent(response,trace,chat)});}
 function getCharacterBlockingSourceContext(response,trace,chat){return (trace.result.resource_uri==='ui://tapnow/character-blocking@v1'?characterBlockingV1Runtime:characterBlockingRuntime).capture(response,{trace,chat,isCurrent:appSourceCurrent(response,trace,chat)});}
 function getProductKitSourceContext(response,trace,chat){return productKitRuntime.capture(response,{trace,chat,isCurrent:appSourceCurrent(response,trace,chat)});}
 function getAdReviewSourceContext(response,trace,chat){return adReviewRuntime.capture(response,{trace,chat,isCurrent:appSourceCurrent(response,trace,chat)});}
 function receiveWidgetMedia(...args){return track(()=>receiveWidgetMediaTracked(...args));}
 async function receiveWidgetMediaTracked(payload,trace,chat,options){
  if(!options.isCurrent()||options.signal.aborted)throw new DOMException('媒体交接已取消','AbortError');
  widgetMediaHost||=import('./src/features/agent-widgets/media-handoff.mjs').then(({createWidgetMediaHandoff})=>createWidgetMediaHandoff({app,localMedia:window.LocalMedia,localAssets:window.LocalAssets,store:canvasPersistence,onChange:receipt=>widgetMediaBindings.get(receipt.operationId)?.onProgress?.(receipt)}));
  const host=await widgetMediaHost;
  let entry=widgetMediaBindings.get(payload.operationId);
  if(!entry){
   const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(trace.args.widget_code));
   const digest=Array.from(new Uint8Array(bytes),value=>value.toString(16).padStart(2,'0')).join('');
   const namespace=(await artifactsReady).namespace;
   if(!options.isCurrent()||options.signal.aborted)throw new DOMException('媒体交接已取消','AbortError');
   const view=app.getState().view;
   const bound=host.bind({chatId:chat.id,traceId:trace.id,version:namespace+':'+digest,allowedTypes:[payload.type],
    position:{x:(innerWidth/2-view.x)/view.scale,y:(innerHeight/2-view.y)/view.scale},title:payload.title,
    ...(payload.duration!==undefined?{expectedDuration:payload.duration}:{}),...(payload.fps!==undefined?{fps:payload.fps}:{}),isCurrent:options.isCurrent});
   entry={bound,trace,chat,onProgress:options.onProgress};widgetMediaBindings.set(payload.operationId,entry);
  }
  if(entry.trace!==trace||entry.chat!==chat)throw Error('媒体交接不属于当前组件');
  entry.onProgress=options.onProgress;
  let receipt;
  try{receipt=await (options.retry?entry.bound.retrySave(payload.operationId,{signal:options.signal}):entry.bound.submit({operationId:payload.operationId,type:payload.type,blob:payload.blob},{signal:options.signal}));}
  catch(error){if(error.code==='save_failed')receipt=entry.bound.get(payload.operationId);else throw error;}
  finally{entry.onProgress=null;}
  if(receipt&&chat.messages.includes(trace)){
   trace.result={...trace.result,mediaOutputs:[...(trace.result?.mediaOutputs||[]).filter(item=>item.operationId!==receipt.operationId),receipt].slice(-20)};
   if(!save())receipt={...receipt,conversationSaved:false,warning:'画布结果状态见回执；对话记录未能保存'};
  }
  return receipt;
 }
 const depthHosts=new WeakMap();
 let videoTrimHost;
 let videoAnalysisHost;
 async function analyzeVideo(args,{signal,authorize,onSubmitted}){
  videoAnalysisHost||=import('./src/features/agent-workflows/video-analysis.mjs').then(({createAgentVideoAnalysis})=>createAgentVideoAnalysis({app,generationAPI:window.GenerationAPI,localAssets:window.LocalAssets,baseUrl:document.baseURI,getProjectId:()=>window.CanvasProjects?.id?.()||project.id}));
  return (await videoAnalysisHost).execute(args,{signal,authorize,onSubmitted});
 }
 async function trimVideo(name,args,signal){
  videoTrimHost||=import('./src/features/agent-media/video-trim.mjs').then(({createAgentVideoTrim})=>createAgentVideoTrim({app,localMedia:window.LocalMedia,localAssets:window.LocalAssets,store:canvasPersistence}));
  const host=await videoTrimHost;
  try{return await (name==='video_trim'?host.execute(args,{signal}):host.retrySave(args.operationId,{signal}));}
  catch(error){if(error.code==='save_failed')return {...host.get(args.operationId),error:error.message};throw error;}
 }
 let imageEditorExporter;
 let subjectAgentHost;
 async function subjectsHost(){
  subjectAgentHost||=import('./src/features/agent-subjects/service.mjs').then(({createSubjectAgentService})=>createSubjectAgentService({app,canvasStore:canvasPersistence,localAssets:window.LocalAssets,localMedia:window.LocalMedia}));
  return subjectAgentHost;
 }
 async function depthHostFor(chat){
  if(depthHosts.has(chat))return depthHosts.get(chat);
  const [{createDepthAgentHost},{createLocalClipResolver}]=await Promise.all([import('./src/features/agent-workflows/depth-agent.mjs'),import('./src/features/agent-workflows/local-clip-resolver.mjs')]);
  const getIdentity=id=>app.getState().nodes.find(node=>node.id===id);
  const resolveClip=createLocalClipResolver({getNode:getIdentity,localMedia:window.LocalMedia});
  const host=createDepthAgentHost({getNodes:attachmentNodes,getIdentity,getMessages:()=>chat.messages,validateFormSubmission:window.AgentTools.validateFormSubmission,localAssets:window.LocalAssets,baseUrl:document.baseURI,
   resolveClip:(node,options)=>resolveClip(getIdentity(node.id),options),onBeginTurn:()=>resolveClip.clear(),
   runInPlace:(...args)=>window.GenerationAPI.runInPlace(...args),createConnected:(...args)=>app.createConnected(...args),persist:()=>app.saveProject()});
  depthHosts.set(chat,host);return host;
 }
 function execute(...args){return track(async()=>{await flushConversation();const result=await executeTool(...args);await flushConversation();return result;});}
 async function executeTool(name,raw,{signal,visualBudget,draftFinalApproval,depthHost,authorizeDepth,onDepthSubmitted,cutlistAuthorized=false}={}){const {args:a}=window.AgentTools.parse(name,raw);switch(name){
  case 'web_search':try{return await request('search',a,signal);}catch(error){if(error.name==='AbortError')throw error;return {error:error.message,code:error.code||'search_failed',status:'failed',sources:[],citations:[]};}
  case 'image_editor_export':{
   imageEditorExporter||=import('./src/features/image-editor/agent-export.mjs').then(({createImageEditorExporter})=>createImageEditorExporter({getCurrent:()=>window.CanvasImageEditor?.current,app,localAssets:window.LocalAssets,download:(blob,filename)=>window.LocalMedia.download(blob,filename)}));
   return (await imageEditorExporter).execute(a,{signal});
  }
  case 'image_editor_create':case 'image_editor_open':case 'image_editor_read':case 'image_editor_save':case 'image_editor_close':case 'image_editor_edit':{
   if(!window.CanvasImageEditor?.agent)throw Error('图片编辑器尚未就绪');
   const {action,...args}=a;
   return window.CanvasImageEditor.agent.execute(name==='image_editor_edit'?action:name.slice(13),args,{signal});
  }
  case 'subjects_list':case 'subjects_read':case 'subjects_save':case 'subjects_archive':case 'subjects_apply':{try{return await (await subjectsHost())[name.slice(9)](a,{signal});}catch(error){if(error.code==='save_failed'&&error.receipt)return {...error.receipt,error:error.message};throw error;}}
  case 'video_trim':case 'video_trim_retry_save':return trimVideo(name,a,signal);
  case 'video_analyze':return analyzeVideo(a,{signal,authorize:authorizeDepth,onSubmitted:onDepthSubmitted});
  case 'generation_video_models':return (await import('./src/features/agent-generation/model-contracts.mjs')).videoModelContracts(a);
  case 'artifacts_list':return (await artifactsReady).list();
  case 'artifacts_read':return (await artifactsReady).read(a);
  case 'artifacts_write':return (await artifactsReady).write(a);
  case 'show_form':return {form:clone(a),awaiting_submission:true};
  case 'show_app':{const chat=draft(),apps=await appCardsReady;if(signal?.aborted)throw signal.reason||new DOMException('应用已取消','AbortError');if(pageLeaving||draft()!==chat)throw Error('应用准备期间会话已切换');const options={chat,signal,isCurrent:()=>!signal?.aborted&&!pageLeaving&&draft()===chat};let args=await actorGuideRuntime.prepareAppArgs(a,options);args=await productionProgressRuntime.prepareAppArgs(args,options);args=await libraryPickerRuntime.prepareAppArgs(args,options);args=await colorAdjustRuntime.prepareAppArgs(args,options);args=await platformResizeRuntime.prepareAppArgs(args,options);args=await cutlistReviewRuntime.prepareAppArgs(args,options);args=await characterBlockingRuntime.prepareAppArgs(args,options);args=await characterBlockingV1Runtime.prepareAppArgs(args,options);args=await animaticV1Runtime.prepareAppArgs(args,options);args=await productKitRuntime.prepareAppArgs(args,options);args=await adReviewRuntime.prepareAppArgs(args,options);args=await layerComposerRuntime.prepareAppArgs(args,options);args=await animaticRuntime.prepareAppArgs(args,options);args=await previsRuntime.prepareAppArgs(args,options);args=await ecommercePhotosetRuntime.prepareAppArgs(args,options);if(!options.isCurrent())throw Error('应用准备期间来源会话已切换或取消');let result=apps.prepareApp(args);result=actorGuideRuntime.bindPreparedResult(result,args);result=productionProgressRuntime.bindPreparedResult(result,args);result=libraryPickerRuntime.bindPreparedResult(result,args);result=colorAdjustRuntime.bindPreparedResult(result,args);result=platformResizeRuntime.bindPreparedResult(result,args);result=cutlistReviewRuntime.bindPreparedResult(result,args);result=characterBlockingRuntime.bindPreparedResult(result,args);result=characterBlockingV1Runtime.bindPreparedResult(result,args);result=animaticV1Runtime.bindPreparedResult(result,args);result=productKitRuntime.bindPreparedResult(result,args);result=adReviewRuntime.bindPreparedResult(result,args);result=layerComposerRuntime.bindPreparedResult(result,args);result=animaticRuntime.bindPreparedResult(result,args);result=previsRuntime.bindPreparedResult(result,args);return ecommercePhotosetRuntime.bindPreparedResult(result,args);}
  case 'cutlist_assemble':await appCardsReady;return cutlistAssemblyRoute(a,{approved:cutlistAuthorized,signal});
  case 'show_widget':return (await artifactCardsReady).prepareWidget(a);
  case 'show_html':return (await artifactCardsReady).prepareHtml(a,{store:await artifactsReady});
  case 'conversation_read':return (await import('./src/features/agent-history/context.mjs')).readConversation(draft(),a);
  case 'canvas_read':return graph();
  case 'canvas_read_node':case 'canvas_disconnect':case 'canvas_redo':case 'canvas_resize':return (await import('./src/features/agent-canvas/operations.mjs')).executeCanvasOperation(name,a,{app,text:window.CanvasText,groups:window.CanvasGroups});
  case 'depth_video_prepare':if(!depthHost)throw Error('深度流程宿主不可用');return depthHost.prepare(a,{signal,visualBudget});
  case 'depth_video_convert':case 'depth_video_recast':if(!depthHost)throw Error('深度流程宿主不可用');return depthHost.execute(name,a,{signal,authorize:authorizeDepth,onSubmitted:onDepthSubmitted});
  case 'canvas_inspect_media':{if(depthHost)return depthHost.inspect(a.ids,{signal,visualBudget});const {inspectCanvasMedia}=await import('./src/features/agent-vision/inspect.mjs');return inspectCanvasMedia(a.ids,{getNodes:attachmentNodes,resolveUrl:url=>window.LocalAssets.url(url),signal,visualBudget});}
  case 'canvas_add':{const initial=a.type==='world'?{...(await import('./src/features/world-node/model.mjs')).draft(),title:a.title}:{};if(signal?.aborted)throw new DOMException('节点创建已取消','AbortError');const v=app.getState().view,n=app.addNode(a.type,{x:a.x*v.scale+v.x,y:a.y*v.scale+v.y},null,a.title,initial);if(a.type==='text')app.updateNode(n.id,{content:a.content||'',textMode:a.textMode||(a.content?'pure':'generate')});else if(a.content)app.updateNode(n.id,{content:a.content});return {id:n.id,x:n.x,y:n.y};}
  case 'canvas_update':if(!app.getState().nodes.some(n=>n.id===a.id))throw Error('节点不存在');app.updateNode(a.id,a.patch);return {updated:a.id};
  case 'canvas_group':{const g=app.group(a.ids);return {id:g.id,type:g.type,title:g.title,x:g.x,y:g.y,width:g.width,height:g.height};}
  case 'canvas_stack':{const p=app.stack(a.ids);return {id:p.id,memberIds:p.memberIds,x:p.x,y:p.y};}
  case 'canvas_unstack':return {released:app.unstack(a.id)};
  case 'canvas_pile_release':{const n=app.releasePile(a.pileId,a.id,{x:a.x,y:a.y},a.targetId);return {id:n.id,x:n.x,y:n.y};}
  case 'canvas_ungroup':app.ungroup(a.id);return {ungrouped:a.id};
  case 'canvas_layout':return app.layoutNodes(a.mode,a.ids);
  case 'canvas_generation_config':{const {id,...patch}=a;if(window.TextAPI&&app.getState().nodes.find(n=>n.id===id)?.type==='text')window.TextAPI.setConfig(id,patch);else window.NodeEditor.setConfig(id,patch);return {configured:id,...patch};}
  case 'workflow_run':{const run=window.WorkflowAPI.start(a.groupId);return {groupId:a.groupId,status:run.status,total:run.plan.executable.length};}
  case 'workflow_status':{const run=window.WorkflowAPI.getRun(a.groupId);if(!run)throw Error('分组尚未执行');return {groupId:a.groupId,status:run.status,layer:run.layer,layers:run.plan.layers.length,completed:[...run.completed],errors:[...run.errors]};}
  case 'workflow_stop':window.WorkflowAPI.stop(a.groupId);return {groupId:a.groupId,status:window.WorkflowAPI.getRun(a.groupId)?.status||'idle'};
  case 'templates_list':await window.TemplateAPI.ready;return window.TemplateAPI.list().map(t=>({id:t.id,name:t.name,tags:t.tags,description:t.description,nodeCount:t.graph.nodes.length,updatedAt:t.updatedAt}));
  case 'template_save':{const t=await window.TemplateAPI.save(a.groupId,a);return {id:t.id,name:t.name,nodeCount:t.graph.nodes.length};}
  case 'template_use':{const g=await window.TemplateAPI.use(a.id);return {id:g.id,x:g.x,y:g.y,width:g.width,height:g.height};}
  case 'canvas_connect':return app.connect(a.source,a.target);
  case 'canvas_delete':app.remove(a.ids);return {deleted:a.ids};
  case 'canvas_focus':app.select(a.id,true);return {selected:a.id};
  case 'canvas_undo':app.undo();return {ok:true};
  case 'skills_list':return [...(await catalog()).filter(s=>!disabledSkills().includes(s.name)).map(s=>({name:s.name,description:s.text.split('\n\n').slice(2).join('\n').slice(0,800)})),...customSkills().filter(s=>a.includeDisabled||!disabledSkills().includes(s.name)).map(s=>({name:s.name,description:s.description||(disabledSkills().includes(s.name)?'':s.text.slice(0,200)),disabled:disabledSkills().includes(s.name),personal:true}))];
  case 'skills_read':return readSkill(a.name,a);
  case 'skills_rename':case 'skills_uninstall':{
   const management=await import('./src/features/agent-skills/management.mjs');
   let result;try{result=await management[name==='skills_rename'?'renamePersonalSkill':'uninstallPersonalSkill'](a,{builtinNames:(await catalog()).map(skill=>skill.name),signal});}catch(error){if(signal?.aborted||error.name==='AbortError')throw error;if(!error.receipt)throw error;result={...error.receipt,error:error.message};}
   if(result.saved&&result.currentMatches!==false){try{await rewriteSkillReferences(result);result.referencesUpdated=true;}catch(error){result.referencesUpdated=false;result.referenceUpdateError=error.message;}}
   return result;
  }
  case 'skills_save':{const {commitSkill}=await import('./src/features/agent-manager/skill-commit.mjs');const result=await commitSkill(a,{builtinNames:(await catalog()).map(skill=>skill.name)});return result;}
  case 'world_read':return (await import('./src/features/agent-generation/world.mjs')).readWorld(a,{app,metadata:await window.GenerationAPI.configuration?.()});
  case 'world_generate':{
   const {startWorldGeneration}=await import('./src/features/agent-generation/world.mjs');
   const result=await startWorldGeneration(a,{app,api:window.GenerationAPI,signal,onSubmitted:onDepthSubmitted,materialize:async(output,type,options)=>(await import('./src/features/world-node/resource.mjs')).materialize(output,type,options)});
   if(result.configurationRequired)return {nodeId:a.nodeId,status:'configuration_required',error:'3D 生成服务尚未配置，请配置 Tripo 原生接口或支持 world.generate 的任务网关'};
   return {nodeId:a.nodeId,taskId:result.job.id,status:result.job.status,applied:!!result.job.applied};
  }
  case 'previs_generate_sheet':{
   await appCardsReady;const chat=draft(),trace=chat.messages.find(entry=>entry.id===a.trace_id&&entry.name==='show_app'&&entry.status==='done'&&entry.result?.resource_uri==='ui://tapnow/previs@v3');if(!trace||trace.error||trace.result?.error)throw Error('未找到当前真实预演确认');
   const receipt=trace.appReplyReceipts?.find(entry=>entry.reply_id===a.reply_id);if(!receipt||!chat.messages.some(entry=>entry.role==='user'&&entry.widgetOrigin?.traceId===trace.id&&entry.widgetOrigin?.appReplyId===a.reply_id))throw Error('预演图板缺少已接受的真实用户任务');
   const context=getGenerationAppSourceContext(trace.result.response,trace,chat),isCurrent=()=>!signal?.aborted&&!pageLeaving&&draft()===chat&&chat.messages.includes(trace)&&context.isCurrent();
   try{return await track(()=>previsRuntime.generateSheets({reply_id:a.reply_id,shot_codes:a.shot_codes},trace,chat,{userAction:true,isCurrent,sourceContext:context,signal}));}finally{context.dispose();}
  }
  case 'generation_submit':{
   if(a.draftSourceId){const {createDraftFinalDraft,confirmDraftFinal}=await import('./src/features/agent-generation/draft-final.mjs');const approval=draftFinalApproval||createDraftFinalDraft(a,app.getState().nodes);confirmDraftFinal(a,approval,app.getState().nodes,app.getState().edges);const {submitDraftFinal}=await import('./src/features/video-generation/draft-final-workflow.mjs');if(signal?.aborted)throw new DOMException('Aborted','AbortError');confirmDraftFinal(a,approval,app.getState().nodes,app.getState().edges);const result=await submitDraftFinal({sourceId:a.draftSourceId,...(a.nodeId?{targetId:a.nodeId}:{})});return {nodeId:result.nodeId,taskId:result.job.id,status:result.job.status};}
   if(a.kind==='text.generate'&&window.TextAPI){const {nodeId,kind,...overrides}=a;const request=await window.TextAPI.buildRequest(nodeId,overrides),job=window.GenerationAPI.submit(request);return {taskId:job.id,status:job.status};}
   if(a.kind==='audio.generate'&&window.AudioAPI?.buildRequest){const request=await window.AudioAPI.buildRequest(a.nodeId,a),job=window.GenerationAPI.submit(request);return {taskId:job.id,status:job.status};}
   const nodes=app.getState().nodes,n=nodes.find(n=>n.id===a.nodeId);if(!n)throw Error('来源节点不存在');
   const refs=(a.referenceIds||[n.id]).map(id=>{const node=nodes.find(n=>n.id===id);if(!node)throw Error('参考节点不存在：'+id);return node;});
   let beforeDispatch;
   let inputs=refs.flatMap(n=>n.video?[{id:n.id,type:'video',url:n.video}]:n.image?[{id:n.id,type:'image',url:n.image}]:n.audio?[{id:n.id,type:'audio',url:n.audio}]:n.content?[{id:n.id,type:'text',text:n.content}]:[]);
   if(['image.generate','video.generate'].includes(a.kind)){
    const availability=await window.GenerationAPI.availability?.({signal});
    if(signal?.aborted)throw new DOMException('生成已取消','AbortError');
    if(availability?.configured===false)return {status:'configuration_required',nodeId:a.nodeId,error:'尚未配置生成服务，请连接 API 后重试'};
    const {prepareAgentMediaInputs}=await import('./src/features/agent-generation/media-inputs.mjs');
    const prepared=await prepareAgentMediaInputs(refs,{getNode:id=>app.getState().nodes.find(node=>node.id===id),signal,localAssets:window.LocalAssets,localMedia:window.LocalMedia,baseUrl:document.baseURI,deferTransport:true,guardNodes:[n]});
    beforeDispatch=prepared.guard;prepared.guard();if(!app.getState().nodes.includes(n))throw Error('生成目标已删除或替换');inputs=prepared.inputs;
   }
   const isV2=n.type==='studio'&&(n.studioV2||!n.studio);
   if(a.kind==='model.generate'&&n.type!=='studio')throw Error('模型生成必须绑定片场节点');
   if(a.kind==='model.generate'&&isV2&&a.setupId)throw Error('3D 片场 2.0 不使用旧版状态 ID');
   const job=window.GenerationAPI.submit({kind:a.kind,nodeId:a.nodeId,label:a.kind,prompt:a.prompt,inputs,parameters:{model:a.model,aspect:a.aspect,duration:a.duration,count:a.count,imageSize:a.imageSize,...(a.kind==='image.generate'?{outputQuality:a.quality}:{quality:a.quality}),resolution:a.resolution,generateAudio:a.generateAudio,videoMode:a.videoMode,...(a.kind==='model.generate'?{position:a.position||[0,isV2?0:n.studio?.ground?.y??-1.7,0],...(isV2?{sceneBinding:{version:2,nodeId:n.id}}:{setupId:a.setupId||n.studio?.activeSetup||'example'}),format:'glb'}:{})}},{beforeDispatch});
   return {taskId:job.id,status:job.status};
  }
  case 'scene_import':case 'scene_redo':return window.StudioAPI.execute(name.slice(6),a,{signal});
  case 'scene_select':{const state=window.StudioAPI.getState();if(!state?.objects?.some(object=>object.id===a.id))throw Error('片场对象不存在');return window.StudioAPI.execute('select',a);}
  case 'scene_motion_read':return window.StudioAPI.execute('motion',{...a,action:'read'});
  case 'scene_motion_select':return window.StudioAPI.execute('motion',{...a,action:'select'});
  case 'scene_motion_edit':return window.StudioAPI.execute('motion',a);
  case 'scene_export_video':return window.StudioAPI.execute('motion-export',a,{signal});
  case 'generation_recover':return taskSummary(await window.GenerationAPI.recover(a.id,{signal}));
  case 'generation_apply_recovered':return window.GenerationAPI.applyRecovered(a.id,a.mode,a.sourceId);
  case 'generation_retry_application':return window.GenerationAPI.retryApplication(a.id);
  case 'generation_status':return window.GenerationAPI.getJobs().map(taskSummary);
  case 'generation_wait':{
   const started=Date.now();while(true){
    if(controller?.signal.aborted)throw new DOMException('Aborted','AbortError');
    const job=window.GenerationAPI.getJobs().find(j=>j.id===a.id);if(!job)throw Error('任务不存在');
    if(!['queued','running'].includes(job.status)&&!(job.status==='succeeded'&&job.applying)||Date.now()-started>=30000)return taskSummary(job);
    await new Promise(resolve=>setTimeout(resolve,150));
   }
  }
  case 'generation_cancel':return window.GenerationAPI.cancel(a.id);
  default:if(name.startsWith('scene_'))return window.StudioAPI.execute(name.slice(6),a);throw Error('未知工具');
 }}
 function appendResultCards(row,result,trace){
  if(trace?.batchItems){for(const item of trace.batchItems)appendResultCards(row,item.result,item);return;}
  if(!result||typeof result!=='object')return;
  if(trace?.name==='web_search'){const search=searchResultView?.(result);if(search)row.append(search);return;}
  const ids=[...(trace?.name.startsWith('canvas_')&&result.id?[result.id]:[]),...(result.nodeIds||[]),...(trace?.generationJob?.resultIds||result.resultIds||[]),...(result.nodeId?[result.nodeId]:[])];
  const nodes=[...new Set(ids)].map(id=>app.getState().nodes.find(n=>n.id===id)).filter(Boolean);
  if(!nodes.length)return;
  const list=el('div','agent-result-cards');
  for(const node of nodes){
   const card=btn(null,'查看 '+node.title,async()=>{try{if(window.StudioAPI?.active)await window.StudioAPI.active.close();app.select(node.id,true);if(node.image||node.video)app.preview(node);}catch(error){notice(error.message||String(error));}},'agent-result-card');
   if(node.image){const image=el('img');image.src=node.image;image.alt=node.title;card.append(image);}else{const symbol=el('span','agent-result-symbol');symbol.innerHTML=window.UI_ICONS[node.type==='video'?'video':node.type==='studio'?'cube':'file']||window.UI_ICONS.cube;card.append(symbol);}
   card.append(el('span','',node.title),el('small','',node.width&&node.height?node.width+' × '+node.height:node.type));list.append(card);
  }
  row.append(list);
 }
 function taskSummary({id,status,progress,error,resultIds,applied,applying,applicationError,applicationStatus,applicationAttempts,sceneResult,recovered,recovery,request,outputs}){return {id,status,progress,error,resultIds,applied,applying,applicationError,applicationStatus,applicationAttempts,sceneResult,recovered,recovery,kind:request?.kind,nodeId:request?.nodeId,outputCount:outputs?.length||0,outputTypes:outputs?[...new Set(outputs.map(output=>output.type))]:[]};}
 function close(){recoveryEpoch++;if(recoveryPreparing)controller?.abort();artifactCards?.reset();appCards?.reset();executionRenderer?.prune([]);questionView?.destroy();questionView=null;questionHeight=0;executionRenderer?.reset();queueView?.destroy();queueView=null;queueHeight=0;messageRenderer?.reset();composerEditor?.destroy();composerEditor=null;attachmentMenu?.destroy();attachmentMenu=null;artifactPanel?.setAnchor(null);historyControls.forEach(control=>control.destroy());historyControls=[];panelResize?.destroy();panelResize=null;footerLayout?.destroy();footerLayout=null;confirmationControl?.destroy();confirmationControl=null;modelControl?.destroy();modelControl=null;panel?.remove();panel=null;app.setRightPanel(0);document.querySelector('.agent').hidden=false;studioChannel?.publish();}
 function open(){if(!conversationsLoaded){void conversationReady.then(open).catch(error=>notice(error.message));return;}if(panel)return;panel=el('aside','agent-panel');panel.id='agent-panel';panel.setAttribute('aria-label','AI 助手');document.body.append(panel);artifactPanel?.setAnchor(panel);app.setRightPanel(innerWidth<750?0:480);document.querySelector('.agent').hidden=true;render();}
 async function toggle(){
  await conversationReady;
  if(panel){close();return;}
  const {canvasConversationIndex}=await conversationScopeReady;
  const index=canvasConversationIndex(chats,current,{sceneNodeId:window.StudioAPI?.getState()?.nodeId,busy});
  let unsaved=false;
  if(index!==current){composerEditor?.sync(draft());if(index<0){chats.push(newDraft());current=chats.length-1;unsaved=!save();}else{current=index;saveActive();}}
  open();if(unsaved)notice('已切回画布对话，但本地存储未完成；请保留页面并检查存储空间。');
 }
 import('./src/features/agent-composer/shortcuts.mjs').then(({installAgentShortcut})=>installAgentShortcut(toggle)).catch(error=>notice('Agent快捷键加载失败：'+error.message));
 // Official welcome DOM and fresh-session card layout: reference/agent-welcome-official-dom-20261002.json.
 let welcomeModule=null,offset=0;
 import('./src/features/agent-welcome/suggestions.mjs').then(module=>{welcomeModule=module;if(panel&&!draft().messages.length)render();}).catch(error=>notice('创作建议加载失败：'+error.message));
 async function selectWelcomeSuggestion(id,d){
  await composerReady;
  if(!composerModule||!welcomeModule||!panel||draft()!==d||pageLeaving)return;
  const input=welcomeModule.getWelcomeSuggestionInput(id);if(!input)return;
  const doc=composerModule.textDocument(input.text),paragraph=doc.content[0];
  if(input.references.length)paragraph.content=[...input.references.flatMap(ref=>[{type:'referenceMention',attrs:{...ref,scope:'personal'}},{type:'text',text:' '}]),...(paragraph.content||[])];
  composerModule.applyComposerSnapshot(d,{doc});save();render();focusComposer();
 }
 function welcomeImage(source,className=''){const image=el('img',className);image.src=source;image.alt='';image.draggable=false;image.setAttribute('aria-hidden','true');return image;}
 function updateWelcomeInput(d){const content=panel?.querySelector('.agent-welcome');if(content)content.hidden=Boolean(d.text?.trim());}
 function canvasWelcome(d){
  const space=el('div','agent-welcome-space'),welcome=el('section','agent-welcome'),hi=el('div','agent-hi');
  hi.append(welcomeImage('assets/agent-motion-slow.webp'),el('h2','','Hi New Tapper!'));welcome.append(hi,el('p','agent-welcome-question','今天一起创作点什么？'));
  const suggestionsWrap=el('div','agent-welcome-suggestions'),cards=el('div','agent-suggestions');
  const page=welcomeModule?.getCanvasWelcomeSuggestionPage({offset,size:2});
  for(const item of page?.items||[]){
   const {title,icon,icon_category}=welcomeModule.getWelcomeSuggestionCard(item.id),input=welcomeModule.getWelcomeSuggestionInput(item.id),card=btn(null,title,()=>{void selectWelcomeSuggestion(item.id,d);},'agent-suggestion'),heading=el('span','agent-suggestion-heading');
   card.dataset.type=icon_category;heading.append(welcomeImage(input.references.length?'assets/agent-brainstorm.svg':icon,'agent-suggestion-icon '+(input.references.length?'brainstorm':'palette')),el('strong','',title));
   card.append(el('span','agent-suggestion-glow'),welcomeImage('assets/agent-welcome-arrow.svg','agent-suggestion-arrow'),heading,el('p','',input.text));
   card.onpointermove=event=>{const rect=card.getBoundingClientRect();card.style.setProperty('--mouse-x',(event.clientX-rect.left)+'px');card.style.setProperty('--mouse-y',(event.clientY-rect.top)+'px');};
   card.onpointerleave=()=>{card.style.removeProperty('--mouse-x');card.style.removeProperty('--mouse-y');};cards.append(card);
  }
  const refresh=btn(null,'换一组建议',()=>{if(page){offset=page.nextOffset;render();panel?.querySelector('.agent-refresh')?.focus();}},'agent-refresh');refresh.disabled=!page;refresh.append(welcomeImage('assets/agent-welcome-refresh.svg'));suggestionsWrap.append(cards,refresh);welcome.append(suggestionsWrap);welcome.hidden=Boolean(d.text?.trim());space.append(welcome);return space;
 }
 function refreshSceneContext(){
  if(!panel)return;const d=draft(),compose=panel.querySelector('.agent-composer');if(!compose)return;
  let context=compose.querySelector('.agent-studio-selection');const scene=window.StudioAPI?.getState();
  const selected=d.studioNodeId===scene?.nodeId?scene?.objects?.find(object=>object.id===scene.selectedId):null;
  if(!selected){context?.remove();return;}
  if(!context){context=el('p','agent-studio-selection');compose.insertBefore(context,compose.querySelector('.agent-input'));}
  context.title=selected.name;context.textContent='选中物体: '+selected.name;
 }
 function render(){if(!panel)return;questionView?.destroy();questionView=null;questionHeight=0;attachmentMenu?.destroy();attachmentMenu=null;historyControls.forEach(control=>control.destroy());historyControls=[];footerLayout?.destroy();footerLayout=null;confirmationControl?.destroy();confirmationControl=null;modelControl?.destroy();modelControl=null;const readerPosition=messageModule?.captureReaderPosition(panel.querySelector('.agent-messages'));messageRenderer?.reset();executionRenderer?.reset();messageRows=new WeakMap();const d=draft();if(recoveryChatId!==d.id){recoveryChatId=d.id;recoveryEpoch++;}const hasConversation=d.messages.length||d.interruptedRuns?.length,previousList=panel.querySelector('.agent-messages'),retainedList=hasConversation&&previousList?.dataset.sessionId===d.id?previousList:null;artifactCards?.prune(d.messages.filter(message=>message.role==='tool'));appCards?.prune(d.messages.filter(message=>message.role==='tool'));if(!retainedList)executionRenderer?.prune([]);panel.dataset.studio=String(!!d.studioNodeId);panel.dataset.chatId=d.id;panel.dataset.activeSceneId=window.StudioAPI?.getState()?.nodeId||'';for(const child of [...panel.children])if(child!==retainedList)child.remove();const head=el('div','agent-header');head.append(artifactButton(),historyButton(d.title),el('span','header-spacer'),historyButton(),btn('collapse','收起 AI 助手',close,'agent-close'));panel.prepend(head);
  if(!hasConversation&&d.studioNodeId){if(studioWelcome)panel.append(studioWelcome(text=>{d.text=[d.text,text].filter(Boolean).join("\n");save();render();focusComposer();}));}
  else if(!hasConversation)panel.append(canvasWelcome(d));
  else {
   const list=retainedList||el('div','agent-messages'),rows=[],groupKeys=[];list.dataset.sessionId=d.id;
   const lastAssistant=d.messages.findLastIndex(m=>m.role==='assistant'&&m.hidden!==true);
   for(let index=0;index<d.messages.length;index++){
    const m=d.messages[index],messageKey=d.id+':'+index;if(m.hidden===true)continue;let row;
    if(m.role==='tool'&&executionRenderer){
     const traces=[m];while(d.messages[index+1]?.role==='tool')traces.push(d.messages[++index]);
     const groupKey=d.id+':tools:'+(m.id||index);groupKeys.push(groupKey);row=executionRenderer.render(traces,{key:groupKey,collapse:!busy&&index<d.messages.length-1,streaming:busy});
    }else if(m.role==='tool')row=el('div','agent-message tool','正在加载执行记录…');
    else if(m.role==='user'&&m.formSubmission)row=el('div','agent-message user');
    else if(messageRenderer)row=messageRenderer.render(m,{key:messageKey,index,busy,lastAssistant:index===lastAssistant,pendingQuestion:!!pendingQuestion()});
    else{row=el('div','agent-message '+m.role);if(m.composerDoc&&composerModule)row.append(composerModule.renderComposerDocument(m.composerDoc));else row.textContent=m.text;}
    if(m.role==='user'&&m.formSubmission&&executionModule){const summary=executionModule.renderFormSummary({args:m.formDefinition,result:m.formSubmission,status:'done'},{resolveImage:resolveFormImage});if(summary)row.append(summary);}
    messageRows.set(m,row);rows.push(row);
   }
   for(const record of d.interruptedRuns||[]){const scope={projectId:project.id,conversationId:d.id,chat:d,epoch:recoveryEpoch};const row=recoveryModule?.createRecoveryView({record,scope,checking:recoveryController?.isChecking(record),disabled:busy||queueRunner?.running,onCheck:()=>{void recoveryController?.check(record,scope).catch(error=>notice(error.message));},onResume:()=>{void resumeInterruptedRun(record,scope).catch(error=>notice(error.message));}});if(row)rows.push(row);}
   if(reconcileMessages)reconcileMessages(list,rows);else list.replaceChildren(...rows);executionRenderer?.prune(groupKeys);if(!retainedList)panel.append(list);queueMicrotask(()=>{if(!list.isConnected)return;updateQueueLayout();if(messageModule)messageModule.restoreReaderPosition(list,readerPosition);else list.scrollTop=list.scrollHeight;});
  }
  const compose=el('div','agent-composer');if(attachmentUploadModule)compose.append(attachmentUploadModule.attachmentStrip(d.uploads,id=>{d.uploads=d.uploads.filter(item=>item.id!==id);save();render();}));const attachments=el('div','agent-attachments');for(const id of d.refs.filter(id=>id!==d.studioNodeId&&!composerModule?.referenceNodes(d.composerDoc).some(ref=>ref.kind==='node'&&ref.id===id))){const n=app.getState().nodes.find(n=>n.id===id);if(!n)continue;const b=btn(null,'移除 '+n.title,()=>{d.refs=d.refs.filter(x=>x!==id);d.referencePins=(d.referencePins||[]).filter(x=>x!==id);save();render();});if(n.image){const img=el('img');img.src=n.image;img.alt=n.title;b.append(img);}else b.textContent=n.title;attachments.append(b);}for(const ref of d.artifactRefs||[]){const chip=btn('file','移除产物引用 '+ref.title,()=>{d.artifactRefs=d.artifactRefs.filter(item=>item.artifact_path!==ref.artifact_path);save();render();},'agent-artifact-reference',ref.title);attachments.append(chip);}if(attachments.children.length)compose.append(attachments);
  if(d.quotedText){const quoted=el('div','agent-artifact-quote');quoted.append(el('span','',d.quotedText),btn('close','移除引用文字',()=>{d.quotedText='';save();render();}));compose.append(quoted);}
  const inlineSkills=composerModule?.mentionNames(composerModule.documentForDraft(d))||[];const visibleSkills=d.skills.filter(name=>(!d.studioNodeId||name!=='3d-scene-director')&&!inlineSkills.includes(name));if(visibleSkills.length){const badges=el('div','agent-skill-tags');for(const name of visibleSkills)badges.append(btn('close','移除 Skill '+name,()=>{d.skills=d.skills.filter(x=>x!==name);save();render();},'',name));compose.append(badges);}
  if(composerEditor?.sessionId!==d.id){composerEditor?.destroy();composerEditor=null;}const input=composerEditor?.element||el('div','agent-input');
  if(composerModule&&!composerEditor)composerEditor=composerModule.createComposerEditor({element:input,value:d,label:'AI 对话输入',placeholder:'随心输入',onChange:snapshot=>{composerModule.applyComposerSnapshot(d,snapshot);updateSendButton(panel?.querySelector('.agent-send'),d);updateWelcomeInput(d);save();},onSubmit:send});
  composerEditor?.sync(d);composerEditor?.setEditable(true);compose.append(input);
  const footer=el('div','agent-composer-footer'),left=el('div','agent-footer-left'),right=el('div','agent-footer-right'),actions=el('div','agent-footer-actions');
  const add=btn('plus','添加附件',null,'agent-add');add.disabled=!attachmentMenuModule;left.append(add,confirmationButton());if(attachmentMenuModule)attachmentMenu=attachmentMenuModule.createAddMenu({trigger:add,onAction:action=>attachmentAction(action,d.studioNodeId,add),getSkills:attachmentSkills,onSkill:name=>selectAttachmentSkill(name,d.studioNodeId),onError:notice});
  const sendButton=btn(busy?'stop':'arrow',busy?'停止执行':'发送',busy?stop:send,'agent-send');
  updateSendButton(sendButton,d);
  actions.append(btn('mic','语音输入',voice,'agent-voice'),sendButton);right.append(modelButton(),actions);footer.append(left,right);
  compose.append(footer);if(queueModule){if(!queueView)queueView=queueModule.createQueueView({renderComposer:composerModule?.renderComposerDocument,getNode:id=>app.getState().nodes.find(node=>node.id===id),resolveAsset:value=>window.LocalAssets.url(value),onEdit:editQueued,onRemove:id=>changeQueue(chat=>{chat.queuedMessages=chat.queuedMessages.filter(item=>item.id!==id);}),onReorder:(id,over)=>changeQueue(chat=>{chat.queuedMessages=queueModule.reorderQueue(chat.queuedMessages,id,over);}),onHeight:height=>{queueHeight=height;updateQueueLayout();}});compose.prepend(queueView.element);queueView.observeComposer(compose);queueView.update(d.queuedMessages);queueView.element.style.display=pendingQuestion()?'none':'';}mountQuestion(compose,d);panel.append(btn('cube','打开应用',()=>manage('apps'),'agent-open-apps','打开应用'),compose);footerLayout=modelModule?.observeFooter(footer,confirmationControl);
  if(modelModule&&!panelResize)panelResize=modelModule.createPanelResize({panel,onWidth:width=>app.setRightPanel(width),onError:notice});
  if(panelResize)panel.prepend(panelResize.element);queueMicrotask(updateQueueLayout);refreshSceneContext();studioChannel?.publish();if(d.queuedMessages?.length&&d.queuePauseReason)notice('队列已暂停：'+d.queuePauseReason);
 }
 function confirmationButton(){
  if(!confirmationModule){const pending=btn(null,'手动确认',null,'agent-confirm-mode');pending.disabled=true;return pending;}
  confirmationControl=confirmationModule.createControl({alignTo:()=>panel?.querySelector('.agent-add'),disabled:false,onError:notice,beforeOpen:()=>{modelControl?.close();historyControls.forEach(control=>control.close());}});
  return confirmationControl.element;
 }
 function modelButton(){
  if(!modelModule){const pending=btn(null,'AI 模型',null,'agent-model-trigger','Auto');pending.disabled=true;return pending;}
  modelControl=modelModule.createControl({session:draft(),disabled:false,onError:notice,beforeOpen:()=>{confirmationControl?.close();historyControls.forEach(control=>control.close());}});return modelControl.element;
 }
 function historyButton(title){
  if(!historyModule){const button=btn(null,title||'聊天记录',null,'agent-history-trigger',title||'');button.disabled=true;return button;}
  let control;
  control=historyModule.createControl({title,align:title===undefined?'end':'start',disabled:busy,getConversations:()=>historyModule.historyEntries(chats.filter(chat=>draft().studioNodeId?chat.studioNodeId===draft().studioNodeId:!chat.studioNodeId)),
   beforeOpen:()=>{historyControls.forEach(item=>{if(item!==control)item.close();});modelControl?.close();confirmationControl?.close();panel?.querySelector('.agent-dropdown')?.remove();},onError:notice,onMigrate:migrateConversationAttachments,
   onNew:async()=>{if(busy)return;const {newConversationScope}=await conversationScopeReady;if(busy)return;const previous=current;composerEditor?.sync(draft());chats.push({...newDraft(),...newConversationScope(draft(),window.StudioAPI?.getState()?.nodeId)});current=chats.length-1;if(!save()){chats.pop();current=previous;return;}render();},
   onSelect:id=>{if(busy)return;const index=chats.findIndex(chat=>chat.id===id);if(index<0)return;current=index;saveActive();render();},
   onRename:async(id,title)=>{if(busy)throw Error('请等待当前对话结束');const chat=chats.find(item=>item.id===id);if(!chat)throw Error('对话不存在');const previous=chat.title;chat.title=title;if(!save()){chat.title=previous;throw Error('重命名未能保存');}if(chat.id===draft().id){const label=panel?.querySelector('.agent-history-title');if(label){label.querySelector('span').textContent=title;label.ariaLabel=title;}}},
   onDelete:async id=>{const {newConversationScope}=await conversationScopeReady;if(busy)throw Error('请等待当前对话结束');const previous=chats,previousIndex=current,activeId=draft().id,scope=newConversationScope(draft(),window.StudioAPI?.getState()?.nodeId);chats=chats.filter(chat=>chat.id!==id);if(activeId===id){chats.push({...newDraft(),...scope});current=chats.length-1;}else current=chats.findIndex(chat=>chat.id===activeId);if(!save()){chats=previous;current=previousIndex;throw Error('删除未能保存');}if(activeId===id)render();}
  });historyControls.push(control);return control.element;
 }
 async function configPanel(){panel.querySelector('.agent-dropdown')?.remove();const p=el('div','agent-dropdown');p.append(el('strong','','Agent 设置'),el('p','','模型连接由本地服务配置。API Key 保留在服务端。'));try{const config=await fetch('/api/agent/config').then(r=>r.json());p.append(el('p','',config.configured?'已连接 · '+config.model:'待配置：'+(config.missing||[]).join('、')));}catch{p.append(el('p','','Agent 服务未启动，请运行 pnpm dev。'));}p.append(btn('settings','生成接口设置',()=>window.GenerationAPI.configure(),'','生成接口设置'),btn('cube','技能管理',()=>{p.remove();manage('skills');},'','技能管理'));panel?.append(p);}
 async function attachmentSkills(){return [...(await catalog()).filter(s=>!disabledSkills().includes(s.name)),...customSkills().filter(s=>!disabledSkills().includes(s.name))];}
 function referenceData(){let folders=[];try{folders=JSON.parse(localStorage.getItem('tapnow-folders')||'[]');}catch{}return {nodes:attachmentNodes(),library:window.CanvasLibrary?.items||[],folders};}
 async function openReferenceNode(id){const node=app.getState().nodes.find(n=>n.id===id);if(!node)throw Error('引用的画布素材已删除');await window.StudioAPI?.active?.close();app.select(id,true);}
 function attachmentNodes(){return app.getState().nodes.map(node=>node.type==='video'?{...node,video:node.video||window.EDITOR_DATA?.nodes[node.id]?.video}:node);}
 function attachmentChat(nodeId){if(!conversationsLoaded)throw Error('会话仍在加载，请稍后重试');if(busy&&nodeId&&draft().studioNodeId!==nodeId)throw Error('其他对话正在执行');if(nodeId)current=studioChat(nodeId).index;return draft();}
 async function selectAttachmentSkill(name,nodeId){await conversationReady;await composerReady;if(!composerModule)throw Error('输入编辑器未加载');const d=attachmentChat(nodeId);if(!composerModule.insertSessionSkill(d.id,name)){composerModule.applyComposerSnapshot(d,composerModule.appendSkill(d,name));save();render();focusComposer();}}
 function attach(){void attachmentAction('canvas',draft().studioNodeId);}
 async function attachmentAction(action,nodeId,trigger){await attachmentModules;const d=attachmentChat(nodeId);
  const persist=()=>{if(!chats.includes(d))throw Error('原对话已删除，未添加附件');if(!save())throw Error('附件未能保存');if(draft()===d)render();};
  if(action==='canvas')return attachmentPickerModule.openCanvasPicker({nodes:attachmentNodes(),selected:d.refs.filter(id=>id!==d.studioNodeId),returnFocus:trigger,onError:notice,onConfirm:ids=>{d.referencePins=ids;composerModule.applyComposerSnapshot(d,{doc:composerModule.documentForDraft(d)});persist();}});
  if(action==='upload')return attachmentUploadModule.chooseFiles({onError:notice,onFiles:files=>track(async()=>{const added=await attachmentUploadModule.storeUploads(files,window.LocalAssets);d.uploads=[...(d.uploads||[]),...added];persist();})});
  if(action.startsWith('app:')){const registry=await import('./src/features/agent-manager/registry.mjs'),item=registry.availableApps().find(a=>a.id===action.slice(4));if(!item)throw Error('应用未安装或已停用');await composerReady;composerModule.insertSessionReference(d.id,{kind:'app',id:item.id,label:item.label});return;}
  if(action==='brainstorm'){startBrainstorm();return;}
  if(action==='skills'||action==='apps'||action==='skill-create'){await manage(action==='apps'?'apps':'skills',action==='skill-create');return;}
  if(action==='skill-file'||action==='skill-folder'){const {readSkillPackage}=await import('./src/features/agent-manager/skill-package.mjs');return attachmentUploadModule.chooseFiles({accept:'.md,.markdown,text/markdown,text/x-markdown',multiple:action==='skill-folder',directory:action==='skill-folder',onError:error=>{if(document.querySelector('#skill-manager'))window.dispatchEvent(new CustomEvent('agent-skill-import-error',{detail:error}));else notice(error);},onFiles:files=>track(async()=>{const result=await readSkillPackage(files,{directory:action==='skill-folder',existing:[...(await catalog()),...customSkills()]});const {updatePersonalSkill}=await import('./src/features/agent-manager/skill-commit.mjs');await updatePersonalSkill({skill:result.skill,builtinNames:(await catalog()).map(skill=>skill.name)});window.dispatchEvent(new Event('agent-skills-changed'));const message='技能「'+result.skill.name+'」上传成功'+(result.skipped?'；已跳过 '+result.skipped+' 个非 Markdown 文件':'');if(document.querySelector('#skill-manager'))window.dispatchEvent(new CustomEvent('agent-skill-import-notice',{detail:message}));else{await selectAttachmentSkill(result.skill.name,nodeId);notice(message+'并添加到对话');}})});}

 }
 function voice(){const trigger=panel.querySelector('.agent-composer-footer [aria-label="语音输入"]'),target=composerEditor?.dom,d=draft();if(!target)return;window.VoiceInput.bind(trigger,{target,getValue:()=>composerEditor.getText(),setValue:value=>composerEditor.setText(value),isCurrent:()=>draft().id===d.id,mount:panel.querySelector('.agent-composer-footer')});trigger.click();}

 async function request(path,data,signal,{chat=draft(),seenCallIds}={}){
  const capturedRun=chat.activeRun;
  const module=await streamReady;
  if(!['turn','continue'].includes(path))return module.requestAgent(path,data,{signal});
  const ownsRun=()=>!pageLeaving&&draft()===chat&&chats.includes(chat)&&chat.activeRun===capturedRun&&capturedRun?.binding?.projectId===project.id;
  if(signal?.aborted||!ownsRun())throw new DOMException('Aborted','AbortError');
  const batch=module.createFrameBatch(messages=>{if(ownsRun())updateStreamRows(chat,messages);});
  const state=module.createStreamState({messages:chat.messages,requestId:crypto.randomUUID(),onChange:message=>{if(ownsRun()){batch.add(message);persistStreamingSoon();}},onSession:id=>{if(!ownsRun())return;if(capturedRun.sessionId&&capturedRun.sessionId!==id)throw Error('续轮会话身份不一致，已停止接收');sessionId=id;if(capturedRun.sessionId!==id){capturedRun.sessionId=id;persistStreamingNow();}}});
  const run={state,batch,chat};activeStream=run;
  try{const result=await module.requestAgent(path,data,{signal,seenCallIds,onEvent:event=>{if(!ownsRun())throw new DOMException('Aborted','AbortError');state.event(event);}});if(!ownsRun())throw new DOMException('Aborted','AbortError');if(path==='continue'&&result.sessionId!==data.sessionId)throw Error('续轮返回的会话身份不一致');state.finish(result);return result;}
  catch(error){state.interrupt(error.name==='AbortError'||signal?.aborted?'你已停止本次回复。已完成的画布修改可以撤销。':error.message);error.agentStreamHandled=true;throw error;}
  finally{batch.flush();batch.destroy();persistStreamingNow();if(activeStream===run)activeStream=null;}
 }
 function persistQueue(){if(!save())throw Error('队列未能写入本地存储');}
 function validateSubmission(d,item){
  if(appQueueSaving)throw Error('应用消息正在保存，请稍后重试。');
  if(pageLeaving)throw Error('页面已离开，排队任务已暂停。');
  if(!modelModule)throw Error('模型控件正在加载，请稍后再试。');
  if(item.studioNodeId!== (d.studioNodeId||null))throw Error('排队任务所属片场已改变');
  if(d.studioNodeId&&window.StudioAPI.getState()?.nodeId!==d.studioNodeId)throw Error('请先打开此对话对应的片场，再继续执行。');
 }
 function clearSubmittedDraft(d){
  if(composerModule)composerModule.applyComposerSnapshot(d,{doc:composerModule.textDocument('')});else d.text='';
  d.uploads=[];d.artifactRefs=[];d.quotedText='';
 }
 function updateSendButton(button,d){
  if(!button)return;const question=pendingQuestion(),selected=question?.questionDraft?.answers?.[question.questionDraft?.step]?.selected_labels?.length>0,stopping=busy&&!d.text.trim()&&!selected;button.disabled=!busy&&!d.text.trim();
  button.dataset.stopping=String(stopping);button.ariaLabel=button.title=stopping?'停止执行':'发送';button.innerHTML=window.UI_ICONS[stopping?'stop':'arrow']||'';button.onclick=stopping?stop:send;
 }
 function updateQueueLayout(){
  if(!panel)return;
  const compose=panel.querySelector('.agent-composer'),list=panel.querySelector('.agent-messages'),apps=panel.querySelector('.agent-open-apps');
  if(!compose)return;
  const welcome=panel.querySelector('.agent-welcome-space');if(welcome){const panelRect=panel.getBoundingClientRect();welcome.style.bottom=(panelRect.bottom-compose.getBoundingClientRect().top)+'px';}
  const question=pendingQuestion();if(apps)apps.style.display=question||welcome?'none':'';const composeTop=24+compose.offsetHeight,appsVisible=apps&&getComputedStyle(apps).display!=='none';
  if(apps)apps.style.bottom=(composeTop+12)+'px';
  if(list){const follow=list.scrollHeight-list.clientHeight-list.scrollTop<48;list.style.bottom=(appsVisible?composeTop+12+apps.offsetHeight+12:composeTop+(question?questionHeight:queueHeight)+20)+'px';if(follow)list.scrollTop=list.scrollHeight;}
 }
 function changeQueue(action){if(appQueueSaving){notice('应用消息正在保存，请稍后重试。');return;}if(recoveryRunning){notice('中断任务恢复期间队列已锁定，请等待本次恢复结束');return;}const d=draft(),before=clone(d);try{action(d);persistQueue();queueView?.update(d.queuedMessages);render();}catch(error){Object.assign(d,before);notice(error.message);}}
 function editQueued(id){changeQueue(d=>{const item=d.queuedMessages?.find(item=>item.id===id);if(!item)return;queueModule.restoreSubmission(d,item);d.queuedMessages=d.queuedMessages.filter(item=>item.id!==id);});focusComposer();}
 async function submitQuestionText(d){
  const trace=pendingQuestion(),view=questionView,original=d.text;if(!trace||!view)return;
  const text=original.trim();if(text.length>200){notice('自由回答最多200字，请缩短后提交。');return;}
  if(text)view.setFreeText(text);
  if(await view.submit()&&draft()===d&&d.text===original){
   if(composerModule)composerModule.applyComposerSnapshot(d,{doc:composerModule.textDocument('')});else d.text='';
   save();render();
  }
 }
 async function saveAppState(chat,trace,state){
  if(pageLeaving||!panel||draft()!==chat||!chat.messages.includes(trace)||trace.name!=='show_app'||trace.status!=='done'||trace.error||trace.result?.error)throw Error('应用所属会话已结束或切换');
  const previous=trace.appState;trace.appState=state;
  try{if(!save())throw Error('应用状态未能保存');await flushConversation();}
  catch(error){if(trace.appState===state){if(previous===undefined)delete trace.appState;else trace.appState=previous;}throw error;}
 }
 function queueWidgetPrompt(text,trace,chat,metadata,isSourceCurrent=()=>true,validateSourceCurrent,onSubmissionCommitted){
  if(appQueueSaving)return false;
  if(pageLeaving||!panel||draft()!==chat||!chat.messages.includes(trace)||!['show_widget','show_app'].includes(trace.name)||trace.status!=='done'||trace.error||trace.result?.error)throw Error('互动组件所在对话已结束或切换');
  const appReplyId=trace.result?.resource_uri==='ui://tapnow/previs@v3'?metadata?.appReplyId:null,appReplyFingerprint=metadata?.appReplyFingerprint;
  if(appReplyId){if(typeof appReplyId!=='string'||!appReplyId||appReplyId.length>180||typeof appReplyFingerprint!=='string'||!/^[a-f0-9]{64}$/.test(appReplyFingerprint))throw Error('应用回复缺少准确的已核验身份');const prior=trace.appReplyReceipts?.find(receipt=>receipt.reply_id===appReplyId);if(prior){if(prior.fingerprint!==appReplyFingerprint)throw Error('同一应用回复身份不能改变已提交计划');return {reply_id:appReplyId,run_id:prior.run_id,deduped:true};}}
  if(recoveryRunning)return false;
  const handoffId=trace.name==='show_app'?metadata?.handoffId:null;if(handoffId&&trace.appHandoffs?.includes(handoffId))return true;
  // Official app prompts are unavailable while a conversation is running.
  if(trace.name==='show_app'&&(busy||queueRunner?.running||chat.queuedMessages?.length))return false;
  if(!queueModule||!queueRunner||!modelModule||!composerModule)throw Error('消息模块正在加载，请稍后再试');
  // A widget submits a new turn; never route it through the pending question's
  // send() handler or consume the user's unrelated composer draft/attachments.
  const composerDoc=composerModule.textDocument(text);
  if(trace.result?.resource_uri==='ui://tapnow/library-picker@v1'){
   const ref=metadata?.libraryReference;if(!isSourceCurrent()||ref?.kind!=='library'||ref.scope!=='personal'||typeof ref.id!=='string'||typeof ref.label!=='string'||!liveLibrary().items.some(item=>item.id===ref.id&&item.scope!=='team'&&item.type===ref.mediaType))throw Error('素材库交接缺少已核验的实际个人素材引用');
   // The trusted runtime resolves this mention through the existing attachment
   // pipeline, so the model receives actual bytes rather than a library token.
   composerDoc.content.unshift({type:'paragraph',content:[{type:'referenceMention',attrs:clone(ref)}]});
  }
  const submission=queueModule.captureSubmission({...chat,text,composerDoc,uploads:[],refs:chat.studioNodeId?[chat.studioNodeId]:[],referencePins:[],artifactRefs:[],quotedText:''},{selection:modelModule.prepareSessionSelection(chat)});
  submission.widgetOrigin={traceId:trace.id,callId:trace.callId,title:trace.args?.title||'互动组件',...(trace.name==='show_app'?{resourceUri:trace.result.resource_uri,handoffId,...(appReplyId?{appReplyId}:{})}: {})};
  // Hidden changes presentation only; preserve the raw prompt and provenance.
  if(trace.name==='show_app'&&metadata?.hidden===true)submission.hidden=true;
  validateSubmission(chat,submission);const previousQueue=chat.queuedMessages,previousPause=chat.queuePauseReason,previousHandoffs=trace.appHandoffs,previousReplies=trace.appReplyReceipts;
  const nextQueue=[...(chat.queuedMessages||[]),submission],nextHandoffs=handoffId?[...(trace.appHandoffs||[]),handoffId]:previousHandoffs,resourceUri=trace.result?.resource_uri,appResult=trace.result,appState=trace.appState;
  chat.queuedMessages=nextQueue;chat.queuePauseReason=null;
  if(handoffId)trace.appHandoffs=nextHandoffs;
  const appReplyReceipt=appReplyId?{reply_id:appReplyId,run_id:submission.id,fingerprint:appReplyFingerprint,status:'waiting',created_at:Date.now()}:null,nextReplies=appReplyReceipt?[...(previousReplies||[]),appReplyReceipt]:previousReplies;if(appReplyReceipt)trace.appReplyReceipts=nextReplies;
  const rollback=()=>{
   chat.queuedMessages=chat.queuedMessages===nextQueue?previousQueue:chat.queuedMessages.filter(item=>item!==submission);
   if(chat.queuePauseReason===null)chat.queuePauseReason=previousPause;
   if(appReplyReceipt&&trace.appReplyReceipts===nextReplies){if(previousReplies===undefined)delete trace.appReplyReceipts;else trace.appReplyReceipts=previousReplies;}
   if(handoffId){if(trace.appHandoffs===nextHandoffs){if(previousHandoffs===undefined)delete trace.appHandoffs;else trace.appHandoffs=previousHandoffs;}else if(trace.appHandoffs)trace.appHandoffs=trace.appHandoffs.filter(id=>id!==handoffId);}
  };
  if(trace.name==='show_app')appQueueSaving=true;
  try{persistQueue();}catch(error){rollback();appQueueSaving=false;throw error;}
  if(trace.name==='show_app')return track(async()=>{
   let committed=false;
   try{
    // A successful app receipt owns a committed queue item and handoff ID.
    // Keep the runner locked until persistence and source checks both finish.
    await flushConversation();committed=true;
    if(validateSourceCurrent)await validateSourceCurrent();
    if(!isSourceCurrent()||pageLeaving||!panel||draft()!==chat||!chat.messages.includes(trace)||trace.name!=='show_app'||trace.status!=='done'||trace.error||trace.result?.error||trace.result!==appResult||trace.appState!==appState||trace.result?.resource_uri!==resourceUri||busy||recoveryRunning)throw Error('应用消息保存期间来源已切换或会话已开始');
    if(onSubmissionCommitted)await onSubmissionCommitted({reply_id:appReplyId,run_id:submission.id,deduped:false});
    if(!isSourceCurrent())throw Error('应用运行绑定保存期间来源已切换');
    appQueueSaving=false;render();void queueRunner.drain();return appReplyReceipt?{reply_id:appReplyId,run_id:submission.id,deduped:false}:true;
   }catch(error){
    rollback();
    if(committed){try{persistQueue();await flushConversation();}catch(failure){throw Error('应用消息撤销未能保存，请保留本页并重试：'+failure.message);}}
    throw error;
   }finally{appQueueSaving=false;}
  });
  render();void queueRunner.drain();return true;
 }
 const previsSelectionWork=new WeakMap();
 function restorePrevisSelectionProjection(trace,chat){
  if(pageLeaving||!panel||draft()!==chat||!chat.messages.includes(trace)||trace.result?.resource_uri!=='ui://tapnow/previs@v3'||!previsRuntime||!trace.appState||!Object.values(trace.appState.edits||{}).some(edit=>edit.image))return Promise.resolve();
  const result=trace.result,state=trace.appState,stateKey=JSON.stringify(state),previous=previsSelectionWork.get(trace);if(previous?.result===result&&previous.stateKey===stateKey)return previous.work;
  const work=track(async()=>{const context=getGenerationAppSourceContext(result.response,trace,chat);try{
   const projection=await context.querySelectedVariants({recover:true});if(projection.pending){previsSelectionWork.delete(trace);return;}if(!projection.changed)return;context.guard();if(trace.result!==result||trace.appState!==state||JSON.stringify(state)!==stateKey||pageLeaving||draft()!==chat)throw Error('已选图板恢复期间编辑或会话已切换');
   const oldRevision=trace.projection_revision,next={...result,response:projection.projection.response,previsSourceContext:projection.projection.previsSourceContext},revision={message_sequence:chat.messages.indexOf(trace),part_index:(oldRevision?.part_index??0)+1};trace.result=next;trace.projection_revision=revision;
   try{if(!save())throw Error('已选真实图板投影保存失败');await flushConversation();if(trace.result!==next||trace.appState!==state||JSON.stringify(state)!==stateKey||pageLeaving||draft()!==chat)throw Error('已选图板投影保存期间来源已切换');const verified=getGenerationAppSourceContext(next.response,trace,chat);try{await verified.validateSourcesCurrent();}finally{verified.dispose();}}
   catch(error){if(trace.result===next)trace.result=result;if(trace.projection_revision===revision){if(oldRevision===undefined)delete trace.projection_revision;else trace.projection_revision=oldRevision;}try{if(!save())throw Error('已选图板补偿未保存');await flushConversation();}catch{throw Error('已选图板投影及补偿保存失败，请保留本页核对');}throw error;}render();
  }finally{context.dispose();}}).catch(error=>{if(previsSelectionWork.get(trace)?.work===work)previsSelectionWork.delete(trace);throw error;});previsSelectionWork.set(trace,{result,stateKey,work});return work;
 }
 const previsProjectionWork=new WeakMap();
 function refreshPrevisProjection(trace,chat){
  if(previsProjectionWork.has(trace))return previsProjectionWork.get(trace);
  const work=track(async()=>{
   await restorePrevisSelectionProjection(trace,chat);
   if(pageLeaving||!panel||draft()!==chat||!chat.messages.includes(trace)||trace.result?.resource_uri!=='ui://tapnow/previs@v3'||!trace.previsJobs?.some(row=>row.kind==='sheet'))return;
   const {previsReplyPayload,previsCanonical,initialPrevisState}=await import('./src/features/agent-apps/previs.mjs'),entry=trace.previsReplies?.filter(row=>row.status==='accepted'&&row.run_id).at(-1),oldResult=trace.result,oldState=trace.appState,oldRevision=trace.projection_revision,oldProjection=trace.previsProjectionReceipt;
   if(!entry)return;const savedPayload=previsCanonical(previsReplyPayload(oldResult.response,oldState)),acceptedPayload=previsCanonical(entry.payload);if(savedPayload!==acceptedPayload&&!(oldProjection?.reply_id===entry.reply_id&&oldProjection.manifest_revision===entry.manifest_revision&&savedPayload===oldProjection.saved_payload))return;
   const context=getGenerationAppSourceContext(oldResult.response,trace,chat);
   try{
    const result=await context.querySheets();if(!result.changed||previsCanonical(result.projection.response)===previsCanonical(oldResult.response))return;
    context.guard();if(trace.appState!==oldState||trace.result!==oldResult||pageLeaving||draft()!==chat)throw Error('图板读取期间预演编辑或会话已切换');
    const next={...oldResult,response:result.projection.response,previsSourceContext:result.projection.previsSourceContext},state=initialPrevisState(next.response),revision={message_sequence:chat.messages.indexOf(trace),part_index:(oldRevision?.part_index??0)+1};trace.result=next;trace.appState=state;trace.projection_revision=revision;const projectionReceipt={reply_id:entry.reply_id,manifest_revision:entry.manifest_revision,saved_payload:previsCanonical(previsReplyPayload(next.response,state))};trace.previsProjectionReceipt=projectionReceipt;
    try{if(!save())throw Error('真实图板投影保存失败');await flushConversation();if(trace.result!==next||trace.appState!==state||pageLeaving||draft()!==chat)throw Error('图板投影保存期间来源已切换');const verified=getGenerationAppSourceContext(next.response,trace,chat);try{await verified.validateSourcesCurrent();}finally{verified.dispose();}}
    catch(error){if(trace.previsProjectionReceipt===projectionReceipt){if(oldProjection===undefined)delete trace.previsProjectionReceipt;else trace.previsProjectionReceipt=oldProjection;}if(trace.result===next)trace.result=oldResult;if(trace.appState===state)trace.appState=oldState;if(trace.projection_revision===revision){if(oldRevision===undefined)delete trace.projection_revision;else trace.projection_revision=oldRevision;}try{if(!save())throw Error('投影补偿未保存');await flushConversation();}catch{throw Error('图板投影及补偿保存失败，请保留本页核对');}throw error;}render();
   }finally{context.dispose();}
  }).finally(()=>previsProjectionWork.delete(trace));previsProjectionWork.set(trace,work);return work;
 }
 async function appReplyRunStatus(params,trace,chat){
  if(trace.result?.resource_uri!=='ui://tapnow/previs@v3'||draft()!==chat||!chat.messages.includes(trace))throw Error('应用回复不属于当前真实会话');
  const receipt=trace.appReplyReceipts?.find(item=>item.run_id===params.run_id);if(!receipt)return {status:'unknown'};
  await refreshPrevisProjection(trace,chat);if(draft()!==chat||!chat.messages.includes(trace))throw Error('预演图板查询期间会话已切换');
  if(chat.activeRun?.submissionId===receipt.run_id)return {status:pendingResolve?'waiting':'running'};
  if(chat.queuedMessages?.some(item=>item.id===receipt.run_id&&item.widgetOrigin?.traceId===trace.id&&item.widgetOrigin?.appReplyId===receipt.reply_id))return {status:'waiting'};
  if(chat.interruptedRuns?.some(item=>item.submissionId===receipt.run_id))return {status:'unknown'};
  return {status:receipt.status==='completed'?'inactive':'unknown'};
 }
 function markAppReplyRun(chat,item,status){
  if(item.widgetOrigin?.resourceUri!=='ui://tapnow/previs@v3'||!item.widgetOrigin.appReplyId)return;
  const trace=chat.messages.find(entry=>entry.id===item.widgetOrigin.traceId&&entry.result?.resource_uri===item.widgetOrigin.resourceUri),receipt=trace?.appReplyReceipts?.find(entry=>entry.run_id===item.id&&entry.reply_id===item.widgetOrigin.appReplyId);
  if(!receipt)return false;receipt.status=status;receipt.updated_at=Date.now();return true;
 }
 function send(){
  if(appQueueSaving){notice('应用消息正在保存，请稍后重试。');return;}
  if(!conversationsLoaded){notice('会话仍在加载，请稍后重试');return;}
  const d=draft();if(pendingQuestion()){void submitQuestionText(d).catch(error=>notice(error.message));return;}if(!d.text.trim())return;
  if(!queueModule||!queueRunner){notice('队列模块正在加载，请稍后再试。');return;}
  if(recoveryRunning){notice('中断任务正在继续，请等待本次恢复结束后再发送新需求');return;}
  const before=clone(d);
  try{
   if(!modelModule)throw Error('模型控件正在加载，请稍后再试。');
   const item=queueModule.captureSubmission(d,{doc:composerModule?.documentForDraft(d),selection:modelModule.prepareSessionSelection(d)});
   validateSubmission(d,item);d.queuedMessages=[...(d.queuedMessages||[]),item];d.queuePauseReason=null;clearSubmittedDraft(d);persistQueue();
  }catch(error){Object.assign(d,before);notice(error.message);return;}
  render();void queueRunner.drain();
 }
 async function runSubmission(d,item){
  const text=item.text.trim(),selection=item.selection,submittedDoc=item.composerDoc,submittedSkills=[...item.skills],submittedRefs=[...item.refs],submittedReferences=composerModule?.referenceNodes(submittedDoc)||[];
  const priorMessages=d.messages.slice();
  const history=priorMessages.filter(m=>['user','assistant'].includes(m.role)).slice(-16).map(m=>({role:m.role,content:m.text}));
  d.updatedAt=new Date().toISOString();d.messages.push({role:'user',sentAt:Date.now(),text,uploads:clone(item.uploads),...(item.hidden===true&&item.widgetOrigin?.resourceUri?{hidden:true}:{}),...(item.widgetOrigin?{widgetOrigin:clone(item.widgetOrigin)}:{}),...(item.formSubmission?{formSubmission:clone(item.formSubmission),formDefinition:clone(item.formDefinition)}:{}),...(submittedDoc?{composerDoc:submittedDoc}:{})});
  if(d.title==='新建对话')d.title=text.slice(0,22);
  if(d.studioNodeId){try{localStorage.setItem(project.storageKey('studio-composer-sent:'+d.studioNodeId),'true');}catch{notice('发送状态未能保存');}}
  busy=true;const run=recoveryModule.beginRun(d,{projectId:project.id,submissionId:item.id});markAppReplyRun(d,item,'running');sessionId=null;controller=new AbortController();const runController=controller;let completed=false;render();save();queueMicrotask(()=>{const list=panel?.querySelector('.agent-messages');if(list?.dataset.sessionId===d.id)list.scrollTop=list.scrollHeight;});let outcome={};const seenCallIds=new Set();
  try{
   if(!save())throw Error('任务身份未能保存，尚未发送模型请求');
   await executionReady;await flushConversation();
   const {conversationContext}=await import('./src/features/agent-history/context.mjs');
   const conversationMemory=conversationContext({...d,messages:priorMessages});
   let appLibraryContext=null;
   if(item.widgetOrigin?.resourceUri==='ui://tapnow/library-picker@v1'){
    const origin=d.messages.find(trace=>trace.id===item.widgetOrigin.traceId&&trace.name==='show_app'&&trace.status==='done'&&trace.result?.resource_uri===item.widgetOrigin.resourceUri);
    if(!origin||submittedReferences.filter(ref=>ref.kind==='library'&&ref.scope==='personal').length!==1)throw Error('素材库排队任务缺少原始应用和实际引用来源');
    appLibraryContext=getLibrarySourceContext(origin.result.response,origin,d);await appLibraryContext.guard();
   }
   const referencedMaterials=composerModule?.resolveReferenceData(submittedReferences,referenceData())||[];
   const mediaItems=[...item.uploads,...referencedMaterials.filter(n=>n.source==='library'&&(n.image||n.fullImage||n.video)).map(n=>({name:n.name,asset:n.video||n.fullImage||n.image,type:n.video?'video':'image'})),...submittedRefs.map(id=>attachmentNodes().find(n=>n.id===id)).filter(n=>n&&(n.image||n.video)).map(n=>({name:n.title||n.type,asset:n.video||n.image,type:n.video?'video':'image'}))];
   const prepare=attachmentInputAdapter||(await import('./src/features/agent-attachments/media-inputs.mjs')).prepareMediaInputs;
   const mediaInputs=await prepare(mediaItems,{signal:controller.signal,resolveUrl:window.LocalAssets.url});
   if(appLibraryContext)await appLibraryContext.guard();
   if(controller.signal.aborted)throw new DOMException('Aborted','AbortError');
   if(d.studioNodeId){await window.StudioAPI.prepareAgentContext();validateSubmission(d,item);}
   const depthHost=await depthHostFor(d);depthHost.beginTurn(item.id);
   await recoveryModule.initializeJournal(run,{submission:item,sourceVersion:await recoverySourceVersion(d,{persistCanvas:true})});await persistRunCheckpoint(d,run);
   let response=await request('turn',{binding:run.binding,message:item.formSubmission?'':text,history,...(item.formSubmission?{formSubmission:{form:item.formDefinition,result:item.formSubmission}}:{}),modelSelection:selection,mediaInputs,context:{conversationMemory,...(item.widgetOrigin?{widgetOrigin:item.widgetOrigin}:{}),composerReferences:submittedReferences,referenceMaterials:referencedMaterials.map(({id,name,title,type,source,content})=>({id,name:name||title,type,source,content:content?.slice(0,20000)})),...(await graph()),artifacts:await artifactContext(item,d),references:submittedRefs,selectedSkills:submittedSkills,attachments:item.uploads.map(({id,name,type,mime,size})=>({id,name,type,mime,size,visualInput:mediaInputs.some(input=>input.name===name)})),activeScene:window.StudioAPI.getState(),studioNodeId:d.studioNodeId||null}},controller.signal,{chat:d,seenCallIds});
   completed=await runToolLoop(d,item,run,response,{depthHost,seenCallIds,runController});
  }catch(error){
   const cancelled=error.name==='AbortError'||runController.signal.aborted;
   recoveryModule.interruptRun(d,run,{reason:pageLeaving?'页面已离开，执行状态待核对':cancelled?'已请求停止，服务端状态待核对':error.message});
   if(!error.agentStreamHandled)d.messages.push({role:'assistant',sentAt:Date.now(),text:cancelled?'本次执行已停止。已完成的画布修改可以撤销。':error.message});
   if(!cancelled)outcome={error:error.message};
  }finally{markAppReplyRun(d,item,completed?'completed':'unknown');if(completed&&d.activeRun===run)delete d.activeRun;else if(!completed&&d.activeRun===run)recoveryModule.interruptRun(d,run);save();try{await flushConversation();}catch(error){markAppReplyRun(d,item,'unknown');if(completed)recoveryModule.interruptRun(d,run,{reason:'执行已返回，最终对话记录未能保存，状态待核对'});outcome={error:'对话保存失败：'+error.message};notice(outcome.error);}busy=false;controller=null;sessionId=null;pendingResolve=null;pendingTraceId=null;save();render();}
  return outcome;
 }
 function ownsAgentRun(chat,run){return !pageLeaving&&draft()===chat&&chats.includes(chat)&&chat.activeRun===run&&run.binding?.projectId===project.id;}
 async function persistRunCheckpoint(chat,run){
  if(!ownsAgentRun(chat,run)||controller?.signal.aborted)throw new DOMException('任务上下文已离开','AbortError');
  if(!save())throw Error('执行检查点未能保存，已阻止模型续轮');
  await flushConversation();
  if(!ownsAgentRun(chat,run)||controller?.signal.aborted)throw new DOMException('任务上下文已离开','AbortError');
 }
 async function recoverySourceVersion(chat,{persistCanvas=false}={}){
  if(chat.studioNodeId){if(window.StudioAPI?.getState()?.nodeId!==chat.studioNodeId)throw Error('请先打开原任务对应的片场，再继续执行');await window.StudioAPI.prepareAgentContext();}
  if(persistCanvas)await app.saveProject();
  const store=await artifactsReady,files=await store.list(),builtinSkills=await catalog(),state=app.getState(),editor=window.CanvasImageEditor?.current;
  if(editor&&(editor.loading||editor.saving||editor.crop||editor.canvas?._currentTransform||editor.resizing))throw Error('图片编辑器正在操作，请完成后再核对来源版本');
  const scene=chat.studioNodeId?window.StudioAPI.getState():null;
  const subjectLibrary=await import('./src/features/subject-library/store.mjs');await subjectLibrary.readySubjects();
  return recoveryModule.fingerprint({projectId:project.id,studioNodeId:chat.studioNodeId||null,nodes:state.nodes,edges:state.edges,
   configs:state.nodes.filter(node=>['image','video'].includes(node.type)).map(node=>({id:node.id,config:window.NodeEditor?.getConfig(node)||{}})),
   artifacts:files.map(({artifact_path,revision,content_type,source_artifact_path,source_revision})=>({artifact_path,revision,content_type,source_artifact_path,source_revision})),
   scene:scene?Object.fromEntries(['version','nodeId','sessionId','revision','objects','room','ground','environment','activeSetup','setups','cameras','animations','lighting'].map(key=>[key,scene[key]])):null,
   editor:editor?{nodeId:editor.nodeId,sessionId:editor.sessionId,revision:editor.revision,document:editor.document()}:null,
   builtinSkills,personalSkills:customSkills(),disabledSkills:disabledSkills(),library:window.CanvasLibrary?.items||[],
   subjectLibrary:await subjectLibrary.getSubjectStore().recoverySource(),
   formSubmissions:chat.messages.filter(message=>message.role==='user'&&message.formSubmission).map(message=>message.formSubmission)});
 }
 async function resumeInterruptedRun(record,scope){
  const d=scope.chat;
  const ownsPreparation=()=>!pageLeaving&&!!panel&&recoveryEpoch===scope.epoch&&draft()===d&&chats.includes(d)&&d.interruptedRuns?.includes(record)&&!d.activeRun&&project.id===scope.projectId;
  if(busy||queueRunner?.running||!ownsPreparation())throw Error('任务所在对话已切换或其他执行尚未结束');
  recoveryRunning=true;recoveryPreparing=true;busy=true;sessionId=record.sessionId;controller=new AbortController();const runController=controller;let run=record,activated=false,completed=false;render();
  const assertPreparation=()=>{if(!ownsPreparation()||runController.signal.aborted)throw new DOMException('恢复准备已失效','AbortError');};
  const persistPreparation=async()=>{assertPreparation();if(!save())throw Error('恢复准备记录未能保存，未发送模型请求');await flushConversation();assertPreparation();};
  try{
   await executionReady;assertPreparation();await persistPreparation();
   const fresh=await request('state',{sessionId:record.sessionId,binding:record.binding},runController.signal,{chat:d});
   assertPreparation();record.state=recoveryModule.checkedSummary(record,fresh);record.checkedAt=Date.now();await persistPreparation();
   const plan=await recoveryModule.buildResumePlan(record,scope,await recoverySourceVersion(d));assertPreparation();
   const item=record.journal.submission;validateSubmission(d,item);
   if(await recoverySourceVersion(d)!==plan.sourceVersion)throw Error('继续前来源版本再次变化，任务已暂停');
   const depthHost=await depthHostFor(d);assertPreparation();depthHost.beginTurn(item.id);
   run={...record,resuming:true};delete run.resumeError;delete run.resumeErrorCode;
   d.interruptedRuns=d.interruptedRuns.filter(item=>item!==record);d.activeRun=run;activated=true;recoveryPreparing=false;
   d.queuePauseReason='中断任务恢复期间队列已暂停；请在恢复结束后明确发送新需求。';
   run.journal.phase='continue_requested';await persistRunCheckpoint(d,run);render();
   const seenCallIds=new Set(plan.seenCallIds);
   if(await recoverySourceVersion(d)!==plan.sourceVersion)throw Error('保存恢复记录期间来源版本已变化，未发送模型请求');
   const response=await request('continue',{sessionId:plan.sessionId,binding:plan.binding,results:plan.results},runController.signal,{chat:d,seenCallIds});
   recoveryModule.assertResumeResponse(response,plan);
   completed=await runToolLoop(d,item,run,response,{depthHost,seenCallIds,runController});
  }catch(error){
   if(activated||ownsPreparation()){
    run.resumeError=error.name==='AbortError'?'本次继续已中断，请重新核对服务端状态。':error.message;run.resumeErrorCode=error.code||'resume_failed';
    if(activated)recoveryModule.interruptRun(d,run,{reason:run.resumeError});
    if(!error.agentStreamHandled)notice(run.resumeError);
   }
  }finally{
   if(activated){if(completed&&d.activeRun===run)delete d.activeRun;else if(d.activeRun===run)recoveryModule.interruptRun(d,run);delete run.resuming;}
   if(activated||ownsPreparation()){
    try{if(!save())throw Error('恢复记录未能保存');await flushConversation();}
    catch(error){run.saveError=error.message;if(activated)recoveryModule.interruptRun(d,run,{reason:'恢复执行的最终记录未能保存'});notice('恢复记录未能保存：'+error.message);}
   }
   recoveryPreparing=false;recoveryRunning=false;busy=false;controller=null;sessionId=null;pendingResolve=null;pendingTraceId=null;render();
  }
 }
 async function runToolLoop(d,item,run,response,{depthHost,seenCallIds,runController}){
   while(true){
    sessionId=response.sessionId||sessionId;if(sessionId&&d.activeRun===run){run.sessionId=sessionId;persistStreamingNow();}render();if(response.done)return true;
    recoveryModule.recordPendingRound(run,response,seenCallIds);await persistRunCheckpoint(d,run);
    const results=[],visualBudget={remaining:700000};
    for(let callIndex=0;callIndex<response.calls.length;){
     const getConfig=id=>{const node=app.getState().nodes.find(n=>n.id===id);return node?window.NodeEditor?.getConfig(node)||{}:{};};
     const calls=generationBatch.groupGenerationCalls(response.calls.slice(callIndex).map(call=>generationBatch.snapshotAudioCall(call,app.getState())),{nodes:app.getState().nodes,getConfig})[0];
     callIndex+=calls.length;const call=calls[0];
     if(runController.signal.aborted)throw new DOMException('Aborted','AbortError');
     const definition=window.AgentTools.parse(call.name,call.args).definition;
     const executionOptions={
      runId:item.id,signal:runController.signal,
      requestInput:call.name==='ask_question'?trace=>requestQuestion(trace,d,runController.signal):null,
      confirm:executionModule.needsToolConfirmation(definition,item.widgetOrigin?'ask':confirmationModule?.getMode())?trace=>new Promise(resolve=>{pendingTraceId=trace.id;pendingResolve=allowed=>{pendingResolve=null;pendingTraceId=null;resolve(allowed);};}):null,
      execute:async(name,args)=>{
       if(name.startsWith('scene_')&&!['scene_read','scene_library'].includes(name)&&d.studioNodeId&&window.StudioAPI.getState()?.nodeId!==d.studioNodeId)throw Error('当前片场已切换，未执行此对话的场景修改。');
       if(name==='agent_delegate'){
        const trace=d.messages.findLast(entry=>entry.role==='tool'&&entry.callId===call.callId);
        if(!trace||!sessionId)throw Error('委派调用上下文不存在');
        const {runDelegation}=await import('./src/features/agent-delegation/runner.mjs');
        const {withInspectionMedia}=await import('./src/features/agent-vision/inspect.mjs');
        return runDelegation({sessionId,callId:call.callId,tasks:args.tasks,signal:runController.signal,allowedTools:window.AgentTools.delegationTools,
         request:(path,data,signal)=>request(path,data,signal,{chat:d}),
         execute:async(tool,input,options)=>{
          const checked=window.AgentTools.parse(tool,input);
          if(checked.definition.mutates||!window.AgentTools.delegationTools.includes(tool))throw Error('子Agent只能调用只读工具');
          if(draft()!==d)throw Error('对话已切换，子任务停止读取');
          if(tool.startsWith('scene_')&&d.studioNodeId&&window.StudioAPI.getState()?.nodeId!==d.studioNodeId)throw Error('片场已切换，子任务停止读取');
          return execute(tool,input,options);
         },prepareResults:results=>results.map(withInspectionMedia),
         onChange:delegates=>{trace.delegates=delegates;save();render();}
        });
       }
       const draftFinalApproval=args.draftSourceId?d.messages.findLast(trace=>trace.role==='tool'&&trace.callId===call.callId)?.confirmationDraft:undefined;
       if(generationModel.supportsCard({name,args})){const nodes=app.getState().nodes,node=nodes.find(n=>n.id===args.nodeId),config=node?window.NodeEditor?.getConfig(node)||{}:{};args=generationModel.confirmedArguments(args,draftFinalApproval||generationModel.createGenerationDraft(args,config,nodes),nodes,app.getState().edges);}
       const authorizedArgs=JSON.stringify(args);
       const authorizeDepth=(tool,input)=>{if(tool!==name||JSON.stringify(input)!==authorizedArgs||draft()!==d||d.activeRun?.submissionId!==item.id||runController.signal.aborted)throw Error('深度流程的本次执行授权已失效');};
       const onDepthSubmitted=async job=>{const trace=d.messages.findLast(entry=>entry.role==='tool'&&entry.callId===call.callId);if(!trace)throw Error('生成执行记录不存在');trace.submittedTaskId=job.id;generationJobs?.attachGenerationJob(trace,job);if(!save())throw Error('生成任务记录未能保存，尚未调用外部服务');await flushConversation();executionRenderer.updateTrace(trace);};
       return execute(name,args,{signal:runController.signal,visualBudget,draftFinalApproval,depthHost,authorizeDepth,onDepthSubmitted,cutlistAuthorized:name==='cutlist_assemble'&&draft()===d&&d.activeRun===run&&!runController.signal.aborted});
      },
      changed:trace=>{trace.confirmationMode??=trace.status==='pending'?'ask':confirmationModule?.getMode()||'ask';if(!d.messages.includes(trace))d.messages.push(trace);for(const job of window.GenerationAPI.getJobs())generationJobs?.attachGenerationJob(trace,job);const persisted=save();if(!persisted&&['show_html','show_widget','show_app','show_form'].includes(trace.name)){trace.status='error';trace.result={error:'互动作品执行记录未能保存，请释放本地存储空间后重试。'};render();throw Error(trace.result.error);}render();}
     };
     const groupResults=calls.length>1?await generationBatch.executeGenerationBatch(calls,{...executionOptions,validate:(name,args)=>window.AgentTools.parse(name,args),validateConfirmed:(original,args)=>generationModel.confirmedArguments(original,args,app.getState().nodes)}):[await executionModule.executeTracedCall(call,executionOptions)];
     results.push(...groupResults);recoveryModule.recordExecutedCalls(run,groupResults);await persistRunCheckpoint(d,run);
    }
    if(runController.signal.aborted)throw new DOMException('Aborted','AbortError');
    const {withInspectionMedia}=await import('./src/features/agent-vision/inspect.mjs');
    const {withDepthFormEvidence}=await import('./src/features/agent-workflows/depth-agent.mjs');
    await recoveryModule.awaitVideoAnalysisSettlement({pending:run.journal.pending,results,generationAPI:window.GenerationAPI,signal:runController.signal,
     assertCurrent:()=>{if(!ownsAgentRun(d,run))throw new DOMException('任务上下文已离开','AbortError');}});
    const sourceVersion=await recoverySourceVersion(d,{persistCanvas:true});
    await recoveryModule.prepareReceiptJournal(run,{results:results.map(withInspectionMedia).map(withDepthFormEvidence).map(appCardsReadyProjection),sourceVersion});
    await persistRunCheckpoint(d,run);run.journal.phase='continue_requested';await persistRunCheckpoint(d,run);
    if(await recoverySourceVersion(d)!==sourceVersion)throw Error('保存回执期间来源版本已变化，未发送模型请求');
    response=await request('continue',{sessionId:run.sessionId,binding:run.binding,results:clone(run.journal.receipts.results)},runController.signal,{chat:d,seenCallIds});
    depthHost.acceptInspections(results,{limitReached:!!response.limitReached});
   }
 }

 function appCardsReadyProjection(entry){return appCardsProjection?appCardsProjection(entry):entry;}
 function stop(){const chat=draft(),run=chat.activeRun,id=run?.sessionId||sessionId;controller?.abort();pendingResolve?.(false);if(id&&run?.binding)request('cancel',{sessionId:id,binding:run.binding},undefined,{chat}).catch(()=>{});}
 function sanitize(html,safeLink=()=>null){const template=document.createElement('template');template.innerHTML=html;const allowed=new Set(['H1','H2','H3','H4','P','UL','OL','LI','STRONG','EM','B','I','CODE','PRE','BLOCKQUOTE','TABLE','THEAD','TBODY','TR','TH','TD','BR','HR','SPAN','DIV','A']);for(const n of [...template.content.querySelectorAll('*')]){if(!allowed.has(n.tagName)){n.replaceWith(document.createTextNode(n.textContent||''));continue;}const href=n.getAttribute('href'),strong=n.classList.contains('font-semibold');for(const attr of [...n.attributes])n.removeAttribute(attr.name);if(strong)n.style.fontWeight='600';if(n.tagName==='A'&&href&&/^https:\/\//.test(href)){const target=safeLink(href);if(target){n.href=target;n.target='_blank';n.rel='noopener noreferrer';}}}return template.content;}
 function saveCustomSkills(...args){return track(()=>saveCustomSkillsTracked(...args));}
 async function rewriteSkillReferences(change){
  const {rewriteSkillDraft}=await import('./src/features/agent-manager/skill-package.mjs');
  for(const chat of chats){const next=rewriteSkillDraft(chat,change.oldName,change.newName);chat.skills=next.skills;if(next.changed)composerModule.applyComposerSnapshot(chat,{doc:next.doc});}
  if(!save())throw Error('技能已变更，但会话引用尚未保存');await flushConversation();render();
 }
 async function saveCustomSkillsTracked(items,change){const {updatePersonalSkill}=await import('./src/features/agent-manager/skill-commit.mjs');await updatePersonalSkill({skill:change?.oldName?(change.newName?items.find(skill=>skill.name===change.newName):null):items.at(-1),previous:change?.previous,builtinNames:(await catalog()).map(skill=>skill.name)});if(change?.oldName){const {rewriteSkillDraft}=await import('./src/features/agent-manager/skill-package.mjs');for(const chat of chats){const next=rewriteSkillDraft(chat,change.oldName,change.newName);chat.skills=next.skills;if(next.changed)composerModule.applyComposerSnapshot(chat,{doc:next.doc});}const disabled=disabledSkills();if(disabled.includes(change.oldName))localStorage.setItem('tapnow-disabled-skills',JSON.stringify(disabled.flatMap(name=>name===change.oldName?(change.newName?[change.newName]:[]):[name])));save();render();}}
 async function manage(tab='skills',initialCreate=false){await conversationReady;const [manager,links]=await Promise.all([import('./src/features/agent-manager/manager.mjs'),import('./src/features/agent-manager/app-detail-content.mjs')]);return manager.openManager({tab,initialCreate,getSkills:catalog,getCustom:customSkills,saveCustom:saveCustomSkills,getDisabled:disabledSkills,setDisabled:items=>localStorage.setItem('tapnow-disabled-skills',JSON.stringify(items)),sanitize:html=>sanitize(html,links.safeAppDetailLink),onImport:action=>attachmentAction(action,draft().studioNodeId),onSkill:async name=>{open();await selectAttachmentSkill(name,draft().studioNodeId);},onApp:async(item,text='')=>{const d=draft();await composerReady;if(pageLeaving||draft()!==d)throw Error('应用入口所属会话已切换');open();const ref={kind:'app',id:item.id,label:item.id==='brainstorm'?'头脑风暴':item.id,mediaType:'',scope:'personal'};const {managerPickerArgs,launchManagerPicker}=await import('./src/features/agent-manager/picker-launch.mjs');if(managerPickerArgs(item.id)){if(busy||queueRunner?.running||d.queuedMessages?.length||pageLeaving||draft()!==d)throw Error('请先完成或停止当前 Agent 任务');await appCardsReady;if(pageLeaving||draft()!==d||busy||queueRunner?.running||d.queuedMessages?.length)throw Error('应用入口所属会话已切换或正在运行');const previousDoc=composerModule.documentForDraft(d);composerModule.insertSessionReference(d.id,ref,text);const insertedDoc=composerModule.documentForDraft(d);try{await launchManagerPicker({id:item.id,text,expectedChat:d,getContext:()=>({chat:draft(),panelActive:!!panel,pageLeaving,running:busy||queueRunner?.running||!!draft().queuedMessages?.length}),persist:async()=>{if(!save())throw Error('应用入口未能保存');await flushConversation();}});render();}catch(error){if(JSON.stringify(composerModule.documentForDraft(d))===JSON.stringify(insertedDoc))composerModule.applyComposerSnapshot(d,{doc:previousDoc});if(draft()===d&&panel)render();try{if(!save())throw Error('应用引用撤销未能保存');await flushConversation();}catch(failure){throw Error(error.message+'；引用撤销保存失败：'+failure.message);}throw error;}}else composerModule.insertSessionReference(d.id,ref,text);}});}
 window.CanvasProjects?.registerNavigationGuard(async()=>{await conversationReady;const reason=operations?.guard({busy,running:queueRunner?.running,activeRun:chats.some(chat=>chat.activeRun)});if(reason)return reason;if(document.querySelector('#skill-manager .manager-form'))return '请先保存或关闭技能编辑，再切换项目';if(document.querySelector('.voice-control,.voice-recovery'))return '请先完成或取消语音输入，再切换项目';composerEditor?.sync(draft());if(!save())return 'Agent 对话未能保存，请重试后再切换项目';try{await flushConversation();}catch(error){return 'Agent 对话未能保存：'+error.message+'。请保留本页并重试';}return null;});
 window.AgentUI={async configureApps(adapter){const manager=await import('./src/features/agent-manager/manager.mjs');manager.configureAppAdapter(adapter);},referenceData,openReferenceNode,toggle,open,close,configureAttachmentInputs(prepare){if(typeof prepare!=='function')throw Error('附件适配器必须为函数');attachmentInputAdapter=prepare;},removeAttachment(nodeId,id){if(!conversationsLoaded)throw Error('会话仍在加载，请稍后重试');const d=attachmentChat(nodeId);d.uploads=(d.uploads||[]).filter(item=>item.id!==id);d.refs=d.refs.filter(ref=>ref!==id);d.referencePins=(d.referencePins||[]).filter(ref=>ref!==id);save();render();},execute,manage,attachmentAction,attachmentSkills,selectAttachmentSkill,refreshSceneContext,beginStudio({nodeId,text,submit=false}){if(busy&&draft().studioNodeId!==nodeId){open();notice('请先完成或停止当前 Agent 任务');return false;}const {index}=studioChat(nodeId);current=index;if(text!==undefined)draft().text=text;open();save();render();focusComposer();if(submit&&draft().text.trim())void send();return true;},async openAttachments(){await conversationReady;open();panel.querySelector('[aria-label="添加附件"]')?.click();},configure:configPanel,configureArtifacts(adapter){artifactAdapter={...adapter};},attachNodes(ids){if(!conversationsLoaded)throw Error('会话仍在加载，请稍后重试');open();draft().referencePins=[...new Set([...(draft().referencePins||draft().refs),...ids])];draft().refs=[...new Set([...draft().refs,...ids])];save();render();}};
})();
