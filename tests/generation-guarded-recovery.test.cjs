const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {TaskService}=require('../generation-api.js');

const source=fs.readFileSync(path.join(__dirname,'../generation-ui.js'),'utf8');
const recovery=source.slice(source.indexOf('  async function recover(id,'),source.indexOf('  async function applyRecovered('));
const approved={kind:'image.skin',parameters:{mode:'standard'}};
function harness({request=approved}={}){
  let lookup=0,emissions=0;
  const service=new TaskService(),controller=new AbortController();
  service.provider={generate:()=>assert.fail('Recovery must not generate'),lookup:async()=>{lookup++;return {id:'original',request:structuredClone(request),status:'succeeded',outputs:[{type:'image',url:'/api/generation/media/10050000-0000-4000-8000-000000000001'}]};}};
  service.jobs.set('original',{id:'original',request:structuredClone(approved),status:'unknown',controller});
  service.subscribe(()=>emissions++);
  const recover=vm.runInNewContext(recovery+';recover',{service,DOMException});
  return {service,recover,counts:()=>({lookup,emissions})};
}

test('guarded recovery rejects a changed persisted mode before restoring or emitting success',async()=>{
  const h=harness({request:{kind:'image.skin',parameters:{mode:'heavy'}}});
  await assert.rejects(h.recover('original',{verifyRequest:request=>JSON.stringify(request)===JSON.stringify(approved)}),/原任务请求已变化/);
  assert.equal(h.service.jobs.get('original').status,'unknown');
  assert.deepEqual(h.service.jobs.get('original').request,approved);
  assert.deepEqual(h.counts(),{lookup:1,emissions:0});
});

test('guarded recovery checks source and request again after asynchronous approval',async()=>{
  const h=harness();let valid=true;
  await assert.rejects(h.recover('original',{guard:()=>{if(!valid)throw Error('source changed');},verifyRequest:async()=>{valid=false;return true;}}),/source changed/);
  assert.deepEqual(h.counts(),{lookup:1,emissions:0});
  const mutated=harness();
  await assert.rejects(mutated.recover('original',{verifyRequest:async request=>{request.parameters.mode='heavy';return true;}}),/验证期间已变化/);
  assert.equal(mutated.service.jobs.get('original').status,'unknown');
});

test('guarded recovery cannot inherit another pending lookup without its validation',async()=>{
  const h=harness();let release;
  h.service.provider.lookup=()=>new Promise(resolve=>{release=resolve;});
  const existing=h.recover('original');await Promise.resolve();await Promise.resolve();
  await assert.rejects(h.recover('original',{verifyRequest:()=>assert.fail('must not join a foreign lookup')}),/正在查询/);
  let guardChecks=0;
  await assert.rejects(h.recover('original',{guard:()=>{guardChecks++;}}),/正在查询/);
  assert.equal(guardChecks,1);
  release({id:'original',request:approved,status:'unknown'});await existing;
  assert.equal(h.service.jobs.get('original').status,'unknown');
});

test('matching guarded recovery emits once and keeps the same task identity without submission',async()=>{
  const h=harness();let checked=0;
  const job=await h.recover('original',{guard:()=>{checked++;},verifyRequest:request=>JSON.stringify(request)===JSON.stringify(approved)});
  assert.equal(job.id,'original');assert.equal(job.status,'succeeded');assert(checked>=3);
  assert.deepEqual(h.counts(),{lookup:1,emissions:1});
});

// Exercise the production guard before the custom-application branch. This is
// separate from durable workflow beforeApply and protects task-tray recovery.
const application=source.slice(source.indexOf('      if(target?.verifyRequest){'),source.indexOf('      if(target&&!stored.resultIds){'));
const checkApplication=vm.runInNewContext('(async(target,job)=>{'+application+'})');
test('custom result applications validate the prepared request even when recovery came from the task tray',async()=>{
  let calls=0;const job={request:structuredClone(approved)};
  const target={guard:()=>{calls++;},verifyRequest:request=>request.parameters.mode==='standard'};
  await checkApplication(target,job);assert.equal(calls,2);
  job.request.parameters.mode='heavy';
  await assert.rejects(checkApplication(target,job),/原任务请求已变化/);
  job.request.parameters.mode='standard';target.verifyRequest=async request=>{request.parameters.mode='detailed';return true;};
  await assert.rejects(checkApplication(target,job),/验证期间已变化/);
});
