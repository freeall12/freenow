import { icons } from './icons.mjs';
import {createHtmlExportSession,offlineHtmlWrapper} from './local-export.mjs';

export function previewDocument(html) {
  return offlineHtmlWrapper(html);
}
export function openHtmlPreview({file,getCurrentFile,isCurrent=()=>true,getResourceOptions,localize,onShare,onError,showShare=false}) {
  const previousFocus = document.activeElement;
  const session=createHtmlExportSession({file,getCurrentFile,isCurrent,getResourceOptions,localize});
  let closed=false,downloading=false,exportReady=false;const urls=new Set();
  const dialog = document.createElement('dialog'); dialog.className = 'agent-html-preview'; dialog.setAttribute('aria-label', 'HTML 预览');
  const side = document.createElement('aside'), main = document.createElement('div'); main.className = 'agent-html-main';
  const brand = document.createElement('div'); brand.className = 'agent-html-brand';
  const logo = document.createElement('img'); logo.src = 'assets/tap-logo-official.svg'; logo.alt = 'TapNow';
  brand.append(logo, document.createTextNode('TapNow')); side.append(brand);
  const title = document.createElement('h3'); title.textContent = file.title || file.artifact_path.split('/').at(-1); side.append(title);
  const disclaimer = document.createElement('p'); disclaimer.className = 'agent-html-disclaimer';
  disclaimer.textContent = '此页面由用户使用 AI 创建，可能包含不准确的信息，请自行核实。其内容与观点不代表 TapNow。'; side.append(disclaimer);
  const actions = document.createElement('div'); actions.className = 'agent-html-actions';
  const status = document.createElement('p'); status.role = 'status'; status.className = 'agent-artifact-status';
  const diagnostics=document.createElement('details'),diagnosticSummary=document.createElement('summary'),diagnosticList=document.createElement('ul');diagnosticSummary.textContent='查看资源位置';diagnostics.append(diagnosticSummary,diagnosticList);diagnostics.hidden=true;
  function showDiagnostics(items=[]) {diagnosticList.replaceChildren();diagnostics.hidden=!items.length;for(const item of items.slice(0,30)){const row=document.createElement('li');row.textContent=[item.path||item.location,item.code,item.message].filter(Boolean).join('：');diagnosticList.append(row);}if(items.length>30){const row=document.createElement('li');row.textContent=`另有${items.length-30}项`;diagnosticList.append(row);}}
  function report(error) {if(closed||!dialog.isConnected||!session.isCurrent())return;if(error.code==='artifact_export_stale'){exportReady=false;download.disabled=true;frame.hidden=true;}status.textContent=error.message;showDiagnostics(error.diagnostics);onError?.(error.message);}
  function button(label, icon, action) {
    const button = document.createElement('button'); button.type = 'button'; button.ariaLabel = label; button.innerHTML = icons[icon]; button.append(document.createTextNode(label)); button.onclick = action; return button;
  }
  const download=button('下载 HTML','download',async()=>{
    if(downloading||download.disabled||closed)return;downloading=true;download.disabled=true;status.textContent='正在核对作品版本与本地资源…';
    try {
      const result=await session.exportDocument();
      if(closed||!dialog.isConnected||!session.isCurrent())return;
      const url=URL.createObjectURL(new Blob([result.html],{type:'text/html;charset=utf-8'}));urls.add(url);
      const link=document.createElement('a');link.href=url;link.download=result.filename;dialog.append(link);link.click();link.remove();
      setTimeout(()=>{URL.revokeObjectURL(url);urls.delete(url);},10000);
      status.textContent=`已下载版本${result.revision}的自包含派生HTML，原作品保持原文。`;
    }catch(error){report(error);}finally{downloading=false;if(!closed&&session.isCurrent())download.disabled=!exportReady;}
  });download.disabled=true;actions.append(download);
  const share = button('分享此页面', 'share', async () => {
    if (share.disabled) return;
    share.disabled = true; status.textContent = '正在分享…';
    try {
      if (!onShare) throw Error('分享服务未配置');
      const derived=await session.exportDocument();
      if(closed||!dialog.isConnected||!session.isCurrent())return;
      const result = await onShare({ artifact_path: file.artifact_path, revision: file.revision, title: file.title, html: derived.html });
      const url = new URL(result.url);
      if (!['http:', 'https:'].includes(url.protocol)) throw Error('分享服务返回了无效链接');
      if (closed||!dialog.isConnected||!session.isCurrent()) return;
      status.textContent = '分享链接'; const input = document.createElement('input'); input.readOnly = true; input.value = url.href; input.ariaLabel = '分享链接'; input.onfocus = () => input.select();
      share.replaceWith(input, button('复制', 'copy', async () => { try { await navigator.clipboard.writeText(url.href); status.textContent = '已复制链接'; } catch { status.textContent = '复制失败，请手动复制链接'; } }));
    } catch (error) {report(error);} finally {if(!closed)share.disabled = false;}
  });
  if (showShare) actions.append(share); actions.append(status,diagnostics); side.append(actions);
  const frame = document.createElement('iframe'); frame.title = title.textContent; frame.setAttribute('sandbox', 'allow-scripts'); frame.referrerPolicy = 'no-referrer';frame.hidden=true;main.append(frame);status.textContent='正在准备本地资源预览…';
  const close = button('关闭预览', 'close', () => dialog.close()); close.className = 'agent-html-close'; close.lastChild.remove();
  dialog.append(side, main, close); document.body.append(dialog);
  dialog.addEventListener('close', () => {closed=true;session.close();for(const url of urls)URL.revokeObjectURL(url);urls.clear();dialog.remove(); previousFocus?.isConnected && previousFocus.focus(); }, { once: true });
  dialog.onkeydown = event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dialog.close(); } };
  dialog.showModal(); close.focus();
  const ready=session.prepare().then(result=>{
    if(closed||!dialog.isConnected||!session.isCurrent())return false;
    frame.srcdoc=offlineHtmlWrapper(result.html,title.textContent);frame.hidden=false;showDiagnostics(result.diagnostics);
    exportReady=result.status==='ready';download.disabled=!exportReady;
    status.textContent=result.status==='ready'?`版本${file.revision}的本地派生预览已准备；可下载自包含HTML。`:'有资源或外部依赖待修复，不能完成离线导出；预览仅显示已准备内容。';
    return result;
  }).catch(error=>{report(error);return false;});
  return {ready,close(){if(!closed){session.close();dialog.close();}}};
}
