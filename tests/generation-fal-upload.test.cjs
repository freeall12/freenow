'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events'),{PassThrough}=require('node:stream'),{createHash}=require('node:crypto');
const {createFalUpload,INITIATE_URL,MAX_FILE_BYTES}=require('../server/generation-fal-upload.cjs');
const KEY='fixture-only-secret',FILE='https://cdn.fal.test/source.mp4',PUT='https://upload.fal.test/source?signature=private';
const receipt=()=>JSON.stringify({upload_url:PUT,file_url:FILE});
const encodedKey=[...KEY].map(c=>'%'+c.charCodeAt(0).toString(16)).join('');
const file=()=>({bytes:Buffer.from('actual-private-video-bytes'),mime:'video/mp4',fileName:'source.mp4'});
const lookup=async()=>[{address:'8.8.8.8',family:4}];
function fixture(plans=[{body:receipt()},{body:''}]){
 const calls=[],requests=[];
 const requestImpl=(url,options,callback)=>{
  const index=requests.length,plan=plans[index]??{},request=new EventEmitter();requests.push({url:String(url),options,request});
  request.destroy=()=>{};
  request.end=body=>{
   calls.push({url:String(url),...options,body:Buffer.isBuffer(body)?Buffer.from(body):body});
   if(plan.lost){queueMicrotask(()=>request.emit('error',Error(KEY)));return;}
   if(plan.hang)return;
   const response=new PassThrough();response.socket={remoteAddress:plan.responsePeer??'8.8.8.8'};response.statusCode=plan.status??200;response.headers=plan.headers??{};response.rawHeaders=plan.rawHeaders??[];callback(response);
   queueMicrotask(()=>response.end(plan.body??''));
  };
  queueMicrotask(()=>{const socket=new EventEmitter();Object.assign(socket,{encrypted:true,authorized:true,connecting:false,remoteAddress:plan.peer??'8.8.8.8'});request.emit('socket',socket);});
  return request;
 };
 return {calls,requests,requestImpl,uploader:options=>createFalUpload({apiKey:KEY,lookup,requestImpl,...options})};
}
const code=expected=>error=>{assert.equal(error.code,expected);assert.equal(error.retryable,false);assert(!JSON.stringify(error).includes(KEY));assert(!error.message.includes(KEY));return true;};

test('official one-shot upload pins DNS/TLS, checkpoints identity, sends exact bytes without Key on PUT',async()=>{
 const f=fixture(),stages=[],input=file(),expected=Buffer.from(input.bytes);
 const result=await f.uploader().upload(input,{onStage:async stage=>{stages.push(stage);if(stage.stage==='initiating')input.bytes.fill(0);}});
 assert.deepEqual(stages.map(s=>s.stage),['initiating','initiated','uploading','uploaded']);
 assert.equal(stages[0].initiationDispatched,true);assert.equal(stages[0].identity,null);assert.equal(stages[1].identity.fileUrl,FILE);assert.equal(stages[2].uploadDispatched,true);
 assert.deepEqual(result,{status:'uploaded',fileUrl:FILE,mime:'video/mp4',bytes:expected.length,sha256:createHash('sha256').update(expected).digest('hex')});
 assert.equal(f.calls.length,2);assert.equal(f.calls[0].url,INITIATE_URL);assert.equal(f.calls[0].method,'POST');assert.equal(f.calls[0].headers.Authorization,'Key '+KEY);assert.deepEqual(JSON.parse(f.calls[0].body),{content_type:'video/mp4',file_name:'source.mp4'});
 assert.equal(f.calls[1].url,PUT);assert.equal(f.calls[1].method,'PUT');assert.deepEqual(f.calls[1].headers,{'Content-Type':'video/mp4'});assert.deepEqual(f.calls[1].body,expected);
 for(const call of f.calls){assert.equal(call.agent,false);assert.equal(call.family,4);await new Promise((resolve,reject)=>call.lookup('ignored',{all:true},(e,list)=>{if(e)reject(e);else{assert.deepEqual(list,[{address:'8.8.8.8',family:4}]);resolve();}}));}
 assert(!JSON.stringify(stages).includes('signature=private'));
});
test('configuration, byte budget, MIME and names fail before any network',async()=>{
 for(const options of [{apiKey:''},{apiKey:' padded '},{maxBytes:MAX_FILE_BYTES+1},{timeoutMs:0},{maxConcurrent:5},{lookup:null},{fetchImpl:()=>assert.fail('unprotected fetch')},{baseUrl:'https://other.test'}])assert.throws(()=>createFalUpload({apiKey:KEY,...options}));
 for(const patch of [{bytes:Buffer.alloc(0)},{bytes:'not bytes'},{mime:'video/mp4\r\nAuthorization: x'},{fileName:'../source.mp4'},{fileName:'.'},{extra:'lost'}]){const f=fixture();await assert.rejects(()=>f.uploader().upload({...file(),...patch}),code('upload_invalid_input'));assert.equal(f.requests.length,0);}
 const f=fixture();await assert.rejects(()=>f.uploader({maxBytes:2}).upload(file()),code('upload_invalid_input'));assert.equal(f.requests.length,0);
});
test('credentials in input bytes or metadata cannot be published',async()=>{
 for(const patch of [{bytes:Buffer.from(KEY)},{bytes:Buffer.from(KEY,'utf16le')},{fileName:encodedKey+'.mp4'}]){const f=fixture();await assert.rejects(()=>f.uploader().upload({...file(),...patch}),code('upload_credentials_rejected'));assert.equal(f.requests.length,0);}
});
test('initiation DNS rejects any private or mismatched-family answer before authenticated POST',async()=>{
 for(const addresses of [[{address:'127.0.0.1',family:4}],[{address:'8.8.8.8',family:4},{address:'10.1.1.1',family:4}],[{address:'8.8.8.8',family:6}],[]]){const f=fixture();await assert.rejects(()=>f.uploader({lookup:async()=>addresses}).upload(file()),code('upload_dns_forbidden'));assert.equal(f.requests.length,0);}
});
test('TLS peer must match pinned address before headers or file bytes are sent',async()=>{
 const f=fixture([{peer:'127.0.0.1',body:receipt()}]);await assert.rejects(()=>f.uploader().upload(file()),code('upload_connection_forbidden'));assert.equal(f.calls.length,0);
 const g=fixture([{body:receipt()},{peer:'1.1.1.1'}]);await assert.rejects(()=>g.uploader().upload(file()),error=>{code('upload_connection_forbidden')(error);assert.equal(error.identity.fileUrl,FILE);assert.equal(error.status,'unknown');return true;});assert.equal(g.calls.length,1);
});
test('response peer mismatch also rejects a forged transport receipt',async()=>{const f=fixture([{responsePeer:'1.1.1.1',body:receipt()}]);await assert.rejects(()=>f.uploader().upload(file()),code('upload_connection_forbidden'));assert.equal(f.calls.length,1);});
test('initiation and signed PUT never follow redirects',async()=>{
 for(const plans of [[{status:307,headers:{location:'https://other.test/'}}],[{body:receipt()},{status:302,headers:{location:'https://other.test/'}}]]){const f=fixture(plans);await assert.rejects(()=>f.uploader().upload(file()),code('upload_redirect_forbidden'));assert.equal(f.calls.length,plans.length);}
});
test('receipt URLs require independent public HTTPS and cannot echo the key',async()=>{
 for(const url of ['http://cdn.fal.test/a','https://user:pass@cdn.fal.test/a','https://tapnow.media/a','https://tapnow.media../a','https://127.0.0.1/a','https://[::1]/a',FILE+'#hidden',FILE+'?key='+encodedKey])for(const field of ['upload_url','file_url']){
  const f=fixture([{body:JSON.stringify({upload_url:PUT,file_url:FILE,[field]:url})}]);await assert.rejects(()=>f.uploader().upload(file()),error=>{assert.equal(error.retryable,false);assert(!JSON.stringify(error).includes(KEY));return true;});assert.equal(f.calls.length,1);
 }
});
test('CDN receipt DNS is checked before PUT, including file URL for downstream model use',async()=>{
 for(const rejectedHost of ['cdn.fal.test','upload.fal.test']){const f=fixture();await assert.rejects(()=>f.uploader({lookup:async host=>host===rejectedHost?[{address:'192.168.1.1',family:4}]:lookup()}).upload(file()),code('upload_dns_forbidden'));assert.equal(f.calls.length,1);}
});
test('response credential echoes in JSON, percent encoding, headers and PUT bytes are rejected without disclosure',async()=>{
 const plans=[[{body:JSON.stringify({upload_url:PUT,file_url:FILE,leak:KEY})}],[{body:receipt(),headers:{'x-echo':KEY}}],[{body:receipt(),rawHeaders:['X-Echo',KEY]}],[{body:receipt()},{body:Buffer.from(KEY,'utf16le') }]];
 for(const plan of plans){const f=fixture(plan);await assert.rejects(()=>f.uploader().upload(file()),code('upload_credentials_rejected'));assert.equal(f.calls.length,plan.length);}
});
test('malformed or oversized responses retain unknown state and never repeat POST or PUT',async()=>{
 for(const plan of [{body:'not json'},{body:'{}'},{body:'x'.repeat(65537)},{headers:{'content-length':'65537'}},{body:receipt(),headers:{'content-encoding':'gzip'}},{body:receipt(),headers:{'content-length':'1'}}]){const f=fixture([plan]);await assert.rejects(()=>f.uploader().upload(file()),error=>{assert.equal(error.status,'unknown');assert.equal(error.initiationDispatched,true);assert.equal(error.retryable,false);return true;});assert.equal(f.calls.length,1);}
});
test('lost POST and PUT keep unknown state, acquired identity, and exactly one attempt',async()=>{
 for(const plans of [[{lost:true}],[{body:receipt()},{lost:true}]]){const f=fixture(plans),stages=[];await assert.rejects(()=>f.uploader().upload(file(),{onStage:s=>stages.push(s)}),error=>{code('upload_network_failed')(error);assert.equal(error.status,'unknown');assert.equal(error.identity?.fileUrl,plans.length===2?FILE:undefined);return true;});assert.equal(stages.at(-1).stage,'unknown');assert.equal(f.calls.length,plans.length);}
});
test('each asynchronous checkpoint gates the next request and file success',async()=>{
 for(const rejected of ['initiating','initiated','uploading','uploaded']){const f=fixture(),stages=[];await assert.rejects(()=>f.uploader().upload(file(),{onStage:async s=>{stages.push(s.stage);if(s.stage===rejected)throw Error(KEY);}}),code('upload_checkpoint_failed'));assert.equal(f.calls.length,rejected==='initiating'?0:rejected==='uploaded'?2:1);assert.equal(stages.at(-1),rejected);}
 let release,entered;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r),f=fixture();const pending=f.uploader().upload(file(),{onStage:async s=>{if(s.stage==='initiated'){entered();await gate;}}});await started;assert.equal(f.calls.length,1);release();await pending;assert.equal(f.calls.length,2);
});
test('cancelled or timed-out requests stop locally without reupload and retain uncertain remote state',async()=>{
 const before=fixture(),controller=new AbortController();controller.abort();await assert.rejects(()=>before.uploader().upload(file(),{signal:controller.signal}),error=>{code('upload_cancelled')(error);assert.equal(error.status,'cancelled');return true;});assert.equal(before.calls.length,0);
 const f=fixture([{body:receipt()},{hang:true}]),aborter=new AbortController();const pending=f.uploader().upload(file(),{signal:aborter.signal,onStage:s=>{if(s.stage==='uploading')queueMicrotask(()=>aborter.abort());}});await assert.rejects(()=>pending,error=>{code('upload_cancelled')(error);assert.equal(error.status,'unknown');assert.equal(error.identity.fileUrl,FILE);return true;});assert.equal(f.calls.length,1);
 const g=fixture([{hang:true}]);await assert.rejects(()=>g.uploader({timeoutMs:10}).upload(file()),code('upload_timeout'));assert.equal(g.calls.length,1);
});
test('durable checkpoint failure codes survive without raw callback messages or another request',async()=>{
 for(const preserved of ['storage_error','invalid_preparation_state','provider_identity_mismatch'])for(const stage of ['initiating','initiated','uploaded']){
  const f=fixture();await assert.rejects(()=>f.uploader().upload(file(),{onStage:s=>{if(s.stage===stage)throw Object.assign(Error(KEY+' '+PUT),{code:preserved,cause:KEY});}}),error=>{code(preserved)(error);assert(!JSON.stringify(error).includes(PUT));assert.equal(error.cause,undefined);return true;});
  assert.equal(f.calls.length,stage==='initiating'?0:stage==='initiated'?1:2);
 }
});
test('bounded concurrency rejects a second file instead of secretly queueing it',async()=>{
 const f=fixture([{hang:true}]),uploader=f.uploader(),controller=new AbortController();let entered;const started=new Promise(r=>entered=r);const first=uploader.upload(file(),{signal:controller.signal,onStage:s=>{if(s.stage==='initiating')entered();}});await started;await assert.rejects(()=>uploader.upload(file()),code('upload_concurrency_limit'));controller.abort();await assert.rejects(()=>first);assert(f.calls.length<=1);
});
