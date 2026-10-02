const failure=(code,message)=>Object.assign(Error(message),{code});
const MAX_BYTES=80*1024*1024;
const signature=node=>JSON.stringify([node?.video,node?.fullImage,node?.image,node?.clip,node?.duration,node?.videoMetadata]);

export function serializeClipBlob(blob,{signal,createReader=()=>new FileReader()}={}){
  return new Promise((resolve,reject)=>{
    let reader;
    const clean=()=>{signal?.removeEventListener('abort',cancel);if(reader)reader.onload=reader.onerror=reader.onabort=null;};
    const finish=(error,value)=>{clean();error?reject(error):resolve(value);};
    const cancel=()=>{clean();try{reader?.abort();}catch{}reject(signal.reason??failure('cancelled','裁剪已取消'));};
    if(signal?.aborted)return cancel();
    try{
      reader=createReader();signal?.addEventListener('abort',cancel,{once:true});
      reader.onload=()=>finish(null,reader.result);
      reader.onerror=()=>finish(reader.error||failure('clip_serialize_failed','裁剪视频编码失败'));
      reader.onabort=()=>finish(failure('cancelled','裁剪视频编码已取消'));
      reader.readAsDataURL(blob);
    }catch(error){finish(error);}
  });
}

// LocalAssets has no abort/delete contract. Return actual bytes as a data URL instead of
// persisting an orphaned clip after cancellation; the generated canvas result owns persistence.
export function createLocalClipResolver({
  getNode,
  localMedia=globalThis.LocalMedia,
  fetchImpl=(...args)=>fetch(...args),
  serialize=serializeClipBlob,
  publishClip,
  maxInlineBytes=47*1024*1024,
  getLegacyVideo=node=>globalThis.EDITOR_DATA?.nodes?.[node.id]?.video,
  timeoutMs=110000
}={}){
  if(typeof getNode!=='function')throw TypeError('getNode adapter is required');
  if(typeof localMedia?.process!=='function')throw TypeError('LocalMedia.process adapter is required');
  let cache,epoch=0;
  const resolveClip=async function(node,{source,url,clip,signal}={}){
    const start=clip?.start,end=clip?.end,id=node?.id;
    if(!id||node.type!=='video'||typeof source!=='string'||!source||typeof url!=='string'||!url)throw failure('invalid_clip_source','裁剪来源无效');
    if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<=start||end-start>600||end>36000)throw failure('invalid_clip','裁剪范围超出本地处理限制');
    if(!Number.isFinite(timeoutMs)||timeoutMs<1||timeoutMs>120000)throw failure('invalid_timeout','裁剪超时须在 1–120000 毫秒之间');
    const snapshot=signature(node),key=JSON.stringify([source,url,start,end,snapshot]),startedEpoch=epoch;
    const controller=new AbortController();let timer;
    const cancel=()=>controller.abort(signal?.reason??failure('cancelled','裁剪已取消'));
    let rejectAbort;const interrupted=new Promise((_,reject)=>{rejectAbort=reject;});interrupted.catch(()=>{});
    const onAbort=()=>rejectAbort(controller.signal.reason);
    controller.signal.addEventListener('abort',onAbort,{once:true});
    if(signal?.aborted)cancel();else signal?.addEventListener('abort',cancel,{once:true});
    timer=setTimeout(()=>controller.abort(failure('clip_timeout','本地视频裁剪超时')),timeoutMs);
    function guard(){
      if(controller.signal.aborted)throw controller.signal.reason;
      const current=getNode(id);
      if(!current||current!==node||signature(current)!==snapshot||current.type!=='video'||(current.video||getLegacyVideo(current))!==source||current.clip?.start!==start||current.clip?.end!==end||current.trim!=null)throw failure('source_changed','裁剪来源或时间范围已变化');
    }
    const wait=async operation=>{guard();const result=await Promise.race([Promise.resolve().then(()=>{guard();return operation();}),interrupted]);guard();return result;};
    try{
      guard();
      if(cache?.node===node&&cache.key===key)return {...cache.value,clip:{...cache.value.clip}};
      const response=await wait(()=>fetchImpl(url,{signal:controller.signal}));
      if(!response?.ok)throw failure('clip_source_unavailable','裁剪来源视频读取失败');
      if(Number(response.headers?.get?.('content-length'))>MAX_BYTES)throw failure('clip_too_large','本地视频处理限制为 80 MB');
      const blob=await wait(()=>response.blob());
      if(!(blob instanceof Blob)||!blob.size)throw failure('clip_source_unavailable','裁剪来源视频为空');
      if(blob.size>MAX_BYTES)throw failure('clip_too_large','本地视频处理限制为 80 MB');
      const result=await wait(()=>localMedia.process('trim',blob,{start,end,signal:controller.signal}));
      if(!(result instanceof Blob)||!result.size||!result.type.startsWith('video/'))throw failure('invalid_clip_output','本地裁剪没有返回有效视频');
      if(result===blob)throw failure('invalid_clip_output','本地裁剪返回了原始视频');
      if(result.size>MAX_BYTES)throw failure('clip_too_large','裁剪视频超过 80 MB');
      if(!Number.isFinite(maxInlineBytes)||maxInlineBytes<1||maxInlineBytes>47*1024*1024)throw failure('invalid_inline_budget','内联裁剪视频预算无效');
      if(result.size>maxInlineBytes&&!publishClip)throw failure('clip_transport_required','裁剪视频超过生成接口内联预算，请接入视频素材上传；没有压缩或截短视频');
      const derivedUrl=await wait(()=>publishClip?publishClip(result,{source,clip:{start,end},signal:controller.signal}):serialize(result,{signal:controller.signal}));
      const inline=typeof derivedUrl==='string'&&/^data:video\/[a-z0-9.+-]+;base64,[a-z0-9+/]+=*$/i.test(derivedUrl);
      const published=typeof derivedUrl==='string'&&/^https?:\/\//i.test(derivedUrl);
      if(!inline&&!(publishClip&&published)||derivedUrl===url||derivedUrl===source)throw failure('invalid_clip_output','裁剪结果不是独立视频数据或已上传媒体');
      if(inline&&derivedUrl.length>Math.ceil(maxInlineBytes/3)*4+100)throw failure('clip_transport_required','裁剪视频数据超过生成接口内联预算');
      const value={source,clip:{start,end},url:derivedUrl};
      if(startedEpoch===epoch)cache={node,key,value};
      return {...value,clip:{...value.clip}};
    }finally{
      clearTimeout(timer);signal?.removeEventListener('abort',cancel);controller.signal.removeEventListener('abort',onAbort);
      // Stop a cooperative adapter after source edits as well as explicit user cancellation.
      if(!controller.signal.aborted)controller.abort(failure('clip_finished','裁剪读取已结束'));
    }
  };
  resolveClip.clear=()=>{cache=undefined;epoch++;};
  return resolveClip;
}
