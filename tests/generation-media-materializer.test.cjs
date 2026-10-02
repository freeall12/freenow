'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{randomUUID}=require('node:crypto'),{PassThrough}=require('node:stream'),{EventEmitter}=require('node:events'),{gzipSync}=require('node:zlib');
const {createGenerationMediaStore}=require('../server/generation-media-store.cjs');
const {createGenerationMediaDownloader,publicMediaUrl,publicAddress}=require('../server/generation-media-download.cjs');
const {createGenerationMediaMaterializer}=require('../server/generation-media-materializer.cjs');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/sr8AAAAASUVORK5CYII=','base64');
const data=(mime,bytes)=>'data:'+mime+';base64,'+bytes.toString('base64');
const glb=()=>{const bytes=Buffer.alloc(24);bytes.write('glTF');bytes.writeUInt32LE(2,4);bytes.writeUInt32LE(24,8);bytes.writeUInt32LE(4,12);bytes.write('JSON',16);bytes.write('{}  ',20);return bytes;};
const spz=()=>{const bytes=Buffer.alloc(35);bytes.write('NGSP');bytes.writeUInt32LE(2,4);bytes.writeUInt32LE(1,8);bytes[13]=12;return gzipSync(bytes);};
function transport({bytes=png,mime='image/png',status=200,remote='93.184.216.34',length=bytes.length,hang=false,chunked=false,selected='93.184.216.34'}={},calls=[]){return (url,options,callback)=>{
 const request=new EventEmitter();request.destroy=()=>{};request.end=()=>{calls.push({url,options});options.lookup(url.hostname,{all:true},(error,addresses)=>{assert.ifError(error);assert.deepEqual(addresses,[{address:selected,family:selected.includes(':')?6:4}]);});queueMicrotask(()=>{const response=new PassThrough();response.socket={remoteAddress:remote};response.statusCode=status;response.headers={'content-type':mime,...length===null?{}:{'content-length':String(length)}};callback(response);if(!hang){if(chunked){response.write(bytes.subarray(0,64));setImmediate(()=>response.end(bytes.subarray(64)));}else response.end(bytes);}});};return request;
 };}
const lookup=async()=>[{address:'93.184.216.34',family:4}];
async function fixture(t){const directory=await fs.mkdtemp(path.join(os.tmpdir(),'generation-local-')),store=createGenerationMediaStore({directory,maxBytes:256*1024*1024});await store.ready;t.after(async()=>{await store.close();await fs.rm(directory,{recursive:true,force:true});});return {directory,store,taskId:randomUUID()};}
async function read(resource,options){const result=await resource.download(...options);const parts=[];try{for await(const chunk of result.stream)parts.push(chunk);return {bytes:Buffer.concat(parts),mime:result.mime,format:result.format};}finally{result.close();}}

test('public URL and DNS address guard reject original services and all local numeric forms',()=>{
 for(const host of ['127.0.0.1','127.1','2130706433','0x7f000001','0177.0.0.1','10.1.2.3','169.254.169.254','100.64.2.1','198.19.0.1','[::1]','[::ffff:127.0.0.1]','[fc00::1]','[fe80::1]','[2002:7f00:1::]','tapnow.ai','cdn.tapnow.media','files.tamaredge.top','conversation-service-131786869360.asia-northeast1.run.app'])assert.throws(()=>publicMediaUrl('https://'+host+'/file'),{code:'media_url_forbidden'},host);
 assert.throws(()=>publicMediaUrl('https://user:pass@cdn.example/file'),{code:'media_url_forbidden'});assert.equal(publicAddress('2606:4700:4700::1111'),true);assert.equal(publicAddress('8.8.8.8'),true);assert.equal(publicAddress('::ffff:808:808'),false);
});
test('pinned public DNS GET consumes actual bytes and keeps default CDN headers key-free',async()=>{
 const calls=[],download=createGenerationMediaDownloader({lookup,requestImpl:transport({},calls)});const result=await read(download,['https://cdn.example/image?signature=private',{kind:'image'}]);assert.deepEqual(result.bytes,png);assert.equal(result.mime,'image/png');assert.equal(calls[0].options.headers.Authorization,undefined);assert.equal(calls[0].options.agent,false);
 const ipv6=createGenerationMediaDownloader({lookup:async()=>[{address:'2001:4860:4860::8888',family:6}],requestImpl:transport({selected:'2001:4860:4860::8888',remote:'2001:4860:4860:0:0:0:0:8888'})});assert.deepEqual((await read(ipv6,['https://cdn.example/ipv6',{kind:'image'}])).bytes,png);
});
test('all DNS answers and the actual connected peer are checked before consuming bytes',async()=>{
 let count=0;const mixed=createGenerationMediaDownloader({lookup:async()=>[{address:'93.184.216.34',family:4},{address:'127.0.0.1',family:4}],requestImpl:()=>{count++;}});await assert.rejects(()=>mixed.download('https://cdn.example/a',{kind:'image'}),{code:'media_dns_forbidden'});assert.equal(count,0);
 const rebound=createGenerationMediaDownloader({lookup,requestImpl:transport({remote:'127.0.0.1'})});await assert.rejects(()=>rebound.download('https://cdn.example/a',{kind:'image'}),{code:'media_connection_forbidden'});
});
test('redirect, HTML, mismatched MIME, length and streamed overflow are rejected',async()=>{
 for(const [options,code]of [[{status:302},'media_redirect_forbidden'],[{bytes:Buffer.from('<html>private</html>'),mime:'text/html'},'media_format_invalid'],[{mime:'video/mp4'},'media_mime_mismatch'],[{length:png.length+1},'media_length_mismatch']]){
  const d=createGenerationMediaDownloader({lookup,requestImpl:transport(options)});await assert.rejects(()=>read(d,['https://cdn.example/a',{kind:'image'}]),{code});
 }
 const d=createGenerationMediaDownloader({lookup,limits:{image:65},requestImpl:transport({length:null})});await assert.rejects(()=>read(d,['https://cdn.example/a',{kind:'image'}]),{code:'media_too_large'});
});
test('data normal formats and gzip SPZ are validated while truncated containers fail',async()=>{
 const d=createGenerationMediaDownloader();assert.deepEqual((await read(d,[data('image/png',png),{kind:'image'}])).bytes,png);assert.equal((await read(d,[data('model/gltf-binary',glb()),{kind:'glb'}])).format,'glb');assert.equal((await read(d,[data('application/octet-stream',spz()),{kind:'spz'}])).format,'spz');
 await assert.rejects(()=>read(d,[data('image/png',png.subarray(0,-3)),{kind:'image'}]),{code:'media_format_invalid'});await assert.rejects(()=>read(d,[data('application/octet-stream',gzipSync(Buffer.from('not SPZ'))),{kind:'spz'}]),{code:'media_format_invalid'});
});
test('trusted resolver headers require the exact resource origin and never follow redirects',async()=>{
 const calls=[],d=createGenerationMediaDownloader({lookup,requestImpl:transport({},calls)});await assert.rejects(()=>d.download({url:'https://cdn.example/a',origin:'https://api.example',headers:{Authorization:'private'}},{kind:'image'}),{code:'media_resolver_invalid'});assert.equal(calls.length,0);
 await read(d,[{url:'https://cdn.example/a',origin:'https://cdn.example',headers:{Authorization:'private'}},{kind:'image'}]);assert.equal(calls[0].options.headers.Authorization,'private');
});
test('abort and total timeout terminate an unfinished transfer',async()=>{
 const controller=new AbortController(),d=createGenerationMediaDownloader({lookup,requestImpl:transport({hang:true}),timeoutMs:25});const running=read(d,['https://cdn.example/a',{kind:'image',signal:controller.signal}]);controller.abort();await assert.rejects(()=>running,{code:'media_cancelled'});
 const keepAlive=setTimeout(()=>{},100);try{await assert.rejects(()=>read(d,['https://cdn.example/a',{kind:'image'}]),{code:'media_download_timeout'});}finally{clearTimeout(keepAlive);}
});
test('materializer localizes every alias and nested world resource, reuses URLs and verifies task ownership',async t=>{
 const {store,taskId}=await fixture(t);let downloads=0;
 const d=createGenerationMediaDownloader(),local=createGenerationMediaMaterializer({store,download:async(resource,options)=>{downloads++;return d.download(resource,options);}});
 const image=data('image/png',png),splat=data('application/octet-stream',spz()),mesh=data('model/gltf-binary',glb());
 const outputs=[{type:'image',url:image,image,fullImage:image,poster:image,sourceUrl:image},{type:'model',url:splat,model:splat,format:'spz',representation:'gaussianSplat',sourceFileId:'w',poster:image,world:{worldId:'w',model:'marble-1.1',marbleUrl:'https://marble.worldlabs.ai/world/w?private=key#view',coordinateSystem:'marble_raw_opencv',splatResolution:'500k',assets:{splats:{spzUrls:{'100k':splat,'150k':splat,'500k':splat,full_res:splat},semanticsMetadata:{metricScaleFactor:1,groundPlaneOffset:0}},mesh:{colliderMeshUrl:mesh,fullResMeshUrl:mesh,hqMeshUrl:mesh},imagery:{panoUrl:image}}}}];
 const [a,b]=await Promise.all([local.localize(outputs,{taskId}),local.localize(outputs,{taskId})]);assert.deepEqual(a,b);assert.equal(downloads,3);assert.equal(a.resources.length,3);assert.equal(a.outputs[1].world.marbleUrl,'https://marble.worldlabs.ai/world/w');assert.equal(a.outputs[1].world.assets.splats.spzUrls['500k'],a.outputs[1].url);assert.equal(a.outputs[0].sourceUrl,a.outputs[0].url);assert.match(a.outputs[1].world.assets.mesh.hqMeshUrl,/^\/api\/generation\/media\//);assert.equal((await local.verify(a.outputs,{taskId})).resources.length,3);await assert.rejects(()=>local.verify(a.outputs,{taskId:randomUUID()}),{code:'media_ownership_mismatch'});assert.equal((await local.localize(outputs,{taskId})).resources.length,3);assert.equal(downloads,3);
 for(const record of a.manifests){assert.equal(JSON.stringify(record).includes('private'),false);assert.equal(JSON.stringify(record).includes('headers'),false);}
});
test('failed attempts retain original descriptors and reuse committed partial files without another generation',async t=>{
 const {store,taskId}=await fixture(t),d=createGenerationMediaDownloader();let attempts=0,bad=true;
 const local=createGenerationMediaMaterializer({store,limits:{concurrency:1},download:async(resource,options)=>{attempts++;if(options.kind==='glb'&&bad)throw Object.assign(Error('redacted'),{code:'media_download_expired'});return d.download(resource,options);}});
 const outputs=[{type:'image',url:data('image/png',png)},{type:'model',url:data('model/gltf-binary',glb())}];await assert.rejects(()=>local.localize(outputs,{taskId}),{code:'media_download_expired'});assert.ok(outputs[0].url.startsWith('data:'));bad=false;const result=await local.localize(outputs,{taskId});assert.equal(attempts,3);assert.equal(result.resources.length,2);
});
test('task budget, output budget, blobs and missing files fail with fixed codes',async t=>{
 const {store,taskId,directory}=await fixture(t);const local=createGenerationMediaMaterializer({store,limits:{taskBytes:20}});await assert.rejects(()=>local.localize([{type:'image',url:data('image/png',png)}],{taskId}),{code:'media_task_too_large'});
 await assert.rejects(()=>local.localize(Array.from({length:51},()=>({type:'text',text:'x'})),{taskId}),{code:'media_invalid_outputs'});await assert.rejects(()=>local.localize([{type:'image',url:'blob:abc'}],{taskId}),{code:'media_blob_forbidden'});
 const normal=createGenerationMediaMaterializer({store}),result=await normal.localize([{type:'image',url:data('image/png',png)}],{taskId,revision:1});await fs.unlink(path.join(directory,result.resources[0]+'.bin'));await assert.rejects(()=>normal.verify(result.outputs,{taskId}),{code:'media_integrity_error'});
});

test('all media byte streams obey the task budget and failed validation publishes no manifest',async t=>{
 const {store,taskId,directory}=await fixture(t),d=createGenerationMediaDownloader({lookup,requestImpl:transport({length:null,chunked:true}),limits:{image:65}}),local=createGenerationMediaMaterializer({store,download:d.download});
 await assert.rejects(()=>local.localize([{type:'image',url:'https://cdn.example/stream'}],{taskId}),{code:'media_too_large'});assert.deepEqual((await fs.readdir(directory)).filter(name=>name.endsWith('.json')||name.endsWith('.bin')||name.endsWith('.part')),[]);
});
test('actual MIME metadata is retained and invalid metadata never becomes an applicable result',async t=>{
 const {store,taskId}=await fixture(t),local=createGenerationMediaMaterializer({store});const result=await local.localize([{type:'image',url:data('image/png',png),mime:'image/png'}],{taskId});assert.equal(result.outputs[0].mime,'image/png');
 await assert.rejects(()=>local.localize([{type:'image',url:data('image/png',png),mime:'video/mp4'}],{taskId:randomUUID()}),{code:'media_mime_mismatch'});
});
test('normal data audio and video persist as fixed resource refs',async t=>{
 const {store,taskId}=await fixture(t),local=createGenerationMediaMaterializer({store});const wav=Buffer.alloc(46);wav.write('RIFF');wav.writeUInt32LE(38,4);wav.write('WAVE',8);wav.write('fmt ',12);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(2,40);
 const mp4=Buffer.alloc(24);mp4.writeUInt32BE(24);mp4.write('ftyp',4);mp4.write('isom',8);const result=await local.localize([{type:'audio',url:data('audio/wav',wav),audio:data('audio/wav',wav)},{type:'video',url:data('video/mp4',mp4),video:data('video/mp4',mp4)}],{taskId});assert.equal(result.resources.length,2);assert.equal(result.manifests[0].mime,'audio/wav');assert.equal(result.manifests[1].mime,'video/mp4');assert.equal(result.outputs[0].url,result.outputs[0].audio);
});
test('download concurrency remains two across separate tasks, cancellation releases queued work',async t=>{
 const {store}=await fixture(t),d=createGenerationMediaDownloader();let active=0,maximum=0,calls=0;const releases=[];
 const local=createGenerationMediaMaterializer({store,download:async(resource,options)=>{calls++;active++;maximum=Math.max(maximum,active);try{await new Promise(resolve=>releases.push(resolve));return await d.download(resource,options);}finally{active--;}}});
 const source=[{type:'image',url:data('image/png',png)}],cancel=new AbortController();const first=local.localize(source,{taskId:randomUUID()}),second=local.localize(source,{taskId:randomUUID()}),third=local.localize(source,{taskId:randomUUID(),signal:cancel.signal});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,2);cancel.abort();await assert.rejects(()=>third,{code:'media_cancelled'});releases.splice(0).forEach(resolve=>resolve());await Promise.all([first,second]);assert.equal(maximum,2);assert.equal(calls,2);
});
test('a waiting duplicate can cancel independently and cancellation does not publish late resources',async t=>{
 const {store,taskId,directory}=await fixture(t),d=createGenerationMediaDownloader();let release;const local=createGenerationMediaMaterializer({store,download:async(resource,options)=>{await new Promise(resolve=>{release=resolve;});return d.download(resource,options);}}),source=[{type:'image',url:data('image/png',png)}],signal=new AbortController();
 const first=local.localize(source,{taskId}),second=local.localize(source,{taskId,signal:signal.signal});signal.abort();await assert.rejects(()=>second,{code:'media_cancelled'});await new Promise(resolve=>setImmediate(resolve));release();const result=await first;assert.equal(result.resources.length,1);
 const cancelled=new AbortController(),another=local.localize(source,{taskId:randomUUID(),signal:cancelled.signal});await new Promise(resolve=>setImmediate(resolve));cancelled.abort();release();await assert.rejects(()=>another,{code:'media_cancelled'});assert.equal((await fs.readdir(directory)).filter(name=>name.endsWith('.json')).length,1);
});

test('existing native Speech streaming WAV sentinel stays byte-exact through localization',async t=>{
 const {submitSpeech}=require('../server/generation-openai-speech.cjs'),{store,taskId}=await fixture(t);const wav=Buffer.alloc(1004);wav.write('RIFF');wav.writeUInt32LE(0xffffffff,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(24000,24);wav.writeUInt32LE(48000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(0xffffffff,40);
 let posts=0;const upstream=await submitSpeech({kind:'audio.generate',body:{model:'gpt-4o-mini-tts',input:'fixture',voice:'alloy',response_format:'wav',speed:1,stream_format:'audio'},expectedSampleRate:24000},{sdk:{audio:{speech:{create:async()=>{posts++;return new Response(wav,{headers:{'content-type':'audio/wav'}});}}}}});
 const local=createGenerationMediaMaterializer({store}),result=await local.localize(upstream.outputs,{taskId});assert.equal(result.outputs[0].duration,.02);const opened=await store.open(result.resources[0],{taskId});try{assert.deepEqual(await opened.handle.readFile(),wav);}finally{await opened.handle.close();}assert.equal(posts,1);
 const truncated=Buffer.from(wav);truncated.writeUInt32LE(2000,40);await assert.rejects(()=>local.localize([{type:'audio',url:data('audio/wav',truncated)}],{taskId:randomUUID()}),{code:'media_format_invalid'});
});
