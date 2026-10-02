'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const {createVideoSegmentationAdapter,checkedUrl}=require('../server/video-segmentation.cjs');
const request={kind:'video.segment',nodeId:'video-node',sourceVideoUrl:'data:video/mp4;base64,dmlkZW8=',width:4,height:2,duration:1,time:.5,selection:{x:0,y:0,width:.5,height:1},pointPrompts:[{x:1,y:1,time:.5,label:1}]};
const mask={width:4,height:2,fps:2,frames:['0 2','6 2']};
const response=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {resolve,reject,promise};};
const baseUrl='https://operator.example/api',secret='private-fixture-key';

test('segmentation configuration stays server-side and preserves request and inline mask',async()=>{
 const calls=[];const service=createVideoSegmentationAdapter({baseUrl,apiKey:secret,fetchImpl:async(url,options)=>{calls.push({url,options});return response({...mask,providerSecret:secret,rleUrl:'https://operator.example/unused'});}});
 assert.deepEqual(await service.segment(request),mask);
 assert.equal(calls.length,1);assert.equal(calls[0].url,baseUrl+'/segment-video');assert.equal(calls[0].options.headers.Authorization,'Bearer '+secret);assert.equal(calls[0].options.redirect,'error');assert.deepEqual(JSON.parse(calls[0].options.body),request);
 const config=JSON.stringify(service.config());assert.ok(!config.includes(secret)&&!config.includes(baseUrl));assert.equal(service.config().availabilityVerified,false);
 const empty=createVideoSegmentationAdapter({fetchImpl:()=>assert.fail('unconfigured dispatched')});assert.equal(empty.config().configured,false);await assert.rejects(empty.segment(request),{code:'configuration_required'});
 const noKey=createVideoSegmentationAdapter({baseUrl,fetchImpl:async()=>response(mask)});assert.equal(noKey.config().configured,true);
});

test('all reference domains, case and trailing dots are blocked before any dispatch',async()=>{
 const domains=['tapnow.media','tapnow.ai','tapnow.art','tapnow.top','tapnow.zone','tapnow.plus','tapnow.tv','tamaredge.top','conversation-service-131786869360.asia-northeast1.run.app'];
 for(const domain of domains)for(const host of [domain,'files.'+domain,domain.toUpperCase()+'.']){
  const blocked='https://'+host+'/api';assert.throws(()=>checkedUrl(blocked),{code:'segmentation_invalid_url'});
  const service=createVideoSegmentationAdapter({baseUrl:blocked,fetchImpl:()=>assert.fail('blocked origin dispatched')});assert.equal(service.config().configured,false);await assert.rejects(service.segment(request),{code:'configuration_required'});
  const source=createVideoSegmentationAdapter({baseUrl,fetchImpl:()=>assert.fail('blocked source dispatched')});await assert.rejects(source.segment({...request,sourceVideoUrl:blocked}),{code:'segmentation_invalid_url'});
 }
 for(const url of ['https://user:pass@operator.example/api','https://operator.example/api?key=x','https://operator.example/api#x','file:///tmp/local',' https://operator.example/api'])assert.throws(()=>checkedUrl(url,undefined,{endpoint:true}));
 assert.equal(checkedUrl('https://tapnow.media.operator.example/api').hostname,'tapnow.media.operator.example');
});

test('server fetches same-origin RLE JSON once and rejects arbitrary result URLs',async()=>{
 let calls=[];const service=createVideoSegmentationAdapter({baseUrl,apiKey:secret,fetchImpl:async(url,options)=>{calls.push({url,options});return response(calls.length===1?{width:4,height:2,rleUrl:'/masks/one.json'}:mask.frames);}});
 assert.deepEqual(await service.segment(request),mask);assert.equal(calls[1].url,'https://operator.example/masks/one.json');assert.equal(calls[1].options.redirect,'error');assert.equal(calls[1].options.headers,undefined);
 for(const rleUrl of ['https://files.tapnow.media/mask','https://other.example/mask','http://operator.example/mask','data:application/json,[]','https://u:p@operator.example/mask',{}]){
  calls=[];const invalid=createVideoSegmentationAdapter({baseUrl,fetchImpl:async url=>{calls.push(url);return response({width:4,height:2,rleUrl});}});await assert.rejects(invalid.segment(request),{code:'segmentation_invalid_url'});assert.equal(calls.length,1);
 }
});

test('existing pixel/RLE validation rejects bad geometry, incomplete and overlapping masks',async()=>{
 const service=createVideoSegmentationAdapter({baseUrl,fetchImpl:()=>assert.fail('invalid request dispatched')});
 for(const input of [{...request,baseUrl:'https://elsewhere.example'},{...request,selection:{...request.selection,extra:{apiKey:secret}}},{...request,time:2},{...request,duration:NaN},{...request,width:0},{...request,pointPrompts:[{x:2,y:1,time:.5,label:1}]},{...request,sourceVideoUrl:'blob:local'}])await assert.rejects(service.segment(input));
 for(const output of [{...mask,width:5},{...mask,frames:['0 2 1 2','0 1']},{...mask,frames:['','']},{...mask,fps:30},{...mask,frames:[1,2]}]){
  const invalid=createVideoSegmentationAdapter({baseUrl,fetchImpl:async()=>response(output)});await assert.rejects(invalid.segment(request),{code:'segmentation_invalid_result'});
 }
});

test('errors are bounded and sanitized; a lost POST receipt is unknown without retry',async()=>{
 let count=0;const service=createVideoSegmentationAdapter({baseUrl,apiKey:secret,fetchImpl:async()=>{count++;throw Error(baseUrl+'?key='+secret);}});
 await assert.rejects(service.segment(request),error=>error.code==='segmentation_unknown'&&!error.message.includes(baseUrl)&&!error.message.includes(secret));assert.equal(count,1);
 const abortedProvider=createVideoSegmentationAdapter({baseUrl,fetchImpl:async()=>{throw new DOMException(secret,'AbortError');}});await assert.rejects(abortedProvider.segment(request),error=>error.code==='segmentation_unknown'&&!error.message.includes(secret));
 for(const reply of [new Response(secret,{status:403}),new Response(secret,{status:302,headers:{Location:'https://app.tapnow.media/'}}),new Response(secret)]){
  const invalid=createVideoSegmentationAdapter({baseUrl,fetchImpl:async()=>reply});await assert.rejects(invalid.segment(request),error=>error.code.startsWith('segmentation_')&&!error.message.includes(secret));
 }
 let cancelled=0;const stream=new ReadableStream({start(c){c.enqueue(new Uint8Array(101));},cancel(){cancelled++;}});
 const large=createVideoSegmentationAdapter({baseUrl,maxBytes:100,fetchImpl:async()=>new Response(stream)});await assert.rejects(large.segment(request),{code:'segmentation_result_too_large'});assert.equal(cancelled,1);
});

test('real AbortController and timeout stop waiting, propagate abort and release capacity',async()=>{
 const started=deferred();let signal,calls=0;const service=createVideoSegmentationAdapter({baseUrl,maxConcurrent:1,fetchImpl:async(_url,options)=>{calls++;signal=options.signal;started.resolve();return calls===1?new Promise(()=>{}):response(mask);}});
 const controller=new AbortController(),job=service.segment(request,{signal:controller.signal});await started.promise;
 await assert.rejects(service.segment(request),{code:'segmentation_capacity'});controller.abort();await assert.rejects(job,error=>error.name==='AbortError'&&error.code==='segmentation_cancelled'&&/尚未确认/.test(error.message));assert.equal(signal.aborted,true);
 const before=new AbortController();before.abort();await assert.rejects(service.segment(request,{signal:before.signal}),{name:'AbortError'});assert.equal(calls,1);assert.deepEqual(await service.segment(request),mask);assert.equal(calls,2);
 const timed=createVideoSegmentationAdapter({baseUrl,timeoutMs:10,fetchImpl:()=>new Promise(()=>{})});await assert.rejects(timed.segment(request),{code:'segmentation_unknown'});
 let readsCancelled=0;const bodyStarted=deferred(),body=new ReadableStream({pull(){return new Promise(()=>{});},cancel(){readsCancelled++;}}),reply=new Response(body),getReader=body.getReader.bind(body);body.getReader=()=>{const reader=getReader();bodyStarted.resolve();return reader;};
 const reading=createVideoSegmentationAdapter({baseUrl,fetchImpl:async()=>reply}),readingCtrl=new AbortController(),pending=reading.segment(request,{signal:readingCtrl.signal});await bodyStarted.promise;readingCtrl.abort();await assert.rejects(pending,{name:'AbortError'});assert.equal(readsCancelled,1);
});

test('local HTTP handler exposes safe config, result and invalid-body errors',async t=>{
 const service=createVideoSegmentationAdapter({baseUrl,apiKey:secret,fetchImpl:async()=>response(mask)});
 const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
 const body=async(req,limit)=>{let value='';for await(const chunk of req){value+=chunk;if(Buffer.byteLength(value)>limit)throw Error(secret);}return JSON.parse(value);};
 const server=http.createServer((req,res)=>service.handle(req,res,req.url,{json,body}));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close());const local='http://127.0.0.1:'+server.address().port;
 const config=await fetch(local+'/api/video-segmentation/config');assert.equal(config.status,200);assert.ok(!(await config.text()).includes(secret));
 const result=await fetch(local+'/api/video-segmentation/segment',{method:'POST',body:JSON.stringify(request)});assert.equal(result.status,200);assert.deepEqual(await result.json(),mask);
 const invalid=await fetch(local+'/api/video-segmentation/segment',{method:'POST',body:'invalid'});assert.equal(invalid.status,400);assert.ok(!(await invalid.text()).includes(secret));
 const method=await fetch(local+'/api/video-segmentation/segment');assert.equal(method.status,405);
});

test('real supplier HTTP redirects never follow a reference-service location',async t=>{
 let requests=0;const supplier=http.createServer((req,res)=>{requests++;res.writeHead(302,{Location:'https://files.tapnow.media/mask.json'});res.end();});await new Promise(resolve=>supplier.listen(0,'127.0.0.1',resolve));t.after(()=>supplier.close());
 const service=createVideoSegmentationAdapter({baseUrl:'http://127.0.0.1:'+supplier.address().port});await assert.rejects(service.segment(request),{code:'segmentation_unknown'});assert.equal(requests,1);
});

test('RLE GET redirects are also blocked and a disconnected browser aborts its supplier request',{timeout:5000},async t=>{
 let requests=0;const supplier=http.createServer((req,res)=>{requests++;if(req.method==='POST'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({width:4,height:2,rleUrl:'/mask.json'}));}else{res.writeHead(302,{Location:'https://files.tapnow.media/mask.json'});res.end();}});await new Promise(resolve=>supplier.listen(0,'127.0.0.1',resolve));t.after(()=>supplier.close());
 const redirect=createVideoSegmentationAdapter({baseUrl:'http://127.0.0.1:'+supplier.address().port});await assert.rejects(redirect.segment(request),{code:'segmentation_unknown'});assert.equal(requests,2);
 const started=deferred(),aborted=deferred();const service=createVideoSegmentationAdapter({baseUrl,fetchImpl:async(_url,{signal})=>{signal.addEventListener('abort',()=>aborted.resolve(),{once:true});started.resolve();return new Promise(()=>{});}});
 const server=http.createServer((req,res)=>service.handle(req,res,req.url,{json:(res,status,value)=>{res.writeHead(status);res.end(JSON.stringify(value));},body:async()=>request}));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close());
 const controller=new AbortController(),pending=fetch('http://127.0.0.1:'+server.address().port+'/api/video-segmentation/segment',{method:'POST',signal:controller.signal}).catch(error=>error);await started.promise;controller.abort();assert.equal((await pending).name,'AbortError');await aborted.promise;
});
