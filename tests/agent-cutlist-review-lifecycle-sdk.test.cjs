const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {createRequire}=require('node:module'),fabricRequire=createRequire(require.resolve('fabric')),domRequire=createRequire(fabricRequire.resolve('jsdom')),canvasPath=domRequire.resolve('canvas'),previousCanvas=require.cache[canvasPath];require.cache[canvasPath]={id:canvasPath,loaded:true,exports:{createCanvas:undefined}};let JSDOM;try{({JSDOM}=fabricRequire('jsdom'));}finally{if(previousCanvas)require.cache[canvasPath]=previousCanvas;else delete require.cache[canvasPath];}
const tick=()=>new Promise(setImmediate),settle=async()=>{for(let i=0;i<8;i++)await tick();},deferred=()=>{let resolve;const promise=new Promise(yes=>{resolve=yes;});return{promise,resolve};};
async function harness({saveGate,saveError}={}){
 const [{localizeCutlistReviewInteractions},{prepareCutlistReview}]=await Promise.all([import('../src/features/agent-apps/cutlist-review-local-interactions.mjs'),import('../src/features/agent-apps/cutlist-review.mjs')]);
 const original=fs.readFileSync(require.resolve('../src/features/agent-apps/resources/apps/cutlist-review@v1.a3b10365.html'),'utf8'),html=await localizeCutlistReviewInteractions(original,'cutlist-review','v1');
 const dom=new JSDOM('<body><div id="root"></div></body>',{url:'http://localhost:4173/',runScripts:'outside-only',pretendToBeVisual:true}),window=dom.window,messages=[],errors=[],registrations=[];let initialized=false,error=saveError,gate=saveGate;
 window.ResizeObserver=class{observe(){}disconnect(){}};window.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});window.console={debug(){},log(){},warn(...args){errors.push(args.join(' '));},error(...args){errors.push(args.join(' '));}};window.addEventListener('error',event=>errors.push(event.message));
 // Preserve actual Window registration order so the SDK cannot hide a late
 // lifecycle listener behind JSDOM's capture-phase ordering.
 const nativeAdd=window.addEventListener.bind(window);window.addEventListener=(type,fn,...args)=>type==='message'?registrations.push(fn):nativeAdd(type,fn,...args);
 const parent={postMessage(data){messages.push(data);if(data.method==='ui/initialize')setImmediate(()=>emit({id:data.id,result:{protocolVersion:'2026-01-26',hostInfo:{name:'fixture',version:'1'},hostCapabilities:{message:{text:{}}},hostContext:{theme:'dark',locale:'zh-CN'}}}));if(data.method==='ui/notifications/initialized')initialized=true;if(data.method==='tapnow/setWidgetState')void Promise.resolve(gate).then(()=>emit({id:data.id,...error?{error:{code:-32000,message:error}}:{result:{}}}));if(data.method==='ui/message')setImmediate(()=>emit({id:data.id,result:{}}));}};
 Object.defineProperty(window,'parent',{value:parent});
 function emit(data){let stopped=false;const event={source:parent,data:{jsonrpc:'2.0',...data},stopImmediatePropagation(){stopped=true;}};for(const fn of registrations)if(!stopped)fn(event);}
 const script=html.match(/<script\b[^>]*>([\s\S]*?)<\/script>/)[1].replaceAll('import.meta.url','"http://localhost:4173/cutlist-fixture.html"');vm.runInContext(script,dom.getInternalVMContext());
 for(let i=0;i<60&&!initialized;i++)await tick();assert.equal(initialized,true);
 emit({method:'ui/notifications/tool-result',params:{content:[],structuredContent:prepareCutlistReview({locale:'zh-CN',target_duration_s:6,shots:[{id:'qa-a',label:'前段',media_duration_ms:8000,in_ms:0,out_ms:3000,default_keep:true},{id:'qa-b',label:'后段',media_duration_ms:8000,in_ms:4000,out_ms:7000,default_keep:true}]})}});await tick();
 return{window,messages,errors,emit,setError:value=>{error=value;},setGate:value=>{gate=value;},close:()=>window.close(),replies:id=>messages.filter(row=>row.id===id),saves:()=>messages.filter(row=>row.method==='tapnow/setWidgetState'),sends:()=>messages.filter(row=>row.method==='ui/message'),button:selector=>window.document.querySelector(selector),click:selector=>window.document.querySelector(selector).click()};
}
test('the actual pinned Cutlist SDK commits immediate trim/drop edits before its exact CR1 confirmation',async()=>{
 const gate=deferred(),h=await harness({saveGate:gate.promise});try{
  h.click('.card:nth-child(1) .trim-group:nth-child(2) .step');h.click('.card:nth-child(2) .keep-toggle');const submit=h.button('.submit');submit.focus();submit.click();await settle();
  assert.equal(h.window.document.getElementById('root').inert,true);assert.equal(h.sends().length,0);assert.equal(h.saves().length,1);
  gate.resolve();await settle();assert.equal(h.sends().length,1);assert.equal(h.saves().at(-1).params.state.shots['qa-a'].out_ms,2900);assert.equal(h.saves().at(-1).params.state.shots['qa-b'].keep,false);
  assert.equal(h.sends()[0].params.content[0].text,'确认拼装计划：保留 1/2 段，总时长 2.9s（目标 6s） — CR1 v=1;keep=qa-a:0-2900;drop=qa-b;confirm=1');assert.equal(h.window.document.getElementById('root').inert,false);assert.equal(h.window.document.activeElement,submit);assert.deepEqual(h.errors,[]);
 }finally{gate.resolve();h.close();}
});
test('the actual Cutlist SDK closes only after the last edit receives its state response and restores it on reopen',async()=>{
 const gate=deferred(),h=await harness({saveGate:gate.promise});try{
  h.click('.card:nth-child(1) .trim-group:nth-child(1) .step:last-child');h.emit({id:'local-close-cutlist-final',method:'freenow/lifecycleFlush',params:{}});await settle();
  assert.equal(h.messages.find(row=>row.method==='freenow/lifecycleReady').params.version,1);assert.equal(h.replies('local-close-cutlist-final').length,0);assert.equal(h.window.document.getElementById('root').inert,true);assert.equal(h.saves().length,1);assert.equal(h.saves()[0].params.state.shots['qa-a'].in_ms,100);
  gate.resolve();await settle();assert.equal(h.replies('local-close-cutlist-final').length,1);assert.equal(h.replies('local-close-cutlist-final')[0].result.flushed,true);assert.equal(h.sends().length,0);
  h.emit({method:'freenow/lifecycleResume',params:{id:'local-close-cutlist-final'}});assert.equal(h.window.document.getElementById('root').inert,false);
  const response=JSON.parse(JSON.stringify(h.saves().at(-1).params.state));h.emit({method:'ui/notifications/tool-result',params:{content:[],structuredContent:{title:'重开',locale:'zh-CN',target_duration_s:6,shots:[{id:'qa-a',label:'前段',media_duration_ms:8000,in_ms:0,out_ms:3000,default_keep:true},{id:'qa-b',label:'后段',media_duration_ms:8000,in_ms:4000,out_ms:7000,default_keep:true}]},_meta:{'tapnow/widgetState':response}}});await tick();assert.equal(h.button('.card:nth-child(1) .trim-group:nth-child(1) .trim-value').textContent,'0.1s');assert.deepEqual(h.errors,[]);
 }finally{gate.resolve();h.close();}
});
test('actual SDK save failure preserves the Cutlist draft for confirmation/close retry and revise commits its reset first',async()=>{
 const h=await harness({saveError:'transaction failed'});try{
  h.click('.card:nth-child(1) .trim-group:nth-child(2) .step');h.click('.submit');await settle();assert.equal(h.sends().length,0);assert.equal(h.window.document.getElementById('root').inert,false);assert.match(h.button('.status').textContent,/transaction failed/);assert.equal(h.button('.card:nth-child(1) .trim-group:nth-child(2) .trim-value').textContent,'2.9s');
  h.emit({id:'local-close-cutlist-failed',method:'freenow/lifecycleFlush',params:{}});await settle();assert.equal(h.replies('local-close-cutlist-failed')[0].error.code,-32000);assert.equal(h.replies('local-close-cutlist-failed')[0].result,undefined);assert.equal(h.window.document.getElementById('root').inert,false);
  h.setError(null);h.click('.submit');await settle();assert.equal(h.sends().length,1);assert.match(h.sends()[0].params.content[0].text,/qa-a:0-2900/);
  h.click('.card:nth-child(2) .keep-toggle');await settle();const gate=deferred();h.setGate(gate.promise);h.click('.revise');await settle();assert.equal(h.sends().length,1);assert.equal(h.window.document.getElementById('root').inert,true);assert.equal(h.saves().at(-1).params.state.shots['qa-a'].out_ms,3000);assert.equal(h.saves().at(-1).params.state.shots['qa-b'].keep,true);
  gate.resolve();await settle();assert.equal(h.sends().length,2);assert.equal(h.sends()[1].params.content[0].text,'这版拼装计划再改改，我们回对话里继续调整。');assert.equal(h.window.document.getElementById('root').inert,false);
  h.emit({id:'local-close-cutlist-retry',method:'freenow/lifecycleFlush',params:{}});await settle();assert.equal(h.replies('local-close-cutlist-retry')[0].result.flushed,true);assert.equal(h.sends().length,2);assert.deepEqual(h.errors,[]);
 }finally{h.close();}
});
