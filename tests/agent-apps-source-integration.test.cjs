const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const uri=(name,version='v1')=>'ui://tapnow/'+name+'@'+version,tick=()=>new Promise(setImmediate);
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
async function until(check){for(let i=0;i<80;i++){if(check())return;await tick();}assert.fail('source workflow did not settle');}
const blocking={locale:'fr-FR',target:'image',aspect_ratio:'16:9',scene:'真实人物走位',characters:[{id:'lead',name:'主角',x:400,y:500,facing:180}]};
const kit={node_ref:'node/product',version:1,locale:'en-US',variant:'full',product:{name:'产品',category:'home',price_band:'mid'},kit_version:1,updated_at:'2026-10-03',palette:['scene','product','information','accent'].map((role,index)=>({role,name:'色'+index,hex:'#11223'+index,locked:false,alternatives:[{name:'替代'+index,hex:'#44556'+index}]})),tones:{selected:[{word:'自然',physical:'真实光照'}],options:[{word:'自然',physical:'真实光照'}],max:2},look:{state:'unlocked',sentence:'真实场景'},bans:{product:[]},copy:{language:{value:'中文',locked:true,source:'用户要求'},voice:{value:'克制',options:['克制']}},hypotheses:[],summary:'真实产品约束'};
const ad={locale:'ja-JP',stage:'final_review',batch:{label:'actual'},items:[{node_ref:'node/frame',combo:'actual_combo',media:'image',hook:'真实创意'}]};
const preparedKit=()=>{const {node_ref,...data}=structuredClone(kit);return{...data,product:{...data.product,thumbnail_url:'data:image/png;base64,AAAA'}};};
const preparedAd=()=>({...structuredClone(ad),items:ad.items.map(({node_ref,...item})=>({...item,preview_url:'data:image/png;base64,AAAA'}))});

test('three production app tool schemas accept exact reference inputs and refuse supplied previews or picker authority',()=>{
 const scope={};vm.runInNewContext(fs.readFileSync(require.resolve('../agent-tools.js'),'utf8'),scope);const tools=scope.AgentTools;
 const inputs=[[uri('character-blocking','v3'),blocking],[uri('product-kit'),kit],[uri('ad-review'),ad]];
 for(const [resource_uri,data]of inputs){assert.equal(tools.parse('show_app',{resource_uri,data}).args.resource_uri,resource_uri);assert.throws(()=>tools.parse('show_app',{resource_uri,data,original_request:'invalid picker input'}));assert.throws(()=>tools.parse('show_app',{resource_uri,data:{...data,preview_url:'data:image/png;base64,AAAA'}}));}
 assert.throws(()=>tools.parse('show_app',{resource_uri:inputs[0][0],data:{...blocking,characters:[{...blocking.characters[0],portrait:{data_uri:'data:image/webp;base64,AAAA',source:'image-crop'}}]}}));
 assert.throws(()=>tools.parse('show_app',{resource_uri:inputs[0][0],data:{...blocking,characters:[{...blocking.characters[0],x:0.1}]}}));
 assert.throws(()=>tools.parse('show_app',{resource_uri:inputs[0][0],data:{...blocking,characters:[{...blocking.characters[0],portrait_source:{node_ref:'node/actor',crop:{x:990,y:0,w:100,h:100}}}]}}));
 assert.throws(()=>tools.parse('show_app',{resource_uri:inputs[1][0],data:{...kit,product:{...kit.product,thumbnail_url:'https://example.com/product.png'}}}));
 assert.throws(()=>tools.parse('show_app',{resource_uri:inputs[2][0],data:{...ad,items:[{...ad.items[0],poster_url:'https://example.com/poster.png'}]}}));
 const definition=tools.definitions.find(item=>item.name==='show_app');assert.match(definition.description,/frame_cull\/pilot_review\/final_review/);assert.match(definition.description,/functional\/beauty\/food\/home\/apparel\/trust/);assert.match(definition.description,/portrait_source/);
});

test('three apps register local resources; large video capability stays scoped to ad review and projection strips source bytes',async()=>{
 const {prepareApp,appPolicy}=await import('../src/features/agent-apps/registry.mjs'),{projectAppModelResult}=await import('../src/features/agent-apps/integration.mjs');
 for(const [resource_uri,data]of [[uri('character-blocking','v3'),blocking],[uri('product-kit'),preparedKit()],[uri('ad-review'),preparedAd()]]){const result=prepareApp({resource_uri,data});assert.equal(result.resource_uri,resource_uri);assert.equal(appPolicy(resource_uri).allowExpanded,false);const projected=projectAppModelResult({result:{...result,sourceContext:{secret:'host'},characterBlockingSourceContext:{private:'host'},productKitSourceContext:{private:'host'},adReviewSourceContext:{private:'host'}}});assert.ok(!JSON.stringify(projected).includes('AAAA'));assert.ok(!JSON.stringify(projected).includes('SourceContext'));assert.ok(!JSON.stringify(projected).includes('secret'));}
 assert.match(appPolicy(uri('ad-review')).proxyUrl,/ad-review-proxy\.html$/);assert.match(appPolicy(uri('product-kit')).proxyUrl,/mcp-app-proxy\.html$/);
 const proxy=fs.readFileSync(require.resolve('../src/features/agent-apps/resources/ad-review-proxy.html'),'utf8');assert.match(proxy,/params\.resource\.name !== "ad-review"/);assert.match(proxy,/params\.resource\.version !== "v1"/);assert.match(proxy,/mediaSources = "blob: data:"/);assert.match(proxy,/connect-src 'none'/);assert.match(proxy,/inner.setAttribute\("sandbox", "allow-scripts"\)/);
 const source=fs.readFileSync(require.resolve('../agent-client.js'),'utf8');for(const name of ['characterBlocking','productKit','adReview']){assert.match(source,new RegExp(name+'Runtime.prepareAppArgs'));assert.match(source,new RegExp(name+'Runtime.bindPreparedResult'));assert.match(source,new RegExp(name+'Runtime.capture'));}
});

test('ad video result has a bounded 16MiB transport while image-only apps keep their default limit',async()=>{
 const {createMcpAppHost}=await import('../src/features/agent-apps/host.mjs');
 const window={crypto:require('node:crypto').webcrypto,removeEventListener(){}},iframe={ownerDocument:{defaultView:window},isConnected:true,removeEventListener(){}};
 const result={items:[{preview_url:'data:video/mp4;base64,'+'A'.repeat(1200000)}]};
 const host=createMcpAppHost({iframe,resourceUri:uri('ad-review'),toolResult:result});host.dispose();
 for(const resourceUri of [uri('character-blocking','v3'),uri('product-kit')])assert.throws(()=>createMcpAppHost({iframe,resourceUri,toolResult:result}),/size/);
 assert.throws(()=>createMcpAppHost({iframe,resourceUri:uri('ad-review'),toolResult:{items:[{preview_url:'A'.repeat(16*1024*1024)}]}}),/size/);
});

async function domFixture(){
 const {createRequire}=require('node:module'),fabricRequire=createRequire(require.resolve('fabric')),domRequire=createRequire(fabricRequire.resolve('jsdom')),canvasPath=domRequire.resolve('canvas'),cached=require.cache[canvasPath];require.cache[canvasPath]={id:canvasPath,loaded:true,exports:{createCanvas:undefined}};let JSDOM;try{({JSDOM}=fabricRequire('jsdom'));}finally{if(cached)require.cache[canvasPath]=cached;else delete require.cache[canvasPath];}
 const dom=new JSDOM('<body></body>',{url:'http://localhost:4173/'}),previous=globalThis.document;globalThis.document=dom.window.document;dom.window.crypto.randomUUID=()=>require('node:crypto').randomUUID();Object.defineProperty(dom.window.navigator,'userActivation',{value:{isActive:true}});return{dom,close(){dom.window.close();if(previous===undefined)delete globalThis.document;else globalThis.document=previous;}};
}
async function controllerFixture(name){
 const env=await domFixture(),originalNow=Date.now;let clockOffset=0;Date.now=()=>originalNow()+clockOffset;const {createAppController,prepareApp}=await import('../src/features/agent-apps/integration.mjs'),module=await import('../src/features/agent-apps/'+name+'.mjs');
 const helpers={
 'character-blocking':{uri:module.characterBlockingUri,data:blocking,initial:module.initialCharacterBlockingState,validate:module.validateCharacterBlockingState,reply:module.resolveCharacterBlockingReply,message:module.characterBlockingConfirmation,hook:'getCharacterBlockingSourceContext'},
 'product-kit':{uri:module.productKitUri,data:preparedKit(),initial:module.initialProductKitState,validate:module.validateProductKitState,reply:module.resolveProductKitReply,message:module.productKitMessage,hook:'getProductKitSourceContext'},
 'ad-review':{uri:module.adReviewUri,data:preparedAd(),initial:module.initialAdReviewState,validate:module.validateAdReviewState,reply:module.resolveAdReviewReply,message:(response,state)=>`完成動画確認完了：採用 1 · 修正 0 — AR1 ${module.adReviewToken(response,state)}`,hook:'getAdReviewSourceContext'},
 },h=helpers[name],args={resource_uri:h.uri,data:h.data},trace={id:'actual-trace',callId:'actual-call',name:'show_app',status:'done',args,result:prepareApp(args)},chat={id:'actual-chat',messages:[trace]},saves=[],queues=[],errors=[];let currentChat=chat,sourceCurrent=true,queueGate=null,hashGate=null,hashes=0;
 const validateSource=async()=>{hashes++;if(hashGate)await hashGate;if(!sourceCurrent)throw Error('actual bytes changed');};
 const context={isCurrent:()=>sourceCurrent,dispose(){},validateState:state=>h.validate(state,trace.result.response),guard:name==='product-kit'?()=>{if(!sourceCurrent)throw Error('source changed');return true;}:validateSource,validateSourceCurrent:validateSource,reply:(message,state)=>h.reply(message,trace.result.response,state)};
 const controller=createAppController({getContext:()=>({chat:currentChat,panelActive:true,pageLeaving:false,streaming:false}),[h.hook]:()=>context,onError:message=>errors.push(message),onSaveState:async(_chat,t,state)=>{const gate=deferred(),previous=t.appState;t.appState=state;saves.push({state,gate});try{if(await gate.promise===false){if(t.appState===state)t.appState=previous;return false;}}catch(error){if(t.appState===state)t.appState=previous;throw error;}},onQueuePrompt:async(text,t,c,metadata,guard,validate)=>{const call={text,metadata,guard,validate};queues.push(call);if(queueGate)await queueGate;await validate();return guard();}});
 const element=controller.render(trace);env.dom.window.document.body.append(element);const iframe=element.querySelector('iframe'),sent=[];iframe.contentWindow.postMessage=value=>sent.push(structuredClone(value));const nonce=()=>sent.findLast(value=>value.method==='ui/notifications/sandbox-resource-ready').nonce;
 const rpc=(id,method,params={})=>{iframe.focus();env.dom.window.dispatchEvent(new env.dom.window.MessageEvent('message',{source:iframe.contentWindow,data:{jsonrpc:'2.0',nonce:nonce(),...id?{id}:{},method,params}}));};
 iframe.dispatchEvent(new env.dom.window.Event('load'));rpc('init','ui/initialize');rpc(null,'ui/notifications/initialized');await until(()=>saves.length===1);
 return{...env,h,trace,chat,saves,queues,errors,rpc,response:id=>sent.findLast(value=>value.id===id),message:()=>h.message(trace.result.response,trace.appState),hashes:()=>hashes,setSource:v=>sourceCurrent=v,setChat:v=>currentChat=v,setQueueGate:v=>queueGate=v,setHashGate:v=>hashGate=v,advance:()=>clockOffset+=1001,cleanup(){Date.now=originalNow;saves.forEach(save=>save.gate.resolve());controller.reset();env.close();}};
}

for(const name of ['character-blocking','product-kit','ad-review'])test(name+' controller waits for persisted state, awaits async source and rejects false save or stale queued confirmation',async()=>{
 const f=await controllerFixture(name);try{
  assert.deepEqual(f.response('init').result.hostCapabilities,{message:{text:{}}});f.rpc('foreign','tools/call',{name:'generation_submit',arguments:{}});assert.equal(f.response('foreign').error.code,-32601);
  f.rpc('confirm','ui/message',{content:[{type:'text',text:f.message()}]});await tick();assert.equal(f.queues.length,0);f.saves[0].gate.resolve();await until(()=>f.response('confirm'));assert.equal(f.response('confirm').error,undefined);assert.equal(f.queues.length,1);assert.match(f.queues[0].metadata.handoffId,/^(blocking_|product_kit_|ad_review_)/);assert.ok(f.hashes()>=3);
  f.advance();const queueGate=deferred();f.setQueueGate(queueGate.promise);f.rpc('queue-changed-source','ui/message',{content:[{type:'text',text:f.message()}]});await until(()=>f.queues.length===2);f.setSource(false);queueGate.resolve();await until(()=>f.response('queue-changed-source'));assert.ok(f.response('queue-changed-source').error);f.setSource(true);f.setQueueGate(null);
  const next=structuredClone(f.trace.appState);f.rpc('state','tapnow/setWidgetState',{state:next});await until(()=>f.saves.length===2);f.saves[1].gate.resolve(false);await until(()=>f.response('state'));assert.ok(f.response('state').error);assert.equal(f.errors.length,1,'only rejected source confirmation reports a notice; state RPC failure returns to iframe');
  f.advance();f.rpc('after-failed-save','ui/message',{content:[{type:'text',text:f.message()}]});await until(()=>f.response('after-failed-save'));assert.ok(f.response('after-failed-save').error);assert.equal(f.queues.length,2);
  f.rpc('retry-state','tapnow/setWidgetState',{state:next});await until(()=>f.saves.length===3);f.saves[2].gate.resolve();await until(()=>f.response('retry-state'));
  f.setSource(false);f.rpc('stale-state','tapnow/setWidgetState',{state:next});await until(()=>f.response('stale-state'));assert.ok(f.response('stale-state').error);assert.equal(f.saves.length,3);
 }finally{f.cleanup();}
});

test('normal app queue awaits byte validation after the actual commit and compensates failure before draining',async()=>{
 const source=fs.readFileSync(require.resolve('../agent-client.js'),'utf8'),start=source.indexOf(' function queueWidgetPrompt('),end=source.indexOf('\n function send()',start),queueSource=source.slice(start,end);const trace={id:'trace',callId:'call',name:'show_app',status:'done',result:{resource_uri:uri('ad-review')},appState:{marks:{},notes:{}}},chat={id:'chat',messages:[trace]},gate=deferred();let flushes=0,drains=0,checks=0;
 const scope={recoveryRunning:false,appQueueSaving:false,pageLeaving:false,panel:{},draft:()=>chat,busy:false,queueModule:{captureSubmission:value=>({text:value.text})},queueRunner:{running:false,drain:()=>drains++},modelModule:{prepareSessionSelection:()=>({})},composerModule:{textDocument:()=>({content:[]})},validateSubmission(){},persistQueue(){},flushConversation:async()=>{flushes++;if(flushes===1)await gate.promise;},track:fn=>fn(),render(){},clone:structuredClone};
 vm.runInNewContext(queueSource+'\nthis.runQueue=queueWidgetPrompt;',scope);const promise=scope.runQueue('actual proposal',trace,chat,{handoffId:'ad_review_'+'a'.repeat(64)},()=>true,async()=>{checks++;throw Error('actual media bytes changed during save');});assert.equal(chat.queuedMessages.length,1);assert.equal(drains,0);gate.resolve();await assert.rejects(promise,/actual media bytes changed/);assert.equal(checks,1);assert.equal(chat.queuedMessages,undefined);assert.equal(trace.appHandoffs,undefined);assert.equal(flushes,2);assert.equal(drains,0);
});
