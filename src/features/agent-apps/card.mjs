import {maximize,minimize} from './icons.mjs';

const expandedEvent='tapnow:mcp-app-card-expanded';
const content=trace=>trace?.content??trace??{};
const input=trace=>content(trace).result?.kind==='mcp_app'?content(trace).result.request??{}:content(trace).args??content(trace).request??{};
const result=trace=>content(trace).result?.kind==='mcp_app'?content(trace).result.response??null:content(trace).result??content(trace).response??null;
const resource=(trace,policy)=>policy.resourceUri??content(trace).ui?.resource_uri??content(trace).result?.resource_uri??content(trace).args?.resource_uri??result(trace)?.ui?.resource_uri??result(trace)?.resource_uri??'';
const identity=trace=>content(trace).id??content(trace).tool_call_id??content(trace).callId??'';
const revision=trace=>content(trace).projection_revision??result(trace)?.projection_revision;
const node=(document,tag,className,text)=>{const element=document.createElement(tag);element.className=className;if(text!==undefined)element.textContent=text;return element;};
const errorText=value=>typeof value==='string'?value:value?.message??'resource_error';
const allowed=check=>{try{return check()!==false;}catch{return false;}};
function loadStyles(document){if(document.querySelector('link[data-agent-apps]'))return;const link=document.createElement('link');link.rel='stylesheet';link.href=new URL('./styles.css',import.meta.url).href;link.dataset.agentApps='';document.head.append(link);}

/** Presentation only. Registry supplies resource policy/proxy URL; the injected
 * host owns protocol, permissions and persistence. Reload never calls a tool. */
export function createMcpAppCard({trace,policy={},createHost,hostOptions={},autoExpand=false,isCurrent=()=>true,document=globalThis.document}={}){
 loadStyles(document);const window=document.defaultView||globalThis.window,cardId=window.crypto.randomUUID();
 const element=node(document,'div','agent-mcp-app'),backdrop=node(document,'button','agent-mcp-backdrop'),dialog=node(document,'div','agent-mcp-dialog'),header=node(document,'div','agent-mcp-header'),title=node(document,'span','agent-mcp-title'),expand=node(document,'button','agent-mcp-expand');
 backdrop.type='button';backdrop.setAttribute('aria-label','关闭放大的应用');backdrop.dataset.testid='mcp-app-backdrop';expand.type='button';expand.dataset.mcpAppExpandToggle='';dialog.setAttribute('role','dialog');
 header.append(title,expand);
 const loading=node(document,'div','agent-mcp-loading'),loadingText=node(document,'output','','正在加载面板…');loading.append(node(document,'div','agent-mcp-spinner'),loadingText);
 const error=node(document,'div','agent-mcp-error'),errorTitle=node(document,'p','agent-mcp-error-title','面板暂时未能加载'),summary=node(document,'p','agent-mcp-error-summary'),reason=node(document,'p','agent-mcp-error-reason'),actions=node(document,'div','agent-mcp-error-actions'),reloadButton=node(document,'button','agent-mcp-reload','重新加载面板'),retryNote=node(document,'span','agent-mcp-retry-note');
 error.setAttribute('aria-live','polite');reloadButton.type='button';actions.append(reloadButton,retryNote);error.append(errorTitle,summary,reason,actions);dialog.append(header,loading,error);element.append(backdrop,dialog);
 let currentTrace=trace,currentPolicy=policy,options=hostOptions,wantsAutoExpand=autoExpand,uri='',key='',frame=null,host=null,destroyed=false,suspended=false;
 let state='loading',failure=null,attempt=0,automaticRetries=0,wasReady=false,expanded=false,inlineHeight=200,ignoreResize=false,restoreFocus=null,autoExpanded=false;
 let generation=0,retryTimer=null,retryAt=0,retryRemaining=null,resizeFrames=[],lastData=null;
 const raf=callback=>window.requestAnimationFrame?window.requestAnimationFrame(callback):window.setTimeout(callback,16);
 const cancelRaf=id=>window.cancelAnimationFrame?window.cancelAnimationFrame(id):window.clearTimeout(id);
 const actionCurrent=()=>!destroyed&&!suspended&&element.isConnected&&allowed(isCurrent);
 function stopRetry(){if(retryTimer!==null)window.clearTimeout(retryTimer);retryTimer=null;}
 function stopResizeReset(){for(const id of resizeFrames)cancelRaf(id);resizeFrames=[];}
 function retryDelay(){const delays=currentPolicy.autoRetryDelaysMs??currentPolicy.retryDelaysMs??[];return state==='error'&&!wasReady&&failure!=='invalid_resource_uri'&&automaticRetries<delays.length?delays[automaticRetries]:null;}
 function sync(){
  element.hidden=!uri;dialog.dataset.expanded=String(expanded);dialog.setAttribute('aria-modal',String(expanded));if(expanded)dialog.tabIndex=-1;else dialog.removeAttribute('tabindex');backdrop.hidden=!expanded;
  const request=input(currentTrace);title.textContent=typeof request.title==='string'?request.title:currentPolicy.title??'应用';dialog.setAttribute('aria-label',title.textContent);
  expand.hidden=!currentPolicy.allowExpanded;expand.setAttribute('aria-expanded',String(expanded));const label=expanded?'收起应用':'放大应用';expand.setAttribute('aria-label',label);expand.title=label;if(expand.dataset.icon!==(expanded?'minimize':'maximize')){expand.innerHTML=expanded?minimize:maximize;expand.dataset.icon=expanded?'minimize':'maximize';}
  loading.hidden=state!=='loading';loadingText.textContent=attempt?'正在重新加载面板…':'正在加载面板…';error.hidden=state!=='error';
  const description=result(currentTrace)?.summary;summary.hidden=typeof description!=='string'||!description;summary.textContent=typeof description==='string'?description:'';reason.textContent=failure==='timeout'?'面板资源加载或初始化超时':String(failure??'').slice(0,240);retryNote.textContent=retryDelay()!==null?'正在准备自动重试…':'仅重新加载面板，不会重新提交生成';
  if(frame){frame.title=typeof request.title==='string'?request.title:'App';frame.style.height=expanded?'calc(88vh - 36px)':inlineHeight+'px';frame.style.display=state==='ready'?'block':'none';}
 }
 function notifyPresentation(){host?.updatePresentationState?.(expanded);host?.updateHostContext?.({displayMode:expanded?'fullscreen':'inline'});}
 function setExpanded(value,{restore=true}={}){
  value=!!value&&!!currentPolicy.allowExpanded&&!destroyed&&!suspended;if(value===expanded)return false;
  stopResizeReset();if(value){restoreFocus=document.activeElement;ignoreResize=true;window.dispatchEvent(new window.CustomEvent(expandedEvent,{detail:{cardId}}));}
  expanded=value;sync();notifyPresentation();
  if(value){if(state==='ready'&&dialog.isConnected)dialog.focus({preventScroll:true});}
  else {const target=restoreFocus?.isConnected?restoreFocus:expand;restoreFocus=null;resizeFrames.push(raf(()=>{resizeFrames.push(raf(()=>{ignoreResize=false;resizeFrames=[];}));}));if(restore&&target?.isConnected)target.focus?.({preventScroll:true});}
  return true;
 }
 function scheduleRetry(){
  stopRetry();const delay=retryRemaining??retryDelay();if(delay===null||!Number.isFinite(delay)||delay<0||suspended||destroyed)return;
  retryRemaining=null;retryAt=Date.now()+delay;retryTimer=window.setTimeout(()=>{retryTimer=null;if(!destroyed&&!suspended&&state==='error'){automaticRetries++;attempt++;start();}},delay);
 }
 function fail(value,version){if(destroyed||version!==generation)return;failure=errorText(value);state='error';generation++;host?.dispose?.();host=null;sync();scheduleRetry();}
 function hostCallbacks(version){
  const callbacks=options.callbacks??{};
  const live=()=>!destroyed&&version===generation;
  return {...callbacks,
   onReady(){if(!live())return;state='ready';failure=null;wasReady=true;stopRetry();retryRemaining=null;sync();host?.updateConversationRunActive?.(!!options.runActive);if(wantsAutoExpand&&currentPolicy.autoExpandOnReady&&!autoExpanded&&!suspended){autoExpanded=true;setExpanded(true);}else if(expanded&&dialog.isConnected)dialog.focus({preventScroll:true});callbacks.onReady?.();},
   onError(value){if(!live())return;fail(value,version);callbacks.onError?.(value);},
   onSizeChanged(height){if(!live()||ignoreResize||typeof height!=='number'||!Number.isFinite(height))return;const max=currentPolicy.maxInlineHeight;inlineHeight=Math.max(height,100);if(Number.isFinite(max))inlineHeight=Math.min(inlineHeight,Math.max(max,100));sync();callbacks.onSizeChanged?.(height);},
   onDismiss(){if(!live()||!actionCurrent()||!expanded)return false;return setExpanded(false);},
   async onSendPrompt(text,meta,isSourceCurrent=()=>true){if(!live()||!actionCurrent()||!isSourceCurrent()||!callbacks.onSendPrompt)return false;const current=()=>live()&&actionCurrent()&&isSourceCurrent();const accepted=await callbacks.onSendPrompt(text,meta,current);if(!current())return false;if(accepted!==false&&currentPolicy.collapseOnSendMessage)setExpanded(false);return accepted;}
  };
 }
 function start(){
  stopRetry();retryRemaining=null;host?.dispose?.();host=null;generation++;const version=generation;frame?.remove();frame=node(document,'iframe','agent-mcp-frame');frame.setAttribute('sandbox','allow-scripts');dialog.append(frame);state='loading';failure=null;sync();
  if(!uri||!currentPolicy.proxyUrl||typeof createHost!=='function'){fail(!uri?'invalid_resource_uri':'resource_error',version);return;}
  try{
   const instance=createHost({...options,iframe:frame,resourceUri:uri,toolInput:input(currentTrace),toolResult:result(currentTrace),initialWidgetState:content(currentTrace).appState??content(currentTrace).widget_state??options.initialWidgetState,isCurrent:()=>version===generation&&actionCurrent()&&allowed(options.isCurrent??(()=>true)),callbacks:hostCallbacks(version)});
   if(destroyed||version!==generation){instance?.dispose?.();return;}host=instance;lastData={input:input(currentTrace),result:result(currentTrace),revision:revision(currentTrace)};notifyPresentation();host.start();if(version===generation)frame.src=currentPolicy.proxyUrl;
  }catch(error){fail(error,version);}
 }
 function reload(){if(destroyed||suspended||state!=='error')return false;automaticRetries=0;attempt++;start();return true;}
 function update(next,{policy:nextPolicy,hostOptions:nextOptions,autoExpand:nextAutoExpand,runActive,locale}={}){
  if(destroyed)return element;const wasSuspended=suspended;suspended=false;currentTrace=next;if(nextPolicy)currentPolicy=nextPolicy;if(nextOptions)options=nextOptions;if(nextAutoExpand!==undefined)wantsAutoExpand=nextAutoExpand;if(runActive!==undefined)options={...options,runActive};
  const nextUri=resource(next,currentPolicy),nextKey=(currentPolicy.instanceKey??identity(next))+'\0'+nextUri,nextProxy=currentPolicy.proxyUrl;
  if(nextKey!==key||(nextProxy??'')!==element.dataset.proxyUrl){setExpanded(false,{restore:false});uri=nextUri;key=nextKey;element.dataset.proxyUrl=nextProxy??'';attempt=0;automaticRetries=0;wasReady=false;autoExpanded=false;inlineHeight=200;ignoreResize=false;stopResizeReset();start();}
  else {if(!currentPolicy.allowExpanded&&expanded)setExpanded(false,{restore:false});const data={input:input(next),result:result(next),revision:revision(next)};if(host&&(data.input!==lastData?.input||data.result!==lastData?.result||data.revision!==lastData?.revision)){host.updateData?.(data.input,data.result,data.revision);lastData=data;}host?.updateConversationRunActive?.(!!options.runActive);if(locale!==undefined)host?.updateHostContext?.({locale});sync();if(wasSuspended){scheduleRetry();if(wantsAutoExpand&&currentPolicy.autoExpandOnReady&&!autoExpanded&&state==='ready'){autoExpanded=true;setExpanded(true);}}}
  return element;
 }
 function keydown(event){
  if(!expanded||!actionCurrent())return;if(event.key==='Escape'){if(event.isTrusted!==true||event.defaultPrevented||event.isComposing||event.keyCode===229||!dialog.contains(event.target))return;event.preventDefault();event.stopPropagation();setExpanded(false);return;}
  const keys=currentPolicy.presentationShortcuts;if(!(keys===true?['ArrowLeft','ArrowRight','Enter']:keys??[]).includes(event.key)||event.defaultPrevented||event.isComposing||event.keyCode===229||event.ctrlKey||event.metaKey||event.altKey||event.key==='Enter'&&event.repeat)return;
  if(!dialog.contains(event.target)||event.target.closest?.('button,a,input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="button"],[role="radio"],[role="radiogroup"],[role="slider"]'))return;
  if(host?.sendPresentationShortcut){event.preventDefault();host.sendPresentationShortcut(event.key);}
 }
 function otherExpanded(event){if(event.detail?.cardId!==cardId)setExpanded(false,{restore:false});}
 expand.onclick=()=>setExpanded(!expanded);backdrop.onclick=()=>setExpanded(false);reloadButton.onclick=reload;window.addEventListener('keydown',keydown);window.addEventListener(expandedEvent,otherExpanded);update(trace);
 return {element,update,reload,setExpanded,updateAppReplyStatus:(replyId,status)=>host?.updateAppReplyStatus?.(replyId,status),suspend(){if(destroyed||suspended)return;setExpanded(false,{restore:false});suspended=true;if(retryTimer!==null)retryRemaining=Math.max(0,retryAt-Date.now());stopRetry();},destroy(){if(destroyed)return;setExpanded(false,{restore:false});destroyed=true;generation++;stopRetry();stopResizeReset();host?.dispose?.();host=null;window.removeEventListener('keydown',keydown);window.removeEventListener(expandedEvent,otherExpanded);expand.onclick=null;backdrop.onclick=null;reloadButton.onclick=null;element.remove();}};
}
