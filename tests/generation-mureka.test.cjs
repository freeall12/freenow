'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {createMurekaProvider,parseMurekaModelMap,MAX_JSON_BYTES,MAX_AUDIO_BYTES}=require('../server/generation-mureka.cjs');
const {createDurableGenerationService}=require('../server/generation-durable.cjs');
const {createGenerationMediaStore}=require('../server/generation-media-store.cjs');
const {createGenerationMediaMaterializer}=require('../server/generation-media-materializer.cjs');
const {createGenerationMediaDownloader}=require('../server/generation-media-download.cjs');
const core=require('../audio-core.js');
const mp3=require('node:fs').readFileSync(path.join(__dirname,'fixtures/elevenlabs-tone-44100.mp3')),mediaData='data:audio/mpeg;base64,'+mp3.toString('base64'),mediaValidator=createGenerationMediaDownloader();
const key=randomUUID(),request={kind:'audio.generate',nodeId:'music-node',prompt:'晚风中的原创骑行歌曲',inputs:[],parameters:{model:'mureka-8',virtualModel:'mureka-v8',scene:'Music',lyric_mode:false,lyrics:''}};
const params=changes=>({...request,parameters:{...request.parameters,...changes}});
const task=(overrides={})=>({id:'song-task-123',model:'mureka-8',status:'queued',...overrides});
const song={index:0,id:'song-choice-1',url:'https://cdn.mureka.example/tone.mp3',duration:200};
const json=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
const provider=options=>createMurekaProvider({apiKey:key,download:(_url,options)=>mediaValidator.download(mediaData,options),fetchImpl:options?.baseUrl?fetch:async()=>json(task()),...options});
const turn=()=>new Promise(resolve=>setImmediate(resolve));
async function loopback(t,handler){
 const calls=[],server=http.createServer(async(req,res)=>{try{const parts=[];for await(const chunk of req)parts.push(chunk);const body=Buffer.concat(parts);calls.push({path:req.url,method:req.method,body:body.length?JSON.parse(body):undefined,authenticated:req.headers.authorization==='Bearer '+key});await handler(req,res,calls.at(-1));}catch{res.writeHead(500).end();}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
 return {baseUrl:'http://127.0.0.1:'+server.address().port,calls};
}
function send(res,value){res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify(value));}

test('exact model defaults and capabilities expose honest per-mode bounds without secrets',()=>{
 const native=provider();assert.equal(native.configured,true);assert.equal(native.metadata.protocol,'mureka-native');assert.equal(native.metadata.capabilities.remoteRecovery,true);assert.equal(native.metadata.capabilities.remoteCancellation,false);assert.equal(native.cancel,undefined);
 const empty=provider({baseUrl:''});assert.equal(empty.configured,true);assert.equal(empty.metadata.configurationError,null);assert.equal(empty.fingerprint,native.fingerprint);assert.equal(native.metadata.configurationError,null);assert.equal(provider({baseUrl:' '}).configured,false);
 assert.deepEqual(native.metadata.capabilities.music['mureka-o2'],{scene:'Music',lyricsModes:['auto','custom'],maxPromptCharacters:2000,customLyrics:{maxPromptCharacters:1024,maxCharacters:5000},maxCount:1,maxAudioBytes:MAX_AUDIO_BYTES});
 assert.equal(native.metadata.capabilities.music['mureka-8'].duration,undefined);assert.ok(!JSON.stringify(native.metadata).includes(key));assert.equal(native.fingerprint,provider({apiKey:randomUUID()}).fingerprint);
 for(const model of ['auto','mureka-9','mureka-7.6','Mureka V8'])assert.throws(()=>parseMurekaModelMap({alias:{kind:'audio.generate',model}}),{code:'configuration_invalid'});
 assert.throws(()=>parseMurekaModelMap({'mureka-8':{kind:'audio.generate',model:'mureka-o2'}}),{code:'configuration_invalid'});
 const map=parseMurekaModelMap(),reverse=Object.fromEntries(Object.entries(map).reverse());assert.equal(provider({modelMap:map}).fingerprint,provider({modelMap:reverse}).fingerprint);
});

test('actual AudioCore nodes submit Auto and Custom to exact official HTTP routes',async t=>{
 const fixture=await loopback(t,(req,res,call)=>send(res,task({model:call.body.model,status:'preparing'}))),native=provider({baseUrl:fixture.baseUrl});
 for(const virtual of ['mureka-v8','mureka-o2'])for(const custom of [false,true]){
  const node=core.transition({prompt:request.prompt},virtual,'Music');Object.assign(node.params,{lyric_mode:custom,lyrics:custom?'[Verse]\n灯火与晚风\n[Chorus]\n一路向前':''});
  const r={...request,prompt:node.prompt,parameters:{...node.params,model:node.model,virtualModel:node.virtualModel,scene:node.scene}};native.prepare(r);const accepted=await native.submit(r);assert.equal(accepted.status,'queued');
  const call=fixture.calls.at(-1);assert.equal(call.path,custom?'/v1/song/generate':'/v1/song/easy-generate');assert.equal(call.method,'POST');assert.equal(call.authenticated,true);assert.deepEqual(call.body,{model:node.model,n:1,stream:false,prompt:node.prompt,...custom?{lyrics:node.params.lyrics}:{}});
 }
 assert.equal(fixture.calls.length,4);
});

test('preflight is pure and rejects all unsupported or conflicting controls without a billable POST',async()=>{
 let calls=0;const native=provider({fetchImpl:async()=>{calls++;return json(task());}});native.prepare(request);
 const invalid=[params({duration:60}),params({format:'mp3'}),params({force_instrumental:false}),params({sample_rate:44100}),params({count:2}),{...request,count:2},params({times:2}),params({scene:'Sound'}),params({virtualModel:'mureka-o2'}),params({modelId:'mureka-o2'}),params({lyric_mode:'true'}),params({lyric_mode:false,lyrics:'   '}),params({lyrics:42}),params({lyric_mode:true,lyrics:''}),params({lyric_mode:true,lyrics:'a'.repeat(5001)}),{...params({lyric_mode:true,lyrics:'歌词'}),prompt:'a'.repeat(1025)},{...request,prompt:'a'.repeat(2001)},{...request,prompt:''},{...request,inputs:[{type:'audio',url:'https://example.test/a.mp3'}]},{...request,references:[{type:'text',text:'not expanded'}]},params({providerParameters:{n:2}})];
 for(const value of invalid)await assert.rejects(native.submit(value),{code:'unsupported_generation'});assert.equal(calls,0);
 const absent=createMurekaProvider({fetchImpl:()=>assert.fail()});await assert.rejects(absent.submit(request),{code:'configuration_required'});
 for(const baseUrl of ['https://tapnow.media','https://api.mureka.ai/v1','https://user:pass@api.mureka.ai','https://api.mureka.ai?x=1','http://127.0.0.1:4173'])assert.equal(provider({baseUrl,localPort:4173}).configured,false);
});

test('text inputs merge once; custom keeps exact lines and Unicode character bounds',async()=>{
 let body;const native=provider({fetchImpl:async(_url,options)=>{body=JSON.parse(options.body);return json(task());}});
 await native.submit({...request,inputs:[{type:'text',text:'引用内容'}]});assert.equal(body.prompt,'引用内容\n'+request.prompt);
 await native.submit({...request,prompt:'引用内容\n'+request.prompt,inputs:[{type:'text',text:'引用内容'}]});assert.equal(body.prompt,'引用内容\n'+request.prompt);
 const lyrics='[Verse]\r\n灯火\n晚风\r[Chorus]\n🌙';await native.submit({...params({lyric_mode:true,lyrics}),prompt:'🌙'.repeat(1024)});assert.equal(body.lyrics,lyrics);assert.equal(Array.from(body.prompt).length,1024);
});

test('original task identity survives provider recreation and key rotation with only canonical GET polling',async t=>{
 const fixture=await loopback(t,(req,res)=>send(res,req.method==='POST'?task():task({status:'succeeded',choices:[song]}))),first=provider({baseUrl:fixture.baseUrl}),accepted=await first.submit(request);
 const restarted=provider({baseUrl:fixture.baseUrl,apiKey:randomUUID()}),value=await restarted.poll(accepted.id);
 assert.equal(value.id,accepted.id);assert.deepEqual(value.outputs,[{type:'audio',url:mediaData,sourceFileId:song.id,duration:.2}]);assert.equal(first.fingerprint,restarted.fingerprint);assert.deepEqual(fixture.calls.map(call=>[call.method,call.path]),[['POST','/v1/song/easy-generate'],['GET','/v1/song/query/song-task-123']]);
 await assert.rejects(provider({baseUrl:'https://other.example',fetchImpl:()=>assert.fail()}).poll(accepted.id),{code:'provider_identity_mismatch'});
 await assert.rejects(provider({baseUrl:fixture.baseUrl,modelMap:{'mureka-o2':{kind:'audio.generate',model:'mureka-o2'}},fetchImpl:()=>assert.fail()}).poll(accepted.id),{code:'provider_configuration_changed'});
 for(const invalid of ['mu1.bad',accepted.id+'=',123])await assert.rejects(first.poll(invalid),{code:'provider_identity_mismatch'});
});

test('documented task states map safely while failed_reason and trace IDs stay private',async()=>{
 for(const [status,expected]of [['preparing','queued'],['queued','queued'],['running','running'],['streaming','running'],['failed','failed'],['timeouted','failed'],['cancelled','cancelled']]){
  const native=provider({fetchImpl:async()=>json(task({status,failed_reason:'private vendor details',trace_id:'private-trace'}))}),accepted=await native.submit(request);assert.equal(accepted.status,expected);assert.equal(accepted.outputs,undefined);assert.equal(JSON.stringify(accepted).includes('private'),false);
 }
});

test('wrong IDs, models, unsafe URLs, nonfinal choices and unexpected batches remain unconfirmed',async()=>{
 const complete=task({status:'succeeded',choices:[song]});
 const invalid=[{...complete,id:'other'},{...complete,model:'mureka-9'},{...complete,model:undefined},{...complete,status:'new-status'},{...complete,status:'running'},{...complete,choices:[]},{...complete,choices:[song,song]},{...complete,choices:[{...song,index:1}]},{...complete,choices:[{...song,id:''}]},{...complete,choices:[{...song,duration:'200'}]},{...complete,choices:[{...song,duration:0}]},...['blob:fake','https://127.1/a','https://tapnow.media/a','https://user:pass@example.test/a','http://example.test/a'].map(url=>({...complete,choices:[{...song,url}]}))];
 for(const value of invalid){let posts=0;const native=provider({fetchImpl:async(_url,options)=>{if(options.method==='POST'){posts++;return json(task());}return json(value);}}),accepted=await native.submit(request);await assert.rejects(native.poll(accepted.id),error=>['unknown','provider_identity_mismatch'].includes(error.code));assert.equal(posts,1);}
});

test('malformed, oversized, redirect and credential-bearing receipts are generic unknown with one POST',async()=>{
 const fixtures=[()=>json({...task(),trace_id:key}),()=>new Response('{}',{status:401}),()=>new Response('{bad',{headers:{'content-type':'application/json'}}),()=>json([]),()=>json(task({id:''})),()=>new Response('{}',{headers:{'content-type':'text/html'}}),()=>new Response('{}',{headers:{'content-type':'application/json','content-length':String(MAX_JSON_BYTES+1)}}),()=>new Response(JSON.stringify({x:'a'.repeat(MAX_JSON_BYTES)}),{headers:{'content-type':'application/json'}}),()=>new Response('{}',{headers:{'content-type':'application/json','content-length':'1'}}),()=>new Response('{}',{headers:{'content-type':'application/json','content-encoding':'gzip'}}),()=>{throw Error('private remote error');}];
 for(const fixture of fixtures){let calls=0;const native=provider({fetchImpl:async()=>{calls++;return fixture();}});await assert.rejects(native.submit(request),error=>error.code==='unknown'&&!error.message.includes(key)&&!error.message.includes('private remote'));assert.equal(calls,1);}
});

test('caller abort and timeout bound ignored fetch and stalled streams without reissuing POST',async()=>{
 for(const stage of ['fetch','stream']){
  let calls=0,cancelled=false;const native=provider({timeoutMs:10,fetchImpl:()=>{calls++;return stage==='fetch'?new Promise(()=>{}):new Response(new ReadableStream({pull(){return new Promise(()=>{});},cancel(){cancelled=true;}}),{headers:{'content-type':'application/json'}});}});await assert.rejects(native.submit(request),{code:'unknown'});assert.equal(calls,1);if(stage==='stream')assert.equal(cancelled,true);
 }
 const controller=new AbortController(),native=provider({fetchImpl:()=>new Promise(()=>{})}),pending=native.submit(request,{signal:controller.signal});await turn();controller.abort(Error('user stop'));await assert.rejects(pending,error=>error===controller.signal.reason);
 const before=new AbortController();before.abort();await assert.rejects(provider({fetchImpl:()=>assert.fail()}).submit(request,{signal:before.signal}),error=>error===before.signal.reason);
});

test('generate performs one POST, reports identity and polls the exact task until success',async()=>{
 let posts=0,gets=0;const ids=[],native=provider({fetchImpl:async(_url,options)=>{if(options.method==='POST'){posts++;return json(task());}return json(task(++gets===1?{status:'running'}:{status:'succeeded',choices:[song]}));}});
 const value=await native.generate(request,{pollInterval:1,onTaskIdentity:id=>ids.push(id)});assert.equal(posts,1);assert.equal(gets,2);assert.deepEqual(ids,[value.id]);
});

test('real HTTP task and MP3 bytes archive through durable service, survive disk restart and never regenerate',async t=>{
 const bytes=await fs.readFile(path.join(__dirname,'fixtures/elevenlabs-tone-44100.mp3'));let phase='queued',mediaGets=0;
 const fixture=await loopback(t,(req,res)=>{if(req.url==='/media/tone.mp3'){mediaGets++;assert.equal(req.headers.authorization,undefined);res.writeHead(200,{'Content-Type':'audio/mpeg','Content-Length':bytes.length});res.write(bytes.subarray(0,100));setImmediate(()=>res.end(bytes.subarray(100)));return;}send(res,req.method==='POST'?task():task(phase==='done'?{status:'succeeded',choices:[song]}:{status:'running'}));});
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'mureka-durable-')),mediaDirectory=path.join(directory,'media'),jobsDirectory=path.join(directory,'jobs');let mediaStore,current;
 t.after(async()=>{await current?.close();await mediaStore?.close();await fs.rm(directory,{recursive:true,force:true});});
 const validator=createGenerationMediaDownloader();
 const download=async(resource,options)=>{assert.equal(typeof resource==='string'?resource:resource.url,song.url);const response=await fetch(fixture.baseUrl+'/media/tone.mp3',{signal:options.signal,redirect:'error'}),actual=Buffer.from(await response.arrayBuffer());return validator.download('data:audio/mpeg;base64,'+actual.toString('base64'),options);};
 const start=async()=>{mediaStore=createGenerationMediaStore({directory:mediaDirectory});await mediaStore.ready;current=createDurableGenerationService({directory:jobsDirectory,provider:provider({baseUrl:fixture.baseUrl,download}),mediaMaterializer:createGenerationMediaMaterializer({store:mediaStore})});await current.ready;};
 await start();const original=await current.submit(request,{idempotencyKey:'mureka-real-http-task'});await current.get(original.id);await current.close();await mediaStore.close();
 phase='done';await start();const recovered=await current.get(original.id);assert.equal(recovered.status,'succeeded');assert.match(recovered.outputs[0].url,/^\/api\/generation\/media\//);assert.equal(recovered.outputs[0].sourceFileId,song.id);assert.equal(recovered.outputs[0].duration,.2);
 const resourceId=recovered.outputs[0].url.split('/').at(-1),opened=await mediaStore.open(resourceId);assert.deepEqual(await opened.handle.readFile(),bytes);await opened.handle.close();assert.equal(opened.info.mime,'audio/mpeg');assert.equal(opened.info.bytes,bytes.length);assert.equal(mediaGets,1);
 await current.close();await mediaStore.close();await start();const stable=await current.get(original.id);assert.equal(stable.status,'succeeded');assert.equal(stable.outputs[0].url,recovered.outputs[0].url);assert.equal((await current.submit(request,{idempotencyKey:'mureka-real-http-task'})).id,original.id);
 assert.equal(fixture.calls.filter(call=>call.method==='POST').length,1);assert.equal(mediaGets,1);const disk=await fs.readFile(path.join(jobsDirectory,original.id+'.json'),'utf8');assert.equal(disk.includes(key),false);assert.equal(disk.includes('Authorization'),false);
});

test('lost real HTTP POST persists unknown across disk restart and refuses automatic resubmission',async t=>{
 const fixture=await loopback(t,req=>req.socket.destroy()),directory=await fs.mkdtemp(path.join(os.tmpdir(),'mureka-unknown-'));let current;
 t.after(async()=>{await current?.close();await fs.rm(directory,{recursive:true,force:true});});
 const start=async()=>{current=createDurableGenerationService({directory,provider:provider({baseUrl:fixture.baseUrl})});await current.ready;};await start();const first=await current.submit(request,{idempotencyKey:'mureka-lost-real-http'}),uncertain=await current.get(first.id);assert.equal(uncertain.status,'unknown');assert.equal(uncertain.recovery.retryableLookup,false);await current.close();await start();assert.equal((await current.lookup('mureka-lost-real-http')).status,'unknown');assert.equal((await current.submit(request,{idempotencyKey:'mureka-lost-real-http'})).id,first.id);assert.equal(fixture.calls.length,1);
});

function tagged(text,order,alignment){
 const start=mp3.toString('ascii',0,3)==='ID3'?10+mp3[6]*2097152+mp3[7]*16384+mp3[8]*128+mp3[9]:0;
 const frame=(name,payload)=>{const header=Buffer.alloc(10);header.write(name);header.writeUInt32BE(payload.length,4);return Buffer.concat([header,payload]);};
 let encoded=Buffer.from('review\0'+text,'utf16le');if(order==='BE')encoded=encoded.swap16();
 const payload=order==='UTF8'?Buffer.from('\x03review\0'+text):Buffer.concat([Buffer.from(order==='LE'?[1,255,254]:[1,254,255]),encoded]);
 const body=Buffer.concat([...(alignment?[frame('PRIV',Buffer.from([120,0,0]))]:[]),frame('TXXX',payload)]),header=Buffer.alloc(10);header.write('ID3');header[3]=3;header[6]=(body.length>>>21)&127;header[7]=(body.length>>>14)&127;header[8]=(body.length>>>7)&127;header[9]=body.length&127;return Buffer.concat([header,body,mp3.subarray(start)]);
}

test('native result byte guard rejects complete credential-tagged MP3 across encodings before outputs',async()=>{
 const encoded=[...key].map((character,index)=>'%'+character.charCodeAt(0).toString(16)[index%2?'toUpperCase':'toLowerCase']()).join('');
 for(const text of [key,encoded])for(const order of ['UTF8','LE','BE'])for(const alignment of [0,1]){
  let posts=0,downloads=0;const bytes=tagged(text,order,alignment),native=provider({fetchImpl:async(_url,options)=>{if(options.method==='POST'){posts++;return json(task({status:'succeeded',choices:[song]}));}return json(task({status:'succeeded',choices:[song]}));},download:async(url,options)=>{downloads++;assert.equal(url,song.url);return mediaValidator.download('data:audio/mpeg;base64,'+bytes.toString('base64'),options);}});
  const accepted=await native.submit(request);assert.equal(accepted.status,'running');assert.equal(downloads,0);await assert.rejects(native.poll(accepted.id),error=>error.code==='unknown'&&!error.message.includes(key));assert.equal(posts,1);assert.equal(downloads,1);
 }
});

test('complete byte, length, size and stalled-download bounds preserve original task identity',async()=>{
 for(const bytes of [Buffer.from('not audio'),mp3.subarray(0,mp3.length-7)]){
  const native=provider({fetchImpl:async(_url,options)=>json(options.method==='POST'?task():task({status:'succeeded',choices:[song]})),download:(_url,options)=>mediaValidator.download('data:audio/mpeg;base64,'+bytes.toString('base64'),options)}),accepted=await native.submit(request);await assert.rejects(native.poll(accepted.id),{code:'unknown'});
 }
 for(const download of [async()=>({mime:'audio/mpeg',expectedBytes:MAX_AUDIO_BYTES+1,stream:(async function*(){yield mp3;})(),close(){}}),async()=>({mime:'audio/mpeg',expectedBytes:mp3.length+1,stream:(async function*(){yield mp3;})(),close(){}}),()=>new Promise(()=>{}),async()=>({mime:'audio/mpeg',stream:{[Symbol.asyncIterator](){return {next:()=>new Promise(()=>{}),return:()=>Promise.resolve({done:true})};}},close(){}})]){
  const native=provider({mediaTimeoutMs:10,download,fetchImpl:async(_url,options)=>json(options.method==='POST'?task():task({status:'succeeded',choices:[song]}))}),accepted=await native.submit(request);await assert.rejects(native.poll(accepted.id),{code:'unknown'});
 }
});

test('known successful remote task with unsafe bytes remains recoverable after disk restart and never stores tags',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'mureka-protected-')),mediaDirectory=path.join(directory,'media'),jobsDirectory=path.join(directory,'jobs');let current,store,posts=0,safe=false,downloads=0;
 const bad=tagged(key,'BE',1),open=async()=>{store=createGenerationMediaStore({directory:mediaDirectory});await store.ready;current=createDurableGenerationService({directory:jobsDirectory,provider:provider({fetchImpl:async(_url,options)=>{if(options.method==='POST')posts++;return json(task({status:'succeeded',choices:[song]}));},download:(_url,options)=>{downloads++;return mediaValidator.download(safe?mediaData:'data:audio/mpeg;base64,'+bad.toString('base64'),options);}}),mediaMaterializer:createGenerationMediaMaterializer({store})});await current.ready;};
 t.after(async()=>{await current?.close();await store?.close();await fs.rm(directory,{recursive:true,force:true});});await open();const first=await current.submit(request,{idempotencyKey:'mureka-credential-tagged-song'});await current.get(first.id);const uncertain=await current.get(first.id);assert.equal(uncertain.status,'unknown');assert.equal(uncertain.recovery.retryableLookup,true);assert.equal(uncertain.outputs,undefined);assert.equal(uncertain.providerResult,undefined);
 const disk=await fs.readFile(path.join(jobsDirectory,first.id+'.json'),'utf8');assert.equal(disk.includes(key),false);assert.equal(disk.includes(bad.toString('base64')),false);assert.equal((await fs.readdir(mediaDirectory)).filter(name=>name.endsWith('.bin')).length,0);await current.close();await store.close();
 safe=true;await open();const recovered=await current.get(first.id);assert.equal(recovered.status,'succeeded');assert.equal(recovered.providerTaskId,uncertain.providerTaskId);assert.equal(posts,1);assert.equal(downloads,2);
});
