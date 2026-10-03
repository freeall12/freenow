'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const {createConversations}=require('../project-context.js');
const ready=Promise.all([import('../src/features/local-resource-migration/conversations.mjs'),import('../src/features/agent-apps/interactive-learning.mjs')]);
const hash=value=>createHash('sha256').update(value).digest('hex');
const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64'),local='data:image/png;base64,'+bytes.toString('base64');
const sources=['https://old-learning.example.invalid/target.png?signature=exact&v=1','HTTPS://old-learning.example.invalid/learner.png?signature=exact&v=2','https://old-learning.example.invalid/contrast.png?signature=exact&v=3'];
function input(){return {view:'board',locale:'zh-CN',level:{key:'L1',title:'原关卡',why:'原技法',media:'image',creator_prompt:'保留原提示词',preview_url:local,learner_preview_url:local,contrast_url:local,questions:{q2:{stem:'哪个词控制光？',options:[{text:'逆光',correct:true},{text:'低角度',correct:false}],explain:'原解释'},q3:{parts:['人物',''],blanks:['逆光'],bank:['逆光','低角度']},q4:{stem:'原反推题'},q5:{stem:'原改编题'}},hints:{q4:['原提示'],q5:['原提示']}}};}
async function fixture(){
 const [{createConversationMigration},{prepareInteractiveLearning,initialInteractiveLearningState}]=await ready,response=prepareInteractiveLearning(input()),state=initialInteractiveLearningState(response);state.drafts={q4:'保留反推草稿',q5:'保留改编草稿'};state.done=['q1','q2'];
 const slots=['preview_url','learner_preview_url','contrast_url'];slots.forEach((slot,i)=>{response.level[slot]=sources[i];});
 const trace={id:'original-learning',name:'show_app',status:'done',args:{resource_uri:'ui://tapnow/interactive-learning@v1',data:{level:{preview_url:sources[0]},source:'keep-original-input'}},result:{kind:'mcp_app',resource_uri:'ui://tapnow/interactive-learning@v1',response,sourceContext:{projectId:'learning-migration',sourceFingerprint:'keep-source'}},appState:state,appHandoffs:['keep-handoff'],generationTask:{id:'keep-task',source:sources[0]}};
 let live={chats:[{id:'chat',text:'保留当前输入草稿',messages:[trace],queuedMessages:[{id:'q',text:'保留队列',source:sources[1]}],interruptedRuns:[{journal:{submissionHash:'keep-hash',url:sources[2]}}]}],activeId:'chat'},record=structuredClone(live),reads=0,puts=0,decodes=0,writes=0,applies=0;
 const index={version:1,algorithm:'sha256-exact-utf8',entries:Object.fromEntries(sources.map(source=>[hash(source),{ref:'/assets/learning-migration.png',sha256:hash(bytes),bytes:bytes.length}]))};
 const options={index,assets:{put:async blob=>{puts++;assert.ok(decodes>0);assert.deepEqual(Buffer.from(await blob.arrayBuffer()),bytes);return 'asset:learning-migration';}},fetchImpl:async(ref,init)=>{reads++;assert.equal(ref,'/assets/learning-migration.png');assert.equal(init.redirect,'error');assert.equal(init.mode,'same-origin');return new Response(bytes,{headers:{'Content-Type':'image/png','Content-Length':bytes.length}});},decodeInteractiveLearningPreview:async blob=>{decodes++;assert.equal(hash(Buffer.from(await blob.arrayBuffer())),hash(bytes));return {width:1,height:1};}};
 const store={readRecord:async()=>structuredClone(record),writeRecord:async(_key,value)=>{writes++;record=structuredClone(value);}},conversations=createConversations({project:{id:'learning-migration'},store});conversations.baseline(live.chats,live.activeId);
 return {index,options,store,conversations,build:()=>createConversationMigration(options),migrate:mapper=>conversations.migrateResources({migrate:mapper||createConversationMigration(options),getCurrent:()=>live,applyCommitted:value=>{applies++;live=value;}}),get record(){return record;},set record(value){record=structuredClone(value);},get live(){return live;},counts:()=>({reads,puts,decodes,writes,applies})};
}
test('three exact learning slots become verified local bytes without altering calls, source, drafts, tasks or handoffs',async()=>{
 const f=await fixture(),expected=structuredClone(f.record);for(const slot of ['preview_url','learner_preview_url','contrast_url'])expected.chats[0].messages[0].result.response.level[slot]=local;
 const report=await f.migrate();assert.equal(report.persisted,true);assert.equal(report.status,'ready');assert.equal(report.summary.changed,3);assert.deepEqual(f.record,expected);assert.deepEqual(f.live,expected);assert.deepEqual(f.counts(),{reads:1,puts:1,decodes:1,writes:1,applies:1});assert.ok(!JSON.stringify(report).includes('signature='));
 const {prepareInteractiveLearning}= (await ready)[1],{title,summary,...data}=f.record.chats[0].messages[0].result.response;assert.ok(prepareInteractiveLearning(data,title));
 const again=await f.migrate();assert.equal(again.persisted,false);assert.equal(again.summary.changed,0);assert.equal(again.summary.alreadyLocal,3);assert.deepEqual(f.counts(),{reads:1,puts:1,decodes:1,writes:1,applies:1});
});
test('unknown exact URL leaves the whole card unchanged and pending without fetching remote or publishing placeholders',async()=>{
 const f=await fixture(),before=structuredClone(f.record);delete f.index.entries[hash(sources[2])];
 const report=await f.migrate();assert.equal(report.status,'pending_import');assert.equal(report.persisted,false);assert.deepEqual(f.record,before);assert.deepEqual(f.live,before);assert.deepEqual(f.counts(),{reads:0,puts:0,decodes:0,writes:0,applies:0});assert.deepEqual(report.diagnostics,[{path:'$.chats[0].messages[0].result.response.level.contrast_url',code:'local_import_required'}]);
});
test('source hashing preserves uppercase scheme and full signature/query spelling exactly',async()=>{
 const f=await fixture();delete f.index.entries[hash(sources[1])];f.index.entries[hash(sources[1].replace(/^HTTPS:/,'https:'))]={ref:'/assets/learning-migration.png',sha256:hash(bytes),bytes:bytes.length};
 const report=await f.migrate();assert.equal(report.status,'pending_import');assert.equal(report.summary.changed,0);assert.equal(f.counts().reads,0);
 f.index.entries[hash(sources[1])]={ref:'/assets/learning-migration.png',sha256:hash(bytes),bytes:bytes.length};assert.equal((await f.migrate()).summary.changed,3);
});
test('SHA, length, MIME, decode, dimensions, byte budget and storage errors never commit a migrated card',async()=>{
 for(const kind of ['sha','bytes','mime','decode','dimensions','oversize','put','save']){
  const f=await fixture(),before=structuredClone(f.record);
  if(kind==='sha')for(const row of Object.values(f.index.entries))row.sha256='0'.repeat(64);
  if(kind==='bytes')for(const row of Object.values(f.index.entries))row.bytes++;
  if(kind==='oversize')for(const row of Object.values(f.index.entries))row.bytes=187477;
  if(kind==='mime')f.options.fetchImpl=async()=>new Response(bytes,{headers:{'Content-Type':'image/svg+xml'}});
  if(kind==='decode')f.options.decodeInteractiveLearningPreview=async()=>{throw Error('decode failed');};
  if(kind==='dimensions')f.options.decodeInteractiveLearningPreview=async()=>({width:8192,height:8192});
  if(kind==='put')f.options.assets.put=async()=>{throw Error('asset persistence failed');};
  if(kind==='save')f.store.writeRecord=async()=>{throw Error('conversation persistence failed');};
  await assert.rejects(f.migrate());assert.deepEqual(f.record,before);assert.deepEqual(f.live,before);assert.equal(f.counts().writes,0);assert.equal(f.counts().applies,0);if(!['put','save'].includes(kind))assert.equal(f.counts().puts,0);
 }
});
test('strict legacy shape validation rejects non-preview field corruption before any local read',async()=>{
 for(const mutate of [trace=>{trace.result.response.level.questions.q3.parts=[];},trace=>{trace.result.response.level.tools=['generate'];},trace=>{trace.result.response.summary='forged';},trace=>{trace.result.response.extra='unknown';},trace=>{trace.result.response.level.preview_url='data:image/svg+xml;base64,PHN2Zy8+';},trace=>{trace.result.response.level.preview_url='https://user:secret@legacy.invalid/x.png';}]){
  const f=await fixture(),record=structuredClone(f.record);mutate(record.chats[0].messages[0]);f.record=record;const report=await f.migrate();assert.equal(report.status,'pending_import');assert.equal(report.summary.changed,0);assert.equal(f.counts().reads,0);assert.deepEqual(f.record,record);assert.equal(report.diagnostics[0].code,'invalid_learning_preview_record');
 }
});
test('unfinished/error/mismatched/syllabus traces and recursive URLs are outside learning migration',async()=>{
 for(const mutate of [trace=>{trace.status='pending';},trace=>{trace.error='failed';},trace=>{trace.result.error='failed';},trace=>{trace.name='another_tool';},trace=>{trace.args.resource_uri='ui://tapnow/other@v1';},trace=>{trace.result.resource_uri='ui://tapnow/other@v1';},trace=>{trace.result.kind='other';},trace=>{trace.result.response.view='syllabus';}]){
  const f=await fixture(),record=structuredClone(f.record);mutate(record.chats[0].messages[0]);f.record=record;const report=await f.migrate();assert.equal(report.summary.changed,0);assert.equal(f.counts().reads,0);assert.deepEqual(f.record,record);
 }
});
test('CAS reread preserves new authoritative draft/state/chat and reuses verified imports',async()=>{
 const f=await fixture(),normal=f.store.writeRecord;let first=true;
 f.store.writeRecord=async(key,value)=>{if(first){first=false;const record=structuredClone(f.record);record.chats[0].text='另一个写入者的新草稿';record.chats[0].messages[0].appState.drafts.q5='新改编草稿';record.chats.push({id:'new-chat',messages:[]});f.record=record;throw Object.assign(Error('CAS conflict'),{name:'AgentConversationConflictError'});}return normal(key,value);};
 const report=await f.migrate(f.build());assert.equal(report.persisted,true);assert.equal(f.record.chats[0].text,'另一个写入者的新草稿');assert.equal(f.record.chats[0].messages[0].appState.drafts.q5,'新改编草稿');assert.equal(f.record.chats[1].id,'new-chat');assert.deepEqual(f.counts(),{reads:1,puts:1,decodes:1,writes:1,applies:1});
});
test('a new live draft during import or after database commit is never replaced by old migrated UI snapshot',async()=>{
 for(const when of ['import','commit']){
  const f=await fixture();if(when==='import'){const decode=f.options.decodeInteractiveLearningPreview;f.options.decodeInteractiveLearningPreview=async blob=>{const value=await decode(blob);f.live.chats[0].text='保存中新草稿';return value;};}
  else{const write=f.store.writeRecord;f.store.writeRecord=async(key,value)=>{await write(key,value);f.live.chats[0].text='保存中新草稿';};}
  const report=await f.migrate();assert.equal(report.status,'local_edits');assert.equal(report.persisted,when==='commit');assert.equal(f.live.chats[0].text,'保存中新草稿');assert.equal(f.counts().applies,0);assert.equal(f.counts().writes,when==='commit'?1:0);
 }
});
