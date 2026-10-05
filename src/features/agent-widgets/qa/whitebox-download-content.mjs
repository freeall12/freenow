// Synthetic scene only. Capture and handoff are supplied by the production widget bridge.
export function whiteboxDownloadContent() {
  function runScene() {
    const canvas=document.querySelector('canvas'),context=canvas.getContext('2d'),status=document.querySelector('#capture-status');
    const buttons=[...document.querySelectorAll('button')],NativeRecorder=globalThis.MediaRecorder;
    function renderFrame(time) {
      context.fillStyle='#20323a';context.fillRect(0,0,320,180);
      context.fillStyle='#bdd2b6';context.fillRect(0,132,320,48);
      context.fillStyle='#658da1';context.fillRect(248,24,48,88);
      context.fillStyle='#ef8a40';context.fillRect(24+time*120,78,32,48);
      context.fillStyle='#f2deb1';context.beginPath();context.arc(48,38,12,0,Math.PI*2);context.fill();
    }
    const supports=family=>['',family==='mp4'?';codecs=avc1.42E01E':';codecs=vp9',family==='mp4'?';codecs=avc1':';codecs=vp8'].some(suffix=>NativeRecorder?.isTypeSupported?.('video/'+family+suffix));
    function recorderFor(family) {
      if(family==='default')return NativeRecorder;
      // A local capability-environment fixture; constructor/encoding remain native.
      return class extends NativeRecorder {
        static isTypeSupported(type) {return type.startsWith('video/'+family)&&NativeRecorder.isTypeSupported(type);}
      };
    }
    renderFrame(0);
    document.querySelector('#capabilities').textContent='原生支持：MP4 '+supports('mp4')+' · WebM '+supports('webm');
    let busy=false;
    function unlock() {
      for(const button of buttons)button.disabled=busy||(button.dataset.family&&button.dataset.family!=='default'&&!supports(button.dataset.family));
    }
    for(const button of buttons)button.onclick=async()=>{
      if(busy)return;busy=true;unlock();
      const family=button.dataset.family,capture=window.tapnow.createWhiteboxCapture({canvas,renderFrame,...(family?{Recorder:recorderFor(family)}:{})});
      try {
        let blob,options={filename:'widget-whitebox-qa-'+(family||'png')};
        if(!family) {blob=await capture.screenshot({time:.5});status.textContent='真实 PNG：320 × 180 · t=0.5 s · '+blob.size+' 字节';}
        else {
          const result=await capture.record({fps:20,duration:2,onProgress:info=>{status.textContent='真实录制 '+info.frame+'/'+info.frameCount+' 帧；请保持页面可见';}});
          blob=result.blob;options={...options,duration:result.requestedDuration,fps:result.fps};
          status.textContent=JSON.stringify({mime:result.mimeType,width:result.width,height:result.height,duration:result.duration,requestedDuration:result.requestedDuration,wallDuration:result.wallDuration,fps:result.fps,frameCount:result.frameCount,bytes:blob.size});
        }
        status.textContent+='\n请点击宿主“下载素材”，保存后点击“拒绝”解除本次交接。';
        await window.tapnow.uploadToCanvas(blob,options);
      } catch(error) {
        status.textContent+='\n交接返回：'+error.message;
      } finally {capture.dispose();busy=false;unlock();}
    };
    unlock();
  }
  return `<!doctype html><html lang="zh"><head><meta charset="utf-8"><style>body{margin:0;padding:16px;background:#161616;color:#eee;font:14px/20px system-ui}p{margin:0 0 12px}canvas{display:block;width:320px;height:180px;margin-bottom:12px}nav{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}button{padding:8px;font:14px/20px system-ui;cursor:pointer}pre{font:12px/18px monospace;white-space:pre-wrap;margin:0}</style></head><body><p>固定合成场景 · PNG / 原生视频捕获</p><canvas width="320" height="180" aria-label="移动橙色方块和固定蓝色柱体"></canvas><nav><button>捕获 PNG</button><button data-family="default">录制默认格式</button><button data-family="webm">录制 WebM 能力环境</button><button data-family="mp4">录制 MP4 能力环境</button></nav><p id="capabilities"></p><pre id="capture-status" role="status">PNG 在 t=0.5 秒捕获；视频为 2 秒、20 fps、40 帧。能力环境仅限制候选 MIME，编码仍为原生 MediaRecorder。</pre><script>(${runScene.toString()})();</script></body></html>`;
}
