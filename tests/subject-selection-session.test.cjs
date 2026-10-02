const test=require('node:test'),assert=require('node:assert/strict');
const api=import('../src/features/subject-library/selection-session.mjs');
const asset=(id,url=id)=>({id,sourceNodeId:id,type:'image',url});
async function fixture(initial=[]){
 const {selectionSession}=await api;let assets=structuredClone(initial),writes=0;
 const session=selectionSession({getAssets:()=>assets,setAssets:value=>{assets=value;writes++;},sourceId:value=>value.sourceNodeId||null,toAsset:node=>node.unsupported?null:{...node,sourceNodeId:node.id}});
 return {session,get assets(){return assets;},get writes(){return writes;},external(value){assets=value;}};
}
function sequential(session,nodes){for(const node of nodes)if(!session.selected.has(node.id))session.toggle(node);}

test('marquee addition publishes once and preserves sequential toggle order and selected nodes',async()=>{
 const nodes=Array.from({length:500},(_,i)=>asset('n'+i)),f=await fixture([nodes[12]]),before=await fixture([nodes[12]]);
 f.session.addMany(nodes);sequential(before.session,nodes);
 assert.equal(f.writes,1);assert.equal(before.writes,499);assert.deepEqual(f.assets,before.assets);assert.deepEqual([...f.session.selected],[...before.session.selected]);
 assert.equal(f.assets[0].id,'n12');assert.equal(f.assets.length,500);
 f.session.finish(false);before.session.finish(false);assert.deepEqual(f.assets,before.assets);assert.deepEqual(f.assets,[nodes[12]]);
});

test('batch uses existing id, source and URL duplicate rules without selecting unsupported nodes',async()=>{
 const initial=[{id:'upload',type:'image',url:'shared'},{...asset('old'),id:'alias'}];
 const nodes=[asset('blocked','shared'),asset('old'),asset('new','new-url'),asset('same-url','new-url'),{id:'text-a',type:'text',text:'A'},{id:'text-b',type:'text',text:'A'},{id:'unsupported',unsupported:true},asset('new','changed')];
 const f=await fixture(initial),before=await fixture(initial);f.session.addMany(nodes);sequential(before.session,nodes);
 assert.equal(f.writes,1);assert.deepEqual(f.assets,before.assets);assert.deepEqual([...f.session.selected],[...before.session.selected]);
 assert.equal(f.session.selected.has('blocked'),false);assert.equal(f.session.selected.has('same-url'),false);assert.equal(f.session.selected.has('unsupported'),false);
 assert.deepEqual(f.assets.map(a=>a.id),['upload','alias','new','text-a','text-b']);
});

test('restoring removed aliases keeps original order and cancellation preserves uploads and manual removals',async()=>{
 const initial=[asset('a'),{...asset('b'),id:'b-one'},{...asset('b'),id:'b-two'},asset('c')],f=await fixture(initial),before=await fixture(initial);
 for(const value of [f,before]){
  value.session.toggle(asset('b'));value.session.toggle(asset('c'));
  const removed=value.assets[0];value.external([...value.assets.filter(a=>a.id!==removed.id),{id:'upload',type:'image',url:'external'}]);value.session.remove(removed);
 }
 const writes=f.writes,nodes=[asset('b'),asset('new'),asset('c')];f.session.addMany(nodes);sequential(before.session,nodes);
 assert.equal(f.writes-writes,1);assert.deepEqual(f.assets,before.assets);assert.deepEqual(f.assets.map(a=>a.id),['upload','b-one','b-two','c','new']);
 f.session.finish(false);before.session.finish(false);assert.deepEqual(f.assets,before.assets);assert.deepEqual(f.assets.map(a=>a.id),['upload','b-one','b-two','c']);
});

test('empty, already selected, duplicate-only and closed batches do not publish',async()=>{
 const f=await fixture([asset('a'),{id:'upload',type:'image',url:'shared'}]);
 f.session.addMany([]);f.session.addMany([asset('a'),asset('a')]);f.session.addMany([asset('blocked','shared')]);assert.equal(f.writes,0);
 f.session.finish(true);f.session.addMany([asset('new')]);assert.equal(f.writes,0);assert.equal(f.session.selected.has('new'),false);
});

test('batch reads fresh external assets and ordinary toggles remain immediate afterwards',async()=>{
 const f=await fixture();f.external([{id:'upload',type:'image',url:'external'}]);f.session.addMany([asset('a'),asset('b')]);
 assert.equal(f.writes,1);assert.deepEqual(f.assets.map(a=>a.id),['upload','a','b']);
 f.session.toggle(asset('a'));assert.equal(f.writes,2);assert.deepEqual(f.assets.map(a=>a.id),['upload','b']);
 f.session.addMany([asset('a')]);assert.equal(f.writes,3);f.session.finish(true);assert.deepEqual(f.assets.map(a=>a.id),['upload','b','a']);
});
