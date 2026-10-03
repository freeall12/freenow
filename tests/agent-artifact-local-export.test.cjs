const test=require('node:test'),assert=require('node:assert/strict');
const modules=import('../src/features/agent-artifacts/local-export.mjs');
const file=()=>({artifact_path:'artifacts/作品.html',content_type:'html',title:'真实作品',revision:5,content:'<!doctype html><h1>本地作品</h1><button onclick="this.textContent=\'已点击\'">点击</button>'});
const ready=html=>({html,sourceHash:'source-hash',status:'ready',diagnostics:[{path:'$.script[0]',code:'dynamic_code_uninspected',severity:'warning'}],summary:{slots:0,embedded:0,unresolved:0}});
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
test('derived export retains source path/revision and does not replace saved artifact content',async()=>{
  const {createHtmlExportSession}=await modules,original=file();let current=structuredClone(original),calls=0;
  const session=createHtmlExportSession({file:original,getCurrentFile:async()=>current,getResourceOptions:async()=>({index:null}),localize:async html=>{calls++;assert.equal(html,original.content);return ready(html);}});
  const result=await session.exportDocument();assert.equal(result.revision,5);assert.equal(result.artifact_path,original.artifact_path);assert.equal(result.filename,'作品.html');assert.equal(result.sourceHash,'source-hash');assert.equal(current.content,original.content);
  assert.match(result.html,/sandbox="allow-scripts"/);assert.match(result.html,/frame-src about:/);assert.doesNotMatch(result.html,/allow-same-origin|allow-top-navigation|allow-popups/);
  await session.exportDocument();assert.equal(calls,1,'same bound original preparation is reused, current revision is reread');session.close();
});
test('unknown dependencies are explicit pending diagnostics and cannot return a downloadable document',async()=>{
  const {createHtmlExportSession}=await modules,original=file(),diagnostics=[{path:'$.img[0].src',code:'source_unmapped',severity:'error'}];
  const session=createHtmlExportSession({file:original,getCurrentFile:async()=>original,getResourceOptions:async()=>({}),localize:async html=>({...ready(html),status:'pending_import',diagnostics,summary:{slots:1,embedded:0,unresolved:1}})});
  assert.equal((await session.prepare()).status,'pending_import');await assert.rejects(session.exportDocument(),error=>error.code==='html_export_pending'&&error.diagnostics[0].path==='$.img[0].src');
});
test('closed preview refuses late resource completion even when injected resolver ignores abort',async()=>{
  const {createHtmlExportSession}=await modules,original=file(),pending=deferred(),started=deferred();let signal;
  const session=createHtmlExportSession({file:original,getCurrentFile:async()=>original,getResourceOptions:async value=>{signal=value;return{};},localize:async html=>{started.resolve();await pending.promise;return ready(html);}});
  const work=session.exportDocument();await started.promise;session.close();assert.equal(signal.aborted,true);pending.resolve();await assert.rejects(work,error=>error.code==='artifact_export_stale');
});
test('replaced revision, changed same-revision body, removed source and switched caller reject late export',async()=>{
  const {createHtmlExportSession}=await modules;
  for(const kind of ['revision','body','deleted','context']){
    const original=file(),pending=deferred(),started=deferred();let current=structuredClone(original),live=true;
    const session=createHtmlExportSession({file:original,getCurrentFile:async()=>current,isCurrent:()=>live,getResourceOptions:async()=>({}),localize:async html=>{started.resolve();await pending.promise;return ready(html);}});
    const work=session.exportDocument();await started.promise;
    if(kind==='revision')current.revision++;if(kind==='body')current.content+=' changed';if(kind==='deleted')current=null;if(kind==='context')live=false;
    pending.resolve();await assert.rejects(work,error=>error.code==='artifact_export_stale');
  }
});
test('version is checked again for cached prepared output and an unbound source cannot export',async()=>{
  const {createHtmlExportSession}=await modules,original=file();let current=structuredClone(original);
  const session=createHtmlExportSession({file:original,getCurrentFile:async()=>current,getResourceOptions:async()=>({}),localize:async html=>ready(html)});
  await session.prepare();current.revision++;await assert.rejects(session.exportDocument(),/已更新/);
  const unbound=createHtmlExportSession({file:original,getResourceOptions:async()=>({}),localize:async html=>ready(html)});await assert.rejects(unbound.prepare(),/读取接口未配置/);
});
test('opaque wrapper embeds the complete prepared document as an attribute without breaking out',async()=>{
  const {offlineHtmlWrapper,exportFilename}=await modules,html='<!doctype html><html><head><style>img{width:320px}</style></head><body><img src="data:image/png;base64,real-bytes"><button onclick="this.textContent=\'交互\'">保留</button></body></html>',wrapped=offlineHtmlWrapper(html,'作品 "<&');
  assert.match(wrapped,/srcdoc="&lt;!doctype html&gt;/);assert.match(wrapped,/data:image\/png;base64,real-bytes/);assert.equal((wrapped.match(/<iframe /g)||[]).length,1);assert.equal((wrapped.match(/<\/iframe>/g)||[]).length,1);
  const hostile=offlineHtmlWrapper('</iframe><script>window.top.location="https://tapnow.media"</script>');assert.doesNotMatch(hostile,/<script>/);assert.match(hostile,/&lt;script&gt;/);
  assert.match(wrapped,/width:100%;height:100%/);assert.equal(exportFilename('artifacts/说明.html'),'说明.html');assert.throws(()=>exportFilename('../secret.html'));
});
