'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {execFile}=require('node:child_process'),{promisify}=require('node:util'),{createHash}=require('node:crypto');
const {createVideoDepthProvider,MODEL,ALIAS}=require('../server/generation-video-depth.cjs');
const {createGenerationMediaStore}=require('../server/generation-media-store.cjs');
const {createGenerationMediaMaterializer}=require('../server/generation-media-materializer.cjs');
const source=require('node:fs').readFileSync(path.join(__dirname,'../src/features/video-generation/qa/media/2.mp4'));
const depth=require('node:fs').readFileSync(path.join(__dirname,'../src/features/video-depth/qa/media/depth-contract.mp4'));
const mapping={[ALIAS]:{kind:'video.depth',model:MODEL}},key='batch-depth-fixture-key';
const actual={width:64,height:48,duration:2,fps:20,numFrames:40,pts:Array.from({length:40},(_,i)=>i/20),hasAudio:false};
const request=(count=2)=>({kind:'video.depth',nodeId:'depth-target',prompt:'',inputs:[{id:'upstream-source',type:'video',url:'data:video/mp4;base64,'+source.toString('base64'),width:64,height:48,duration:2}],parameters:{workflow:'depth-video-studio',protocol:'local-depth-v1',resolution:'source',duration:2,width:64,height:48,preserveDuration:true,promptUsed:false,count,times:count,resultMode:'variants',batch_count:1}});
async function directory(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'freenow-depth-batch-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return path.join(dir,'manifests');}
const response=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
function fixture(options={}){
 const calls=[],outputs=options.outputs||[depth,depth];let posts=0;
 const fetchImpl=async(url,init)=>{
  calls.push({url,method:init.method,body:init.body});
  if(init.method==='POST'){posts++;await options.onPost?.(posts);if(options.lostPost===posts)throw Error('lost enqueue response');return response({request_id:options.duplicate?'child-1':'child-'+posts,status:'IN_QUEUE'});}
  const id=/\/requests\/(child-[12])/.exec(url)?.[1];assert.ok(id,'only accepted child IDs may be queried');
  if(init.method==='PUT')return response({request_id:id,status:'CANCELLATION_REQUESTED'},202);
  if(url.includes('/status'))return response({request_id:id,status:'COMPLETED',...options.failedChild===id?{error:'supplier failed'}:{}});
  return response({request_id:id,video:{url:'https://depth-fixture.example/'+id+'.mp4',content_type:'video/mp4',file_size:outputs[Number(id.at(-1))-1].length},raw_depths:null});
 };
 const download=async url=>{const index=Number(/child-([12])/.exec(url)?.[1])-1;assert.ok(index===0||index===1);const bytes=outputs[index];return {mime:'video/mp4',expectedBytes:bytes.length,stream:(async function*(){yield bytes;})(),close(){}};};
 const provider=dir=>createVideoDepthProvider({apiKey:key,modelMap:mapping,fetchImpl,download,mediaTools:options.realMedia?undefined:{inspectVideo:async()=>actual},directory:dir});
 return {calls,provider,download,fetchImpl,get posts(){return posts;}};
}
async function record(dir,id){return JSON.parse(await fs.readFile(path.join(dir,id.slice(4)+'.json'),'utf8'));}

test('counts, result modes and ordered host plans are validated before either POST',async t=>{
 const dir=await directory(t),f=fixture(),p=f.provider(dir);assert.equal(p.metadata.capabilities.videoDepth[ALIAS].maxCount,2);
 for(const change of [r=>r.parameters.times=1,r=>r.parameters.count=3,r=>r.count=1,r=>r.parameters.batch_count=2,r=>r.parameters.layout='spread',r=>r.parameters.canvasResults=null,r=>r.nodeId=' bad',r=>r.inputs[0].nodeId='other']){const r=request();change(r);assert.throws(()=>p.prepare(r),error=>error.providerDispatched===false);}
 for(const mode of ['variants','spread','pile']){const r=request();r.parameters.resultMode=mode;r.parameters.layout=mode;r.parameters.batch_count=2;r.parameters.batch_id='run';r.parameters.canvasResults={runId:'run',targetNodeIds:['depth-target','depth-target-2'],requestPlans:[{requestId:'request-1',targets:[{nodeId:'depth-target',resultIndex:0}]},{requestId:'request-2',targets:[{nodeId:'depth-target-2',resultIndex:0}]}]};assert.doesNotThrow(()=>p.prepare(r));
  for(const change of [r=>r.parameters.canvasResults.requestPlans.reverse(),r=>r.parameters.canvasResults.requestPlans[1].requestId='request-1',r=>r.parameters.canvasResults.requestPlans[1].targets[0].resultIndex=1,r=>r.parameters.batch_count=1,r=>r.parameters.canvasResults.extra=1,r=>r.parameters.batch_id='other']){const bad=structuredClone(r);change(bad);assert.throws(()=>p.prepare(bad),error=>error.providerDispatched===false);}}
 assert.equal(f.posts,0);assert.equal(f.provider().metadata.capabilities.videoDepth[ALIAS].maxCount,1);assert.throws(()=>f.provider().prepare(request()),{code:'configuration_required'});
});

test('two separate native tasks decode and archive distinct real MP4s in child order',async t=>{
 const dir=await directory(t),second=path.join(path.dirname(dir),'second.mp4');await promisify(execFile)('ffmpeg',['-hide_banner','-loglevel','error','-nostdin','-i',path.join(__dirname,'../src/features/video-depth/qa/media/depth-contract.mp4'),'-an','-vf','negate','-c:v','libx264','-pix_fmt','yuv420p',second]);
 const alternative=await fs.readFile(second),f=fixture({outputs:[depth,alternative],realMedia:true}),p=f.provider(dir),identities=[];
 const accepted=await p.submit(request(),{onTaskIdentity:async id=>{identities.push(id);assert.equal(f.posts,0);assert.deepEqual((await record(dir,id)).children.map(child=>child.phase),['pending','pending']);}});
 assert.match(accepted.id,/^vd2\./);assert.deepEqual(identities,[accepted.id]);assert.equal(f.posts,2);assert.ok(f.calls.every(call=>!call.body||!call.body.includes('count')));
 const saved=await record(dir,accepted.id);assert.deepEqual(saved.children.map(child=>child.phase),['accepted','accepted']);assert.equal(saved.nodeId,'depth-target');assert.equal(saved.sourceNodeId,'upstream-source');assert.ok(!JSON.stringify(saved).includes(key));assert.ok(!JSON.stringify(saved).includes('data:'));
 assert.equal((await fs.stat(path.join(dir,accepted.id.slice(4)+'.json'))).mode&0o777,0o600);
 const result=await p.poll(accepted.id,{request:request()});assert.equal(result.status,'succeeded');assert.deepEqual(result.outputs.map(output=>output.sourceFileId),['child-1','child-2']);assert.ok(result.outputs.every(output=>output.width===64&&output.height===48&&output.duration===2));assert.notEqual(result.outputs[0].url,result.outputs[1].url);
 const mediaStore=createGenerationMediaStore({directory:path.join(path.dirname(dir),'archive')}),materializer=createGenerationMediaMaterializer({store:mediaStore});await mediaStore.ready;
 const taskId='11111111-1111-4111-8111-111111111111',local=await materializer.localize(result.outputs,{taskId});assert.equal(local.outputs.length,2);assert.equal((await materializer.verify(local.outputs,{taskId})).resources.length,2);assert.equal(f.posts,2);
});

test('reconstruction and rotated Key recover the same parent with GETs only',async t=>{
 const dir=await directory(t),f=fixture(),accepted=await f.provider(dir).submit(request()),p=createVideoDepthProvider({apiKey:'rotated-fixture-key',modelMap:mapping,fetchImpl:f.fetchImpl,download:f.download,mediaTools:{inspectVideo:async()=>actual},directory:dir});
 const result=await p.poll(accepted.id);assert.equal(result.id,accepted.id);assert.equal(result.status,'succeeded');assert.deepEqual(result.outputs.map(output=>output.sourceFileId),['child-1','child-2']);assert.equal(f.posts,2);assert.ok(f.calls.slice(2).every(call=>call.method==='GET'));
});

test('lost first POST persists the uncertain phase and never starts child two',async t=>{
 const dir=await directory(t),f=fixture({lostPost:1}),p=f.provider(dir);let id;const accepted=await p.submit(request(),{onTaskIdentity:value=>{id=value;}});assert.equal(accepted.status,'unknown');assert.equal(f.posts,1);assert.deepEqual((await record(dir,id)).children.map(child=>child.phase),['dispatching','pending']);assert.equal((await f.provider(dir).poll(id)).status,'unknown');assert.equal(f.calls.length,1);
});

test('lost second POST queries child one after restart without repeating either POST',async t=>{
 const dir=await directory(t),f=fixture({lostPost:2}),p=f.provider(dir),accepted=await p.submit(request());assert.equal(accepted.status,'unknown');assert.deepEqual((await record(dir,accepted.id)).children.map(child=>child.phase),['accepted','dispatching']);
 const result=await f.provider(dir).poll(accepted.id);assert.equal(result.status,'unknown');assert.equal(result.outputs,undefined);assert.equal(f.posts,2);assert.ok(f.calls.slice(2).every(call=>call.method==='GET'&&call.url.includes('child-1')));
});

test('parent persistence callback rejection prevents all provider POSTs',async t=>{
 const dir=await directory(t),f=fixture();await assert.rejects(f.provider(dir).submit(request(),{onTaskIdentity:async()=>{throw Object.assign(Error('save rejected'),{code:'storage_error'});}}),{code:'storage_error'});assert.equal(f.posts,0);const names=await fs.readdir(dir),id='vd2.'+names.find(name=>name.endsWith('.json')).slice(0,-5);assert.equal((await f.provider(dir).poll(id)).status,'unknown');assert.equal(f.calls.length,0);
});

test('accepted first response followed by manifest write failure prevents second POST',async t=>{
 const dir=await directory(t),displaced=dir+'-saved';let id;
 const f=fixture({onPost:async number=>{if(number===1){await fs.rename(dir,displaced);await fs.writeFile(dir,'blocked');}}});
 await assert.rejects(f.provider(dir).submit(request(),{onTaskIdentity:value=>{id=value;}}),{code:'storage_error'});assert.equal(f.posts,1);await fs.unlink(dir);await fs.rename(displaced,dir);assert.deepEqual((await record(dir,id)).children.map(child=>child.phase),['dispatching','pending']);assert.equal((await f.provider(dir).poll(id)).status,'unknown');assert.equal(f.posts,1);
});

test('concurrent cancellation during first POST prevents second dispatch and cancels only accepted ID',async t=>{
 const dir=await directory(t);let release,posted,id;const gate=new Promise(resolve=>{release=resolve;}),entered=new Promise(resolve=>{posted=resolve;});const f=fixture({onPost:async()=>{posted();await gate;}}),p=f.provider(dir),submission=p.submit(request(),{onTaskIdentity:value=>{id=value;}});await entered;
 const cancellation=p.cancel(id);await new Promise(resolve=>setImmediate(resolve));await new Promise(resolve=>setImmediate(resolve));release();assert.equal((await submission).status,'unknown');assert.equal((await cancellation).status,'unknown');assert.equal(f.posts,1);assert.deepEqual(f.calls.filter(call=>call.method==='PUT').map(call=>call.url.split('/').at(-2)),['child-1']);assert.equal((await record(dir,id)).cancelled,true);
 const recovered=await f.provider(dir).poll(id);assert.equal(recovered.status,'unknown');assert.equal(recovered.outputs,undefined);assert.equal(f.posts,1);
});

test('missing or corrupt manifests and swapped child geometry fail closed without network',async t=>{
 const dir=await directory(t),f=fixture(),accepted=await f.provider(dir).submit(request()),file=path.join(dir,accepted.id.slice(4)+'.json'),saved=await record(dir,accepted.id),before=f.calls.length;
 for(const change of [r=>r.version=2,r=>r.actual[0]=32,r=>r.children[0].id='vd1.bad',r=>r.children[1].id=r.children[0].id,r=>r.children[0].phase='pending',r=>r.fingerprint='other',r=>r.extra='x',r=>r.nodeId=' target']){const value=structuredClone(saved);change(value);await fs.writeFile(file,JSON.stringify(value));await assert.rejects(f.provider(dir).poll(accepted.id),{code:'unknown'});assert.equal(f.calls.length,before);}
 await fs.unlink(file);await assert.rejects(f.provider(dir).poll(accepted.id),{code:'unknown'});assert.equal(f.calls.length,before);await fs.symlink('/nonexistent/private',file);await assert.rejects(f.provider(dir).poll(accepted.id),{code:'unknown'});assert.equal(f.calls.length,before);
});

test('failed child and duplicate enqueue identities cannot become two outputs',async t=>{
 const dir=await directory(t),failed=fixture({failedChild:'child-2'}),p=failed.provider(dir),accepted=await p.submit(request()),result=await p.poll(accepted.id);assert.equal(result.status,'failed');assert.equal(result.outputs,undefined);assert.equal(failed.posts,2);
 const duplicate=fixture({duplicate:true}),q=duplicate.provider(path.join(path.dirname(dir),'duplicate')),lost=await q.submit(request());assert.equal(lost.status,'unknown');assert.equal((await q.poll(lost.id)).status,'unknown');assert.equal(duplicate.posts,2);
});

test('original request source or target mismatch is rejected before child GETs',async t=>{
 const dir=await directory(t),f=fixture(),p=f.provider(dir),accepted=await p.submit(request()),before=f.calls.length;
 for(const change of [r=>r.nodeId='other-target',r=>r.inputs[0].id='other-source',r=>r.inputs[0].duration=NaN,r=>r.parameters.width=32]){const r=request();change(r);await assert.rejects(p.poll(accepted.id,{request:r}),{code:'provider_identity_mismatch'});await assert.rejects(p.cancel(accepted.id,{request:r}),{code:'provider_identity_mismatch'});assert.equal(f.calls.length,before);}
 assert.equal((await p.poll(accepted.id)).status,'succeeded');assert.equal(f.posts,2);
});
