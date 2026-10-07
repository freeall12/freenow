const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const tick=()=>new Promise(setImmediate),uri=(name,version='v1')=>'ui://tapnow/'+name+'@'+version;
class Surface{constructor(){this.events=new Map();}addEventListener(n,f){if(!this.events.has(n))this.events.set(n,new Set());this.events.get(n).add(f);}removeEventListener(n,f){this.events.get(n)?.delete(f);}emit(n,e){for(const f of this.events.get(n)||[])f(e);}}
async function hostFixture(resourceUri,callbacks,options={}){
 const {createMcpAppHost}=await import('../src/features/agent-apps/host.mjs'),window=new Surface(),iframe=new Surface(),sent=[];
 Object.assign(window,{crypto:require('node:crypto').webcrypto,navigator:{userActivation:{isActive:false}},setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,clearInterval(){}});iframe.ownerDocument={defaultView:window,activeElement:null};iframe.isConnected=true;iframe.contentWindow={postMessage:value=>sent.push(structuredClone(value))};let current=true;
 const host=createMcpAppHost({iframe,resourceUri,callbacks,allowResource:()=>true,isCurrent:()=>current,...options});host.start();const nonce=()=>sent.findLast(v=>v.method==='ui/notifications/sandbox-resource-ready').nonce;
 const rpc=(id,method,params={},user=false,token=nonce())=>{iframe.ownerDocument.activeElement=user?iframe:null;window.navigator.userActivation.isActive=user;window.emit('message',{source:iframe.contentWindow,data:{jsonrpc:'2.0',nonce:token,...id===null?{}:{id},method,params}});window.navigator.userActivation.isActive=false;};rpc('init','ui/initialize');rpc(null,'ui/notifications/initialized');
 return{host,rpc,sent,response:id=>sent.findLast(v=>v.id===id),iframe,setCurrent:v=>current=v};
}
const toolParams=(name,args,callId='actual_call_123')=>({name,arguments:args,_meta:{'tapnow/callId':callId}});

test('three edit show_app schemas accept only agent-owned official source inputs',()=>{
 const scope={};vm.runInNewContext(fs.readFileSync(require.resolve('../agent-tools.js'),'utf8'),scope);const tools=scope.AgentTools;
 const color={resource_uri:uri('color-adjust','v2'),data:{node_ref:'node/image',params:{exposure:14},suggested:{temperature:-2}}};assert.equal(tools.parse('show_app',color).args.resource_uri,color.resource_uri);
 for(const change of [{preview:{data_uri:'data:image/png;base64,AA=='}},{params:{exposure:.5}},{suggested:{contrast:3}},{params:{fade:-1}}])assert.throws(()=>tools.parse('show_app',{...color,data:{...color.data,...change}}));
 const resize={resource_uri:uri('platform-resize'),data:{image_id:'node/image',platforms:[{platform:'vertical',label_zh:'竖屏',label_en:'Vertical',ratio_id:'r_9_16'}]}};assert.equal(tools.parse('show_app',resize).args.data.image_id,'node/image');
 for(const change of [{platforms:[]},{node_ref:'node/image'},{platforms:[{...resize.data.platforms[0],x:1}]}])assert.throws(()=>tools.parse('show_app',{...resize,data:{...resize.data,...change}}));
 const cutlist={resource_uri:uri('cutlist-review'),data:{shots:[{id:'video',label:'实际片段',media_duration_ms:2000,in_ms:100,out_ms:1800,default_keep:true}]}};assert.equal(tools.parse('show_app',cutlist).args.data.shots.length,1);
 for(const shot of [{...cutlist.data.shots[0],preview_url:'https://foreign/video.mp4'},{...cutlist.data.shots[0],out_ms:2100},{...cutlist.data.shots[0],in_ms:1701}])assert.throws(()=>tools.parse('show_app',{...cutlist,data:{shots:[shot]}}));
 assert.throws(()=>tools.parse('show_app',{...color,original_request:'unrelated picker field'}));
});

test('color context uses one successful current Apply permit after transient activation expires',async()=>{
 let resolveApply,applies=0,contexts=0;const promise=new Promise(r=>resolveApply=r),f=await hostFixture(uri('color-adjust','v2'),{onApplyColorAdjust:()=>{applies++;return promise;},onColorAdjustContext:(params,options,guard)=>{contexts++;assert.equal(options.userAction,true);assert.equal(options.callId,'actual_call_123');assert.equal(guard(),true);return{};},onSendPrompt:()=>true});
 try{
  assert.deepEqual(f.response('init').result.hostCapabilities,{message:{text:{}},serverTools:{},updateModelContext:{}});
  f.rpc('no-receipt','ui/update-model-context',{content:[]},true);assert.ok(f.response('no-receipt').error);
  f.rpc('foreign','tools/call',toolParams('resize_for_platform_apply',{}),true);assert.equal(f.response('foreign').error.code,-32601);
  f.rpc('passive','tools/call',toolParams('color_adjust_apply',{}));assert.equal(applies,0);assert.ok(f.response('passive').error);
  f.rpc('wrong-nonce','tools/call',toolParams('color_adjust_apply',{}),true,'foreign');assert.equal(applies,0);assert.equal(f.response('wrong-nonce'),undefined);
  f.rpc('apply','tools/call',toolParams('color_adjust_apply',{}),true);assert.equal(applies,1);
  f.rpc('busy','ui/update-model-context',{content:[]});assert.ok(f.response('busy').error);
  resolveApply({content:[],structuredContent:{node_id:'actual-output'}});await tick();assert.equal(f.response('apply').result.structuredContent.node_id,'actual-output');
  f.rpc('context','ui/update-model-context',{content:[{type:'text',text:'exact saved receipt context'}]});await tick();assert.deepEqual(f.response('context').result,{});assert.equal(contexts,1);
  f.rpc('replay','ui/update-model-context',{content:[]},true);assert.ok(f.response('replay').error);assert.equal(contexts,1);
 }finally{f.host.dispose();}
});

test('failed or stale edit callbacks never grant context permission or fake success',async()=>{
 const f=await hostFixture(uri('color-adjust','v2'),{onApplyColorAdjust:async()=>{throw Error('actual output save failed');},onColorAdjustContext:()=>({})});
 try{f.rpc('apply','tools/call',toolParams('color_adjust_apply',{}),true);await tick();assert.ok(f.response('apply').error);f.rpc('context','ui/update-model-context',{content:[]},true);assert.ok(f.response('context').error);}finally{f.host.dispose();}
 let release,guard;const g=await hostFixture(uri('platform-resize'),{onPlatformResizeApply:(_args,_meta,current)=>{guard=current;return new Promise(r=>release=r);}});
 try{g.rpc('apply','tools/call',toolParams('resize_for_platform_apply',{}),true);g.setCurrent(false);assert.equal(guard(),false);release({content:[],structuredContent:{node_refs:['node/actual']}});await tick();assert.equal(g.response('apply'),undefined);}finally{g.host.dispose();}
});

test('color context save retry reuses the successful Apply and consumes its permit only after persistence',async()=>{
 let applies=0,contexts=0;
 const f=await hostFixture(uri('color-adjust','v2'),{
  onApplyColorAdjust:async()=>{applies++;return {content:[],structuredContent:{node_id:'same-output'}};},
  onColorAdjustContext:async(_params,options)=>{contexts++;assert.equal(options.callId,'actual_call_123');if(contexts===1)throw Error('local conversation save failed');return {};}
 });
 try{
  f.rpc('apply','tools/call',toolParams('color_adjust_apply',{}),true);await tick();
  f.rpc('context-1','ui/update-model-context',{content:[]});await tick();assert.ok(f.response('context-1').error);
  f.rpc('context-2','ui/update-model-context',{content:[]});await tick();assert.deepEqual(f.response('context-2').result,{});
  f.rpc('context-replay','ui/update-model-context',{content:[]},true);await tick();assert.ok(f.response('context-replay').error);
  assert.equal(applies,1);assert.equal(contexts,2);
 }finally{f.host.dispose();}
});

test('color context failure cannot restore a permit invalidated by a new source or conversation run',async()=>{
 for(const invalidate of [host=>host.updateData({node_ref:'node/other'},{}),host=>{host.updateConversationRunActive(true);host.updateConversationRunActive(false);}]){
  let rejectContext,contexts=0;const f=await hostFixture(uri('color-adjust','v2'),{
   onApplyColorAdjust:async()=>({content:[],structuredContent:{node_id:'original-output'}}),
   onColorAdjustContext:()=>{contexts++;return new Promise((_resolve,reject)=>rejectContext=reject);}
  });
  try{
   f.rpc('apply','tools/call',toolParams('color_adjust_apply',{}),true);await tick();
   f.rpc('context','ui/update-model-context',{content:[]});invalidate(f.host);rejectContext(Error('late save failure'));await tick();
   f.rpc('stale-retry','ui/update-model-context',{content:[]},true);await tick();assert.ok(f.response('stale-retry').error);assert.equal(contexts,1);
  }finally{f.host.dispose();}
 }
});

test('color late Apply or context success is rejected after source projection or a completed run cycle',async()=>{
 for(const phase of ['apply','context'])for(const invalidate of [host=>host.updateData({node_ref:'node/other'},{}),host=>{host.updateConversationRunActive(true);host.updateConversationRunActive(false);}]){
  let release,guard,contexts=0;const deferred=(_input,_options,current)=>{guard=current;return new Promise(resolve=>release=resolve);};
  const f=await hostFixture(uri('color-adjust','v2'),{
   onApplyColorAdjust:phase==='apply'?deferred:async()=>({content:[],structuredContent:{node_id:'same-output'}}),
   onColorAdjustContext:(...args)=>{contexts++;return phase==='context'?deferred(...args):{};}
  });
  try{
   f.rpc('apply','tools/call',toolParams('color_adjust_apply',{}),true);await tick();
   if(phase==='context')f.rpc('context','ui/update-model-context',{content:[]});
   assert.equal(guard(),true);invalidate(f.host);assert.equal(guard(),false);release(phase==='apply'?{content:[],structuredContent:{node_id:'stale-output'}}:{});await tick();assert.ok(f.response(phase).error);
   f.rpc('stale-context','ui/update-model-context',{content:[]},true);await tick();assert.ok(f.response('stale-context').error);assert.equal(contexts,phase==='context'?1:0);
  }finally{f.host.dispose();}
 }
});

test('platform host exposes only its edit tool and rejects state, messages, foreign methods and metadata',async()=>{
 let edits=0;const f=await hostFixture(uri('platform-resize'),{onPlatformResizeApply:async()=>{edits++;return{content:[],structuredContent:{count:1,node_refs:['node/actual']}};},onSendPrompt:()=>true,onSetWidgetState:()=>true,onColorAdjustContext:()=>({})});
 try{
  assert.deepEqual(f.response('init').result.hostCapabilities,{serverTools:{}});
  for(const [id,method,params]of [['state','tapnow/setWidgetState',{state:{}}],['message','ui/message',{content:[{type:'text',text:'unavailable'}]}],['context','ui/update-model-context',{content:[]}],['foreign','tools/call',toolParams('color_adjust_apply',{})]]){f.rpc(id,method,params,true);assert.equal(f.response(id).error.code,-32601);}
  f.rpc(19,'tools/call',{...toolParams('resize_for_platform_apply',{}),_meta:{'tapnow/callId':'actual_call_123',progressToken:18}},true);assert.ok(f.response(19).error);assert.equal(edits,0);
  f.rpc(20,'tools/call',{...toolParams('resize_for_platform_apply',{}),_meta:{'tapnow/callId':'actual_call_123',progressToken:20}},true);await tick();assert.equal(edits,1);assert.equal(f.response(20).result.structuredContent.count,1);
 }finally{f.host.dispose();}
});

test('cutlist keeps bounded real iframe video bytes while model projection removes previews and host bindings',async()=>{
 const {projectAppModelResult}=await import('../src/features/agent-apps/integration.mjs'),{appPolicy}=await import('../src/features/agent-apps/registry.mjs');const media='data:video/mp4;base64,'+'A'.repeat(1200000),result={kind:'mcp_app',resource_uri:uri('cutlist-review'),response:{shots:[{id:'actual',preview_url:media}]},cutlistSourceContext:{privateSnapshot:'local'}};
 const f=await hostFixture(uri('cutlist-review'),{onSetWidgetState:()=>true,onSendPrompt:()=>true},{toolResult:result.response});try{assert.equal(f.sent.find(v=>v.method==='ui/notifications/tool-result').params.structuredContent.shots[0].preview_url,media);assert.match(appPolicy(uri('cutlist-review')).proxyUrl,/cutlist-review-proxy.html$/);f.rpc('foreign','tools/call',toolParams('resize_for_platform_apply',{}),true);assert.equal(f.response('foreign').error.code,-32601);}finally{f.host.dispose();}
 const entry={callId:'show',result},projected=projectAppModelResult(entry);assert.equal(projected.result.response.shots[0].id,'actual');assert.equal(projected.result.response.shots[0].preview_url,undefined);assert.equal(projected.result.cutlistSourceContext,undefined);assert.equal(result.response.shots[0].preview_url,media);assert.ok(JSON.stringify(projected).length<500);
});

async function domFixture(){
 const {createRequire}=require('node:module'),fabricRequire=createRequire(require.resolve('fabric')),domRequire=createRequire(fabricRequire.resolve('jsdom')),canvasPath=domRequire.resolve('canvas'),cached=require.cache[canvasPath];require.cache[canvasPath]={id:canvasPath,loaded:true,exports:{createCanvas:undefined}};let JSDOM;try{({JSDOM}=fabricRequire('jsdom'));}finally{if(cached)require.cache[canvasPath]=cached;else delete require.cache[canvasPath];}
 const dom=new JSDOM('<body></body>',{url:'http://localhost:4173/'}),previous=globalThis.document;globalThis.document=dom.window.document;dom.window.crypto.randomUUID=()=>require('node:crypto').randomUUID();let activated=false;Object.defineProperty(dom.window.navigator,'userActivation',{value:{get isActive(){return activated;}}});return{dom,activate:v=>activated=v,close(){dom.window.close();if(previous===undefined)delete globalThis.document;else globalThis.document=previous;}};
}
async function until(check){for(let i=0;i<60;i++){if(check())return;await tick();}assert.fail('controller operation did not settle');}

test('color controller applies complete submitted params while official delayed state remains pending, then saves exact receipt context',async()=>{
 const f=await domFixture(),{createAppController,prepareApp}=await import('../src/features/agent-apps/integration.mjs'),{colorAdjustParams,colorAdjustAppliedContext,resolveColorAdjustContext,initialColorAdjustState}=await import('../src/features/agent-apps/color-adjust.mjs');
 const args={resource_uri:uri('color-adjust','v2'),data:{node_ref:'node/source'}},trace={id:'color',name:'show_app',status:'done',args,result:prepareApp(args)},chat={id:'actual-chat',messages:[trace]},saves=[],contexts=[],queues=[];let completeApply;
 const controller=createAppController({getContext:()=>({chat,panelActive:true,pageLeaving:false,streaming:false}),getColorAdjustSourceContext:()=>({guard:()=>true,isCurrent:()=>true}),onSaveState:async(_chat,t,state)=>{t.appState=state;await new Promise(resolve=>saves.push(resolve));},onApplyColorAdjust:async(input,_t,_chat,{isCurrent,userAction})=>{assert.equal(userAction,true);assert.equal(input.params.exposure,31);await new Promise(resolve=>completeApply=resolve);assert.equal(isCurrent(),true);return{node_id:'real-png',params:input.params};},onColorAdjustContext:async(params,_t,_chat,{isCurrent})=>{assert.equal(isCurrent(),true);const result=resolveColorAdjustContext(params,trace.result.response,{node_id:'real-png',source_node_ref:'node/source',params:colorAdjustParams({exposure:31})});contexts.push(result);return{};},onQueuePrompt:()=>{queues.push(true);return true;}});
 const element=controller.render(trace);f.dom.window.document.body.append(element);const iframe=element.querySelector('iframe'),sent=[];iframe.contentWindow.postMessage=v=>sent.push(structuredClone(v));const nonce=()=>sent.findLast(v=>v.method==='ui/notifications/sandbox-resource-ready').nonce;
 const rpc=(id,method,params={},user=false)=>{iframe.focus();f.activate(user);f.dom.window.dispatchEvent(new f.dom.window.MessageEvent('message',{source:iframe.contentWindow,data:{jsonrpc:'2.0',nonce:nonce(),...id===null?{}:{id},method,params}}));f.activate(false);};const response=id=>sent.findLast(v=>v.id===id);
 try{
  iframe.dispatchEvent(new f.dom.window.Event('load'));rpc('init','ui/initialize');rpc(null,'ui/notifications/initialized');await until(()=>saves.length===1);
  rpc('apply','tools/call',toolParams('color_adjust_apply',{node_ref:'node/source',params:colorAdjustParams({exposure:31})}),true);await until(()=>completeApply);
  const delayed=initialColorAdjustState(trace.result.response);delayed.exposure=31;rpc('late-state','tapnow/setWidgetState',{state:delayed});completeApply();await until(()=>response('apply'));assert.equal(response('apply').error,undefined);
  const text=colorAdjustAppliedContext(colorAdjustParams({exposure:31}),'real-png');rpc('context','ui/update-model-context',{content:[{type:'text',text}]});await until(()=>response('context'));assert.equal(response('context').error,undefined);assert.equal(contexts.length,1);assert.equal(queues.length,0);
  saves[0]();await until(()=>saves.length===2);saves[1]();await until(()=>response('late-state'));
 }finally{for(const resolve of saves)resolve();controller.reset();f.close();}
});

async function assemblyFixture(){
 const {createCutlistAssemblyRoute,prepareApp}=await import('../src/features/agent-apps/integration.mjs'),{initialCutlistReviewState,cutlistReviewToken,resolveCutlistReviewReply}=await import('../src/features/agent-apps/cutlist-review.mjs');
 const args={resource_uri:uri('cutlist-review'),data:{shots:[{id:'source-video',label:'真实来源',media_duration_ms:2000,in_ms:100,out_ms:1600,default_keep:true}]}},trace={id:'actual-review',callId:'show-call',name:'show_app',status:'done',args,result:prepareApp(args)};trace.appState=initialCutlistReviewState(trace.result.response);trace.result.cutlistSourceContext={projectId:'actual-project'};
 const message='确认拼装计划：保留 1/1 段，总时长 1.5s — '+cutlistReviewToken(trace.result.response,trace.appState),reply=await resolveCutlistReviewReply(message,trace.result.response,trace.appState);trace.appHandoffs=[reply.metadata.handoffId];
 const accepted={role:'user',text:reply.text,widgetOrigin:{traceId:trace.id,callId:trace.callId,resourceUri:uri('cutlist-review'),handoffId:reply.metadata.handoffId}},chat={id:'real-chat',messages:[trace,accepted],queuedMessages:[]},requests=[],outputs=new Map();let sourceCurrent=true,disposed=0,persists=0,gate=null,persistHook=null;
 const route=createCutlistAssemblyRoute({getContext:()=>({chat,panelActive:true,pageLeaving:false}),getSourceContext:()=>({guard:async()=>{if(!sourceCurrent)throw Error('actual source replaced');return true;},isCurrent:()=>sourceCurrent,dispose:()=>disposed++}),persistConversation:async()=>{persists++;return persistHook?.(persists);},executor:{validateReceiptCurrent:async(receipt,{sourceContext})=>{if(!outputs.has(receipt.operationId))throw Error('actual output removed during conversation save');if(!sourceContext.isCurrent())throw Error('actual source replaced during conversation save');return true;},execute:async(input,{sourceContext})=>{requests.push(input);assert.equal(input.authorization.kind,'local_cutlist_assembly');assert.equal(input.authorization.handoffId,reply.metadata.handoffId);assert.equal(sourceContext.isCurrent(),true);if(gate)await gate;if(!sourceContext.isCurrent())throw Error('actual source changed during render');if(!outputs.has(input.operationId))outputs.set(input.operationId,{operationId:input.operationId,applied:true,saved:true,nodeIds:['real-output'],duration:1.5,width:1280,height:720,mediaSha256:'a'.repeat(64)});return outputs.get(input.operationId);}}});
 return{route,chat,trace,accepted,message,reply,requests,outputs,args:{trace_id:trace.id,handoff_id:reply.metadata.handoffId,operation_id:'stable_operation'},setSource:v=>sourceCurrent=v,setGate:v=>gate=v,setPersistHook:v=>persistHook=v,persists:()=>persists,disposed:()=>disposed};
}

test('cutlist_assemble is a normal mutation with only durable identity parameters',async()=>{
 const scope={};vm.runInNewContext(fs.readFileSync(require.resolve('../agent-tools.js'),'utf8'),scope);const f=await assemblyFixture(),checked=scope.AgentTools.parse('cutlist_assemble',f.args);assert.equal(checked.definition.mutates,true);
 const {needsToolConfirmation}=await import('../src/features/agent-execution/trace.mjs');assert.equal(needsToolConfirmation(checked.definition,'ask'),true);
 for(const extra of [{message:f.message},{response:f.trace.result.response},{state:f.trace.appState},{authorization:{kind:'local_cutlist_assembly'}}])assert.throws(()=>scope.AgentTools.parse('cutlist_assemble',{...f.args,...extra}));
 const source=fs.readFileSync(require.resolve('../agent-client.js'),'utf8');assert.match(source,/case 'cutlist_assemble':await appCardsReady;return cutlistAssemblyRoute\(a,\{approved:cutlistAuthorized,signal\}\)/);assert.match(source,/cutlistAuthorized:name==='cutlist_assemble'&&draft\(\)===d&&d.activeRun===run/);
});

test('assembly rejects missing mutation approval, unaccepted handoffs and changed saved plans',async()=>{
 const f=await assemblyFixture();await assert.rejects(()=>f.route(f.args),/正常画布修改确认/);assert.equal(f.requests.length,0);
 f.trace.appHandoffs=[];await assert.rejects(()=>f.route(f.args,{approved:true}),/已保存.*审核交接/);f.trace.appHandoffs=[f.args.handoff_id];
 f.chat.messages=[f.trace];await assert.rejects(()=>f.route(f.args,{approved:true}),/真实用户审核交接/);f.chat.messages.push(f.accepted);
 f.trace.appState.shots['source-video'].out_ms=1700;await assert.rejects(()=>f.route(f.args,{approved:true}),/无效|不一致/);assert.equal(f.requests.length,0);
});

test('actual accepted user or queue handoff drives assembly and stable operation retries do not create another output',async()=>{
 const f=await assemblyFixture();f.chat.messages=[f.trace];f.chat.queuedMessages=[f.accepted];const first=await f.route(f.args,{approved:true});assert.equal(first.nodeIds[0],'real-output');assert.equal(first.handoff_id,f.args.handoff_id);assert.equal(f.requests[0].message,f.message);assert.deepEqual(f.requests[0].state,f.trace.appState);assert.equal(f.trace.cutlistAssemblyReceipts.length,1);
 const second=await f.route(f.args,{approved:true});assert.deepEqual(second,first);assert.equal(f.outputs.size,1);assert.equal(f.trace.cutlistAssemblyReceipts.length,1);assert.equal(f.persists(),4);assert.equal(f.disposed(),2);
 f.accepted.widgetOrigin.handoffId='cutlist_'+'b'.repeat(64);await assert.rejects(()=>f.route(f.args,{approved:true}),/真实用户审核交接/);
});

test('assembly rejects stale source and late handoff changes before any output receipt',async()=>{
 const f=await assemblyFixture();f.setSource(false);await assert.rejects(()=>f.route(f.args,{approved:true}),/actual source replaced/);assert.equal(f.requests.length,0);assert.equal(f.disposed(),1);
 f.setSource(true);let release;f.setGate(new Promise(resolve=>release=resolve));const pending=f.route(f.args,{approved:true});await until(()=>f.requests.length===1);f.accepted.widgetOrigin.callId='foreign-call';release();await assert.rejects(pending,/actual source changed/);assert.equal(f.outputs.size,0);assert.equal(f.trace.cutlistAssemblyReceipts,undefined);
});

test('normal traced mutation denial cannot execute assembly; confirmed route persists its actual result trace',async()=>{
 const {executeTracedCall}=await import('../src/features/agent-execution/trace.mjs'),f=await assemblyFixture(),call={name:'cutlist_assemble',callId:'assemble-call',args:f.args};
 const changed=trace=>{if(!f.chat.messages.includes(trace))f.chat.messages.push(trace);};
 const denied=await executeTracedCall(call,{confirm:()=>false,execute:()=>assert.fail('denied mutation ran'),changed,createId:()=> 'denied-assembly'});assert.match(denied.result.error,/拒绝/);assert.equal(f.requests.length,0);
 const accepted=await executeTracedCall({...call,callId:'assemble-confirmed'},{confirm:()=>true,execute:(name,args)=>{assert.equal(name,'cutlist_assemble');return f.route(args,{approved:true});},changed,createId:()=> 'executed-assembly'});
 assert.equal(accepted.result.saved,true);assert.equal(accepted.result.nodeIds[0],'real-output');const stored=f.chat.messages.find(trace=>trace.id==='executed-assembly');assert.equal(stored.status,'done');assert.deepEqual(stored.result,accepted.result);assert.equal(f.trace.cutlistAssemblyReceipts.length,1);
});

test('assembly receipt persistence rejects false and compensates failed writes without exporting failed history receipts',async()=>{
 const initial=await assemblyFixture();initial.setPersistHook(()=>false);await assert.rejects(()=>initial.route(initial.args,{approved:true}),/尚未实际保存/);assert.equal(initial.requests.length,0);assert.equal(initial.trace.cutlistAssemblyReceipts,undefined);
 for(const mode of ['false','throw']){const f=await assemblyFixture();f.setPersistHook(count=>{if(count===2){if(mode==='false')return false;throw Error('actual final write failed');}});await assert.rejects(()=>f.route(f.args,{approved:true}),/已撤销该回执/);assert.equal(f.outputs.size,1,'actual saved graph output remains');assert.equal(f.trace.cutlistAssemblyReceipts,undefined);assert.equal(f.persists(),3,'rollback has its own real persistence attempt');}
 const failed=await assemblyFixture();failed.setPersistHook(count=>count>=2?false:undefined);await assert.rejects(()=>failed.route(failed.args,{approved:true}),/会话回执及补偿保存失败/);assert.equal(failed.outputs.size,1);assert.equal(failed.trace.cutlistAssemblyReceipts,undefined);
});

test('late assembly receipt save failure preserves another successful receipt and commits its compensation',async()=>{
 const f=await assemblyFixture();let rejectSaving;const gate=new Promise((_,reject)=>rejectSaving=reject);f.setPersistHook(count=>count===2?gate:undefined);const pending=f.route(f.args,{approved:true});await until(()=>f.persists()===2);
 const newReceipt={operationId:f.args.operation_id,trace_id:f.trace.id,handoff_id:f.args.handoff_id,nodeIds:['later-real-output'],applied:true,saved:true};f.trace.cutlistAssemblyReceipts=[...f.trace.cutlistAssemblyReceipts,newReceipt];rejectSaving(Error('late first write failed'));
 await assert.rejects(pending,/已撤销该回执/);assert.deepEqual(f.trace.cutlistAssemblyReceipts,[newReceipt]);assert.equal(f.persists(),3);assert.equal(f.outputs.size,1);
});

test('assembly final commit followed by plan change rolls back only its receipt and persists compensation',async()=>{
 const f=await assemblyFixture();f.setPersistHook(count=>{if(count===2)f.trace.appState.shots['source-video'].out_ms=1700;});await assert.rejects(()=>f.route(f.args,{approved:true}),/已撤销该回执/);assert.equal(f.trace.cutlistAssemblyReceipts,undefined);assert.equal(f.trace.appState.shots['source-video'].out_ms,1700);assert.equal(f.outputs.size,1);assert.equal(f.persists(),3);
});

test('assembly conversation save deletion of actual output rejects and compensates its temporary receipt',async()=>{
 const f=await assemblyFixture();f.setPersistHook(count=>{if(count===2)f.outputs.delete(f.args.operation_id);});await assert.rejects(()=>f.route(f.args,{approved:true}),/已撤销该回执.*actual output removed/);assert.equal(f.trace.cutlistAssemblyReceipts,undefined);assert.equal(f.persists(),3);assert.equal(f.disposed(),1);
});
