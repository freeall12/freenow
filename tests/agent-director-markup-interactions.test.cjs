const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const sourcePath = require.resolve('../src/features/agent-apps/resources/apps/director-markup@v1.4b53a29e.html');
const original = fs.readFileSync(sourcePath,'utf8'), runtime = import('../src/features/agent-apps/director-markup-local-interactions.mjs');
const deferred = () => {let resolve,reject;const promise = new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
async function derived() {return (await runtime).localizeDirectorMarkupInteractions(original,'director-markup','v1');}
async function harness(request) {
  const html = await derived(), requests = [], messages = [], controls = [{disabled:false},{disabled:false}], listeners = {};
  const context = {TextEncoder,btoa,setTimeout,clearTimeout,structuredClone,requests,messages,document:{documentElement:{lang:'zh-CN'},activeElement:null},navigator:{userActivation:{isActive:true}},ne:{querySelectorAll:()=>controls},S:null,Mm:false,Ce:null,Le:false,oe:'',G_:128*1024,X_:4000,Te:{mode:'closed'},B:()=>({}),ke:()=>{},se:()=>{context.Te={mode:'closed'};},gi:enabled=>{controls.forEach(control=>control.disabled=enabled);},requestAnimationFrame:()=>{},Ut:()=>{},Nn:{request:async value=>{requests.push(value.params.state);await request?.(value.params.state);},sendMessage:async value=>{messages.push(value);}}};
  vm.createContext(context);
  vm.runInContext(original.slice(original.indexOf('const E_=/^[a-z0-9]'),original.indexOf('const B_={'))+original.slice(original.indexOf('const B_={'),original.indexOf(',G_=128*1024'))+';x=hs["zh-CN"];S=Rm({version:1,locale:"zh-CN",draft:"林岚推开木门，停在雨里。😀她低头看见钥匙。",anchors:[],annotations:[]});'+original.slice(original.indexOf('function vs('),original.indexOf('function $e('))+html.slice(html.indexOf('function Qn(){'),html.indexOf('function gi(e)')),context);
  return {context,html,requests,messages,controls,listeners,run:code=>vm.runInContext(code,context)};
}
test('derivative pins the full original SHA and preserves the complete official model and five locales',async()=>{
  const module = await runtime, html = await derived();
  assert.equal(require('node:crypto').createHash('sha256').update(original).digest('hex'),module.directorMarkupSourceSha256);
  assert.equal(await module.localizeDirectorMarkupInteractions('other','story-room','v1'),'other');
  await assert.rejects(module.localizeDirectorMarkupInteractions(original+'\n','director-markup','v1'),/integrity/);
  await assert.rejects(module.localizeDirectorMarkupInteractions(original,'director-markup','v2'),/unsupported/);
  const script = html.match(/<script\b[^>]*>([\s\S]*?)<\/script>/)[1];require('esbuild').transformSync(script,{loader:'js',format:'esm'});
  assert.equal(html.slice(html.indexOf('const E_='),html.indexOf(',G_=128*1024')),original.slice(original.indexOf('const E_='),original.indexOf(',G_=128*1024')));
  assert.equal(fs.readFileSync(sourcePath,'utf8'),original);
  const h = await harness();
  for(const locale of ['zh-CN','en-US','ja-JP','ko-KR','fr-FR']) {h.context.language=locale;assert.equal(h.run('Rm({version:1,locale:language,draft:"source"}).locale'),locale);for(const key of ['shot','motion','cut','emotion','delete','confirm','orphaned','saveFailed'])assert.ok(h.run(`hs[language]["${key}"]`));}
});
test('actual native editor handlers distinguish ranges from caret insertion and cancel on blur or Escape',async()=>{
  const h = await harness(), handlers = {}, selected=[];
  h.context.editor={selectionStart:0,selectionEnd:2,value:h.context.S.draft,addEventListener:(name,callback)=>handlers[name]=callback};
  h.context.n$=(_editor,selection)=>selected.push(selection);h.context.Qn=()=>{};h.context.e$=()=>{};
  vm.runInContext(h.html.slice(h.html.indexOf('function Y_('),h.html.indexOf('function e$(')),h.context);
  h.run('Y_(editor)');handlers.mouseup();assert.equal(h.context.Te.mode,'range');assert.deepEqual(Array.from(h.context.Te.actions),['shot','motion']);assert.equal(selected[0].end,2);
  h.context.editor.selectionStart=h.context.editor.selectionEnd=9;handlers.select();assert.equal(h.context.Te.mode,'point');assert.deepEqual(Array.from(h.context.Te.actions),['cut','emotion']);
  handlers.keyup({key:'Escape'});assert.equal(h.context.Te.mode,'closed');handlers.click();handlers.blur({relatedTarget:null});assert.equal(h.context.Te.mode,'closed');
  handlers.click();handlers.blur({relatedTarget:{closest:()=>true}});assert.equal(h.context.Te.mode,'point');
});
test('official range reuse, four note kinds, delete and edit anchor relocation retain their actual contract',async()=>{
  const h=await harness();h.run('S=A_(S,{type:"range",start:0,end:2},"shot").model;S=C_(S,"n1","中景~,%😀");S=A_(S,{type:"range",start:0,end:2},"motion").model;S=C_(S,"n2","缓慢推进");S=A_(S,{type:"point",offset:9},"cut").model;S=C_(S,"n3","切到钥匙");S=A_(S,{type:"point",offset:9},"emotion").model;S=C_(S,"n4","警觉转为迟疑")');
  assert.equal(h.context.S.anchors.length,2);assert.equal(h.context.S.annotations.length,4);assert.equal(h.run('A_(S,{type:"range",start:0,end:2},"shot").created'),false);
  const before=h.run('V_(S)');assert.match(before,/^DM1 data=/);await h.run('i$()');
  const module=await import('../src/features/agent-apps/director-markup.mjs');assert.match((await module.resolveDirectorMarkupReply(h.messages[0].content[0].text,h.context.S.baseDraft,h.requests[0])).text,/中景~,%😀/);
  h.run('S=M_(S,"序："+S.draft)');assert.equal(h.context.S.anchors[0].start,2);assert.equal(h.context.S.anchors[1].offset,11);
  h.run('S=M_(S,S.draft.slice(0,2)+"另一个人"+S.draft.slice(4))');assert.equal(h.context.S.anchors[0].status,'orphaned');assert.throws(()=>h.run('V_(S)'),/Orphaned/);
  h.run('S=L_(S,"n1");S=L_(S,"n2")');assert.equal(h.context.S.anchors.length,1);assert.equal(h.context.S.annotations.length,2);assert.doesNotThrow(()=>h.run('V_(S)'));
});
test('selection toolbar buttons preserve pointer selection and add the intended annotation',async()=>{
  const h=await harness(), toolbar={hidden:true,style:{},getBoundingClientRect:()=>({width:200,height:30})}, editor={selectionDirection:'backward',getBoundingClientRect:()=>({top:0,bottom:300})};
  const buttons=[{dataset:{kind:'shot'}},{dataset:{kind:'motion'}}];toolbar.querySelectorAll=()=>buttons;
  h.context.window={innerWidth:800,innerHeight:600};h.context.ne.querySelector=()=>toolbar;h.context.Rn=()=>({getBoundingClientRect:()=>({left:120,top:50,bottom:70})});
  vm.runInContext(h.html.slice(h.html.indexOf('function n$('),h.html.indexOf('function Qn(')),h.context);
  h.run('Te=W_({type:"range",start:0,end:2})');h.context.editor=editor;h.run('n$(editor,Te.selection)');assert.equal(toolbar.hidden,false);assert.match(toolbar.innerHTML,/所选文字/);
  let prevented=0;buttons[0].onpointerdown({preventDefault(){prevented++;}});buttons[0].onclick();assert.equal(prevented,1);assert.equal(h.context.S.annotations[0].kind,'shot');assert.equal(h.context.S.activeAnnotationId,'n1');assert.equal(toolbar.hidden,true);clearTimeout(h.context.Ce);
});
test('focus on a real note persists the active annotation and deletion removes its unused anchor',async()=>{
  const h=await harness();h.run('S=A_(S,{type:"range",start:0,end:2},"shot").model;S=C_(S,"n1","中景")');
  const textarea={},button={},note={dataset:{noteId:'n1'},querySelector:selector=>selector==='textarea'?textarea:button};h.context.ne.querySelectorAll=()=>[note];h.context.Qn=()=>{h.context.focusSaves=(h.context.focusSaves??0)+1;};
  vm.runInContext(h.html.slice(h.html.indexOf('function t$('),h.html.indexOf('function ke(')),h.context);h.run('t$()');textarea.onfocus();assert.equal(h.context.S.activeAnnotationId,'n1');assert.equal(h.context.focusSaves,1);
  button.onclick();assert.equal(h.context.S.annotations.length,0);assert.equal(h.context.S.anchors.length,0);assert.equal(h.context.S.activeAnnotationId,null);
});
test('slow saves coalesce intermediate edits and completion-phase saves cannot lose the last state',async()=>{
  const delay=deferred(),h=await harness(()=>h.requests.length===1?delay.promise:undefined),first=h.run('Jm()');await Promise.resolve();h.run('S={...S,draft:S.draft+"一"}');const second=h.run('Jm()');h.run('S={...S,draft:S.draft+"二"}');const third=h.run('Jm()');delay.resolve();await Promise.all([first,second,third]);assert.equal(h.requests.length,2);assert.match(h.requests[1].draft,/一二$/);
  const unchanged=h.run('Jm()');await Promise.resolve();h.run('S={...S,draft:S.draft+"三"}');const changed=h.run('Jm()');await Promise.all([unchanged,changed]);assert.equal(h.requests.length,3);assert.match(h.requests[2].draft,/一二三$/);
});
test('failed save blocks confirmation, retries the same state and clears failure status',async()=>{
  let fail=true;const h=await harness(()=>{if(fail)throw Error('transaction rejected');});await h.run('i$()');assert.equal(h.messages.length,0);assert.equal(h.context.oe,h.run('x.saveFailed'));assert.equal(h.context.Le,false);
  fail=false;await h.run('i$()');assert.equal(h.messages.length,1);assert.equal(h.context.oe,'');assert.equal(h.controls[0].disabled,false);
});
test('rapid confirms lock before await and use the exact saved draft, restoring focus',async()=>{
  const delay=deferred(),h=await harness(()=>delay.promise);let focused=0;h.context.document.activeElement={isConnected:true,focus(){focused++;}};
  const first=h.run('i$()');await h.run('i$()');assert.equal(h.context.Le,true);assert.equal(h.controls[0].disabled,true);assert.equal(h.messages.length,0);delay.resolve();await first;assert.equal(h.messages.length,1);assert.equal(focused,1);assert.equal(h.context.Le,false);
});
test('expired temporary activation keeps committed edits and requires a fresh confirmation click',async()=>{
  const delay=deferred(),h=await harness(()=>delay.promise),pending=h.run('i$()');h.context.navigator.userActivation.isActive=false;delay.resolve();await pending;assert.equal(h.messages.length,0);assert.equal(h.context.oe,'已保存，请再次点击确认。');
  h.context.navigator.userActivation.isActive=true;await h.run('i$()');assert.equal(h.requests.length,1);assert.equal(h.messages.length,1);
});
test('unexpected state change while confirmation saves is rejected without sending an old DM1',async()=>{
  const delay=deferred(),h=await harness(()=>delay.promise),pending=h.run('i$()');h.run('S={...S,draft:S.draft+"变化"}');delay.resolve();await pending;assert.equal(h.messages.length,0);assert.equal(h.context.oe,h.run('x.sendFailed'));
});
test('lifecycle flush clears pending debounce and stores edits without queueing confirmation',async()=>{
  const h=await harness();h.run('Qn()');assert.notEqual(h.context.Ce,null);await h.run('directorFlush()');assert.equal(h.context.Ce,null);assert.equal(h.requests.length,1);assert.equal(h.messages.length,0);assert.match(h.html,/freenow\/lifecycleFlush/);
  h.context.saved=h.requests[0];assert.equal(h.run('R_(Rm({version:1,draft:S.baseDraft}),saved).draft'),h.context.S.draft);
});
test('Escape consumes the existing toolbar action even while its button has keyboard focus',async()=>{
  const h=await harness();let listener,prevented=0;h.context.document.addEventListener=(_name,callback)=>{listener=callback;};
  const start=h.html.indexOf('document.addEventListener("keydown",event=>');vm.runInContext(h.html.slice(start,h.html.indexOf('for(const event of ["change","focusout"])',start)),h.context);
  h.run('Te=W_({type:"range",start:0,end:2})');listener({key:'Escape',isComposing:true,preventDefault(){prevented++;}});assert.equal(h.context.Te.mode,'range');
  listener({key:'Escape',isComposing:false,preventDefault(){prevented++;}});assert.equal(h.context.Te.mode,'closed');assert.equal(prevented,1);
});
test('only toolbar Escape restores editor focus without changing its range or reopening the toolbar',async()=>{
  const h=await harness();let listener,focuses=0,focusOptions;
  const editor={selectionStart:2,selectionEnd:8,selectionDirection:'backward',focus(options){focuses++;focusOptions=options;}};
  h.context.ne.querySelector=selector=>selector==='.dm-editor'?editor:null;h.context.document.addEventListener=(_name,callback)=>{listener=callback;};
  const start=h.html.indexOf('document.addEventListener("keydown",event=>');vm.runInContext(h.html.slice(start,h.html.indexOf('for(const event of ["change","focusout"])',start)),h.context);
  h.run('Te=W_({type:"range",start:2,end:8})');listener({key:'Escape',target:{closest:selector=>selector==='.dm-toolbar'?{}:null},preventDefault(){}});
  assert.equal(h.context.Te.mode,'closed');assert.equal(focuses,1);assert.equal(focusOptions.preventScroll,true);assert.deepEqual([editor.selectionStart,editor.selectionEnd,editor.selectionDirection],[2,8,'backward']);
  h.run('Te=W_({type:"range",start:2,end:8})');listener({key:'Escape',target:{closest:()=>null},preventDefault(){}});assert.equal(focuses,1);assert.equal(h.context.Te.mode,'closed');
});
