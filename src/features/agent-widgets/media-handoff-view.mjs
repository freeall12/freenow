const message=value=>typeof value==='string'?value:typeof value?.message==='string'?value.message:'';
const activeStatuses=new Set(['validating','processing','saving']);
function loadStyles(document){
 const href=new URL('../agent-execution/styles.css',import.meta.url).href;
 if([...document.querySelectorAll('link[rel="stylesheet"]')].some(link=>link.href===href))return;
 const link=document.createElement('link');link.rel='stylesheet';link.href=href;link.dataset.widgetMediaHandoff='';document.head.append(link);
}
function statusText(receipt){
 if(receipt.applied===true){
  if(receipt.saved===true&&receipt.status==='succeeded')return '已添加到画布并保存';
  if(receipt.status==='save_failed')return '已添加到画布，保存失败';
  if(receipt.status==='saving')return '已添加到画布，正在保存';
  return '已添加到画布，尚未确认保存';
 }
 return {pending:'确认后将此素材添加到当前画布',validating:'正在验证素材',processing:'正在处理素材',saving:'正在保存',save_failed:'保存失败，添加状态待确认',failed:'素材添加失败',cancelled:'已取消添加',rejected:'已拒绝添加',succeeded:'操作已返回，添加状态待确认',awaiting_receipt:'等待实际操作回执'}[receipt.status]||'操作状态待确认';
}

/** Local handoff UI: the captured skill names uploadToCanvas but its linked
 * implementation is unavailable. This reuses existing host confirmation styles;
 * callbacks own blob validation, authorization, cancellation and persistence. */
export function createMediaHandoffView({request,onConfirm,onReject,onRetrySave,onDownload,isCurrent=()=>true,document=globalThis.document}){
 loadStyles(document);
 const el=(tag,cls,text)=>{const node=document.createElement(tag);node.className=cls;if(text!==undefined)node.textContent=text;return node;};
 const element=el('section','execution-group execution-confirmation');element.setAttribute('aria-label','确认添加素材到画布');
 const title=el('strong','','添加到画布'),description=el('p',''),status=el('p',''),details=el('p',''),error=el('div','execution-error'),actions=el('div','execution-confirm-actions');
 status.setAttribute('role','status');status.setAttribute('aria-live','polite');error.setAttribute('role','alert');actions.style.flexWrap='wrap';
 element.append(title,description,status,details,error,actions);
 const button=(text,cls='')=>{const node=el('button',cls,text);node.type='button';actions.append(node);return node;};
 const download=button('下载素材'),reject=button('拒绝'),confirm=button('添加到画布','execution-allow'),retry=button('重试保存','execution-allow');
 let receipt={status:'pending'},busy=false,downloading=false,destroyed=false,suspended=false,revision=0,localError='';
 const current=()=>{try{return !destroyed&&!suspended&&element.isConnected&&isCurrent()!==false;}catch{return false;}};
 const gesture=event=>event?.isTrusted===true&&current();
 function render(){
  const name=request.filename||request.title||'Widget 素材',parts=[name];
  if(typeof request.mimeType==='string'&&request.mimeType)parts.push(request.mimeType);
  if(Number.isFinite(request.size)&&request.size>=0)parts.push(request.size+' 字节');
  if(Number.isFinite(request.duration))parts.push('请求时长 '+request.duration+' 秒（必要时补尾帧或截到此时长）');
  if(request.mimeType?.startsWith('video/'))parts.push('加入画布时保存为 H.264 MP4 · 30 fps');
  description.textContent=parts.join(' · ');status.textContent=statusText(receipt);
  const info=[];
  if(Number.isFinite(receipt.width)&&Number.isFinite(receipt.height))info.push('实际尺寸：'+receipt.width+' × '+receipt.height);
  if(Number.isFinite(receipt.duration))info.push('实际时长：'+receipt.duration+' 秒');
  if(receipt.durationAdjusted===true&&Number.isFinite(receipt.inputDuration))info.push('原素材时长：'+receipt.inputDuration+' 秒');
  if(Array.isArray(receipt.nodeIds)&&receipt.nodeIds.length)info.push('结果节点：'+receipt.nodeIds.join('、'));
  details.textContent=info.join(' · ');details.hidden=!details.textContent;
  error.textContent=localError||message(receipt.error);error.hidden=!error.textContent;
  const pending=receipt.status==='pending'||receipt.status==='failed'&&receipt.applied!==true,savingFailed=receipt.applied===true&&receipt.saved!==true&&receipt.status==='save_failed';
  confirm.textContent=receipt.status==='failed'?'重试添加':'添加到画布';
  confirm.hidden=!pending;retry.hidden=!savingFailed;reject.hidden=!pending;download.hidden=typeof onDownload!=='function';
  const locked=busy||suspended||destroyed||activeStatuses.has(receipt.status);
  confirm.disabled=locked||typeof onConfirm!=='function';retry.disabled=locked||typeof onRetrySave!=='function';reject.disabled=locked||typeof onReject!=='function';download.disabled=suspended||destroyed||downloading;
  element.setAttribute('aria-busy',String(busy||activeStatuses.has(receipt.status)));
 }
 function update(value){if(destroyed||!value||typeof value!=='object')return;receipt={...value};localError='';render();}
 async function act(event,kind){
  const control=kind==='confirm'?confirm:kind==='retry'?retry:reject;
  if(!gesture(event)||busy||control.hidden||control.disabled)return;
  const version=revision,callback=kind==='confirm'?onConfirm:kind==='retry'?onRetrySave:onReject;
  busy=true;localError='';if(kind==='confirm')receipt={status:'validating'};else if(kind==='retry')receipt={...receipt,status:'saving',error:undefined};render();
  try{
   const result=await callback(request,event);
   if(destroyed||version!==revision)return;
   if(result&&typeof result==='object')update(result);
   else if(kind==='reject')update({status:'rejected'});
   else if(activeStatuses.has(receipt.status))update({...receipt,status:'awaiting_receipt'});
  }catch(reason){
   if(destroyed||version!==revision)return;
   if(reason?.receipt&&typeof reason.receipt==='object')update(reason.receipt);
   else {receipt={...receipt,status:receipt.applied===true?'save_failed':'failed'};localError=message(reason)||'操作失败，请重试';}
  }finally{if(!destroyed&&version===revision){busy=false;render();}}
 }
 confirm.onclick=event=>act(event,'confirm');retry.onclick=event=>act(event,'retry');reject.onclick=event=>act(event,'reject');
 download.onclick=async event=>{
  if(!gesture(event)||download.disabled||download.hidden)return;
  const version=revision;downloading=true;localError='';render();
  try{await onDownload(request,event);}catch(reason){if(!destroyed&&version===revision)localError=message(reason)||'下载失败';}
  finally{if(!destroyed&&version===revision){downloading=false;render();}}
 };
 render();return {element,update,suspend(){if(destroyed)return;suspended=true;revision++;busy=false;downloading=false;render();},resume(){if(destroyed)return;suspended=false;render();},destroy(){if(destroyed)return;destroyed=true;revision++;for(const node of [confirm,retry,reject,download])node.onclick=null;element.remove();}};
}
