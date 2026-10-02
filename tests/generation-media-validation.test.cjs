const test=require('node:test'),assert=require('node:assert/strict');
const ready=import('../src/features/generation-results/validate-media.mjs');
const url='/api/generation/media/528237bf-670a-462b-ae7c-d3301d39076e';
function mediaFixture(){const assigned=[];return {assigned,naturalWidth:24,naturalHeight:16,videoWidth:48,videoHeight:32,duration:2,set src(value){assigned.push(value);},removeAttribute(name){this.removed=name;},load(){this.loaded=true;}};}
test('late local asset resolution after timeout cannot assign or fetch media',async()=>{
 const {validateResultMedia}=await ready,media=mediaFixture();let release;
 const pending=validateResultMedia({type:'image',url},{createMedia:()=>media,resolveSource:()=>new Promise(resolve=>release=resolve),timeoutMs:5});
 await assert.rejects(pending,/超时/);release(url);await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(media.assigned,[]);assert.equal(media.onload,null);assert.equal(media.removed,'src');
});
test('real decode dimensions replace provider claims and image/video handles are released',async()=>{
 const {validateResultMedia}=await ready;
 for(const type of ['image','video']){const media=mediaFixture(),output={type,url,width:999,height:999};const pending=validateResultMedia(output,{createMedia:()=>media,resolveSource:source=>source});await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(media.assigned,[url]);(type==='image'?media.onload:media.onloadedmetadata)();await pending;assert.equal(output.width,type==='image'?24:48);assert.equal(output.height,type==='image'?16:32);assert.equal(media.onerror,null);assert.equal(media.removed,'src');if(type==='video'){assert.equal(output.duration,2);assert.equal(media.loaded,true);}}
});
test('unreadable media and forbidden original sources fail before application',async()=>{
 const {validateResultMedia}=await ready,media=mediaFixture();
 await assert.rejects(validateResultMedia({type:'image',url:'https://cdn.tapnow.media/a.png'},{createMedia:()=>assert.fail('must reject before decode')}),/迁移/);
 const pending=validateResultMedia({type:'video',url},{createMedia:()=>media,resolveSource:()=>url});await new Promise(resolve=>setImmediate(resolve));media.duration=Infinity;media.onloadedmetadata();await assert.rejects(pending,/无效/);assert.equal(media.loaded,true);
});
test('Agent snapshots and status preserve local saving state without exposing provider outputs',async()=>{
 const {attachGenerationJob}=await import('../src/features/agent-generation/jobs.mjs');const {generationStatus}=await import('../src/features/agent-generation/model.mjs');
 const trace={name:'generation_submit',status:'success',result:{taskId:'job'}};
 attachGenerationJob(trace,{id:'job',status:'unknown',providerStatus:'succeeded',localization:{state:'failed',retryable:true},providerResult:{secret:true},outputs:[{url:'secret'}]});
 assert.equal(trace.generationJob.providerStatus,'succeeded');assert.equal(trace.generationJob.providerResult,undefined);assert.equal(trace.generationJob.outputs,undefined);assert.equal(generationStatus(trace).label,'素材保存失败');
});
