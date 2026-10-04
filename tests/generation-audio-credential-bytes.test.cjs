'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {assertCredentialFreeBytes}=require('../server/outbound-client.cjs');
const {createElevenLabsProvider}=require('../server/generation-elevenlabs.cjs');
const {createElevenLabsSoundProvider}=require('../server/generation-elevenlabs-sound.cjs');
const {createMiniMaxMusicProvider}=require('../server/generation-minimax-music.cjs');
const {createElevenLabsMusicProvider}=require('../server/generation-elevenlabs-music.cjs');
const {createDurableGenerationService}=require('../server/generation-durable.cjs');
const {createGenerationMediaStore}=require('../server/generation-media-store.cjs');
const {createGenerationMediaMaterializer}=require('../server/generation-media-materializer.cjs');
const mp3=require('node:fs').readFileSync(path.join(__dirname,'fixtures/elevenlabs-tone-44100.mp3'));
const key='synthetic-audio-byte-guard-private-key';
const encoded=[...key].map((character,index)=>'%'+character.charCodeAt(0).toString(16)[index%2?'toUpperCase':'toLowerCase']()).join('');
const encode=(text,order)=>{const bytes=Buffer.from(text,'utf16le');return order==='LE'?bytes:bytes.swap16();};
function frame(name,payload){const header=Buffer.alloc(10);header.write(name);header.writeUInt32BE(payload.length,4);return Buffer.concat([header,payload]);}
function tagged(text,order,alignment){
 const start=mp3.toString('ascii',0,3)==='ID3'?10+mp3[6]*2097152+mp3[7]*16384+mp3[8]*128+mp3[9]:0;
 const payload=Buffer.concat([Buffer.from(order==='LE'?[1,255,254]:[1,254,255]),encode('review\0'+text,order)]);
 // A valid odd-sized PRIV frame changes alignment without malformed padding.
 const body=Buffer.concat([...(alignment?[frame('PRIV',Buffer.from([120,0,0]))]:[]),frame('TXXX',payload)]);
 const header=Buffer.alloc(10);header.write('ID3');header[3]=3;header[6]=(body.length>>>21)&127;header[7]=(body.length>>>14)&127;header[8]=(body.length>>>7)&127;header[9]=body.length&127;
 return Buffer.concat([header,body,mp3.subarray(start)]);
}
const fixtures=[];for(const order of ['LE','BE'])for(const text of [key,encoded])for(const alignment of [0,1])fixtures.push({order,encoded:text===encoded,alignment,bytes:tagged(text,order,alignment)});
const request=(model,scene,extra={})=>({kind:'audio.generate',prompt:'Only local contract fixture',inputs:[],parameters:{model,scene,...extra}});
const cases=[
 {name:'ElevenLabs TTS',create:createElevenLabsProvider,request:request('eleven_v3','Text-to-Speech',{voice_id:'fixture_voice',stability:.5})},
 {name:'ElevenLabs Sound',create:createElevenLabsSoundProvider,request:request('eleven_sound_effect','Sound')},
 {name:'MiniMax Music',create:createMiniMaxMusicProvider,request:request('music-2.6','Music',{lyric_mode:false,force_instrumental:false,lyrics:''}),hex:true},
 {name:'ElevenLabs Music',create:createElevenLabsMusicProvider,request:request('music_v1','Music',{lyric_mode:false,force_instrumental:false,lyrics:''})},
];
const response=(entry,bytes)=>entry.hex?Response.json({base_resp:{status_code:0},data:{status:2,audio:bytes.toString('hex')},extra_info:{music_size:bytes.length,music_sample_rate:44100}}):new Response(bytes,{headers:{'content-type':'audio/mpeg'}});
test('shared binary guard rejects UTF-8 and both UTF-16 byte orders/alignment including percent echoes without changing clean bytes',()=>{
 assert.equal(assertCredentialFreeBytes(mp3,key),mp3);assert.equal(assertCredentialFreeBytes(Buffer.alloc(0),key).length,0);
 for(const text of [key,encoded])assert.throws(()=>assertCredentialFreeBytes(Buffer.from(text),key),{code:'provider_response_rejected'});
 for(const fixture of fixtures)assert.throws(()=>assertCredentialFreeBytes(fixture.bytes,key),{code:'provider_response_rejected'});
});
for(const entry of cases)test(entry.name+' rejects valid credential tags before result/production archive and preserves unknown after restart',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'audio-byte-guard-')),tasks=path.join(root,'tasks'),media=path.join(root,'media');let service,store,posts=0;
 const open=async bytes=>{store=createGenerationMediaStore({directory:media});await store.ready;service=createDurableGenerationService({directory:tasks,provider:entry.create({apiKey:key,fetchImpl:async()=>{posts++;return response(entry,bytes);}}),mediaMaterializer:createGenerationMediaMaterializer({store})});await service.ready;};
 t.after(async()=>{await service?.close();await store?.close();await fs.rm(root,{recursive:true,force:true});});
 await open(fixtures[0].bytes);
 for(const [index,fixture]of fixtures.entries()){
  let calls=0;const provider=entry.create({apiKey:key,fetchImpl:async()=>{calls++;return response(entry,fixture.bytes);}});
  await assert.rejects(()=>provider.submit(entry.request),error=>error.code==='unknown'&&!error.message.includes(key));assert.equal(calls,1);
  if(index===0){const job=await service.submit(entry.request,{idempotencyKey:'audio-credential-byte-reject'});let result;for(let attempt=0;attempt<200;attempt++){result=await service.get(job.id);if(result.status==='unknown')break;await new Promise(resolve=>setTimeout(resolve,5));}
   assert.equal(result.status,'unknown');assert.equal(result.outputs,undefined);assert.equal(result.providerResult,undefined);assert.equal(result.recovery.retryableLookup,false);assert.equal(posts,1);
   const record=await fs.readFile(path.join(tasks,job.id+'.json'),'utf8');assert(!record.includes(fixture.bytes.toString('base64')));assert.equal((await fs.readdir(media)).filter(name=>name.endsWith('.bin')).length,0);
   await service.close();await store.close();await open(fixture.bytes);const replay=await service.submit(entry.request,{idempotencyKey:'audio-credential-byte-reject'});assert.equal(replay.id,job.id);assert.equal(replay.status,'unknown');assert.equal(posts,1);
  }
 }
 const clean=entry.create({apiKey:key,fetchImpl:async()=>response(entry,mp3)});const result=await clean.submit(entry.request);assert.equal(result.status,'succeeded');assert.deepEqual(Buffer.from(result.outputs[0].url.split(',')[1],'base64'),mp3);
});
