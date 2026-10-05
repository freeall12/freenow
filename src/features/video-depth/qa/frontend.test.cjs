'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
function config(){return {configured:true,protocol:'fal-video-depth-native',capabilities:{kinds:['video.depth'],models:{'depth-anything-video':{kind:'video.depth',model:'fal-ai/depth-anything-video'}},videoDepth:{'depth-anything-video':{kind:'video.depth',model:'fal-ai/depth-anything-video',semantics:'per-frame-depth',tapNowEquivalent:false,sourceMimeTypes:['video/mp4'],audioPolicy:'discard',resolutions:['source'],colormaps:['grayscale'],preserveDuration:true,preserveDimensions:true,promptUsed:false,maxVideos:1,maxCount:1,maxSourceFrames:2400,maxInputBytes:33554432,maxOutputBytes:33554432,localMediaProfile:'mp4-cfr-even-square-pixels-5-30fps',maxWidth:1920,maxHeight:1080,minFps:5,maxFps:30,maxDuration:480}}}};}
const source={id:'video',type:'video',url:'https://media.test/source.mp4',width:320,height:180,duration:1};
async function request(extra={}){const {buildDepthRequest}=await import('../../agent-workflows/depth-video.mjs');const value=buildDepthRequest({source,modelId:'depth-anything-video'});Object.assign(value.parameters,extra);return value;}
test('explicit native profile and unsupported settings fail closed before source reads',async()=>{
 const {depthRequestState}=await import('../native-profile.mjs'),r=await request();assert.equal(depthRequestState(config(),r).ready,true);
 for(const mutate of [c=>c.configured=false,c=>delete c.capabilities.videoDepth,c=>c.capabilities.videoDepth['depth-anything-video'].maxSourceFrames=100,c=>c.capabilities.videoDepth['depth-anything-video'].audioPolicy='preserve']){const c=config();mutate(c);assert.equal(depthRequestState(c,r).ready,false);}
 assert.equal(depthRequestState(config(),await request({count:2})).ready,false);assert.equal(depthRequestState(config(),await request({resolution:'720p'})).ready,false);
 const {prepareDepthMedia}=await import('../media.mjs');for(const r of [await request({count:2}),await request()])await assert.rejects(prepareDepthMedia(r,{nativeConfiguration:{...config(),configured:false},resolveMedia:()=>assert.fail('no read'),transport:()=>assert.fail('no transport')}));
 const missing={protocol:'routed',configured:true,routes:{},providers:{native:config()}};await assert.rejects(prepareDepthMedia(await request(),{nativeConfiguration:missing,resolveMedia:()=>assert.fail('no read')}));
});
test('native MP4 preparation transfers complete bytes and rejects mismatched source metadata',async()=>{
 const {prepareDepthMedia}=await import('../media.mjs');const bytes=Buffer.from([0,0,0,24,102,116,121,112,105,115,111,109,0,0,0,0]),url=URL.createObjectURL(new Blob([bytes],{type:'video/mp4'}));
 try{const r=await request();r.inputs[0].url=url;const immutable=JSON.stringify(r);let fetched=0;
 const result=await prepareDepthMedia(r,{nativeConfiguration:config(),resolveMedia:async()=>({...source,url}),serialize:async blob=>'data:video/mp4;base64,'+Buffer.from(await blob.arrayBuffer()).toString('base64'),fetchImpl:async(u,options)=>{fetched++;assert.equal(options.credentials,'omit');return fetch(u,options);}});
 assert.equal(fetched,1);assert.deepEqual(Buffer.from(result.inputs[0].url.split(',')[1],'base64'),bytes);assert.equal(JSON.stringify(r),immutable);assert.equal(result.inputs[0].id,'video');
 await assert.rejects(prepareDepthMedia(r,{nativeConfiguration:config(),resolveMedia:async()=>({...source,url,duration:2}),transport:()=>assert.fail('no transport')}),/不一致/);
 }finally{URL.revokeObjectURL(url);}
});
test('cancel, identity change, original-host media and oversized inline MP4 stop before submission',async()=>{
 const {prepareDepthMedia}=await import('../media.mjs');for(const cancelled of [true,false]){const controller=new AbortController();let changed=false;
 await assert.rejects(prepareDepthMedia(await request(),{signal:controller.signal,nativeConfiguration:config(),validateSources:()=>{if(changed)throw Error('source changed');},resolveMedia:async()=>{if(cancelled)controller.abort(Error('cancelled'));else changed=true;return source;},transport:()=>assert.fail('no transport')}),/cancelled|source changed/);}
 const r=await request();r.inputs[0].url='https://cdn.tapnow.ai/source.mp4';await assert.rejects(prepareDepthMedia(r,{nativeConfiguration:config(),resolveMedia:()=>assert.fail('no origin read')}));
 const big=await request();big.inputs[0].url='data:video/mp4;base64,'+'A'.repeat(44739248);await assert.rejects(prepareDepthMedia(big,{nativeConfiguration:config(),resolveMedia:async()=>({...source,url:big.inputs[0].url})}),/32 MiB/);
});
test('workflow preflight precedes decoding; session change during output decoding creates no node',async()=>{
 const {createDepthVideoWorkflow}=await import('../../agent-workflows/depth-workflow.mjs');let reads=0,creates=0,stale=false;const node={...source,video:source.url};
 const adapters={getNode:()=>node,getNodes:()=>[node],assertInspected:()=>{},assertConfirmed:()=>{},persist:()=>{},createConnected:()=>{creates++;return [{id:'output'}];},resolveMedia:async n=>{reads++;if(n.id.startsWith('workflow-output'))stale=true;return source;},runInPlace:async(r,h)=>{await h.apply({type:'video',url:'https://media.test/output.mp4'});return {id:'task',status:'succeeded'};}};
 await assert.rejects(createDepthVideoWorkflow({...adapters,assertConversionConfigured:()=>{throw Error('missing route');}}).convert({sourceId:'video'}),/missing route/);assert.equal(reads,0);
 await assert.rejects(createDepthVideoWorkflow({...adapters,assertSession:()=>{if(stale)throw Error('new session');}}).convert({sourceId:'video'}),/new session/);assert.equal(creates,0);
});
test('failed persistence retry applies the same decoded result once without repeating provider submission',async()=>{
 const {createDepthVideoWorkflow}=await import('../../agent-workflows/depth-workflow.mjs');const node={...source,video:source.url};let creates=0,posts=0,saves=0;
 const workflow=createDepthVideoWorkflow({getNode:()=>node,getNodes:()=>[node],assertInspected:()=>{},assertConfirmed:()=>{},resolveMedia:async()=>source,createConnected:()=>{creates++;return [{id:'output'}];},persist:()=>{if(++saves===1)throw Error('save failed');},runInPlace:async(r,h)=>{posts++;const out={type:'video',url:'https://media.test/output.mp4'};await assert.rejects(h.apply(out),error=>error.applied&&error.nodeIds[0]==='output');await h.apply(out);return {id:'task',status:'succeeded'};}});
 const result=await workflow.convert({sourceId:'video'});assert.equal(result.taskId,'task');assert.equal(posts,1);assert.equal(creates,1);assert.equal(saves,2);
});
module.exports={config};

test('routed metadata retains native model authority in its operation profile',async()=>{
 const {depthRequestState}=await import('../native-profile.mjs'),{prepareDepthMedia}=await import('../media.mjs');const selected=config();selected.capabilities.models['depth-anything-video']={kind:'video.depth',label:'Video Depth Anything'};const metadata={configured:true,protocol:'routed',routes:{'video.depth':{models:{'depth-anything-video':'depth'},default:'depth'}},providers:{depth:selected}};
 const r=await request();r.inputs[0].url='data:video/mp4;base64,AAAA';assert.equal(depthRequestState(metadata,r).ready,true);const prepared=await prepareDepthMedia(r,{nativeConfiguration:metadata,resolveMedia:async()=>({...source,url:r.inputs[0].url})});assert.equal(prepared.inputs[0].url,r.inputs[0].url);selected.capabilities.videoDepth['depth-anything-video'].model='unverified-model';assert.equal(depthRequestState(metadata,r).ready,false);
});

test('depth preparation preserves equivalent explicit aliases and host receipts but never erases intent',async()=>{
 const {prepareDepthTaskRequest}=await import('../../agent-workflows/depth-video.mjs');const original=await request();original.parameters.modelId='depth-anything-video';original.parameters.providerParameters={model:'depth-anything-video'};original.parameters.canvasResults={targetNodeIds:['target']};original.references=[];original.count=1;assert.equal(prepareDepthTaskRequest(original),original);
 for(const mutate of [r=>r.extra='unknown',r=>r.parameters.output_fps=20,r=>r.parameters.providerParameters.model='other',r=>r.inputs[0].clip={start:0,end:1},r=>r.prompt='User extra text',r=>r.references=['extra'],r=>r.count=2]){const r=structuredClone(original);mutate(r);assert.throws(()=>prepareDepthTaskRequest(r));}
});

test('agent convert preflight rejects missing routes before inspection, and late decode cannot cross a new turn',async()=>{
 const {createDepthAgentHost}=await import('../../agent-workflows/depth-agent.mjs');let reads=0,submitted=0,created=0;const node={...source,video:source.url};const adapters={getNodes:()=>[node],getMessages:()=>[],validateFormSubmission:()=>{},localAssets:{url:value=>value},getConfiguration:async()=>null,resolveMedia:async()=>{reads++;return source;},runInPlace:()=>{submitted++;},createConnected:()=>{created++;},persist:()=>{},inspect:()=>assert.fail('no inspection')};
 const missing=createDepthAgentHost(adapters);missing.beginTurn('one');await assert.rejects(missing.prepare({stage:'convert',sourceId:'video'}),/配置/);assert.equal(reads,0);assert.equal(submitted,0);
 // A held configuration reply belongs to the old source/session and cannot
 // grant authority to a replacement source before metadata reading starts.
 let release;const host=createDepthAgentHost({...adapters,getConfiguration:()=>new Promise(resolve=>{release=resolve;})});host.beginTurn('one');const preparing=host.prepare({stage:'convert',sourceId:'video'});await Promise.resolve();host.beginTurn('two');release({configured:true,protocol:'tasks-v1'});await assert.rejects(preparing,/轮次/);assert.equal(reads,0);assert.equal(created,0);
});

test('QA bootstrap source uses real durable MP4 bytes so snapshot reload needs no migration exception',async()=>{
 const fs=require('node:fs'),path=require('node:path'),{migrateCanvasSnapshot}=await import('../../local-resource-migration/snapshot.mjs');const html=fs.readFileSync(path.join(__dirname,'main.html'),'utf8'),match=html.match(/video:"(data:video\/mp4;base64,[A-Za-z0-9+/]+=*)"/);assert.ok(match);assert.deepEqual(Buffer.from(match[1].split(',')[1],'base64'),fs.readFileSync(path.join(__dirname,'../../video-generation/qa/media/2.mp4')));
 const source={id:'source',video:match[1]},result={id:'result',video:'/api/generation/media/7c2908c9-f666-4967-a823-374e68091892'},snapshot={nodes:[source,result],edges:[],history:[{nodes:[source],edges:[]}]},options={index:{version:1,algorithm:'sha256-exact-utf8',entries:{}},hashSource:async()=> 'a'.repeat(64)};
 assert.equal((await migrateCanvasSnapshot(snapshot,options)).summary.unresolved,0);source.video='/src/features/video-generation/qa/media/2.mp4';const legacy=await migrateCanvasSnapshot(snapshot,options);assert.deepEqual(legacy.unresolved.map(item=>item.path),['$.nodes[0].video','$.history[0].nodes[0].video']);
});
