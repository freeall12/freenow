'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../agent-client.js'),'utf8'),start=source.indexOf("   if(a.kind==='audio.generate'&&window.AudioAPI?.buildRequest){"),end=source.indexOf('\n   const nodes=app.getState().nodes',start);
assert.ok(start>=0&&end>start,'production audio generation branch is present');
// Execute the exact production branch; only asynchronous preparation and the
// submission boundary are fakes. No network, real media or supplier is used.
function fixture(){
 const prepared={kind:'audio.generate',nodeId:'audio',inputs:[{type:'video',duration:8,url:'asset:synthetic'}],parameters:{model:'sonilo-music',scene:'Music',duration:8,count:2}},calls={build:0,submit:0};let release;
 const hold=new Promise(resolve=>release=resolve),args={kind:'audio.generate',nodeId:'audio',model:'sonilo',audioScene:'Music',referenceIds:['video'],count:2};
 const context={DOMException,window:{AudioAPI:{buildRequest:async(nodeId,a)=>{calls.build++;assert.equal(nodeId,args.nodeId);assert.equal(a,args);return hold;}},GenerationAPI:{submit:request=>{calls.submit++;assert.equal(request,prepared);return {id:'synthetic-original-task',status:'queued'};}}}};
 vm.createContext(context);vm.runInContext('globalThis.executeAudio=async(a,{signal}={})=>{'+source.slice(start,end)+'};',context);
 return {run:signal=>context.executeAudio(args,{signal}),calls,release:()=>release(prepared)};
}
test('production Agent audio branch stops before preparation or after an abort during preparation, with zero submissions',async()=>{
 for(const mode of ['before','during','active','without-signal']){
  const f=fixture(),controller=new AbortController();if(mode==='before')controller.abort();
  const pending=f.run(mode==='without-signal'?undefined:controller.signal);
  if(mode==='during'){assert.equal(f.calls.build,1);assert.equal(f.calls.submit,0);controller.abort();}
  f.release();
  if(mode==='before'||mode==='during'){await assert.rejects(pending,error=>error.name==='AbortError'&&error.message==='生成已取消');assert.equal(f.calls.build,mode==='before'?0:1);assert.equal(f.calls.submit,0);}
  else{const result=await pending;assert.equal(result.taskId,'synthetic-original-task');assert.equal(result.status,'queued');assert.deepEqual(f.calls,{build:1,submit:1});}
 }
});
