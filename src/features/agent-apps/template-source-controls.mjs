import {chooseFiles} from '../agent-attachments/uploads.mjs';
import {openTemplateSourceEditor} from './template-source-editor.mjs';

/** Actual picker card footer. Importing is a local file action, never HTML execution. */
export function createTemplateSourceControls({trace,runtime,onOpenArtifact,onDiscussArtifact,onError=()=>{},document=globalThis.document}){
 const element=document.createElement('div');element.className='agent-mcp-error-actions';element.dataset.templateSource='';element.style.cssText='padding:8px 12px;flex-wrap:wrap';
 const status=document.createElement('output');status.className='agent-mcp-retry-note';status.setAttribute('aria-live','polite');status.style.cssText='flex:1 1 100%;white-space:normal';
 const importButton=document.createElement('button'),openButton=document.createElement('button'),editButton=document.createElement('button'),discussButton=document.createElement('button');
 importButton.type=openButton.type=editButton.type=discussButton.type='button';importButton.className=openButton.className=editButton.className=discussButton.className='agent-mcp-reload';importButton.textContent='导入所选原模板 HTML';openButton.textContent='打开最新 HTML';editButton.textContent='编辑 HTML';discussButton.textContent='在对话中讨论';element.append(status,importButton,openButton,editButton,discussButton);
 let disposed=false,busy=false,version=0,current=null,lastError='',editor=null;
 function buttons(){importButton.disabled=busy||!current||current.status==='unavailable'||current.can_import===false;openButton.disabled=busy||current?.status!=='imported'||!onOpenArtifact;openButton.hidden=current?.status!=='imported';editButton.hidden=current?.status!=='imported'||!runtime.openEditSession;editButton.disabled=busy||current?.status!=='imported'||current.can_import===false||!runtime.openEditSession;discussButton.hidden=current?.status!=='imported'||!onDiscussArtifact;discussButton.disabled=busy||current?.status!=='imported'||current.can_import===false||!onDiscussArtifact;}
 async function refresh(){
  const request=++version;const result=await runtime.describe(trace);if(disposed||request!==version)return;
  current=result;const description=result.status==='imported'?`${result.template_id} · 原始字节已校验 · 当前 revision ${result.artifact.revision} · ${result.source.source_byte_length} bytes / ${result.source.length} UTF-16 字符${result.receipt_status==='unconfirmed'?' · 会话导入回执未确认，可打开核对或重新导入重试':''}`:result.reason;status.textContent=description+(lastError?'\n'+lastError:'');buttons();
 }
 importButton.onclick=async()=>{
  if(disposed||busy||importButton.disabled)return;busy=true;buttons();
  try{await chooseFiles({accept:'.html,.htm,text/html',multiple:false,onFiles:async files=>{if(disposed)throw Error('模板面板已关闭');await runtime.importFile(trace,files[0]);lastError='';},onError:message=>{if(!disposed){lastError=message;status.textContent=message;onError(message);}}});}
  finally{busy=false;if(!disposed)await refresh();}
 };
 openButton.onclick=async()=>{
  if(disposed||busy||openButton.disabled)return;busy=true;buttons();
  try{const latest=await runtime.describe(trace);if(disposed)return;if(latest.status!=='imported')throw Error(latest.reason);await onOpenArtifact(latest.artifact);lastError='';}
  catch(error){if(!disposed){lastError=error.message;status.textContent=error.message;onError(error.message);}}
  finally{busy=false;if(!disposed)await refresh();}
 };
 editButton.onclick=async()=>{
  if(disposed||busy||editButton.disabled||editor?.element.isConnected)return;busy=true;buttons();
  let session;
  try{session=await runtime.openEditSession(trace);if(disposed){session.close();return;}editor=openTemplateSourceEditor({session,document,onSaved:async()=>{lastError='';await refresh();},onError:message=>{lastError=message;onError(message);}});}
  catch(error){session?.close();if(!disposed){lastError=error.message;status.textContent=error.message;onError(error.message);}}
  finally{busy=false;if(!disposed)await refresh();}
 };
 discussButton.onclick=async()=>{
  if(disposed||busy||discussButton.disabled)return;busy=true;buttons();
  try{const latest=await runtime.describe(trace);if(disposed)return;if(latest.status!=='imported'||!runtime.isDescriptionCurrent(latest))throw Error(latest.reason||'模板选择已变化');const isCurrent=()=>!disposed&&runtime.isDescriptionCurrent(latest);await onDiscussArtifact(latest.artifact,{trace,isCurrent});if(!isCurrent())throw Error('模板讨论来源已变化');lastError='';}
  catch(error){if(!disposed){lastError=error.message;status.textContent=error.message;onError(error.message);}}
  finally{busy=false;if(!disposed)await refresh();}
 };
 const unsubscribe=runtime.subscribe(()=>{void refresh();});void refresh();
 return {element,refresh,destroy(){disposed=true;version++;unsubscribe();editor?.invalidate();importButton.onclick=openButton.onclick=editButton.onclick=discussButton.onclick=null;element.remove();}};
}
