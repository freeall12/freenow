'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {startMagnificFrontendQA}=require('./server.cjs'),{decodePNG}=require('../../../../server/generation-png-alpha.cjs');
const wait=async(base,job)=>{for(let i=0;i<140&&!['succeeded','unknown','failed','configuration_required'].includes(job.status);i++){await new Promise(resolve=>setTimeout(resolve,20));job=await(await fetch(base+'/api/generation/tasks/'+job.id)).json();}return job;};
test('Magnific isolated host serves the real enhancement and Agent scripts with synthetic seed and scoped storage',async()=>{
 const host=await startMagnificFrontendQA({agent:true});try{
  const base=new URL(host.url).origin,html=await(await fetch(host.url)).text();assert.match(html,/src\/features\/image-upscale\/qa\/fixture\.js/);assert.match(html,/src\/features\/image-upscale\/qa\/controls\.mjs/);assert.match(html,/src\/features\/agent-generation\/qa\/magnific-agent-fixture\.js/);assert.match(html,/defaults\/canvas-data\.js/);assert(!html.includes('src="canvas-data.js'));
  const seed=JSON.parse(/window\.CANVAS_DATA\.nodes=(\[.*?\]);window\.CANVAS_DATA\.edges=\[\];/.exec(html)[1]);assert.equal(seed.length,1);assert.equal(seed[0].id,'magnific-source');const image=decodePNG(Buffer.from(seed[0].fullImage.split(',')[1],'base64'));assert.deepEqual([image.width,image.height],[512,320]);
  const controls=await(await fetch(base+'/src/features/image-upscale/qa/controls.mjs')).text();assert.match(controls,/image-enhance-ui\.mjs/);assert.match(controls,/app\.saveProject/);assert.match(controls,/MagnificAgentFixture\.useTarget/);
  const fixture=await(await fetch(base+'/src/features/image-upscale/qa/fixture.js')).text();assert.match(fixture,/sourceNodeId:'magnific-source'/);assert.match(fixture,/qa-magnific:/);assert.equal((await fetch(base+'/api/private')).status,403);assert.equal((await fetch(base+'/canvas-data.js')).status,404);assert.match((await fetch(host.url)).headers.get('content-security-policy'),/connect-src 'self' data: blob:/);
 }finally{await host.close();}
});
test('Magnific full native gateway preserves four fields, validates pixels and recovers the original UUID without another POST',async()=>{
 const host=await startMagnificFrontendQA();try{
  const base=new URL(host.url).origin,config=await(await fetch(base+'/api/generation/config')).json();assert.equal(config.protocol,'routed');assert.equal(config.providers.magnific.protocol,'magnific-native');assert.equal(config.configured,true);assert(!JSON.stringify(config).includes('synthetic-magnific-qa-only-key'));
  const source=Buffer.from(await(await fetch(base+'/src/features/image-upscale/qa/source.png')).arrayBuffer()),parameters=[{provider:'magnific',scaleFactor:2,sharpen:7,smartGrain:7,ultraDetail:30},{provider:'magnific',scaleFactor:8,sharpen:19,smartGrain:41,ultraDetail:67}];
  for(const [index,p]of parameters.entries()){
   if(index===1)await fetch(base+'/api/generation/fixture-control',{method:'POST',body:JSON.stringify({unknown:true})});
   const request={kind:'image.upscale',nodeId:'enhance',sourceNodeId:'magnific-source',prompt:'',inputs:[{type:'image',role:'source_image',nodeId:'magnific-source',url:'data:image/png;base64,'+source.toString('base64'),width:512,height:320}],parameters:p},key=randomUUID();
   const response=await fetch(base+'/api/generation/tasks',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':key,'X-Generation-Configuration-Id':config.configurationId},body:JSON.stringify(request)});assert.equal(response.status,202);let job=await wait(base,await response.json());
   if(index===1){
    assert.equal(job.status,'unknown',job.error);const original=job.id;
    for(let count=0;count<2;count++){const pending=await(await fetch(base+'/api/generation/tasks/by-key/'+key)).json();assert.equal(pending.status,'unknown');assert.equal(pending.id,original);assert.equal(pending.outputs,undefined);}
    const held=await(await fetch(base+'/api/generation/fixture-audit')).json();assert.equal(held.heldUnknown,1);assert.equal(held.supplierPosts,2);
    await fetch(base+'/api/generation/fixture-control',{method:'POST',body:JSON.stringify({releaseUnknown:true})});job=await wait(base,await(await fetch(base+'/api/generation/tasks/by-key/'+key)).json());assert.equal(job.id,original);
   }
   assert.equal(job.status,'succeeded',job.error);assert.equal(job.outputs.length,1);assert.match(job.outputs[0].url,/^\/api\/generation\/media\/[a-f0-9-]+$/);const actual=decodePNG(Buffer.from(await(await fetch(base+job.outputs[0].url)).arrayBuffer()));assert.deepEqual([actual.width,actual.height],[768,512]);
  }
  const audit=await(await fetch(base+'/api/generation/fixture-audit')).json();assert.equal(audit.supplierPosts,2);assert(audit.supplierGets>=3);assert.equal(audit.resultDownloads,2);assert(audit.archiveEntries>0);assert(audit.sourceBytes.every(bytes=>bytes===source.length));assert.deepEqual(audit.requests.map(({parameters})=>parameters),parameters.map(({provider,...rest})=>rest));assert(audit.queriedIds.every(id=>id===audit.requests[1].id));
 }finally{await host.close();}
});
