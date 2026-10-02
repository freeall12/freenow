const test=require('node:test'),assert=require('node:assert/strict');
const {createRequire}=require('node:module'),fabricRequire=createRequire(require.resolve('fabric')),domRequire=createRequire(fabricRequire.resolve('jsdom'));
const canvasPath=domRequire.resolve('canvas'),priorCanvas=require.cache[canvasPath];require.cache[canvasPath]={id:canvasPath,loaded:true,exports:{createCanvas:undefined}};const {JSDOM}=fabricRequire('jsdom');if(priorCanvas)require.cache[canvasPath]=priorCanvas;else delete require.cache[canvasPath];
const modulePromise=import('../src/features/agent-apps/card.mjs');
const trace=()=>({id:'app-1',name:'show_app',status:'done',args:{resource_uri:'ui://tapnow/example@1'},appState:{selected:'first'},result:{kind:'mcp_app',resource_uri:'ui://tapnow/example@1',request:{title:'选择模板'},response:{summary:'选择适合的方案'}}});
async function fixture(extra={}){
 const {createMcpAppCard}=await modulePromise,dom=new JSDOM('<body><button id="before">打开应用</button></body>',{url:'http://localhost:4173/'}),document=dom.window.document,window=dom.window;window.crypto.randomUUID=require('node:crypto').randomUUID;
 let sequence=0;const timers=new Map(),frames=new Map(),hosts=[],policy={allowExpanded:true,maxInlineHeight:520,proxyUrl:'http://localhost:4173/proxy.html',...extra.policy};
 window.setTimeout=(fn,ms)=>{const id=++sequence;timers.set(id,{fn,ms});return id;};window.clearTimeout=id=>timers.delete(id);window.requestAnimationFrame=fn=>{const id=++sequence;frames.set(id,fn);return id;};window.cancelAnimationFrame=id=>frames.delete(id);
 function createHost(options){const host={options,started:0,disposed:0,data:[],contexts:[],presentations:[],active:[],shortcuts:[],start(){this.started++;},dispose(){this.disposed++;},updateData(...args){this.data.push(args);},updateHostContext(value){this.contexts.push(value);},updatePresentationState(value){this.presentations.push(value);},updateConversationRunActive(value){this.active.push(value);},sendPresentationShortcut(key){this.shortcuts.push(key);}};hosts.push(host);return host;}
 const value=extra.trace??trace(),card=createMcpAppCard({trace:value,policy,createHost,document,...extra,policy});document.body.append(card.element);
 const flushFrames=()=>{for(const[id,fn]of [...frames]){frames.delete(id);fn();}};
 return{dom,document,window,card,value,policy,hosts,timers,frames,createHost,createMcpAppCard,flushFrames,close(){card.destroy();dom.window.close();}};
}

test('local trace adapter passes registry resource, request, response and saved state to a single stable host',async()=>{
 const f=await fixture();try{
  const host=f.hosts[0],iframe=f.card.element.querySelector('iframe'),context=iframe.contentWindow;assert.equal(host.options.resourceUri,f.value.result.resource_uri);assert.equal(host.options.toolInput,f.value.result.request);assert.equal(host.options.toolResult,f.value.result.response);assert.equal(host.options.initialWidgetState,f.value.appState);assert.equal(iframe.getAttribute('sandbox'),'allow-scripts');assert.equal(iframe.style.height,'200px');assert.equal(iframe.style.display,'none');assert.equal(f.card.element.querySelector('.agent-mcp-title').textContent,'选择模板');
  host.options.callbacks.onReady();assert.equal(iframe.style.display,'block');for(let i=0;i<40;i++)f.card.update(f.value);assert.equal(f.hosts.length,1);assert.equal(iframe.contentWindow,context);assert.equal(host.data.length,0);
  const updated={...f.value,result:{...f.value.result,response:{summary:'更新'}}};f.card.update(updated);assert.equal(host.data.length,1);assert.equal(host.data[0][1],updated.result.response);assert.equal(iframe.contentWindow,context);
 }finally{f.close();}
});

test('inline size clamps, expansion preserves frame, Escape/backdrop collapse and focus restores',async()=>{
 const f=await fixture();try{
  const host=f.hosts[0],iframe=f.card.element.querySelector('iframe'),context=iframe.contentWindow,dialog=f.card.element.querySelector('[role=dialog]'),button=f.document.querySelector('#before');host.options.callbacks.onReady();host.options.callbacks.onSizeChanged(800);assert.equal(iframe.style.height,'520px');host.options.callbacks.onSizeChanged(20);assert.equal(iframe.style.height,'100px');host.options.callbacks.onSizeChanged(320);button.focus();f.card.setExpanded(true);
  assert.equal(dialog.dataset.expanded,'true');assert.equal(dialog.getAttribute('aria-modal'),'true');assert.equal(f.document.activeElement,dialog);assert.equal(iframe.style.height,'calc(88vh - 36px)');assert.equal(iframe.contentWindow,context);host.options.callbacks.onSizeChanged(900);
  f.window.dispatchEvent(new f.window.KeyboardEvent('keydown',{key:'Escape'}));assert.equal(dialog.dataset.expanded,'false');assert.equal(iframe.style.height,'320px');assert.equal(f.document.activeElement,button);host.options.callbacks.onSizeChanged(700);assert.equal(iframe.style.height,'320px');f.flushFrames();f.flushFrames();host.options.callbacks.onSizeChanged(700);assert.equal(iframe.style.height,'520px');
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
