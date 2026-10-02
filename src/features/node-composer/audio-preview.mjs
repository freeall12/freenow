// Dq's small reference preview: decoded waveform, 3px bars, 2px gaps, no controls.
export function audioPreview(src) {
  const element = document.createElement('div'); element.className = 'composer-reference-audio';
  const canvas = document.createElement('canvas'), audio = document.createElement('audio');
  canvas.ariaLabel = '参考音频波形'; canvas.setAttribute('role','img'); audio.loop = true; element.append(canvas,audio);
  let context, disposed = false, peaks = [], frame = 0, visible = false;
  const abort = new AbortController();
  function draw() {
    if(disposed)return;
    const ratio=devicePixelRatio||1;canvas.width=76*ratio;canvas.height=76*ratio;
    const ctx=canvas.getContext('2d');ctx.scale(ratio,ratio);
    const progress=audio.duration ? audio.currentTime/audio.duration : 0;
    peaks.forEach((peak,i)=>{const h=Math.max(1,peak*76);ctx.fillStyle=i/peaks.length<progress?'oklch(0.7085 0.1622 246.0162 / .6)':'oklch(0.7085 0.1622 246.0162)';ctx.beginPath();ctx.roundRect(i*5,(76-h)/2,3,h,2);ctx.fill();});
    ctx.fillStyle='oklch(0.7085 0.1622 246.0162 / .8)';ctx.fillRect(progress*76,0,1,76);
    if(visible&&!audio.paused)frame=requestAnimationFrame(draw);
  }
  async function play() {try{await audio.play();element.dataset.playback='playing';cancelAnimationFrame(frame);draw();}catch{element.dataset.playback='paused';}}
  const ready=(async()=>{
    const url=await window.LocalAssets.url(src);if(disposed)return;audio.src=url;
    const response=await fetch(url,{signal:abort.signal});if(!response.ok)throw Error('音频加载失败');
    context=new AudioContext();const buffer=await context.decodeAudioData(await response.arrayBuffer());
    if(disposed)return;
    const channels=Array.from({length:buffer.numberOfChannels},(_,i)=>buffer.getChannelData(i));
    peaks=Array.from({length:15},(_,i)=>{const start=Math.floor(i*buffer.length/15),end=Math.floor((i+1)*buffer.length/15);let max=0;for(const samples of channels)for(let j=start;j<end;j++)max=Math.max(max,Math.abs(samples[j]));return max;});
    element.dataset.waveform='decoded';draw();await context.close();context=null;
    if(visible)await play();
  })().catch(()=>{if(!disposed)element.dataset.waveform='failed';});
  canvas.onpointerdown=event=>{event.preventDefault();if(Number.isFinite(audio.duration)){audio.currentTime=Math.max(0,Math.min(audio.duration,(event.clientX-canvas.getBoundingClientRect().left)/76*audio.duration));if(audio.paused)play();else{audio.pause();cancelAnimationFrame(frame);draw();}}};
  return {element, show(){visible=true;ready.then(()=>{if(visible&&!disposed)play();});},hide(){visible=false;audio.pause();cancelAnimationFrame(frame);},destroy(){disposed=true;visible=false;abort.abort();audio.pause();audio.removeAttribute('src');audio.load();cancelAnimationFrame(frame);context?.close().catch(()=>{});}};
}
