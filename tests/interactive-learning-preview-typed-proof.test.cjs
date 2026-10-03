'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createConversations}=require('../project-context.js');
const ready=import('../src/features/agent-apps/interactive-learning.mjs'),preview='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const slots=['preview_url','learner_preview_url','contrast_url'],path='$.chats[0].messages[0].result.response.level.';
async function fixture(){
 const {prepareInteractiveLearning,interactiveLearningUri}=await ready,response=prepareInteractiveLearning({view:'board',level:{key:'L1',title:'关卡',why:'保留技法',media:'image',creator_prompt:'保留提示词',preview_url:preview,learner_preview_url:preview,contrast_url:preview,questions:{q2:{stem:'原题',options:[{text:'逆光',correct:true},{text:'低角度',correct:false}],explain:'原解释'},q3:{parts:['人物',''],blanks:['逆光'],bank:['逆光']},q4:{stem:'原题'},q5:{stem:'原题'}},hints:{}}});
 slots.forEach((slot,i)=>{response.level[slot]=`https://legacy-learning.invalid/${i}.png?original=exact`;});
 let live={chats:[{id:'chat',text:'保留新草稿',refs:['node/source'],messages:[{id:'original',name:'show_app',status:'done',args:{resource_uri:interactiveLearningUri,data:{source:'keep-original'}},result:{kind:'mcp_app',resource_uri:interactiveLearningUri,response,sourceContext:{fingerprint:'keep-original'}},appState:{done:['q1'],drafts:{q5:'保留草稿'}},appHandoffs:['keep-handoff'],generationTask:{id:'keep-task'}}],interruptedRuns:[{journal:{submissionHash:'keep-digest'}}]}],activeId:'chat'},record=structuredClone(live),writes=0,applies=0;
 const conversations=createConversations({project:{id:'learning-proof'},store:{readRecord:async()=>structuredClone(record),writeRecord:async(_key,value)=>{writes++;record=structuredClone(value);}}});conversations.baseline(live.chats,live.activeId);
 return {get record(){return record;},set record(value){record=structuredClone(value);},get live(){return live;},get writes(){return writes;},get applies(){return applies;},migrate:mutate=>conversations.migrateResources({getCurrent:()=>live,applyCommitted:value=>{applies++;live=value;},migrate:async original=>{const changes=mutate(original);return {snapshot:original,changes,status:'ready',summary:{references:changes.length,changed:changes.length,unresolved:0,alreadyLocal:0},unresolved:[]};}})};
}
function patch(original,ref=preview){return slots.map(slot=>{original.chats[0].messages[0].result.response.level[slot]=ref;return {path:path+slot,ref};});}
test('typed proof accepts only three exact completed board display slots and preserves all other data',async()=>{
 const f=await fixture(),expected=structuredClone(f.record);slots.forEach(slot=>{expected.chats[0].messages[0].result.response.level[slot]=preview;});const report=await f.migrate(patch);assert.equal(report.persisted,true);assert.equal(f.writes,1);assert.equal(f.applies,1);assert.deepEqual(f.record,expected);assert.deepEqual(f.live,expected);
});
test('typed proof refuses partial board publication that leaves another actual remote slot',async()=>{
 const f=await fixture();await assert.rejects(f.migrate(original=>{original.chats[0].messages[0].result.response.level.preview_url=preview;return [{path:path+'preview_url',ref:preview}];}));assert.equal(f.writes,0);assert.equal(f.applies,0);
});
test('typed proof rejects malformed trace and schema even when preview-only changes are claimed',async()=>{
 for(const mutate of [trace=>{trace.status='pending';},trace=>{trace.name='other';},trace=>{trace.error='failure';},trace=>{trace.result.error='failure';},trace=>{trace.args.resource_uri='ui://tapnow/other@v1';},trace=>{trace.result.resource_uri='ui://tapnow/other@v1';},trace=>{trace.result.kind='other';},trace=>{trace.result.response.view='syllabus';},trace=>{trace.result.response.summary='forged';},trace=>{trace.result.response.level.key='L1;next=1';},trace=>{trace.result.response.level.questions.q3.parts=[];}]){
  const f=await fixture(),record=structuredClone(f.record);mutate(record.chats[0].messages[0]);f.record=record;await assert.rejects(f.migrate(patch));assert.equal(f.writes,0);assert.equal(f.applies,0);assert.deepEqual(f.record,record);
 }
});
test('typed proof rejects noncanonical/empty/SVG/asset/remote/oversized data and absent slots',async()=>{
 for(const ref of ['data:image/png;base64,AB==','data:image/png;base64,','data:image/svg+xml;base64,PHN2Zy8+','asset:wrong-contract','https://legacy.invalid/image.png','data:image/png;base64,'+'AAAA'.repeat(62500)]){const f=await fixture();await assert.rejects(f.migrate(original=>patch(original,ref)));assert.equal(f.writes,0);}
 const f=await fixture(),record=structuredClone(f.record);delete record.chats[0].messages[0].result.response.level.preview_url;f.record=record;await assert.rejects(f.migrate(patch));assert.equal(f.writes,0);
});
test('typed preview paths cannot rebind calls, state, handoffs, provenance, tasks, journals or other app paths',async()=>{
 for(const mutate of [original=>{original.chats[0].messages[0].args.data.source='forged';},original=>{original.chats[0].messages[0].result.sourceContext.fingerprint='forged';},original=>{original.chats[0].messages[0].appState.drafts.q5='forged';},original=>{original.chats[0].messages[0].appHandoffs=[];},original=>{original.chats[0].messages[0].generationTask.id='forged';},original=>{original.chats[0].interruptedRuns[0].journal.submissionHash='forged';},original=>{original.chats[0].messages[0].result.response.level.creator_prompt='forged';}]){
  const f=await fixture();await assert.rejects(f.migrate(original=>{const changes=patch(original);mutate(original);return changes;}),/非附件字段/);assert.equal(f.writes,0);
 }
 for(const forbidden of ['$.chats[0].queuedMessages[0].result.response.level.preview_url','$.chats[0].messages[0].args.data.level.preview_url','$.chats[0].messages[0].appState.preview_url','$.chats[0].messages[0].result.response.questions.q4.preview_url']){const f=await fixture();await assert.rejects(f.migrate(original=>{const changes=patch(original);changes[0].path=forbidden;return changes;}),/非附件字段/);assert.equal(f.writes,0);}
});
