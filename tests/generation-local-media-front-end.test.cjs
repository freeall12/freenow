'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {TaskService,httpProvider,isGenerationMediaRef,isLocalMediaSource}=require('../generation-api.js');
const ref=index=>'/api/generation/media/12345678-1234-4234-8234-'+String(index).padStart(12,'0');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const reply=value=>({ok:true,json:async()=>value});
const invalidRefs=['/api/generation/media/12345678-1234-3234-8234-000000000001','/api/generation/media/12345678-1234-4234-1234-000000000001','/api/generation/media/nope',ref(1)+'?download=1',ref(1)+'#x',ref(1)+'/', '/uploads/file.png','file:///tmp/file.png','//evil.test/file.png','../api/generation/media/file',ref(1).replace('/media/','/media/%2e%2e/')];

test('browser task schema accepts only the exact UUIDv4 relative media route in main and secondary fields',async()=>{
 const service=new TaskService(),esm=await import('../src/features/generation-results/media-ref.mjs');
 for(const type of ['image','video','audio','model'])service.validateResult({outputs:[{type,url:ref(1),[type]:ref(1),poster:ref(2),sourceUrl:ref(1),...(type==='image'?{fullImage:ref(3)}:{})}]});
 service.validateResult({outputs:[{type:'image',fullImage:ref(1)}]});
 for(const source of invalidRefs){assert.equal(isGenerationMediaRef(source),false);assert.equal(esm.isGenerationMediaRef(source),false);assert.throws(()=>service.validateResult({outputs:[{type:'image',url:source}]}));assert.throws(()=>service.validateResult({outputs:[{type:'image',url:ref(1),fullImage:source}]}));}
 for(const source of [ref(1),ref(1).toUpperCase().replace('/API/GENERATION/MEDIA/','/api/generation/media/'),'asset:user-file','data:image/png;base64,YQ==','data:video/mp4;base64,YQ==','data:audio/wav;base64,YQ==']){assert.equal(isLocalMediaSource(source),true);assert.equal(esm.isLocalMediaSource(source),true);}
 service.validateResult({outputs:[{type:'image',url:'https://legitimate-provider.test/result.png'}]});
});

test('task progress, unknown localization failure and GET recovery preserve only public save state without generating twice',async()=>{
 let calls=0;const methods=[],events=[],service=new TaskService();
 const privateState={resources:['private-manifest-id'],providerResult:{url:'https://signed.test/private?token=secret'},state:'downloading',revision:0,retryable:true};
 const failed={id:'remote',status:'unknown',providerStatus:'succeeded',localization:{...privateState,state:'failed',errorCode:'media_download_failed'},recovery:{reason:'media_localization_failed',pollable:true},error:'生成已完成，素材保存失败'};
 service.setProvider(httpProvider({baseUrl:'http://localhost/api/generation',recoverable:true,pollInterval:1,fetchImpl:async(_url,options)=>{methods.push(options.method||'GET');calls++;return reply(calls===1?{id:'remote',status:'running',progress:99,providerStatus:'succeeded',localization:privateState}:calls===2?failed:{id:'remote',status:'succeeded',request:{kind:'image.generate'},outputs:[{type:'image',url:ref(1)}],providerStatus:'succeeded',localization:{...privateState,state:'ready',retryable:false}});}}));
 service.subscribe(job=>events.push(structuredClone({...job,controller:undefined})));const job=service.submit({kind:'image.generate'});
 while(!['unknown','failed'].includes(job.status))await tick();
 assert.equal(job.status,'unknown');assert.equal(job.providerStatus,'succeeded');assert.equal(job.localization.state,'failed');assert.equal(job.recovery.reason,'media_localization_failed');assert.equal(job.localization.errorCode,'media_download_failed');assert.equal(job.localization.resources,undefined);
 assert.ok(events.some(value=>value.localization?.state==='downloading'&&value.providerStatus==='succeeded'));assert.equal(JSON.stringify(events).includes('private-manifest-id'),false);assert.equal(JSON.stringify(events).includes('signed.test'),false);
 const recovered=await service.recover(job.id);assert.equal(recovered.status,'succeeded');assert.equal(recovered.localization.state,'ready');assert.equal(recovered.outputs[0].url,ref(1));assert.deepEqual(methods,['POST','GET','GET']);
});

test('resumed running tasks preserve pending and downloading state, then local ready output',async()=>{
 const service=new TaskService(),seen=[];service.subscribe(value=>seen.push(value.localization?.state));
 service.setProvider({generate(){assert.fail('must not generate');},lookup:async()=>({id:'remote',request:{kind:'image.generate'},status:'running',providerStatus:'succeeded',localization:{state:'pending',revision:2,retryable:true}}),resume:async(_id,{onProgress})=>{onProgress(99,{providerStatus:'succeeded',localization:{state:'downloading',revision:2,retryable:true}});return {outputs:[{type:'image',url:ref(1)}],providerStatus:'succeeded',localization:{state:'ready',revision:2,retryable:false}};}});
 const job=await service.recover('task-key');while(job.status==='running')await tick();assert.deepEqual(seen,['pending','downloading','ready']);assert.equal(job.localization.revision,2);
});

test('history snapshots preserve local full size, MIME, type aliases, sourceRange and complete Marble metadata across reopen',async()=>{
 const {outputSnapshot,safeSource}=await import('../src/features/generation-history/model.mjs'),{createHistory}=await import('../src/features/generation-history/core.mjs');
 for(const source of invalidRefs)assert.equal(safeSource(source),null);
 const image={type:'image',url:ref(1),image:ref(1),fullImage:ref(2),sourceUrl:ref(2),mime:'image/png'};
 const video={type:'video',url:ref(3),video:ref(3),poster:ref(1),sourceUrl:ref(3),mime:'video/mp4',sourceRange:{start:2,end:4},text:'镜头描述'};
 const world={type:'model',url:ref(4),poster:ref(1),sourceUrl:ref(4),mime:'application/octet-stream',format:'spz',representation:'gaussianSplat',sourceFileId:'original-world',world:{worldId:'original-world',model:'marble-1.1',marbleUrl:'https://marble.worldlabs.ai/world/original-world',coordinateSystem:'marble_raw_opencv',splatResolution:'500k',assets:{splats:{spzUrls:{'100k':ref(5),'500k':ref(4)},semanticsMetadata:{metricScaleFactor:1.25,groundPlaneOffset:-.5}},mesh:{colliderMeshUrl:ref(6),fullResMeshUrl:ref(7)},imagery:{panoUrl:ref(8)}}}};
 const snapshot=outputSnapshot(image);assert.equal(snapshot.url,ref(2));assert.equal(snapshot.image,ref(1));assert.equal(snapshot.fullImage,ref(2));assert.equal(snapshot.sourceUrl,ref(2));assert.equal(snapshot.mime,'image/png');assert.deepEqual(outputSnapshot(video).sourceRange,video.sourceRange);assert.deepEqual(outputSnapshot(world).world,world.world);
 const malformed=structuredClone(world);malformed.world.assets.imagery.panoUrl='/arbitrary/pano.jpg';assert.throws(()=>outputSnapshot(malformed),/元数据无效/);
 const information=structuredClone(world);information.world.marbleUrl=ref(1);assert.throws(()=>outputSnapshot(information),/元数据无效/);
 let record;const store={readRecord:async()=>structuredClone(record),writeRecord:async(_key,value)=>{record=structuredClone(value);}};
 const build=()=>createHistory({projectId:'local-reference',store,archive:async()=>{throw Error('SPZ renderer is unavailable');},lookup:()=>assert.fail('must retain local outputs')});
 const first=build(),job={id:'task',createdAt:Date.now(),status:'succeeded',request:{kind:'world.generate',parameters:{}},outputs:[image,video,world]};await first.ready();await first.captureSubmission(job);await first.observe(job);const before=structuredClone(record.receipts[0].outputs);
 const reopened=build();await reopened.ready();await reopened.retry('task');assert.deepEqual(record.receipts[0].outputs,before);assert.deepEqual(record.receipts[0].outputs[2].world,world.world);assert.equal(reopened.list().length,3);assert.ok(reopened.list().every(row=>row.archiveStatus==='failed'));
});

test('history reads exact same-origin refs and existing asset/data media without a provider request',async()=>{
 const {createArchiver}=await import('../src/features/generation-history/archive.mjs'),reads=[];
 const archiver=createArchiver({assets:{url:async value=>value,put:async()=> 'asset:saved'},fetch:async source=>{reads.push(source);return new Response(new Blob(['actual bytes'],{type:'image/png'}));},validate:async()=>({width:32,height:16}),createMediaUrl:()=> 'blob:preview',revokeMediaUrl(){}});
 for(const source of [ref(1),'asset:user-media','data:image/png;base64,YQ=='])assert.equal((await archiver.archive({type:'image',url:source},{parameters:{}})).mediaRef,'asset:saved');
 assert.deepEqual(reads,[ref(1),'asset:user-media','data:image/png;base64,YQ==']);
});

test('legacy TapNow rows keep their saved URLs but archive fails before network; valid provider legacy stays compatible',async()=>{
 const {createArchiver}=await import('../src/features/generation-history/archive.mjs'),{outputSnapshot}=await import('../src/features/generation-history/model.mjs');let reads=0;
 const archive=createArchiver({assets:{url:async value=>value},fetch:async()=>{reads++;assert.fail('TapNow request forbidden');},localizeAudio:async()=>assert.fail('audio localization forbidden'),materializeWorld:async()=>assert.fail('world download forbidden')});
 for(const type of ['image','video','audio','model']){const output={type,url:'https://files.tapnow.media/old-original',sourceFileId:'original-file'};assert.equal(outputSnapshot(output).url,output.url);await assert.rejects(archive.archive(output,{parameters:{}}),{code:'media_localization_required'});}
 for(const source of ['https://sub.tamaredge.top./file','https://tapnow.ai/file','https://conversation-service-131786869360.asia-northeast1.run.app/file'])await assert.rejects(archive.blob(source),{code:'media_localization_required'});
 assert.equal(reads,0);const {assertReadableMediaSource}=await import('../src/features/generation-results/media-ref.mjs');assert.equal(assertReadableMediaSource('https://tapnow.media.evil.test/old-file'),'https://tapnow.media.evil.test/old-file');assert.equal(assertReadableMediaSource('https://legitimate-provider.test/old-file'),'https://legitimate-provider.test/old-file');
});

test('explicit recovery keeps distinct local thumbnail and fullImage refs with their source-bound provenance',async()=>{
 const {importRecoveredOutputs}=await import('../src/features/generation-results/recovery.mjs');const nodes=[{id:'source'}],output={type:'image',url:ref(1),image:ref(1),fullImage:ref(2),sourceUrl:ref(2),mime:'image/png'},job={id:'original-task',status:'succeeded',request:{kind:'image.generate',nodeId:'source',parameters:{model:'original-model'}},outputs:[output]};let validated=0,created=0;
 const app={getState:()=>({nodes}),createConnected:(_id,values)=>{created++;nodes.push(...values.map((value,index)=>({...value,id:'result-'+index})));return nodes.slice(1);}};
 const options={app,validateMedia:async value=>{validated++;assert.equal(value.fullImage,ref(2));},persist:async()=>{}};await importRecoveredOutputs(job,options);await importRecoveredOutputs(job,options);assert.equal(created,1);assert.equal(validated,1);assert.equal(nodes[1].image,ref(1));assert.equal(nodes[1].fullImage,ref(2));assert.equal(nodes[1].provenance.mediaSource,ref(2));assert.equal(nodes[1].mime,'image/png');
});
