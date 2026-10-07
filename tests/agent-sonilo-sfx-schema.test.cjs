'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),tools=require('../agent-tools.js');
const base={kind:'audio.generate',nodeId:'audio',model:'sonilo',audioScene:'Sound',prompt:'',referenceIds:['video'],duration:8,count:1,segments:[{start:0,end:2.5,prompt:'木门打开'},{start:2.5,end:8,prompt:'室内脚步'}]};
test('Agent Sound schema preserves fractional contiguous intervals and the full native video duration',()=>{
 assert.deepEqual(tools.parse('generation_submit',base).args,base);
 const long={...base,duration:480,segments:[{start:0,end:480,prompt:'风吹树叶'}]};assert.deepEqual(tools.parse('generation_submit',long).args,long);
 for(const model of ['sonilo-music','sonilo-sfx'])assert.equal(tools.parse('generation_submit',{...base,model}).args.model,model);
 for(const change of [{count:2},{referenceIds:[]},{duration:7},{audioScene:'Music'},{model:'other'},{segments:[{start:0,end:8,prompt:'  '}]},{segments:[{start:0,end:8,prompt:'声响',label:'intro'}]},{segments:[{start:0,prompt:'声响'}]},{segments:[{start:0,end:0,prompt:'声响'}]},{segments:[{start:0,end:2.5,prompt:'声响'},{start:2.6,end:8,prompt:'风'}]},{segments:[{start:0,end:3,prompt:'声响'},{start:2.5,end:8,prompt:'风'}]}])assert.throws(()=>tools.parse('generation_submit',{...base,...change}));
});
test('Agent Music retains its prior segment contract and other generation keeps its duration bound',()=>{
 const music={...base,audioScene:'Music',duration:10,segments:[{start:0,label:'intro',prompt:'弦乐'},{start:5,prompt:'鼓声'}]};
 assert.deepEqual(tools.parse('generation_submit',music).args.segments,music.segments);
 for(const change of [{duration:480},{segments:[{start:0,end:10,prompt:'弦乐'}]},{segments:[{start:0,prompt:'弦乐'},{start:4.9,prompt:'鼓声'}]}])assert.throws(()=>tools.parse('generation_submit',{...music,...change}));
 assert.throws(()=>tools.parse('generation_submit',{kind:'video.generate',nodeId:'video',prompt:'scene',duration:480}));
});
test('subsecond duration is accepted only for a matching Sonilo Sound instruction',()=>{
 const text={kind:'audio.generate',nodeId:'audio',model:'sonilo',audioScene:'Sound',prompt:'玻璃轻响',referenceIds:[],count:1};
 for(const model of ['sonilo','sonilo-music','sonilo-sfx'])for(const duration of [.5,.75])assert.equal(tools.parse('generation_submit',{...text,model,duration}).args.duration,duration);
 const implicit={...text,model:'sonilo-sfx',duration:.5};delete implicit.audioScene;assert.equal(tools.parse('generation_submit',implicit).args.duration,.5);
 for(const patch of [{duration:.499},{count:2,duration:2},{model:'elevenlabs',duration:.75},{model:'other',duration:.5},{model:undefined,duration:.5},{audioScene:'Music',duration:.75},{audioScene:'Text-to-Speech',duration:.5},{model:'sonilo-sfx',audioScene:'Music',duration:2},{model:'sonilo-sfx',audioScene:'Text-to-Speech',duration:2},{kind:'video.generate',duration:.75}]){const args={...text,...patch};if(args.model===undefined)delete args.model;assert.throws(()=>tools.parse('generation_submit',args),JSON.stringify(patch));}
 assert.equal(tools.parse('generation_submit',{...text,model:'elevenlabs',duration:1}).args.duration,1);
});
