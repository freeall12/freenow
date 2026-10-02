const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const tick=()=>new Promise(setImmediate),deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
const uri=name=>'ui://tapnow/'+name+'@v1';
class Surface {constructor(){this.events=new Map();}addEventListener(name,fn){if(!this.events.has(name))this.events.set(name,new Set());this.events.get(name).add(fn);}removeEventListener(name,fn){this.events.get(name)?.delete(fn);}emit(name,event){for(const fn of this.events.get(name)||[])fn(event);}}
async function hostFixture(resourceUri,callbacks){
 const {createMcpAppHost}=await import('../src/features/agent-apps/host.mjs'),window=new Surface(),iframe=new Surface(),sent=[];
 Object.assign(window,{crypto:require('node:crypto').webcrypto,navigator:{userActivation:{isActive:false}},setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,clearInterval(){}});
 iframe.ownerDocument={defaultView:window,activeElement:null};iframe.isConnected=true;iframe.contentWindow={postMessage:value=>sent.push(structuredClone(value))};
 let current=true;const host=createMcpAppHost({iframe,resourceUri,callbacks,allowResource:()=>true,isCurrent:()=>current});host.start();
 const nonce=()=>sent.findLast(value=>value.method==='ui/notifications/sandbox-resource-ready').nonce;
 const rpc=(id,method,params={},user=false)=>{iframe.ownerDocument.activeElement=user?iframe:null;window.navigator.userActivation.isActive=user;window.emit('message',{source:iframe.contentWindow,data:{jsonrpc:'2.0',nonce:nonce(),id,method,params}});window.navigator.userActivation.isActive=false;};
 rpc('init','ui/initialize');window.emit('message',{source:iframe.contentWindow,data:{jsonrpc:'2.0',nonce:nonce(),method:'ui/notifications/initialized'}});
 return{host,rpc,response:id=>sent.findLast(value=>value.id===id),iframe,setCurrent:value=>current=value};
}

test('new app schemas expose only current integrated workflows and host-owned personal library inputs',()=>{
 const scope={};vm.runInNewContext(fs.readFileSync(require.resolve('../agent-tools.js'),'utf8'),scope);const tools=scope.AgentTools;
 const progress={resource_uri:uri('production-progress'),data:{node_ids:['actual-source'],project_id:'actual-project'}};
 assert.equal(tools.parse('show_app',progress).args.resource_uri,progress.resource_uri);
 assert.throws(()=>tools.parse('show_app',{...progress,data:{node_ids:['actual-source','actual-source']}}));
 for(const data of [{assets:[]},{folders:[]},{scope:'team'},{source_url:'https://example.com/x'}])assert.throws(()=>tools.parse('show_app',{resource_uri:uri('library-picker'),data}));
 assert.equal(tools.parse('show_app',{resource_uri:uri('library-picker'),data:{applied:{types:['image']},can_add_to_canvas:true}}).args.resource_uri,uri('library-picker'));
 assert.throws(()=>tools.parse('show_app',{resource_uri:uri('interactive-learning'),data:{view:'board'}}));
});

test('production tools polling is read-only without activation and rejects other tools or stale responses',async()=>{
 const gate=deferred();let count=0,guard;
 const f=await hostFixture(uri('production-progress'),{onProductionProgressQuery:(args,current)=>{count++;guard=current;assert.deepEqual(args,{node_ids:['real']});return gate.promise;}});
 try{
  assert.deepEqual(f.response('init').result.hostCapabilities,{serverTools:{}});
  f.host.updateConversationRunActive(true);f.rpc(42,'tools/call',{name:'get_production_result',arguments:{node_ids:['real']},_meta:{progressToken:42}});assert.equal(count,1);assert.equal(guard(),true);
  f.rpc('foreign','tools/call',{name:'generation_submit',arguments:{}});assert.equal(f.response('foreign').error.code,-32601);
  f.rpc('state','tapnow/setWidgetState',{state:{items:[]}});assert.equal(f.response('state').error.code,-32601);
  f.rpc('message','ui/message',{content:[{type:'text',text:'generate'}]},true);assert.equal(f.response('message').error.code,-32601);
  f.setCurrent(false);assert.equal(guard(),false);gate.resolve({content:[],structuredContent:{items:[{node_id:'real',status:'running'}]}});await tick();assert.equal(f.response(42),undefined);
 }finally{f.host.dispose();}
});

test('library host has exactly its dedicated query/context/import methods, user mutations require active iframe',async()=>{
 const calls=[];const f=await hostFixture(uri('library-picker'),{
  onLibraryFind:(args,options)=>{calls.push({args,options});return{content:[],structuredContent:{items:[]}};},
  onLibraryModelContext:(params,options)=>{calls.push({params,options});return{};},
  onLibraryAddToCanvas:(params,options)=>{calls.push({params,options});return{node_ref:'node/actual'};},
 });
 try{
  assert.deepEqual(f.response('init').result.hostCapabilities,{serverTools:{},updateModelContext:{}});
  f.rpc('restore','tools/call',{name:'find_library_assets',arguments:{scope:'private',query:'saved query'}});await tick();assert.equal(calls[0].options.restore,true);assert.equal(calls[0].options.userAction,false);
  f.rpc('foreign','tools/call',{name:'get_production_result',arguments:{}});assert.equal(f.response('foreign').error.code,-32601);
  f.rpc('passive','tapnow/addToCanvas',{asset:{}});assert.match(f.response('passive').error.message,/user action/);
  f.rpc('context','ui/update-model-context',{content:[{type:'text',text:'verified asset context'}]},true);await tick();assert.deepEqual(f.response('context').result,{});assert.equal(calls.at(-1).options.userAction,true);
  f.rpc('add','tapnow/addToCanvas',{asset:{name:'actual'}},true);await tick();assert.deepEqual(f.response('add').result,{node_ref:'node/actual'});
  f.rpc('open','ui/open-link',{url:'https://example.com'},true);assert.equal(f.response('open').error.code,-32601);
 }finally{f.host.dispose();}
});

async function productionFixture(overrides={}){
 const {createProductionProgressRuntime}=await import('../src/features/agent-apps/production-progress-runtime.mjs'),{prepareApp}=await import('../src/features/agent-apps/registry.mjs');
 const source={id:'source',type:'image',title:'真实来源',image:'asset:old'},output={id:'output',type:'image',title:'真实结果',image:'asset:actual'},graph={nodes:[source,output]},generation={id:'job-actual',status:'running',request:{nodeId:'source',kind:'image.generate'},resultIds:[],outputs:[{type:'image',url:'asset:actual'}]};
 const submitted={id:'submitted',name:'generation_submit',status:'done',args:{nodeId:'source',kind:'image.generate'},result:{taskId:generation.id,status:'running'}},chat={id:'chat',messages:[submitted]};let project='actual-project',current=true,reads=0;const revoked=[];
 const runtime=createProductionProgressRuntime({app:{getState:()=>graph},generationAPI:{getJobs:()=>[generation]},getProjectId:()=>project,localAssets:{url:async id=>id},fetchImpl:async id=>{reads++;assert.equal(id,'asset:actual');return new Response(Uint8Array.from([137,80,78,71,13,10,26,10]),{headers:{'content-type':'image/png'}});},createObjectURL:()=> 'blob:http://localhost:4173/01234567-89ab-4def-8123-0123456789ab',revokeObjectURL:value=>revoked.push(value),...overrides});
 const args=await runtime.prepareAppArgs({resource_uri:uri('production-progress'),data:{node_ids:['source']}},{chat,isCurrent:()=>current});
 const result=runtime.bindPreparedResult(prepareApp(args),args),trace={id:'progress',name:'show_app',status:'done',args,result};chat.messages.push(trace);
 const context=runtime.capture(result.response,{trace,chat,isCurrent:()=>current});
 return{runtime,context,generation,graph,output,submitted,chat,args,trace,reads:()=>reads,revoked,setCurrent:value=>current=value,setProject:value=>project=value};
}

test('production runtime binds actual conversation receipt, queries live state and previews applied output bytes',async()=>{
 const f=await productionFixture(),query={node_ids:['source'],project_id:'actual-project'};
 try{
  assert.equal((await f.context.query(query)).structuredContent.items[0].status,'running');assert.equal(f.reads(),0,'pending source media is never a completed preview');
  f.generation.status='succeeded';assert.equal((await f.context.query(query)).structuredContent.items[0].status,'running');
  f.generation.applied=true;f.generation.resultIds=['output'];const result=await f.context.query(query);
  assert.equal(result.structuredContent.items[0].status,'done');assert.match(result.structuredContent.items[0].media_url,/^data:image\/png;base64,/);assert.equal(f.reads(),1);
  f.graph.nodes=f.graph.nodes.filter(node=>node!==f.output);assert.equal((await f.context.query(query)).structuredContent.items[0].status,'not_found');
  await assert.rejects(()=>f.context.query({node_ids:['foreign'],project_id:'actual-project'}));
  await assert.rejects(()=>f.runtime.prepareAppArgs({resource_uri:uri('production-progress'),data:{node_ids:['invented']}},{chat:f.chat}));
  f.setProject('other');assert.equal(f.context.guard(),false);await assert.rejects(()=>f.context.query(query));
 }finally{f.context.dispose();}assert.equal(f.revoked.length,0);
});

test('production runtime rejects iframe operation loss before media receipt without changing tasks',async()=>{
 const f=await productionFixture();try{
  f.generation.status='succeeded';f.generation.applied=true;f.generation.resultIds=['output'];
  await assert.rejects(()=>f.context.query({node_ids:['source'],project_id:'actual-project'},{isCurrent:()=>false}));assert.equal(f.reads(),0);assert.equal(f.generation.status,'succeeded');
  f.submitted.result={taskId:'different'};assert.equal(f.context.guard(),false);
 }finally{f.context.dispose();}
});


test('actual app queue stores a real personal library reference consumed by the media input pipeline',async()=>{
 const queue=await import('../src/features/agent-queue/model.mjs'),composer=await import('../src/features/agent-composer/editor-state.mjs'),references=await import('../src/features/agent-composer/reference-data.mjs'),media=await import('../src/features/agent-attachments/media-inputs.mjs');
 const item={id:'real-library-image',name:'实际库图片',type:'image',scope:'personal',folder:'角色',image:'asset:actual-media'},library={items:[item],folders:['角色']};
 const trace={id:'library-trace',name:'show_app',status:'done',result:{kind:'mcp_app',resource_uri:uri('library-picker'),response:{}},appState:{scope:'private',query:'',folder:null,picked_asset_id:null}},chat={id:'actual-chat',messages:[trace],queuedMessages:[]};
 const source=fs.readFileSync(require.resolve('../agent-client.js'),'utf8'),begin=source.indexOf(' function queueWidgetPrompt('),end=source.indexOf(' function send(){',begin);let drains=0;
 const scope={recoveryRunning:false,appQueueSaving:false,pageLeaving:false,panel:{},draft:()=>chat,busy:false,queueRunner:{running:false,drain(){drains++;}},queueModule:queue,modelModule:{prepareSessionSelection:()=>({model:'fixture'})},composerModule:composer,liveLibrary:()=>library,clone:structuredClone,validateSubmission(){},persistQueue(){},flushConversation:async()=>{},track:fn=>fn(),render(){}};
 vm.runInNewContext(source.slice(begin,end)+';globalThis.queue=queueWidgetPrompt;',scope);
 const accepted=await scope.queue('请描述这张真实素材',trace,chat,{handoffId:'library_real_handoff',libraryReference:{kind:'library',id:item.id,scope:'personal',label:item.name,mediaType:'image'}},()=>true);
 assert.equal(accepted,true);assert.equal(drains,1);assert.equal(chat.queuedMessages.length,1);
 const submitted=chat.queuedMessages[0],refs=references.referenceNodes(submitted.composerDoc);assert.equal(refs.length,1);assert.equal(refs[0].id,item.id);
 const actual=references.resolveReferenceData(refs,{nodes:[],library:library.items});assert.equal(actual[0].image,item.image);
 class ImageSurface extends Surface{constructor(){super();this.tagName='IMG';this.naturalWidth=32;this.naturalHeight=32;}set src(value){assert.equal(value,'blob:actual-library-bytes');queueMicrotask(()=>this.emit('load'));}removeAttribute(){}}
 const previous=globalThis.document,drawn=[];globalThis.document={createElement(tag){return tag==='img'?new ImageSurface():{getContext:()=>({fillRect(){},drawImage:image=>drawn.push(image)}),toDataURL:()=> 'data:image/jpeg;base64,/9j/realpixels'};}};
 try{const inputs=await media.prepareMediaInputs(actual.map(item=>({name:item.name,asset:item.image,type:'image'})),{resolveUrl:async asset=>{assert.equal(asset,'asset:actual-media');return'blob:actual-library-bytes';}});assert.equal(inputs[0].name,item.name);assert.match(inputs[0].imageUrl,/^data:image/);assert.equal(drawn.length,1);}finally{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;}
});

test('production prepares actual multi-result placeholders and does not misreport a completed multi-result source as missing',async()=>{
 const f=await productionFixture();try{
  f.graph.nodes.push({id:'output2',type:'image',title:'第二个真实结果',image:'asset:actual'});f.generation.status='succeeded';f.generation.applied=true;f.generation.resultIds=['output','output2'];
  const result=await f.context.query({node_ids:['source'],project_id:'actual-project'});assert.equal(result.structuredContent.items[0].status,'done');assert.match(result.structuredContent.items[0].title,/2 个已应用结果/);
  const args=await f.runtime.prepareAppArgs({resource_uri:uri('production-progress'),data:{node_ids:['source']}},{chat:f.chat});assert.deepEqual(args.data.node_ids,['output','output2']);
 }finally{f.context.dispose();}
});

async function domFixture(){
 const {createRequire}=require('node:module'),fabricRequire=createRequire(require.resolve('fabric')),domRequire=createRequire(fabricRequire.resolve('jsdom')),canvasPath=domRequire.resolve('canvas'),cached=require.cache[canvasPath];
 require.cache[canvasPath]={id:canvasPath,loaded:true,exports:{createCanvas:undefined}};let JSDOM;try{({JSDOM}=fabricRequire('jsdom'));}finally{if(cached)require.cache[canvasPath]=cached;else delete require.cache[canvasPath];}
 const dom=new JSDOM('<body></body>',{url:'http://localhost:4173/'}),previous=globalThis.document;globalThis.document=dom.window.document;dom.window.crypto.randomUUID=()=>require('node:crypto').randomUUID();Object.defineProperty(dom.window.navigator,'userActivation',{value:{isActive:true}});
 return {dom,close(){dom.window.close();if(previous===undefined)delete globalThis.document;else globalThis.document=previous;}};
}
async function until(check){for(let index=0;index<60;index++){if(check())return;await tick();}assert.fail('expected controller transaction did not settle');}
function learningBoard(){return{view:'board',level:{key:'L1',title:'实际练习',why:'练习',media:'image',creator_prompt:'逆光人物',questions:{q2:{stem:'哪个描述光线？',options:[{text:'逆光',correct:true},{text:'低角度',correct:false}],explain:'逆光描述光线'},q3:{parts:['人物',''],blanks:['逆光'],bank:['逆光','顺光']},q4:{stem:'写下反推答案'},q5:{stem:'改编主体'}},hints:{}}};}

test('interactive controller persists actual board state before exact IL1 queue handoff and rejects unsaved drafts',async()=>{
 const f=await domFixture(),{createAppController,prepareApp}=await import('../src/features/agent-apps/integration.mjs'),{initialInteractiveLearningState}=await import('../src/features/agent-apps/interactive-learning.mjs');
 const args={resource_uri:uri('interactive-learning'),data:learningBoard()},trace={id:'learning-trace',name:'show_app',status:'done',args,result:prepareApp(args)},chat={id:'learning-chat',messages:[trace]},saves=[],queues=[],errors=[];
 const controller=createAppController({getContext:()=>({chat,panelActive:true,pageLeaving:false,streaming:false}),onSaveState:async(current,t,state)=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});const previous=t.appState;t.appState=state;saves.push({state,resolve,reject});try{await promise;}catch(error){t.appState=previous;throw error;}},onQueuePrompt:(text,t,current,metadata,guard)=>{assert.equal(guard(),true);queues.push({text,metadata});return true;},onError:message=>errors.push(message)});
 const element=controller.render(trace);f.dom.window.document.body.append(element);const iframe=element.querySelector('iframe'),sent=[];iframe.contentWindow.postMessage=value=>sent.push(structuredClone(value));
 const nonce=()=>sent.findLast(value=>value.method==='ui/notifications/sandbox-resource-ready')?.nonce;
 const rpc=(id,method,params={})=>f.dom.window.dispatchEvent(new f.dom.window.MessageEvent('message',{source:iframe.contentWindow,data:{jsonrpc:'2.0',nonce:nonce(),...id?{id}:{},method,params}}));
 const response=id=>sent.findLast(value=>value.id===id),initialize=()=>{rpc('init-'+sent.length,'ui/initialize');rpc(null,'ui/notifications/initialized');iframe.focus();};
 try{
  iframe.dispatchEvent(new f.dom.window.Event('load'));initialize();await until(()=>saves.length===1);
  const saved=initialInteractiveLearningState(trace.result.response);saved.drafts.q4='逆光人物';
  rpc('save-board','tapnow/setWidgetState',{state:saved});const message='提交关卡 L1 反推答案，请点评 — IL1 v=1;lvl=L1;ask=q4;ans=逆光人物';
  rpc('confirm-board','ui/message',{content:[{type:'text',text:message}]});assert.equal(queues.length,0);
  saves[0].resolve();await until(()=>saves.length===2);assert.equal(queues.length,0);saves[1].resolve();await until(()=>response('confirm-board'));
  assert.equal(response('confirm-board').error,undefined);assert.equal(queues.length,1);assert.match(queues[0].text,/实际提交/);assert.match(queues[0].metadata.handoffId,/^learning_/);
  rpc('unsaved','ui/message',{content:[{type:'text',text:message.replace('ans=逆光人物','ans=未保存改编')}]});await until(()=>response('unsaved'));assert.ok(response('unsaved').error);assert.equal(queues.length,1);
  const failed={...saved,drafts:{q4:'不会提交的答案'}};rpc('failed-save','tapnow/setWidgetState',{state:failed});await until(()=>saves.length===3);saves[2].reject(Error('actual storage failed'));await until(()=>response('failed-save'));
  assert.ok(response('failed-save').error);assert.deepEqual(trace.appState,saved);
  // A real reload retries the prior committed state, without claiming the
  // rejected edited draft was saved or reusing it as model context.
  iframe.dispatchEvent(new f.dom.window.Event('load'));initialize();await until(()=>saves.length===4);assert.deepEqual(saves[3].state,saved);saves[3].resolve();await tick();assert.equal(queues.length,1);
 }finally{for(const save of saves)save.resolve();controller.reset();f.close();}
});


test('production done projection rejects replaced output and aggregate deletion during actual media reading',async()=>{
 const f=await productionFixture();try{
  f.generation.status='succeeded';f.generation.applied=true;f.generation.resultIds=['output'];f.output.image='asset:edited';
  assert.equal((await f.context.query({node_ids:['source'],project_id:'actual-project'})).structuredContent.items[0].status,'unknown');assert.equal(f.reads(),0);
  f.output.image='asset:actual';const second={id:'output2',type:'image',image:'asset:actual'};f.graph.nodes.push(second);f.generation.resultIds=['output','output2'];
  const reading=f.context.query({node_ids:['source'],project_id:'actual-project'});f.graph.nodes=f.graph.nodes.filter(node=>node!==second);await assert.rejects(reading,/制作结果已变化/);
 }finally{f.context.dispose();}
});


test('production preview stream rejects declared/actual byte budgets and aborts pending reads on disposal or timeout',async()=>{
 const {productionPreviewBudget}=await import('../src/features/agent-apps/production-progress-runtime.mjs');
 for(const declared of [true,false]){
  const f=await productionFixture({previewBudget:{...productionPreviewBudget,imageBytes:4},fetchImpl:async()=>new Response(new Uint8Array(8),{headers:{'content-type':'image/png',...declared?{'content-length':'8'}:{}}})});
  try{f.generation.status='succeeded';f.generation.applied=true;f.generation.resultIds=['output'];await assert.rejects(()=>f.context.query({node_ids:['source'],project_id:'actual-project'}),/超过预览读取预算/);assert.equal(f.generation.status,'succeeded');assert.equal(f.generation.applied,true);}finally{f.context.dispose();}
 }
 for(const mode of ['dispose','timeout']){
  let signal;const gate=deferred(),f=await productionFixture({previewBudget:{...productionPreviewBudget,timeoutMs:mode==='timeout'?15:30000},fetchImpl:(_,options)=>{signal=options.signal;return gate.promise;}});
  try{f.generation.status='succeeded';f.generation.applied=true;f.generation.resultIds=['output'];const pending=f.context.query({node_ids:['source'],project_id:'actual-project'});await until(()=>signal);if(mode==='dispose')f.context.dispose();await assert.rejects(pending,mode==='dispose'?/已关闭/:/超时/);assert.equal(signal.aborted,true);assert.equal(f.generation.status,'succeeded');assert.equal(f.generation.applied,true);}finally{gate.resolve(new Response(new Uint8Array(8),{headers:{'content-type':'image/png'}}));f.context.dispose();}
 }
});


test('dedicated production proxy keeps opaque isolation and bounded real MP4 transport retains video semantics',async()=>{
 const {appPolicy}=await import('../src/features/agent-apps/registry.mjs'),source=fs.readFileSync(require.resolve('../src/features/agent-apps/resources/production-progress-proxy.html'),'utf8'),original=fs.readFileSync(require.resolve('../src/features/agent-apps/resources/mcp-app-proxy.html'),'utf8');
 assert.match(appPolicy(uri('production-progress')).proxyUrl,/production-progress-proxy.html$/);assert.match(appPolicy(uri('library-picker')).proxyUrl,/mcp-app-proxy.html$/);assert.match(source,/mediaSources = "blob: data:"/);assert.match(original,/mediaSources = "blob:"/);assert.match(source,/inner.setAttribute\("sandbox", "allow-scripts"\)/);assert.match(source,/params.resource.name !== "production-progress"/);assert.match(source,/connect-src 'none'/);assert.doesNotMatch(source,/imgSources \+=|mediaSources \+=/);
 const bytes=fs.readFileSync(require.resolve('../qa/trim-scenes.mp4')),f=await productionFixture({fetchImpl:async()=>new Response(bytes,{headers:{'content-type':'video/mp4'}})});
 f.output.type='video';f.output.video='asset:actual';delete f.output.image;f.generation.request.kind='video.generate';f.generation.outputs=[{type:'video',url:'asset:actual'}];f.generation.status='succeeded';f.generation.applied=true;f.generation.resultIds=['output'];
 const previous=globalThis.document;globalThis.document={createElement(tag){assert.equal(tag,'video');return{videoWidth:160,videoHeight:90,duration:1.12,load(){if(this.onloadeddata)queueMicrotask(()=>this.onloadeddata?.());},removeAttribute(){}};}};
 try{const item=(await f.context.query({node_ids:['source'],project_id:'actual-project'})).structuredContent.items[0];assert.equal(item.status,'done');assert.equal(item.media_type,'video');assert.match(item.media_url,/^data:video\/mp4;base64,/);assert.deepEqual(Buffer.from(item.media_url.split(',')[1],'base64'),bytes);assert.ok(!item.title.includes('首帧'));}finally{f.context.dispose();if(previous===undefined)delete globalThis.document;else globalThis.document=previous;}
});

test('production stream cancels non-OK bodies and suppresses oversized video preview without altering true task completion',async()=>{
 let cancelled=0;const f=await productionFixture({fetchImpl:async()=>({ok:false,body:{cancel:()=>{cancelled++;return Promise.resolve();}}})});
 try{f.generation.status='succeeded';f.generation.applied=true;f.generation.resultIds=['output'];await assert.rejects(()=>f.context.query({node_ids:['source'],project_id:'actual-project'}),/读取失败/);assert.equal(cancelled,1);}finally{f.context.dispose();}
 const {productionPreviewBudget}=await import('../src/features/agent-apps/production-progress-runtime.mjs'),g=await productionFixture({previewBudget:{...productionPreviewBudget,videoBytes:4},fetchImpl:async()=>new Response(new Uint8Array(8),{headers:{'content-type':'video/mp4','content-length':'8'}})});
 try{g.output.type='video';g.output.video='asset:actual';delete g.output.image;g.generation.request.kind='video.generate';g.generation.outputs=[{type:'video',url:'asset:actual'}];g.generation.status='succeeded';g.generation.applied=true;g.generation.resultIds=['output'];const item=(await g.context.query({node_ids:['source'],project_id:'actual-project'})).structuredContent.items[0];assert.equal(item.status,'done');assert.equal(item.media_type,'video');assert.equal(item.media_url,undefined);assert.match(item.title,/预览超限，未加载播放/);assert.equal(g.generation.applied,true);}finally{g.context.dispose();}
});
