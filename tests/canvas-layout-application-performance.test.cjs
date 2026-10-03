const test=require('node:test'),assert=require('node:assert/strict');
const {current:G,legacy,measure}=require('../src/features/canvas-layout/qa/measure.cjs'),dagre=require('../assets/dagre-local.js');
function compare(seed,ids,mode='grid',edges=[]){
  const actual=structuredClone(seed),expected=structuredClone(seed);
  const result=G.layout(actual,edges,ids,mode,dagre),before=legacy.layout(expected,edges,ids,mode,dagre);
  assert.equal(JSON.stringify(result),JSON.stringify(before));assert.deepEqual(actual,expected);
  return actual;
}
const node=(id,type='image',patch={})=>({id,type,x:53240.125,y:-2697.875,width:320.125,height:180.25,...patch});

test('1000-node selection performs linear coordinate application instead of rebuilding the graph for every node',()=>{
  const before=measure(legacy,1000,1),after=measure(G,1000,1);
  assert.equal(before.rows[0].idReads,2006000);assert.equal(after.rows[0].idReads,8000);
  const seed=Array.from({length:1000},(_,i)=>node('n'+i,'image',{x:53240.125+i*31.125,y:-2697.875-i*20.375}));
  compare(seed,seed.map(item=>item.id));
});

test('mixed pile and selected member retain current sequential snapshots, missing ownership links and graph order',()=>{
  for(const reverse of [false,true]){
    const seed=[node('pile','pile',{memberIds:['a','b','missing']}),node('a'),node('b','text',{parentId:'missing',x:53000.375}),node('child','video',{parentId:'missing',x:54000.25}),node('outside','audio',{x:70000.875})];
    if(reverse)seed.reverse();
    const actual=compare(seed,['pile','a']);assert.deepEqual(actual.find(item=>item.id==='outside'),seed.find(item=>item.id==='outside'));
  }
});

test('single group layout moves nested groups, cycles and pile descendants with the original fractional coordinates',()=>{
  const seed=[node('root','group'),node('nested','group',{parentId:'root'}),node('a','image',{parentId:'nested'}),node('pile','pile',{parentId:'root',memberIds:['b','missing']}),node('b','text'),node('leaf','video',{parentId:'missing'}),node('cycle','text',{parentId:'cycle'})];
  compare(seed,['root']);compare(seed,['root'],'horizontal',[{source:'nested',target:'pile'}]);
  compare(seed,['pile','cycle']);
});

test('duplicate records keep the legacy graph order and last-ID translation target',()=>{
  const seed=[node('a'),node('a','text',{x:51000.375}),node('pile','pile',{memberIds:['a','b']}),node('b','video',{x:53000.625})];
  compare(seed,['pile','a','a','missing']);
});

test('each layout builds fresh ownership after an undo replacement or in-place membership change',()=>{
  const seed=[node('pile','pile',{memberIds:['a','b']}),node('a'),node('b'),node('c','text')];
  compare(seed,['pile']);seed[0].memberIds=['b','c'];delete seed[1].parentId;seed[3].parentId='a';compare(seed,['pile','a']);
  const restored=structuredClone(seed);restored[0].memberIds=['a','c'];compare(restored,['pile']);
});

test('shuffled mixed graphs match the prior coordinate loop without changing grid definitions or outside nodes',()=>{
  let state=521783;const random=max=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state%max;};
  for(let run=0;run<180;run++){
    const count=2+random(30),seed=Array.from({length:count},(_,i)=>node('n'+i,['image','text','video','audio','pile','group'][random(6)],{x:53240.125+random(1500)*.375,y:-2697.875-random(1200)*.125,width:100+random(100)*.125,height:80+random(100)*.375}));
    for(const item of seed){if(random(3)===0)item.parentId='n'+random(count+2);if(item.type==='pile')item.memberIds=Array.from({length:random(4)},()=> 'n'+random(count+2));}
    seed.sort(()=>random(3)-1);const ids=seed.filter(item=>item.type!=='group'&&random(2)).map(item=>item.id);
    if(!ids.length)ids.push(seed.find(item=>item.type!=='group')?.id||seed[0].id);
    compare(seed,ids);
  }
});
