const {test}=require('node:test'),assert=require('node:assert/strict');
const {createRequire}=require('node:module'),fabricRequire=createRequire(require.resolve('fabric')),domRequire=createRequire(fabricRequire.resolve('jsdom'));
const canvasPath=domRequire.resolve('canvas'),previousCanvas=require.cache[canvasPath];require.cache[canvasPath]={id:canvasPath,loaded:true,exports:{createCanvas:undefined}};const {JSDOM}=fabricRequire('jsdom');if(previousCanvas)require.cache[canvasPath]=previousCanvas;else delete require.cache[canvasPath];
const tick=()=>new Promise(setImmediate),deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const emptyIndex={version:1,algorithm:'sha256-exact-utf8',entries:{}};
test('Widget localizer resolves actual asset bytes, preserves raw source, caches valid bindings and retries missing assets',async()=>{
 const {createWidgetHtmlResources}=await import('../src/features/agent-widgets/html-resources.mjs'),dom=new JSDOM('<body/>',{url:'http://localhost:4173/'});let available=true,url='blob:first',reads=0;
 const asset={url:async()=>{if(!available)throw Error('missing');return url;}},blob=new Blob([Uint8Array.of(1,2,3)],{type:'image/png'});
 const localizer=createWidgetHtmlResources({document:dom.window.document,getAssets:()=>asset,loadIndex:async()=>({index:emptyIndex,state:'ready'}),fetchImpl:async ref=>{assert.ok(ref.startsWith('blob:'));reads++;return new Response(blob,{headers:{'content-type':blob.type}});}});
 const code='<img src="asset:one"><button onclick="sendPrompt(\'continue\')">go</button>';
 const first=await localizer.prepare(code);assert.equal(first.status,'ready');assert.match(first.html,/data:image\/png;base64,AQID/);assert.match(first.html,/img-src data: blob:/);assert.match(first.html,/connect-src 'none'/);assert.ok(code.includes('asset:one'));assert.equal(reads,1);
 assert.equal(await localizer.prepare(code),first);assert.equal(reads,1);url='blob:second';await localizer.prepare(code);assert.equal(reads,2);
 available=false;await assert.rejects(localizer.prepare(code),/missing/);available=true;const retried=await localizer.prepare(code);assert.equal(retried.status,'ready');
 const missing=await localizer.prepare('<img src="https://unmapped.invalid/file.png">');assert.equal(missing.status,'pending_import');assert.equal(reads,2,'never fetch unmapped original service');
 localizer.dispose();dom.window.close();
});
test('Widget never posts stale asynchronous HTML after code, trace, frame, session or lifecycle changes',async()=>{
 const {createWidgetCard}=await import('../src/features/agent-widgets/cards.mjs');
 for(const change of ['code','trace','reload','session','suspend','destroy']){
  const dom=new JSDOM('<body/>',{url:'http://localhost:4173/'}),{window}=dom,document=window.document;window.crypto.randomUUID=require('node:crypto').randomUUID;
  const pending=[],sent=[],trace={id:'widget',name:'show_widget',status:'done',args:{widget_code:'<img src="asset:old">'}};let current=true;const signals=[];
  const card=createWidgetCard({trace,document,isCurrent:()=>current,prepareResources:(_code,options)=>{const call=deferred();pending.push(call);signals.push(options.signal);return call.promise;}});document.body.append(card.element);
  const frame=card.element.querySelector('iframe');frame.contentWindow.postMessage=p=>sent.push(p);window.dispatchEvent(new window.MessageEvent('message',{source:frame.contentWindow,data:{type:'proxy-ready'}}));assert.equal(sent.length,0);
  if(change==='code'){trace.args.widget_code='<p>new</p>';card.update(trace);}else if(change==='trace')card.update({...trace});else if(change==='reload'){frame.dispatchEvent(new window.Event('load'));frame.dispatchEvent(new window.Event('load'));}else if(change==='session')current=false;else card[change]();
  pending[0].resolve({status:'ready',html:'<p>OLD RESOURCE</p>'});await tick();assert.ok(!sent.some(p=>p.html==='<p>OLD RESOURCE</p>'),'stale result cannot post');
  if(['trace','reload'].includes(change)){assert.ok(pending.length>1);pending.at(-1).resolve({status:'ready',html:'<p>FRESH RESOURCE</p>'});await tick();assert.ok(sent.some(p=>p.html==='<p>FRESH RESOURCE</p>'));}
  if(change!=='session')assert.equal(signals[0].aborted,true);
  card.destroy();window.close();
 }
});
test('unresolved Widget remains visibly pending and explicit retry can complete the existing frame',async()=>{
 const {createWidgetCard}=await import('../src/features/agent-widgets/cards.mjs'),dom=new JSDOM('<body/>',{url:'http://localhost:4173/'}),{window}=dom,document=window.document;window.crypto.randomUUID=require('node:crypto').randomUUID;let attempts=0;const sent=[];
 const card=createWidgetCard({trace:{id:'w',name:'show_widget',status:'done',args:{widget_code:'<img src="asset:missing">'}},document,prepareResources:async()=>++attempts===1?{status:'pending_import',summary:{unresolved:1}}:{status:'ready',html:'<p>repaired</p>'}});document.body.append(card.element);const frame=card.element.querySelector('iframe');frame.contentWindow.postMessage=p=>sent.push(p);window.dispatchEvent(new window.MessageEvent('message',{source:frame.contentWindow,data:{type:'proxy-ready'}}));await tick();assert.equal(sent.length,0);assert.equal(card.element.hidden,false);assert.match(card.element.textContent,/资源待修复/);
 [...card.element.querySelectorAll('button')].find(b=>b.textContent==='重试资源').click();await tick();assert.equal(sent.length,1);assert.equal(sent[0].html,'<p>repaired</p>');assert.equal(card.element.querySelector('iframe'),frame);card.destroy();window.close();
});
