const test=require('node:test'),assert=require('node:assert/strict'),{createRequire}=require('node:module');
const fr=createRequire(require.resolve('fabric')),dr=createRequire(fr.resolve('jsdom')),canvas=dr.resolve('canvas'),prior=require.cache[canvas];require.cache[canvas]={exports:{createCanvas:undefined}};const {JSDOM}=fr('jsdom');if(prior)require.cache[canvas]=prior;else delete require.cache[canvas];
const request={requestId:'frame-1',filename:'whitebox.webm',mimeType:'video/webm',size:2048};
const trusted={isTrusted:true};
async function fixture(options={}){const dom=new JSDOM('<head></head><body></body>',{url:'https://local.test/'}),{createMediaHandoffView}=await import('../src/features/agent-widgets/media-handoff-view.mjs');const card=createMediaHandoffView({request,document:dom.window.document,...options});dom.window.document.body.append(card.element);return {dom,card,button:label=>[...card.element.querySelectorAll('button')].find(b=>b.textContent===label),close(){card.destroy();dom.window.close();}};}

test('handoff requires a current host gesture and downloads independently of adding',async()=>{
 let confirms=0,downloads=0,current=true;
 const f=await fixture({isCurrent:()=>current,onConfirm:async()=>{confirms++;},onReject:async()=>{},onDownload:async value=>{assert.equal(value,request);downloads++;}});
 try{
  f.button('添加到画布').click();assert.equal(confirms,0);
  await f.button('下载素材').onclick(trusted);assert.equal(downloads,1);assert.equal(confirms,0);assert.match(f.card.element.textContent,/确认后将此素材添加/);assert.doesNotMatch(f.card.element.textContent,/已添加到画布/);
  current=false;await f.button('添加到画布').onclick(trusted);assert.equal(confirms,0);
  current=true;await f.button('添加到画布').onclick(trusted);assert.equal(confirms,1);assert.match(f.card.element.textContent,/等待实际操作回执/);
  assert.equal(f.dom.window.document.querySelectorAll('link[data-widget-media-handoff]').length,1);
 }finally{f.close();}
});

test('save failure preserves the applied receipt and retry only saves with stable controls',async()=>{
 let confirmations=0,retries=0;
 const failed={operationId:'host-1',status:'save_failed',applied:true,saved:false,nodeIds:['node-1'],width:640,height:360,duration:2,error:'磁盘已满'};
 const f=await fixture({onConfirm:async()=>{confirmations++;throw Object.assign(Error('磁盘已满'),{receipt:failed});},onReject:async()=>{},onRetrySave:async()=>{retries++;return {...failed,status:'succeeded',saved:true,error:undefined};}});
 try{
  await f.button('添加到画布').onclick(trusted);assert.match(f.card.element.textContent,/已添加到画布，保存失败/);assert.match(f.card.element.textContent,/实际尺寸：640 × 360/);assert.match(f.card.element.textContent,/结果节点：node-1/);
  const retry=f.button('重试保存');retry.focus();f.card.update(failed);assert.equal(f.dom.window.document.activeElement,retry);assert.equal(retry.hidden,false);
  await retry.onclick(trusted);assert.equal(confirmations,1);assert.equal(retries,1);assert.match(f.card.element.textContent,/已添加到画布并保存/);assert.equal(f.card.element.querySelector('.execution-error').textContent,'');assert.equal(retry.hidden,true);
 }finally{f.close();}
});

test('duplicate gestures and late suspended callbacks cannot approve twice or overwrite state',async()=>{
 let resolve,calls=0;const f=await fixture({onConfirm:()=>{calls++;return new Promise(done=>{resolve=done;});},onReject:async()=>{}});
 try{
  const first=f.button('添加到画布').onclick(trusted);await f.button('添加到画布').onclick(trusted);assert.equal(calls,1);
  f.card.update({status:'processing'});assert.match(f.card.element.textContent,/正在处理素材/);f.card.suspend();
  resolve({status:'succeeded',applied:true,saved:true,nodeIds:['late']});await first;assert.doesNotMatch(f.card.element.textContent,/已添加到画布并保存/);
  f.card.resume();f.card.update({status:'cancelled'});assert.match(f.card.element.textContent,/已取消添加/);assert.equal(f.button('添加到画布').hidden,true);
 }finally{f.close();}
});

test('failure before application allows another explicit confirmation and destroy never rejects twice',async()=>{
 let calls=0,rejects=0;const f=await fixture({onConfirm:async()=>{calls++;if(calls===1)throw Error('解码失败');return {status:'succeeded',saved:true,applied:true,nodeIds:['node-2']};},onReject:async()=>{rejects++;}});
 try{
  await f.button('添加到画布').onclick(trusted);assert.match(f.card.element.textContent,/解码失败/);const retry=f.button('重试添加');assert.equal(retry.hidden,false);assert.equal(retry.disabled,false);
  await retry.onclick(trusted);assert.equal(calls,2);assert.match(f.card.element.textContent,/已添加到画布并保存/);f.card.destroy();assert.equal(rejects,0);
 }finally{f.close();}
});
