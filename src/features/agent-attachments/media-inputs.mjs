// Default OpenAI adapter: actual images and sampled video frames, never filenames as vision.
const maxPayload=700000;
function waitFor(element,event,signal){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>finish(Error('附件解码超时')),15000);const failed=()=>finish(Error('附件无法解码'));const aborted=()=>finish(new DOMException('Aborted','AbortError'));const done=()=>finish();function finish(error){clearTimeout(timer);element.removeEventListener(event,done);element.removeEventListener('error',failed);signal?.removeEventListener('abort',aborted);error?reject(error):resolve();}element.addEventListener(event,done,{once:true});element.addEventListener('error',failed,{once:true});signal?.addEventListener('abort',aborted,{once:true});if(signal?.aborted)aborted();});}
function snapshot(media){const width=media.videoWidth||media.naturalWidth,height=media.videoHeight||media.naturalHeight;if(!width||!height)throw Error('附件没有可解码的画面');const ratio=Math.min(1,768/Math.max(width,height)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(width*ratio));canvas.height=Math.max(1,Math.round(height*ratio));const context=canvas.getContext('2d');context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(media,0,0,canvas.width,canvas.height);return canvas.toDataURL('image/jpeg',.72);}
export async function prepareMediaInputs(items,{signal,resolveUrl}){
  const output=[];let total=0;
  const add=(name,url,time)=>{total+=url.length;if(total>maxPayload||output.length>=12)throw Error('本轮附件画面过多，请减少附件后重试');output.push({name,imageUrl:url,...(time!==undefined?{time}:{})});};
  for(const item of items){if(signal?.aborted)throw new DOMException('Aborted','AbortError');const url=await resolveUrl(item.asset);if(!url)throw Error('附件已丢失：'+item.name);
    const media=document.createElement(item.type==='video'?'video':'img');media.crossOrigin='anonymous';
    try{if(item.type==='video'){media.preload='auto';media.muted=true;const loaded=waitFor(media,'loadeddata',signal);media.src=url;await loaded;if(!Number.isFinite(media.duration)||media.duration<=0)throw Error('无法读取视频时长');
      for(const time of [0,media.duration/2,Math.max(0,media.duration-.1)]){if(Math.abs(media.currentTime-time)>.001){const seek=waitFor(media,'seeked',signal);media.currentTime=time;await seek;}add(item.name,snapshot(media),time);}
    }else{const loaded=waitFor(media,'load',signal);media.src=url;await loaded;add(item.name,snapshot(media));}}
    catch(error){if(error.name==='AbortError')throw error;throw Error(item.name+'：'+error.message);}
    finally{media.removeAttribute('src');if(media.tagName==='VIDEO')media.load();}
  }return output;
}
