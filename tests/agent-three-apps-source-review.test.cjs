const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const tick=()=>new Promise(setImmediate),deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
async function until(check){for(let i=0;i<100;i++){if(check())return;await tick();}assert.fail('review transaction did not settle');}
const directory=require('node:path').resolve(__dirname,'../src/features/agent-apps');
const productData=()=>{const html=fs.readFileSync(directory+'/resources/apps/product-kit@v1.758d09b3.html','utf8'),begin=html.indexOf('U_={version:1,locale:'),end=html.indexOf(',wm=document',begin),data=structuredClone(vm.runInNewContext('('+html.slice(begin+3,end)+')'));delete data.product.thumbnail_url;return data;};

test('independent reference integrity and exact product transport derivative preserve source bytes',async()=>{
 for(const [file,digest]of [['character-blocking@v3.f1fd0e23.html','f1fd0e23de67bf00f60ccf333b7d5b57262a01726a37adeef28c800d51a8815b'],['product-kit@v1.758d09b3.html','758d09b3f06e99a6b4e47a782d33ef90b9f12935c140b8bdfe88ca41f76e2535'],['ad-review@v1.e990e21f.html','e990e21f']]){
  const actual=crypto.createHash('sha256').update(fs.readFileSync(directory+'/resources/apps/'+file)).digest('hex');assert.ok(actual.startsWith(digest));
 }
 const proxy=fs.readFileSync(directory+'/resources/mcp-app-proxy.html','utf8'),start=proxy.indexOf('async function localizeProductKitTransport('),end=proxy.indexOf('// PRODUCT_KIT_LOCAL_TRANSPORT:END',start),context={crypto:crypto.webcrypto,TextEncoder,Uint8Array};
 vm.runInNewContext(proxy.slice(start,end)+';globalThis.localize=localizeProductKitTransport;',context);
 const source=fs.readFileSync(directory+'/resources/apps/product-kit@v1.758d09b3.html','utf8'),changed=await context.localize(source,'product-kit','v1');
 assert.notEqual(changed,source);assert.equal(changed.replace(String.raw`thumbnail_url:f().max(500000).regex(/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/)`,'thumbnail_url:f().url().refine(e=>e.startsWith("https://"))'),source);
 await assert.rejects(context.localize(source+' ','product-kit','v1'),/integrity/);
});

for(const name of ['character-blocking','product-kit'])test(name+' cancels an actual response stream that resolves after preparation abort',async()=>{
 const gate=deferred(),started=deferred(),controller=new AbortController();let cancellations=0;
 const module=await import('../src/features/agent-apps/'+name+'-runtime.mjs'),graph={nodes:[{id:'source',type:'image',image:'asset:source'}],edges:[]};
 const factory=name==='product-kit'?module.createProductKitRuntime:module.createCharacterBlockingRuntime;
 const runtime=factory({app:{getState:()=>graph},localAssets:{url:async()=> 'blob:local-source'},getProjectId:()=> 'project',fetchImpl:()=>{started.resolve();return gate.promise;},renderImage:async()=>assert.fail('late image must not decode'),renderPortrait:async()=>assert.fail('late portrait must not decode')});
 const data=name==='product-kit'?{node_ref:'node/source',...productData()}:{target:'image',aspect_ratio:'16:9',scene:'scene',characters:[{id:'person',name:'人物',x:0,y:0,portrait_source:{node_ref:'node/source'}}]};
 const pending=runtime.prepareAppArgs({resource_uri:'ui://tapnow/'+name+'@'+(name==='product-kit'?'v1':'v3'),data},{signal:controller.signal});await started.promise;controller.abort(Error('independent abort'));await assert.rejects(pending,/independent abort/);
 gate.resolve(new Response(new ReadableStream({cancel(){cancellations++;}}),{headers:{'content-type':'image/png'}}));await tick();await tick();assert.equal(cancellations,1,'late Response body must be disposed');
});

test('model result projection removes all three preview forms and internal source contexts while preserving contract',async()=>{
 const {projectAppModelResult}=await import('../src/features/agent-apps/integration.mjs');
 const input={id:'trace',result:{kind:'mcp_app',resource_uri:'ui://tapnow/ad-review@v1',response:{title:'实际审查',items:[{combo:'C1',preview_url:'data:video/mp4;base64,AAAA',poster_url:'blob:secret',nested:{thumbnail_url:'data:image/png;base64,AAAA',portrait:{data_uri:'data:image/webp;base64,AAAA'}}}],fallback:'data:image/png;base64,AAAA'},characterBlockingSourceContext:{sourceSnapshot:{image:'asset:private'}},productKitSourceContext:{source_sha256:'internal'},adReviewSourceContext:{sources:[{signature:'internal'}]}}};
 const output=projectAppModelResult(input),serialized=JSON.stringify(output);assert.doesNotMatch(serialized,/data:|blob:|SourceContext|sourceSnapshot|private|internal/);assert.equal(output.result.response.items[0].combo,'C1');assert.equal(input.result.response.items[0].preview_url,'data:video/mp4;base64,AAAA');
});

async function domFixture(){
 const {createRequire}=require('node:module'),fabricRequire=createRequire(require.resolve('fabric')),domRequire=createRequire(fabricRequire.resolve('jsdom')),canvasPath=domRequire.resolve('canvas'),cached=require.cache[canvasPath];require.cache[canvasPath]={id:canvasPath,loaded:true,exports:{createCanvas:undefined}};let JSDOM;try{({JSDOM}=fabricRequire('jsdom'));}finally{if(cached)require.cache[canvasPath]=cached;else delete require.cache[canvasPath];}
 const dom=new JSDOM('<body></body>',{url:'http://localhost:4173/'}),previous=globalThis.document;globalThis.document=dom.window.document;dom.window.crypto.randomUUID=()=>crypto.randomUUID();Object.defineProperty(dom.window.navigator,'userActivation',{value:{isActive:true}});return{dom,close(){dom.window.close();if(previous===undefined)delete globalThis.document;else globalThis.document=previous;}};
}
async function adControllerFixture(){
 const dom=await domFixture(),m=await import('../src/features/agent-apps/ad-review.mjs'),{createAdReviewRuntime}=await import('../src/features/agent-apps/ad-review-runtime.mjs'),{createAppController,prepareApp}=await import('../src/features/agent-apps/integration.mjs');
 let pauseRead=false;const reads=[];
 const graph={nodes:[{id:'actual',type:'image',image:'asset:actual'}],edges:[]},args={resource_uri:m.adReviewUri,data:{stage:'final_review',batch:{label:'batch'},items:[{combo:'C1',media:'image',node_ref:'node/actual'}]}},runtime=createAdReviewRuntime({app:{getState:()=>graph},getProjectId:()=> 'actual-project',localAssets:{url:async()=> 'blob:actual'},fetchImpl:async()=>{if(pauseRead){const gate=deferred();reads.push(gate);await gate.promise;}return new Response(Buffer.from('actual-source'),{headers:{'content-type':'image/png'}});},decodeImage:async()=>({width:16,height:16})});
 const prepared=await runtime.prepareAppArgs(args),trace={id:'trace',name:'show_app',status:'done',args,result:runtime.bindPreparedResult(prepareApp(prepared),prepared)},chat={id:'chat',messages:[trace]},queues=[],saves=[],errors=[];let active=true,pauseSave=false;
 const controller=createAppController({getContext:()=>({chat,panelActive:active,pageLeaving:false,streaming:false}),getAdReviewSourceContext:response=>runtime.capture(response,{trace,chat,isCurrent:()=>active}),onSaveState:async(c,t,state)=>{const gate=deferred();t.appState=state;saves.push(gate);if(pauseSave)await gate.promise;},onQueuePrompt:async(text,t,c,metadata,guard,validate)=>{assert.equal(guard(),true);await validate();assert.equal(guard(),true);queues.push({text,metadata});return true;},onError:message=>errors.push(message)});
 const element=controller.render(trace);dom.dom.window.document.body.append(element);const iframe=element.querySelector('iframe'),sent=[];iframe.contentWindow.postMessage=value=>sent.push(structuredClone(value));
 const nonce=()=>sent.findLast(value=>value.method==='ui/notifications/sandbox-resource-ready')?.nonce,rpc=(id,method,params={})=>dom.dom.window.dispatchEvent(new dom.dom.window.MessageEvent('message',{source:iframe.contentWindow,data:{jsonrpc:'2.0',nonce:nonce(),...id?{id}:{},method,params}})),response=id=>sent.findLast(value=>value.id===id);
 iframe.dispatchEvent(new dom.dom.window.Event('load'));rpc('init','ui/initialize');rpc(null,'ui/notifications/initialized');iframe.focus();await until(()=>trace.appState&&saves.length===1);
 return{m,trace,graph,queues,saves,errors,reads,rpc,response,pauseSave:()=>pauseSave=true,pauseReads:()=>pauseRead=true,resumeReads(){pauseRead=false;for(const gate of reads)gate.resolve();},setActive:value=>active=value,close(){pauseRead=false;for(const gate of reads)gate.resolve();for(const gate of saves)gate.resolve();controller.reset();dom.close();}};
}

test('production ad controller hands off real node and hashed byte identity through runtime reply',async()=>{
 const f=await adControllerFixture();try{f.rpc('message','ui/message',{content:[{type:'text',text:'成片验收完成：收 1 · 回炉 0 — AR1 '+f.m.adReviewToken(f.trace.result.response,f.trace.appState)}]});await until(()=>f.response('message'));assert.equal(f.response('message').error,undefined);assert.equal(f.queues.length,1);assert.match(f.queues[0].text,/node\/actual/);assert.match(f.queues[0].text,/media_sha256/);assert.match(f.queues[0].text,/actual-project/);}finally{f.close();}
});

test('new save work invalidates an in-flight ad confirmation and a delayed saved state waits before handoff',async()=>{
 const f=await adControllerFixture();try{f.pauseSave();const edited={marks:{C1:'cull'},notes:{C1:'真实备注'}};f.rpc('save','tapnow/setWidgetState',{state:edited});await until(()=>f.saves.length===2);f.rpc('message','ui/message',{content:[{type:'text',text:'成片验收完成：收 1 · 回炉 0 — AR1 '+f.m.adReviewToken(f.trace.result.response,{marks:{},notes:{}})}]});await tick();assert.equal(f.queues.length,0);f.saves[1].resolve();await until(()=>f.response('message'));assert.ok(f.response('message').error);assert.equal(f.queues.length,0);assert.deepEqual(f.trace.appState,edited);}finally{f.close();}
});

test('a save arriving during asynchronous source verification invalidates the earlier ad confirmation',async()=>{
 const f=await adControllerFixture();try{f.pauseReads();f.rpc('message','ui/message',{content:[{type:'text',text:'成片验收完成：收 1 · 回炉 0 — AR1 '+f.m.adReviewToken(f.trace.result.response,f.trace.appState)}]});await until(()=>f.reads.length===1);f.rpc('save','tapnow/setWidgetState',{state:{marks:{C1:'cull'},notes:{}}});await tick();assert.equal(f.queues.length,0);f.resumeReads();await until(()=>f.response('message'));assert.ok(f.response('message').error);assert.equal(f.queues.length,0);await until(()=>f.response('save'));assert.equal(f.response('save').error,undefined);}finally{f.close();}
});

test('production queue compensates a durable receipt when source bytes change after actual persistence',async()=>{
 const source=fs.readFileSync(require.resolve('../agent-client.js'),'utf8'),begin=source.indexOf(' function queueWidgetPrompt('),end=source.indexOf(' function send(){',begin),gate=deferred(),trace={id:'trace',name:'show_app',status:'done',callId:'call',args:{title:'真实来源'},result:{resource_uri:'ui://tapnow/ad-review@v1'},appState:{marks:{},notes:{}}},chat={id:'chat',messages:[trace],queuedMessages:[]};let persistence=0,drains=0,valid=true;
 const context={recoveryRunning:false,appQueueSaving:false,pageLeaving:false,panel:{},draft:()=>chat,busy:false,queueRunner:{running:false,drain(){drains++;}},queueModule:{captureSubmission:input=>({id:'submission',text:input.text})},modelModule:{prepareSessionSelection:()=>({})},composerModule:{textDocument:text=>({text})},clone:structuredClone,validateSubmission(){},persistQueue(){persistence++;},flushConversation:async()=>{if(persistence===1)await gate.promise;},track:fn=>fn(),render(){}};
 vm.runInNewContext(source.slice(begin,end)+';globalThis.queue=queueWidgetPrompt;',context);
 const pending=context.queue('actual verified review',trace,chat,{handoffId:'ad_review_'+'a'.repeat(64)},()=>valid,async()=>{if(!valid)throw Error('same-address source changed');});assert.equal(context.appQueueSaving,true);assert.equal(chat.queuedMessages.length,1);assert.equal(await context.queue('duplicate',trace,chat,{handoffId:'ad_review_'+'a'.repeat(64)},()=>valid),false);valid=false;gate.resolve();await assert.rejects(pending,/source changed/);
 assert.equal(persistence,2);assert.equal(chat.queuedMessages.length,0);assert.equal(trace.appHandoffs,undefined);assert.equal(drains,0);assert.equal(context.appQueueSaving,false);
 valid=true;assert.equal(await context.queue('actual verified review',trace,chat,{handoffId:'ad_review_'+'a'.repeat(64)},()=>valid,async()=>{}),true);assert.equal(persistence,3);assert.equal(chat.queuedMessages.length,1);assert.equal(drains,1);
 assert.equal(await context.queue('actual verified review',trace,chat,{handoffId:'ad_review_'+'a'.repeat(64)},()=>valid,async()=>{}),true);assert.equal(persistence,3);assert.equal(chat.queuedMessages.length,1);assert.equal(drains,1);
});
