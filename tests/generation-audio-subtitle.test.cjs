'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {checkedAudioSubtitle,MAX_SUBTITLE_BYTES}=require('../server/generation-audio-subtitle.cjs');
const {checkedOutputs}=require('../server/generation-durable.cjs');
const {createGenerationGateway}=require('../server/generation.cjs');
const {createGenerationMediaMaterializer}=require('../server/generation-media-materializer.cjs');
const ref='/api/generation/media/'+randomUUID(),subtitle={text:'真实供应商字幕第一行\nSecond line\r\n第三行\t保留排版'};
function wave(){const bytes=Buffer.alloc(46);bytes.write('RIFF');bytes.writeUInt32LE(38,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);bytes.writeUInt32LE(24000,24);bytes.writeUInt32LE(48000,28);bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(2,40);return bytes;}
const wav=wave(),data='data:audio/wav;base64,'+wav.toString('base64');

test('optional audio subtitle preserves actual text and exact UTF-8 budget without inferring one',()=>{
 const output={type:'audio',url:ref,subtitle};assert.deepEqual(checkedOutputs([output],{localOnly:true}),[output]);assert.notEqual(checkedAudioSubtitle(output),subtitle);
 const boundary='界'.repeat(10922)+'ab';assert.equal(Buffer.byteLength(boundary),MAX_SUBTITLE_BYTES);assert.deepEqual(checkedAudioSubtitle({type:'audio',subtitle:{text:boundary}}),{text:boundary});
 const ordinary=[{type:'audio',url:ref},{type:'text',text:'普通文本不代表字幕'}];assert.deepEqual(checkedOutputs(ordinary,{localOnly:true}),ordinary);assert.equal(checkedAudioSubtitle({type:'audio',text:'plain text is not a transcript'}),undefined);
});

test('subtitle rejects non-audio contamination, ambiguous fields, invalid text and oversized multibyte text',()=>{
 const invalid=[null,[],{text:7},{text:'界'.repeat(10923)},{text:'bad\u0000text'},{text:'bad\ud800text'},{text:'bad\udc00text'},{text:'words',url:'https://provider.test/captions.srt'},{text:'words',segments:[]},{text:'words',sourceAudioNodeId:'target'},{text:'words',apiKey:'never-accepted'}];
 for(const value of invalid){assert.throws(()=>checkedAudioSubtitle({type:'audio',subtitle:value}),{code:'invalid_outputs'});assert.throws(()=>checkedOutputs([{type:'audio',url:ref,subtitle:value}],{localOnly:true}));}
 for(const type of ['image','video','model','text'])assert.throws(()=>checkedOutputs([{type,...type==='text'?{text:'ordinary'}:{url:ref},subtitle}],{localOnly:true}),{code:'invalid_outputs'});
 assert.throws(()=>checkedOutputs({audio:{url:ref},subtitle}),{code:'missing_outputs'});
});

test('materializer preserves per-audio subtitles with no added resource and rejects subtitle on text/media peers',async()=>{
 const taskId=randomUUID(),manifest={resourceId:ref.split('/').at(-1),taskId,mime:'audio/wav',format:'wav',bytes:46},store={info:async(_id,owner)=>{assert.equal(owner.taskId,taskId);return manifest;},put:()=>assert.fail('already local audio must not download')},materializer=createGenerationMediaMaterializer({store});
 const outputs=[{type:'audio',url:ref,subtitle},{type:'audio',url:ref,subtitle:{text:'另一音频项明确返回的字幕'}},{type:'text',text:'独立文本结果'}];const result=await materializer.localize(outputs,{taskId});assert.deepEqual(result.outputs,outputs);assert.deepEqual(result.resources,[manifest.resourceId]);assert.deepEqual((await materializer.verify(result.outputs,{taskId})).resources,[manifest.resourceId]);
 for(const type of ['image','video','model','text'])await assert.rejects(()=>materializer.localize([{type,...type==='text'?{text:'ordinary'}:{url:ref},subtitle}],{taskId:randomUUID()}),{code:'media_invalid_outputs'});
 await assert.rejects(()=>materializer.verify([{type:'audio',url:ref,subtitle:{text:'words',speaker:'invented'}}],{taskId}),{code:'media_invalid_outputs'});
});

test('production public receipt and durable restart retain provider-bound subtitle and same local audio without another POST',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'generation-audio-subtitle-')),tasks=path.join(directory,'tasks');let posts=0,gateway;
 const providerResult={id:'accepted-original-audio',status:'succeeded',outputs:[{type:'audio',url:data,subtitle}]};
 gateway=createGenerationGateway({directory:tasks,baseUrl:'https://configured-provider.example.test',apiKey:'fixture-private-key',fetchImpl:async(_url,options)=>{assert.equal(options.method,'POST');posts++;return {ok:true,json:async()=>structuredClone(providerResult)};}});await gateway.ready;
 t.after(async()=>{await gateway.close();await fs.rm(directory,{recursive:true,force:true});});
 let receipt;const capture=(_res,status,value)=>{assert.ok([200,202].includes(status));receipt=value;};
 await gateway.handle({method:'POST',headers:{'idempotency-key':'subtitle-original-accepted'}},{},'/api/generation/tasks',{json:capture,body:async()=>({kind:'audio.generate',nodeId:'source-audio',prompt:'原提示词不可冒充字幕',parameters:{model:'doubao-seed-audio-1-0',enable_subtitle:true}})});const id=receipt.id;
 await gateway.handle({method:'GET',headers:{}},{},'/api/generation/tasks/'+id,{json:capture});assert.equal(receipt.status,'succeeded');assert.deepEqual(receipt.outputs[0].subtitle,subtitle);assert.notEqual(receipt.outputs[0].subtitle.text,'原提示词不可冒充字幕');assert.match(receipt.outputs[0].url,/^\/api\/generation\/media\/[a-f0-9-]+$/);assert.equal(receipt.providerResult,undefined);
 const localAudio=receipt.outputs[0].url,record=JSON.parse(await fs.readFile(path.join(tasks,id+'.json'),'utf8'));assert.equal(record.providerTaskId,'accepted-original-audio');assert.deepEqual(record.providerResult.outputs[0].subtitle,subtitle);assert.deepEqual(record.outputs[0].subtitle,subtitle);assert.equal(record.outputs[0].url,localAudio);assert.ok(!JSON.stringify(record).includes('fixture-private-key'));
 await gateway.close();gateway=createGenerationGateway({directory:tasks,baseUrl:'https://configured-provider.example.test',apiKey:'rotated-fixture-key',fetchImpl:()=>assert.fail('ready local audio must neither regenerate nor poll')});await gateway.ready;
 await gateway.handle({method:'GET',headers:{}},{},'/api/generation/tasks/by-key/subtitle-original-accepted',{json:capture});assert.equal(receipt.status,'succeeded');assert.deepEqual(receipt.outputs[0].subtitle,subtitle);assert.equal(receipt.outputs[0].url,localAudio);assert.equal(receipt.request.nodeId,'source-audio');assert.equal(receipt.request.parameters.enable_subtitle,true);assert.equal(receipt.request.parameters.model,'doubao-seed-audio-1-0');assert.equal(posts,1);
});

test('empty and whitespace subtitles are omitted while real audio succeeds and invalid blank shapes still fail',async()=>{
 const taskId=randomUUID(),manifest={resourceId:ref.split('/').at(-1),taskId,mime:'audio/wav',format:'wav',bytes:46},materializer=createGenerationMediaMaterializer({store:{put:()=>assert.fail('already local audio must not download'),info:async(_id,owner)=>{assert.equal(owner.taskId,taskId);return manifest;}}});
 for(const [revision,text]of ['', ' \n\r\n\t ', '\u00a0\u3000'].entries()){
  const output={type:'audio',url:ref,subtitle:{text}};assert.equal(checkedAudioSubtitle(output),undefined);assert.deepEqual(checkedOutputs([output],{localOnly:true}),[{type:'audio',url:ref}]);const localized=await materializer.localize([output],{taskId,revision});assert.deepEqual(localized.outputs,[{type:'audio',url:ref}]);assert.deepEqual(localized.resources,[manifest.resourceId]);assert.equal(output.subtitle.text,text);
 }
 for(const output of [{type:'audio',subtitle:{text:'',extra:true}},{type:'image',subtitle:{text:''}},{type:'audio',subtitle:{text:3}},{type:'audio',subtitle:{text:' '.repeat(MAX_SUBTITLE_BYTES+1)}},{type:'audio',subtitle:{text:'\u0000'}}])assert.throws(()=>checkedAudioSubtitle(output),{code:'invalid_outputs'});
 const actual=' \n真实字幕\n ';assert.deepEqual(checkedAudioSubtitle({type:'audio',subtitle:{text:actual}}),{text:actual});
});
