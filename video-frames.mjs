export async function openVideoFrames(src,signal) {
  const video=document.createElement('video');video.crossOrigin='anonymous';video.preload='auto';video.muted=true;video.playsInline=true;
  let disposed=false,decoded=false;
  function waitFrame(target,load=false) {
    return new Promise((resolve,reject)=>{
      let callback,timer,done=false,metadata=!load,presented=false;
      const clean=()=>{clearTimeout(timer);if(callback!==undefined)video.cancelVideoFrameCallback(callback);video.onloadedmetadata=video.onloadeddata=video.onseeked=video.onerror=null;signal?.removeEventListener('abort',abort);};
      const finish=error=>{if(done)return;done=true;clean();if(error)reject(error);else{decoded=true;resolve();}};
      const abort=()=>finish(new DOMException('已取消','AbortError'));
      if(disposed||signal?.aborted){abort();return;}
      const ready=()=>metadata&&video.readyState>=2&&!video.seeking&&Math.abs(video.currentTime-target)<.05;
      const settle=()=>{if(ready()&&(presented||!video.requestVideoFrameCallback))requestAnimationFrame(()=>finish());};
      const frame=(_now,info)=>{presented=Math.abs(info.mediaTime-target)<.15;if(presented)settle();else callback=video.requestVideoFrameCallback(frame);};
      const fallback=settle;
      video.onerror=()=>finish(Error('视频加载失败'));
      video.onloadeddata=video.onseeked=fallback;
      signal?.addEventListener('abort',abort,{once:true});timer=setTimeout(()=>finish(Error('视频帧读取超时')),15000);
      if(video.requestVideoFrameCallback)callback=video.requestVideoFrameCallback(frame);
      if(load){video.onloadedmetadata=()=>{metadata=true;settle();};video.src=src;video.load();}
      else video.currentTime=target;
    });
  }
  const dispose=()=>{disposed=true;video.removeAttribute('src');video.load();};
  try{await waitFrame(0,true);}catch(e){dispose();throw e;}
  return {video,duration:video.duration,width:video.videoWidth,height:video.videoHeight,dispose,
    async at(time,width=240){
      if(disposed||signal?.aborted)throw new DOMException('已取消','AbortError');
      const target=Math.max(0,Math.min(time,Math.max(0,video.duration-.001)));
      if(!decoded||Math.abs(video.currentTime-target)>.001)await waitFrame(target);
      const canvas=document.createElement('canvas');canvas.width=width;canvas.height=Math.max(1,Math.round(width*video.videoHeight/video.videoWidth));canvas.getContext('2d').drawImage(video,0,0,canvas.width,canvas.height);return canvas;
    }
  };
}
