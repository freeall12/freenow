// Local inferred helper: the official article is captured, its linked recorder specification is not.
// Keep the factory self-contained: the widget CSP only permits inline script, not module imports.
export function createWhiteboxCapture({
  canvas,renderFrame,pause=()=>undefined,restore=()=>{},
  createCanvas=()=>document.createElement('canvas'),
  createVideo=()=>document.createElement('video'),
  Recorder=globalThis.MediaRecorder,
  objectUrls=globalThis.URL,
  now=()=>performance.now(),
  setTimer=(callback,ms)=>setTimeout(callback,ms),
  clearTimer=id=>clearTimeout(id),
  isVisible=()=>globalThis.document?.visibilityState!=='hidden'
}={}){
  const fault=(code,message)=>Object.assign(Error(message),{code});
  if(!canvas||typeof renderFrame!=='function'||typeof pause!=='function'||typeof restore!=='function')throw TypeError('canvas/renderFrame/pause/restore adapters are required');
  let active=null,disposed=false;
  const checkSize=()=>{if(!Number.isInteger(canvas.width)||!Number.isInteger(canvas.height)||canvas.width<1||canvas.height<1||canvas.width*canvas.height>16777216)throw fault('invalid_capture_size','白模画面尺寸无效或超过 1600 万像素');};
  async function session(signal,timeout,operation){
    if(disposed)throw fault('capture_disposed','白模录制器已关闭');
    if(active)throw fault('capture_busy','白模截图或录制正在进行');
    checkSize();
    const controller=new AbortController();active=controller;
    let rejectAbort,timer,token,paused=false,stage,primaryError;
    const interrupted=new Promise((_,reject)=>{rejectAbort=reject;});interrupted.catch(()=>{});
    const onAbort=()=>rejectAbort(controller.signal.reason);
    const cancel=()=>controller.abort(signal?.reason??fault('cancelled','白模捕获已取消'));
    controller.signal.addEventListener('abort',onAbort,{once:true});
    if(signal?.aborted)cancel();else signal?.addEventListener('abort',cancel,{once:true});
    timer=setTimer(()=>controller.abort(fault('capture_timeout','白模捕获超时')),timeout);
    const check=()=>{if(controller.signal.aborted)throw controller.signal.reason;if(!isVisible())throw fault('capture_hidden','白模页面已隐藏，录制已停止；请保持页面可见');};
    const wait=async operation=>{check();const value=await Promise.race([Promise.resolve().then(()=>{check();return operation();}),interrupted]);check();return value;};
    try{
      check();token=pause();paused=true;
      if(token?.then){token.catch?.(()=>{});throw fault('async_pause_unsupported','白模暂停回调必须同步返回预览状态');}
      stage=createCanvas();stage.width=canvas.width;stage.height=canvas.height;
      const context=stage.getContext('2d');if(!context)throw fault('capture_unavailable','浏览器无法创建画面捕获画布');
      const draw=(time,info)=>{
        check();if(canvas.width!==stage.width||canvas.height!==stage.height)throw fault('capture_size_changed','白模画面尺寸变化，捕获已停止');
        const rendered=renderFrame(time,info);
        if(rendered?.then){rendered.catch?.(()=>{});throw fault('async_render_unsupported','renderFrame 必须同步绘制确定时间的画面');}
        // Copy in the same task as raw WebGL rendering, before a non-preserved buffer is cleared.
        context.clearRect(0,0,stage.width,stage.height);context.drawImage(canvas,0,0);
        check();
      };
      return await operation({stage,draw,wait,check,controller});
    }catch(error){primaryError=error;throw error;}
    finally{
      clearTimer(timer);signal?.removeEventListener('abort',cancel);controller.signal.removeEventListener('abort',onAbort);
      if(stage)stage.width=stage.height=0;
      try{if(paused)restore(token);}catch(error){if(primaryError&&typeof primaryError==='object')primaryError.restoreError=error;else throw error;}
      finally{active=null;}
    }
  }
  function delay(ms,{wait}){
    let timer;
    return wait(()=>new Promise(resolve=>{timer=setTimer(resolve,Math.max(0,ms));})).finally(()=>clearTimer(timer));
  }
  async function metadata(blob,{wait}){
    let video,url;
    try{
      video=createVideo();url=objectUrls.createObjectURL(blob);
      return await wait(()=>new Promise((resolve,reject)=>{
        video.preload='metadata';
        video.onerror=()=>reject(fault('recording_decode_failed','录制文件无法读取'));
        video.onloadedmetadata=()=>{
          if(!(video.videoWidth>0&&video.videoHeight>0))return reject(fault('recording_decode_failed','录制文件没有有效画面尺寸'));
          resolve({width:video.videoWidth,height:video.videoHeight,duration:Number.isFinite(video.duration)&&video.duration>0?video.duration:null});
        };
        video.src=url;
      }));
    }finally{
      if(video){video.onerror=video.onloadedmetadata=null;try{video.removeAttribute('src');video.load();}catch{}}
      if(url)objectUrls.revokeObjectURL(url);
    }
  }
  return {
    async screenshot({time=0,signal}={}){
      if(!Number.isFinite(time)||time<0)throw fault('invalid_capture_time','截图时间无效');
      return session(signal,10000,async scope=>{
        scope.draw(time,{recording:false});
        const blob=await scope.wait(()=>new Promise((resolve,reject)=>scope.stage.toBlob(value=>value?.size?resolve(value):reject(fault('screenshot_failed','PNG 截图导出失败')),'image/png')));
        if(blob.type!=='image/png')throw fault('screenshot_failed','截图没有返回 PNG');
        return blob;
      });
    },
    async record({fps=30,duration,signal,onProgress=()=>{},videoBitsPerSecond=6000000}={}){
      if(!Number.isInteger(fps)||fps<1||fps>60||!Number.isFinite(duration)||duration<=0||duration>120||Math.abs(duration*fps-Math.round(duration*fps))>1e-6)throw fault('invalid_recording_timing','录制须为 1–60 fps、最多 120 秒，时长必须对齐完整帧');
      if(!Number.isFinite(videoBitsPerSecond)||videoBitsPerSecond<100000||videoBitsPerSecond>50000000)throw fault('invalid_recording_bitrate','录制码率无效');
      const mime=['video/mp4;codecs=avc1.42E01E','video/mp4;codecs=avc1','video/mp4','video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm'].find(value=>Recorder?.isTypeSupported?.(value));
      if(!mime)throw fault('recorder_unavailable','浏览器没有支持的 MP4 或 WebM 录制器');
      return session(signal,duration*1000+15000,async scope=>{
        let stream,recorder;
        const frameCount=Math.round(duration*fps),interval=1000/fps,chunks=[];
        try{
          scope.draw(0,{recording:true,frame:0,fps,duration});
          if(typeof scope.stage.captureStream!=='function')throw fault('capture_stream_unavailable','浏览器不支持画布视频录制');
          stream=scope.stage.captureStream(0);
          const track=stream.getVideoTracks()[0];
          if(typeof track?.requestFrame!=='function')throw fault('manual_frames_unavailable','浏览器不支持按帧捕获；没有退化为不确定的动画录制');
          recorder=new Recorder(stream,{mimeType:mime,videoBitsPerSecond});
          const stopped=new Promise(resolve=>{recorder.onstop=resolve;});
          recorder.ondataavailable=event=>{if(event.data?.size)chunks.push(event.data);};
          recorder.onerror=event=>scope.controller.abort(event.error||fault('recording_failed','视频编码失败'));
          recorder.start();const started=now();
          for(let frame=0;frame<frameCount;frame++){
            if(frame)await delay(started+frame*interval-now(),scope);
            scope.check();
            if(recorder.state!=='recording'||track.readyState==='ended')throw fault('recording_interrupted','录制器或画面轨道提前结束');
            if(now()-(started+frame*interval)>Math.max(250,interval*4))throw fault('recording_too_slow','白模绘制或后台调度明显过慢，无法保持录制节拍');
            if(frame)scope.draw(frame/fps,{recording:true,frame,fps,duration});
            if(now()-(started+frame*interval)>Math.max(250,interval*4))throw fault('recording_too_slow','白模单帧绘制超时，录制已停止');
            track.requestFrame();onProgress({frame:frame+1,frameCount,time:frame/fps,progress:(frame+1)/frameCount});
          }
          await delay(started+duration*1000-now(),scope);scope.check();
          if(now()-(started+duration*1000)>Math.max(250,interval*4))throw fault('recording_too_slow','录制结束调度明显超时，未返回失真时长的视频');
          const wallDuration=(now()-started)/1000;recorder.stop();await scope.wait(()=>stopped);
          if(!chunks.length)throw fault('empty_recording','浏览器没有输出视频字节');
          const actualMime=recorder.mimeType||mime,blob=new Blob(chunks,{type:actualMime});
          const measured=await metadata(blob,scope);
          if(measured.width!==scope.stage.width||measured.height!==scope.stage.height)throw fault('recording_size_mismatch','录制文件实际尺寸与白模画面不符');
          return {blob,mimeType:actualMime,...measured,fps,requestedDuration:duration,wallDuration,frameCount,requiresFinalize:true};
        }finally{
          if(recorder){recorder.ondataavailable=recorder.onerror=recorder.onstop=null;if(recorder.state!=='inactive')try{recorder.stop();}catch{}}
          stream?.getTracks().forEach(track=>track.stop());
        }
      });
    },
    cancel(){active?.abort(fault('cancelled','白模捕获已取消'));},
    dispose(){disposed=true;active?.abort(fault('cancelled','白模录制器已关闭'));}
  };
}

export function whiteboxCaptureSource(){
  return 'window.tapnow=window.tapnow||{};window.tapnow.createWhiteboxCapture='+createWhiteboxCapture.toString()+';';
}
