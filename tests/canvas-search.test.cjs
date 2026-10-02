const test=require('node:test'),assert=require('node:assert/strict');const Search=require('../src/features/canvas-search/core.js');
test('node search indexes prompts, text, drafts and World studios without hidden nodes',()=>{const nodes=[{id:'a',type:'image',title:'未命名',params:{prompt:'城市夜景'}},{id:'b',type:'text',title:'文档',content:'摄影机沿河移动'},{id:'c',type:'studio',title:'3D 片场'},{id:'d',type:'audio',title:'hidden',hidden:true}];const index=Search.index(nodes,{a:{prompt:'清晨雨林'}});assert.equal(index.length,3);assert.equal(Search.query(index,'清晨')[0].document.node.id,'a');assert.equal(Search.query(index,'夜景')[0].document.node.id,'a');assert.equal(Search.query(index,'沿河')[0].document.node.id,'b');assert.equal(Search.query(index,'','world')[0].document.node.id,'c');assert.equal(Search.query(index,'','audio').length,0);});
test('search ranking supports Unicode normalization, word initials, typos and cross-field terms',()=>{const index=Search.index([{id:'a',type:'image',title:'CafeCamera',prompt:'夜景 红色'},{id:'b',type:'image',title:'Café camera closeup'},{id:'c',type:'video',title:'Slow Motion'},{id:'d',type:'image',title:'Camera'}]);assert.equal(Search.query(index,'camera')[0].document.node.id,'d');assert.equal(Search.query(index,'SM')[0].document.node.id,'c');assert.equal(Search.query(index,'camra')[0].document.node.id,'d');assert.equal(Search.query(index,'Café 红色')[0].document.node.id,'a');assert.equal(Search.normalize('CaféCamera_test-file'),'cafe camera test file');});
test('empty query groups node types deterministically and limits results to thirty',()=>{const nodes=Array.from({length:40},(_,i)=>({id:String(i),type:i%2?'image':'video',title:'Node '+i})),results=Search.query(Search.index(nodes));assert.equal(results.length,30);assert.equal(results[0].document.node.type,'image');assert.equal(results[20].document.node.type,'video');});
test('search fit matches measured source geometry and accounts for reduced canvas width',()=>{
 const bounds={x:53284.3,y:-2180.48,width:375,height:250};
 for(const [viewport,expected]of [[{width:889,height:1011},{x:115,y:285.8333333333,width:659}],[{width:491,height:809},{x:63,y:282.8333333333,width:365}]]){
  const view=Search.fit(bounds,viewport);
  assert.ok(Math.abs(bounds.x*view.scale+view.x-expected.x)<1e-8);
  assert.ok(Math.abs(bounds.y*view.scale+view.y-expected.y)<1e-8);
  assert.ok(Math.abs(bounds.width*view.scale-expected.width)<1e-8);
 }
});
