const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const original=fs.readFileSync(require.resolve('../src/features/agent-apps/resources/apps/cutlist-review@v1.a3b10365.html'),'utf8'),modulePromise=import('../src/features/agent-apps/cutlist-review-local-interactions.mjs');
const tick=()=>new Promise(setImmediate),deferred=()=>{let resolve;const promise=new Promise(yes=>{resolve=yes;});return{promise,resolve};};
async function harness(request=async()=>{}){
 const html=await(await modulePromise).localizeCutlistReviewInteractions(original,'cutlist-review','v1'),ie={locale:'zh-CN',target_duration_s:6,shots:[{id:'qa-a',label:'前段',media_duration_ms:8000,in_ms:0,out_ms:3000,default_keep:true},{id:'qa-b',label:'后段',media_duration_ms:8000,in_ms:4000,out_ms:7000,default_keep:true}]},saved=[],messages=[],handlers=new Map(),focused={isConnected:true,count:0,focus(){this.count++;}};
 const context={JSON,Promise,setTimeout,clearTimeout,ie,$e:{},Be:false,ct:{textContent:''},document:{activeElement:focused},navigator:{userActivation:{isActive:true}},b_:{inert:false,contains:()=>true,addEventListener:(type,fn)=>handlers.set(type,fn)},window:{addEventListener:(type,fn)=>handlers.set('window-'+type,fn)},B:()=>({}),Oe(){},Pt:{request:async value=>{saved.push(value.params.state);await request(value.params.state);},sendMessage:async value=>{messages.push(value);}}};
 vm.createContext(context);vm.runInContext(original.slice(original.indexOf('const It=100'),original.indexOf(',b_=document'))+';globalThis.F=_i[ie.locale];',context);
 vm.runInContext(html.slice(html.indexOf('function He()'),html.indexOf('const cutlistLocalCopy='))+html.slice(html.indexOf('const cutlistLocalCopy='),html.indexOf('function Ke('))+html.slice(html.indexOf('function Ke('),html.indexOf('function Z('))+html.slice(html.indexOf('function Cs()'),html.indexOf('function zm()'))+html.slice(html.indexOf('b_.addEventListener("click"'),html.indexOf(';(function(){let pending='))+';Cs();',context);
 return{context,html,saved,messages,handlers,run:code=>vm.runInContext(code,context)};
}
test('only the pinned installed v1 receives a parseable repair and other resources remain untouched',async()=>{
 const{localizeCutlistReviewInteractions,cutlistReviewReferenceSha256}=await modulePromise;
 assert.equal(require('node:crypto').createHash('sha256').update(original).digest('hex'),cutlistReviewReferenceSha256);
 await assert.rejects(localizeCutlistReviewInteractions(original+' ','cutlist-review','v1'),/integrity mismatch/);await assert.rejects(localizeCutlistReviewInteractions(original,'cutlist-review','v2'),/unsupported/);
 assert.equal(await localizeCutlistReviewInteractions('other','ad-review','v1'),'other');const{html}=await harness();require('esbuild').transformSync(html.match(/<script\b[^>]*>([\s\S]*?)<\/script>/)[1],{loader:'js',format:'esm'});
});
test('immediate confirmation waits for its fixed-order trim/drop snapshot and restores the initiating focus',async()=>{
 const gate=deferred(),h=await harness(()=>gate.promise);h.context.$e['qa-a'].outMs=2900;h.context.$e['qa-b'].keep=false;
 const pending=h.run('cutlistSubmit()');await h.run('cutlistSubmit()');await tick();assert.equal(h.context.Be,true);assert.equal(h.context.b_.inert,true);assert.equal(h.messages.length,0);
 gate.resolve();await pending;assert.equal(h.saved.length,1);assert.equal(h.messages.length,1);assert.equal(h.messages[0].content[0].text,'确认拼装计划：保留 1/2 段，总时长 2.9s（目标 6s） — CR1 v=1;keep=qa-a:0-2900;drop=qa-b;confirm=1');
 assert.deepEqual(Object.keys(h.saved[0].shots),['qa-a','qa-b']);assert.equal(h.saved[0].shots['qa-b'].keep,false);assert.equal(h.context.b_.inert,false);assert.equal(h.context.document.activeElement.count,1);
});
test('failed persistence never sends and the exact edited plan can retry on the same page',async()=>{
 let fail=true;const h=await harness(()=>{if(fail)throw Error('事务未提交');});h.context.$e['qa-a'].inMs=100;
 await h.run('cutlistSubmit()');assert.equal(h.messages.length,0);assert.match(h.context.ct.textContent,/事务未提交/);assert.equal(h.context.Be,false);
 fail=false;await h.run('cutlistSubmit()');assert.equal(h.saved.length,2);assert.equal(h.messages.length,1);assert.match(h.messages[0].content[0].text,/qa-a:100-3000/);
});
test('revise actually restores suggestions, commits them and then sends only its exact original message',async()=>{
 const gate=deferred(),h=await harness(()=>gate.promise);h.context.$e['qa-a'].inMs=100;h.context.$e['qa-b'].keep=false;
 const pending=h.run('cutlistSubmit(true)');await tick();assert.equal(h.messages.length,0);assert.equal(h.saved[0].shots['qa-a'].in_ms,0);assert.equal(h.saved[0].shots['qa-b'].keep,true);
 gate.resolve();await pending;assert.equal(h.messages[0].content[0].text,'这版拼装计划再改改，我们回对话里继续调整。');assert.ok(!h.messages[0].content[0].text.includes('CR1'));
});
test('a completed original edit flushes before its debounce and same successful state avoids a second slow transaction',async()=>{
 const gate=deferred(),h=await harness(()=>gate.promise);h.context.$e['qa-a'].outMs=2800;h.run('Qn()');h.handlers.get('click')();await tick();assert.equal(h.saved.length,1);
 h.context.navigator.userActivation.isActive=false;const pending=h.run('cutlistSubmit()');gate.resolve();await pending;assert.equal(h.messages.length,0);assert.match(h.context.ct.textContent,/已保存.*再次点击/);
 h.context.navigator.userActivation.isActive=true;await h.run('cutlistSubmit()');assert.equal(h.saved.length,1);assert.equal(h.messages.length,1);
});
test('invalid all-drop plans and in-flight source/plan changes or disposal cannot dispatch a stale CR1',async()=>{
 const invalid=await harness();invalid.context.$e['qa-a'].keep=false;invalid.context.$e['qa-b'].keep=false;await invalid.run('cutlistSubmit()');assert.equal(invalid.saved.length,0);assert.equal(invalid.messages.length,0);
 for(const mutate of[h=>{h.context.$e['qa-a'].outMs=2700;},h=>h.run('cutlistEpoch++'),h=>h.handlers.get('window-pagehide')()]){
  const gate=deferred(),h=await harness(()=>gate.promise),pending=h.run('cutlistSubmit()');await tick();mutate(h);gate.resolve();await pending;assert.equal(h.messages.length,0);assert.equal(h.context.b_.inert,false);
 }
});
