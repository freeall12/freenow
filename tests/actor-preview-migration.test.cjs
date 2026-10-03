'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const {createConversations}=require('../project-context.js');
const hash=value=>createHash('sha256').update(value).digest('hex');
const ready=Promise.all([import('../src/features/local-resource-migration/conversations.mjs'),import('../src/features/agent-apps/actor-emotion.mjs')]);
const source='https://files.tapnow.media/legacy-actor.png?signature=exact-qa',unknown=source+'&size=unknown';
const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
async function fixture(){
 const [{createConversationMigration},{prepareActorEmotion,initialActorEmotionState}]=await ready;
 const response=prepareActorEmotion({scene:'原场景',mode:'image',source:{node_ref:'node/source',media_kind:'image'},actor:{binding_id:'aem_0123456789abcdef',name:'人物',role:'原角色',reference_nodes:[{node_ref:'node/actor',preview_url:source},{node_ref:'node/unknown',preview_url:unknown}]},face:{valence:0,stance:0,intensity:50}});
 const trace={id:'actor-original',name:'show_app',status:'done',args:{resource_uri:'ui://tapnow/actor-emotion@v1',data:{actor:{reference_nodes:[{node_ref:'node/actor',preview_url:source}]}}},result:{kind:'mcp_app',resource_uri:'ui://tapnow/actor-emotion@v1',request:{title:'原人物'},response,actorSourceContext:{projectId:'actor-review',sourceSnapshots:[{sourceNodeId:'source',source:'keep-original-fingerprint'}]}},appState:initialActorEmotionState(response),actorExpressionGuide:{image_data_uri:'data:image/png;base64,original-guide',guide_sha256:'keep-guide-hash'}};
 let live={chats:[{id:'chat',text:'原草稿',messages:[trace],interruptedRuns:[{journal:{submission:{url:source},submissionHash:'keep-journal-digest'}}],queuedMessages:[],uploads:[]}],activeId:'chat',extra:{source}},record=structuredClone(live),writes=0,reads=0,puts=0,decodes=0;
 const index={version:1,algorithm:'sha256-exact-utf8',entries:{[hash(source)]:{ref:'/assets/actor-preview-review.png',sha256:hash(bytes),bytes:bytes.length}}};
 const options={index,assets:{put:async blob=>{puts++;assert.ok(decodes>0);assert.deepEqual(Buffer.from(await blob.arrayBuffer()),bytes);return 'asset:actor-preview-reviewed';}},fetchImpl:async(ref,init)=>{reads++;assert.equal(ref,'/assets/actor-preview-review.png');assert.equal(init.redirect,'error');assert.equal(init.mode,'same-origin');return new Response(bytes,{headers:{'Content-Type':'image/png','Content-Length':bytes.length}});},decodeActorPreview:async blob=>{decodes++;assert.equal(hash(Buffer.from(await blob.arrayBuffer())),hash(bytes));return {width:1,height:1};}};
 const store={readRecord:async()=>structuredClone(record),writeRecord:async(_key,value)=>{writes++;record=structuredClone(value);}};
 const conversations=createConversations({project:{id:'actor-review'},store});conversations.baseline(live.chats,live.activeId);
 return {options,index,trace,store,conversations,build:()=>createConversationMigration(options),migrate:mapper=>conversations.migrateResources({migrate:mapper||createConversationMigration(options),getCurrent:()=>live,applyCommitted:value=>{live=value;}}),get record(){return record;},set record(value){record=structuredClone(value);},get live(){return live;},counts:()=>({reads,puts,decodes,writes})};
}
test('actor exact preview migration persists decoded indexed bytes as data URI while unknown and provenance remain intact',async()=>{
 const f=await fixture(),original=structuredClone(f.record),report=await f.migrate(),expected=structuredClone(original);
 expected.chats[0].messages[0].result.response.actor.reference_nodes[0].preview_url='data:image/png;base64,'+bytes.toString('base64');
 assert.equal(report.persisted,true);assert.equal(report.status,'pending_import');assert.deepEqual(f.record,expected);assert.deepEqual(f.live,expected);assert.deepEqual(f.counts(),{reads:1,puts:1,decodes:1,writes:1});assert.deepEqual(report.diagnostics,[{path:'$.chats[0].messages[0].result.response.actor.reference_nodes[1].preview_url',code:'local_import_required'}]);assert.equal(JSON.stringify(report).includes('signature='),false);
 const again=await f.migrate();assert.equal(again.persisted,false);assert.equal(again.summary.changed,0);assert.deepEqual(f.counts(),{reads:1,puts:1,decodes:1,writes:1});
});
test('uppercase HTTPS actor previews use the exact original UTF-8 URL index without normalization',async()=>{
 const f=await fixture(),uppercase=source.replace(/^https:/,'HTTPS:'),entry=f.index.entries[hash(source)];
 delete f.index.entries[hash(source)];f.index.entries[hash(uppercase)]=entry;
 for(const snapshot of [f.record,f.live])snapshot.chats[0].messages[0].result.response.actor.reference_nodes[0].preview_url=uppercase;
 assert.equal(f.index.entries[hash(source)],undefined);
 const report=await f.migrate();assert.equal(report.persisted,true);assert.equal(report.summary.changed,1);assert.equal(report.summary.unresolved,1);assert.equal(f.record.chats[0].messages[0].result.response.actor.reference_nodes[0].preview_url,'data:image/png;base64,'+bytes.toString('base64'));assert.deepEqual(f.counts(),{reads:1,puts:1,decodes:1,writes:1});
});
test('actor SHA, byte, MIME, decode and dimensions failures never publish a reference or store an unverified picture',async()=>{
 for(const kind of ['sha','bytes','mime','decode','dimensions','oversize']){
  const f=await fixture(),before=structuredClone(f.record);
  if(kind==='sha')f.index.entries[hash(source)].sha256='0'.repeat(64);
  if(kind==='bytes')f.index.entries[hash(source)].bytes++;
  if(kind==='oversize')f.index.entries[hash(source)].bytes=400000;
  if(kind==='mime')f.options.fetchImpl=async()=>new Response(bytes,{headers:{'Content-Type':'image/svg+xml'}});
  if(kind==='decode')f.options.decodeActorPreview=async()=>{throw Error('real image decode failed');};
  if(kind==='dimensions')f.options.decodeActorPreview=async()=>({width:8192,height:8192});
  await assert.rejects(f.migrate());assert.deepEqual(f.record,before);assert.deepEqual(f.live,before);assert.equal(f.counts().writes,0);assert.equal(f.counts().puts,0);
 }
});
test('actor CAS reread retains a later draft, unknown reference, state and journal without repeating verified imports',async()=>{
 const f=await fixture(),normal=f.store.writeRecord;let first=true;
 f.store.writeRecord=async(key,value)=>{if(first){first=false;const remote=structuredClone(f.record);remote.chats[0].text='新版草稿';remote.chats[0].messages[0].appState.face.intensity=60;remote.chats.push({id:'new-chat',text:'保留新会话',messages:[]});f.record=remote;throw Object.assign(Error('CAS conflict'),{name:'AgentConversationConflictError'});}return normal(key,value);};
 const report=await f.migrate(f.build());assert.equal(report.persisted,true);assert.equal(f.record.chats[0].text,'新版草稿');assert.equal(f.record.chats[0].messages[0].appState.face.intensity,60);assert.equal(f.record.chats[1].id,'new-chat');assert.deepEqual(f.counts(),{reads:1,puts:1,decodes:1,writes:1});
});
test('forged actor typed updates and mismatched trace/resource schemas are rejected or left pending without IO',async()=>{
 const f=await fixture(),mapper=f.build();f.record.chats[0].messages[0].result.resource_uri='ui://tapnow/other@v1';const altered=structuredClone(f.record);f.record=altered;
 const report=await f.migrate(mapper);assert.equal(report.summary.changed,0);assert.equal(f.counts().reads,0);
 const bad=await fixture();await assert.rejects(bad.migrate(async original=>{const path='$.chats[0].messages[0].result.response.actor.reference_nodes[0].preview_url';original.chats[0].messages[0].result.response.actor.reference_nodes[0].node_ref='node/forged';return {snapshot:original,changes:[{path,ref:'data:image/png;base64,'+bytes.toString('base64')}]};}),/非附件字段/);assert.equal(bad.counts().writes,0);
});
