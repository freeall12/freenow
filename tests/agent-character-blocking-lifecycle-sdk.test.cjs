const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {createRequire}=require('node:module'),fabricRequire=createRequire(require.resolve('fabric')),domRequire=createRequire(fabricRequire.resolve('jsdom')),canvasPath=domRequire.resolve('canvas'),previousCanvas=require.cache[canvasPath];require.cache[canvasPath]={id:canvasPath,loaded:true,exports:{createCanvas:undefined}};let JSDOM;try{({JSDOM}=fabricRequire('jsdom'));}finally{if(previousCanvas)require.cache[canvasPath]=previousCanvas;else delete require.cache[canvasPath];}
const tick=()=>new Promise(setImmediate),deferred=()=>{let resolve;const promise=new Promise(yes=>{resolve=yes;});return{promise,resolve};};
async function harness({saveGate,saveError}={}){
 const [{localizeCharacterBlockingInteractions},{prepareCharacterBlocking}]=await Promise.all([import('../src/features/agent-apps/character-blocking-local-interactions.mjs'),import('../src/features/agent-apps/character-blocking.mjs')]);
 const original=fs.readFileSync(require.resolve('../src/features/agent-apps/resources/apps/character-blocking@v3.f1fd0e23.html'),'utf8'),html=await localizeCharacterBlockingInteractions(original,'character-blocking','v3');
 const dom=new JSDOM('<body><div id="root"></div></body>',{url:'http://localhost:4173/',runScripts:'outside-only',pretendToBeVisual:true}),window=dom.window,messages=[],errors=[],registrations=[];let initialized=false,error=saveError;
 window.ResizeObserver=class{observe(){}disconnect(){}};window.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});window.console={debug(){},log(){},warn(...args){errors.push(args.join(' '));},error(...args){errors.push(args.join(' '));}};window.addEventListener('error',event=>errors.push(event.message));
 const nativeAdd=window.addEventListener.bind(window);window.addEventListener=(type,fn,...args)=>type==='message'?registrations.push(fn):nativeAdd(type,fn,...args);
 const parent={postMessage(data){messages.push(data);if(data.method==='ui/initialize')setImmediate(()=>emit({id:data.id,result:{protocolVersion:'2026-01-26',hostInfo:{name:'fixture',version:'1'},hostCapabilities:{message:{text:{}}},hostContext:{theme:'dark',locale:'zh-CN'}}}));if(data.method==='ui/notifications/initialized')initialized=true;if(data.method==='tapnow/setWidgetState')void Promise.resolve(saveGate).then(()=>emit({id:data.id,...error?{error:{code:-32000,message:error}}:{result:{}}}));}};
 Object.defineProperty(window,'parent',{value:parent});
 function emit(data){let stopped=false;const event={source:parent,data:{jsonrpc:'2.0',...data},stopImmediatePropagation(){stopped=true;}};for(const fn of registrations)if(!stopped)fn(event);}
 const script=html.match(/<script\b[^>]*>([\s\S]*?)<\/script>/)[1].replaceAll('import.meta.url','"http://localhost:4173/blocking-fixture.html"');vm.runInContext(script,dom.getInternalVMContext());
 for(let i=0;i<60&&!initialized;i++)await tick();assert.equal(initialized,true);
 emit({method:'ui/notifications/tool-result',params:{content:[],structuredContent:prepareCharacterBlocking({locale:'zh-CN',target:'image',aspect_ratio:'16:9',scene:'公开合成人物站位',characters:[{id:'lin',name:'林岚',x:300,y:350,facing:90},{id:'zhou',name:'周宁',x:750,y:700,facing:270}]})}});await tick();
 return{window,messages,errors,emit,setError:value=>{error=value;},close:()=>window.close(),replies:id=>messages.filter(row=>row.id===id),editX:value=>{const input=window.document.querySelector('input[data-axis="x"]');input.focus();input.value=String(value);input.dispatchEvent(new window.Event('input',{bubbles:true}));}};
}
test('the actual pinned Character SDK closes only after its final numerical edit receives a real state response',async()=>{
 const gate=deferred(),h=await harness({saveGate:gate.promise});try{
  h.editX(411);assert.equal(h.messages.find(row=>row.method==='freenow/lifecycleReady').params.version,1);
  h.emit({id:'local-close-blocking',method:'freenow/lifecycleFlush',params:{}});await tick();
  assert.equal(h.replies('local-close-blocking').length,0);assert.equal(h.window.document.getElementById('root').inert,true);
  assert.equal(h.messages.filter(row=>row.method==='tapnow/setWidgetState').length,1);assert.equal(h.messages.find(row=>row.method==='tapnow/setWidgetState').params.state.positions.lin.x,411);
  gate.resolve();await tick();await tick();assert.equal(h.replies('local-close-blocking').length,1);assert.equal(h.replies('local-close-blocking')[0].result.flushed,true);
  assert.equal(h.messages.some(row=>row.method==='ui/message'),false);assert.deepEqual(h.errors,[]);
 }finally{gate.resolve();h.close();}
});
test('the actual SDK reports close-save failure and retries the same unsaved position without a false close receipt',async()=>{
 const h=await harness({saveError:'transaction failed'});try{
  h.editX(422);h.emit({id:'local-close-blocking-failed',method:'freenow/lifecycleFlush',params:{}});await tick();await tick();
  assert.equal(h.replies('local-close-blocking-failed')[0].error.code,-32000);assert.equal(h.replies('local-close-blocking-failed')[0].result,undefined);assert.equal(h.window.document.getElementById('root').inert,false);
  assert.match(h.window.document.querySelector('.status').textContent,/transaction failed/);
  h.setError(null);h.emit({id:'local-close-blocking-retry',method:'freenow/lifecycleFlush',params:{}});await tick();await tick();
  assert.equal(h.replies('local-close-blocking-retry')[0].result.flushed,true);assert.equal(h.messages.filter(row=>row.method==='tapnow/setWidgetState').at(-1).params.state.positions.lin.x,422);
  assert.equal(h.messages.some(row=>row.method==='ui/message'),false);assert.deepEqual(h.errors,[]);
 }finally{h.close();}
});
