'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const fixtureSource=fs.readFileSync(require.resolve('../qa/canvas-groups-fixture.js'),'utf8');
const storeSource=fs.readFileSync(require.resolve('../canvas-store.js'),'utf8');
const assetsSource=fs.readFileSync(require.resolve('../local-assets.js'),'utf8');
const tick=async()=>{await Promise.resolve();await Promise.resolve();await Promise.resolve();};

function qaStore({saved,legacy=null,readError,openError,search='?session=storage-test',pending=false}={}){
  const values=new Map([['graph',JSON.stringify(legacy)]]),writes=[],reads=[];
  let release,rejectSave,flushes=0;
  const production={load:async()=>{if(readError)throw readError;return saved;},save:graph=>{writes.push(structuredClone(graph));return pending?new Promise((resolve,reject)=>{release=resolve;rejectSave=reject;}):Promise.resolve();},flush:async()=>{flushes++;}};
  const context=vm.createContext({window:{},prefix:'qa-canvas-groups:storage-test:',structuredClone,URLSearchParams,location:{search},localStorage:{getItem:key=>{reads.push(key);return values.get(key);},setItem(){throw Error('QA must not write legacy data');},removeItem(){throw Error('QA must not delete legacy data');}},loadStore:async()=>{await Promise.resolve();if(openError)throw openError;context.window.CanvasStore=production;}});
  const start=fixtureSource.indexOf(' // Use the production store in every QA session.'),end=fixtureSource.indexOf('\n})();',start);
  assert.ok(start>=0&&end>start);
  vm.runInContext(fixtureSource.slice(start,end).replace("import('/canvas-store.js')",'loadStore()'),context);
  const wrapper=context.window.CanvasStore;
  return {store:wrapper,writes,reads,values,dbName:context.window.CANVAS_DB_NAME,release:()=>release(),reject:error=>rejectSave(error),flushes:()=>flushes};
}

test('default and mediaStore QA routes use the same session-isolated IndexedDB without writing localStorage',async()=>{
  for(const search of ['?session=storage-test','?session=storage-test&mediaStore']){
    const f=qaStore({search,saved:{version:1,nodes:[{id:'saved'}],edges:[]},legacy:{version:1,nodes:[{id:'old'}],edges:[]}});
    assert.equal(f.dbName,'qa-canvas-groups:storage-test:media');assert.equal((await f.store.load()).nodes[0].id,'saved');assert.deepEqual(f.reads,[]);
    await f.store.save({version:1,nodes:[{id:'changed'}],edges:[]});await f.store.flush();assert.equal(f.writes[0].nodes[0].id,'changed');assert.equal(f.flushes(),1);
    assert.equal(JSON.parse(f.values.get('graph')).nodes[0].id,'old');
  }
});

test('QA migrates legacy graph only when IndexedDB is empty, preserving the old key',async()=>{
  const legacy={version:1,nodes:[{id:'old',title:'Keep this data'}],edges:[]},f=qaStore({legacy});
  const restored=await f.store.load();assert.deepEqual(structuredClone(restored),legacy);assert.equal(f.writes.length,0);
  await f.store.save(restored);assert.deepEqual(f.writes[0],legacy);assert.equal(f.values.get('graph'),JSON.stringify(legacy));
});

test('QA never converts failed database reads or opens into empty successful loads',async()=>{
  for(const options of [{readError:Error('read failed')},{openError:Error('open failed')}]){
    const f=qaStore({...options,legacy:{version:1,nodes:[{id:'keep'}],edges:[]}});
    await assert.rejects(f.store.load(),/failed/);assert.equal(f.writes.length,0);assert.deepEqual(f.reads,[]);assert.match(f.values.get('graph'),/keep/);
  }
});

test('QA captures each save before its async database boundary and propagates failure',async()=>{
  const f=qaStore({pending:true}),graph={version:1,nodes:[{id:'first'}],edges:[]};
  const saving=f.store.save(graph);graph.nodes[0].id='later';await tick();assert.equal(f.writes[0].nodes[0].id,'first');
  f.reject(Object.assign(Error('quota'),{name:'QuotaExceededError'}));await assert.rejects(saving,{name:'QuotaExceededError'});
});

function indexedStore(){
  const transactions=[],reads=[];let openRequest;
  const db={transaction:(_,mode)=>{
    const tx={objectStore:()=>({put:snapshot=>{tx.snapshot=structuredClone(snapshot);},get:()=>{const request={};reads.push(request);return request;}})};
    if(mode==='readwrite')transactions.push(tx);return tx;
  }};
  const context=vm.createContext({window:{CANVAS_DB_NAME:'isolated-test'},structuredClone,indexedDB:{open:()=>openRequest={}}});
  vm.runInContext(storeSource,context);openRequest.result=db;openRequest.onsuccess();
  return {store:context.window.CanvasStore,transactions,reads};
}

test('production IndexedDB save and flush resolve only after transaction commit',async()=>{
  const f=indexedStore(),graph={nodes:[{id:'before'}],edges:[]};let saved=false,flushed=false;
  const save=f.store.save(graph).then(()=>saved=true),flush=f.store.flush().then(()=>flushed=true);graph.nodes[0].id='after';await tick();
  assert.equal(f.transactions[0].snapshot.nodes[0].id,'before');assert.equal(saved,false);assert.equal(flushed,false);
  f.transactions[0].oncomplete();await save;await flush;assert.equal(saved,true);assert.equal(flushed,true);
});

test('production IndexedDB abort remains a rejected save and flush',async()=>{
  const f=indexedStore(),save=f.store.save({nodes:[],edges:[]}),flush=f.store.flush();await tick();
  f.transactions[0].error=Object.assign(Error('full'),{name:'QuotaExceededError'});f.transactions[0].onabort();
  await assert.rejects(save,{name:'QuotaExceededError'});await assert.rejects(flush,{name:'QuotaExceededError'});
});

test('LocalAssets abort without a request error rejects rather than leaving a save pending or returning an asset reference',async()=>{
  for(const error of [Object.assign(Error('full'),{name:'QuotaExceededError'}),null]){
    let request,transaction;
    const db={transaction:()=>transaction={objectStore:()=>({put(){}})}};
    const context=vm.createContext({window:{},crypto:{randomUUID:()=> 'test-asset'},indexedDB:{open:()=>request={}}});
    vm.runInContext(assetsSource,context);let settled=false,reference;
    const pending=context.window.LocalAssets.put({bytes:'keep me'}).then(value=>{reference=value;settled=true;},failure=>{settled=true;throw failure;});
    request.result=db;request.onsuccess();await tick();assert.equal(settled,false);
    transaction.error=error;transaction.onabort();
    await assert.rejects(pending,error?{name:'QuotaExceededError'}:/本地素材保存中断/);
    assert.equal(settled,true);assert.equal(reference,undefined);
  }
});
