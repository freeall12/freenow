const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
function indexedDbHarness(){
 let value,failNext=false,writeCommits=0;const names=[],stores=[];
 const database={createObjectStore(name){stores.push(name);},close(){},transaction(name,mode){
  assert.equal(name,'conversation');const fail=mode==='readwrite'&&failNext;if(fail)failNext=false;
  const tx={error:null,objectStore:()=>({get(){return request(undefined);},put(input,key){assert.equal(key,'chat');return request(structuredClone(input));}})};
  function request(input){const request={};queueMicrotask(()=>{
   if(fail){tx.error=Error('simulated IndexedDB save failure');tx.onabort();return;}
   request.result=mode==='readonly'?structuredClone(value):'chat';request.onsuccess();
   queueMicrotask(()=>{if(mode==='readwrite'){value=input;writeCommits++;}tx.oncomplete();});
  });return request;}return tx;
 }};
 return {get value(){return value;},get writeCommits(){return writeCommits;},names,stores,setFailNext(){failNext=true;},open(name,version){names.push([name,version]);const request={};queueMicrotask(()=>{request.result=database;request.onupgradeneeded();request.onsuccess();});return request;}};
}
test('QA conversation store has an independent database and commits ordered invocation snapshots without localStorage',async()=>{
 const {createTemplateQaChatStore}=await import('../src/features/agent-apps/qa/template-source-chat-store.mjs'),indexedDB=indexedDbHarness(),store=createTemplateQaChatStore({indexedDB});
 assert.equal(await store.load(),undefined);const chat={id:'qa',messages:[]},first=store.save(chat);chat.messages.push({text:'newer state'});const second=store.save(chat);chat.messages[0].text='unsaved later mutation';
 assert.equal(await first,true);assert.equal(await second,true);assert.deepEqual((await store.load()).messages,[{text:'newer state'}]);assert.equal(indexedDB.writeCommits,2);assert.deepEqual(indexedDB.names,[['tapnow-template-source-qa-chat-v2',1]]);assert.deepEqual(indexedDB.stores,['conversation']);
 const source=fs.readFileSync('src/features/agent-apps/qa/template-source.mjs','utf8');assert.doesNotMatch(source,/localStorage\.(?:setItem|removeItem|clear)\s*\(/);store.close();
});
test('QA IndexedDB abort does not return a receipt or poison the next save; close rejects late writes',async()=>{
 const {createTemplateQaChatStore}=await import('../src/features/agent-apps/qa/template-source-chat-store.mjs'),indexedDB=indexedDbHarness(),store=createTemplateQaChatStore({indexedDB});
 await store.save({messages:[{text:'saved'}]});indexedDB.setFailNext();await assert.rejects(()=>store.save({messages:[{text:'failed'}]}),/save failure/);assert.equal(indexedDB.value.messages[0].text,'saved');assert.equal(indexedDB.writeCommits,1);
 assert.equal(await store.save({messages:[{text:'retry'}]}),true);assert.equal((await store.load()).messages[0].text,'retry');store.close();await assert.rejects(()=>store.save({messages:[]}),/已关闭/);
});
