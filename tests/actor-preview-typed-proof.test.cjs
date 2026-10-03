'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createConversations}=require('../project-context.js');
const moduleReady=import('../src/features/agent-apps/actor-emotion.mjs');
const bytes='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const preview='data:image/png;base64,'+bytes,path='$.chats[0].messages[0].result.response.actor.reference_nodes[0].preview_url';
async function fixture(){
 const {prepareActorEmotion,actorEmotionUri}=await moduleReady;
 const response=prepareActorEmotion({scene:'保留场景',mode:'image',source:{node_ref:'node/source',media_kind:'image'},actor:{binding_id:'aem_0123456789abcdef',name:'人物',role:'角色',reference_nodes:[{node_ref:'node/actor',preview_url:'https://files.tapnow.media/actor-review.png'}]},face:{valence:0,stance:0,intensity:50}});
 let live={chats:[{id:'chat',text:'新草稿',refs:['node/actor'],messages:[{id:'original-show-app',name:'show_app',status:'done',args:{resource_uri:actorEmotionUri,data:{source:'keep-args'}},result:{kind:'mcp_app',resource_uri:actorEmotionUri,response,actorSourceContext:{sourceSnapshots:[{sourceNodeId:'actor',sourceFingerprint:'keep-original'}]}},appState:{version:1,face:{intensity:63}},actorExpressionGuide:{guide_sha256:'keep-guide',image_data_uri:'keep-guide-image'}}],interruptedRuns:[{journal:{submissionHash:'keep-digest',source:'keep-original'}}]}],activeId:'chat'},record=structuredClone(live),writes=0,applies=0;
 const conversations=createConversations({project:{id:'actor-proof'},store:{readRecord:async()=>structuredClone(record),writeRecord:async(_key,value)=>{writes++;record=structuredClone(value);}}});conversations.baseline(live.chats,live.activeId);
 return {conversations,get live(){return live;},get record(){return record;},set record(value){record=structuredClone(value);},get writes(){return writes;},get applies(){return applies;},migrate:mutate=>conversations.migrateResources({getCurrent:()=>live,applyCommitted:value=>{applies++;live=value;},migrate:async original=>{const changes=mutate(original);return {snapshot:original,changes,status:'ready',summary:{changed:changes.length,references:changes.length,unresolved:0,alreadyLocal:0},unresolved:[]};}})};
}
const patch=(original,ref=preview,at=path)=>{original.chats[0].messages[0].result.response.actor.reference_nodes[0].preview_url=ref;return [{path:at,ref}];};

test('typed actor preview proof accepts only the completed actor display slot and preserves source/node/guide/state/journal',async()=>{
 const f=await fixture(),expected=structuredClone(f.record);expected.chats[0].messages[0].result.response.actor.reference_nodes[0].preview_url=preview;
 const report=await f.migrate(patch);assert.equal(report.persisted,true);assert.equal(f.writes,1);assert.equal(f.applies,1);assert.deepEqual(f.record,expected);assert.deepEqual(f.live,expected);
});
test('typed actor proof rejects unfinished/error traces, mismatched URIs and malformed response schema before writing',async()=>{
 for(const change of [trace=>{trace.status='pending';},trace=>{trace.name='other';},trace=>{trace.error='old failure';},trace=>{trace.result.error='old failure';},trace=>{trace.args.resource_uri='ui://tapnow/other@v1';},trace=>{trace.result.resource_uri='ui://tapnow/other@v1';},trace=>{trace.result.kind='other';},trace=>{trace.result.response.version=2;},trace=>{trace.result.response.actor.binding_id='invalid';},trace=>{trace.result.response.summary='forged summary';}]){
  const f=await fixture(),record=structuredClone(f.record);change(record.chats[0].messages[0]);f.record=record;
  await assert.rejects(f.migrate(patch));assert.equal(f.writes,0);assert.equal(f.applies,0);assert.deepEqual(f.record,record);
 }
});
test('typed actor proof rejects noncanonical, empty, SVG, asset refs and oversize data URLs',async()=>{
 for(const ref of ['data:image/png;base64,AB==','data:image/png;base64,','data:image/svg+xml;base64,PHN2Zy8+','asset:must-not-change-contract','data:image/png;base64,'+'AAAA'.repeat(125000)]){
  const f=await fixture();await assert.rejects(f.migrate(original=>patch(original,ref)),/非附件字段/);assert.equal(f.writes,0);assert.equal(f.applies,0);
 }
});
test('typed actor proof cannot authorize other preview paths or simultaneous node/snapshot/guide/state/journal rebinding',async()=>{
 for(const mutate of [original=>{original.chats[0].messages[0].result.response.actor.reference_nodes[0].node_ref='node/forged';},original=>{original.chats[0].messages[0].result.actorSourceContext.sourceSnapshots[0].sourceFingerprint='forged';},original=>{original.chats[0].messages[0].actorExpressionGuide.guide_sha256='forged';},original=>{original.chats[0].messages[0].appState.face.intensity=99;},original=>{original.chats[0].interruptedRuns[0].journal.submissionHash='forged';},original=>{original.chats[0].messages[0].args.data.source='forged';}]){
  const f=await fixture();await assert.rejects(f.migrate(original=>{const changes=patch(original);mutate(original);return changes;}),/非附件字段/);assert.equal(f.writes,0);
 }
 const f=await fixture();await assert.rejects(f.migrate(original=>patch(original,preview,'$.chats[0].queuedMessages[0].result.response.actor.reference_nodes[0].preview_url')),/非附件字段/);assert.equal(f.writes,0);
});
