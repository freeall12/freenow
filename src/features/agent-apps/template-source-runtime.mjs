import {acceptedTemplateIdentity,sha256Bytes,verifyTemplateBytes,templatePickerUris} from './template-source.mjs';
const clone=value=>structuredClone(value),same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const descriptionGuards=new WeakMap();
export function isTemplateSourceDescriptionCurrent(description){
 try{return descriptionGuards.get(description)?.()===true;}catch{return false;}
}
function rememberDescription(description,binding){descriptionGuards.set(description,()=>binding.guard());return description;}

export function createTemplateSourceRuntime({getContext,store,persistConversation}){
 let disposed=false,unsubscribe;const listeners=new Set(),active=new Set(),ready=Promise.resolve(store);
 const notify=()=>{for(const listener of listeners){try{listener();}catch(error){console.error(error);}}};
 void ready.then(value=>{if(!disposed)unsubscribe=value.subscribe?.(notify);}).catch(()=>{});
 function bind(trace){
  const context=getContext(),chat=context.chat;
  if(disposed||!context.panelActive||context.pageLeaving||!chat?.messages?.includes(trace)||!templatePickerUris.includes(trace.result?.resource_uri))throw Error('模板选择不属于当前会话');
  const matches=[...chat.messages.filter(item=>item.role==='user'),...(chat.queuedMessages||[])].filter(item=>item.widgetOrigin?.traceId===trace.id&&item.widgetOrigin.handoffId===trace.appState?.pending?.id);
  if(!matches.length)throw Error('请先在模板面板确认使用，保存真实选择交接');
  const accepted=matches[0],identity=acceptedTemplateIdentity(trace,accepted),text=accepted.text,origin=clone(accepted.widgetOrigin),state=clone(trace.appState),result=trace.result;
  if(matches.some(item=>item.text!==text||!same(item.widgetOrigin,origin)||item.hidden!==true))throw Error('模板交接来源冲突');
  function guard({idle=false,signal}={}){
   const now=getContext();
   if(signal?.aborted)throw signal.reason||new DOMException('导入已取消','AbortError');
   if(disposed||now.chat!==chat||!now.panelActive||now.pageLeaving||!chat.messages.includes(trace)||trace.result!==result||!same(trace.appState,state)||accepted.text!==text||!same(accepted.widgetOrigin,origin)||accepted.hidden!==true||!(chat.messages.includes(accepted)||chat.queuedMessages?.includes(accepted))||!trace.appHandoffs?.includes(identity.handoff_id)||!same(acceptedTemplateIdentity(trace,accepted),identity))throw Error('模板导入期间会话、选择或交接来源已变化');
   if(idle&&(now.streaming||now.running))throw Error('会话运行中，请稍后导入原模板');
   return true;
  }
  return {trace,chat,identity,guard};
 }
 async function paths(identity){
  const key=await sha256Bytes(new TextEncoder().encode(JSON.stringify(identity)));
  const prefix='artifacts/templates/'+identity.template_id+'/'+key;
  return {source_path:prefix+'/source.html',artifact_path:prefix+'/editable.html'};
 }
 async function describe(trace){
  try{
   const binding=bind(trace),location=await paths(binding.identity),storage=await ready;binding.guard();
   const list=await storage.list();binding.guard();
   const hasSource=list.some(file=>file.artifact_path===location.source_path),hasArtifact=list.some(file=>file.artifact_path===location.artifact_path);
   const canImport=()=>!getContext().streaming&&!getContext().running;
   if(!hasSource&&!hasArtifact)return rememberDescription({status:'missing',can_import:canImport(),template_id:binding.identity.template_id,source_identity:binding.identity,reason:'所选原模板正文尚未取得。请导入与目录 SHA256 一致的本地 HTML；自由 HTML 创作仍可继续。'},binding);
   if(!hasSource||!hasArtifact)throw Error('原模板与编辑产物保存不完整');
   const source=await storage.get(location.source_path),artifact=await storage.get(location.artifact_path);binding.guard();
   if(!source.template_source_immutable||!same(source.template_source_identity,binding.identity)||!same(artifact.template_source_identity,binding.identity)||artifact.source_artifact_path!==source.artifact_path||artifact.source_revision!==source.revision)throw Error('编辑产物与所选原模板来源不一致');
   const metadata=await import('../agent-artifacts/model.mjs');
   binding.guard();
   const receipt=trace.templateSourceImports?.find(item=>same(item.source_identity,binding.identity)&&item.source?.artifact_path===source.artifact_path&&item.source.revision===source.revision&&item.artifact?.artifact_path===artifact.artifact_path),receipt_status=receipt?'confirmed':'unconfirmed';
   return rememberDescription({status:'imported',can_import:canImport(),receipt_status,template_id:binding.identity.template_id,source_identity:binding.identity,source:metadata.metadata(source),artifact:metadata.metadata(artifact),reason:receipt?'原始字节已校验；编辑和预览使用当前最新版本。':'原始字节与产物已保存，但会话导入回执未确认；可打开核对，重新导入同一文件可重试回执。'},binding);
  }catch(error){return {status:'unavailable',reason:error.message};}
 }
 async function importFile(trace,file,{signal}={}){
  const binding=bind(trace),{identity}=binding,key=identity.selection_trace_id+'\n'+identity.handoff_id;
  if(active.has(key))throw Error('本次原模板导入正在保存');
  const guard=()=>binding.guard({idle:true,signal});guard();active.add(key);let stored=false;
  try{
   if(!file||typeof file.arrayBuffer!=='function'||!Number.isSafeInteger(file.size)||file.size<1||file.size>240000)throw Error('请选择容量以内的本地 HTML 文件');
   if(await persistConversation(binding.chat)===false)throw Error('模板选择交接尚未实际保存');guard();
   const bytes=await file.arrayBuffer();guard();
   if(bytes.byteLength!==file.size)throw Error('读取文件字节数量与原文件不一致');
   const source=await verifyTemplateBytes(bytes,identity);guard();
   const location=await paths(identity),storage=await ready;guard();
   const saved=await storage.importTemplate({source,...location,title:identity.template_id+' · 模板编辑'},{guard});stored=true;guard();
   const previous=trace.templateSourceImports,receipt={...saved,source_identity:identity},next=[...(previous||[]).filter(item=>item.source_identity?.handoff_id!==identity.handoff_id),receipt];
   trace.templateSourceImports=next;
   try{
    if(await persistConversation(binding.chat)===false)throw Error('模板导入会话回执保存未提交');guard();
    const current=await describe(trace);guard();if(current.status!=='imported')throw Error(current.reason);
    return {status:'imported',receipt_status:current.receipt_status,source_identity:identity,source:current.source,artifact:current.artifact};
   }catch(error){
    if(trace.templateSourceImports===next){if(previous===undefined)delete trace.templateSourceImports;else trace.templateSourceImports=previous;}
    else if(Array.isArray(trace.templateSourceImports))trace.templateSourceImports=trace.templateSourceImports.filter(item=>item!==receipt);
    let compensation='';try{if(await persistConversation(binding.chat)===false)throw Error('未提交');}catch(failure){compensation='；会话补偿保存失败：'+failure.message;}
    throw Error('原模板与编辑产物已保存，但会话回执未确认，未声明导入成功。请核对 '+saved.artifact.artifact_path+'：'+error.message+compensation);
   }
  }catch(error){
   if(stored&&!error.message.includes('已保存'))throw Error('原模板与编辑产物已保存，但来源已变化，未声明导入成功：'+error.message);
   throw error;
  }finally{active.delete(key);notify();}
 }
 return {describe,importFile,isDescriptionCurrent:isTemplateSourceDescriptionCurrent,subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);},dispose(){disposed=true;unsubscribe?.();listeners.clear();}};
}
