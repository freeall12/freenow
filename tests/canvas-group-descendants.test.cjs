const test=require('node:test'),assert=require('node:assert/strict'),G=require('../canvas-groups.js');

// Previous fixed-point traversal is the membership oracle; Set insertion order
// is not used by positions(), whose contract follows the original node array.
function reference(nodes,ids){const result=new Set(ids);let changed=true;while(changed){changed=false;for(const n of nodes){if(n.parentId&&result.has(n.parentId)&&!result.has(n.id)){result.add(n.id);changed=true;}if(n.type==='pile'&&result.has(n.id))for(const id of n.memberIds||[])if(!result.has(id)){result.add(id);changed=true;}}}return result;}
function sameMembers(actual,expected){assert.equal(actual.size,expected.size);for(const id of expected)assert.ok(actual.has(id),`missing descendant ${String(id)}`);}

test('descendants preserve parent/pile reachability through missing IDs, duplicate records and cycles',()=>{
 const nodes=[
  {id:'leaf',parentId:'missing'},
  {id:'cycle-b',type:'pile',parentId:'cycle-a',memberIds:['root','missing','missing']},
  {id:'cycle-a',type:'pile',memberIds:['cycle-b']},
  {id:'root',type:'pile',memberIds:['cycle-a','absent']},
  {id:'root',type:'pile',memberIds:['extra']},
  {id:'orphan',parentId:'unselected'},
  {id:'false-parent',parentId:0},
  {id:'empty-parent',parentId:''},
  {id:0,type:'pile',memberIds:['zero-member']},
  {id:'self',parentId:'self',type:'pile',memberIds:['self']},
 ];
 for(const seeds of [[],['root'],['missing'],['cycle-b','root'],['self'],[0,''],['unselected'],['unknown']])sameMembers(G.descendants(nodes,seeds),reference(nodes,seeds));
 assert.equal(G.descendants(nodes,[0]).has('false-parent'),false);
 assert.equal(G.descendants(nodes,[0]).has('zero-member'),true);
});

test('mixed shuffled graphs match the fixed-point result for all seed sets',()=>{
 let randomState=72419;
 const random=n=>{randomState=(Math.imul(randomState,1664525)+1013904223)>>>0;return randomState%n;};
 for(let run=0;run<80;run++){
  const nodes=Array.from({length:45},(_,i)=>({id:`n${i}`,parentId:random(4)?`n${random(52)}`:undefined,type:random(3)?'image':'pile',memberIds:Array.from({length:random(5)},()=>`n${random(52)}`)}));
  for(let i=nodes.length-1;i>0;i--){const j=random(i+1);[nodes[i],nodes[j]]=[nodes[j],nodes[i]];}
  const before=JSON.stringify(nodes);
  for(let i=0;i<8;i++){const seeds=Array.from({length:random(5)},()=>`n${random(52)}`);sameMembers(G.descendants(nodes,seeds),reference(nodes,seeds));}
  assert.equal(JSON.stringify(nodes),before);
 }
});

test('positions keep node order and fractional coordinates so translation and snap anchors are unchanged',()=>{
 const nodes=[
  {id:'leaf',parentId:'missing',x:53284.3125,y:-32.875},
  {id:'other',x:22.125,y:10.25},
  {id:'root',type:'pile',memberIds:['missing','leaf'],x:80.0625,y:100.5},
  {id:'child',parentId:'root',x:99.625,y:120.375},
 ];
 const snapshot=G.positions(nodes,['root','child']);
 assert.deepEqual(snapshot,[nodes[0],nodes[2],nodes[3]].map(({id,x,y})=>({id,x,y})));
 const oldSnapshot=nodes.filter(n=>reference(nodes,['root','child']).has(n.id)).map(({id,x,y})=>({id,x,y}));
 for(const snap of [false,true]){
  const current=structuredClone(nodes),expected=structuredClone(nodes);
  G.translate(current,snapshot,13.8125,-8.5625,snap);G.translate(expected,oldSnapshot,13.8125,-8.5625,snap);
  assert.deepEqual(current,expected);
 }
});

test('reverse-ordered deep groups visit each parent once and avoid recursion limits',()=>{
 const count=12000;let parentReads=0;
 const nodes=Array.from({length:count},(_,i)=>({id:`n${count-i}`,get parentId(){parentReads++;return`n${count-i-1}`;},type:'group'}));
 const result=G.descendants(nodes,['n0']);
 assert.equal(result.size,count+1);assert.ok(result.has(`n${count}`));
 assert.equal(parentReads,count);
});
