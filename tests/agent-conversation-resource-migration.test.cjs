'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const {createConversations,resolve}=require('../project-context.js');
const moduleReady=import('../src/features/local-resource-migration/conversations.mjs');
const hash=value=>createHash('sha256').update(value).digest('hex');
const known='https://files.tapnow.media/attachment.png?signature=exact-review',unknown=known+'&size=other';
const imageBytes=Buffer.from('verified review pixels'),videoBytes=Buffer.from('verified review video'),video='https://files.tapnow.media/attachment.mp4';
const index={version:1,algorithm:'sha256-exact-utf8',entries:{[hash(known)]:{ref:'/assets/conversation-review.png',sha256:hash(imageBytes),bytes:imageBytes.length},[hash(video)]:{ref:'/assets/conversation-review.mp4',sha256:hash(videoBytes),bytes:videoBytes.length}}};
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const original=()=>({chats:[{id:'chat',text:known,refs:['node'],composerDoc:{text:known},uploads:[{id:'first',name:'原附件',type:'image',mime:'image/png',size:imageBytes.length,asset:known,image:known,url:known,provenance:{url:known}},{id:'unknown',type:'image',asset:unknown}],messages:[{role:'user',text:known,uploads:[{id:'message-upload',type:'image',asset:known}]},{role:'tool',args:{url:known},appState:{image:known},result:{url:known}}],queuedMessages:[{id:'queue',text:known,refs:['keep'],uploads:[{id:'queued-upload',type:'video',asset:video,image:known}]}],interruptedRuns:[{journal:{image:known}}],activeRun:null}],activeId:'chat',extra:{binding:known}});
async function fixture(value=original()){
 const {createConversationMigration}=await moduleReady;let record=structuredClone(value),live=structuredClone(value),writes=0,applyCount=0,writeError=null;
 const reads=[],blobs=new Map();
 const assets={put:async blob=>{const ref='asset:conversation-review-'+(blobs.size+1);blobs.set(ref,blob);return ref;}};
 const fetchImpl=async(ref,options)=>{assert.ok(['/assets/conversation-review.png','/assets/conversation-review.mp4'].includes(ref),'no original URL fetch');reads.push({ref,options});const isVideo=ref.endsWith('.mp4');return new Response(isVideo?videoBytes:imageBytes,{headers:{'Content-Type':isVideo?'video/mp4':'image/png'}});};
 const store={readRecord:async()=>structuredClone(record),writeRecord:async(key,value)=>{assert.equal(key,'agent-conversations:conversation-review');if(writeError)throw writeError;writes++;record=structuredClone(value);}};
 const conversations=createConversations({project:resolve({projects:{id:()=> 'conversation-review'}}),store,storage:{setItem(){throw Error('legacy source must remain read only');}}});conversations.baseline(live.chats,live.activeId);
 const options={assets,fetchImpl,index,hashSource:hash},build=()=>createConversationMigration(options);
 const migrate=(mapper=build(),extra={})=>conversations.migrateResources({migrate:mapper,getCurrent:()=>live,applyCommitted:value=>{applyCount++;live=value;},...extra});
 return {conversations,store,options,build,migrate,reads,blobs,get record(){return record;},set record(value){record=structuredClone(value);},get live(){return live;},get writes(){return writes;},get applyCount(){return applyCount;},setError(value){writeError=value;}};
}

test('typed chat/message/queued uploads import exact local bytes and preserve every non-media binding',async()=>{
 const f=await fixture(),before=structuredClone(f.record),result=await f.migrate();
 assert.equal(result.status,'pending_import');assert.equal(result.persisted,true);assert.equal(result.summary.changed,5);assert.equal(f.reads.length,2);assert.equal(f.blobs.size,2);
 for(const read of f.reads){assert.equal(read.options.mode,'same-origin');assert.equal(read.options.redirect,'error');assert.equal(read.options.cache,'no-store');}
 const expected=structuredClone(before),image='asset:conversation-review-1',videoRef='asset:conversation-review-2';expected.chats[0].uploads[0].asset=image;expected.chats[0].uploads[0].image=image;expected.chats[0].messages[0].uploads[0].asset=image;expected.chats[0].queuedMessages[0].uploads[0].asset=videoRef;expected.chats[0].queuedMessages[0].uploads[0].image=image;
 assert.deepEqual(f.record,expected);assert.deepEqual(f.live,expected);assert.equal(await f.blobs.get(image).text(),imageBytes.toString());assert.equal(await f.blobs.get(videoRef).text(),videoBytes.toString());
 assert.deepEqual(result.diagnostics,[{path:'$.chats[0].uploads[1].asset',code:'local_import_required'}]);assert.equal(JSON.stringify(result).includes('signature='),false);
 const again=await f.migrate();assert.equal(again.persisted,false);assert.equal(again.summary.changed,0);assert.equal(f.writes,1);assert.equal(f.blobs.size,2);
});

test('unknown original sources, malformed refs and unsupported types never authorize networking',async()=>{
 const value=original();value.chats[0].uploads=[{type:'image',asset:unknown},{type:'image',asset:'blob:expired'},{type:'image',asset:'/assets/unindexed.png'},{type:'model',asset:known},{type:'image',asset:123}];value.chats[0].messages=[];value.chats[0].queuedMessages=[];
 const f=await fixture(value),result=await f.migrate();assert.equal(f.reads.length,0);assert.equal(f.writes,0);assert.equal(result.persisted,false);assert.equal(result.status,'pending_import');assert.deepEqual(f.record,value);assert.ok(result.diagnostics.every(item=>Object.keys(item).sort().join(',')==='code,path'));
});

test('byte failure publishes no refs and the same migration action can retry after repaired IO',async()=>{
 const f=await fixture();let bad=true;const {createConversationMigration}=await moduleReady;
 const mapper=createConversationMigration({...f.options,fetchImpl:async(ref,init)=>bad?new Response(Buffer.alloc(imageBytes.length),{headers:{'Content-Type':'image/png'}}):f.options.fetchImpl(ref,init)});
 await assert.rejects(f.migrate(mapper),/实际内容与索引不符/);assert.equal(f.writes,0);assert.equal(f.applyCount,0);assert.equal(f.blobs.size,0);assert.equal(f.conversations.migrationStatus().persisted,false);
 bad=false;const result=await f.migrate(mapper);assert.equal(result.persisted,true);assert.equal(f.applyCount,1);
});

test('CAS reread recomputes newer authoritative chats and exact resource positions without duplicate imports',async()=>{
 const f=await fixture();let first=true,computations=0;const normal=f.store.writeRecord;
 f.store.writeRecord=async(key,value)=>{if(first){first=false;const remote=original();remote.chats[0].text='另一窗口新草稿';remote.chats[0].uploads[0].asset=unknown;remote.chats.push({id:'remote-new',text:'新会话',uploads:[{type:'image',asset:known}],messages:[]});remote.activeId='remote-new';f.record=remote;throw Object.assign(Error('CAS conflict'),{name:'AgentConversationConflictError'});}return normal(key,value);};
 const mapper=f.build(),result=await f.migrate(async snapshot=>{computations++;return mapper(snapshot);});
 assert.equal(computations,2);assert.equal(result.persisted,true);assert.equal(f.record.chats[0].text,'另一窗口新草稿');assert.equal(f.record.chats[0].uploads[0].asset,unknown);assert.equal(f.record.chats[1].uploads[0].asset,'asset:conversation-review-1');assert.equal(f.live.activeId,'remote-new');assert.equal(f.blobs.size,2);
});

test('new draft queued during import wins and prevents stale migration commit or hydration',async()=>{
 const f=await fixture(),entered=deferred(),gate=deferred(),mapper=f.build();
 const operation=f.migrate(async snapshot=>{entered.resolve();await gate.promise;return mapper(snapshot);});await entered.promise;
 f.live.chats.push({id:'new-draft',text:'不能丢',refs:['new-ref'],composerDoc:{text:'新文档'},messages:[]});f.live.activeId='new-draft';f.conversations.save(f.live.chats,f.live.activeId);gate.resolve();
 const result=await operation;await f.conversations.flush();assert.equal(result.status,'local_edits');assert.equal(result.persisted,false);assert.equal(f.applyCount,0);assert.equal(f.writes,1);assert.deepEqual(f.record,{chats:f.live.chats,activeId:f.live.activeId});assert.equal(f.record.chats[0].uploads[0].asset,known);
});

test('new draft arriving during IDB commit is preserved and late commit truthfully reports persisted',async()=>{
 const f=await fixture(),entered=deferred(),gate=deferred(),normal=f.store.writeRecord;let first=true;
 f.store.writeRecord=async(key,value)=>{if(first){first=false;entered.resolve();await gate.promise;}return normal(key,value);};
 const operation=f.migrate();await entered.promise;f.live.chats[0].text='提交期间的新草稿';f.live.chats[0].composerDoc={text:'提交期间的新文档'};f.conversations.save(f.live.chats,f.live.activeId);gate.resolve();
 const result=await operation;await f.conversations.flush();assert.equal(result.status,'local_edits');assert.equal(result.persisted,true);assert.equal(f.applyCount,0);assert.equal(f.writes,2);assert.deepEqual(f.record,{chats:f.live.chats,activeId:f.live.activeId});assert.equal(f.record.chats[0].text,'提交期间的新草稿');
 const retry=await f.migrate();assert.equal(retry.persisted,true);assert.equal(f.live.chats[0].text,'提交期间的新草稿');assert.ok(f.live.chats[0].uploads[0].asset.startsWith('asset:'));
});

test('disk failure leaves live and durable snapshots unchanged and identical migration retries',async()=>{
 const f=await fixture(),before=structuredClone(f.live);f.setError(Error('disk full'));
 await assert.rejects(f.migrate(),error=>error.persisted===false&&/disk full/.test(error.message));assert.equal(f.writes,0);assert.equal(f.applyCount,0);assert.deepEqual(f.live,before);assert.deepEqual(f.record,before);assert.equal(f.conversations.unsaved,true);
 f.setError(null);assert.equal((await f.migrate()).persisted,true);await f.conversations.flush();assert.equal(f.conversations.unsaved,false);
});

test('postcommit UI callback failure reports persisted true and keeps committed local refs',async()=>{
 const f=await fixture();await assert.rejects(f.migrate(undefined,{applyCommitted(){throw Error('UI refresh failed');}}),error=>error.persisted===true&&/UI refresh failed/.test(error.message));
 assert.equal(f.writes,1);assert.ok(f.record.chats[0].uploads[0].asset.startsWith('asset:'));assert.equal(f.live.chats[0].uploads[0].asset,known);assert.deepEqual(f.conversations.migrationStatus(),{status:'migration_failed',persisted:true,summary:null,diagnostics:[]});
 const retry=await f.migrate();assert.equal(retry.persisted,false);assert.equal(f.writes,1);assert.deepEqual(f.live,f.record);await f.conversations.flush();assert.equal(f.conversations.unsaved,false);
});

test('invalid index, changed non-media content and final CAS rejection never fake success; explicit migration initializes a missing authority',async()=>{
 const {createConversationMigration}=await moduleReady;
 for(const state of ['index_missing','index_invalid','index_unavailable']){const f=await fixture(),mapper=createConversationMigration({...f.options,index:null,loadIndex:async()=>({index:null,state})}),report=await f.migrate(mapper);assert.equal(report.status,state);assert.equal(report.persisted,false);assert.equal(f.writes,0);}
 const missing=await fixture();missing.record=null;assert.equal((await missing.migrate()).persisted,true);assert.equal(missing.writes,1);assert.ok(missing.record.chats[0].uploads[0].asset.startsWith('asset:'));
 const empty=await fixture({chats:[{id:'empty',text:'保留空草稿',uploads:[],messages:[]}],activeId:'empty'});empty.record=null;assert.equal((await empty.migrate()).persisted,true);assert.equal(empty.writes,1);assert.deepEqual(empty.record,empty.live);
 const forged=await fixture();await assert.rejects(forged.migrate(async value=>{value.chats[0].text='forged';return {snapshot:value,changes:[]};}),/非附件字段/);assert.equal(forged.writes,0);
 const conflict=await fixture();conflict.setError(Object.assign(Error('CAS conflict'),{name:'AgentConversationConflictError'}));const report=await conflict.migrate();assert.equal(report.status,'local_edits');assert.equal(report.persisted,false);assert.equal(conflict.applyCount,0);
});
