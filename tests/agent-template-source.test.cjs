const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),cryptoNode=require('node:crypto');
const base='../src/features/agent-apps/';
async function sample(id='A01'){
 const {creativeTemplateReferences}=await import(base+'creative-template-references.mjs'),{creativeSelectionPrompt,creativePickerUri,creativeCatalogSha256}=await import(base+'creative-picker.mjs');
 const selection={schema_version:1,library_version:'1.1.0',catalog_sha256:creativeCatalogSha256,locale:'zh_CN',skill:'creative-generative-art',family:'art',template_id:id,template_name:'模板',parameters:{title:'实际修改',subtitle:'用户描述',accent:'#abcdef',intensity:.4,seed:21},output:{kind:'animation-html',width:1200,height:675,fps:60,duration:12},user_request:'我的需求',initial_state:{dragX:.3,dragY:-.2,progress:.42}};
 const state={version:1,mode:'art',selectedId:id,drafts:{[id]:{parameters:selection.parameters,request:selection.user_request}},inputs:{[id]:selection.initial_state},pending:{id:'creative_handoff_001',accepted:true,signature:JSON.stringify(selection)}};
 const trace={id:'saved_trace_1',callId:'saved_call_1',name:'show_app',status:'done',args:{resource_uri:creativePickerUri},result:{kind:'mcp_app',resource_uri:creativePickerUri,response:{original_request:'原需求'}},appState:state,appHandoffs:[state.pending.id]};
 const message={role:'user',hidden:true,text:creativeSelectionPrompt({...selection,template_ref:creativeTemplateReferences[id]},state.pending.id,'原需求'),widgetOrigin:{traceId:trace.id,resourceUri:creativePickerUri,callId:trace.callId,handoffId:state.pending.id}};
 return {trace,message};
}
function file(content){const bytes=new TextEncoder().encode(content);return {name:'local-template.html',size:bytes.length,arrayBuffer:async()=>bytes.slice().buffer};}
// Synthetic contract fixtures exercise accepted saves without claiming we have
// any official template body. Real SHA-256 rejection is tested separately.
async function syntheticDigest(content,digest,callback){
 const descriptor=Object.getOwnPropertyDescriptor(globalThis,'crypto'),original=globalThis.crypto,bytes=typeof content==='string'?new TextEncoder().encode(content):new Uint8Array(content);
 Object.defineProperty(globalThis,'crypto',{configurable:true,value:{subtle:{digest:async(algorithm,input)=>Buffer.compare(Buffer.from(input),Buffer.from(bytes))===0?Buffer.from(digest,'hex'):original.subtle.digest(algorithm,input)}}});
 try{return await callback();}finally{Object.defineProperty(globalThis,'crypto',descriptor);}
}
async function memoryStore(){
 const model=await import('../src/features/agent-artifacts/model.mjs'),{verifyStoredTemplateSource}=await import(base+'template-source.mjs');let document={files:[],revision:0};
 return {get document(){return document;},list:async()=>document.files.map(model.metadata),get:async path=>{const value=document.files.find(file=>file.artifact_path===path);if(!value)throw Error('产物不存在');return verifyStoredTemplateSource(value);},write:async input=>{document=model.nextDocument(document,input);return model.metadata(document.files.find(file=>file.artifact_path===input.artifact_path));},importTemplate:async(input,{guard})=>{guard();const next=model.nextTemplateImport(document,input);guard();document=next;return {source:model.metadata(next.files.find(file=>file.artifact_path===input.source_path)),artifact:model.metadata(next.files.find(file=>file.artifact_path===input.artifact_path))};},subscribe:()=>()=>{}};
}
test('92 registered references match exact preserved picker maps; installed picker HTML is not the selected body',async()=>{
 const {motionTemplateReferences,motionTemplateDurations}=await import(base+'motion-template-references.mjs'),{creativeTemplateReferences}=await import(base+'creative-template-references.mjs');
 const source=fs.readFileSync('src/features/agent-apps/resources/apps/motion-picker@v1.11addd0c.html','utf8'),start=source.indexOf('window.TemplateReferences=')+'window.TemplateReferences='.length;
 let depth=0,end=start;for(;end<source.length;end++){if(source[end]==='{')depth++;if(source[end]==='}'&&!--depth){end++;break;}}
 const refs=JSON.parse(source.slice(start,end));assert.deepEqual(motionTemplateReferences,refs);assert.equal(Object.keys(refs).length+Object.keys(creativeTemplateReferences).length,92);
 const catalogStart=source.indexOf('window.MotionCatalog=')+'window.MotionCatalog='.length,catalog=JSON.parse(source.slice(catalogStart,source.indexOf('];',catalogStart)+1));assert.deepEqual(motionTemplateDurations,Object.fromEntries(catalog.map(item=>[item.id,item.duration])));
 const {acceptedTemplateIdentity,verifyTemplateBytes}=await import(base+'template-source.mjs'),{trace,message}=await sample(),identity=acceptedTemplateIdentity(trace,message);
 assert.notEqual(cryptoNode.createHash('sha256').update(source).digest('hex'),identity.sha256);
 await assert.rejects(()=>verifyTemplateBytes(new TextEncoder().encode('<html>not the selected original</html>'),identity),/SHA256/);
});
test('UTF-8 decode and explicit character capacity reject oversized input after byte identity verification',async()=>{
 const {acceptedTemplateIdentity,verifyTemplateBytes}=await import(base+'template-source.mjs'),{trace,message}=await sample(),identity=acceptedTemplateIdentity(trace,message),content='x'.repeat(60001);
 await syntheticDigest(content,identity.sha256,async()=>{await assert.rejects(()=>verifyTemplateBytes(new TextEncoder().encode(content),identity),/UTF-16/);});
 const invalidUtf8=Uint8Array.from([0xc0,0xaf]);await syntheticDigest(invalidUtf8,identity.sha256,async()=>{await assert.rejects(()=>verifyTemplateBytes(invalidUtf8,identity),/有效 UTF-8/);});
 await assert.rejects(()=>verifyTemplateBytes(new Uint8Array(240001),identity),/容量/);
});
test('accepted source requires real hidden handoff, current selection, exact registered ref and unchanged drafts',async()=>{
 const {acceptedTemplateIdentity}=await import(base+'template-source.mjs');const {trace,message}=await sample();assert.equal(acceptedTemplateIdentity(trace,message).template_id,'A01');
 for(const alter of [x=>x.message.hidden=false,x=>x.message.widgetOrigin.callId='other',x=>x.trace.appHandoffs=[],x=>x.trace.appState.selectedId='A17',x=>x.trace.appState.drafts.A01.parameters.title='late edit',x=>x.message.text=x.message.text.replace('awaiting-content','generate-now')]){const x=structuredClone({trace,message});alter(x);assert.throws(()=>acceptedTemplateIdentity(x.trace,x.message));}
});
test('Motion accepted handoff uses the official spec and current saved draft, without reusing Creative state schema',async()=>{
 const {acceptedTemplateIdentity,motionPickerUri,motionCatalogSha256}=await import(base+'template-source.mjs'),{motionTemplateReferences,motionTemplateDurations}=await import(base+'motion-template-references.mjs'),{creativeSelectionPrompt}=await import(base+'creative-picker.mjs');
 const spec={schema_version:1,skill:'tapnow-motion',library_version:'2.0.0',catalog_sha256:motionCatalogSha256,template_id:'T01',template_name:'行遮罩追赶',parameters:{accent:'#e15c3b',text:'MOTION'},output:{width:1200,height:675,fps:60,duration:motionTemplateDurations.T01},user_request:'实际文字',template_ref:motionTemplateReferences.T01};
 const trace={id:'motion_trace',callId:'motion_call',name:'show_app',status:'done',args:{resource_uri:motionPickerUri},result:{kind:'mcp_app',resource_uri:motionPickerUri,response:{original_request:''}},appState:{selectedId:'T01',drafts:{T01:{accent:'#e15c3b',text:'MOTION',request:'实际文字'}},pending:{id:'motion_handoff_123',accepted:true}},appHandoffs:['motion_handoff_123']};
 const message={role:'user',hidden:true,text:creativeSelectionPrompt(spec,'motion_handoff_123','').replace('Use the tapnow-creative skill.','Use the tapnow-motion skill.'),widgetOrigin:{traceId:trace.id,callId:trace.callId,resourceUri:motionPickerUri,handoffId:'motion_handoff_123'}};
 assert.equal(acceptedTemplateIdentity(trace,message).template_id,'T01');trace.appState.drafts.T01.text='CHANGED';assert.throws(()=>acceptedTemplateIdentity(trace,message));
});
test('runtime wrong digest, obsolete handoff, busy and file-read chat switch never save an artifact or receipt',async()=>{
 const {createTemplateSourceRuntime}=await import(base+'template-source-runtime.mjs'),{trace,message}=await sample(),store=await memoryStore(),chat={messages:[trace,message]},context={chat,panelActive:true,pageLeaving:false,running:false};
 const runtime=createTemplateSourceRuntime({getContext:()=>context,store,persistConversation:async()=>true});assert.equal((await runtime.describe(trace)).status,'missing');
 await assert.rejects(()=>runtime.importFile(trace,file('<html>wrong</html>')),/SHA256/);assert.equal(store.document.files.length,0);assert.equal(trace.templateSourceImports,undefined);
 context.running=true;await assert.rejects(()=>runtime.importFile(trace,file('x')),/运行中/);context.running=false;
 const switched=file('x');switched.arrayBuffer=async()=>{context.chat={messages:[]};return new TextEncoder().encode('x').buffer;};await assert.rejects(()=>runtime.importFile(trace,switched),/来源已变化/);context.chat=chat;
 trace.appState.pending.id='new_handoff_123';assert.equal((await runtime.describe(trace)).status,'unavailable');runtime.dispose();
});
test('description currentness is host-owned and rejects clone, late selection/chat and disposed runtime',async()=>{
 const {createTemplateSourceRuntime}=await import(base+'template-source-runtime.mjs'),{trace,message}=await sample(),chat={messages:[trace,message]},context={chat,panelActive:true},runtime=createTemplateSourceRuntime({getContext:()=>context,store:await memoryStore(),persistConversation:async()=>true});
 const described=await runtime.describe(trace);assert.equal(described.status,'missing');assert.equal(runtime.isDescriptionCurrent(described),true);assert.equal(runtime.isDescriptionCurrent(structuredClone(described)),false);
 trace.appState.drafts.A01.request='changed';assert.equal(runtime.isDescriptionCurrent(described),false);trace.appState.drafts.A01.request='我的需求';assert.equal(runtime.isDescriptionCurrent(described),true);
 context.chat={messages:[]};assert.equal(runtime.isDescriptionCurrent(described),false);context.chat=chat;runtime.dispose();assert.equal(runtime.isDescriptionCurrent(described),false);
});
test('synthetic verified bytes atomically create immutable source and editable latest revision; normal writes cannot mint or replace provenance',async()=>{
 const {acceptedTemplateIdentity,verifyTemplateBytes}=await import(base+'template-source.mjs'),{nextTemplateImport,nextDocument,metadata}=await import('../src/features/agent-artifacts/model.mjs'),{trace,message}=await sample(),identity=acceptedTemplateIdentity(trace,message),content='\uFEFF<html>fixture 中文</html>';
 await syntheticDigest(content,identity.sha256,async()=>{
  const source=await verifyTemplateBytes(new TextEncoder().encode(content),identity),input={source,source_path:'artifacts/test/source.html',artifact_path:'artifacts/test/editable.html',title:'A01'};
  assert.equal(source.byte_length,new TextEncoder().encode(content).length);assert.equal(source.utf16_length,content.length);
  assert.throws(()=>nextTemplateImport({files:[],revision:0},{...input,source:{...source}}),/未经过/);
  let doc=nextTemplateImport({files:[],revision:0},input),original=doc.files[0],edit=doc.files[1];assert.equal(doc.files.length,2);assert.equal(original.template_source_immutable,true);assert.equal(edit.source_revision,original.revision);assert.ok(!Object.hasOwn(metadata(original),'template_source_bytes'));
  const ordinary={artifact_path:edit.artifact_path,title:edit.title,content_type:'html',content:'<html>latest user edit</html>',expected_revision:edit.revision};
  doc=nextDocument(doc,ordinary);edit=doc.files.find(f=>f.artifact_path===ordinary.artifact_path);assert.deepEqual(edit.template_source_identity,identity);assert.equal(edit.source_revision,1);assert.equal(edit.revision,3);assert.equal(nextTemplateImport(doc,input).files.find(f=>f.artifact_path===edit.artifact_path).content,ordinary.content);
  assert.throws(()=>nextDocument(doc,{...ordinary,expected_revision:edit.revision,template_source_identity:identity}),/仅能/);assert.throws(()=>nextDocument(doc,{...ordinary,expected_revision:edit.revision,source_revision:2}),/不可替换/);assert.throws(()=>nextDocument(doc,{...ordinary,artifact_path:original.artifact_path,expected_revision:original.revision}),/只读/);assert.throws(()=>nextDocument(doc,{...ordinary,artifact_path:'artifacts/fake.html',expected_revision:0,source_artifact_path:original.artifact_path,source_revision:1}),/不能创建/);assert.throws(()=>nextDocument(doc,ordinary),/已更新/);
  assert.throws(()=>nextTemplateImport({revision:199,files:Array.from({length:199},(_,i)=>({artifact_path:'artifacts/'+i+'.txt',content:'x',revision:i+1}))},input),/200/);
 });
});
test('synthetic runtime persisted receipt, latest edits, save failure compensation and original-byte corruption checks',async()=>{
 const {createTemplateSourceRuntime}=await import(base+'template-source-runtime.mjs'),{acceptedTemplateIdentity}=await import(base+'template-source.mjs'),{trace,message}=await sample(),identity=acceptedTemplateIdentity(trace,message),content='<html>synthetic body</html>';
 await syntheticDigest(content,identity.sha256,async()=>{
  const store=await memoryStore(),chat={messages:[trace,message]};let saves=0,failReceipt=false;const context={chat,panelActive:true,pageLeaving:false};
  const runtime=createTemplateSourceRuntime({getContext:()=>context,store,persistConversation:async()=>{saves++;return !(failReceipt&&saves%3===2);}});
  const imported=await runtime.importFile(trace,file(content));assert.equal(imported.status,'imported');assert.equal(trace.templateSourceImports.length,1);assert.equal(store.document.files.length,2);
  const edited=await store.write({artifact_path:imported.artifact.artifact_path,title:'user latest',content_type:'html',content:'<html>user revised</html>',expected_revision:imported.artifact.revision});assert.equal((await runtime.describe(trace)).artifact.revision,edited.revision);
  const again=await runtime.importFile(trace,file(content));assert.equal(again.artifact.revision,edited.revision);assert.equal((await store.get(edited.artifact_path)).content,'<html>user revised</html>');runtime.dispose();
  const second=await sample();second.trace.id='second_trace';second.message.widgetOrigin.traceId='second_trace';const secondChat={messages:[second.trace,second.message]};let count=0;const failing=createTemplateSourceRuntime({getContext:()=>({chat:secondChat,panelActive:true}),store:await memoryStore(),persistConversation:async()=>++count!==2});
  await assert.rejects(()=>failing.importFile(second.trace,file(content)),/已保存.*未声明/);assert.equal(second.trace.templateSourceImports,undefined);assert.equal((await failing.describe(second.trace)).status,'imported');assert.equal(count,3);failing.dispose();
  const original=store.document.files.find(f=>f.template_source_immutable);original.template_source_bytes[0]^=1;await assert.rejects(()=>store.get(original.artifact_path),/SHA256/);
 });
});
test('actual import controls retain failed conversation receipt warning after refresh; retry confirms without resetting editable body',async()=>{
 const {createRequire}=require('node:module'),projectRequire=createRequire(process.cwd()+'/package.json'),fabricRequire=createRequire(projectRequire.resolve('fabric')),jsdomRequire=createRequire(fabricRequire.resolve('jsdom')),canvas=jsdomRequire.resolve('canvas'),cachedCanvas=require.cache[canvas];
 require.cache[canvas]={exports:{createCanvas:undefined}};let JSDOM;try{({JSDOM}=fabricRequire('jsdom'));}finally{if(cachedCanvas)require.cache[canvas]=cachedCanvas;else delete require.cache[canvas];}
 const dom=new JSDOM('<body></body>',{url:'http://localhost:4173'}),previousDocument=globalThis.document;globalThis.document=dom.window.document;
 const {createTemplateSourceRuntime}=await import(base+'template-source-runtime.mjs'),{createTemplateSourceControls}=await import(base+'template-source-controls.mjs'),{acceptedTemplateIdentity}=await import(base+'template-source.mjs'),{trace,message}=await sample(),identity=acceptedTemplateIdentity(trace,message),content='<html>synthetic controls body</html>',store=await memoryStore(),chat={messages:[trace,message]},errors=[];let saves=0;
 const runtime=createTemplateSourceRuntime({getContext:()=>({chat,panelActive:true}),store,persistConversation:async()=>++saves!==2}),controls=createTemplateSourceControls({trace,runtime,onOpenArtifact:async()=>{},onError:message=>errors.push(message)});document.body.append(controls.element);await controls.refresh();
 try{await syntheticDigest(content,identity.sha256,async()=>{
  async function choose(){const importing=controls.element.querySelector('button').onclick(),input=document.querySelector('input[type=file]');assert.ok(input);Object.defineProperty(input,'files',{value:[file(content)]});await input.onchange();await importing;}
  await choose();await controls.refresh();assert.equal(store.document.files.length,2);assert.equal(trace.templateSourceImports,undefined);assert.equal(saves,3);assert.match(errors[0],/未声明导入成功/);assert.match(controls.element.querySelector('output').textContent,/回执未确认|未声明导入成功/);assert.equal(controls.element.querySelectorAll('button')[1].disabled,false);
  const described=await runtime.describe(trace),edited=await store.write({artifact_path:described.artifact.artifact_path,title:'latest',content_type:'html',content:'<html>latest edit</html>',expected_revision:described.artifact.revision});await choose();await controls.refresh();assert.equal((await runtime.describe(trace)).receipt_status,'confirmed');assert.equal((await runtime.describe(trace)).artifact.revision,edited.revision);assert.doesNotMatch(controls.element.querySelector('output').textContent,/未确认|未声明导入成功/);
 });}finally{controls.destroy();runtime.dispose();dom.window.close();if(previousDocument===undefined)delete globalThis.document;else globalThis.document=previousDocument;}
});
test('actual store import commits both files in one transaction; guard/second-file capacity failures commit neither',async()=>{
 const {createStore}=await import('../src/features/agent-artifacts/store.mjs'),{verifyTemplateBytes,acceptedTemplateIdentity}=await import(base+'template-source.mjs'),{trace,message}=await sample(),identity=acceptedTemplateIdentity(trace,message),content='<html>synthetic transaction body</html>';
 function transactionalDb(initial){let document=initial,puts=0,commits=0,aborts=0;const database={transaction(){let next=document,aborted=false;const tx={objectStore:()=>({get(){const request={};queueMicrotask(()=>{request.result=structuredClone(document);request.onsuccess();queueMicrotask(()=>{if(aborted)return;document=next;commits++;tx.oncomplete();});});return request;},put(value){puts++;next=value;}}),abort(){aborted=true;aborts++;queueMicrotask(()=>tx.onabort());}};return tx;}};return {get document(){return document;},get puts(){return puts;},get commits(){return commits;},get aborts(){return aborts;},open(){const request={};queueMicrotask(()=>{request.result=database;request.onsuccess();});return request;}};}
 await syntheticDigest(content,identity.sha256,async()=>{
  const source=await verifyTemplateBytes(new TextEncoder().encode(content),identity),input={source,source_path:'artifacts/store/source.html',artifact_path:'artifacts/store/editable.html',title:'A01'},priorChannel=globalThis.BroadcastChannel;
  globalThis.BroadcastChannel=undefined;let store,fullStore;const empty=transactionalDb({files:[],revision:0}),full=transactionalDb({revision:199,files:Array.from({length:199},(_,i)=>({artifact_path:'artifacts/'+i+'.txt',content:'x',revision:i+1}))});try{store=createStore({namespace:'synthetic-store',indexedDB:empty});fullStore=createStore({namespace:'synthetic-full',indexedDB:full});}finally{globalThis.BroadcastChannel=priorChannel;}
  await assert.rejects(()=>store.importTemplate(input,{guard:()=>false}),/来源已切换/);assert.equal(empty.document.files.length,0);assert.equal(empty.puts,0);assert.equal(empty.aborts,1);
  const saved=await store.importTemplate(input);assert.equal(empty.puts,1);assert.equal(empty.commits,1);assert.equal(empty.document.files.length,2);assert.equal(saved.source.revision,1);assert.equal(saved.artifact.revision,2);assert.equal((await store.read({artifact_path:saved.source.artifact_path})).content,content);
  await assert.rejects(()=>fullStore.importTemplate(input),/200/);assert.equal(full.document.files.length,199);assert.equal(full.puts,0);assert.equal(full.aborts,1);
 });
});
