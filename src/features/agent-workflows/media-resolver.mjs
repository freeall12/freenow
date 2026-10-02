const failure=(code,message)=>Object.assign(Error(message),{code});
const positive=value=>Number.isFinite(value)&&value>0;
const dimensions=(width,height)=>Number.isInteger(width)&&width>0&&Number.isInteger(height)&&height>0;

// LocalAssets owns its cached blob URLs. This resolver creates no object URLs and never revokes shared ones.
export function createWorkflowMediaResolver({
  localAssets=globalThis.LocalAssets,
  createVideo=()=>document.createElement('video'),
  createImage=()=>new Image(),
  createAudio=()=>document.createElement('audio'),
  getLegacyVideo=node=>globalThis.EDITOR_DATA?.nodes?.[node.id]?.video,
  resolveClip,
  baseUrl=globalThis.document?.baseURI,
  timeoutMs=20000
}={}){
  return async function resolveMedia(node,{signal,timeoutMs:deadline=timeoutMs,decodeImage=true}={}){
    if(!node?.id||!['image','video','audio'].includes(node.type))throw failure('invalid_media_node','请选择有效的图片、视频或音频节点');
    if(!Number.isFinite(deadline)||deadline<1||deadline>120000)throw failure('invalid_timeout','媒体读取超时须在 1–120000 毫秒之间');
    const controller=new AbortController();let timer,cleanupProbe=()=>{};
    const cancel=()=>controller.abort(signal?.reason??failure('cancelled','媒体读取已取消'));
    const check=()=>{if(controller.signal.aborted)throw controller.signal.reason;};
    let rejectAbort;
    const interrupted=new Promise((_,reject)=>{rejectAbort=reject;});
    const onAbort=()=>rejectAbort(controller.signal.reason);
    controller.signal.addEventListener('abort',onAbort,{once:true});
    // Attach a rejection handler even when cancellation precedes the first asynchronous read.
    interrupted.catch(()=>{});
    if(signal?.aborted)cancel();else signal?.addEventListener('abort',cancel,{once:true});
    timer=setTimeout(()=>controller.abort(failure('media_timeout','媒体读取超时')),deadline);
    const wait=async operation=>{check();const value=await Promise.race([Promise.resolve().then(()=>{check();return operation();}),interrupted]);check();return value;};
    function checkedUrl(source){
      if(typeof source!=='string'||!source.trim())throw failure('media_missing','节点没有可读取的媒体');
      let parsed;try{parsed=new URL(source,baseUrl);}catch{throw failure('invalid_media_url','媒体地址无效');}
      if(!['https:','http:','blob:','data:'].includes(parsed.protocol))throw failure('invalid_media_url','不支持此媒体地址协议');
      if(parsed.protocol==='data:'&&!new RegExp('^data:'+node.type+'/','i').test(source))throw failure('invalid_media_url','媒体数据类型与节点不符');
      return parsed.href;
    }
    async function urlFor(source){
      check();
      if(typeof source==='string'&&source.startsWith('asset:')){
        if(typeof localAssets?.url!=='function')throw failure('asset_store_unavailable','本地素材存储不可用');
        source=await wait(()=>localAssets.url(source));
      }
      return checkedUrl(source);
    }
    function probe(url){
      return new Promise((resolve,reject)=>{
        let media,settled=false;
        const finish=(error,value)=>{if(settled)return;settled=true;error?reject(error):resolve(value);};
        try{
          media=node.type==='video'?createVideo():node.type==='audio'?createAudio():createImage();
          cleanupProbe=()=>{
            settled=true;media.onerror=null;media.onload=null;media.onloadedmetadata=null;
            try{media.removeAttribute('src');if(node.type!=='image')media.load();}catch{}
          };
          media.onerror=()=>finish(failure('media_decode_failed','媒体读取或解码失败'));
          if(node.type!=='image'){
            media.preload='metadata';
            media.onloadedmetadata=()=>{
              const {videoWidth:width,videoHeight:height,duration}=media;
              if(!positive(duration)||node.type==='video'&&!dimensions(width,height))return finish(failure('invalid_media_metadata','音视频缺少有效的媒体尺寸或有限时长'));
              finish(null,node.type==='audio'?{duration}:{width,height,duration});
            };
          }else{
            media.onload=async()=>{
              try{
                if(typeof media.decode==='function')await media.decode();
                if(settled)return;
                const {naturalWidth:width,naturalHeight:height}=media;
                if(!dimensions(width,height))throw failure('invalid_media_metadata','图片解码后没有有效像素尺寸');
                finish(null,{width,height});
              }catch(error){finish(failure('media_decode_failed',error?.message||'图片解码失败'));}
            };
          }
          media.src=url;
        }catch(error){finish(error);}
      });
    }
    try{
      check();
      const source=node.type==='video'?(node.video||getLegacyVideo(node)):node.type==='audio'?node.audio:(node.fullImage||node.image);
      let url=await urlFor(source),clip;
      if(node.type==='video'&&(node.clip!=null||node.trim!=null)){
        clip=node.clip?{start:node.clip.start,end:node.clip.end}:null;
        if(node.trim!=null||!clip||!Number.isFinite(clip.start)||clip.start<0||!Number.isFinite(clip.end)||clip.end<=clip.start)throw failure('invalid_clip','裁剪范围无效或裁剪格式不受支持');
        if(typeof resolveClip!=='function')throw failure('clip_media_required','裁剪节点需要先导出真实裁剪视频，不能使用完整来源视频代替');
        const originalUrl=url;
        const derived=await wait(()=>resolveClip(node,{source,url,clip:{start:clip.start,end:clip.end},signal:controller.signal}));
        if(derived?.source!==source||derived?.clip?.start!==clip.start||derived?.clip?.end!==clip.end)throw failure('clip_source_mismatch','裁剪视频没有绑定当前来源和裁剪范围');
        url=await urlFor(derived.url);
        if(url===originalUrl)throw failure('clip_media_required','裁剪结果仍是完整来源视频');
      }
      // Native uploads must apply their fetch boundary before an Image probe can
      // contact a URL. Resolve local asset identity now, decode inline bytes later.
      if(node.type==='image'&&!decodeImage)return {id:node.id,type:node.type,url};
      const metadata=await wait(()=>probe(url));
      if(clip&&Math.abs(metadata.duration-(clip.end-clip.start))>.1)throw failure('clip_duration_mismatch','实际裁剪视频时长与节点裁剪范围不符');
      return {id:node.id,type:node.type,url,...metadata};
    }finally{
      clearTimeout(timer);signal?.removeEventListener('abort',cancel);controller.signal.removeEventListener('abort',onAbort);
      cleanupProbe();
    }
  };
}
