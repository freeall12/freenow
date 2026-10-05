const test=require('node:test'),assert=require('node:assert/strict');
const {createRequire}=require('node:module'),fabricRequire=createRequire(require.resolve('fabric')),domRequire=createRequire(fabricRequire.resolve('jsdom'));
const canvasPath=domRequire.resolve('canvas'),priorCanvas=require.cache[canvasPath];require.cache[canvasPath]={id:canvasPath,loaded:true,exports:{createCanvas:undefined}};const {JSDOM}=fabricRequire('jsdom');if(priorCanvas)require.cache[canvasPath]=priorCanvas;else delete require.cache[canvasPath];
const modulePromise=import('../src/features/agent-apps/card.mjs');
const trace=()=>({id:'app-1',name:'show_app',status:'done',args:{resource_uri:'ui://tapnow/example@1'},appState:{selected:'first'},result:{kind:'mcp_app',resource_uri:'ui://tapnow/example@1',request:{title:'选择模板'},response:{summary:'选择适合的方案'}}});
async function fixture(extra={}){
 const {createMcpAppCard}=await modulePromise,dom=new JSDOM('<body><button id="before">打开应用</button></body>',{url:'http://localhost:4173/'}),document=dom.window.document,window=dom.window;window.crypto.randomUUID=require('node:crypto').randomUUID;
 let sequence=0;const timers=new Map(),frames=new Map(),hosts=[],policy={allowExpanded:true,maxInlineHeight:520,proxyUrl:'http://localhost:4173/proxy.html',...extra.policy};
 window.setTimeout=(fn,ms)=>{const id=++sequence;timers.set(id,{fn,ms});return id;};window.clearTimeout=id=>timers.delete(id);window.requestAnimationFrame=fn=>{const id=++sequence;frames.set(id,fn);return id;};window.cancelAnimationFrame=id=>frames.delete(id);
 // JSDOM's dispatched KeyboardEvent is always synthetic. Call the installed
 // listener with browser-like records to cover its trusted Escape branch.
 let keydown;const addListener=window.addEventListener.bind(window);window.addEventListener=(type,fn,...rest)=>{if(type==='keydown')keydown=fn;addListener(type,fn,...rest);};
 const nativeEscape=extra=>{const event={key:'Escape',isTrusted:true,target:document.activeElement,defaultPrevented:false,isComposing:false,keyCode:27,preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.stopped=true;},...extra};keydown(event);return event;};
 function createHost(options){const host={options,started:0,disposed:0,data:[],contexts:[],presentations:[],active:[],shortcuts:[],start(){this.started++;},dispose(){this.disposed++;},updateData(...args){this.data.push(args);},updateHostContext(value){this.contexts.push(value);},updatePresentationState(value){this.presentations.push(value);},updateConversationRunActive(value){this.active.push(value);},sendPresentationShortcut(key){this.shortcuts.push(key);}};hosts.push(host);return host;}
 const value=extra.trace??trace(),card=createMcpAppCard({trace:value,policy,createHost,document,...extra,policy});document.body.append(card.element);
 const flushFrames=()=>{for(const[id,fn]of [...frames]){frames.delete(id);fn();}};
 return{dom,document,window,card,value,policy,hosts,timers,frames,createHost,createMcpAppCard,flushFrames,nativeEscape,close(){card.destroy();dom.window.close();}};
}

test('local trace adapter passes registry resource, request, response and saved state to a single stable host',async()=>{
 const f=await fixture();try{
  const host=f.hosts[0],iframe=f.card.element.querySelector('iframe'),context=iframe.contentWindow;assert.equal(host.options.resourceUri,f.value.result.resource_uri);assert.equal(host.options.toolInput,f.value.result.request);assert.equal(host.options.toolResult,f.value.result.response);assert.equal(host.options.initialWidgetState,f.value.appState);assert.equal(iframe.getAttribute('sandbox'),'allow-scripts');assert.equal(iframe.style.height,'200px');assert.equal(iframe.style.display,'none');assert.equal(f.card.element.querySelector('.agent-mcp-title').textContent,'选择模板');
  host.options.callbacks.onReady();assert.equal(iframe.style.display,'block');for(let i=0;i<40;i++)f.card.update(f.value);assert.equal(f.hosts.length,1);assert.equal(iframe.contentWindow,context);assert.equal(host.data.length,0);
  const updated={...f.value,result:{...f.value.result,response:{summary:'更新'}}};f.card.update(updated);assert.equal(host.data.length,1);assert.equal(host.data[0][1],updated.result.response);assert.equal(iframe.contentWindow,context);
 }finally{f.close();}
});

test('card forwards the live iframe message guard throughout an asynchronous commit',async()=>{
 let current,release;const pending=new Promise(resolve=>{release=resolve;});
 const f=await fixture({hostOptions:{callbacks:{onSendPrompt:(text,meta,guard)=>{current=guard;return pending;}}}});
 try{
  let iframeCurrent=true;const sent=f.hosts[0].options.callbacks.onSendPrompt('confirmed',undefined,()=>iframeCurrent);
  assert.equal(current(),true);iframeCurrent=false;assert.equal(current(),false);release(true);assert.equal(await sent,false);
 }finally{f.close();}
});

test('inline size clamps, expansion preserves frame, Escape/backdrop collapse and focus restores',async()=>{
 const f=await fixture();try{
  const host=f.hosts[0],iframe=f.card.element.querySelector('iframe'),context=iframe.contentWindow,dialog=f.card.element.querySelector('[role=dialog]'),button=f.document.querySelector('#before');host.options.callbacks.onReady();host.options.callbacks.onSizeChanged(800);assert.equal(iframe.style.height,'520px');host.options.callbacks.onSizeChanged(20);assert.equal(iframe.style.height,'100px');host.options.callbacks.onSizeChanged(320);button.focus();f.card.setExpanded(true);
  assert.equal(dialog.dataset.expanded,'true');assert.equal(dialog.getAttribute('aria-modal'),'true');assert.equal(f.document.activeElement,dialog);assert.equal(iframe.style.height,'calc(88vh - 36px)');assert.equal(iframe.contentWindow,context);host.options.callbacks.onSizeChanged(900);
  const escape=f.nativeEscape();assert.equal(escape.stopped,true);assert.equal(dialog.dataset.expanded,'false');assert.equal(iframe.style.height,'320px');assert.equal(f.document.activeElement,button);host.options.callbacks.onSizeChanged(700);assert.equal(iframe.style.height,'320px');f.flushFrames();f.flushFrames();host.options.callbacks.onSizeChanged(700);assert.equal(iframe.style.height,'520px');
  f.card.setExpanded(true);f.card.element.querySelector('.agent-mcp-backdrop').click();assert.equal(dialog.dataset.expanded,'false');assert.equal(iframe.contentWindow,context);assert.equal(host.contexts.at(-1).displayMode,'inline');
 }finally{f.close();}
});

test('error reason and summary are text-only; manual reload creates one new host without generation',async()=>{
 const f=await fixture();try{
  const host=f.hosts[0],oldFrame=f.card.element.querySelector('iframe');host.options.callbacks.onError('<img src=x>'+ 'x'.repeat(260));assert.equal(host.disposed,1);assert.equal(f.card.element.querySelector('.agent-mcp-error').hidden,false);assert.equal(f.card.element.querySelector('.agent-mcp-error-reason').textContent.length,240);assert.equal(f.card.element.querySelector('.agent-mcp-error-reason img'),null);assert.equal(f.card.element.querySelector('.agent-mcp-error-summary').textContent,'选择适合的方案');assert.equal(f.timers.size,0);host.options.callbacks.onReady();assert.equal(oldFrame.style.display,'none');
  f.card.element.querySelector('.agent-mcp-reload').click();assert.equal(f.hosts.length,2);assert.notEqual(f.card.element.querySelector('iframe'),oldFrame);assert.equal(f.card.element.querySelector('output').textContent,'正在重新加载面板…');assert.equal(f.hosts[1].options.toolInput,f.value.result.request);f.hosts[1].options.callbacks.onReady();assert.equal(f.card.element.querySelector('iframe').style.display,'block');assert.equal(f.card.reload(),false);
 }finally{f.close();}
});

test('registry auto retries run at 1s/3s only before ready and never for an invalid URI',async()=>{
 const f=await fixture({policy:{autoRetryDelaysMs:[1000,3000]}});try{
  f.hosts[0].options.callbacks.onError('timeout');assert.equal([...f.timers.values()][0].ms,1000);assert.equal(f.card.element.querySelector('.agent-mcp-error-reason').textContent,'面板资源加载或初始化超时');let [id,timer]=[...f.timers][0];f.timers.delete(id);timer.fn();assert.equal(f.hosts.length,2);
  f.hosts[1].options.callbacks.onError('resource_error');assert.equal([...f.timers.values()][0].ms,3000);[id,timer]=[...f.timers][0];f.timers.delete(id);timer.fn();f.hosts[2].options.callbacks.onError('timeout');assert.equal(f.timers.size,0);
  f.card.reload();f.hosts[3].options.callbacks.onReady();f.hosts[3].options.callbacks.onError('timeout');assert.equal(f.timers.size,0);f.card.reload();f.hosts[4].options.callbacks.onError('invalid_resource_uri');assert.equal(f.timers.size,0);
 }finally{f.close();}
});

test('suspend keeps iframe and passive ready, blocks actions, resumes and destroys stale callbacks',async()=>{
 let calls=0;const f=await fixture({hostOptions:{callbacks:{onSendPrompt:()=>{calls++;return true;}}}});try{
  const host=f.hosts[0],frame=f.card.element.querySelector('iframe');f.card.suspend();host.options.callbacks.onReady();assert.equal(frame.style.display,'block');assert.equal(await host.options.callbacks.onSendPrompt('继续'),false);assert.equal(calls,0);f.card.update(f.value);assert.equal(f.hosts.length,1);assert.equal(f.card.element.querySelector('iframe'),frame);assert.equal(await host.options.callbacks.onSendPrompt('继续'),true);assert.equal(calls,1);
  f.card.destroy();host.options.callbacks.onSizeChanged(999);host.options.callbacks.onError('timeout');assert.equal(f.card.element.isConnected,false);assert.equal(f.timers.size,0);assert.equal(await host.options.callbacks.onSendPrompt('继续'),false);
 }finally{f.close();}
});

test('registry autoexpand, single expanded card and keyboard shortcut exclusions',async()=>{
 const f=await fixture({policy:{autoExpandOnReady:true,presentationShortcuts:['ArrowLeft','ArrowRight','Enter']},autoExpand:true});let second;try{
  const host=f.hosts[0],dialog=f.card.element.querySelector('[role=dialog]');host.options.callbacks.onReady();assert.equal(dialog.dataset.expanded,'true');dialog.dispatchEvent(new f.window.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));assert.deepEqual(host.shortcuts,['ArrowRight']);dialog.dispatchEvent(new f.window.KeyboardEvent('keydown',{key:'Enter',repeat:true,bubbles:true}));const input=f.document.createElement('input');dialog.append(input);input.dispatchEvent(new f.window.KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}));assert.equal(host.shortcuts.length,1);
  second=f.createMcpAppCard({trace:{...trace(),id:'app-2'},policy:f.policy,createHost:f.createHost,document:f.document});f.document.body.append(second.element);f.hosts[1].options.callbacks.onReady();second.setExpanded(true);assert.equal(dialog.dataset.expanded,'false');assert.equal(second.element.querySelector('[role=dialog]').dataset.expanded,'true');assert.equal(f.document.activeElement,second.element.querySelector('[role=dialog]'));
 }finally{second?.destroy();f.close();}
});

test('resource identity changes replace the host and reject old readiness/resize receipts',async()=>{
 const f=await fixture();try{
  const old=f.hosts[0],frame=f.card.element.querySelector('iframe');old.options.callbacks.onReady();f.card.setExpanded(true);f.card.update({...trace(),id:'app-next'});assert.equal(old.disposed,1);assert.equal(f.hosts.length,2);assert.notEqual(f.card.element.querySelector('iframe'),frame);old.options.callbacks.onReady();old.options.callbacks.onSizeChanged(490);assert.equal(f.card.element.querySelector('iframe').style.display,'none');assert.equal(f.card.element.querySelector('iframe').style.height,'200px');assert.equal(f.card.element.querySelector('[role=dialog]').dataset.expanded,'false');
 }finally{f.close();}
});

test('local Escape respects consumed input, IME, synthetic keys, other overlays and current card context',async()=>{
 let current=true;const f=await fixture({isCurrent:()=>current});try{
  f.hosts[0].options.callbacks.onReady();f.card.setExpanded(true);const dialog=f.card.element.querySelector('[role=dialog]');
  for(const extra of [{defaultPrevented:true},{isComposing:true},{keyCode:229},{isTrusted:false},{target:f.document.querySelector('#before')}]){f.nativeEscape(extra);assert.equal(dialog.dataset.expanded,'true');}
  dialog.dispatchEvent(new f.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));assert.equal(dialog.dataset.expanded,'true');
  current=false;f.nativeEscape();assert.equal(dialog.dataset.expanded,'true');current=true;f.nativeEscape();assert.equal(dialog.dataset.expanded,'false');
 }finally{f.close();}
});

test('dismiss callbacks ignore inline, replaced, suspended and destroyed cards and cannot close another expanded card',async()=>{
 const f=await fixture();let second;try{
  const old=f.hosts[0];old.options.callbacks.onReady();assert.equal(old.options.callbacks.onDismiss(),false);f.card.setExpanded(true);
  f.card.update({...trace(),id:'next'});const current=f.hosts[1];current.options.callbacks.onReady();f.card.setExpanded(true);old.options.callbacks.onDismiss();assert.equal(f.card.element.querySelector('[role=dialog]').dataset.expanded,'true');
  second=f.createMcpAppCard({trace:{...trace(),id:'second'},policy:f.policy,createHost:f.createHost,document:f.document});f.document.body.append(second.element);f.hosts[2].options.callbacks.onReady();second.setExpanded(true);assert.equal(current.options.callbacks.onDismiss(),false);assert.equal(second.element.querySelector('[role=dialog]').dataset.expanded,'true');
  f.card.suspend();assert.equal(current.options.callbacks.onDismiss(),false);f.card.destroy();assert.equal(current.options.callbacks.onDismiss(),false);
 }finally{second?.destroy();f.close();}
});

test('backdrop and inner Escape wait for close persistence, retain failures and permit retry',async()=>{
 const f=await fixture();try{
  const host=f.hosts[0],dialog=f.card.element.querySelector('[role=dialog]'),iframe=f.card.element.querySelector('iframe');host.options.callbacks.onReady();f.card.setExpanded(true);let release,reject,cancelled=0;
  host.prepareToClose=()=>new Promise((resolve,no)=>{release=resolve;reject=no;});host.cancelClose=()=>{cancelled++;};
  f.card.element.querySelector('[data-testid="mcp-app-backdrop"]').click();assert.equal(dialog.dataset.expanded,'true');assert.match(f.card.element.querySelector('.agent-mcp-close-status').textContent,/保存/);
  reject(Error('disk unavailable'));await new Promise(setImmediate);assert.equal(dialog.dataset.expanded,'true');assert.equal(iframe.isConnected,true);assert.match(f.card.element.querySelector('.agent-mcp-close-status').textContent,/页面已保留/);
  host.options.callbacks.onDismiss();assert.equal(dialog.dataset.expanded,'true');release(true);await new Promise(setImmediate);assert.equal(dialog.dataset.expanded,'false');assert.equal(iframe.isConnected,true);assert.equal(cancelled,2);assert.equal(f.card.element.querySelector('.agent-mcp-close-status').hidden,true);
 }finally{f.close();}
});
test('presentation collapse cannot release the lock held by an outer drawer close',async()=>{
 const f=await fixture();try{
  const host=f.hosts[0];host.options.callbacks.onReady();f.card.setExpanded(true);let release,cancelled=0;const pending=new Promise(resolve=>{release=resolve;});host.prepareToClose=()=>pending;host.cancelClose=()=>{cancelled++;};
  f.card.element.querySelector('[data-testid="mcp-app-backdrop"]').click();const outerClose=f.card.prepareToClose();release(true);await outerClose;await new Promise(setImmediate);
  assert.equal(f.card.element.querySelector('[role=dialog]').dataset.expanded,'false');assert.equal(cancelled,0,'outer context transition still owns the lock');f.card.cancelClose();assert.equal(cancelled,1);
 }finally{f.close();}
});
test('late old close failure cannot release a replacement card close lock',async()=>{
 const f=await fixture();try{
  const old=f.hosts[0];old.options.callbacks.onReady();let rejectOld;old.prepareToClose=()=>new Promise((_,reject)=>{rejectOld=reject;});old.cancelClose=()=>{};const stale=f.card.prepareToClose(),rejected=assert.rejects(stale,/old disk failed/);
  f.card.update({...f.value,id:'replacement'});const next=f.hosts[1];next.options.callbacks.onReady();f.card.setExpanded(true);let release,cancelled=0;const saved=new Promise(resolve=>{release=resolve;});next.prepareToClose=()=>saved;next.cancelClose=()=>{cancelled++;};const closing=f.card.prepareToClose();rejectOld(Error('old disk failed'));await rejected;
  next.options.callbacks.onDismiss();release(true);await closing;await new Promise(setImmediate);assert.equal(cancelled,0);f.card.cancelClose();assert.equal(cancelled,1);
 }finally{f.close();}
});
