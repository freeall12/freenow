'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
test('a project switch during recovered materialization creates no late nodes',async()=>{
 const {importRecoveredOutputs}=await import('../../generation-results/recovery.mjs');let current=true,creates=0,saves=0;
 const job={id:'task',status:'succeeded',request:{kind:'audio.generate',nodeId:'source'},outputs:[{type:'audio',url:'https://media.example/a.mp3'}]},app={getState:()=>({nodes:[{id:'source'}]}),createConnected:()=>{creates++;return [{id:'output'}];}};
 await assert.rejects(importRecoveredOutputs(job,{app,guard:()=>{if(!current)throw Error('project changed');},validateMedia:async()=>{},localizeAudio:async()=>{current=false;return 'asset:audio';},persist:()=>saves++}),/project changed/);assert.equal(creates,0);assert.equal(saves,0);assert.equal(job.resultIds,undefined);
});
test('guarded recovery save retry retains existing result IDs and never creates again',async()=>{
 const {importRecoveredOutputs}=await import('../../generation-results/recovery.mjs');let creates=0,saves=0,current=true;const nodes=[{id:'source'}],job={id:'task',status:'succeeded',request:{kind:'video.depth',nodeId:'source'},outputs:[{type:'video',url:'data:video/mp4;base64,AAAA'}]},app={getState:()=>({nodes}),createConnected:(_id,outputs)=>{creates++;const created=outputs.map(output=>({...output,id:'output'}));nodes.push(...created);return created;}};
 const options={app,guard:()=>{if(!current)throw Error('project changed');},validateMedia:async()=>{},persist:async()=>{if(++saves===1)throw Error('save failed');}};
 await assert.rejects(importRecoveredOutputs(job,options),/save failed/);assert.deepEqual(job.resultIds,['output']);assert.equal(creates,1);current=false;await assert.rejects(importRecoveredOutputs(job,options),/project changed/);assert.equal(saves,1);current=true;await importRecoveredOutputs(job,options);assert.equal(creates,1);assert.equal(saves,2);
});
test('recovered plan stops after a late decode guard failure before persistence',async()=>{
 const {applyRecoveredPlan}=await import('../../generation-results/recovery.mjs');let current=true,mutations=0,saves=0;const job={id:'task'},options={app:{getState:()=>({nodes:[]})},guard:()=>{if(!current)throw Error('project changed');},validateMedia:async()=>{current=false;},workflow:{has:()=>true,apply:async(_job,validate)=>{await validate({type:'video'});mutations++;return ['output'];}},persist:()=>saves++};
 await assert.rejects(applyRecoveredPlan(job,options),/project changed/);assert.equal(mutations,0);assert.equal(saves,0);
});
