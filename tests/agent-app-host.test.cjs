const test=require('node:test'),assert=require('node:assert/strict');
const modulePromise=import('../src/features/agent-apps/host.mjs');
const tick=()=>new Promise(setImmediate),deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
class Surface {constructor(){this.listeners=new Map();}addEventListener(type,fn){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(fn);}removeEventListener(type,fn){this.listeners.get(type)?.delete(fn);}emit(type,event={}){for(const fn of [...this.listeners.get(type)||[]])fn(event);}}
async function fixture(extra={}){
 const {createMcpAppHost}=await modulePromise,window=new Surface(),iframe=new Surface(),sent=[],errors=[],sizes=[],prompts=[],saved=[],timers=new Map(),intervals=new Map();let ready=0,current=true,sequence=0,time=10000;
 const originalNow=Date.now;Date.now=()=>time;
 Object.assign(window,{crypto:{randomUUID:()=>require('node:crypto').randomUUID()},navigator:{userActivation:{isActive:false}},setTimeout(fn,ms){const id=++sequence;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id),setInterval(fn,ms){const id=++sequence;intervals.set(id,{fn,ms});return id;},clearInterval:id=>intervals.delete(id)});
 const document={defaultView:window,activeElement:null};Object.assign(iframe,{ownerDocument:document,isConnected:true,contentWindow:{postMessage(message,target){assert.equal(target,'*');sent.push(structuredClone(message));}}});
 const callbacks={onReady(){ready++;},onError:message=>errors.push(message),onSizeChanged:height=>sizes.push(height),onSendPrompt:(text,meta)=>{prompts.push({text,meta});return true;},onSetWidgetState:state=>{saved.push(state);return true;},...extra.callbacks};
 const host=createMcpAppHost({iframe,resourceUri:'ui://tapnow/motion-picker@v1',toolInput:{original_request:'镜头设计'},toolResult:{summary:'选择镜头',templates:[{id:'a',media_ref:'private',poster_ref:'private',label:'侧移'}]},initialWidgetState:{selected:'a'},isCurrent:()=>current,allowResource:uri=>uri==='ui://tapnow/motion-picker@v1',...extra,callbacks});
 host.start();
 const nonce=()=>sent.findLast(item=>item.method==='ui/notifications/sandbox-resource-ready')?.nonce;
 function emit(data,source=iframe.contentWindow){window.emit('message',{source,data:{jsonrpc:'2.0',nonce:nonce(),...data},origin:'null'});}
 function rpc(id,method,params={},user=false){if(user){time+=1001;document.activeElement=iframe;window.navigator.userActivation.isActive=true;}emit({id,method,params});if(user)window.navigator.userActivation.isActive=false;}
 function initialize(){rpc('initialize-'+sequence,'ui/initialize',{protocolVersion:'2026-01-26',appCapabilities:{},appInfo:{name:'fixture',version:'1'}});emit({method:'ui/notifications/initialized'});}
 return{host,iframe,document,window,sent,errors,sizes,prompts,saved,timers,intervals,nonce,emit,rpc,initialize,get ready(){return ready;},setCurrent(value){current=value;},response:id=>sent.findLast(item=>item.id===id),close(){host.dispose();Date.now=originalNow;}};
}

test('message commit source guard becomes stale on iframe reload before the queue receipt',async()=>{
 const pending=deferred();let current;const f=await fixture({callbacks:{onSendPrompt:(text,meta,guard)=>{current=guard;return pending.promise;}}});
 try{
  f.initialize();f.rpc('pending-reload','ui/message',{content:[{type:'text',text:'confirmed app content'}]},true);
  assert.equal(current(),true);f.iframe.emit('load');f.iframe.emit('load');assert.equal(current(),false);
  pending.resolve(false);await tick();assert.equal(f.response('pending-reload'),undefined);
 }finally{f.close();}
});

test('director markup explicit state budget persists and restores UTF-8 content up to 128KiB',async()=>{
 const state={draft:'雨'.repeat(24000)},f=await fixture({widgetStateLimit:128*1024,initialWidgetState:state});try{
  f.initialize();assert.deepEqual(f.sent.find(item=>item.method==='ui/notifications/tool-result').params._meta['tapnow/widgetState'],state);
  f.rpc('large-state','tapnow/setWidgetState',{state});await tick();assert.deepEqual(f.response('large-state').result,{});assert.deepEqual(f.saved,[state]);
  f.rpc('too-large-state','tapnow/setWidgetState',{state:{draft:'雨'.repeat(44000)}});assert.equal(f.response('too-large-state').error.code,-32602);assert.equal(f.saved.length,1);
 }finally{f.close();}
});

test('official proxy handshake requires frame identity then nonce and initializes actual input/result/widgetState',async()=>{
 const f=await fixture();try{
  const ready=f.sent[0];assert.equal(ready.method,'ui/notifications/sandbox-resource-ready');assert.equal(ready.params.nonce,ready.nonce);assert.deepEqual(ready.params.resource,{name:'motion-picker',version:'v1'});
  const before=f.sent.length;f.emit({method:'ui/notifications/sandbox-proxy-ready',nonce:undefined},{});assert.equal(f.sent.length,before);
  f.emit({method:'ui/notifications/sandbox-proxy-ready',nonce:undefined});assert.equal(f.sent.length,before+1);
  f.emit({id:1,method:'ui/initialize',nonce:'wrong'});assert.equal(f.response(1),undefined);
  f.emit({method:'ui/notifications/initialized'});assert.equal(f.ready,0);
  f.rpc(2,'ui/initialize');const result=f.response(2).result;assert.equal(result.protocolVersion,'2026-01-26');assert.deepEqual(result.hostCapabilities,{message:{text:{}}});assert.equal(result.hostContext.platform,'web');assert.equal(result.hostCapabilities.serverTools,undefined);
  f.emit({method:'ui/notifications/initialized'});assert.equal(f.ready,1);assert.equal(f.timers.size,0);assert.equal(f.intervals.size,0);
  assert.deepEqual(f.sent.find(item=>item.method==='ui/notifications/tool-input').params,{arguments:{original_request:'镜头设计'}});
  const output=f.sent.find(item=>item.method==='ui/notifications/tool-result').params;assert.equal(output.content[0].text,'选择镜头');assert.deepEqual(output.structuredContent.templates,[{id:'a',label:'侧移'}]);assert.deepEqual(output._meta,{'tapnow/widgetState':{selected:'a'}});
  f.emit({method:'ui/notifications/initialized'});assert.equal(f.ready,1,'duplicate readiness does not republish results');
 }finally{f.close();}
});

test('passive initialization and resize survive suspension, while active host callbacks require current context',async()=>{
 const f=await fixture();try{
  f.setCurrent(false);f.initialize();assert.equal(f.ready,1);
  for(const height of [NaN,Infinity,0,-1,'200'])f.emit({method:'ui/notifications/size-changed',params:{height}});
  f.emit({method:'ui/notifications/size-changed',params:{height:521.25}});assert.deepEqual(f.sizes,[521.25]);
  f.rpc('stale','tapnow/setWidgetState',{state:{selected:'b'}});f.rpc('stale-message','ui/message',{content:[{type:'text',text:'选择'}]},true);await tick();assert.deepEqual(f.saved,[]);assert.deepEqual(f.prompts,[]);assert.equal(f.response('stale'),undefined);
 }finally{f.close();}
});

test('motion-picker persists real state then sends metadata to the normal host queue with visible-host policy',async()=>{
 const f=await fixture();try{
  f.initialize();f.rpc('state','tapnow/setWidgetState',{state:{selected:'sideways'}});await tick();assert.deepEqual(f.saved,[{selected:'sideways'}]);assert.deepEqual(f.response('state').result,{});
  const params={content:[{type:'text',text:'选择 '},{type:'text',text:'侧移'}],_meta:{'tapnow/sendPrompt':{hidden:true,contextNodeIds:['node-a']},'tapnow/handoffId':'handoff_123'}};
  f.rpc('message','ui/message',params,true);await tick();assert.deepEqual(f.prompts,[{text:'选择 侧移',meta:{hidden:true,contextNodeIds:['node-a'],handoffId:'handoff_123'}}]);assert.deepEqual(f.response('message').result,{});
  f.iframe.emit('load');f.iframe.emit('load');f.initialize();const result=f.sent.findLast(item=>item.method==='ui/notifications/tool-result');assert.deepEqual(result.params._meta['tapnow/widgetState'],{selected:'sideways'});
 }finally{f.close();}
});

test('unconfigured tools, app reply, queue and storage fail explicitly without fake success',async()=>{
 const f=await fixture({callbacks:{onSendPrompt:undefined,onSetWidgetState:undefined}});try{
  f.initialize();for(const [id,method,params] of [['tool','tools/call',{name:'canvas_delete',arguments:{ids:['a']}}],['unknown','other/execute',{}],['queue','ui/message',{content:[{type:'text',text:'x'}]}],['state','tapnow/setWidgetState',{state:{}}]]){f.rpc(id,method,params,true);assert.equal(f.response(id).error.code,-32601);assert.equal(f.response(id).result,undefined);}
 }finally{f.close();}
 const bound=await fixture();try{bound.initialize();bound.rpc('reply','ui/message',{content:[{type:'text',text:'x'}],details:{type:'app_reply',action:'previs_reply'}},true);assert.equal(bound.response('reply').error.code,-32601);assert.equal(bound.prompts.length,0);}finally{bound.close();}
});

test('boot scripts, unfocused input, concurrent requests and rapid actions cannot enqueue arbitrary tasks',async()=>{
 const pending=deferred(),f=await fixture({callbacks:{onSendPrompt:()=>pending.promise}});try{
  f.initialize();const params={content:[{type:'text',text:'继续'}]};f.rpc('boot','ui/message',params);assert.match(f.response('boot').error.message,/user action/);
  f.window.navigator.userActivation.isActive=true;f.document.activeElement=null;f.rpc('unfocused','ui/message',params);assert.match(f.response('unfocused').error.message,/user action/);
  f.rpc('one','ui/message',params,true);f.rpc('two','ui/message',params,true);assert.match(f.response('two').error.message,/busy/);
  pending.resolve(true);await tick();assert.deepEqual(f.response('one').result,{});
  f.window.navigator.userActivation.isActive=true;f.rpc('three','ui/message',params);await tick();assert.deepEqual(f.response('three').result,{});
  f.rpc('four','ui/message',params);assert.match(f.response('four').error.message,/rate limited/);
 }finally{f.close();}
});

test('state and message validation failures never invoke callbacks; false receipts report actual failure',async()=>{
 const f=await fixture({callbacks:{onSendPrompt:()=>false,onSetWidgetState:()=>false}});try{
  f.initialize();for(const [id,state] of [['array',[]],['null',null],['large',{value:'a'.repeat(65537)}]]){f.rpc(id,'tapnow/setWidgetState',{state});assert.equal(f.response(id).error.code,-32602);}
  f.rpc('save','tapnow/setWidgetState',{state:{value:1}});await tick();assert.match(f.response('save').error.message,/not saved/);
  for(const [id,params] of [['empty',{content:[]}],['image',{content:[{type:'image',data:'x'}]}],['long',{content:[{type:'text',text:'x'.repeat(16385)}]}],['meta',{content:[{type:'text',text:'x'}],_meta:{'tapnow/handoffId':'bad'}}]]){f.rpc(id,'ui/message',params,true);assert.equal(f.response(id).error.code,-32602);}
  f.rpc('queue','ui/message',{content:[{type:'text',text:'x'}]},true);await tick();assert.match(f.response('queue').error.message,/not queued/);
 }finally{f.close();}
});

test('same RPC ID cannot repeat persistence; disposal or context changes suppress late success and errors',async()=>{
 for(const mode of ['dispose','context','reload']){
  const pending=deferred();let writes=0;const f=await fixture({callbacks:{onSetWidgetState:()=>{writes++;return pending.promise;}}});try{
   f.initialize();f.iframe.emit('load');f.rpc('save','tapnow/setWidgetState',{state:{a:1}});f.rpc('save','tapnow/setWidgetState',{state:{a:2}});assert.equal(writes,1);
   const oldNonce=f.nonce();if(mode==='dispose')f.host.dispose();else if(mode==='context')f.setCurrent(false);else f.iframe.emit('load');
   pending.resolve(true);await tick();assert.equal(f.response('save'),undefined);
   if(mode==='reload'){assert.notEqual(f.nonce(),oldNonce);f.emit({id:'old',method:'ping',nonce:oldNonce});assert.equal(f.response('old'),undefined);}
  }finally{f.close();}
 }
 const f=await fixture();try{f.initialize();f.rpc('save','tapnow/setWidgetState',{state:{a:1}});await tick();f.rpc('save','tapnow/setWidgetState',{state:{a:2}});assert.equal(f.saved.length,1);assert.deepEqual(f.response('save').result,{});const count=f.sent.length;f.setCurrent(false);f.rpc('save','tapnow/setWidgetState',{state:{a:3}});assert.equal(f.sent.length,count,'cached active reply is suppressed after suspension');assert.equal(f.saved.length,1);}finally{f.close();}
});

test('host context, monotonic projections and presentation lifecycle follow packaged notifications',async()=>{
 const f=await fixture();try{
  f.host.updateHostContext({locale:'en',displayMode:'fullscreen'});f.host.updatePresentationState(true);f.host.updateConversationRunActive(true);f.initialize();
  assert.equal(f.sent.find(item=>item.result?.protocolVersion).result.hostContext.locale,'en');assert.deepEqual(f.sent.find(item=>item.method==='tapnow/presentationState').params,{expanded:true});
  f.host.updateHostContext({theme:'light'});assert.deepEqual(f.sent.at(-1).params,{theme:'light'});
  assert.equal(f.host.updateData({x:1},{summary:'new',media_ref:'hidden'},{message_sequence:2,part_index:0}),true);const update=f.sent.at(-1);assert.equal(update.method,'tapnow/updateData');assert.deepEqual(update.params.toolResult,{summary:'new'});
  const length=f.sent.length;assert.equal(f.host.updateData({x:0},{},{message_sequence:1,part_index:8}),false);assert.equal(f.host.updateData({x:0},{},{message_sequence:2,part_index:0}),false);assert.equal(f.sent.length,length);
  f.host.sendPresentationShortcut('ArrowRight');assert.equal(f.sent.at(-1).method,'tapnow/presentationShortcut');f.host.updatePresentationState(false);const collapsed=f.sent.length;f.host.sendPresentationShortcut('ArrowLeft');assert.equal(f.sent.length,collapsed);
  f.host.dispose();f.host.updateHostContext({theme:'dark'});f.host.updateData({},{});assert.equal(f.sent.length,collapsed);assert.equal(f.timers.size,0);assert.equal(f.intervals.size,0);
 }finally{f.close();}
});

test('invalid registry resource, resource error and initialization timeout fail without accepting late ready',async()=>{
 for(const options of [{resourceUri:'https://example.com/app'},{allowResource:()=>false},{allowResource:()=>{throw new Error('registry unavailable');}}]){const f=await fixture(options);try{assert.deepEqual(f.errors,['invalid_resource_uri']);assert.equal(f.sent.length,0);}finally{f.close();}}
 const f=await fixture();try{const timer=[...f.timers.values()][0];assert.equal(timer.ms,15000);timer.fn();assert.deepEqual(f.errors,['timeout']);assert.equal(f.intervals.size,0);f.initialize();assert.equal(f.ready,0);}finally{f.close();}
 const broken=await fixture();try{broken.emit({method:'ui/notifications/sandbox-resource-error',nonce:undefined,params:{nonce:broken.nonce(),message:'template not found'}});assert.deepEqual(broken.errors,['template not found']);assert.equal(broken.timers.size,0);}finally{broken.close();}
});


test('ordinary card renders do not resend unchanged context or run state and reset picker previews',async()=>{
 const f=await fixture();try{
  f.host.updateHostContext({locale:'en',styles:{variables:{foreground:'#fff',background:'#000'},fonts:['Sans','Mono']}});
  f.host.updateConversationRunActive(false);f.host.updateConversationRunActive(false);
  assert.equal(f.sent.some(item=>item.method==='ui/notifications/host-context-changed'),false);
  f.initialize();
  const initial=f.sent.find(item=>item.result?.protocolVersion).result.hostContext;
  assert.equal(initial.locale,'en');assert.equal(initial.theme,'dark');assert.deepEqual(initial.styles,{variables:{foreground:'#fff',background:'#000'},fonts:['Sans','Mono']});
  assert.deepEqual(f.sent.filter(item=>item.method==='tapnow/updateData').map(item=>item.params),[{conversation_run_active:false}]);
  const count=f.sent.length;
  f.host.updateHostContext({locale:'en'});f.host.updateHostContext({});
  f.host.updateHostContext({styles:{fonts:['Sans','Mono'],variables:{background:'#000',foreground:'#fff'}}});
  f.host.updateConversationRunActive(0);assert.equal(f.sent.length,count,'equivalent nested values and boolean coercions do not notify');
  f.host.updateHostContext({styles:{variables:{foreground:'#eee'}}});
  assert.deepEqual(f.sent.at(-1).params,{styles:{variables:{foreground:'#eee'}}});assert.equal(f.sent.length,count+1);
  f.host.updateConversationRunActive(true);f.host.updateConversationRunActive(1);assert.equal(f.sent.length,count+2);assert.deepEqual(f.sent.at(-1).params,{conversation_run_active:true});
  f.host.updateConversationRunActive(false);assert.equal(f.sent.length,count+3);assert.deepEqual(f.sent.at(-1).params,{conversation_run_active:false});
  f.iframe.emit('load');f.iframe.emit('load');f.initialize();
  const reloaded=f.sent.findLast(item=>item.result?.protocolVersion).result.hostContext;
  assert.equal(reloaded.locale,'en');assert.equal(reloaded.theme,'dark');assert.deepEqual(reloaded.styles,{variables:{foreground:'#eee'}},'patch merges at top level and replaces nested values');
  assert.deepEqual(f.sent.findLast(item=>item.method==='tapnow/updateData').params,{conversation_run_active:false});
  f.host.updateHostContext({styles:null});assert.deepEqual(f.sent.at(-1).params,{styles:null});const cleared=f.sent.length;
  f.host.updateHostContext({styles:null});assert.equal(f.sent.length,cleared);
  f.host.updateHostContext({styles:{fonts:['Mono','Sans']}});const reordered=f.sent.length;
  f.host.updateHostContext({styles:{fonts:['Sans','Mono']}});assert.equal(f.sent.length,reordered+1,'array ordering is an actual value change');
 }finally{f.close();}
});
