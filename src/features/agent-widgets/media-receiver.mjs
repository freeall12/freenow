import {createMediaHandoffView} from './media-handoff-view.mjs';

// A message may propose one artifact. Only the host button can apply it.
export function createWidgetMediaReceiver({mount,document=globalThis.document,isCurrent,onUpload,onDownload,reply,createId=()=>crypto.randomUUID()}) {
  let pending,dead=false;
  function reset(message='组件已关闭或更新，媒体交接已取消') {
    const item=pending;pending=null;if(!item)return;
    clearTimeout(item.timer);item.controller.abort();item.view.destroy();
    if(!item.finished)reply(item.requestId,{error:message},item.identity);
  }
  function receive(data,identity) {
    if(dead||!isCurrent(identity))return;
    const fail=message=>reply(data.requestId,{error:message},identity);
    if(typeof data.requestId!=='string'||!data.requestId||data.requestId.length>180)return;
    if(pending){if(pending.requestId!==data.requestId)fail('请先处理当前媒体交接');return;}
    const blob=data.blob,options=data.options||{};
    // Structured-cloned Blob belongs to the receiving browser realm.
    if(!(blob instanceof (document.defaultView?.Blob||Blob))||!blob.size||blob.size>80*1024*1024||
      !['image/png','video/mp4','video/webm'].includes(blob.type.split(';')[0])||blob.type==='image/png'&&blob.size>32*1024*1024)return fail('只接受 PNG（最大32 MiB）、MP4 或 WebM（最大80 MiB）实际文件');
    if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(key=>!['filename','duration','fps'].includes(key))||
      options.filename!==undefined&&(typeof options.filename!=='string'||options.filename.length>180)||
      options.duration!==undefined&&(!Number.isFinite(options.duration)||options.duration<.1||options.duration>120)||
      options.fps!==undefined&&(!Number.isInteger(options.fps)||options.fps<1||options.fps>60))return fail('媒体交接参数无效');
    const type=blob.type.startsWith('image/')?'image':'video';
    if(type==='image'&&(options.duration!==undefined||options.fps!==undefined))return fail('图片不能携带录像时长或帧率');
    const controller=new AbortController(),operationId=createId();
    const item={requestId:data.requestId,operationId,identity,controller,finished:false,view:null,timer:null};
    pending=item;
    const valid=()=>!dead&&pending===item&&!controller.signal.aborted&&isCurrent(identity);
    const extension=type==='image'?'png':blob.type.startsWith('video/mp4')?'mp4':'webm';
    const stem=(options.filename|| (type==='image'?'白模截图':'白模录像')).replace(/[\\/\x00-\x1f]/g,'_').replace(/\.[^.]*$/,'').slice(0,110);
    const filename=(stem||'白模产物')+'.'+extension;
    const payload={operationId,type,blob,...(options.duration!==undefined?{duration:options.duration}:{}),...(options.fps!==undefined?{fps:options.fps}:{}),title:filename};
    async function apply(retry=false){
      if(!valid())throw Error('此媒体交接已失效');
      if(!onUpload)throw Error('画布媒体交接尚未配置');
      const result=await onUpload(payload,{signal:controller.signal,isCurrent:valid,retry,onProgress:receipt=>{if(valid())item.view.update(receipt);}});
      if(!valid())throw Error('组件状态已改变，请检查画布实际结果');
      item.result=result;
      if(result?.applied===true&&result.saved===true){
        item.finished=true;item.result=result;clearTimeout(item.timer);reply(item.requestId,{result},identity);
        // Keep the visible receipt; the next request can replace it.
      }
      return result;
    }
    item.view=createMediaHandoffView({document,request:{requestId:data.requestId,title:filename,filename,mimeType:blob.type,size:blob.size,...(options.duration!==undefined?{duration:options.duration}:{}),...(options.fps!==undefined?{fps:options.fps}:{})},isCurrent:valid,
      onConfirm:()=>apply(false),onRetrySave:()=>apply(true),onReject:()=>reset('用户未将此媒体加入画布'),onDownload:()=>{if(valid()){if(!onDownload)throw Error('下载尚未配置');return onDownload(blob,filename,{receipt:item.result,isCurrent:valid,signal:controller.signal});}}});
    mount.append(item.view.element);
    item.timer=setTimeout(()=>reset('媒体交接等待超时，请重新发送'),300000);
  }
  return {receive(data,identity){if(pending?.finished){if(pending.requestId===data.requestId&&isCurrent(identity)){reply(data.requestId,{result:pending.result},identity);return;}reset();}receive(data,identity);},reset,destroy(){reset();dead=true;}};
}
