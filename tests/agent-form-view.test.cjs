const test=require('node:test'),assert=require('node:assert/strict');
const {createRequire}=require('node:module'),fabricRequire=createRequire(require.resolve('fabric')),domRequire=createRequire(fabricRequire.resolve('jsdom'));
const canvasPath=domRequire.resolve('canvas'),previousCanvas=require.cache[canvasPath];require.cache[canvasPath]={id:canvasPath,loaded:true,exports:{createCanvas:undefined}};
const {JSDOM}=fabricRequire('jsdom');if(previousCanvas)require.cache[canvasPath]=previousCanvas;else delete require.cache[canvasPath];
const form={title:'创作参数',fields:[{id:'brief',type:'text',label:'描述',required:true}]};
async function fixture(options={}){
 const dom=new JSDOM('<body></body>',{url:'http://localhost:4173/'}),prior={},keys=['window','document','crypto','CSS','localStorage'];for(const key of keys){prior[key]=Object.getOwnPropertyDescriptor(globalThis,key);Object.defineProperty(globalThis,key,{configurable:true,writable:true,value:key==='crypto'?require('node:crypto').webcrypto:key==='CSS'?{escape:value=>value}:dom.window[key]});}
 const {createFormCard}=await import('../src/features/agent-forms/view.mjs'),trace={id:'trace',callId:'form',name:'show_form',status:'done',args:form,result:{form,awaiting_submission:true},formDraft:{brief:'保留草稿'}};
 const card=createFormCard({trace,...options});dom.window.document.body.append(card.element);return {trace,card,dom,close(){card.destroy();dom.window.close();for(const key of keys)if(prior[key])Object.defineProperty(globalThis,key,prior[key]);else delete globalThis[key];}};
}
test('prepared completed form restores editable draft and only publishes submission after acceptance',async()=>{
 const calls=[];let accept=false;const f=await fixture({onSubmit:async(...args)=>{calls.push(args);return accept;}});try{
  assert.equal(f.card.element.querySelector('input').value,'保留草稿');assert.equal(f.card.element.querySelector('fieldset').disabled,false);assert.equal(f.card.element.querySelector('.agent-form-status'),null);
  assert.equal(await f.card.submit(),false);assert.match(f.card.element.querySelector('.agent-form-error').textContent,/未能提交/);assert.equal(f.card.element.querySelector('.agent-form-status'),null);
  accept=true;assert.equal(await f.card.submit(),true);assert.equal(calls[0][2].submissionId,calls[1][2].submissionId);assert.equal(f.card.element.querySelector('.agent-form-status').textContent.trim(),'已提交');assert.equal(f.trace.result.values,undefined);
 }finally{f.close();}
});
test('failed answer to skip gets a new identity, double clicks are blocked, and summary edit creates a revision',async()=>{
 const calls=[];let resolve;const f=await fixture({onEdit:()=>true,onSubmit:(...args)=>{calls.push(args);return new Promise(r=>resolve=r);}});try{
  const first=f.card.submit();assert.equal(await f.card.submit(),false);assert.equal(calls.length,1);resolve(false);await first;
  const skipped=f.card.skip();assert.notEqual(calls[0][2].submissionId,calls[1][2].submissionId);assert.equal(calls[1][1].skipped,true);resolve(true);await skipped;
  f.card.element.querySelector('.agent-form-edit').click();await Promise.resolve();const revised=f.card.submit();assert.equal(calls.length,3);assert.notEqual(calls[2][2].submissionId,calls[1][2].submissionId);resolve(true);await revised;
 }finally{f.close();}
});
test('busy runs disable a prepared form, and refresh preserves it but cancellation never becomes an answer',async()=>{
 let busy=true,calls=0;const f=await fixture({isBusy:()=>busy,onSubmit:()=>{calls++;return true;}});try{
  assert.equal(await f.card.submit(),false);busy=false;f.card.update(f.trace);assert.equal(f.card.element.querySelector('fieldset').disabled,false);
  f.trace.status='cancelled';f.trace.result={error:'已停止'};f.card.update(f.trace);assert.equal(await f.card.submit(),false);assert.equal(calls,0);assert.equal(f.card.element.querySelector('.agent-form-error').textContent,'已停止');
 }finally{f.close();}
});
