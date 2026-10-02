'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createHash}=require('node:crypto'),clipboard=require('../canvas-clipboard.js');
const hash=async value=>createHash('sha256').update(value).digest('hex');
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
async function fixture(overrides={}){
 const {createSubjectAgentService}=await import('../src/features/agent-subjects/service.mjs');
 const data=new Map(),state={nodes:[{id:'text',type:'text',title:'剧本',content:'真实人物描述'},{id:'other',type:'text',title:'动作',content:'抬起手臂'},{id:'image',type:'image',title:'人物',image:'asset:portrait',fullImage:'asset:portrait'}],edges:[],view:{x:100,y:80,scale:.5}},calls={writes:0,pastes:0,saves:0};let quota=false,saveFails=false,sequence=0;
 const storage={getItem:key=>data.get(key)??null,setItem:(key,value)=>{if(quota)throw Error('quota');calls.writes++;data.set(key,value);}};
 const app={getState:()=>state,pasteGraph:(snapshot,point)=>{calls.pastes++;const graph=clipboard.instantiate(snapshot,state.nodes,point,0,state.view.scale,()=> 'import-'+ ++sequence);state.nodes.push(...graph.nodes);state.edges.push(...graph.edges);return graph;}};
 const options={app,storage,storageKey:'test-subjects',store:{save:async()=>{calls.saves++;if(saveFails)throw Error('disk full');}},notify:()=>{},hash,createId:()=> 'subject-'+ ++sequence,resolveUrl:async source=>source,
  fromNode:node=>({id:node.id,sourceNodeId:node.id,source:'canvas',type:node.type,name:node.title,url:node.type==='image'?node.fullImage||node.image:node.video||node.audio,image:node.image,text:node.content,durationMs:node.durationMs}),...overrides};
 const service=createSubjectAgentService(options);
 return {service,options,app,data,state,calls,storage,newService:()=>createSubjectAgentService(options),setQuota:value=>{quota=value;},setSaveFails:value=>{saveFails=value;}};
}
const create={operationId:'save-one',expectedVersion:'0',name:'主角',description:'人物设定',nodeIds:['text']};

test('save snapshots real canvas assets, returns real token and redacted summaries; stable replay does not rewrite',async()=>{
 const f=await fixture(),result=await f.service.save({...create,nodeIds:['text','image']});
 assert.equal(result.saved,true);assert.equal(result.subject.token,'{{ElementRef:'+result.subject.id+':%E4%B8%BB%E8%A7%92}}');assert.equal(result.subject.assets.length,2);assert.ok(!JSON.stringify(result).includes('asset:portrait'));
 f.state.nodes[0].content='之后修改';const replay=await f.service.save({...create,nodeIds:['text','image']});assert.equal(replay.replayed,true);assert.equal(f.calls.writes,1);assert.equal(replay.subject.assets[0].textPreview,'真实人物描述');
 await assert.rejects(f.service.save({...create,name:'另一人'}),error=>error.code==='operation_conflict');
 await assert.rejects(f.service.save({...create,operationId:'invalid',id:'chosen-id'}),error=>error.code==='invalid_version');
});

test('updates/archive require exact actual content versions; personal listing excludes archived and team',async()=>{
 const f=await fixture(),first=await f.service.save(create),subjectId=first.subject.id;
 const stored=JSON.parse(f.data.get('test-subjects'));stored.push({id:'team',scope:'team',name:'团队主体',assets:[]});f.data.set('test-subjects',JSON.stringify(stored));
 const updated=await f.service.save({...create,operationId:'update',id:subjectId,expectedVersion:first.subject.version,name:'更新主角'});assert.notEqual(updated.subject.version,first.subject.version);
 await assert.rejects(f.service.archive({operationId:'stale',id:subjectId,expectedVersion:first.subject.version}),error=>error.code==='version_conflict');
 assert.equal((await f.service.list()).total,1);await assert.rejects(f.service.read({id:'team'}),error=>error.code==='subject_unavailable');
 const archived=await f.service.archive({operationId:'archive',id:subjectId,expectedVersion:updated.subject.version});assert.equal(archived.subject.archived,true);assert.equal((await f.service.list()).total,0);
 assert.equal((await f.service.archive({operationId:'archive',id:subjectId,expectedVersion:updated.subject.version})).replayed,true);
 assert.equal((await f.service.save(create)).currentMatches,false);
});

test('corrupt library and quota failures preserve exact stored data',async()=>{
 const f=await fixture();f.data.set('test-subjects','{corrupt');await assert.rejects(f.service.save(create),error=>error.code==='library_unreadable');assert.equal(f.data.get('test-subjects'),'{corrupt');assert.equal(f.calls.writes,0);
 f.data.set('test-subjects','[]');f.setQuota(true);await assert.rejects(f.service.save(create),error=>error.code==='subject_save_failed');assert.equal(f.data.get('test-subjects'),'[]');
 f.setQuota(false);assert.equal((await f.service.save(create)).saved,true);
});

test('concurrent canvas or library edits before final write cause conflict instead of overwrite',async()=>{
 const started=deferred(),gate=deferred();let pause=true;
 const f=await fixture({hash:async value=>{if(pause&&value.includes('"assets"')){pause=false;started.resolve();await gate.promise;}return hash(value);}});
 const pending=f.service.save(create);await started.promise;f.state.nodes[0].content='用户新编辑';gate.resolve();await assert.rejects(pending,error=>error.code==='source_changed');assert.equal(f.calls.writes,0);
 const started2=deferred(),gate2=deferred();let pause2=true;
 const g=await fixture({hash:async value=>{if(pause2&&value.includes('"assets"')){pause2=false;started2.resolve();await gate2.promise;}return hash(value);}});
 const other=g.service.save(create);await started2.promise;g.data.set('test-subjects',JSON.stringify([{id:'user',scope:'personal',name:'UI新建',assets:[]}]));gate2.resolve();await assert.rejects(other,error=>error.code==='version_conflict');assert.equal(JSON.parse(g.data.get('test-subjects'))[0].name,'UI新建');
});

test('text/name/description media bodies are redacted before pagination with explicit offset unit',async()=>{
 const f=await fixture();f.state.nodes[0].title='素材 data:image/png;base64,SECRET';f.state.nodes[0].content='开头 data:video/mp4;base64,VIDEO_BODY 结尾 blob:private-value';
 const result=await f.service.save({...create,description:'说明 data:image/png;base64,DESC_BODY'});
 const read=await f.service.read({id:result.subject.id,assetId:'text',offset:3,limit:19});
 assert.ok(!JSON.stringify(read).includes('VIDEO_BODY'));assert.ok(!JSON.stringify(read).includes('DESC_BODY'));assert.ok(!JSON.stringify(read).includes('SECRET'));assert.match(read.text.offsetUnit,/after media redaction/);assert.equal(read.text.text,'[omitted data media');
});

test('apply uses one actual pasteGraph at exact world coordinates; retry save and refreshed replay never duplicate',async()=>{
 const f=await fixture(),saved=await f.service.save({...create,nodeIds:['text','other']}),request={operationId:'apply-one',id:saved.subject.id,expectedVersion:saved.subject.version,position:{x:123.125,y:-42.75}};
 f.setSaveFails(true);await assert.rejects(f.service.apply(request),error=>error.code==='save_failed'&&error.receipt.applied&&error.receipt.subjectName==='主角');assert.equal(f.calls.pastes,1);
 f.setSaveFails(false);const result=await f.service.apply(request);assert.equal(result.saved,true);assert.equal(result.currentMatches,true);assert.equal(f.calls.pastes,1);assert.equal(f.state.nodes.find(n=>n.id===result.nodeIds[0]).x,123.125);assert.equal(f.state.nodes.find(n=>n.id===result.nodeIds[0]).y,-42.75);
 const replay=await f.newService().apply(request);assert.equal(replay.replayed,true);assert.equal(f.calls.pastes,1);
 f.state.nodes.find(n=>n.id===result.nodeIds[0]).content='修改';await assert.rejects(f.newService().apply(request),error=>error.code==='output_changed');assert.equal(f.calls.pastes,1);
});

test('apply checks cancellation and changed subject after asynchronous preparation before committing',async()=>{
 const started=deferred(),gate=deferred(),f=await fixture({resolveUrl:async source=>{started.resolve();await gate.promise;return source;}}),saved=await f.service.save(create),controller=new AbortController();
 const pending=f.service.apply({operationId:'cancel',id:saved.subject.id,expectedVersion:saved.subject.version,position:{x:0,y:0}},{signal:controller.signal});await started.promise;controller.abort();gate.resolve();await assert.rejects(pending,error=>error.name==='AbortError');assert.equal(f.calls.pastes,0);
 const g=await fixture(),second=await g.service.save(create),native=g.options.resolveUrl;
 g.options.resolveUrl=async source=>{const subjects=JSON.parse(g.data.get('test-subjects'));subjects[0].name='UI改名';g.data.set('test-subjects',JSON.stringify(subjects));return native(source);};
 await assert.rejects(g.newService().apply({operationId:'changed',id:second.subject.id,expectedVersion:second.subject.version,position:{x:0,y:0}}),error=>error.code==='version_conflict');assert.equal(g.calls.pastes,0);
});

test('operation IDs cannot cross save/archive/apply actions, including refreshed instances',async()=>{
 const f=await fixture(),saved=await f.service.save(create),apply={operationId:'save-one',id:saved.subject.id,expectedVersion:saved.subject.version,position:{x:0,y:0}};
 await assert.rejects(f.newService().apply(apply),error=>error.code==='operation_conflict');await assert.rejects(f.service.archive({operationId:'save-one',id:saved.subject.id,expectedVersion:saved.subject.version}),error=>error.code==='operation_conflict');
 await f.service.apply({...apply,operationId:'import'});await assert.rejects(f.newService().save({...create,operationId:'import'}),error=>error.code==='operation_conflict');
});

test('inline media is localized once and cancel/source changes cannot save a late subject',async()=>{
 let puts=0;const f=await fixture({localAssets:{put:async()=>{puts++;return 'asset:localized';}},fetchImpl:async()=>({ok:true,blob:async()=>new Blob(['png'],{type:'image/png'})})});
 f.state.nodes[2].image=f.state.nodes[2].fullImage='data:image/png;base64,REAL';await f.service.save({...create,nodeIds:['image']});assert.equal(puts,1);const subject=JSON.parse(f.data.get('test-subjects'))[0];assert.equal(subject.assets[0].url,'asset:localized');assert.equal(subject.assets[0].image,'asset:localized');
 const started=deferred(),gate=deferred(),g=await fixture({localAssets:{put:async()=>{started.resolve();return gate.promise;}},fetchImpl:async()=>({ok:true,blob:async()=>new Blob(['png'],{type:'image/png'})})});g.state.nodes[2].image=g.state.nodes[2].fullImage='data:image/png;base64,REAL';
 const controller=new AbortController(),pending=g.service.save({...create,nodeIds:['image']},{signal:controller.signal});await started.promise;controller.abort();gate.resolve('asset:late');await assert.rejects(pending,error=>error.name==='AbortError');assert.equal(g.calls.writes,0);
});

test('paste which inserts then throws is reconciled on retry; no partial or duplicate paste',async()=>{
 const f=await fixture(),saved=await f.service.save(create),native=f.app.pasteGraph;let once=true;
 f.app.pasteGraph=(...args)=>{const result=native(...args);if(once){once=false;throw Error('renderer failed');}return result;};
 const request={operationId:'after-insert',id:saved.subject.id,expectedVersion:saved.subject.version,position:{x:0,y:0}};
 await assert.rejects(f.service.apply(request),/renderer failed/);assert.equal(f.calls.pastes,1);assert.equal((await f.service.apply(request)).saved,true);assert.equal(f.calls.pastes,1);
});

test('save receipt distinguishes persisted snapshot from nodes edited while storage is pending',async()=>{
 const started=deferred(),gate=deferred(),f=await fixture({store:{save:async()=>{started.resolve();await gate.promise;}}}),saved=await f.service.save(create);
 const pending=f.service.apply({operationId:'changed-during-save',id:saved.subject.id,expectedVersion:saved.subject.version,position:{x:0,y:0}});await started.promise;f.state.nodes.at(-1).content='用户已修改';gate.resolve();
 const receipt=await pending;assert.equal(receipt.saved,true);assert.equal(receipt.currentMatches,false);assert.equal(f.calls.pastes,1);
});

test('all imported node identities and contents are rechecked synchronously after multiple async hashes',async()=>{
 const started=deferred(),gate=deferred();let f,checks=0;
 f=await fixture({hash:async value=>{if(f?.calls.pastes&&value.includes('"content"')&&++checks===2){started.resolve();await gate.promise;}return hash(value);}});
 const saved=await f.service.save({...create,nodeIds:['text','other']}),pending=f.service.apply({operationId:'hash-window',id:saved.subject.id,expectedVersion:saved.subject.version,position:{x:0,y:0}});
 await started.promise;f.state.nodes.find(n=>n.provenance?.subjectImport?.assetIndex===0).content='晚到编辑';gate.resolve();await assert.rejects(pending,error=>error.code==='output_changed');assert.equal(f.calls.saves,0);
});

test('stale UI editor preserves committed agent operation receipts while current content version changes',async()=>{
 const f=await fixture(),saved=await f.service.save(create),before=JSON.parse(f.data.get('test-subjects'))[0];delete before.agentOperations;
 const oldWindow=globalThis.window,oldStorage=Object.getOwnPropertyDescriptor(globalThis,'localStorage'),oldDocument=globalThis.document;
 try{
  globalThis.window={SUBJECT_LIBRARY_KEY:'test-subjects'};Object.defineProperty(globalThis,'localStorage',{value:f.storage,writable:true,configurable:true});globalThis.document={dispatchEvent:()=>{}};
  const {saveSubject}=await import('../src/features/subject-library/store.mjs');saveSubject({...before,name:'UI旧编辑器保存'});
 }finally{globalThis.window=oldWindow;if(oldStorage)Object.defineProperty(globalThis,'localStorage',oldStorage);else delete globalThis.localStorage;globalThis.document=oldDocument;}
 const replay=await f.service.save(create);assert.equal(replay.replayed,true);assert.equal(replay.currentMatches,false);assert.equal(replay.subject.name,'UI旧编辑器保存');assert.equal(replay.committedVersion,saved.subject.version);assert.equal(JSON.parse(f.data.get('test-subjects')).length,1);
});

test('moving imported nodes permits replay but changing actual media metadata invalidates it',async()=>{
 const f=await fixture(),saved=await f.service.save(create),request={operationId:'metadata',id:saved.subject.id,expectedVersion:saved.subject.version,position:{x:0,y:0}},result=await f.service.apply(request),node=f.state.nodes.find(n=>n.id===result.nodeIds[0]);
 node.x=999;node.y=-555;assert.equal((await f.newService().apply(request)).saved,true);
 node.durationMs=2000;await assert.rejects(f.newService().apply(request),error=>error.code==='output_changed');assert.equal(f.calls.pastes,1);
});
