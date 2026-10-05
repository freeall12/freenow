'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {startSkinFrontendQA}=require('./server.cjs'),{decodePNG}=require('../../../../server/generation-png-alpha.cjs');
const wait=async(base,job)=>{for(let i=0;i<60&&!['succeeded','unknown','failed','configuration_required'].includes(job.status);i++){await new Promise(resolve=>setTimeout(resolve,20));job=await(await fetch(base+'/api/generation/tasks/'+job.id)).json();}return job;};
test('isolated static entry uses real panel, public seed and scoped defaults without private APIs',async()=>{
 const host=await startSkinFrontendQA();try{
  const base=new URL(host.url).origin,html=await(await fetch(host.url)).text();assert.match(html,/src\/features\/image-skin\/qa\/fixture\.js/);assert.match(html,/src\/features\/image-skin\/qa\/controls\.mjs/);assert.match(html,/defaults\/canvas-data\.js/);assert(!html.includes('src="canvas-data.js'));
  const seed=JSON.parse(/window\.CANVAS_DATA\.nodes=(\[.*?\]);window\.CANVAS_DATA\.edges=\[\];/.exec(html)[1]);assert.equal(seed.length,1);assert.equal(seed[0].id,'skin-source');assert.match(seed[0].fullImage,/^data:image\/png;base64,/);const image=decodePNG(Buffer.from(seed[0].fullImage.split(',')[1],'base64'));assert.deepEqual([image.width,image.height],[512,320]);
  const controls=await(await fetch(base+'/src/features/image-skin/qa/controls.mjs')).text();assert.match(controls,/image-enhance-ui\.mjs/);assert.match(controls,/app\.saveProject/);assert.equal((await fetch(base+'/api/private')).status,403);assert.equal((await fetch(base+'/canvas-data.js')).status,404);
 }finally{await host.close();}
});
test('full dedicated skin pipeline posts once, archives actual pixels and queries original unknown task',async()=>{
 const host=await startSkinFrontendQA({pipeline:true});try{
  const base=new URL(host.url).origin,config=await(await fetch(base+'/api/generation/config')).json();assert.equal(config.protocol,'routed');assert.equal(config.providers.skin.protocol,'skin-tasks-v1');assert.equal(config.configured,true);assert(!JSON.stringify(config).includes('synthetic-skin-qa-only-key'));
  const source=Buffer.from(await(await fetch(base+'/src/features/image-skin/qa/source.png')).arrayBuffer());
  for(const mode of ['detailed','standard','heavy']){
   if(mode==='heavy')await fetch(base+'/api/generation/fixture-control',{method:'POST',body:JSON.stringify({unknown:true})});
   const request={kind:'image.skin',nodeId:'enhance',sourceNodeId:'skin-source',prompt:'',inputs:[{type:'image',role:'source_image',nodeId:'skin-source',url:'data:image/png;base64,'+source.toString('base64'),width:512,height:320}],parameters:{mode}};
   const submissionKey=randomUUID(),response=await fetch(base+'/api/generation/tasks',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':submissionKey,'X-Generation-Configuration-Id':config.configurationId},body:JSON.stringify(request)});assert.equal(response.status,202);let job=await wait(base,await response.json());
   if(mode==='heavy'){
    assert.equal(job.status,'unknown',job.error);const original=job.id;
    for(let query=0;query<2;query++){const pending=await(await fetch(base+'/api/generation/tasks/by-key/'+submissionKey)).json();assert.equal(pending.status,'unknown');assert.equal(pending.id,original);assert.equal(pending.outputs,undefined);}
    const heldAudit=await(await fetch(base+'/api/generation/fixture-audit')).json();assert.equal(heldAudit.heldUnknown,1);assert.equal(heldAudit.supplierPosts,3);
    await fetch(base+'/api/generation/fixture-control',{method:'POST',body:JSON.stringify({releaseUnknown:true})});
    const recovered=await fetch(base+'/api/generation/tasks/by-key/'+submissionKey);assert.equal(recovered.status,200);job=await wait(base,await recovered.json());assert.equal(job.id,original);
   }
   assert.equal(job.status,'succeeded',job.error);assert.equal(job.outputs.length,1);assert.match(job.outputs[0].url,/^\/api\/generation\/media\/[a-f0-9-]+$/);const actual=decodePNG(Buffer.from(await(await fetch(base+job.outputs[0].url)).arrayBuffer()));assert.deepEqual([actual.width,actual.height],[768,512]);
  }
  const audit=await(await fetch(base+'/api/generation/fixture-audit')).json();assert.equal(audit.supplierPosts,3);assert(audit.supplierGets>=1);assert(audit.archiveEntries>0);assert.deepEqual(audit.requests.map(request=>request.mode),['detailed','standard','heavy']);assert(audit.sourceBytes.every(bytes=>bytes===source.length));
 }finally{await host.close();}
});
