const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {createRequire}=require('node:module');
const fabricRequire=createRequire(require.resolve('fabric')),domRequire=createRequire(fabricRequire.resolve('jsdom'));
const canvasPath=domRequire.resolve('canvas'),old=require.cache[canvasPath];require.cache[canvasPath]={id:canvasPath,loaded:true,exports:{createCanvas:undefined}};
const {JSDOM}=fabricRequire('jsdom');if(old)require.cache[canvasPath]=old;else delete require.cache[canvasPath];
const bridgeModule=import('../src/features/agent-artifacts/preview-escape.mjs');
const previewModule=import('../src/features/agent-artifacts/html-preview.mjs');
function bridgeHarness(fn){
  const listeners={},sent=[],childSent=[],timers=[],loads=[];
  const parent={postMessage:data=>sent.push(data)},child={postMessage:data=>childSent.push(data)};
  const frame={contentWindow:child,addEventListener:(type,fn)=>loads.push(fn)};
  const document={activeElement:frame,innerDialog:false,querySelector:selector=>selector==='iframe'?frame:document.innerDialog?{}:null};
  const window={parent,addEventListener:(type,fn,capture)=>(listeners[type]??=[]).push({fn,capture}),setTimeout:fn=>timers.push(fn)};
  vm.runInNewContext('('+fn.toString()+')("boot-token")',{window,document,crypto:require('node:crypto').webcrypto});
  return {sent,childSent,document,parent,child,frame,emit(type,event,between){for(const entry of listeners[type]||[])if(entry.capture)entry.fn(event);between?.();for(const entry of listeners[type]||[])if(!entry.capture)entry.fn(event);},flush(){while(timers.length)timers.shift()();},load(){loads.forEach(fn=>fn());}};
}
const key=extra=>({key:'Escape',isTrusted:true,defaultPrevented:false,isComposing:false,repeat:false,...extra});
const binding={nonce:'host-nonce',generation:1,innerNonce:'inner-nonce'};
function initInner(h){h.emit('message',{source:h.parent,data:{type:'html-preview-inner-init',bootToken:'boot-token',...binding}});h.sent.length=0;}
test('inner Escape respects trusted input, consumption, IME, repeat and inner native dialogs',async()=>{
  const {innerPreviewEscapeBridge}=await bridgeModule,h=bridgeHarness(innerPreviewEscapeBridge);
  h.emit('keydown',key());h.flush();assert.equal(h.sent.length,0);
  initInner(h);
  for(const extra of [{isTrusted:false},{defaultPrevented:true},{isComposing:true},{keyCode:229},{repeat:true},{key:'Enter'}])h.emit('keydown',key(extra));
  h.emit('compositionstart',{});h.emit('keydown',key());h.emit('compositionend',{});
  h.document.innerDialog=true;h.emit('keydown',key());h.emit('keydown',key(),()=>h.document.innerDialog=false);
  const consumedLater=key();h.emit('keydown',consumedLater);consumedLater.defaultPrevented=true;
  h.flush();assert.equal(h.sent.length,0);
  h.emit('keydown',key());h.flush();assert.deepEqual(JSON.parse(JSON.stringify(h.sent)),[{type:'html-preview-dismiss',reason:'escape',...binding}]);
});
test('inner pending Escape is invalidated by a new handshake and foreign initialization is ignored',async()=>{
  const {innerPreviewEscapeBridge}=await bridgeModule,h=bridgeHarness(innerPreviewEscapeBridge);initInner(h);
  h.emit('keydown',key());h.emit('message',{source:h.parent,data:{type:'html-preview-inner-init',bootToken:'boot-token',...binding,innerNonce:'new'}});h.sent.length=0;h.flush();assert.equal(h.sent.length,0);
  h.emit('message',{source:{},data:{type:'html-preview-inner-init',bootToken:'boot-token',...binding}});
  h.emit('keydown',key());h.flush();assert.equal(h.sent[0].innerNonce,'new');
});
test('outer relay requires exact frame, nonces, readiness, generation and active focus',async()=>{
  const {outerPreviewEscapeBridge}=await bridgeModule,h=bridgeHarness(outerPreviewEscapeBridge);
  h.emit('message',{source:h.parent,data:{type:'html-preview-init',bootToken:'wrong',nonce:'n',generation:1}});assert.equal(h.childSent.length,0);
  h.emit('message',{source:h.parent,data:{type:'html-preview-init',bootToken:'boot-token',nonce:'n',generation:1}});
  const init=h.childSent.at(-1),dismiss={...init,type:'html-preview-dismiss',reason:'escape'};
  h.emit('message',{source:h.child,data:dismiss});assert.equal(h.sent.length,0);
  h.emit('message',{source:h.child,data:{...init,type:'html-preview-inner-ready'}});assert.equal(h.sent[0].type,'html-preview-ready');h.sent.length=0;
  for(const data of [{...dismiss,nonce:'old'},{...dismiss,innerNonce:'old'},{...dismiss,generation:0}])h.emit('message',{source:h.child,data});
  h.emit('message',{source:{},data:dismiss});h.document.activeElement=null;h.emit('message',{source:h.child,data:dismiss});assert.equal(h.sent.length,0);
  h.document.activeElement=h.frame;h.emit('message',{source:h.child,data:dismiss});assert.equal(h.sent.length,1);
  h.load();h.sent.length=0;h.emit('message',{source:h.child,data:dismiss});assert.equal(h.sent.length,0,'reloaded child cannot reuse old binding');
});
test('preview bridge preserves standards layout, opaque sandbox and offline export separation',async()=>{
  const {htmlPreviewDocument}=await bridgeModule,{previewDocument}=await previewModule;
  const source='<!doctype html><html><head><title>Work</title></head><body><button>Work</button></body></html>';
  const html=htmlPreviewDocument(source,'Work','boot-token'),outer=new JSDOM(html),inner=new JSDOM(outer.window.document.querySelector('iframe').srcdoc);
  assert.equal(inner.window.document.compatMode,'CSS1Compat');assert.equal(inner.window.document.querySelector('button').textContent,'Work');
  assert.equal(outer.window.document.querySelector('iframe').getAttribute('sandbox'),'allow-scripts');
  assert.match(html,/connect-src 'none'/);assert.doesNotMatch(previewDocument(source),/html-preview-inner-init/);
  assert.throws(()=>htmlPreviewDocument(source,'Work','<script>'));outer.window.close();inner.window.close();
});
const file=()=>({artifact_path:'artifacts/preview.html',content_type:'html',revision:1,title:'作品',content:'<!doctype html><h1>版本一</h1>'});
const deferred=()=>{let resolve;return {promise:new Promise(done=>resolve=done),resolve:value=>resolve(value)};};
async function withPreview(options,run){
  const dom=new JSDOM('<button id="opener">打开</button><input id="composer">',{url:'http://localhost:4173/'}),saved={window:global.window,document:global.document};
  global.window=dom.window;global.document=dom.window.document;
  dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  dom.window.HTMLDialogElement.prototype.close=function(){if(!this.open)return;this.open=false;this.dispatchEvent(new dom.window.Event('close'));};
  const opener=document.querySelector('#opener');opener.focus();let current=file(),live=true;
  const {openHtmlPreview}=await previewModule,handle=openHtmlPreview({file:current,getCurrentFile:async()=>current,isCurrent:()=>live,getResourceOptions:async()=>({}),localize:async html=>({html,status:'ready',diagnostics:[]}),...options});
  await handle.ready;
  const dialog=document.querySelector('dialog'),button=[...dialog.querySelectorAll('button')].find(el=>el.ariaLabel==='在对话中讨论');
  try{await run({handle,dialog,button,dom,opener,setFile:value=>current=value,setLive:value=>live=value});}
  finally{handle.close();dom.window.close();Object.assign(global,saved);}
}
test('discussion optional, passes newest stored revision and never restores old focus on success',async()=>{
  await withPreview({},async({button})=>assert.equal(button,undefined));
  let received;
  await withPreview({onDiscuss:async (latest,{isCurrent})=>{assert.equal(isCurrent(),true);received=latest;document.querySelector('#composer').focus();return true;}},async({button,dialog,opener,setFile})=>{
    setFile({...file(),revision:3,content:'最新内容'});await button.onclick();assert.equal(received.revision,3);assert.equal(received.content,'最新内容');assert.equal(dialog.isConnected,false);assert.notEqual(document.activeElement,opener);assert.equal(document.activeElement.id,'composer');
  });
});
test('rejected discussion stays visible and re-enables retry; invalid source cannot reach callback',async()=>{
  for(const mode of ['false','throw','deleted','wrong-path','wrong-type','bad-revision']){
    let calls=0;
    await withPreview({onDiscuss:async()=>{calls++;if(mode==='throw')throw Error('保存失败');return false;}},async({button,dialog,setFile})=>{
      if(mode==='deleted')setFile(null);if(mode==='wrong-path')setFile({...file(),artifact_path:'artifacts/other.html'});if(mode==='wrong-type')setFile({...file(),content_type:'markdown'});if(mode==='bad-revision')setFile({...file(),revision:0});
      await button.onclick();assert.equal(dialog.open,true);assert.equal(button.disabled,false);assert.match(dialog.querySelector('.agent-artifact-status').textContent,/失败|重试|无效/);assert.equal(calls,['false','throw'].includes(mode)?1:0);
    });
  }
});
test('closing during latest read cancels discussion and focus returns; late callback cannot steal focus',async()=>{
  const pending=deferred();let reads=0,calls=0;
  await withPreview({getCurrentFile:()=>++reads<=3?file():pending.promise,onDiscuss:()=>{calls++;}},async({button,handle,opener})=>{
    const work=button.onclick();handle.close();pending.resolve(file());await work;assert.equal(calls,0);assert.equal(document.activeElement,opener);
  });
  const callback=deferred();await withPreview({onDiscuss:()=>callback.promise},async({button,handle,opener})=>{
    const work=button.onclick();await Promise.resolve();document.querySelector('#composer').focus();handle.close();callback.resolve(true);await work;assert.notEqual(document.activeElement,opener);
  });
});
test('host dismissal rejects stale or unfocused messages and restores opener only for valid close',async()=>{
  await withPreview({},async({dialog,dom,opener})=>{
    const frame=dialog.querySelector('iframe'),posted=[];frame.contentWindow.postMessage=data=>posted.push(data);frame.dispatchEvent(new dom.window.Event('load'));const init=posted.at(-1);
    const send=(data,source=frame.contentWindow)=>window.dispatchEvent(new dom.window.MessageEvent('message',{source,data}));
    send({...init,type:'html-preview-ready'});send({...init,type:'html-preview-dismiss',reason:'escape'});assert.equal(dialog.open,true,'unfocused iframe ignored');
    frame.focus();send({...init,type:'html-preview-dismiss',reason:'escape',nonce:'old'});send({...init,type:'html-preview-dismiss',reason:'escape'},window);assert.equal(dialog.open,true);
    send({...init,type:'html-preview-dismiss',reason:'escape'});assert.equal(dialog.isConnected,false);assert.equal(document.activeElement,opener);
    send({...init,type:'html-preview-dismiss',reason:'escape'});assert.equal(document.activeElement,opener);
  });
});

test('discussion suppresses double activation and invalidates queued reads after session switch',async()=>{
  const done=deferred();let calls=0;
  await withPreview({onDiscuss:()=>{calls++;return done.promise;}},async({button,dialog})=>{
    const first=button.onclick();await Promise.resolve();await button.onclick();assert.equal(calls,1);done.resolve(false);await first;assert.equal(dialog.open,true);assert.equal(button.disabled,false);
  });
  const pending=deferred();let reads=0;
  await withPreview({getCurrentFile:()=>++reads<=3?file():pending.promise,onDiscuss:()=>{throw Error('must not run');}},async({button,dialog,setLive})=>{
    const work=button.onclick();setLive(false);pending.resolve(file());await work;assert.equal(dialog.open,true);
  });
});
test('host native cancel and synthetic or consumed Escape cannot bypass its guard',async()=>{
  await withPreview({},async({dialog,dom})=>{
    const cancel=new dom.window.Event('cancel',{cancelable:true});dialog.dispatchEvent(cancel);assert.equal(cancel.defaultPrevented,true);assert.equal(dialog.open,true);
    dialog.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));assert.equal(dialog.open,true);
    for(const extra of [{defaultPrevented:true},{isComposing:true},{keyCode:229},{repeat:true}])dialog.onkeydown(key(extra));assert.equal(dialog.open,true);
    dialog.onkeydown(key({preventDefault(){},stopPropagation(){}}));assert.equal(dialog.isConnected,false);
  });
});
