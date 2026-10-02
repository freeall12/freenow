const test=require('node:test'),assert=require('node:assert/strict');
const {normalize,sync,applyModels}=require('../studio-state.js');
const object={id:'base',kind:'cube',name:'Cube',position:[0,-1.7,0],rotation:[0,0,0],scale:[1,1,1]};
const fixture=()=>normalize({ground:{y:-1.7},objects:[structuredClone(object)],keyframes:[]});
const job={id:'task-1',request:{parameters:{setupId:'example',position:[2,-1.7,3]},prompt:'Chair'},outputs:[{type:'model',url:'https://example.com/chair.glb'}]};
test('delayed model results go to submitted setup without changing current setup or coordinates',()=>{
 const data=fixture();data.setups.push({id:'other',objects:[],keyframes:[]});data.activeSetup='other';data.objects=[];
 const result=applyModels(data,job);assert.equal(result.data.activeSetup,'other');assert.equal(result.data.objects.length,0);
 const model=result.data.setups[0].objects.at(-1);assert.deepEqual(model.position,[2,-1.7,3]);assert.equal(model.sourceUrl,job.outputs[0].url);
 assert.equal(applyModels(result.data,job).data.setups[0].objects.length,2);assert.equal(data.setups[0].objects.length,1);
});
test('baseline edits propagate inherited fields and preserve setup overrides',()=>{
 const data=fixture();data.baseline.objects=[structuredClone(object)];data.setups[0].objects[0].position=[9,-1.7,0];data.activeSetup='baseline';data.objects[0].name='Renamed';data.objects[0].position=[1,-1.7,0];sync(data);
 assert.equal(data.setups[0].objects[0].name,'Renamed');assert.deepEqual(data.setups[0].objects[0].position,[9,-1.7,0]);
 const result=applyModels(data,{...job,request:{parameters:{setupId:'baseline',position:[0,0,0]}}});assert.equal(result.data.objects.length,2);assert.equal(result.data.setups[0].objects.length,2);
});
test('deleted setup or malformed result cannot insert a model elsewhere',()=>{
 assert.throws(()=>applyModels(fixture(),{...job,request:{parameters:{setupId:'deleted'}}}),/已删除/);
 assert.throws(()=>applyModels(fixture(),{...job,outputs:[{type:'model',url:'javascript:alert(1)'}]}),/地址/);
 assert.throws(()=>applyModels(fixture(),{...job,request:{parameters:{position:[NaN,0,0]}}}),/坐标/);
});
