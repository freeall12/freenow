const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module'),fabricRequire=createRequire(require.resolve('fabric')),domRequire=createRequire(fabricRequire.resolve('jsdom'));
const canvasPath=domRequire.resolve('canvas'),priorCanvas=require.cache[canvasPath];require.cache[canvasPath]={id:canvasPath,loaded:true,exports:{createCanvas:undefined}};const {JSDOM}=fabricRequire('jsdom');if(priorCanvas)require.cache[canvasPath]=priorCanvas;else delete require.cache[canvasPath];
const proxies=['mcp-app-proxy.html','cutlist-review-proxy.html','ad-review-proxy.html','production-progress-proxy.html'];
const source=name=>fs.readFileSync(path.join(__dirname,'../src/features/agent-apps/resources',name),'utf8');
function derivedBridge(name){
 const html=source(name),dom=new JSDOM('<body></body>'),context=vm.createContext({DOMParser:dom.window.DOMParser});
 const functions=html.slice(html.indexOf('      function presentationEscapeBridge()'),html.indexOf('\n      function ',html.indexOf('      function buildSrcdocWithCsp(')+10));
 vm.runInContext(functions+';this.build=buildSrcdocWithCsp;',context);
 const derived=context.build('<!doctype html><html><head><script>window.original=true;</script></head><body><input></body></html>',"default-src 'none'; script-src 'unsafe-inline'");
 const parsed=new dom.window.DOMParser().parseFromString(derived,'text/html');
 assert.equal(parsed.head.children[0].getAttribute('http-equiv'),'Content-Security-Policy');assert.match(parsed.head.children[1].textContent,/presentationEscapeBridge/);assert.equal(parsed.head.children[2].textContent,'window.original=true;');
 const bridge=parsed.head.children[1].textContent;dom.window.close();return bridge;
}
function relay(name,parent,inner,nonce){
 let receive;const window={parent,addEventListener(type,fn){assert.equal(type,'message');receive=fn;}};
 const html=source(name),start=html.indexOf('      window.addEventListener("message",'),end=html.indexOf('\n      // 内联脚本先挂监听',start);
 vm.runInNewContext(html.slice(start,end),{window,inner:{contentWindow:inner},currentNonce:nonce,parentOrigin:'http://localhost:4173',isAllowedOrigin:()=>true,handleResourceReady(){}});
 return event=>receive(event);
}
function keyboardBridge(code,parent){
 let listener;const timers=[];const window={parent,addEventListener(type,fn,capture){assert.equal(type,'keydown');assert.equal(capture,true);listener=fn;},setTimeout(fn){timers.push(fn);}};
 vm.runInNewContext(code,{window});return{window,keydown:listener,flush(){for(const fn of timers.splice(0))fn();}};
}
// A browser-owned isTrusted property cannot be set by JSDOM dispatchEvent.
// These event records exercise the trusted-listener branch; synthetic rejection
// is checked separately, and the actual native keyboard path needs browser QA.
const escape=extra=>({key:'Escape',isTrusted:true,isComposing:false,keyCode:27,repeat:false,defaultPrevented:false,...extra});

test('all proxy derivatives defer trusted Escape and preserve internal consumption, IME and synthetic events',()=>{
 for(const name of proxies){
  const sent=[],bridge=keyboardBridge(derivedBridge(name),{postMessage(data,target){sent.push({data,target});}});
  for(const extra of [{isTrusted:false},{isComposing:true},{keyCode:229},{repeat:true},{key:'Enter'}])bridge.keydown(escape(extra));bridge.flush();assert.equal(sent.length,0,name);
  const consumed=escape();bridge.keydown(consumed);consumed.defaultPrevented=true;bridge.flush();assert.equal(sent.length,0,name+' respects later app handlers');
  bridge.keydown(escape());assert.equal(sent.length,0);bridge.flush();assert.equal(sent.length,1);assert.deepEqual(JSON.parse(JSON.stringify(sent[0])),{data:{jsonrpc:'2.0',method:'tapnow/presentationDismiss',params:{reason:'escape'}},target:'*'});
 }
});

test('nested iframe Escape crosses proxy nonce transport and closes only its live focused expanded card',async()=>{
 const [{createMcpAppCard},{createMcpAppHost}]=await Promise.all([import('../src/features/agent-apps/card.mjs'),import('../src/features/agent-apps/host.mjs')]);
 for(const name of proxies){
  const dom=new JSDOM('<body><button id="before">before</button></body>',{url:'http://localhost:4173/'}),document=dom.window.document,window=dom.window;window.crypto.randomUUID=require('node:crypto').randomUUID;
  let host,frame,current=true;const sent=[];
  const card=createMcpAppCard({document,isCurrent:()=>current,trace:{id:'actor',args:{resource_uri:'ui://tapnow/actor-emotion@v1'}},policy:{allowExpanded:true,proxyUrl:'http://localhost:4173/proxy.html'},createHost(options){frame=options.iframe;host=createMcpAppHost({...options,allowResource:()=>true});return host;}});
  document.body.append(card.element);frame.contentWindow.postMessage=data=>sent.push(data);window.dispatchEvent(new window.MessageEvent('message',{source:frame.contentWindow,data:{jsonrpc:'2.0',method:'ui/notifications/sandbox-proxy-ready'}}));const dialog=card.element.querySelector('[role=dialog]'),before=document.querySelector('#before');
  const nonce=()=>sent.findLast(data=>data.method==='ui/notifications/sandbox-resource-ready').nonce;
  const emit=(data,source=frame.contentWindow)=>window.dispatchEvent(new window.MessageEvent('message',{source,data:{jsonrpc:'2.0',nonce:nonce(),...data}}));
  const initialize=()=>{emit({id:require('node:crypto').randomUUID(),method:'ui/initialize',params:{}});emit({method:'ui/notifications/initialized'});};
  try{
   initialize();before.focus();card.setExpanded(true);frame.focus();const originalFrame=frame;
   const parent={postMessage(data){emit(data);}},inner={},receive=relay(name,parent,inner,nonce());
   const keyboard=keyboardBridge(derivedBridge(name),{postMessage(data){receive({source:inner,data,origin:'null'});}});
   keyboard.keydown(escape());keyboard.flush();assert.equal(dialog.dataset.expanded,'false',name);assert.equal(document.activeElement,before);assert.equal(card.element.querySelector('iframe'),originalFrame);
   card.setExpanded(true);frame.focus();receive({source:{},data:{jsonrpc:'2.0',method:'tapnow/presentationDismiss',params:{reason:'escape'}}});assert.equal(dialog.dataset.expanded,'true','spoof inner source');
   emit({method:'tapnow/presentationDismiss',params:{reason:'escape'},nonce:'stale'});assert.equal(dialog.dataset.expanded,'true','stale nonce');
   emit({method:'tapnow/presentationDismiss',params:{reason:'escape'}},{});assert.equal(dialog.dataset.expanded,'true','spoof outer source');
   before.focus();keyboard.keydown(escape());keyboard.flush();assert.equal(dialog.dataset.expanded,'true','overlay or other focus');
   frame.focus();current=false;keyboard.keydown(escape());keyboard.flush();assert.equal(dialog.dataset.expanded,'true','stale card context');current=true;
   frame.dispatchEvent(new window.Event('load'));frame.dispatchEvent(new window.Event('load'));initialize();frame.focus();keyboard.keydown(escape());keyboard.flush();assert.equal(dialog.dataset.expanded,'true','old proxy nonce after reload');
   const receiveNew=relay(name,parent,inner,nonce());const keyboardNew=keyboardBridge(derivedBridge(name),{postMessage(data){receiveNew({source:inner,data,origin:'null'});}});
   before.remove();keyboardNew.keydown(escape());keyboardNew.flush();assert.equal(dialog.dataset.expanded,'false');assert.equal(document.activeElement,card.element.querySelector('.agent-mcp-expand'),'disconnected previous focus falls back');
   card.setExpanded(true);frame.focus();card.suspend();keyboardNew.keydown(escape());keyboardNew.flush();assert.equal(dialog.dataset.expanded,'false');card.update({id:'actor',args:{resource_uri:'ui://tapnow/actor-emotion@v1'}});assert.equal(dialog.dataset.expanded,'false');
   card.setExpanded(true);frame.focus();card.destroy();keyboardNew.keydown(escape());keyboardNew.flush();assert.equal(card.element.isConnected,false);
  }finally{card.destroy();dom.window.close();}
 }
});
