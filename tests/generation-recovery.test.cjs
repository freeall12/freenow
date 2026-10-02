const test=require('node:test'),assert=require('node:assert/strict');
const {TaskService,httpProvider}=require('../generation-api.js');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;return{promise:new Promise(done=>resolve=done),resolve:value=>resolve(value)};};
const reply=value=>({ok:true,json:async()=>value});
const request={kind:'text.generate',nodeId:'original-node',prompt:'原始请求'};
const result={outputs:[{type:'text',text:'实际结果'}]};
const remote={id:'remote/task',request,status:'running',progress:10};
const unknown=id=>({id,request:structuredClone(request),status:'unknown',createdAt:1,controller:new AbortController()});

test('cancel during recovery lookup blocks late restoration for existing and not-yet-restored jobs',async()=>{
 for(const existing of [false,true]){
  const service=new TaskService(),gate=deferred();let resumes=0,restores=0;
  service.setProvider({generate:async()=>assert.fail('must not submit'),lookup:()=>gate.promise,resume:async()=>{resumes++;return result;}});
  if(existing)service.jobs.set('local-key',unknown('local-key'));
  const pending=service.recover('local-key',{beforeRestore:()=>restores++});await tick();
  const rejected=assert.rejects(pending,{name:'AbortError'}),receipt=service.cancel('local-key');gate.resolve(remote);await rejected;await tick();
  assert.equal(receipt.status,'cancelled');assert.equal(restores,0);assert.equal(resumes,0);
  assert.equal(service.jobs.get('local-key')?.status,existing?'cancelled':undefined);assert.equal(service.recoveries.size,0);
 }
});

test('concurrent recoveries share one lookup, restore transaction and resume consumer',async()=>{
 const service=new TaskService(),gate=deferred(),completion=deferred();let lookups=0,restores=0,resumes=0,successes=0;
 service.setProvider({generate:async()=>assert.fail('must not submit'),lookup:()=>{lookups++;return gate.promise;},resume:()=>{resumes++;return completion.promise;}});
 service.subscribe(job=>{if(job.status==='succeeded')successes++;});
 const a=service.recover('local-key',{beforeRestore:()=>restores++}),b=service.recover('local-key',{beforeRestore:()=>restores++});assert.equal(a,b);
 gate.resolve(remote);const [first,second]=await Promise.all([a,b]);assert.equal(first,second);assert.equal(service.jobs.get('local-key'),first);
 assert.deepEqual([lookups,restores,resumes],[1,1,1]);completion.resolve(result);await tick();assert.equal(successes,1);
});

test('recovered success validates outputs before restore or success events',async()=>{
 for(const outputs of [undefined,[],[{type:'image',url:'javascript:alert(1)'}],[{type:'text',text:'   '}],[{type:'video',image:'https://example.test/poster.png'}]]){
  const service=new TaskService();let restores=0,events=0;
  service.setProvider({generate:async()=>assert.fail(),lookup:async()=>({...remote,status:'succeeded',outputs})});service.subscribe(()=>events++);
  await assert.rejects(()=>service.recover('local-key',{beforeRestore:()=>restores++}));assert.equal(service.jobs.size,0);assert.equal(events,0);assert.equal(restores,0);
 }
});

test('HTTP unknown submission retains its idempotency key and original prepared request; recovery is GET-only',async()=>{
 const calls=[],input=structuredClone(request);let prepared=0,posted;
 const service=new TaskService({prepareRequest:async value=>{prepared++;return{...value,preparedAt:'original'};}});
 service.setProvider(httpProvider({baseUrl:'https://gateway.test/api',recoverable:true,fetchImpl:async(url,options)=>{
  calls.push({url,method:options.method||'GET',headers:options.headers,body:options.body});
  if(options.method==='POST'){posted=JSON.parse(options.body);throw Error('response lost after submit');}
  if(url.includes('/by-key/'))return reply({...remote,id:'gateway/task',request:posted});
  return reply({...result,status:'succeeded',id:'gateway/task'});
 }}));
 const job=service.submit(input);input.prompt='later edit';await tick();assert.equal(job.status,'unknown');assert.equal(calls[0].headers['Idempotency-Key'],job.id);assert.equal(posted.prompt,'原始请求');
 assert.throws(()=>service.retry(job.id),/不能重复生成/);await service.recover(job.id);await tick();
 assert.equal(job.status,'succeeded');assert.equal(prepared,1);assert.deepEqual(job.request,posted);assert.deepEqual(calls.map(call=>call.method),['POST','GET','GET']);
 assert.equal(calls[1].url,'https://gateway.test/api/tasks/by-key/'+job.id);assert.equal(calls[2].url,'https://gateway.test/api/tasks/gateway%2Ftask');assert.equal(calls[2].body,undefined);
});

test('recoverable timeout reports unknown without DELETE or a replacement POST',async()=>{
 const calls=[],provider=httpProvider({baseUrl:'https://gateway.test',recoverable:true,cancelRemote:true,pollInterval:10000,timeout:10,fetchImpl:async(url,options)=>{calls.push(options.method||'GET');return reply({id:'task',status:'running'});}});
 const controller=new AbortController();
 await assert.rejects(()=>provider.generate(request,{jobId:'stable-key',signal:controller.signal}),error=>error.code==='unknown'&&error.recovery.pollable===true);
 assert.equal(controller.signal.aborted,false);assert.deepEqual(calls,['POST']);
});

test('explicit cancellation of a dispatched recoverable TaskService job sends one DELETE and blocks late output',async()=>{
 const calls=[],service=new TaskService();service.setProvider(httpProvider({baseUrl:'https://gateway.test',recoverable:true,cancelRemote:true,pollInterval:10000,fetchImpl:async(url,options)=>{
  calls.push({url,method:options.method||'GET'});return reply(options.method==='DELETE'?{id:'task',status:'cancelled'}:{id:'task',status:'running'});
 }}));
 const job=service.submit(request);await tick();const receipt=service.cancel(job.id);await tick();
 assert.equal(receipt.providerCancellation,'unconfirmed');assert.equal(job.status,'cancelled');assert.equal(job.outputs,undefined);assert.deepEqual(calls.map(call=>call.method),['POST','DELETE']);assert.equal(calls[1].url,'https://gateway.test/tasks/task');
});

test('failed beforeRestore leaves an unknown job recoverable rather than stranding it as running',async()=>{
 const service=new TaskService();let lookups=0,resumes=0;
 service.setProvider({generate:async()=>assert.fail(),lookup:async()=>{lookups++;return remote;},resume:async()=>{resumes++;return result;}});
 service.jobs.set('local-key',unknown('local-key'));
 await assert.rejects(()=>service.recover('local-key',{beforeRestore:()=>{throw Error('snapshot mismatch');}}),/snapshot mismatch/);
 assert.equal(service.jobs.get('local-key').status,'unknown');await service.recover('local-key');await tick();
 assert.equal(lookups,2);assert.equal(resumes,1);assert.equal(service.jobs.get('local-key').status,'succeeded');
});

test('gateway rejects unsupported recovery methods before invoking durable lookup or polling',async()=>{
 const durablePath=require.resolve('../server/generation-durable.cjs'),gatewayPath=require.resolve('../server/generation.cjs');
 const oldDurable=require.cache[durablePath],oldGateway=require.cache[gatewayPath];let reads=0;
 require.cache[durablePath]={id:durablePath,filename:durablePath,loaded:true,exports:{createDurableGenerationService:()=>({ready:Promise.resolve(),get:async()=>{reads++;assert.fail('must not poll');},lookup:async()=>{reads++;assert.fail('must not lookup');}})}};
 delete require.cache[gatewayPath];
 try{
  const gateway=require(gatewayPath).createGenerationGateway({directory:'/unused-recovery-fixture',mediaMaterializer:{localize:async()=>assert.fail('must not localize'),verify:async()=>assert.fail('must not verify')}});
  for(const pathname of ['/api/generation/tasks/existing','/api/generation/tasks/by-key/stable-key'])for(const method of ['POST','PUT','PATCH']){
   let status;await gateway.handle({method},{},pathname,{json:(_,value)=>{status=value;},body:async()=>({})});assert.equal(status,405);
  }
  assert.equal(reads,0);
 }finally{
  if(oldDurable)require.cache[durablePath]=oldDurable;else delete require.cache[durablePath];
  if(oldGateway)require.cache[gatewayPath]=oldGateway;else delete require.cache[gatewayPath];
 }
});

test('Agent abort signal stops recovery observation without cancelling the durable provider task',async()=>{
 const service=new TaskService(),abort=new AbortController();let release,cancelled=0;
 service.setProvider({generate:async()=>{},lookup:()=>new Promise(resolve=>release=resolve),cancel:async()=>{cancelled++;}});
 const pending=service.recover('agent-recovery',{signal:abort.signal});await new Promise(resolve=>setImmediate(resolve));abort.abort();
 release({id:'remote',status:'succeeded',request:{kind:'text.generate'},outputs:[{type:'text',text:'retained'}]});
 await assert.rejects(pending,{name:'AbortError'});assert.equal(service.jobs.size,0);assert.equal(cancelled,0);
});
