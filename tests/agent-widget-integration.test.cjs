const test=require('node:test'),assert=require('node:assert/strict');
const {createRequire}=require('node:module'),fabricRequire=createRequire(require.resolve('fabric')),domRequire=createRequire(fabricRequire.resolve('jsdom'));
const canvasPath=domRequire.resolve('canvas'),previousCanvas=require.cache[canvasPath];require.cache[canvasPath]={id:canvasPath,loaded:true,exports:{createCanvas:undefined}};
const {JSDOM}=fabricRequire('jsdom');if(previousCanvas)require.cache[canvasPath]=previousCanvas;else delete require.cache[canvasPath];
const modulePromise=import('../src/features/agent-widgets/integration.mjs');
const tick=()=>new Promise(setImmediate),deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const widget=(id='w')=>({id,name:'show_widget',status:'done',args:{widget_code:'<button>继续</button>'},result:{kind:'widget',title:'互动组件'}});
const html=(id='h',path='artifacts/page.html')=>({id,name:'show_html',status:'done',args:{artifact_path:path},result:{kind:'html',namespace:'canvas-a',artifact_path:path,revision:3,title:'HTML'}});
async function fixture(options={}){
 const module=await modulePromise,dom=new JSDOM('<body></body>',{url:'http://localhost:4173/',runScripts:'outside-only'}),window=dom.window,document=window.document;
 window.crypto.randomUUID=require('node:crypto').randomUUID;
 const originalNow=Date.now;let now=originalNow();Date.now=()=>now;
 const activation={isActive:false};Object.defineProperty(window.navigator,'userActivation',{value:activation,configurable:true});
 const oldDocument=globalThis.document,oldWindow=globalThis.window;globalThis.document=document;globalThis.window=window;
 const chat={id:'chat-a',messages:[]},context={chat,panelActive:true,pageLeaving:false,streaming:false},errors=[],prompts=[],previews=[],links=[];
 const file={artifact_path:'artifacts/page.html',content_type:'html',content:'<html><body>真实内容</body></html>',revision:3,title:'stored title'},store={namespace:'canvas-a',get:async()=>file};
 const controller=module.createArtifactController({getContext:()=>context,getStore:()=>Promise.resolve(store),onQueuePrompt:(text,trace,chat)=>{prompts.push({text,trace,chat});return true;},onError:message=>errors.push(message),openLink:url=>links.push(url),openPreview:value=>{const handle={closed:false,close(){this.closed=true;}};previews.push({...value,handle});return handle;},...options});
 function mount(trace){if(!context.chat.messages.includes(trace))context.chat.messages.push(trace);const element=controller.render(trace);if(element&&!element.isConnected)document.body.append(element);return element;}
 function handshake(element){const frame=element.querySelector('iframe');let payload;frame.contentWindow.postMessage=value=>payload=value;window.dispatchEvent(new window.MessageEvent('message',{source:frame.contentWindow,data:{type:'proxy-ready'}}));const nonce=payload.nonce;for(const data of [{type:'rendered',nonce},{type:'resize',height:200,nonce}])window.dispatchEvent(new window.MessageEvent('message',{source:frame.contentWindow,data}));return {frame,nonce,message(data){window.dispatchEvent(new window.MessageEvent('message',{source:frame.contentWindow,data:{nonce,...data}}));},userAction(data){now+=351;frame.focus();activation.isActive=true;try{this.message(data);}finally{activation.isActive=false;}}};}
 return {...module,controller,context,chat,file,store,errors,prompts,previews,links,window,document,mount,handshake,close(){controller.reset();window.close();globalThis.document=oldDocument;globalThis.window=oldWindow;Date.now=originalNow;}};
}

test('coordinator preserves card and iframe for same chat/trace ID without remounting ordinary renders',async()=>{
 const f=await fixture();try{
  const trace=widget(),element=f.mount(trace),bridge=f.handshake(element);
  bridge.message({type:'sendPrompt',text:'boot script'});await tick();assert.equal(f.prompts.length,0,'readiness alone cannot authorize a new user turn');
  for(let i=0;i<25;i++)assert.equal(f.controller.render(trace),element);
  assert.equal(element.querySelector('iframe'),bridge.frame);
  const replacement={...trace};f.chat.messages[0]=replacement;assert.equal(f.controller.render(replacement),element);assert.equal(element.querySelector('iframe'),bridge.frame);
  bridge.userAction({type:'sendPrompt',text:'  继续  '});await tick();assert.equal(f.prompts.length,1);assert.equal(f.prompts[0].trace,replacement);assert.equal(f.prompts[0].chat,f.chat);assert.equal(f.prompts[0].text,'继续');
  assert.equal(f.controller.render({id:'other',name:'canvas_read'}),null);
 }finally{f.close();}
});

test('widget prompts cannot route through a stale chat, removed trace, hidden panel or leaving page',async()=>{
 const f=await fixture();try{
  const trace=widget(),element=f.mount(trace),bridge=f.handshake(element);
  const original=f.context.chat;f.context.chat={id:'chat-a',messages:[trace]};bridge.userAction({type:'sendPrompt',text:'same ID wrong chat object'});f.context.chat=original;
  f.chat.messages=[];bridge.userAction({type:'sendPrompt',text:'removed'});f.chat.messages=[trace];
  for(const key of ['panelActive','pageLeaving']){f.context[key]=key==='pageLeaving';bridge.userAction({type:'sendPrompt',text:key});f.context[key]=key==='panelActive';}
  trace.status='error';bridge.userAction({type:'sendPrompt',text:'failed'});trace.status='done';
  bridge.userAction({type:'sendPrompt',text:'x'.repeat(20001)});await tick();assert.equal(f.prompts.length,0);
  bridge.userAction({type:'openLink',url:'javascript:alert(1)'});bridge.userAction({type:'openLink',url:'https://example.com/ok'});assert.deepEqual(f.links,['https://example.com/ok']);
  f.controller.prune([]);assert.equal(element.isConnected,false);bridge.userAction({type:'sendPrompt',text:'destroyed'});await tick();assert.equal(f.prompts.length,0);
 }finally{f.close();}
});

test('a rejected host queue callback reports failure without claiming a successful widget send',async()=>{
 const f=await fixture({onQueuePrompt:()=>false});try{const element=f.mount(widget()),bridge=f.handshake(element);bridge.userAction({type:'sendPrompt',text:'继续'});await tick();assert.deepEqual(f.errors,['发送失败，请重试。']);}finally{f.close();}
});

test('HTML click opens the complete matching artifact snapshot without sharing and reset closes the preview',async()=>{
 const f=await fixture();try{
  f.file.content='<html>'+('中文'.repeat(12000))+'</html>';let reads=0;f.store.get=async path=>{reads++;assert.equal(path,f.file.artifact_path);return f.file;};
  const trace=html(),element=f.mount(trace);await element.onclick();assert.equal(reads,1);assert.equal(f.previews.length,1);assert.equal(f.previews[0].file.content,f.file.content);assert.equal(f.previews[0].file.title,'HTML');assert.equal(f.previews[0].showShare,false);assert.equal(f.previews[0].onShare,undefined);
  f.controller.reset();assert.equal(f.previews[0].handle.closed,true);assert.equal(element.isConnected,false);
 }finally{f.close();}
});

test('HTML mismatched namespace, changed revision, missing body and swapped path never open',async()=>{
 const f=await fixture();try{
  const trace=html(),element=f.mount(trace);
  f.store.namespace='canvas-b';await element.onclick();assert.match(f.errors.at(-1),/画布/);f.store.namespace='canvas-a';
  f.file.revision=4;await element.onclick();assert.match(f.errors.at(-1),/已更新/);f.file.revision=3;
  f.file.content_type='markdown';await element.onclick();assert.match(f.errors.at(-1),/HTML/);f.file.content_type='html';
  f.file.content='';await element.onclick();assert.match(f.errors.at(-1),/内容/);f.file.content='<html></html>';
  trace.args.artifact_path='artifacts/other.html';f.controller.render(trace);await element.onclick();assert.match(f.errors.at(-1),/记录无效/);assert.equal(f.previews.length,0);
 }finally{f.close();}
});

test('pending HTML lookups are discarded after chat switch, closure, reset or in-place receipt changes',async()=>{
 for(const mode of ['chat','panel','reset','revision','path']){
  const gate=deferred(),f=await fixture();try{
   f.store.get=()=>gate.promise;const trace=html(),element=f.mount(trace),pending=element.onclick();await tick();
   if(mode==='chat')f.context.chat={id:'chat-b',messages:[trace]};else if(mode==='panel')f.context.panelActive=false;else if(mode==='reset')f.controller.reset();else if(mode==='revision')trace.result.revision=4;else trace.args.artifact_path='artifacts/other.html';
   gate.resolve(f.file);await pending;assert.equal(f.previews.length,0);assert.deepEqual(f.errors,[]);
  }finally{f.close();}
 }
 const gate=deferred(),f=await fixture({getStore:()=>gate.promise});try{const element=f.mount(html()),pending=element.onclick();f.context.pageLeaving=true;gate.resolve(f.store);await pending;assert.equal(f.previews.length,0);}finally{f.close();}
});

test('late HTML lookup errors are silent after the captured receipt is changed in place',async()=>{
 const gate=deferred(),f=await fixture();try{
  f.store.get=()=>gate.promise;const trace=html(),element=f.mount(trace),pending=element.onclick();await tick();trace.result.revision=4;gate.reject(Error('old lookup failed'));await pending;assert.deepEqual(f.errors,[]);assert.equal(f.previews.length,0);
 }finally{f.close();}
});

test('latest HTML click wins, and pruning or receipt replacement closes an already opened preview',async()=>{
 const gate=deferred(),f=await fixture();try{
  const first=html('first'),second=html('second','artifacts/second.html');f.store.get=path=>path===first.args.artifact_path?gate.promise:Promise.resolve({...f.file,artifact_path:path});
  const a=f.mount(first),b=f.mount(second),pending=a.onclick();await tick();await b.onclick();gate.resolve(f.file);await pending;
  assert.equal(f.previews.length,1);assert.equal(f.previews[0].file.artifact_path,second.args.artifact_path);
  second.result.revision=4;f.controller.render(second);assert.equal(f.previews[0].handle.closed,true);
  second.result.revision=3;f.controller.render(second);await b.onclick();assert.equal(f.previews.length,2);f.controller.prune([first]);assert.equal(f.previews[1].handle.closed,true);assert.equal(b.isConnected,false);
 }finally{f.close();}
});

test('prune removes cards from the previous chat even when the new chat reuses the trace ID',async()=>{
 const f=await fixture();try{
  const first=widget('same'),old=f.mount(first),bridge=f.handshake(old);f.context.chat={id:'other',messages:[]};const second=widget('same'),next=f.mount(second);assert.notEqual(next,old);f.controller.prune([second]);assert.equal(old.isConnected,false);assert.equal(next.isConnected,true);bridge.userAction({type:'sendPrompt',text:'stale'});await tick();assert.equal(f.prompts.length,0);
 }finally{f.close();}
});
