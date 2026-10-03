import {validatePath} from './model.mjs';
import {loadResourceIndex} from '../local-resource-migration/canvas-load.mjs';

const cancelled = message => Object.assign(Error(message || '作品预览或导出已失效，请重新打开'), {code:'artifact_export_stale'});
const escape = text => String(text).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
// The parent's frame-src also governs navigation initiated by the child. The
// child has an opaque origin and can run inline interactions, but HTTP(S), data
// and blob document navigation cannot replace it with a network-capable page.
export const offlineWrapperPolicy = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; media-src data:; font-src data:; connect-src 'none'; frame-src about:; object-src 'none'; base-uri 'none'; form-action 'none'";
export function offlineHtmlWrapper(html, title = '互动作品') {
  return '<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="'+offlineWrapperPolicy+'"><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+escape(title)+'</title><style>html,body{width:100%;height:100%;margin:0;overflow:hidden}iframe{display:block;width:100%;height:100%;border:0}</style></head><body><iframe title="'+escape(title)+'" sandbox="allow-scripts" referrerpolicy="no-referrer" srcdoc="'+escape(html)+'"></iframe></body></html>';
}
export function exportFilename(path) {
  validatePath(path);
  return (path.split('/').at(-1).replace(/\.html?$/i,'').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/^\.+|\.+$/g,'').slice(0,120)||'creative-page')+'.html';
}
export async function defaultHtmlResourceOptions(signal) {
  const fetchImpl = globalThis.fetch?.bind(globalThis);
  const state = await loadResourceIndex({fetchIndex:fetchImpl ? (url, options) => fetchImpl(url,{...options,signal}) : undefined});
  if(signal.aborted)throw signal.reason||cancelled();
  // Missing index does not prevent genuine data/asset media from exporting;
  // the shared resolver uses its empty trusted table and reports unmapped URLs.
  return {...state.index?{index:state.index}:{},assets:globalThis.window?.LocalAssets,fetchImpl};
}
export function createHtmlExportSession({file,getCurrentFile,isCurrent=()=>true,getResourceOptions=defaultHtmlResourceOptions,localize,document=globalThis.document}={}) {
  validatePath(file?.artifact_path);
  if(file.content_type!=='html'||typeof file.content!=='string'||file.content.length>60000||!Number.isSafeInteger(file.revision)||file.revision<1)throw Error('HTML作品来源或版本无效');
  const snapshot=Object.freeze({...file}),controller=new AbortController();let closed=false,prepared;
  function live() {if(closed||controller.signal.aborted)throw controller.signal.reason||cancelled();let current=false;try{current=isCurrent()!==false;}catch{}if(!current)throw cancelled();}
  async function assertCurrent() {
    live();if(typeof getCurrentFile!=='function')throw Error('作品版本读取接口未配置，不能核对本地导出');
    const current=await getCurrentFile();live();
    if(!current||current.artifact_path!==snapshot.artifact_path||current.revision!==snapshot.revision||current.content_type!=='html'||current.content!==snapshot.content)throw cancelled('作品已更新或删除，请重新打开当前版本');
    return true;
  }
  async function prepare() {
    await assertCurrent();
    if(!prepared)prepared=(async()=>{
      const options=await getResourceOptions(controller.signal);live();
      const transform=localize||(await import('../local-resource-migration/html-document.mjs')).localizeHtmlDocument;live();
      const result=await transform(snapshot.content,{...options,document,signal:controller.signal});
      await assertCurrent();
      if(!result||typeof result.html!=='string'||!['ready','pending_import'].includes(result.status)||!Array.isArray(result.diagnostics))throw Error('HTML本地资源接口返回无效结果');
      return result;
    })();
    const result=await prepared;await assertCurrent();return result;
  }
  async function exportDocument() {
    const result=await prepare();
    if(result.status!=='ready')throw Object.assign(Error('作品含未完成的本地资源或外部依赖，不能完成离线导出'),{code:'html_export_pending',diagnostics:result.diagnostics});
    await assertCurrent();
    return {artifact_path:snapshot.artifact_path,revision:snapshot.revision,sourceHash:result.sourceHash,html:offlineHtmlWrapper(result.html,snapshot.title),filename:exportFilename(snapshot.artifact_path),diagnostics:result.diagnostics,summary:result.summary};
  }
  return {snapshot,signal:controller.signal,assertCurrent,prepare,exportDocument,close(){if(closed)return;closed=true;controller.abort(cancelled('作品预览已关闭'));},isCurrent(){try{live();return true;}catch{return false;}}};
}
