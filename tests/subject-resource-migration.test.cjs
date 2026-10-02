'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const hash=value=>createHash('sha256').update(value).digest('hex');
const remote='https://old.example.test/subject.png?size=full',unknown=remote.replace('full','other'),local='/assets/subject-local.png';
const index={version:1,algorithm:'sha256-exact-utf8',entries:{[hash(remote)]:{ref:local,sha256:hash('pixels'),bytes:6}}};
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
async function fixture(){
 const {getSubjectStore}=await import('../src/features/subject-library/store.mjs');
 let record={version:1,libraryKey:'test-subject-migration',storageRevision:4,subjects:[{id:'person',scope:'personal',name:'角色',assets:[{id:'image',type:'image',url:remote,image:remote,provenance:{url:remote}},{id:'unknown',type:'video',url:unknown}],agentOperations:[{operationId:'keep',version:'actual'}]},{id:'archived',scope:'personal',deletedAt:123,assets:[{id:'poster',type:'image',url:remote}]}]},writes=0,legacyReads=0,writeError=null;
 const storage={getItem(){legacyReads++;throw Error('must not use old data');},setItem(){throw Error('must not fallback');}},store={readRecord:async()=>structuredClone(record),writeRecord:async(_key,next)=>{if(writeError)throw writeError;writes++;record={...structuredClone(next),storageRevision:record.storageRevision+1};}};
 const library=getSubjectStore({storage,store,storageKey:record.libraryKey,notify:()=>{}});await library.ready();
 return {library,storage,store,get record(){return record;},get writes(){return writes;},get legacyReads(){return legacyReads;},setWriteError:error=>{writeError=error;}};
}

test('explicit subject migration commits known fields to authoritative IDB and preserves unknowns, receipts and archived contents',async()=>{
 const f=await fixture(),before=structuredClone(f.record),result=await f.library.migrateResources({index,hashSource:hash});
 assert.equal(result.status,'pending_import');assert.equal(result.persisted,true);assert.equal(result.summary.changed,3);assert.deepEqual(result.diagnostics,[{path:'$.subjects[0].assets[1].url',code:'local_import_required'}]);
 assert.equal(f.record.subjects[0].assets[0].url,local);assert.equal(f.record.subjects[0].assets[0].image,local);assert.equal(f.record.subjects[0].assets[1].url,unknown);assert.deepEqual(f.record.subjects[0].assets[0].provenance,before.subjects[0].assets[0].provenance);assert.deepEqual(f.record.subjects[0].agentOperations,before.subjects[0].agentOperations);assert.equal(f.record.subjects[1].deletedAt,123);assert.equal(f.record.storageRevision,5);assert.equal(f.legacyReads,0);
 const second=await f.library.migrateResources({index,hashSource:hash});assert.equal(second.persisted,false);assert.equal(f.writes,1);assert.equal(second.summary.changed,0);assert.ok(!JSON.stringify(result).includes('old.example'));
});

test('a newer rename/archive during async mapping prevents stale migration from overwriting user changes',async()=>{
 const f=await fixture(),started=deferred(),gate=deferred(),{migrateSubjectSnapshot}=await import('../src/features/local-resource-migration/snapshot.mjs');
 const pending=f.library.migrateResources({index,hashSource:hash,migrate:async(...args)=>{started.resolve();await gate.promise;return migrateSubjectSnapshot(...args);}});await started.promise;
 await f.library.save({...f.library.list()[0],name:'新编辑'});await f.library.archive('person');gate.resolve();const result=await pending;
 assert.equal(result.status,'local_edits');assert.equal(result.persisted,false);assert.equal(f.writes,2);assert.equal(f.record.subjects[0].name,'新编辑');assert.ok(f.record.subjects[0].deletedAt);assert.equal(f.record.subjects[0].assets[0].url,remote);assert.equal(f.library.pending,false);
});

test('cross-window CAS rejection and disk failures leave authoritative cache and legacy data untouched',async()=>{
 const f=await fixture(),before=f.library.snapshot();f.setWriteError(Object.assign(Error('new revision'),{name:'AgentConversationConflictError'}));const conflict=await f.library.migrateResources({index,hashSource:hash});assert.equal(conflict.status,'local_edits');assert.equal(conflict.persisted,false);assert.deepEqual(f.library.snapshot(),before);assert.equal(f.writes,0);
 f.setWriteError(Error('disk full'));await assert.rejects(f.library.migrateResources({index,hashSource:hash}),error=>error.code==='subject_save_failed');assert.deepEqual(f.library.snapshot(),before);assert.equal(f.legacyReads,0);
 f.setWriteError(null);assert.equal((await f.library.migrateResources({index,hashSource:hash})).persisted,true);
});

test('missing or invalid local index reports a repair state and never writes a substitute empty map',async()=>{
 const f=await fixture();for(const state of ['index_missing','index_invalid','index_unavailable']){const report=await f.library.migrateResources({indexState:{index:null,state}});assert.equal(report.status,state);assert.equal(report.persisted,false);assert.equal(f.library.migrationStatus().status,state);}assert.equal(f.writes,0);assert.equal(f.record.subjects[0].assets[0].url,remote);
});
