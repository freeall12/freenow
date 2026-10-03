import {chooseFiles} from '../agent-attachments/uploads.mjs';

/** Actual picker card footer. Importing is a local file action, never HTML execution. */
export function createTemplateSourceControls({trace,runtime,onOpenArtifact,onError=()=>{},document=globalThis.document}){
 const element=document.createElement('div');element.className='agent-mcp-error-actions';element.dataset.templateSource='';element.style.cssText='padding:8px 12px;flex-wrap:wrap';
 const status=document.createElement('output');status.className='agent-mcp-retry-note';status.setAttribute('aria-live','polite');status.style.cssText='flex:1 1 100%;white-space:normal';
 const importButton=document.createElement('button'),openButton=document.createElement('button');
 importButton.type=openButton.type='button';importButton.className=openButton.className='agent-mcp-reload';importButton.textContent='导入所选原模板 HTML';openButton.textContent='打开最新 HTML';element.append(status,importButton,openButton);
 let disposed=false,busy=false,version=0,current=null,lastError='';
 function buttons(){importButton.disabled=busy||!current||current.status==='unavailable'||current.can_import===false;openButton.disabled=busy||current?.status!=='imported'||!onOpenArtifact;openButton.hidden=current?.status!=='imported';}
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
 const unsubscribe=runtime.subscribe(()=>{void refresh();});void refresh();
 return {element,refresh,destroy(){disposed=true;version++;unsubscribe();importButton.onclick=openButton.onclick=null;element.remove();}};
}
