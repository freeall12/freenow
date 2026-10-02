'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const modules=Promise.all(['core','model','archive','apply'].map(name=>import('../src/features/generation-history/'+name+'.mjs')));
const task=(id='task',changes={})=>({id,status:'succeeded',createdAt:Date.parse('2026-10-02T08:00:00Z'),request:{kind:'image.generate',nodeId:'source',prompt:'相同名称',parameters:{model:'test-model',ratio:'4:3',apiKey:'never-store'}},outputs:[{type:'image',url:'https://example.test/real.png',sourceFileId:'actual-file'}],...changes});
async function fixture(options={}){
  const [{createHistory}]=await modules,records=options.records || new Map();let writes=0,archives=0;
  const store={async readRecord(key){return structuredClone(records.get(key));},async writeRecord(key,value){writes++;if(options.failWrite?.())throw Error('disk unavailable');records.set(key,structuredClone(value));}};
  const history=createHistory({projectId:options.projectId || 'project-a',store,archive:async(output,row)=>{archives++;if(options.failArchive?.())throw Error('decode unavailable');return {mediaRef:'asset:'+row.id,thumbnailRef:'asset:'+row.id,mime:'image/png'};},lookup:options.lookup || (()=>{throw Error('unexpected lookup');})});
  await history.ready();return {history,store,records,writes:()=>writes,archives:()=>archives};
}
test('new projects are empty; only a bound receipt creates real success rows, with stable output IDs and dates',async()=>{
  const f=await fixture();assert.deepEqual(f.history.list(),[]);await f.history.observe(task());assert.deepEqual(f.history.list(),[]);
  await f.history.captureSubmission(task(),{recoverable:true});await f.history.observe(task());await f.history.observe({...task(),applied:true,resultIds:['node-1']});
  const rows=f.history.list();assert.equal(rows.length,1);assert.equal(rows[0].id,'task:0');assert.equal(rows[0].createdAt,'2026-10-02T08:00:00.000Z');assert.equal(rows[0].sourceFileId,'actual-file');assert.equal(rows[0].application.applied,true);assert.equal(f.archives(),1);
  assert.equal(JSON.stringify([...f.records.values()]).includes('never-store'),false);
  const reopened=await fixture({records:f.records});assert.equal(reopened.history.list()[0].mediaRef,'asset:task:0');
});
test('same task IDs and titles remain isolated by project record and output index',async()=>{
  const records=new Map(),a=await fixture({records}),b=await fixture({records,projectId:'project-b'});
  await a.history.captureSubmission(task());await a.history.observe(task('task',{outputs:[...task().outputs,{type:'image',url:'https://example.test/second.png'}]}));
  assert.equal(b.history.list().length,0);await b.history.captureSubmission(task());await b.history.observe(task());assert.equal(a.history.list().length,2);assert.equal(b.history.list().length,1);assert.equal(records.size,2);
});
test('failed, cancelled, unknown, unconfigured and text-only results never become successful media history',async()=>{
  const f=await fixture();for(const status of ['failed','cancelled','unknown','configuration_required']){const job=task(status,{status});await f.history.captureSubmission(job);await f.history.observe(job);}
  for(const outputs of [[],[{type:'text',text:'analysis'}]]){const job=task('non-media'+outputs.length,{outputs});await f.history.captureSubmission(job);await f.history.observe(job);}
  assert.deepEqual(f.history.list(),[]);assert.equal(f.archives(),0);
});
test('persisted archive failure retains original outputs, allows navigation, and retry reuses outputs without provider generation',async()=>{
  let fail=true;const f=await fixture({failArchive:()=>fail});await f.history.captureSubmission(task());await f.history.observe(task());
  assert.equal(f.history.list()[0].archiveStatus,'failed');await f.history.flush();assert.equal(f.history.diagnostics().transientLoss,null);
  assert.equal([...f.records.values()][0].receipts[0].outputs[0].url,'https://example.test/real.png');
  fail=false;await f.history.retry('task');await f.history.flush();assert.equal(f.history.list()[0].archiveStatus,'ready');assert.equal(f.archives(),2);
});
test('only transient media archive failures block leaving until the actual media is durably saved',async()=>{
  let fail=true;const f=await fixture({failArchive:()=>fail}),job=task('temporary',{outputs:[{type:'image',url:'blob:actual-live-media'}]});
  await f.history.captureSubmission(job);await f.history.observe(job);await assert.rejects(f.history.flush(),/只保留在当前页面/);assert.equal(f.history.diagnostics().transientLoss,'temporary:0');
  fail=false;await f.history.retry('temporary');await f.history.flush();assert.equal(f.history.diagnostics().transientLoss,null);
});
test('recoverable receipt permits navigating after archive failure even if the output URL is transient',async()=>{
  const f=await fixture({failArchive:()=>true}),job=task('recoverable-blob',{outputs:[{type:'video',url:'blob:original-provider'}]});await f.history.captureSubmission(job,{recoverable:true});await f.history.observe(job);await f.history.flush();assert.equal(f.history.diagnostics().transientLoss,null);
});
test('write failure keeps unsaved state actionable and a retry saves without losing or duplicating rows',async()=>{
  let fail=false;const f=await fixture({failWrite:()=>fail});await f.history.captureSubmission(task());fail=true;await assert.rejects(f.history.observe(task()),/disk unavailable/);
  assert.equal(f.history.diagnostics().error,'disk unavailable');await assert.rejects(f.history.flush(),/disk unavailable/);fail=false;await f.history.retry('task');await f.history.flush();assert.equal(f.history.list().length,1);
});
test('flush waits for active archive and writes added during its wait',async()=>{
  const [{createHistory}]=await modules;let finish,archived=false,saved=0;const history=createHistory({projectId:'p',store:{readRecord:async()=>null,writeRecord:async()=>{saved++;}},archive:async()=>{await new Promise(resolve=>finish=resolve);archived=true;return {mediaRef:'asset:real'};}});
  await history.ready();await history.captureSubmission(task());const observing=history.observe(task());while(!finish)await new Promise(resolve=>setImmediate(resolve));
  let flushed=false;const flushing=history.flush().then(()=>flushed=true);assert.equal(flushed,false);finish();await observing;await flushing;assert.equal(archived,true);assert.ok(saved>=3);
});
test('optimistic conflict rereads and merges stable IDs while retaining the other tab newer ready row',async()=>{
  const [{createHistory}]=await modules;let value,conflict=false;const store={readRecord:async()=>structuredClone(value),writeRecord:async(key,next)=>{if(conflict){conflict=false;throw Object.assign(Error('conflict'),{name:'AgentConversationConflictError'});}value=structuredClone(next);}};
  const history=createHistory({projectId:'p',store,archive:async()=>({mediaRef:'asset:ours'})});await history.ready();await history.captureSubmission(task());
  value={projectId:'p',rows:[{id:'other:0',taskId:'other',outputIndex:0,type:'image',createdAt:'2026-10-03T00:00:00.000Z',updatedAt:'2099-01-01T00:00:00Z',archiveStatus:'ready',mediaRef:'asset:other'}],receipts:[]};conflict=true;
  await history.observe(task());assert.deepEqual(history.list().map(row=>row.id),['other:0','task:0']);assert.equal(value.rows.length,2);
});
test('real dates sort/group correctly and category/search are based on prompt and model',async()=>{
  const [,model]=await modules;const rows=[{id:'a',type:'audio',createdAt:'2026-09-29T08:00:00Z',outputIndex:0,prompt:'风声',model:'voice'},{id:'b',type:'video',createdAt:'2026-10-02T09:00:00Z',outputIndex:0,prompt:'Cinematic brand intro',model:'video-model'}];
  assert.equal(model.listRows(rows,{type:'video',search:'brand'})[0].id,'b');assert.equal(model.listRows(rows,{search:'VOICE'})[0].id,'a');assert.deepEqual(model.groupRows(model.listRows(rows)).map(([date])=>date),['2026-10-02','2026-09-29']);
});
test('refresh recovery queries only original bound task and archives success without applying canvas',async()=>{
  let lookups=0;const f=await fixture({lookup:async entry=>{lookups++;assert.equal(entry.taskId,'recoverable');return task('server-id');}});await f.history.captureSubmission(task('recoverable',{status:'running'}),{recoverable:true});
  await f.history.resume();assert.equal(lookups,1);assert.equal(f.history.list()[0].id,'recoverable:0');assert.equal(f.history.list()[0].application.applied,false);
});
test('unsupported 3D still preserves original model URL and metadata as an explicit archive failure',async()=>{
  const f=await fixture({failArchive:()=>true});const job=task('world',{request:{kind:'world.generate',prompt:'实际模型',nodeId:'world',parameters:{model:'marble',outputType:'world',representation:'gaussianSplat'}},outputs:[{type:'model',url:'https://example.test/model.splat',format:'splat',asset_metadata:{representation:'gaussianSplat',name:'actual world'}}]});
  await f.history.captureSubmission(job);await f.history.observe(job);const row=f.history.list({type:'model'})[0];assert.equal(row.archiveStatus,'failed');assert.equal(row.parameters.outputType,'world');assert.equal([...f.records.values()][0].receipts[0].outputs[0].asset_metadata.name,'actual world');
});
test('batch import prepares all media then performs one paste; save retry retains original inserted IDs',async()=>{
  const [,,, {createImporter}]=await modules;let pasted=0,saves=0,fail=true;const prepared=[];const importer=createImporter({app:{pasteGraph(snapshot,point){pasted++;assert.equal(prepared.length,2);assert.equal(snapshot.edges.length,0);assert.deepEqual(point,{x:10,y:20});return {nodes:snapshot.nodes,selected:['new-a','new-b']};}},prepare:async row=>{prepared.push(row.id);return {id:row.id,width:375,height:250};},position:()=>({x:10,y:20}),persist:async()=>{saves++;if(fail)throw Error('save failed');}});
  const rows=[{id:'a'},{id:'b'}];await assert.rejects(importer(rows),/save failed/);assert.equal(importer.pending,true);await assert.rejects(importer([{id:'other'}]),/上一批/);fail=false;const graph=await importer(rows);assert.equal(importer.pending,false);assert.equal(pasted,1);assert.equal(saves,2);assert.deepEqual(graph.selected,['new-a','new-b']);assert.equal(graph.nodes[1].x,415);
});
test('batch preparation failure never partially changes canvas',async()=>{
  const [,,, {createImporter}]=await modules;let pasted=0;const importer=createImporter({app:{pasteGraph(){pasted++;}},prepare:async row=>{if(row.id==='bad')throw Error('missing asset');return {id:row.id,width:375,height:250};},position:()=>({x:0,y:0}),persist:async()=>{}});await assert.rejects(importer([{id:'good'},{id:'bad'}]),/missing asset/);assert.equal(pasted,0);
});
test('media archiver stores real blobs; imported world preserves model resource instead of thumbnail',async()=>{
  const [,,{createArchiver}]=await modules;const blob=new Blob(['actual bytes'],{type:'image/png'});let put=0;const archiver=createArchiver({assets:{url:async source=>source,put:async value=>{assert.equal(value,blob);return 'asset:stored-'+(++put);}},fetch:async()=>({ok:true,blob:async()=>blob}),validate:async()=>({width:800,height:600}),asDataUrl:async()=> 'data:image/png;base64,actual',materializeWorld:async()=>({image:'data:image/png;base64,cover',outputType:'world',worldResource:{format:'glb',url:'asset:model',thumbnail:'asset:cover',name:'real.glb',bytes:321}})});
  const archived=await archiver.archive(task().outputs[0],{parameters:{}});assert.equal(archived.mediaRef,'asset:stored-1');assert.equal(archived.width,800);
  const world=await archiver.archive({type:'model',url:'https://example.test/real.glb'},{parameters:{outputType:'world'}});const node=await archiver.node({id:'w:0',type:'model',title:'world',archiveStatus:'ready',parameters:{outputType:'world',model:'tripo'},...world});assert.equal(node.type,'world');assert.equal(node.outputType,'world');assert.equal(node.worldResource.url,'asset:model');assert.equal(node.worldResource.bytes,321);
});
test('missing local assets become an explicit persisted failure that retries original outputs without duplicate rows',async()=>{
  const f=await fixture();await f.history.captureSubmission(task());await f.history.observe(task());await f.history.markUnavailable('task:0',Error('本地资源已丢失'));
  assert.equal(f.history.list()[0].archiveStatus,'failed');assert.equal(f.history.list()[0].archiveError,'本地资源已丢失');await f.history.flush();await f.history.retry('task');assert.equal(f.history.list().length,1);assert.equal(f.history.list()[0].archiveStatus,'ready');assert.equal(f.archives(),2);
});
test('audio history preserves actual duration and prepared model/prompt metadata for later import',async()=>{
  const f=await fixture(),job=task('audio',{request:{kind:'audio.generate',nodeId:'sound',prompt:'actual prepared music',parameters:{model:'actual-model',duration:8}},outputs:[{type:'audio',url:'https://example.test/music.wav',duration:8.25}]});await f.history.captureSubmission({...job,request:{...job.request,prompt:'draft'}});await f.history.observe(job);const row=f.history.list({type:'audio'})[0];assert.equal(row.duration,8.25);assert.equal(row.prompt,'actual prepared music');assert.equal(row.model,'actual-model');assert.equal([...f.records.values()][0].receipts[0].prompt,'actual prepared music');
});
test('install waits for the project index and subscribes before resolving the dispatch gate',async()=>{
  const {install}=await import('../src/features/generation-history/entry.mjs');let release,subscribed=false;const read=new Promise(resolve=>release=resolve),guards=[],handlers=new Map();const root={addEventListener:(type,fn)=>handlers.set(type,fn),CanvasProjects:{registerNavigationGuard(fn){guards.push(fn);return()=>{};}},LocalMedia:{download(){}}};
  const historyPromise=install({root,project:{id:'install-project'},app:{notify(){}},store:{readRecord:()=>read,writeRecord:async()=>{}},generation:{subscribe(){subscribed=true;return()=>{};}},assets:{url:async source=>source,put:async()=> 'asset:real'},fetch:async()=>({ok:true,blob:async()=>new Blob(['real'],{type:'image/png'})}),asDataUrl:async()=> 'data:image/png;base64,real',validate:async()=>({width:8,height:8}),localizeAudio:async()=> 'asset:audio',materializeWorld:async()=>({worldResource:{url:'asset:model'}})});
  assert.equal(subscribed,false);release(null);const history=await historyPromise;assert.equal(subscribed,true);assert.equal(guards.length,1);assert.equal(typeof handlers.get('beforeunload'),'function');await history.captureSubmission(task());await history.observe(task());assert.equal(history.list()[0].archiveStatus,'ready');await guards[0]();history.dispose();
});
test('entry navigation flush waits for history batch persistence and blocks unsaved inserted IDs until retry',async()=>{
  const {install}=await import('../src/features/generation-history/entry.mjs');let release,pasted=0,fail=true;const save=new Promise(resolve=>release=resolve),nodes=[],guards=[];const root={addEventListener(){},removeEventListener(){},CanvasProjects:{registerNavigationGuard(fn){guards.push(fn);return()=>{};}}};
  const history=await install({root,project:{id:'apply-project'},app:{notify(){},getState:()=>({nodes,edges:[]}),pasteGraph(graph){pasted++;nodes.push(...graph.nodes);return graph;}},store:{readRecord:async()=>null,writeRecord:async()=>{},save:async()=>{await save;if(fail)throw Error('disk failed');},flush:async()=>{}},generation:{subscribe:()=>()=>{}},assets:{url:async source=>source,put:async()=> 'asset:real'},fetch:async()=>({ok:true,blob:async()=>new Blob(['real'],{type:'image/png'})}),asDataUrl:async()=> 'data:image/png;base64,actual',validate:async()=>({width:8,height:8}),position:()=>({x:0,y:0})});
  await history.captureSubmission(task());await history.observe(task());const applying=history.apply(history.list());let navigating=false;const navigation=guards[0]().then(reason=>{navigating=true;return reason;});await new Promise(resolve=>setImmediate(resolve));assert.equal(navigating,false);assert.equal(pasted,1);release();await assert.rejects(applying,/disk failed/);assert.match(await navigation,/已导入的历史素材尚未保存/);assert.equal(history.diagnostics().canvasPending,true);fail=false;await history.retryCanvasSave();assert.equal(history.diagnostics().canvasPending,false);assert.equal(await guards[0](),null);assert.equal(pasted,1);history.dispose();
});

test('scene source range and description survive archive refresh/import without applying a second clip',async()=>{
 const [,,{createArchiver}]=await modules,f=await fixture(),output={type:'video',url:'https://example.test/actual-cut.mp4',title:'镜头 2',text:'实际镜头描述',sourceRange:{start:2,end:4},duration:2};
 const job=task('scene',{request:{kind:'video.analyze',nodeId:'source',parameters:{}},outputs:[output]});await f.history.captureSubmission(job);await f.history.observe(job);const reopened=await fixture({records:f.records}),row=reopened.history.list()[0];assert.deepEqual(row.sourceRange,output.sourceRange);assert.equal(row.text,output.text);
 const archiver=createArchiver({assets:{url:async x=>x},fetch:async()=>new Response(new Blob(['actual'],{type:'video/mp4'})),validate:async()=>({width:320,height:240,duration:2}),asDataUrl:async()=> 'data:video/mp4;base64,YWN0dWFs'});
 const node=await archiver.node(row);assert.deepEqual(node.sourceRange,output.sourceRange);assert.equal(node.content,output.text);assert.equal(node.clip,undefined);assert.equal(node.durationMs,2000);
});

test('full-size result and provider model survive failed archive, refresh and original-output retry into preview',async()=>{
 const [,,{createArchiver}]=await modules,{resources}=await import('../media-preview-core.mjs');
 const output={type:'image',url:'https://example.test/preview.png',image:'https://example.test/preview.png',fullImage:'https://example.test/full.png',model:'provider-resolved-model'};
 const original=structuredClone(output),job=task('full-result',{outputs:[output]}),first=await fixture({failArchive:()=>true});
 await first.history.captureSubmission(job);await first.history.observe(job);
 const saved=[...first.records.values()][0].receipts[0].outputs[0];assert.equal(saved.url,output.fullImage);assert.equal(saved.model,output.model);
 const reopened=await fixture({records:first.records});await reopened.history.retry(job.id);const row=reopened.history.list()[0];
 assert.equal(row.model,output.model);assert.equal(row.source,output.fullImage);assert.equal(row.parameters.model,'test-model');
 const reads=[],blob=new Blob(['full resolution pixels'],{type:'image/png'}),source='data:image/png;base64,ZnVsbA==';
 const archiver=createArchiver({assets:{url:async x=>x,put:async()=> 'asset:full-result'},fetch:async url=>{reads.push(url);return new Response(blob);},validate:async()=>({width:2400,height:1800}),asDataUrl:async()=>source,createMediaUrl:()=> 'blob:full-result',revokeMediaUrl(){}});
 const archive=await archiver.archive(output,row);assert.equal(reads[0],output.fullImage);assert.deepEqual(output,original);
 const node=await archiver.node({...row,...archive});node.generation={model:'next-request-model',prompt:'next request'};
 const resource=resources(JSON.parse(JSON.stringify(node)),node.generation)[0];assert.equal(resource.src,source);assert.equal(resource.width,2400);assert.equal(resource.model,output.model);assert.equal(resource.prompt,job.request.prompt);assert.equal(resource.createdAt,row.createdAt);
 node.fullImage='replacement-media';node.image='replacement-media';assert.equal(resources(node,node.generation)[0].model,null);
});

test('video history restores source-bound submitted metadata and analysis history omits generation model without a range',async()=>{
 const [,,{createArchiver}]=await modules,{resources}=await import('../media-preview-core.mjs'),source='data:video/mp4;base64,YWN0dWFs';
 const archiver=createArchiver({assets:{url:async x=>x},fetch:async()=>new Response(new Blob(['actual'],{type:'video/mp4'})),validate:async()=>({width:320,height:240,duration:2}),asDataUrl:async()=>source});
 for(const kind of ['video.generate','video.analyze']){
  const f=await fixture(),job=task(kind,{request:{kind,nodeId:'source',prompt:'original description',parameters:{model:'request-model'}},outputs:[{type:'video',url:'https://example.test/video.mp4',model:'output-model'}]});
  await f.history.captureSubmission(job);await f.history.observe(job);const reopened=await fixture({records:f.records}),row=reopened.history.list()[0],node=await archiver.node(row);
  node.generation.model='next-model';node.generation.prompt='next prompt';const resource=resources(node,node.generation)[0];
  assert.equal(node.provenance.mediaSource,source);assert.equal(node.provenance.taskId,job.id);assert.equal(node.provenance.requestKind,kind);assert.equal(resource.createdAt,row.createdAt);
  assert.equal(resource.model,kind==='video.generate'?'output-model':null);assert.equal(resource.prompt,kind==='video.generate'?'original description':'');assert.equal(node.provenance.kind,kind==='video.generate'?'generation-result':'video-analysis');
 }
});

test('install waits for later asset script readiness instead of capturing an undefined service',async()=>{
 const {install}=await import('../src/features/generation-history/entry.mjs');let domReady,reads=0,subscribed=false,assetReads=0;
 const root={document:{readyState:'loading',addEventListener(type,callback,options){assert.equal(type,'DOMContentLoaded');assert.equal(options.once,true);domReady=callback;}},addEventListener(){},removeEventListener(){}};
 const operation=install({root,project:{id:'asset-startup'},app:{notify(){}},store:{readRecord:async()=>{reads++;return null;},writeRecord:async()=>{}},generation:{subscribe(){subscribed=true;return()=>{};}},fetch:async()=>new Response(new Blob(['real pixels'],{type:'image/png'})),asDataUrl:async()=> 'data:image/png;base64,YWN0dWFs',validate:async()=>({width:1200,height:800})});
 assert.equal(reads,0);assert.equal(subscribed,false);assert.equal(typeof domReady,'function');
 root.LocalAssets={url:async value=>{assetReads++;return value;},put:async()=> 'asset:startup-image'};root.document.readyState='interactive';domReady();
 const history=await operation;assert.equal(reads,1);assert.equal(subscribed,true);await history.captureSubmission(task('startup'));await history.observe(task('startup'));assert.equal(history.list()[0].archiveStatus,'ready');assert.equal(assetReads,1);history.dispose();
});

test('history dates group by the preview local day across eastern and western midnight without changing UTC records or sorting',()=>{
 const {execFileSync}=require('node:child_process'),{pathToFileURL}=require('node:url'),path=require('node:path');
 const source=pathToFileURL(path.resolve(__dirname,'../src/features/generation-history/model.mjs')).href;
 const rows=[{id:'early',type:'image',outputIndex:0,createdAt:'2026-10-02T17:30:00.000Z'},{id:'latest',type:'image',outputIndex:0,createdAt:'2026-10-03T03:30:00.000Z'},{id:'previous-day',type:'image',outputIndex:0,createdAt:'2026-10-02T06:00:00.000Z'}];
 const script=`import {groupRows,listRows} from ${JSON.stringify(source)}; const rows=${JSON.stringify(rows)}; const groups=groupRows(listRows(rows,{type:'image'})); process.stdout.write(JSON.stringify({groups:groups.map(([date,items])=>[date,items.map(item=>item.id)]),rows}));`;
 for(const [timezone,dates]of [['Asia/Shanghai',['2026-10-03','2026-10-02']],['America/Los_Angeles',['2026-10-02','2026-10-01']]]){
  const value=JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',script],{env:{...process.env,TZ:timezone},encoding:'utf8'}));
  assert.deepEqual(value.groups,[[dates[0],['latest','early']],[dates[1],['previous-day']]],timezone);assert.deepEqual(value.rows,rows);
 }
});
