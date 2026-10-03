import {hasHtmlResourceSlots,prepareHtmlDocument,materializeHtmlDocument} from '../local-resource-migration/html-document.mjs';
import {loadResourceIndex} from '../local-resource-migration/canvas-load.mjs';
const emptyIndex={version:1,algorithm:'sha256-exact-utf8',entries:{}};
const aborted=()=>new DOMException('组件资源准备已取消','AbortError');

// A card retains at most one immutable source preparation and one successful
// materialization. Retry rechecks bindings without transcoding unchanged bytes.
export function createWidgetHtmlResources({document=globalThis.document,getAssets=()=>document.defaultView?.LocalAssets||globalThis.LocalAssets,
  fetchImpl=globalThis.fetch,loadIndex=loadResourceIndex,prepare=prepareHtmlDocument,materialize=materializeHtmlDocument,hasSlots=hasHtmlResourceSlots}={}){
  let source=null,prepared=null,cached=null,version=0,disposed=false;
  function prepareCode(code,{signal,isCurrent=()=>true}={}){
    if(disposed||signal?.aborted)throw aborted();
    if(source!==code){source=code;prepared=null;cached=null;version++;}
    if(!hasSlots(code,{document}))return {html:code,status:'ready',summary:{slots:0,embedded:0,unresolved:0},diagnostics:[]};
    const captured=version;let bindingAssets,bindingCaptured=false;
    const guard=()=>{if(disposed||signal?.aborted||captured!==version||source!==code||!isCurrent()||bindingCaptured&&getAssets()!==bindingAssets)throw aborted();};
    return (async()=>{
      guard();const assets=getAssets();bindingAssets=assets;bindingCaptured=true;const state=await loadIndex({fetchIndex:(url,options)=>fetchImpl(url,{...options,signal})});guard();
      const index=state.index||emptyIndex,indexKey=JSON.stringify(index);
      if(cached?.indexKey===indexKey&&cached.assets===assets){
        let valid=true;for(const [id,url]of cached.assetUrls){const actual=await assets.url(id);guard();if(actual!==url){valid=false;break;}}
        if(valid&&cached.assetBlobs.size){for(const [id,blob]of cached.assetBlobs){const actual=await assets.read(id);guard();if(actual!==blob){valid=false;break;}}}
        if(valid)return cached.result;
      }
      if(!prepared){const next=await prepare(code,{document,signal});guard();prepared=next;}
      const assetUrls=new Map(),assetBlobs=new Map(),adapter={};
      if(typeof assets?.url==='function')adapter.url=async id=>{const url=await assets.url(id);guard();assetUrls.set(id,url);return url;};
      else if(typeof assets?.read==='function')adapter.read=async id=>{const blob=await assets.read(id);guard();assetBlobs.set(id,blob);return blob;};
      const result=await materialize(prepared,{index,assets:adapter,fetchImpl,signal,policyTarget:'widget'});guard();
      if(result.status==='ready')cached={indexKey,assets,assetUrls,assetBlobs,result};
      else cached=null;
      return result;
    })();
  }
  return {prepare:prepareCode,dispose(){disposed=true;version++;source=prepared=cached=null;}};
}
