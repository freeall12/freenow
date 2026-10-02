'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const hash=value=>createHash('sha256').update(value).digest('hex');
const modules=Promise.all([import('../src/features/generation-history/migration.mjs'),import('../src/features/generation-history/core.mjs'),import('../src/features/generation-history/archive.mjs')]);
const stamp='2026-10-03T08:00:00.000Z',source='https://files.tapnow.media/known.png?signature=private',other='https://files.tapnow.media/new.png';
const input=(url=source)=>({version:1,projectId:'migration-project',extra:{preserve:true},receipts:[{taskId:'original-task',remoteTaskId:'remote-original',status:'succeeded',kind:'image.generate',prompt:'original request',parameters:{},createdAt:stamp,updatedAt:stamp,recoverable:false,outputs:[{type:'image',url,image:url,fullImage:url,mime:'image/png',sourceFileId:'provider-file'}]}],rows:[{id:'original-task:0',taskId:'original-task',outputIndex:0,type:'image',createdAt:stamp,updatedAt:stamp,archiveStatus:'failed',archiveError:'old-media',source:url,mediaRef:url,thumbnailRef:url,parameters:{},application:{resultIds:['old-node'],applied:true}}]});
function fixture(entries=[source,other]){
 const bytes=Buffer.from('indexed local pixels'),index={version:1,algorithm:'sha256-exact-utf8',entries:Object.fromEntries(entries.map((url,i)=>[hash(url),{ref:'/assets/qa-history-'+i+'.png',sha256:hash(bytes),bytes:bytes.length}]))},reads=[],stored=[];
 const assets={url:async value=>value,put:async blob=>{stored.push(blob);return 'asset:verified-'+stored.length;}};
 const fetchImpl=async(ref,options)=>{reads.push({ref,options});assert.ok(ref.startsWith('/assets/'),'only indexed local static refs may be read');return new Response(bytes,{headers:{'Content-Type':'image/png','Content-Length':bytes.length}});};
 return {index,bytes,reads,stored,assets,fetchImpl};
}
function storeFixture(value){let record=structuredClone(value),writes=0;return {get record(){return record;},set record(value){record=structuredClone(value);},writes:()=>writes,store:{readRecord:async()=>structuredClone(record),writeRecord:async(_key,value)=>{writes++;record=structuredClone(value);}}};}

test('history migration verifies indexed local bytes before asset refs; unknown sources and task metadata remain intact',async()=>{
 const [{createHistoryMigration}]=await modules,f=fixture(),original=input(),unknown='https://files.tapnow.media/unknown.png?token=not-downloaded';
 original.receipts[0].outputs.push({type:'image',url:unknown});original.rows.push({...original.rows[0],id:'original-task:1',outputIndex:1,source:unknown,mediaRef:unknown,thumbnailRef:null});
 const result=await createHistoryMigration(f)(original);assert.equal(result.status,'pending_import');assert.equal(f.reads.length,1);assert.equal(f.stored.length,1);
 assert.equal(result.snapshot.receipts[0].outputs[0].fullImage,'asset:verified-1');assert.equal(result.snapshot.rows[0].mediaRef,'asset:verified-1');assert.equal(result.snapshot.rows[0].thumbnailRef,'asset:verified-1');assert.equal(result.snapshot.rows[0].archiveStatus,'failed');assert.equal(result.snapshot.rows[0].updatedAt,stamp);assert.deepEqual(result.snapshot.rows[0].application,original.rows[0].application);
 assert.equal(result.snapshot.receipts[0].taskId,'original-task');assert.equal(result.snapshot.receipts[0].remoteTaskId,'remote-original');assert.equal(result.snapshot.receipts[0].outputs[1].url,unknown);assert.equal(result.snapshot.rows[1].mediaRef,unknown);assert.equal(f.reads[0].options.redirect,'error');assert.equal(f.reads[0].options.mode,'same-origin');assert.ok(result.unresolved.length>0);assert.equal(JSON.stringify(result.unresolved).includes('token='),false);assert.equal(original.rows[0].mediaRef,source);
});

test('existing indexed static refs are imported without allowing arbitrary static paths or claiming archive readiness',async()=>{
 const [{createHistoryMigration}]=await modules,f=fixture(),original=input('/assets/qa-history-0.png'),result=await createHistoryMigration(f)(original);
 assert.equal(result.snapshot.rows[0].mediaRef,'asset:verified-1');assert.equal(result.snapshot.rows[0].archiveStatus,'failed');assert.equal(f.reads.length,1);
 const unindexed=input('/assets/not-in-index.png'),report=await createHistoryMigration(f)(unindexed);assert.equal(report.snapshot.rows[0].mediaRef,'/assets/not-in-index.png');assert.equal(report.status,'pending_import');assert.ok(report.unresolved.every(value=>value.code==='unindexed_static_ref'));assert.equal(f.reads.length,1);
});

test('SPZ world consistency groups stay unchanged and are explicitly pending without downloading any original or indexed world bytes',async()=>{
 const [{createHistoryMigration}]=await modules,f=fixture(),output={type:'model',url:source,format:'spz',representation:'gaussianSplat',sourceFileId:'world-original',poster:source,world:{worldId:'world-original',model:'marble-1.1',marbleUrl:'https://marble.worldlabs.ai/world/world-original',coordinateSystem:'marble_raw_opencv',splatResolution:'500k',assets:{splats:{spzUrls:{'500k':source},semanticsMetadata:{metricScaleFactor:1,groundPlaneOffset:0}},imagery:{panoUrl:source}}}},original=input();
 original.receipts[0].outputs=[output];original.rows[0]={...original.rows[0],type:'model',format:'spz',worldPatch:{image:source,worldResource:{format:'spz',url:source,thumbnail:source,world:structuredClone(output.world)}}};
 const report=await createHistoryMigration(f)(original);assert.deepEqual(report.snapshot.receipts[0].outputs,original.receipts[0].outputs);assert.deepEqual(report.snapshot.rows,original.rows);assert.equal(report.status,'pending_import');assert.ok(report.unresolved.every(value=>value.code==='unimplemented_world_archive'));assert.equal(f.reads.length,0);assert.equal(f.stored.length,0);
});

test('failed hash verification never publishes partial references or ready status',async()=>{
 const [{createHistoryMigration},{createHistory}]=await modules,f=fixture();f.index.entries[hash(source)].sha256='0'.repeat(64);const backing=storeFixture(input()),history=createHistory({projectId:'migration-project',store:backing.store});await history.ready();
 await assert.rejects(history.migrateLocalMedia(createHistoryMigration(f)),/实际内容与索引不符/);assert.equal(f.stored.length,0);assert.equal(backing.writes(),0);assert.equal(backing.record.rows[0].mediaRef,source);assert.equal(history.list()[0].archiveStatus,'failed');
});

test('CAS conflict rereads and recomputes authoritative references, including equal timestamp edits and newly added tasks',async()=>{
 const [{createHistoryMigration},{createHistory}]=await modules,f=fixture(),backing=storeFixture(input());let conflict=true,computed=0;
 const store={readRecord:backing.store.readRecord,writeRecord:async(key,value)=>{
  if(conflict){conflict=false;const remote=input(other);remote.extra={preserve:true,newMetadata:'remote'};remote.receipts.push({taskId:'new-task',status:'queued',createdAt:stamp,updatedAt:stamp});remote.rows.push({id:'new-task:0',taskId:'new-task',outputIndex:0,type:'image',createdAt:stamp,updatedAt:stamp,archiveStatus:'ready',mediaRef:'asset:other-window'});backing.record=remote;throw Object.assign(Error('conflict'),{name:'AgentConversationConflictError'});}
  return backing.store.writeRecord(key,value);
 }};
 const history=createHistory({projectId:'migration-project',store}),migrate=createHistoryMigration(f);await history.ready();const report=await history.migrateLocalMedia(async value=>{computed++;return migrate(value);});
 assert.equal(computed,2);assert.equal(report.persisted,true);assert.equal(f.reads.length,2);assert.equal(backing.record.receipts[0].outputs[0].url,'asset:verified-2');assert.equal(backing.record.rows[0].mediaRef,'asset:verified-2');assert.equal(backing.record.rows[0].updatedAt,stamp);assert.equal(backing.record.rows[1].mediaRef,'asset:other-window');assert.equal(backing.record.receipts[1].taskId,'new-task');assert.equal(backing.record.extra.newMetadata,'remote');assert.equal(backing.record.rows.length,2);assert.equal(backing.record.receipts.length,2);
});

test('migration serializes before a newly submitted task and preserves every receipt; repeated migration does not duplicate assets',async()=>{
 const [{createHistoryMigration},{createHistory}]=await modules,f=fixture(),backing=storeFixture(input());let release,entered;const gate=new Promise(resolve=>release=resolve),started=new Promise(resolve=>entered=resolve),migrate=createHistoryMigration(f),history=createHistory({projectId:'migration-project',store:backing.store});await history.ready();
 const operation=history.migrateLocalMedia(async value=>{entered();await gate;return migrate(value);});await started;
 const captured=history.captureSubmission({id:'queued-after-migration',createdAt:Date.now(),status:'queued',request:{kind:'image.generate',prompt:'new submission',parameters:{}}});release();await operation;await captured;assert.equal(backing.record.receipts.length,2);assert.equal(backing.record.receipts[1].taskId,'queued-after-migration');assert.equal(backing.record.rows[0].mediaRef,'asset:verified-1');
 await history.migrateLocalMedia(createHistoryMigration(f));const third=await history.migrateLocalMedia(createHistoryMigration(f));assert.equal(f.stored.length,1);assert.equal(third.persisted,false);
});

test('mixed output migration preserves signed transient siblings and failed migration preserves every retry source',async()=>{
 const [{createHistoryMigration},{createHistory}]=await modules,signed='https://independent-provider.example/output.png?token=memory-only';
 for(const failure of [null,'hash','write']){
  const f=fixture(),backing=storeFixture({version:1,projectId:'migration-project',receipts:[],rows:[]}),reads=[];let archiveReady=false,rejectWrite=false;
  const history=createHistory({projectId:'migration-project',store:{readRecord:backing.store.readRecord,writeRecord:async(key,value)=>{if(rejectWrite)throw Error('migration write failed');return backing.store.writeRecord(key,value);}},archive:async output=>{reads.push(output.url);if(!archiveReady)throw Error('original archive unavailable');return {mediaRef:output.url,thumbnailRef:output.url};}});
  await history.ready();const job={id:'mixed-original-task',createdAt:stamp,status:'queued',request:{kind:'image.generate',prompt:'two original outputs',parameters:{}}};await history.captureSubmission(job);
  await history.observe({...job,status:'succeeded',outputs:[{type:'image',url:source},{type:'image',url:signed}]});
  assert.equal(backing.record.receipts[0].outputs[1].url,undefined,'signed media stays out of persisted safe snapshots');
  if(failure==='hash')f.index.entries[hash(source)].sha256='0'.repeat(64);if(failure==='write')rejectWrite=true;
  if(failure)await assert.rejects(history.migrateLocalMedia(createHistoryMigration(f)),failure==='hash'?/实际内容与索引不符/:/migration write failed/);else await history.migrateLocalMedia(createHistoryMigration(f));
  rejectWrite=false;archiveReady=true;reads.length=0;await history.retry(job.id);
  assert.deepEqual(reads,[failure?source:'asset:verified-1',signed]);assert.ok(history.list().every(row=>row.archiveStatus==='ready'));
 }
});

test('entry connects explicit verified migration, reopens the authoritative record and archives only local bytes on retry',async()=>{
 const {install}=await import('../src/features/generation-history/entry.mjs'),f=fixture(),backing=storeFixture(input());
 const localFetch=async(ref,options)=>ref.startsWith('asset:')?new Response(f.stored[Number(ref.split('-').at(-1))-1]):f.fetchImpl(ref,options);
 const build=()=>install({root:{addEventListener(){},removeEventListener(){}},project:{id:'migration-project'},app:{notify(){}},store:backing.store,assets:f.assets,fetch:localFetch,validate:async()=>({width:32,height:16}),createMediaUrl:()=> 'blob:decoded-local',revokeMediaUrl(){},migration:{index:f.index}});
 const first=await build();const before=backing.record.receipts[0];const report=await first.migrateLocalMedia();assert.equal(report.status,'ready');assert.equal(backing.record.rows[0].archiveStatus,'failed');assert.equal(backing.record.receipts[0].updatedAt,before.updatedAt);first.dispose();
 const reopened=await build();try{assert.equal(reopened.list()[0].mediaRef,'asset:verified-1');await reopened.retry('original-task');assert.equal(reopened.list()[0].archiveStatus,'ready');assert.equal(backing.record.receipts[0].remoteTaskId,'remote-original');assert.ok(f.reads.every(({ref})=>ref.startsWith('/assets/')));}finally{reopened.dispose();}
});

test('history reads reject original-service media before resolving assets and reject redirects on supported provider fetches',async()=>{
 const [,,{createArchiver}]=await modules;let reads=0,options;const archive=createArchiver({assets:{url:async value=>value},fetch:async(_source,init)=>{reads++;options=init;return new Response(new Blob(['old local-compatible bytes'],{type:'image/png'}));}});
 await assert.rejects(archive.blob('https://files.tapnow.media/unknown.png'),{code:'media_localization_required'});assert.equal(reads,0);await archive.blob('https://independent-provider.example/output.png');assert.equal(options.redirect,'error');assert.equal(reads,1);
});
