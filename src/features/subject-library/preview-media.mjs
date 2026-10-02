import {el} from './ui.mjs';

export function mediaView(asset,{hover=false}={}) {
  const root=el('div','subject-asset-media'),abort=new AbortController();
  root.dataset.type=asset.type;let disposed=false,media=null,context=null,frame=0;
  function release(){
    abort.abort();cancelAnimationFrame(frame);
    const audioContext=context;context=null;if(audioContext&&audioContext.state!=='closed')audioContext.close().catch(()=>{});
    if(media){media.onerror=null;media.onplay=null;media.onpause=null;if(media.tagName!=='IMG'){media.pause();media.removeAttribute('src');media.load();}}
  }
  function fail(){if(disposed)return;disposed=true;release();root.replaceChildren(el('span','subject-asset-error','素材无法加载'));}
  if(asset.type==='text')root.append(el('p','',asset.text?.trim()||asset.name||'—'));
  else {
    media=el(asset.type==='image'?'img':asset.type);media.ariaLabel=asset.name;
    if(asset.type==='image')media.alt=asset.name;
    else {media.controls=!hover;media.autoplay=true;media.loop=hover;media.preload='metadata';if(asset.type==='video'){media.playsInline=true;media.muted=hover;}}
    root.append(media);media.onerror=fail;
    (async()=>{
      const source=asset.url||asset.image;if(!source)throw Error('Missing source');
      const url=await (window.LocalAssets?.url(source)||source);if(disposed)return;media.src=url;
      if(asset.type==='audio'&&hover){
        const canvas=el('canvas');canvas.ariaLabel='音频预览波形';canvas.setAttribute('role','slider');canvas.tabIndex=0;canvas.ariaValueMin='0';root.append(canvas);
        const response=await fetch(url,{signal:abort.signal});if(!response.ok)throw Error('Audio unavailable');
        const bytes=await response.arrayBuffer();if(disposed)return;
        const decodingContext=new AudioContext();context=decodingContext;const buffer=await decodingContext.decodeAudioData(bytes);if(disposed)return;
        const samples=buffer.getChannelData(0),count=20;
        const peaks=Array.from({length:count},(_,i)=>{let peak=0;for(let j=Math.floor(i*buffer.length/count);j<Math.floor((i+1)*buffer.length/count);j++)peak=Math.max(peak,Math.abs(samples[j]));return peak;});
        await decodingContext.close();if(context===decodingContext)context=null;if(disposed)return;root.dataset.waveform='decoded';
        function draw(){
          if(disposed)return;const ratio=devicePixelRatio||1;canvas.width=260*ratio;canvas.height=100*ratio;
          const ctx=canvas.getContext('2d');ctx.scale(ratio,ratio);const progress=media.currentTime/buffer.duration;
          peaks.forEach((peak,i)=>{const h=Math.max(5,peak*100);ctx.fillStyle=i/count<progress?'#ffffff':'#ffffff40';ctx.beginPath();ctx.roundRect(i*13,(100-h)/2,8,h,4);ctx.fill();});
          ctx.fillStyle='#ffffff';ctx.fillRect(progress*260,0,1,100);canvas.ariaValueMax=String(buffer.duration);canvas.ariaValueNow=String(media.currentTime);
          if(!media.paused)frame=requestAnimationFrame(draw);
        }
        function seek(event){const rect=canvas.getBoundingClientRect();media.currentTime=Math.max(0,Math.min(buffer.duration,(event.clientX-rect.left)/rect.width*buffer.duration));cancelAnimationFrame(frame);draw();}
        canvas.onpointerdown=event=>{event.preventDefault();canvas.setPointerCapture(event.pointerId);seek(event);};
        canvas.onpointermove=event=>{if(canvas.hasPointerCapture(event.pointerId))seek(event);};
        canvas.onkeydown=event=>{if(['ArrowLeft','ArrowRight',' '].includes(event.key)){event.preventDefault();if(event.key===' ')media.paused?media.play().catch(()=>{}):media.pause();else media.currentTime=Math.max(0,Math.min(buffer.duration,media.currentTime+(event.key==='ArrowLeft'?-5:5)));cancelAnimationFrame(frame);draw();}};
        media.onplay=()=>{cancelAnimationFrame(frame);draw();};media.onpause=()=>{cancelAnimationFrame(frame);draw();};draw();
      }
      if(asset.type!=='image'&&!disposed)media.play().catch(()=>{});
    })().catch(fail);
  }
  return {element:root,destroy(){if(disposed)return;disposed=true;release();}};
}

