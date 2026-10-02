const test=require('node:test'),assert=require('node:assert/strict');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function until(check){for(let i=0;i<80;i++){if(check())return;await tick();}assert.fail('controller did not reach expected state');}

test('actual actor controller serializes state commits, retries restored state and guards persisted guide through queue commit',async()=>{
 const {createRequire}=require('node:module'),fabricRequire=createRequire(require.resolve('fabric')),domRequire=createRequire(fabricRequire.resolve('jsdom'));
 const canvasPath=domRequire.resolve('canvas'),previousCanvas=require.cache[canvasPath];require.cache[canvasPath]={id:canvasPath,loaded:true,exports:{createCanvas:undefined}};
 let JSDOM;try{({JSDOM}=fabricRequire('jsdom'));}finally{if(previousCanvas)require.cache[canvasPath]=previousCanvas;else delete require.cache[canvasPath];}
 const {createAppController,prepareApp}=await import('../src/features/agent-apps/integration.mjs'),helper=await import('../src/features/agent-apps/actor-emotion.mjs'),{createActorGuideRuntime}=await import('../src/features/agent-apps/actor-guide-runtime.mjs');
 const dom=new JSDOM('<body></body>',{url:'http://localhost:4173/'}),previousDocument=globalThis.document;globalThis.document=dom.window.document;
 let sequence=0;dom.window.crypto.randomUUID=()=>`state-controller-${++sequence}`;Object.defineProperty(dom.window.navigator,'userActivation',{value:{isActive:true}});
 const image='data:image/webp;base64,UklGRi4AAABXRUJQVlA4TCIAAAAv/8F/AAdQvALWrf8BgUCyv/cMRfQ/4z//+c9//vOf//wf';
 const args={resource_uri:helper.actorEmotionUri,data:{mode:'video',scene:'雨夜告别',source:{node_ref:'node/source',media_kind:'video'},actor:{binding_id:'aem_0123456789abcdef',name:'林岚',role:'主角',reference_nodes:[{node_ref:'node/actor',preview_url:image}]},face:{valence:-50,stance:-20,intensity:60},voice:{preset:'tender',intensity:40}}};
 const trace={id:'state-trace',name:'show_app',status:'done',args,result:prepareApp(args)},chat={id:'state-chat',messages:[trace]},data=trace.result.response;
 const source={id:'source',type:'video',video:'asset:source'},graph={nodes:[source,{id:'actor',type:'image',image:'asset:actor'}],edges:[]},assets=new Map();
 let guideCalls=0,graphCommits=0,conversationCommits=0,queueCalls=0,drains=0,queueGuard;
 const queueCommit=deferred(),saves=[],errors=[];
 const runtime=createActorGuideRuntime({app:{getState:()=>graph,createConnected(id,outputs){const node={...outputs[0],id:'actual-guide'};graph.nodes.push(node);graph.edges.push({id:'guide-edge',source:id,target:node.id});return[node];}},localAssets:{put:async blob=>{assets.set('asset:guide',blob);return'asset:guide';},url:async id=>id},store:{save:async()=>{graphCommits++;return true;},flush:async()=>{}},getProjectId:()=> 'state-project',persistConversation:async()=>{conversationCommits++;},fetchImpl:async id=>({ok:assets.has(id),blob:async()=>assets.get(id)}),decodeImage:async()=>({width:512,height:512}),createObjectURL:()=> 'blob:fixture',revokeObjectURL:()=>{}});
 const controller=createAppController({getContext:()=>({chat,panelActive:true,pageLeaving:false,streaming:false}),getActorSourceContext:(value,currentTrace,currentChat)=>runtime.capture(value,{trace:currentTrace,chat:currentChat,isCurrent:()=>trace.result.response===data}),onError:message=>errors.push(message),onSaveState:async(currentChat,currentTrace,state)=>{
   const gate=deferred(),previous=currentTrace.appState;currentTrace.appState=state;saves.push({state,gate});
   try{await gate.promise;}catch(error){if(currentTrace.appState===state){if(previous===undefined)delete currentTrace.appState;else currentTrace.appState=previous;}throw error;}
  },onSaveExpressionGuide:async(...values)=>{guideCalls++;return runtime.save(...values);},onQueuePrompt:async(text,currentTrace,currentChat,metadata,isCurrent)=>{
   queueCalls++;queueGuard=isCurrent;if(queueCalls===1)await queueCommit.promise;
   const accepted=isCurrent();if(accepted)drains++;return accepted;
  }});
 let iframe,nonce;const sent=[];
 const rpc=(method,params,id)=>dom.window.dispatchEvent(new dom.window.MessageEvent('message',{source:iframe.contentWindow,data:{jsonrpc:'2.0',nonce,method,params,...id?{id}:{}}}));
 const initialize=()=>{nonce=`state-controller-${sequence}`;rpc('ui/initialize',{},`initialize-${sequence}`);rpc('ui/notifications/initialized',{});iframe.focus();};
 const response=id=>sent.findLast(item=>item.id===id);
 const message=()=>helper.actorEmotionConfirmation(data,trace.appState,trace.actorExpressionGuide);
 try{
  const element=controller.render(trace);dom.window.document.body.append(element);iframe=element.querySelector('iframe');iframe.contentWindow.postMessage=value=>sent.push(structuredClone(value));
  // A real iframe reload goes through the host generation/ready callbacks.
  iframe.dispatchEvent(new dom.window.Event('load'));initialize();await until(()=>saves.length===1);
  const a=helper.initialActorEmotionState(data),b=structuredClone(a);a.face.intensity=61;b.face.intensity=62;
  rpc('tapnow/setWidgetState',{state:a},'save-a');rpc('tapnow/setWidgetState',{state:b},'save-b');
  rpc('tools/call',{name:helper.actorExpressionGuideTool,arguments:{binding:data.actor.binding_id,mode:data.mode,source_node_ref:data.source.node_ref,actor_reference_node_refs:['node/actor'],face:b.face,locale:data.locale,image_data_uri:image},_meta:{'tapnow/callId':'actor-controller-real-guide'}},'guide');
  assert.equal(guideCalls,0);assert.equal(saves.length,1);
  saves[0].gate.resolve();await until(()=>saves.length===2);assert.deepEqual(saves[1].state,a);assert.equal(guideCalls,0);
  saves[1].gate.resolve();await until(()=>saves.length===3);assert.deepEqual(saves[2].state,b);await tick();assert.equal(guideCalls,0,'guide must await the newest queued state commit');
  saves[2].gate.resolve();await until(()=>response('guide'));
  assert.equal(response('guide').error,undefined);assert.equal(guideCalls,1);assert.equal(graphCommits,1);assert.equal(conversationCommits,1);assert.equal(response('guide').result.structuredContent.node_ref,'node/actual-guide');
  rpc('ui/message',{content:[{type:'text',text:message()}]},'first-confirm');await until(()=>queueCalls===1);assert.equal(queueGuard(),true);
  source.video='asset:changed';assert.equal(queueGuard(),false,'runtime snapshot errors become a rejected queue guard');source.video='asset:source';assert.equal(queueGuard(),true);
  const savedGuide=trace.actorExpressionGuide;trace.actorExpressionGuide=structuredClone(savedGuide);assert.equal(queueGuard(),false,'replacing even equal guide content invalidates the pending confirmation');trace.actorExpressionGuide=savedGuide;assert.equal(queueGuard(),true);
  const unchangedState=trace.appState;rpc('tapnow/setWidgetState',{state:b},'state-during-confirm');assert.equal(trace.appState,unchangedState);assert.equal(queueGuard(),false,'a newly queued state save invalidates confirmation before any optimistic assignment');
  queueCommit.resolve();await until(()=>response('first-confirm'));assert.equal(drains,0);assert.ok(response('first-confirm').error);
  await until(()=>saves.length===4);saves[3].gate.resolve();await until(()=>response('state-during-confirm'));
  const failed=structuredClone(b);failed.face.intensity=0;rpc('tapnow/setWidgetState',{state:failed},'failed-state');await until(()=>saves.length===5);saves[4].gate.reject(Error('state storage failed'));await until(()=>response('failed-state'));assert.deepEqual(trace.appState,b);
  // Reload with a newer edit already queued: retry reads its committed value
  // only after that edit, instead of overwriting it with the older snapshot.
  const newer=structuredClone(b);newer.active_tab='voice';rpc('tapnow/setWidgetState',{state:newer},'newer-state');
  iframe.dispatchEvent(new dom.window.Event('load'));initialize();await until(()=>saves.length===6);assert.deepEqual(saves[5].state,newer);
  saves[5].gate.resolve();await until(()=>saves.length===7);assert.deepEqual(saves[6].state,newer,'reload retry must preserve newer queued edits');assert.equal(queueCalls,1);
  rpc('ui/message',{content:[{type:'text',text:message()}]},'restored-confirm');await tick();assert.equal(queueCalls,1,'confirmation waits for actual reload retry persistence');
  saves[6].gate.resolve();await until(()=>response('restored-confirm'));assert.equal(response('restored-confirm').error,undefined);assert.equal(queueCalls,2);assert.equal(drains,1);assert.deepEqual(trace.appState,newer);assert.deepEqual(errors,[]);
 }finally{for(const save of saves)save.gate.resolve();queueCommit.resolve();controller.reset();dom.window.close();if(previousDocument===undefined)delete globalThis.document;else globalThis.document=previousDocument;}
});
