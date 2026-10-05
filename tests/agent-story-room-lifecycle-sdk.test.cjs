const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {createRequire}=require('node:module'),fabricRequire=createRequire(require.resolve('fabric')),domRequire=createRequire(fabricRequire.resolve('jsdom')),canvasPath=domRequire.resolve('canvas'),previousCanvas=require.cache[canvasPath];require.cache[canvasPath]={id:canvasPath,loaded:true,exports:{createCanvas:undefined}};let JSDOM;try{({JSDOM}=fabricRequire('jsdom'));}finally{if(previousCanvas)require.cache[canvasPath]=previousCanvas;else delete require.cache[canvasPath];}
const tick=()=>new Promise(setImmediate),deferred=()=>{let resolve;const promise=new Promise(yes=>{resolve=yes;});return{promise,resolve};};
async function harness({lateBridge=false,saveGate,saveError}={}){
 const [{localizeStoryRoomInteractions},{localLifecycleScript}]=await Promise.all([import('../src/features/agent-apps/story-room-local-interactions.mjs'),import('../src/features/agent-apps/local-lifecycle.mjs')]);
 const original=fs.readFileSync(require.resolve('../src/features/agent-apps/resources/apps/story-room@v1.dae7d235.html'),'utf8');let html=await localizeStoryRoomInteractions(original,'story-room','v1');
 if(lateBridge){const bridge=localLifecycleScript({root:'j_',flush:'(An!==null&&(clearTimeout(An),An=null),P_())',busy:'ui'});assert.ok(html.includes(bridge+'R_();</script>'));html=html.replace(bridge+'R_();</script>','R_();'+bridge+'</script>');}
 const dom=new JSDOM('<body><div id="root"></div></body>',{url:'http://localhost:4173/',runScripts:'outside-only',pretendToBeVisual:true}),window=dom.window,messages=[],errors=[],registrations=[];let initialized=false;
 window.ResizeObserver=class{observe(){}disconnect(){}};window.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});window.console={debug(){},log(){},warn(...args){errors.push(args.join(' '));},error(...args){errors.push(args.join(' '));}};window.addEventListener('error',event=>errors.push(event.message));
 // Exercise strict registration order for Window target message delivery.
 // JSDOM's capture ordering alone had hidden the real Story startup race.
 const nativeAdd=window.addEventListener.bind(window);window.addEventListener=(type,fn,...args)=>type==='message'?registrations.push(fn):nativeAdd(type,fn,...args);
 const parent={postMessage(data){messages.push(data);if(data.method==='ui/initialize')setImmediate(()=>emit({id:data.id,result:{protocolVersion:'2026-01-26',hostInfo:{name:'fixture',version:'1'},hostCapabilities:{message:{text:{}}},hostContext:{theme:'dark',locale:'zh-CN'}}}));if(data.method==='ui/notifications/initialized')initialized=true;if(data.method==='tapnow/setWidgetState')void Promise.resolve(saveGate).then(()=>emit({id:data.id,...saveError?{error:{code:-32000,message:saveError}}:{result:{}}}));}};
 Object.defineProperty(window,'parent',{value:parent});
 function emit(data){let stopped=false;const event={source:parent,data:{jsonrpc:'2.0',...data},stopImmediatePropagation(){stopped=true;}};for(const fn of registrations)if(!stopped)fn(event);}
 // The captured bundle is a module. Only its unused dynamic JSON-schema URL is
 // replaced for this VM fixture; production/original bytes stay unmodified.
 const script=html.match(/<script\b[^>]*>([\s\S]*?)<\/script>/)[1].replaceAll('import.meta.url','"http://localhost:4173/story-fixture.html"');vm.runInContext(script,dom.getInternalVMContext());
 for(let i=0;i<60&&!initialized;i++)await tick();assert.equal(initialized,true);
 emit({method:'ui/notifications/tool-result',params:{content:[],structuredContent:{title:'故事',locale:'zh-CN',acts:[{id:'A1',label:'第一幕'},{id:'A2',label:'第二幕'}],scenes:[{key:'S1',act:'A1',name:'走廊',cast:[],has_body:true}],plotlines:[],causal_links:[]}}});await tick();
 return{messages,errors,emit,close:()=>dom.window.close(),replies:()=>messages.filter(row=>row.id==='local-close-sdk')};
}
test('exact Story SDK startup reproduces late-listener -32601 and early registration waits for its real state receipt',async()=>{
 const old=await harness({lateBridge:true});try{old.emit({id:'local-close-sdk',method:'freenow/lifecycleFlush',params:{}});await tick();assert.equal(old.replies()[0].error.code,-32601);assert.equal(old.replies()[0].error.message,'Method not found');}finally{old.close();}
 const gate=deferred(),current=await harness({saveGate:gate.promise});try{
  assert.equal(current.messages.find(row=>row.method==='freenow/lifecycleReady').params.version,1);current.emit({id:'local-close-sdk',method:'freenow/lifecycleFlush',params:{}});await tick();assert.equal(current.replies().length,0);assert.equal(current.messages.filter(row=>row.method==='tapnow/setWidgetState').length,1);assert.deepEqual(Array.from(current.messages.find(row=>row.method==='tapnow/setWidgetState').params.state.cols[0].keys),['S1']);
  gate.resolve();await tick();assert.equal(current.replies().length,1);assert.equal(current.replies()[0].result.flushed,true);assert.deepEqual(current.errors,[]);
 }finally{gate.resolve();current.close();}
});
test('exact Story SDK storage error remains visible and never becomes a successful close receipt',async()=>{
 const current=await harness({saveError:'transaction failed'});try{current.emit({id:'local-close-sdk',method:'freenow/lifecycleFlush',params:{}});await tick();assert.equal(current.replies().length,1);assert.equal(current.replies()[0].error.code,-32000);assert.match(current.replies()[0].error.message,/transaction failed/);assert.equal(current.replies()[0].result,undefined);assert.deepEqual(current.errors,[]);}finally{current.close();}
});
