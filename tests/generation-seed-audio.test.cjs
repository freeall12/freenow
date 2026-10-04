'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {createSeedAudioProvider,parseSeedAudioModelMap,MAX_JSON_BYTES,oggOpusMetadata}=require('../server/generation-seed-audio.cjs');
const {createDurableGenerationService}=require('../server/generation-durable.cjs');
const {createGenerationMediaStore}=require('../server/generation-media-store.cjs');
const {createGenerationMediaMaterializer}=require('../server/generation-media-materializer.cjs');
const {createGenerationMediaHttp}=require('../server/generation-media-http.cjs');
const key='synthetic-seed-private-contract-key',request={kind:'audio.generate',prompt:'温柔女声朗读：“你好，今天一起去骑车。”',inputs:[],parameters:{model:'doubao-seed-audio-1-0',virtualModel:'seed-audio-1-0',scene:'Text-to-Speech',format:'wav',sample_rate:24000,speech_rate:0,pitch_rate:0,loudness_rate:0,enable_subtitle:false}};
const mp3=require('node:fs').readFileSync(path.join(__dirname,'fixtures/elevenlabs-tone-44100.mp3')),ogg=require('node:fs').readFileSync(path.join(__dirname,'fixtures/seed-tone-48000.ogg'));
function wave(rate=24000,seconds=.12){const size=Math.round(rate*seconds)*2,b=Buffer.alloc(44+size);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(size,40);for(let i=0;i<size/2;i++)b.writeInt16LE(Math.round(Math.sin(i*2*Math.PI*440/rate)*5000),44+i*2);return b;}
const wav=wave(),data=(bytes,mime='audio/wav')=>'data:'+mime+';base64,'+bytes.toString('base64');
const receipt=(bytes=wav,extra={})=>({audio:bytes.toString('base64'),duration:.12,original_duration:.12,...extra});
const json=(value=receipt(),headers={})=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json',...headers}});
const provider=options=>createSeedAudioProvider({apiKey:key,fetchImpl:async()=>json(),...options});
const params=changes=>({...request,parameters:{...request.parameters,...changes}});
const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(`http://127.0.0.1:${server.address().port}`)));
const close=server=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve));};
async function settled(service,id){for(let i=0;i<200;i++){const value=await service.get(id);if(['succeeded','failed','unknown'].includes(value.status))return value;await new Promise(resolve=>setTimeout(resolve,5));}assert.fail('task did not settle');}
function png(){const b=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/sr8AAAAASUVORK5CYII=','base64'),chunk=Buffer.alloc(1200);chunk.writeUInt32BE(chunk.length-12);chunk.write('tEXt',4);chunk.write('fixture\0'+'a'.repeat(chunk.length-20),8);let crc=0xffffffff;for(const byte of chunk.subarray(4,-4)){crc^=byte;for(let i=0;i<8;i++)crc=crc&1?(crc>>>1)^0xedb88320:crc>>>1;}chunk.writeUInt32BE((crc^0xffffffff)>>>0,chunk.length-4);return Buffer.concat([b.subarray(0,-12),chunk,b.subarray(-12)]);}
test('exact native Seed Audio request sends model/text/audio_config with Key only in header',async()=>{
 let calls=0;const native=provider({fetchImpl:async(url,options)=>{calls++;assert.equal(String(url),'https://openspeech.bytedance.com/api/v3/tts/create');assert.equal(options.method,'POST');assert.equal(options.headers['X-Api-Key'],key);assert.match(options.headers['X-Api-Request-Id'],/^[a-f0-9-]{36}$/);assert.equal(options.headers['X-Api-App-Id'],undefined);assert.equal(options.headers['X-Api-Resource-Id'],undefined);assert.equal(options.redirect,'error');assert.equal(options.headers['Accept-Encoding'],'identity');assert.deepEqual(JSON.parse(options.body),{model:'seed-audio-1.0',text_prompt:request.prompt,audio_config:{format:'wav',sample_rate:24000,speech_rate:0,loudness_rate:0,pitch_rate:0,enable_subtitle:false}});return json();}});
 assert.deepEqual(await native.submit(request),{status:'succeeded',outputs:[{type:'audio',url:data(wav),duration:.12}]});assert.equal(calls,1);assert.equal(native.metadata.capabilities.seedAudio['doubao-seed-audio-1-0'].maxAudios,3);assert.equal(native.metadata.capabilities.music,undefined);assert.equal(native.poll,undefined);assert.equal(native.cancel,undefined);assert.equal(native.isPollable(),false);assert.equal(JSON.stringify(native.metadata).includes(key),false);assert.equal(provider({apiKey:'rotated-key'}).fingerprint,native.fingerprint);
});
test('default/explicit maps fail closed for wrong product, extra config and malformed Key',()=>{
 assert.equal(parseSeedAudioModelMap()['doubao-seed-audio-1-0'].model,'seed-audio-1.0');
 for(const config of [{apiKey:''},{apiKey:'bad\nkey'},{modelMap:{}},{modelMap:'bad-json'},{baseUrl:'https://tapnow.media'},{baseUrl:'https://example.test/api'},{modelMap:{x:{kind:'audio.generate',model:'seed-tts-2.0'}}},{modelMap:{x:{kind:'audio.generate',model:'seed-audio-1.0',resourceId:'seed'}}}]){const native=provider(config);assert.equal(native.configured,false);assert.throws(()=>native.prepare(request),{code:'configuration_required'});}
});
test('real node and Agent defaults preserve native rates, prompt references composed once',async()=>{
 const core=require('../audio-core.js'),{audioRequestConfig}=await import('../src/features/agent-generation/audio.mjs'),bodies=[],native=provider({fetchImpl:async(_url,options)=>{bodies.push(JSON.parse(options.body));return json();}});
 const node=core.transition({prompt:request.prompt},'seed-audio-1-0','Text-to-Speech'),agent=audioRequestConfig(core,{}, {kind:'audio.generate',model:'doubao-seed-audio',audioScene:'Text-to-Speech',prompt:request.prompt});
 for(const config of [node,agent])await native.submit({...request,prompt:config.prompt,parameters:{...config.params,model:config.model,scene:config.scene,virtualModel:config.virtualModel}});
 assert.deepEqual(bodies[0],bodies[1]);for(const prompt of ['正文','参考\n正文'])await native.submit({...request,prompt,inputs:[{type:'text',text:'参考'}]});assert.equal(bodies[2].text_prompt,bodies[3].text_prompt);
});
test('references preserve audio input order and bind @音频N; image/audio cannot mix',async()=>{
 const bodies=[],native=provider({fetchImpl:async(_url,options)=>{bodies.push(JSON.parse(options.body));return json();}});
 await native.submit({...request,prompt:'@音频1 说话，@音频2 背景，@音频3 音效',inputs:[{type:'audio',url:data(wav)},{type:'text',text:'额外说明'},{type:'audio',url:data(mp3,'audio/mpeg')},{type:'audio',url:data(ogg,'audio/ogg')}]});assert.deepEqual(bodies[0].references,[{audio_data:wav.toString('base64')},{audio_data:mp3.toString('base64')},{audio_data:ogg.toString('base64')}]);
 await native.submit({...request,inputs:[{type:'image',url:data(png(),'image/png')}]});assert.equal(bodies[1].references[0].image_data,png().toString('base64'));
 for(const inputs of [[{type:'image',url:data(png(),'image/png')},{type:'audio',url:data(wav)}],Array(4).fill({type:'audio',url:data(wav)}),Array(2).fill({type:'image',url:data(png(),'image/png')}),[{type:'audio',url:data(wave(8000,30.01)),duration:1}],[{type:'audio',url:'data:audio/pcm;base64,AAAA'}],[{type:'audio',url:data(mp3.subarray(0,-1),'audio/mpeg')}],[{type:'image',url:data(Buffer.from('not-an-image'),'image/png')}],[{type:'video',url:'http://example.test/v.mp4'}]])await assert.rejects(native.submit({...request,inputs}));
 for(const prompt of ['@音频0','@音频2'])await assert.rejects(native.submit({...request,prompt,inputs:[{type:'audio',url:data(wav)}]}));assert.equal(bodies.length,2);
});
test('all exposed output formats and numeric controls retain exact native units',async()=>{
 for(const [format,sample_rate,bytes,mime]of [['wav',40000,wave(40000),'audio/wav'],['mp3',44100,mp3,'audio/mpeg'],['ogg_opus',48000,ogg,'audio/ogg']]){
  const native=provider({fetchImpl:async(_url,options)=>{assert.deepEqual(JSON.parse(options.body).audio_config,{format,sample_rate,speech_rate:-50,loudness_rate:100,pitch_rate:12,enable_subtitle:false});return json(receipt(bytes));}}),output=(await native.submit(params({format,sample_rate,speech_rate:-50,loudness_rate:100,pitch_rate:12}))).outputs[0];assert.equal(output.url,data(bytes,mime));assert.ok(output.duration>0);
 }
});
test('public HTTPS references map exact URL fields without fetching or trusting remote duration/size',async()=>{
 const bodies=[],native=provider({fetchImpl:async(url,options)=>{assert.equal(String(url),'https://openspeech.bytedance.com/api/v3/tts/create');bodies.push(JSON.parse(options.body));return json();}});
 const image='https://assets.example/image.png?signature=fixture%2Bvalue',audio='https://assets.example/audio.wav?signature=fixture-value';
 await native.submit({...request,inputs:[{type:'image',url:image}]});assert.deepEqual(bodies[0].references,[{image_url:image}]);
 await native.submit({...request,prompt:'@音频1 接 @音频2',inputs:[{type:'audio',url:audio,duration:9999,size:999999999},{type:'audio',url:data(wav)}]});assert.deepEqual(bodies[1].references,[{audio_url:audio},{audio_data:wav.toString('base64')}]);assert.equal(bodies.length,2);
 const forbidden=['https://user:pass@assets.example/a','https://127.0.0.1/a','https://0x7f000001/a','https://10.0.0.1/a','https://[::1]/a','https://[::ffff:127.0.0.1]/a','https://localhost/a','https://host.internal/a','https://cdn.tapnow.media/a','https://tamaredge.top/a','http://assets.example/a','/api/generation/media/file','blob:fixture'];
 for(const url of forbidden)for(const type of ['audio','image'])await assert.rejects(native.submit({...request,inputs:[{type,url}]}));assert.equal(bodies.length,2);
 await assert.rejects(native.submit({...request,inputs:[{type:'audio',url:audio,sourceUrl:'https://tapnow.media/original.wav'}]}));assert.equal(bodies.length,2);
});
test('unmaterialized clip trim sourceClip never dispatch full source media for inline or HTTPS references',async()=>{
 let calls=0;const native=provider({fetchImpl:async()=>{calls++;return json();}});
 for(const [type,url]of [['audio',data(wav)],['audio','https://assets.example/source.wav'],['image',data(png(),'image/png')],['image','https://assets.example/source.png']]){
  for(const field of ['clip','trim','sourceClip']){
   const input={type,url,[field]:{start:3,end:5}};assert.throws(()=>native.prepare({...request,inputs:[input]}),{code:'unsupported_generation'});await assert.rejects(native.submit({...request,inputs:[input]}),{code:'unsupported_generation'});
  }
 }
 assert.equal(calls,0);
 for(const [type,url]of [['audio',data(wav)],['audio','https://assets.example/source.wav'],['image',data(png(),'image/png')],['image','https://assets.example/source.png']]){
  const inputs=[{type,url,clip:null,trim:null,sourceClip:null}];native.prepare({...request,inputs});assert.equal((await native.submit({...request,inputs})).status,'succeeded');
 }
 assert.equal(calls,4);
});
test('Ogg Opus validation rejects truncated pages, bad CRC, renamed Vorbis and header-only files',async()=>{
 assert.equal(oggOpusMetadata(ogg).duration,.12);const bad=Buffer.from(ogg);bad[bad.length-1]^=1;
 for(const bytes of [bad,ogg.subarray(0,-1),ogg.subarray(0,47),Buffer.from('OggS-not-opus'),mp3])await assert.rejects(provider({fetchImpl:async()=>json(receipt(bytes))}).submit(params({format:'ogg_opus',sample_rate:48000})),{code:'unknown'});
});
test('unsupported settings, format rates, contradictory identity, count and bounds fail before network',async()=>{
 let calls=0;const native=provider({fetchImpl:()=>{calls++;assert.fail();}});
 for(const change of [{format:'pcm'},{format:'ogg_opus',sample_rate:24000},{format:'mp3',sample_rate:40000},{sample_rate:24000.5},{speech_rate:101},{speech_rate:-51},{speech_rate:.1},{pitch_rate:13},{loudness_rate:-51},{enable_subtitle:1},{voice_id:'any'},{watermark:{}},{scene:'Sound'},{modelId:'other'},{virtualModel:'other'},{count:2},{times:0},{duration:20},{stream:true}])await assert.rejects(native.submit(params(change)));
 for(const change of [{prompt:''},{prompt:'a'.repeat(3001)},{count:2},{references:[{type:'audio'}]},{inputs:Array(31).fill({type:'text',text:'x'})}])await assert.rejects(native.submit({...request,...change}));assert.equal(calls,0);
});
test('subtitles are supplier text bound to real audio; prompt/text outputs never fabricate captions',async()=>{
 const subtitle={text:'实际供应商字幕\n原排版',sentences:[{start_time:0,end_time:120,text:'实际供应商字幕',words:[]}]};assert.deepEqual((await provider({fetchImpl:async()=>json(receipt(wav,{subtitle}))}).submit(params({enable_subtitle:true}))).outputs[0].subtitle,{text:subtitle.text});
 for(const text of ['', ' \n\t'])assert.equal((await provider({fetchImpl:async()=>json(receipt(wav,{subtitle:{text}}))}).submit(params({enable_subtitle:true}))).outputs[0].subtitle,undefined);
 for(const extra of [{},{subtitle:{text:3}},{subtitle:{text:'bad\u0000text'}},{subtitle:{text:'界'.repeat(10923)}},{text:request.prompt}])await assert.rejects(provider({fetchImpl:async()=>json(receipt(wav,extra))}).submit(params({enable_subtitle:true})),{code:'unknown'});
 await assert.rejects(provider({fetchImpl:async()=>json(receipt(wav,{subtitle}))}).submit(request),{code:'unknown'});
});
test('receipt ambiguity, incomplete audio, format/rate mismatch and credentials never publish success',async()=>{
 const tag=Buffer.alloc(10+key.length);tag.write('ID3');tag[3]=3;tag[9]=key.length;tag.write(key,10);const offset=mp3.toString('ascii',0,3)==='ID3'?10+mp3[9]+mp3[8]*128:0;
 for(const value of [receipt(wav,{code:20000000}),receipt(wav,{code:0}),receipt(wav,{original_duration:121}),receipt(wav,{duration:-1}),receipt(wav,{audio:'AAAA'}),receipt(wav,{audio:wav.toString('base64')+'!'}),receipt(wav.subarray(0,-1)),receipt(wave(48000)),receipt(wav,{logid:key}),receipt(wav,{url:'https://cdn.example/'+encodeURIComponent(key)})]){let calls=0;await assert.rejects(provider({fetchImpl:async()=>{calls++;return json(value);}}).submit(request),e=>e.code==='unknown'&&!e.message.includes(key));assert.equal(calls,1);}
 await assert.rejects(provider({fetchImpl:async()=>json(receipt(Buffer.concat([tag,mp3.subarray(offset)])))}).submit(params({format:'mp3',sample_rate:44100})),{code:'unknown'});
 const attack=Buffer.from(wav);attack.write(key,44);await assert.rejects(provider({fetchImpl:async()=>json(receipt(attack))}).submit(request),{code:'unknown'});
});
test('official non-200 eight-digit errors are terminal and sanitized; malformed response stays unknown',async()=>{
 const native=provider({fetchImpl:async()=>new Response(JSON.stringify({code:45001116,message:'prompt too long'}),{status:400,headers:{'content-type':'application/json'}})});assert.equal((await native.submit(request)).status,'failed');
 for(const response of [new Response('error',{status:401}),json(receipt(),{'content-type':'text/html'}),json(receipt(),{'content-length':'1'}),json(receipt(),{'content-encoding':'gzip'}),json(receipt(),{'content-length':String(MAX_JSON_BYTES+1)})])await assert.rejects(provider({fetchImpl:async()=>response}).submit(request),{code:'unknown'});
});
test('abort and timeouts cancel readers and late responses with one request',async()=>{
 const before=new AbortController();before.abort(Error('cancel before'));await assert.rejects(provider({fetchImpl:()=>assert.fail()}).submit(request,{signal:before.signal}),/cancel before/);
 let release,calls=0,cancelled=false;const native=provider({timeoutMs:10,fetchImpl:()=>{calls++;return new Promise(resolve=>{release=resolve;});}});await assert.rejects(native.submit(request),{code:'unknown'});release(new Response(new ReadableStream({cancel(){cancelled=true;}}),{headers:{'content-type':'application/json'}}));await new Promise(resolve=>setImmediate(resolve));assert.equal(cancelled,true);assert.equal(calls,1);
 let reads=0,stopped=false;await assert.rejects(provider({timeoutMs:10,fetchImpl:async()=>{reads++;return new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(Buffer.from('{')));},cancel(){stopped=true;}}),{headers:{'content-type':'application/json'}});}}).submit(request),{code:'unknown'});assert.equal(reads,1);assert.equal(stopped,true);
});
test('real redirect cannot forward X-Api-Key to another listener',async t=>{
 let calls=0;const target=http.createServer((_req,res)=>{calls++;res.end('never');}),targetUrl=await listen(target),source=http.createServer((_req,res)=>{res.writeHead(307,{Location:targetUrl+'/audio'});res.end();}),baseUrl=await listen(source);t.after(async()=>{await close(source);await close(target);});await assert.rejects(provider({baseUrl,fetchImpl:fetch}).submit(request),{code:'unknown'});assert.equal(calls,0);
});
test('actual loopback POST and local media range/archive/restart preserve WAV MP3 Ogg subtitle without regeneration',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'seed-native-')),directory=path.join(root,'tasks'),mediaDirectory=path.join(root,'media'),expected=[['wav',24000,wav,'audio/wav'],['mp3',44100,mp3,'audio/mpeg'],['ogg_opus',48000,ogg,'audio/ogg']];let calls=0;
 const upstream=http.createServer(async(req,res)=>{const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks));assert.equal(req.url,'/api/v3/tts/create');assert.equal(req.headers['x-api-key'],key);assert.equal(body.model,'seed-audio-1.0');const bytes=expected.find(value=>value[0]===body.audio_config.format)[2];calls++;const text=JSON.stringify(receipt(bytes,{subtitle:{text:'真实字幕:'+body.audio_config.format,sentences:[]}}));res.writeHead(200,{'Content-Type':'application/json','Content-Length':Buffer.byteLength(text)});res.end(text);}),baseUrl=await listen(upstream);
 let store=createGenerationMediaStore({directory:mediaDirectory});await store.ready;let service=createDurableGenerationService({directory,provider:provider({baseUrl,fetchImpl:fetch}),mediaMaterializer:createGenerationMediaMaterializer({store})});await service.ready;
 const ownsResource=async(taskId,id)=>{const task=await service.get(taskId);return task.status==='succeeded'&&task.outputs.some(output=>output.url==='/api/generation/media/'+id);};let media=createGenerationMediaHttp({store,ownsResource});const local=http.createServer((req,res)=>media.handle(req,res,req.url.split('/').at(-1),{json:(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));}})),localUrl=await listen(local);const originals=[];
 t.after(async()=>{await close(local);await media.close();await service.close();await store.close();await close(upstream);await fs.rm(root,{recursive:true,force:true});});
 for(const [format,sample_rate,bytes,mime]of expected){const idempotencyKey='seed-local-'+format,created=await service.submit({...params({format,sample_rate,enable_subtitle:true}),nodeId:'source-audio'}, {idempotencyKey}),task=await settled(service,created.id),output=task.outputs[0];assert.equal(task.status,'succeeded');assert.equal(task.remoteId,undefined);assert.equal(task.request.nodeId,'source-audio');assert.deepEqual(output.subtitle,{text:'真实字幕:'+format});assert.match(output.url,/^\/api\/generation\/media\/[a-f0-9-]{36}$/);originals.push({idempotencyKey,output,bytes,mime});const response=await fetch(localUrl+output.url);assert.equal(response.headers.get('content-type'),mime);assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);const range=await fetch(localUrl+output.url,{headers:{Range:'bytes=20-29'}});assert.equal(range.status,206);assert.deepEqual(Buffer.from(await range.arrayBuffer()),bytes.subarray(20,30));}
 assert.equal(calls,3);await media.close();await service.close();await store.close();store=createGenerationMediaStore({directory:mediaDirectory});await store.ready;service=createDurableGenerationService({directory,provider:provider({baseUrl,apiKey:'rotated-key',fetchImpl:()=>assert.fail('archive does not regenerate')}),mediaMaterializer:createGenerationMediaMaterializer({store})});await service.ready;media=createGenerationMediaHttp({store,ownsResource});
 for(const item of originals){const task=await service.lookup(item.idempotencyKey);assert.equal(task.status,'succeeded');assert.deepEqual(task.outputs[0],item.output);assert.deepEqual(Buffer.from(await(await fetch(localUrl+item.output.url)).arrayBuffer()),item.bytes);}assert.equal(calls,3);
});
test('durable unknown and restart with same idempotency key never send another POST or create subtitle/media',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'seed-unknown-'));let calls=0,service=createDurableGenerationService({directory:root,provider:provider({fetchImpl:async()=>{calls++;return json(receipt(wav,{audio:'not-base64'}));}})});await service.ready;t.after(async()=>{await service.close();await fs.rm(root,{recursive:true,force:true});});const created=await service.submit(request,{idempotencyKey:'seed-ambiguous'}),task=await settled(service,created.id);assert.equal(task.status,'unknown');assert.equal(task.outputs,undefined);await service.close();service=createDurableGenerationService({directory:root,provider:provider({apiKey:'rotated-key',fetchImpl:()=>assert.fail('unknown must not resubmit')})});await service.ready;const restored=await service.submit(request,{idempotencyKey:'seed-ambiguous'});assert.equal(restored.id,created.id);assert.equal(restored.status,'unknown');assert.equal(calls,1);
});
