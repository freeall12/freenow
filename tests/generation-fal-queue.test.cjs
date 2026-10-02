const test=require('node:test'),assert=require('node:assert/strict');
const {createFalQueue}=require('../server/generation-fal-queue.cjs');
const response=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
const queue=fetchImpl=>createFalQueue({apiKey:'private-key',fetchImpl});
const model='fal-ai/topaz/upscale/image',id='task-1';
const unknown=error=>error.code==='unknown'&&!error.message.includes('private-key')&&!error.message.includes('provider-secret');

test('submit uses the complete model, Key auth and one POST without response URL authority',async()=>{
 const calls=[],p=queue(async(url,options)=>{calls.push({url,options});return response({request_id:id,status:'IN_QUEUE',status_url:'https://evil.test/status',response_url:'https://evil.test/result',cancel_url:'https://evil.test/cancel'});});
 assert.deepEqual(await p.submit(model,{image_url:'https://media.test/a.png',upscale_factor:2}),{requestId:id,status:'queued'});
 assert.equal(calls.length,1);assert.equal(calls[0].url,'https://queue.fal.run/'+model);
 assert.equal(calls[0].options.method,'POST');assert.equal(calls[0].options.redirect,'error');assert.equal(calls[0].options.headers.Authorization,'Key private-key');
 assert.deepEqual(JSON.parse(calls[0].options.body),{image_url:'https://media.test/a.png',upscale_factor:2});
});

test('poll maps documented states and fetches raw result only from canonical app root after completion',async()=>{
 for(const [native,status]of [['IN_QUEUE','queued'],['IN_PROGRESS','running'],['OTHER','unknown']]){
  let calls=0;assert.deepEqual(await queue(async(url)=>{calls++;assert.equal(url,'https://queue.fal.run/fal-ai/topaz/requests/task-1/status?logs=0');return response({status:native,request_id:id,result:{image:{url:'https://evil.test/unconfirmed.png'}}});}).poll(model,id),{requestId:id,status});assert.equal(calls,1);
 }
 const calls=[],result={image:{url:'https://media.test/result.png',content_type:'image/png',width:2048,height:1024}};
 const p=queue(async(url,options)=>{calls.push({url,options});return response(calls.length===1?{status:'COMPLETED',request_id:id,response_url:'https://evil.test/result'}:result);});
 assert.deepEqual(await p.poll(model,id),{requestId:id,status:'succeeded',result});
 assert.deepEqual(calls.map(call=>call.url),['https://queue.fal.run/fal-ai/topaz/requests/task-1/status?logs=0','https://queue.fal.run/fal-ai/topaz/requests/task-1']);
 assert.ok(calls.every(call=>call.options.method==='GET'&&call.options.redirect==='error'&&call.options.headers.Authorization==='Key private-key'));
});

test('COMPLETED error fields fail without exposing provider error text or querying results',async()=>{
 for(const error of [{error:'provider-secret private-key'},{error_type:'provider-secret'},{error:null}]){
  let calls=0;const p=queue(async()=>{calls++;return response({request_id:id,status:'COMPLETED',...error});});
  assert.deepEqual(await p.poll(model,id),{requestId:id,status:'failed'});assert.equal(calls,1);
 }
 let calls=0;const p=queue(async()=>response(++calls===1?{status:'COMPLETED'}:{error:'provider-secret'}));
 assert.deepEqual(await p.poll(model,id),{requestId:id,status:'failed'});
});

test('submit requires an identity and never claims successful results from a submit receipt',async()=>{
 for(const value of [{status:'IN_QUEUE'},{request_id:''},{request_id:null},{request_id:'\nsecret',status:'IN_QUEUE'}])await assert.rejects(()=>queue(async()=>response(value)).submit(model,{}),{code:'provider_identity_mismatch'});
 assert.deepEqual(await queue(async()=>response({request_id:id,queue_position:0,response_url:'https://evil.test/result',status_url:'https://evil.test/status',cancel_url:'https://evil.test/cancel'})).submit(model,{}),{requestId:id,status:'queued'});
 assert.deepEqual(await queue(async()=>response({request_id:id,error:'provider-secret'})).submit(model,{}),{requestId:id,status:'unknown'});
 assert.deepEqual(await queue(async()=>response({request_id:id,status:'COMPLETED',result:{image:{url:'https://media.test/p.png'}}})).submit(model,{}),{requestId:id,status:'unknown'});
});

test('every supplied status, result and cancellation identity must match the original request',async()=>{
 await assert.rejects(()=>queue(async()=>response({request_id:'other',status:'IN_QUEUE'})).poll(model,id),{code:'provider_identity_mismatch'});
 let calls=0;await assert.rejects(()=>queue(async()=>response(++calls===1?{request_id:id,status:'COMPLETED'}:{request_id:'other',image:{url:'https://media.test/r.png'}})).poll(model,id),{code:'provider_identity_mismatch'});
 await assert.rejects(()=>queue(async()=>response({request_id:'other',status:'CANCELLATION_REQUESTED'},202)).cancel(model,id),{code:'provider_identity_mismatch'});
});

test('documented cancellation receipts never claim the remote task stopped',async()=>{
 for(const [status,native]of [[202,'CANCELLATION_REQUESTED'],[400,'ALREADY_COMPLETED'],[404,'NOT_FOUND']]){
  const p=queue(async(url,options)=>{assert.equal(url,'https://queue.fal.run/fal-ai/topaz/requests/task-1/cancel');assert.equal(options.method,'PUT');assert.equal(options.body,undefined);return response({request_id:id,status:native},status);});
  assert.deepEqual(await p.cancel(model,id),{requestId:id,status:'unknown'});
 }
 for(const [status,native]of [[200,'CANCELLED'],[202,'CANCELLED'],[400,'provider-secret'],[404,'ALREADY_COMPLETED']])await assert.rejects(()=>queue(async()=>response({status:native},status)).cancel(model,id),unknown);
});

test('only valid server HTTPS base, ordinary model paths and bounded identities reach the network',async()=>{
 const forbidden=()=>assert.fail('network must not be called');
 for(const baseUrl of ['http://queue.test','https://user:private-key@queue.test','https://queue.test?x=1','https://queue.test#x','https://queue.test?','https://queue.test#','not a URL'])await assert.rejects(()=>createFalQueue({baseUrl,apiKey:'private-key',fetchImpl:forbidden}).submit(model,{}),unknown);
 for(const apiKey of [undefined,'',' private-key','private-key\n'])await assert.rejects(()=>createFalQueue({apiKey,fetchImpl:forbidden}).submit(model,{}),unknown);
 for(const invalid of ['fal-ai','fal-ai/alias/','fal-ai/alias/../other','workflows/owner/alias','https://evil.test/app','fal-ai/alias?key=private-key','fal-ai/%2e%2e'])await assert.rejects(()=>queue(forbidden).submit(invalid,{}),unknown);
 for(const invalid of ['',null,'..','bad\n','x'.repeat(2049)])await assert.rejects(()=>queue(forbidden).poll(model,invalid),{code:'provider_identity_mismatch'});
 for(const body of [null,[],42])await assert.rejects(()=>queue(forbidden).submit(model,body),unknown);
 let actual;await createFalQueue({baseUrl:'https://queue-proxy.test/v1/',apiKey:'private-key',fetchImpl:async(url)=>{actual=url;return response({status:'IN_QUEUE'});}}).poll('fal-ai/birefnet','a/b?c#d');
 assert.equal(actual,'https://queue-proxy.test/v1/fal-ai/birefnet/requests/a%2Fb%3Fc%23d/status?logs=0');
});

test('HTTP, redirect, malformed and oversized JSON failures are generic and never retry a POST',async()=>{
 const cases=[()=>response({error:'private-key provider-secret'},500),()=>Promise.reject(Error('provider-secret private-key redirect')),
  ()=>new Response('{bad'),()=>response([]),()=>response(null),()=>new Response(new Uint8Array([255])),
  ()=>response({large:'x'.repeat(1024*1024)}),()=>new Response('{}',{headers:{'content-length':String(1024*1024+1)}}),
  ()=>({ok:true,status:200,headers:new Headers(),json:async()=>({request_id:id})})];
 for(const fixture of cases){let calls=0;await assert.rejects(()=>queue(()=>{calls++;return fixture();}).submit(model,{}),unknown);assert.equal(calls,1);}
 let calls=0;await assert.rejects(()=>queue(async()=>++calls===1?response({status:'COMPLETED'}):response([])).poll(model,id),unknown);assert.equal(calls,2);
});

test('caller abort interrupts ignored fetch signals and stalled response streams without reissuing',async()=>{
 for(const stage of ['fetch','read']){
  const controller=new AbortController(),reason=new Error('caller cancelled');let calls=0,streamCancelled=false;
  const p=queue(()=>{calls++;return stage==='fetch'?new Promise(()=>{}):new Response(new ReadableStream({pull(){return new Promise(()=>{});},cancel(){streamCancelled=true;}}));});
  const pending=p.submit(model,{},{signal:controller.signal});await new Promise(resolve=>setImmediate(resolve));controller.abort(reason);
  await assert.rejects(()=>pending,error=>error===reason);assert.equal(calls,1);if(stage==='read')assert.equal(streamCancelled,true);
 }
 const controller=new AbortController();controller.abort();await assert.rejects(()=>queue(()=>assert.fail()).poll(model,id,{signal:controller.signal}),error=>error===controller.signal.reason);
});

test('request timeout bounds stalled fetch and streamed reads even when a fetch implementation ignores abort',async()=>{
 const timeout=AbortSignal.timeout;AbortSignal.timeout=()=>timeout(5);
 const keepAlive=setInterval(()=>{},50);
 try{
  for(const fetchImpl of [()=>new Promise(()=>{}),()=>new Response(new ReadableStream({pull(){return new Promise(()=>{});}}))])await assert.rejects(()=>queue(fetchImpl).submit(model,{}),unknown);
 }finally{clearInterval(keepAlive);AbortSignal.timeout=timeout;}
});
