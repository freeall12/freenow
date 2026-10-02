const {test}=require('node:test'),assert=require('node:assert/strict');
const modulePromise=import('../src/features/agent-scene/conversation-scope.mjs');
test('canvas AI entry restores a canvas conversation without mutating persisted studio draft/history',async()=>{
 const {canvasConversationIndex}=await modulePromise;
 const chats=[{id:'canvas-a',text:'保留画布草稿',updatedAt:'2026-10-01T10:00:00Z'},{id:'studio',studioNodeId:'scene-1',text:'保留片场草稿',messages:[{role:'user',text:'镜头'}],updatedAt:'2026-10-02T10:00:00Z'},{id:'canvas-b',text:'最近画布',updatedAt:'2026-10-01T11:00:00Z'}],before=structuredClone(chats);
 assert.equal(canvasConversationIndex(chats,1),2);assert.equal(canvasConversationIndex(chats,1,{sceneNodeId:'scene-1'}),1);assert.equal(canvasConversationIndex(chats,1,{busy:true}),1);
 assert.equal(canvasConversationIndex(chats,0),0);assert.equal(canvasConversationIndex([chats[1]],0),-1);assert.deepEqual(chats,before);
});
test('new conversation inherits only the still-active matching scene',async()=>{
 const {newConversationScope}=await modulePromise,chat={studioNodeId:'scene-1',text:'草稿',refs:['other']};
 assert.deepEqual(newConversationScope(chat,'scene-1'),{studioNodeId:'scene-1',skills:['3d-scene-director'],refs:['scene-1']});
 assert.deepEqual(newConversationScope(chat,null),{});assert.deepEqual(newConversationScope(chat,'scene-2'),{});assert.deepEqual(newConversationScope({},'scene-1'),{});assert.equal(chat.text,'草稿');
});
