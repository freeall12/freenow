(function(root){
 'use strict';
 const formats=['audio/webm;codecs=opus','audio/webm','audio/mp4','audio/mpeg','audio/wav'];
 const fail=(message,code)=>Object.assign(new Error(message),{code});
 function insertText({initialValue,start,end},current,text){if(current!==initialValue)return {committed:false,text};return {committed:true,value:initialValue.slice(0,start)+text+initialValue.slice(end),caret:start+text.length};}
 class Recorder {
  constructor({getStream,MediaRecorder:RecorderClass,AudioContext:ContextClass,onState=()=>{},onError=()=>{},maxBytes=25*1024*1024,now=()=>performance.now()}={}){
   this.getStream=getStream||(()=>navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:false}));this.RecorderClass=RecorderClass||root.MediaRecorder;this.ContextClass=ContextClass||root.AudioContext;this.onState=onState;this.onError=onError;this.maxBytes=maxBytes;this.now=now;this.epoch=0;this.state='idle';this.parts=[];
  }
  setState(state){this.state=state;this.onState(state);}
  async start(){
   if(this.state!=='idle')throw fail('已有录音正在进行','busy');if(!this.RecorderClass)throw fail('当前浏览器不支持语音输入','unsupported');
   const type=formats.find(t=>this.RecorderClass.isTypeSupported(t));if(!type)throw fail('当前浏览器不支持音频录制格式','unsupported');
   const epoch=++this.epoch;this.setState('preparing');
   try{const stream=await this.getStream();if(epoch!==this.epoch){stream.getTracks().forEach(t=>t.stop());return false;}this.stream=stream;this.parts=[];this.bytes=0;
    if(this.ContextClass){this.context=new this.ContextClass();this.analyser=this.context.createAnalyser();this.analyser.fftSize=256;this.source=this.context.createMediaStreamSource(stream);this.source.connect(this.analyser);await this.context.resume();if(epoch!==this.epoch)return false;}
    const recorder=new this.RecorderClass(stream,{mimeType:type});this.recorder=recorder;
    recorder.ondataavailable=e=>{if(epoch!==this.epoch||!e.data.size)return;this.bytes+=e.data.size;if(this.bytes>this.maxBytes){this.cancel();this.onError(fail('录音超过25MB，请缩短后重试','too_large'));return;}this.parts.push(e.data);};
    recorder.onerror=()=>{this.cancel();this.onError(fail('音频录制失败，请重试','recording_failed'));};
    this.started=this.now();recorder.start(250);this.setState('recording');return true;
   }catch(error){if(epoch!==this.epoch)return false;this.release();this.setState('idle');throw error;}
  }
  stop(){
   if(this.stopping)return this.stopping;
   if(this.state!=='recording')return Promise.reject(fail('当前没有进行中的录音','not_recording'));
   const epoch=this.epoch,recorder=this.recorder;this.setState('stopping');
   this.stopping=new Promise((resolve,reject)=>{this.rejectStop=reject;recorder.onstop=()=>{if(epoch!==this.epoch)return;const durationMs=Math.max(0,this.now()-this.started),blob=new Blob(this.parts,{type:recorder.mimeType});this.parts=[];this.release();this.stopping=null;this.rejectStop=null;this.setState('idle');if(!blob.size)reject(fail('录音为空，请重新录制','empty'));else resolve({blob,durationMs});};try{recorder.stop();}catch(e){this.release();this.stopping=null;this.rejectStop=null;this.setState('idle');reject(e);}});return this.stopping;
  }
  cancel(){++this.epoch;const recorder=this.recorder;if(recorder){recorder.ondataavailable=null;recorder.onstop=null;recorder.onerror=null;if(recorder.state!=='inactive')recorder.stop();}this.rejectStop?.(new DOMException('已取消','AbortError'));this.rejectStop=null;this.stopping=null;this.parts=[];this.release();this.setState('idle');}
  release(){this.stream?.getTracks().forEach(t=>t.stop());this.stream=null;this.source?.disconnect();this.source=null;this.analyser=null;this.context?.close().catch(()=>{});this.context=null;this.recorder=null;}
 }
 async function transcribe(provider,blob,{signal,timeoutMs=60000}={}){
  if(!blob?.size)throw fail('录音为空','empty');if(signal?.aborted)throw signal.reason||new DOMException('已取消','AbortError');const abort=new AbortController();let timer;
  const cancelled=new Promise((_,reject)=>{abort.signal.addEventListener('abort',()=>reject(abort.signal.reason||new DOMException('已取消','AbortError')),{once:true});});
  const cancel=()=>abort.abort(signal.reason||new DOMException('已取消','AbortError'));if(signal?.aborted)cancel();else signal?.addEventListener('abort',cancel,{once:true});timer=setTimeout(()=>abort.abort(fail('语音处理超时，请重试','timeout')),timeoutMs);
  try{if(abort.signal.aborted)throw abort.signal.reason;const result=await Promise.race([provider.transcribe(blob,{signal:abort.signal}),cancelled]);if(abort.signal.aborted)throw abort.signal.reason;if(typeof result?.text!=='string'||!result.text.trim())throw fail('未识别到有效文字，请重试','empty_text');return result.text;}finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);}
 }
 function httpProvider({url='/api/voice/transcribe',fetcher=root.fetch?.bind(root)}={}){return {async transcribe(blob,{signal}={}){const response=await fetcher(url,{method:'POST',headers:{'Content-Type':blob.type||'audio/webm'},body:blob,signal});let data;try{data=await response.json();}catch{throw fail('语音服务返回格式无效','invalid_response');}if(!response.ok)throw fail(data.error||'语音处理失败',data.code||'provider_error');return data;}};}
 const api={Recorder,insertText,transcribe,httpProvider,formats};if(typeof module!=='undefined')module.exports=api;else root.VoiceCore=api;
})(typeof window!=='undefined'?window:globalThis);
