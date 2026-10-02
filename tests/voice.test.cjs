const test=require('node:test'),assert=require('node:assert/strict'),{Readable}=require('node:stream');
const {Recorder,insertText,transcribe,httpProvider}=require('../voice-core.js');
const {transcribeRequest}=require('../server/voice.cjs');
class FakeRecorder {
 static isTypeSupported(type){return type.startsWith('audio/webm');}
 constructor(stream,{mimeType}){this.mimeType=mimeType;this.state='inactive';}
 start(){this.state='recording';}
 stop(){this.state='inactive';queueMicrotask(()=>{this.ondataavailable?.({data:new Blob(['recorded bytes'],{type:this.mimeType})});this.onstop?.();});}
}
class FakeContext {createAnalyser(){return {fftSize:0};}createMediaStreamSource(){return {connect(){},disconnect(){}};}async resume(){}async close(){}}
function stream(){const track={stopped:false,stop(){this.stopped=true;}};return {getTracks:()=>[track],track};}
test('late microphone permission after cancel releases tracks and never starts recording',async()=>{
 let resolve;const states=[],s=stream(),r=new Recorder({getStream:()=>new Promise(done=>resolve=done),MediaRecorder:FakeRecorder,AudioContext:FakeContext,onState:s=>states.push(s)});const starting=r.start();r.cancel();resolve(s);assert.equal(await starting,false);assert.equal(s.track.stopped,true);assert.deepEqual(states,['preparing','idle']);
});
test('recording creates a real blob contract and releases input tracks at finish',async()=>{
 const s=stream();let now=0;const r=new Recorder({getStream:async()=>s,MediaRecorder:FakeRecorder,AudioContext:FakeContext,now:()=>now});await r.start();now=1800;const output=await r.stop();assert.equal(output.durationMs,1800);assert.equal(await output.blob.text(),'recorded bytes');assert.equal(s.track.stopped,true);assert.equal(r.state,'idle');
});
test('cancel while finalizing rejects the result without leaking tracks',async()=>{
 const s=stream(),r=new Recorder({getStream:async()=>s,MediaRecorder:FakeRecorder,AudioContext:FakeContext});await r.start();const stopping=r.stop();r.cancel();await assert.rejects(stopping,{name:'AbortError'});assert.equal(s.track.stopped,true);
});
test('transcription inserts at saved selection and refuses to overwrite edits',()=>{
 const snapshot={initialValue:'镜头从这里开始',start:3,end:5};assert.deepEqual(insertText(snapshot,'镜头从这里开始','空中'),{committed:true,value:'镜头从空中开始',caret:5});assert.deepEqual(insertText(snapshot,'用户修改后的提示词','空中'),{committed:false,text:'空中'});
});
test('transcription timeout and cancellation also stop providers that ignore abort',async()=>{
 const provider={transcribe:()=>new Promise(()=>{})},blob=new Blob(['audio']);await assert.rejects(transcribe(provider,blob,{timeoutMs:5}),/超时/);const abort=new AbortController(),pending=transcribe(provider,blob,{signal:abort.signal});abort.abort();await assert.rejects(pending,{name:'AbortError'});let calls=0;await assert.rejects(transcribe({transcribe:async()=>{calls++;return {text:'late'};}},blob,{signal:abort.signal}),{name:'AbortError'});assert.equal(calls,0);await assert.rejects(transcribe({transcribe:async()=>({text:'  '})},blob),/有效文字/);
});
test('HTTP voice adapter sends binary audio and reports missing configuration accurately',async()=>{
 const blob=new Blob(['audio'],{type:'audio/webm'});let posted;const provider=httpProvider({fetcher:async(url,init)=>{posted={url,...init};return {ok:false,json:async()=>({error:'配置缺失',code:'configuration_required'})};}});await assert.rejects(provider.transcribe(blob),e=>e.code==='configuration_required');assert.equal(posted.body,blob);assert.equal(posted.headers['Content-Type'],'audio/webm');
});
function request(bytes,type='audio/webm'){const r=Readable.from([Buffer.from(bytes)]);r.headers={'content-type':type};return r;}
test('server transcription uses configured SDK model and rejects bad bodies before calling provider',async()=>{
 let call;const client={audio:{transcriptions:{create:async(...args)=>{call=args;return {text:'已识别文本'};}}}},toFile=async(bytes,name,options)=>({bytes,name,...options}),options={client,model:'configured-transcription-model',toFile};
 assert.deepEqual(await transcribeRequest(request('audio'),options),{text:'已识别文本'});assert.equal(call[0].model,options.model);assert.equal(call[0].file.name,'voice.webm');assert.equal(call[0].file.bytes.toString(),'audio');call=null;
 await assert.rejects(transcribeRequest(request('audio','text/html'),options),/格式/);await assert.rejects(transcribeRequest(request(''),options),/为空/);await assert.rejects(transcribeRequest(request('audio'),{...options,maxBytes:2}),/25MB/);await assert.rejects(transcribeRequest(request('audio'),{...options,model:''}),e=>e.code==='configuration_required');assert.equal(call,null);
});
