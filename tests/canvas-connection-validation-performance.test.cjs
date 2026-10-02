const test=require('node:test'),assert=require('node:assert/strict');
const geometry=()=>import('../src/features/canvas-connections/geometry.mjs');

test('drag validation resolves many incoming references in one node pass',async()=>{
 const {validateConnection}=await geometry();let reads=0;
 const count=4000,references=128;
 const nodes=Array.from({length:count},(_,i)=>({get id(){reads++;return`n${i}`;},type:i===1?'video':'image'}));
 const edges=Array.from({length:references},(_,i)=>({source:`n${count-1-i}`,target:'n1'}));
 assert.equal(validateConnection(nodes,edges,'n0','n1'),'参考素材数量超过视频模型支持范围');
 assert.ok(reads<count+references*4+10,`expected linear node reads, got ${reads}`);
 // The previous per-edge find loop is the hot-path baseline, not a timing gate.
 reads=0;const before=edges.map(edge=>nodes.find(node=>node.id===edge.source)).filter(Boolean);
 assert.equal(before.length,references);assert.ok(reads>count*references*.9);
});

test('text references return without traversing unrelated incoming nodes',async()=>{
 const {validateConnection}=await geometry();let reads=0;
 const nodes=[{id:'source',type:'text'},{id:'target',type:'video'},...Array.from({length:2000},(_,i)=>({get id(){reads++;return`ref${i}`;},type:'image'}))];
 const edges=Array.from({length:128},(_,i)=>({source:`ref${1999-i}`,target:'target'}));
 assert.equal(validateConnection(nodes,edges,'source','target'),null);assert.equal(reads,0);
 edges.push({source:'source',target:'target'});assert.equal(validateConnection(nodes,edges,'source','target'),'这两个节点已经连接');
});

test('incoming lookup retains duplicate references, missing references and first matching duplicate ID',async()=>{
 const {validateConnection}=await geometry();
 const nodes=[{id:'source',type:'image'},{id:'target',type:'audio',audioConfig:{model:'mixed'}},{id:'ref',type:'image'},{id:'ref',type:'audio'}];
 const edges=[{source:'ref',target:'target'},{source:'missing',target:'target'},{source:'ref',target:'target'}];
 const specs={mixed:{images:3,audios:2,mixed:false}};
 assert.equal(validateConnection(nodes,edges,'source','target',specs),null,'first matching ref is image, not the later audio');
 assert.equal(validateConnection(nodes,edges,'source','target',{mixed:{images:2,audios:2,mixed:false}}),'当前音频模型不支持该参考素材，或已达到数量上限','two edges still count twice');
 for(const incoming of [[],[edges[0]],[edges[1]],[edges[0],edges[1]]])assert.equal(validateConnection(nodes,incoming,'source','target',specs),null);
 nodes.push({id:NaN,type:'audio'});assert.equal(validateConnection(nodes,[...edges,{source:NaN,target:'target'}],'source','target',specs),null,'NaN never matched the original strict-equality find');
});

test('indexed input resolution matches the old find-based audio validation across shuffled mixed graphs',async()=>{
 const {validateConnection}=await geometry();let seed=82619;
 const random=n=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n;};
 for(let run=0;run<400;run++){
  const source={id:'source',type:['image','video','audio'][random(3)]};
  const target={id:'target',type:'audio',audioConfig:{model:'test'}};
  const references=Array.from({length:30},()=>({id:`ref${random(24)}`,type:['image','video','audio','text'][random(4)]}));
  const nodes=[source,target,...references],edges=Array.from({length:random(12)},()=>({source:`ref${random(32)}`,target:random(4)?'target':'other'}));
  const spec={images:random(8),audios:random(8),video:!!random(2),mixed:!!random(2)};
  const inputs=edges.filter(edge=>edge.target==='target').map(edge=>nodes.find(node=>node.id===edge.source)).filter(Boolean);
  const count=type=>inputs.filter(node=>node.type===type).length;
  const max=source.type==='image'?spec.images||0:source.type==='audio'?spec.audios||0:source.type==='video'&&spec.video?1:0;
  const expected=count(source.type)>=max?'当前音频模型不支持该参考素材，或已达到数量上限':spec.mixed===false&&(source.type==='image'&&count('audio')||source.type==='audio'&&count('image'))?'参考图片和参考音频不能混用':null;
  assert.equal(validateConnection(nodes,edges,'source','target',{test:spec}),expected);
 }
});
