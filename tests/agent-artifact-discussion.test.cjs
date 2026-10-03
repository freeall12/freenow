'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../agent-client.js'),'utf8');
const body=source.slice(source.indexOf(' async function discussArtifact('),source.indexOf('\n function quoteArtifact'));
function setup(overrides={}){
 const chat={id:'chat',text:'keep my draft',artifactRefs:[{artifact_path:'artifacts/other.md',revision:1}]};
 const file={artifact_path:'artifacts/page.html',title:'Latest page',revision:3,content_type:'html',content:'<p>latest</p>'};
 let current=chat,saves=0,focus=0;
 const context=vm.createContext({pageLeaving:false,project:{id:'project'},chats:[chat],panel:{},draft:()=>current,
  artifactsReady:Promise.resolve({get:async()=>file}),save:()=>{saves++;return true;},flushConversation:async()=>{},render(){},open(){},focusComposer:()=>focus++,requestAnimationFrame:fn=>fn(),Error,...overrides});
 vm.runInContext(body,context);
 return {chat,file,context,run:options=>context.discussArtifact({...file,revision:1},options),switchChat:()=>{current={id:'other'};},counts:()=>({saves,focus})};
}
test('discussion uses the current stored revision, preserves draft and other refs, and does not send a prompt',async()=>{
 const f=setup();const result=await f.run();assert.equal(result.revision,3);assert.equal(f.chat.text,'keep my draft');
 assert.equal(f.chat.artifactRefs.length,2);assert.equal(f.chat.artifactRefs[1].revision,3);assert.deepEqual(f.counts(),{saves:1,focus:1});
});
test('discussion waits for durable conversation flush before focusing or returning success',async()=>{
 let release,entered;const ready=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve);
 const f=setup({flushConversation:async()=>{entered();await gate;}}),pending=f.run();await ready;
 assert.equal(f.counts().focus,0);release();await pending;assert.equal(f.counts().focus,1);
});
test('changing conversation while reading latest artifact does not write a reference into either conversation',async()=>{
 let release,entered;const ready=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve);
 const f=setup({artifactsReady:Promise.resolve({get:async()=>{entered();await gate;return {artifact_path:'artifacts/page.html',revision:4};}})}),pending=f.run();await ready;f.switchChat();release();
 await assert.rejects(pending,/会话已切换/);assert.equal(f.chat.artifactRefs.length,1);assert.deepEqual(f.counts(),{saves:0,focus:0});
});
test('source invalidation before discussion and rejected save do not publish a successful reference',async()=>{
 const f=setup();await assert.rejects(f.run({isCurrent:()=>false}),/会话已切换/);assert.equal(f.chat.artifactRefs.length,1);
 const failed=setup({save:()=>false});const old=failed.chat.artifactRefs;await assert.rejects(failed.run(),/未能保存/);assert.equal(failed.chat.artifactRefs,old);
});
test('uncertain persistence retains the editable draft reference and reports failure without stealing focus',async()=>{
 const f=setup({flushConversation:async()=>{throw Error('disk failure');}});await assert.rejects(f.run(),/持久保存未确认/);
 assert.equal(f.chat.artifactRefs[1].revision,3);assert.equal(f.counts().focus,0);
});
test('deferred composer focus does not move focus into a different conversation',async()=>{
 let focus;const f=setup({requestAnimationFrame:callback=>{focus=callback;}});await f.run();
 f.switchChat();focus();assert.equal(f.counts().focus,0);assert.equal(f.chat.artifactRefs[1].revision,3);
});
