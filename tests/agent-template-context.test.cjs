'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),cryptoNode=require('node:crypto');
const modules=Promise.all([
 import('../src/features/agent-apps/creative-picker.mjs'),
 import('../src/features/agent-apps/creative-template-references.mjs'),
 import('../src/features/agent-apps/template-source.mjs'),
 import('../src/features/agent-apps/template-source-runtime.mjs'),
 import('../src/features/agent-artifacts/model.mjs'),
]);
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};

async function fixture(t){
 const [picker,refs,source,runtimeModule,model]=await modules;
 const selection={schema_version:1,library_version:'1.1.0',catalog_sha256:picker.creativeCatalogSha256,locale:'zh_CN',skill:'creative-generative-art',family:'art',template_id:'A01',template_name:'模板',parameters:{title:'实际修改',subtitle:'用户描述',accent:'#abcdef',intensity:.4,seed:21},output:{kind:'animation-html',width:1200,height:675,fps:60,duration:12},user_request:'我的需求',initial_state:{dragX:.3,dragY:-.2,progress:.42}};
 const state={version:1,mode:'art',selectedId:'A01',drafts:{A01:{parameters:selection.parameters,request:selection.user_request}},inputs:{A01:selection.initial_state},pending:{id:'creative_context_001',accepted:true,signature:JSON.stringify(selection)}};
 const trace={id:'context_trace',callId:'context_call',name:'show_app',status:'done',args:{resource_uri:picker.creativePickerUri},result:{kind:'mcp_app',resource_uri:picker.creativePickerUri,response:{original_request:'原需求'}},appState:state,appHandoffs:[state.pending.id]};
 const message={role:'user',hidden:true,text:picker.creativeSelectionPrompt({...selection,template_ref:refs.creativeTemplateReferences.A01},state.pending.id,'原需求'),widgetOrigin:{traceId:trace.id,resourceUri:picker.creativePickerUri,callId:trace.callId,handoffId:state.pending.id}};
 const identity=source.acceptedTemplateIdentity(trace,message),content='<html>synthetic context body 中文</html>',bytes=new TextEncoder().encode(content);
 // No official template body has been captured. Override only the digest of
 // this synthetic body to exercise accepted local storage/context boundaries.
 const descriptor=Object.getOwnPropertyDescriptor(globalThis,'crypto'),native=globalThis.crypto||cryptoNode.webcrypto;
 Object.defineProperty(globalThis,'crypto',{configurable:true,value:{subtle:{digest:async(algorithm,input)=>Buffer.compare(Buffer.from(input),Buffer.from(bytes))===0?Buffer.from(identity.sha256,'hex'):native.subtle.digest(algorithm,input)}}});
 t.after(()=>{if(descriptor)Object.defineProperty(globalThis,'crypto',descriptor);else delete globalThis.crypto;});
 let document={revision:0,files:[]};
 const store={
  list:async()=>document.files.map(model.metadata),
  get:async path=>{const file=document.files.find(item=>item.artifact_path===path);if(!file)throw Error('产物不存在');return source.verifyStoredTemplateSource(structuredClone(file));},
  write:async input=>{document=model.nextDocument(document,input);return model.metadata(document.files.find(item=>item.artifact_path===input.artifact_path));},
  importTemplate:async(input,{guard})=>{guard();const next=model.nextTemplateImport(document,input);guard();document=next;return {source:model.metadata(next.files.find(item=>item.artifact_path===input.source_path)),artifact:model.metadata(next.files.find(item=>item.artifact_path===input.artifact_path))};},
  subscribe:()=>()=>{},
 };
 const chat={messages:[trace,message]},context={chat,panelActive:true,pageLeaving:false};
 const runtime=runtimeModule.createTemplateSourceRuntime({getContext:()=>context,store,persistConversation:async()=>true});t.after(()=>runtime.dispose());
 const file={size:bytes.length,arrayBuffer:async()=>bytes.slice().buffer},imported=await runtime.importFile(trace,file);
 const clientSource=fs.readFileSync(require.resolve('../agent-client.js'),'utf8'),begin=clientSource.indexOf(' async function artifactContext('),end=clientSource.indexOf(' async function openTemplateArtifact(',begin);
 assert.ok(begin>=0&&end>begin,'extract the production context callback');
 const scope={Promise,pageLeaving:false,draft:()=>context.chat,artifactsReady:Promise.resolve(store),appCardsReady:Promise.resolve(),templateSourceRuntime:runtime};
 vm.runInNewContext(clientSource.slice(begin,end)+';globalThis.readContext=artifactContext;',scope);
 return {trace,chat,context,store,runtime,file,imported,readContext:scope.readContext};
}

test('production template context rejects selection changes during its final file read',async t=>{
 const f=await fixture(t),started=deferred(),gate=deferred(),list=f.store.list;let reads=0;
 f.store.list=async()=>{if(++reads===2){started.resolve();await gate.promise;}return list();};
 const work=f.readContext({},f.chat);await started.promise;f.trace.appState.selectedId='A17';gate.resolve();
 await assert.rejects(work,/模板选择或交接已变化/);
 assert.equal((await f.runtime.describe(f.trace)).status,'unavailable');
});

test('production template context exposes latest editable revision and reimport preserves it',async t=>{
 const f=await fixture(t),edited=await f.store.write({artifact_path:f.imported.artifact.artifact_path,title:'latest edit',content_type:'html',content:'<html>user revision</html>',expected_revision:f.imported.artifact.revision});
 const again=await f.runtime.importFile(f.trace,f.file);assert.equal(again.artifact.revision,edited.revision);
 const result=await f.readContext({quotedText:'actual quote'},f.chat);
 assert.equal(result.localTemplates.length,1);assert.equal(result.localTemplates[0].latest_artifact.revision,edited.revision);
 assert.equal(result.localTemplates[0].source.revision,f.imported.source.revision);assert.equal(result.localTemplates[0].receipt_status,'confirmed');
 assert.equal((await f.store.get(edited.artifact_path)).content,'<html>user revision</html>');assert.equal(result.quotedText,'actual quote');
});

test('production template context rejects a wrong owner and a chat switch during final file read',async t=>{
 const f=await fixture(t);await assert.rejects(f.readContext({}, {messages:[]}),/所属会话已切换/);
 const started=deferred(),gate=deferred(),list=f.store.list;let reads=0;
 f.store.list=async()=>{if(++reads===2){started.resolve();await gate.promise;}return list();};
 const work=f.readContext({},f.chat);await started.promise;f.context.chat={messages:[]};gate.resolve();
 await assert.rejects(work,/作品列表所属会话已切换/);
});
