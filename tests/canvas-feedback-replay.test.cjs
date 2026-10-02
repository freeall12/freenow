const test=require('node:test');
const assert=require('node:assert/strict');
const {createReplayRecorder}=require('../feedback.js');
const fixture=(count=3)=>({nodes:Array.from({length:count},(_,i)=>({id:`n${i}`,type:'image',title:`图片 ${i}`,x:52000.25+i*320,y:-2400.5,width:320,height:180})),view:{x:10.25,y:20.5,scale:.7},selected:[]});

test('moving one node preserves previous replay coordinates and shares unchanged snapshots',()=>{
 const state=fixture(500),r=createReplayRecorder();r.record(state,false,1);
 const first=r.frames[0];state.nodes[300].x+=53/.7;r.record(state,false,2);
 const second=r.frames[1];assert.equal(first.nodes[300].x,52000.25+300*320);
 assert.equal(second.nodes[300].x,state.nodes[300].x);
 assert.equal(second.nodes.filter((n,i)=>n===first.nodes[i]).length,499);
 state.nodes[300].title='后来修改';assert.equal(second.nodes[300].title,'图片 300');
});
test('idle full renders add no frame; view and selection transitions remain independent snapshots',()=>{
 const state=fixture(),r=createReplayRecorder();r.record(state,false,1);
 for(let i=0;i<100;i++)r.record(state,false,i+2);assert.equal(r.frames.length,1);
 state.view.x+=.125;r.record(state,true,102);state.selected.push('n1');r.record(state,false,103);
 assert.equal(r.frames.length,3);assert.equal(r.frames[1].nodes,r.frames[0].nodes);
 assert.equal(r.frames[2].nodes,r.frames[0].nodes);assert.equal(r.frames[0].view.x,10.25);
 assert.deepEqual(r.frames[1].selected,[]);assert.deepEqual(r.frames[2].selected,['n1']);
});
test('reorder, deletion, addition and undo objects record exact ordered metadata',()=>{
 const state=fixture(),r=createReplayRecorder();const original=structuredClone(state.nodes);r.record(state);
 state.nodes.reverse();r.record(state);assert.deepEqual(r.frames.at(-1).nodes,state.nodes);
 state.nodes.pop();r.record(state);assert.equal(r.frames.at(-1).nodes.length,2);
 state.nodes.push({...original[0],id:'added'});r.record(state);assert.equal(r.frames.at(-1).nodes.at(-1).id,'added');
 state.nodes=structuredClone(original);r.record(state);assert.deepEqual(r.frames.at(-1).nodes,original);
 state.nodes=[];r.record(state);assert.deepEqual(r.frames.at(-1).nodes,[]);
 assert.deepEqual(r.frames[0].nodes,original);
});
test('each recorded metadata field invalidates its snapshot; provider details are not copied',()=>{
 for(const [key,value]of Object.entries({id:'changed',type:'video',title:'新标题',x:10.125,y:-123.5,width:640,height:360})){
  const state=fixture(),r=createReplayRecorder();state.nodes[0].generation={prompt:'private'};
  r.record(state);state.nodes[0][key]=value;r.record(state);
  assert.equal(r.frames.length,2,key);assert.equal(r.frames[1].nodes[0][key],value);
  assert.equal('generation' in r.frames[1].nodes[0],false);
 }
});
test('first viewport frame captures nodes and the replay remains bounded across long gestures',()=>{
 const state=fixture(500),r=createReplayRecorder();r.record(state,true,0);
 for(let i=1;i<=180;i++){state.nodes[0].x+=.125;r.record(state,false,i);}
 assert.equal(r.frames.length,80);assert.equal(r.frames[0].at,101);
 assert.equal(new Set(r.frames.flatMap(f=>f.nodes)).size,579);
 assert.equal(r.frames.at(-1).nodes[0].x,52000.25+180*.125);
});
