const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module'),fabricRequire=createRequire(require.resolve('fabric')),domRequire=createRequire(fabricRequire.resolve('jsdom'));
const canvasPath=domRequire.resolve('canvas'),previousCanvas=require.cache[canvasPath];require.cache[canvasPath]={id:canvasPath,loaded:true,exports:{createCanvas:undefined}};
const {JSDOM}=fabricRequire('jsdom');if(previousCanvas)require.cache[canvasPath]=previousCanvas;else delete require.cache[canvasPath];
const modulePromise=import('../src/features/agent-widgets/cards.mjs');
const root=path.join(__dirname,'..'),read=file=>fs.readFileSync(path.join(root,'src/features/agent-widgets',file),'utf8');
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
async function fixture(options={}){
 const module=await modulePromise,dom=new JSDOM('<body></body>',{url:'http://localhost:4173/',runScripts:'outside-only'}),window=dom.window,document=window.document;
 window.crypto.randomUUID=require('node:crypto').randomUUID;
 Object.defineProperty(window.navigator,'userActivation',{configurable:true,value:{isActive:true}});
 let now=0,sequence=0,available=true;const originalNow=Date.now,timers=new Map(),intervals=new Map(),sent=[],errors=[],prompts=[],links=[];
 Date.now=()=>now;window.setTimeout=(fn,ms)=>{const id=++sequence;timers.set(id,{fn,at:now+ms});return id;};window.clearTimeout=id=>timers.delete(id);
 window.setInterval=(fn,ms)=>{const id=++sequence;intervals.set(id,{fn,ms});return id;};window.clearInterval=id=>intervals.delete(id);
 const trace={id:'widget-1',name:'show_widget',status:'done',args:{widget_code:'<button onclick="sendPrompt(\'继续\')">继续</button>'},result:{kind:'widget',title:'互动组件'},...options.trace};
 const card=module.createWidgetCard({trace,document,onSendPrompt:text=>{prompts.push(text);return true;},onOpenLink:url=>links.push(url),onError:error=>errors.push(error),isCurrent:()=>available,...options});document.body.append(card.element);
 function frame(){return card.element.querySelector('iframe');}
 function handshake(){const target=frame();target.focus();target.contentWindow.postMessage=data=>sent.push(data);window.dispatchEvent(new window.MessageEvent('message',{source:target.contentWindow,data:{type:'proxy-ready'}}));return sent.at(-1)?.nonce;}
 function message(data,source=frame()?.contentWindow){window.dispatchEvent(new window.MessageEvent('message',{source,data}));}
 return{...module,dom,window,document,trace,card,timers,intervals,sent,errors,prompts,links,frame,handshake,message,setCurrent(value){available=value;},advance(ms){now+=ms;for(const[id,timer]of [...timers])if(timer.at<=now){timers.delete(id);timer.fn();}},close(){card.destroy();dom.window.close();Date.now=originalNow;}};
}

test('widget media remains a host proposal until a real host action and returns a bound receipt once',async()=>{
 let uploads=0,downloads=0;
 const f=await fixture({onUploadMedia:async(payload,_trace,options)=>{assert.equal(options.isCurrent(),true);assert.equal(payload.type,'image');uploads++;return {status:'succeeded',applied:true,saved:true,nodeIds:['actual-image']};},onDownloadMedia:()=>{downloads++;}});
 try{
  const nonce=f.handshake();assert.match(f.sent[0].localBridge,/uploadToCanvas/);assert.match(f.sent[0].localBridge,/createWhiteboxCapture/);
  f.message({type:'rendered',nonce});f.message({type:'resize',nonce,height:200});
  const payload={type:'uploadToCanvas',nonce,requestId:'picture',blob:new f.window.Blob(['png'],{type:'image/png'}),options:{filename:'scene.html'}};
  f.message({...payload,nonce:'wrong'});assert.equal(f.card.element.querySelector('.execution-confirmation'),null);
  f.message(payload);assert.equal(uploads,0);
  const section=f.card.element.querySelector('.execution-confirmation');assert.match(section.textContent,/scene.png/);
  const button=text=>[...section.querySelectorAll('button')].find(b=>b.textContent===text);
  await button('添加到画布').onclick({isTrusted:false});assert.equal(uploads,0);
  await button('下载素材').onclick({isTrusted:true});assert.equal(downloads,1);assert.equal(uploads,0);
  await button('添加到画布').onclick({isTrusted:true});assert.equal(uploads,1);
  const reply=f.sent.at(-1);assert.equal(reply.type,'uploadToCanvasResult');assert.deepEqual(reply.result.nodeIds,['actual-image']);
  f.message(payload);assert.equal(uploads,1);assert.deepEqual(f.sent.at(-1).result.nodeIds,['actual-image']);
  f.message({...payload,requestId:'next'});f.trace.args.widget_code='<p>new version</p>';f.card.update(f.trace);
  assert.equal(f.card.element.querySelector('.execution-confirmation'),null);assert.equal(uploads,1);
 }finally{f.close();}
});

test('widget upload bridge accepts only parent replies for the current nonce and media request',async()=>{
 const {mediaBridgeSource}=await import('../src/features/agent-widgets/media-bridge.mjs');
 const sent=[],handlers=[],parent={postMessage:data=>sent.push(data)},window={tapnow:{},parent,addEventListener:(_name,fn)=>handlers.push(fn)};
 vm.runInNewContext(mediaBridgeSource('bound-nonce'),{window,Blob,crypto:require('node:crypto').webcrypto,setTimeout,clearTimeout,Map,Promise,Error});
 const pending=window.tapnow.uploadToCanvas(new Blob(['pixels'],{type:'image/png'}),{filename:'capture.png'}),request=sent[0];let settled=false;pending.then(()=>{settled=true;});
 handlers[0]({source:{},data:{type:'uploadToCanvasResult',nonce:'bound-nonce',requestId:request.requestId,result:{saved:true}}});
 handlers[0]({source:parent,data:{type:'uploadToCanvasResult',nonce:'old',requestId:request.requestId,result:{saved:true}}});
 await Promise.resolve();assert.equal(settled,false);
 handlers[0]({source:parent,data:{type:'uploadToCanvasResult',nonce:'bound-nonce',requestId:request.requestId,result:{saved:true,nodeIds:['node']}}});
 assert.deepEqual(await pending,{saved:true,nodeIds:['node']});
 await assert.rejects(window.tapnow.uploadToCanvas('https://example.test/a.png'),/PNG/);
});

test('widget is revealed only after matching rendered and resize receipts; updates preserve browsing-context owner',async()=>{
 const f=await fixture();try{
  const frame=f.frame(),nonce=f.handshake();assert.equal(frame.getAttribute('sandbox'),'allow-scripts');assert.equal(frame.style.height,'200px');assert.equal(frame.style.display,'none');assert.equal(f.sent.length,1);
  f.message({type:'rendered',nonce:'wrong'});f.message({type:'resize',height:400,nonce},{fake:true});assert.equal(frame.style.display,'none');
  f.message({type:'rendered',nonce});assert.equal(frame.style.display,'none');assert.equal(f.timers.size,0);
  f.message({type:'resize',height:42,nonce});assert.equal(frame.style.height,'100px');assert.equal(frame.style.display,'block');assert.equal(f.card.element.querySelector('.agent-widget-loading').hidden,true);
  for(let i=0;i<40;i++)f.card.update({...f.trace,args:{...f.trace.args}});assert.equal(f.frame(),frame);assert.equal(f.sent.length,1);
  f.message({type:'resize',height:NaN,nonce});f.message({type:'resize',height:Infinity,nonce});assert.equal(frame.style.height,'100px');
  f.message({type:'resize',height:420.5,nonce});assert.equal(frame.style.height,'420.5px');
 }finally{f.close();}
});

test('missing code, terminal tool errors and initialization timeout hide the whole widget',async()=>{
 const f=await fixture();try{
  f.advance(9999);assert.equal(f.card.element.hidden,false);f.advance(1);assert.equal(f.card.element.hidden,true);
  f.card.update(f.trace);assert.equal(f.card.element.hidden,true);
  f.trace.args.widget_code='<p>新版</p>';f.card.update(f.trace);assert.equal(f.card.element.hidden,false);
  const nonce=f.handshake();f.message({type:'error',nonce});assert.equal(f.card.element.hidden,true);assert.equal(f.timers.size,0);assert.equal(f.errors.length,0);
  f.trace.args.widget_code='';f.card.update(f.trace);assert.equal(f.card.element.hidden,true);assert.equal(f.frame(),null);
  f.card.update({...f.trace,status:'error',args:{widget_code:'<p>ignored</p>'},result:{error:'tool failed'}});assert.equal(f.card.element.hidden,true);assert.equal(f.frame(),null);
 }finally{f.close();}
});

test('only live pending tools show the official rotating 220px generation placeholder',async()=>{
 const f=await fixture({trace:{status:'running',args:{loading_messages:['准备','编排']}}});try{
  assert.equal(f.card.element.hidden,true);assert.equal(f.frame(),null);
  f.card.update(f.trace,{streaming:true});const label=f.card.element.querySelector('.agent-widget-generating-label');assert.equal(label.textContent,'准备');assert.equal(f.intervals.size,1);
  const interval=[...f.intervals.values()][0];assert.equal(interval.ms,2500);interval.fn();assert.equal(label.textContent,'编排');
  for(let i=0;i<20;i++)f.card.update(f.trace,{streaming:true});assert.equal([...f.intervals.values()][0],interval);
  f.trace.args.title='标题优先';f.card.update(f.trace,{streaming:true});[...f.intervals.values()][0].fn();assert.equal(label.textContent,'标题优先');
  f.card.suspend();assert.equal(f.intervals.size,0);f.card.update(f.trace,{streaming:false});assert.equal(f.card.element.hidden,true);
  f.card.update({...f.trace,args:{},status:'started'},{streaming:true});assert.equal(label.textContent,'正在生成...');assert.equal(f.frame(),null);
 }finally{f.close();}
});

test('widget actions require source, nonce, current card and supported protocol; rejected prompt shows real failure',async()=>{
 const f=await fixture({onSendPrompt:()=>false});try{
  const nonce=f.handshake();f.message({type:'rendered',nonce});f.message({type:'resize',height:200,nonce});
  f.message({type:'tools/call',name:'canvas_delete',nonce});f.message({type:'openLink',url:'javascript:alert(1)',nonce});f.message({type:'openLink',url:'https://example.com',nonce:'wrong'});assert.deepEqual(f.links,[]);
  f.message({type:'openLink',url:'https://example.com/a',nonce});assert.deepEqual(f.links,['https://example.com/a']);
  f.advance(350);f.message({type:'sendPrompt',text:'  继续  ',nonce});await new Promise(setImmediate);assert.deepEqual(f.errors,['发送失败，请重试。']);
  f.setCurrent(false);f.message({type:'openLink',url:'https://example.com/b',nonce});assert.equal(f.links.length,1);
  f.setCurrent(true);f.card.suspend();f.message({type:'sendPrompt',text:'禁止',nonce});await new Promise(setImmediate);assert.equal(f.errors.length,1);
 }finally{f.close();}
});

test('suspend receives passive readiness, resumes timeout without replacing frame, and suppresses late action failures',async()=>{
 const pending=deferred(),f=await fixture({onSendPrompt:()=>pending.promise});try{
  const frame=f.frame(),nonce=f.handshake();f.advance(3000);f.card.suspend();assert.equal(f.timers.size,0);
  f.message({type:'rendered',nonce});f.message({type:'resize',height:360,nonce});f.card.update(f.trace);assert.equal(f.frame(),frame);assert.equal(frame.style.display,'block');assert.equal(f.timers.size,0);
  f.message({type:'sendPrompt',text:'继续',nonce});f.card.suspend();pending.reject(Error('late'));await new Promise(setImmediate);assert.deepEqual(f.errors,[]);
  f.trace.args.widget_code='<p>第二版</p>';f.card.update(f.trace);assert.notEqual(f.frame(),frame);f.advance(3000);f.card.suspend();f.advance(60000);assert.equal(f.card.element.hidden,false);
  f.card.update(f.trace);f.advance(6999);assert.equal(f.card.element.hidden,false);f.advance(1);assert.equal(f.card.element.hidden,true);
 }finally{f.close();}
});

test('code or trace changes invalidate old frame messages and actual reload repeats handshake',async()=>{
 const f=await fixture();try{
  const oldFrame=f.frame(),oldSource=oldFrame.contentWindow,oldNonce=f.handshake();oldFrame.dispatchEvent(new f.window.Event('load'));
  f.message({type:'rendered',nonce:oldNonce});f.message({type:'resize',height:400,nonce:oldNonce});
  oldFrame.dispatchEvent(new f.window.Event('load'));assert.equal(f.sent.length,2);assert.equal(oldFrame.style.display,'none');assert.notEqual(f.sent[1].nonce,oldNonce);
  f.message({type:'rendered',nonce:oldNonce});f.message({type:'resize',height:500,nonce:oldNonce});assert.equal(oldFrame.style.display,'none');
  f.trace.args.widget_code='<p>new</p>';f.card.update(f.trace);const next=f.frame(),nonce=f.handshake();assert.notEqual(next,oldFrame);assert.notEqual(nonce,oldNonce);
  f.message({type:'resize',height:999,nonce:oldNonce},oldSource);assert.equal(next.style.height,'200px');
  f.card.update({...f.trace,id:'another'});assert.notEqual(f.frame(),next);
  const source=f.frame().contentWindow;f.card.destroy();f.message({type:'sendPrompt',text:'ignored',nonce},source);assert.equal(f.timers.size,0);assert.equal(f.intervals.size,0);assert.deepEqual(f.prompts,[]);
 }finally{f.close();}
});

test('HTML open failures are reported only for the still-current artifact receipt',async()=>{
 const f=await fixture(),pending=deferred(),errors=[];let available=true;
 const trace={id:'html',status:'done',args:{artifact_path:'page.html'},result:{namespace:'chat',revision:'one'}};
 const card=f.createHtmlCard({trace,document:f.document,onOpen:()=>pending.promise,onError:error=>errors.push(error),isCurrent:()=>available});f.document.body.append(card.element);
 try{
  card.element.click();trace.result.revision='two';card.update(trace);pending.reject(Error('stale'));await new Promise(setImmediate);assert.deepEqual(errors,[]);
  available=false;card.element.click();await new Promise(setImmediate);assert.deepEqual(errors,[]);
  available=true;card.element.click();await new Promise(setImmediate);assert.deepEqual(errors,['stale']);
 }finally{card.destroy();f.close();}
});

test('HTML card is a completed artifact jump with official text/icon and preserves trace revision for opener',async()=>{
 const f=await fixture();let opened;const trace={id:'html',status:'done',args:{artifact_path:'pages/page.html',description:'detail'},result:{namespace:'chat',revision:'revision'}};
 const card=f.createHtmlCard({trace,document:f.document,onOpen:(target,receipt)=>{opened={target,receipt};}});f.document.body.append(card.element);
 try{
  assert.equal(card.element.tagName,'BUTTON');assert.equal(card.element.querySelector('iframe'),null);assert.equal(card.element.querySelector('.agent-show-html-title').textContent,'HTML');assert.equal(card.element.querySelector('.agent-show-html-subtitle').textContent,'打开互动作品');assert.equal(card.element.querySelector('svg').getAttribute('stroke-width'),'1');
  card.element.click();await new Promise(setImmediate);assert.equal(opened.receipt,trace);assert.deepEqual(opened.target,{artifact_path:'pages/page.html',title:'HTML',description:'detail'});
  card.update({...trace,status:'running'});assert.equal(card.element.hidden,true);card.update({...trace,args:{}});assert.equal(card.element.hidden,true);
  card.update({...trace,args:{...trace.args,title:'<img src=x onerror=1>'}});assert.equal(card.element.querySelector('img'),null);assert.equal(card.element.hidden,false);card.suspend();opened=null;card.element.click();assert.equal(opened,null);
 }finally{card.destroy();f.close();}
});

test('official proxy injects real-head CSP and only the documented bridge ahead of adversarial HTML',async()=>{
 const dom=new JSDOM('<body></body>',{url:'http://localhost:4173/src/features/agent-widgets/widget-proxy.html',runScripts:'outside-only'});
 const code=read('widget-proxy.html').match(/<script>([\s\S]*)<\/script>/)[1].replace('window.parent.postMessage({ type: "proxy-ready" }','window.__widgetTest={buildSrcdoc:buildSrcdoc,buildBridgeJs:buildBridgeJs};window.parent.postMessage({ type: "proxy-ready" }');
 try{
  dom.window.eval(code);const {buildSrcdoc,buildBridgeJs}=dom.window.__widgetTest;
  for(const html of ['<!-- <head>fake</head> --><script>bad()</script>','<title><head>fake</head></title><script>bad()</script>','<textarea><head>fake</head></textarea><script>bad()</script>']){
   const output=new dom.window.DOMParser().parseFromString(buildSrcdoc(html,'nonce'),'text/html'),head=output.head;
   assert.equal(head.firstElementChild.getAttribute('http-equiv'),'Content-Security-Policy');const csp=head.firstElementChild.content;
   assert.match(csp,/connect-src 'none'/);assert.match(csp,/frame-src 'none'/);assert.match(csp,/form-action 'none'/);assert.match(csp,/img-src data: blob:;/);
   assert.match(head.children[1].textContent,/--color-background:#161616/);assert.match(head.children[2].textContent,/window.tapnow=\{sendPrompt:window.sendPrompt,openLink:window.openLink\}/);
  }
  const sent=[],style={height:'old'},context={window:{parent:{postMessage:message=>sent.push(message)},addEventListener(){}},document:{body:{scrollHeight:120},documentElement:{style}},ResizeObserver:class{observe(){}},MutationObserver:class{observe(){}},requestAnimationFrame:fn=>fn()};
  vm.runInNewContext(buildBridgeJs('nonce'),context);context.window.sendPrompt('a');context.window.openLink('https://example.com');
  assert.equal(sent[0].height,122);assert.equal(style.height,'old');assert.equal(sent[1].type,'sendPrompt');assert.equal(sent[2].type,'openLink');assert.deepEqual(Object.keys(context.window.tapnow),['sendPrompt','openLink']);
 }finally{dom.window.close();}
});

 test('boot scripts, unfocused frames, inactive users and prompt bursts cannot submit new turns',async()=>{
 const f=await fixture();try{
  const nonce=f.handshake();f.message({type:'sendPrompt',text:'boot',nonce});assert.deepEqual(f.prompts,[]);
  f.message({type:'rendered',nonce});f.message({type:'resize',height:200,nonce});
  f.window.navigator.userActivation.isActive=false;f.message({type:'sendPrompt',text:'timer',nonce});assert.deepEqual(f.prompts,[]);
  f.window.navigator.userActivation.isActive=true;const button=f.document.createElement('button');f.document.body.append(button);button.focus();f.message({type:'sendPrompt',text:'other-control',nonce});assert.deepEqual(f.prompts,[]);
  f.frame().focus();f.message({type:'sendPrompt',text:'clicked',nonce});f.message({type:'sendPrompt',text:'burst',nonce});await new Promise(setImmediate);assert.deepEqual(f.prompts,['clicked']);
 }finally{f.close();}
});

test('late trace persistence errors hide completed cards and prevent widget or HTML actions',async()=>{
 const f=await fixture();let opens=0;const htmlTrace={id:'html-error',status:'done',args:{artifact_path:'page.html'}};
 const html=f.createHtmlCard({trace:htmlTrace,document:f.document,onOpen:()=>{opens++;}});f.document.body.append(html.element);
 try{
  const nonce=f.handshake();f.message({type:'rendered',nonce});f.message({type:'resize',height:200,nonce});
  f.trace.error='保存失败';f.card.update(f.trace);htmlTrace.error='保存失败';html.update(htmlTrace);
  assert.equal(f.card.element.hidden,true);assert.equal(html.element.hidden,true);
  f.message({type:'sendPrompt',text:'must not send',nonce});html.element.click();await new Promise(setImmediate);
  assert.deepEqual(f.prompts,[]);assert.equal(opens,0);
 }finally{html.destroy();f.close();}
});
