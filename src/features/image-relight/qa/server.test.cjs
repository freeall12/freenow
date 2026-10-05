'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {startRelightFrontendQA}=require('./server.cjs'),{decodePNG}=require('../../../../server/generation-png-alpha.cjs');
test('isolated QA pipeline uses real SDK multipart, routed gateway, actual media and durable archive',async()=>{
 const host=await startRelightFrontendQA({pipeline:true,agent:true});
 try{
  const base=new URL(host.url).origin,config=await (await fetch(base+'/api/generation/config')).json();assert.equal(config.protocol,'routed');assert.equal(config.providers.relight.protocol,'openai-relight-native');assert.equal(config.configured,true);assert(!JSON.stringify(config).includes('synthetic-relight-qa-only-key'));
  const html=await (await fetch(host.url)).text();assert.match(html,/src\/features\/agent-generation\/qa\/relight-agent-fixture\.js/);assert.match(html,/defaults\/canvas-data\.js/);assert(!html.includes('src="canvas-data.js'));
  const seed=JSON.parse(/window\.CANVAS_DATA\.nodes=(\[.*?\]);window\.CANVAS_DATA\.edges=\[\];/.exec(html)[1]);
  assert.match(seed[0].image,/^data:image\/png;base64,/);assert.equal(seed[0].fullImage,seed[0].image);
  const seedPixels=decodePNG(Buffer.from(seed[0].fullImage.split(',')[1],'base64'));assert.deepEqual([seedPixels.width,seedPixels.height],[512,320]);
  const saved={version:1,nodes:[{...seed[0],image:'asset:qa-source',fullImage:'asset:qa-source'}],edges:[],history:[{nodes:structuredClone(seed),edges:[]}],future:[{nodes:structuredClone(seed),edges:[]}]};
  const {migrateCanvasSnapshot}=await import('../../local-resource-migration/snapshot.mjs'),migration=await migrateCanvasSnapshot(saved,{index:{version:1,algorithm:'sha256-exact-utf8',entries:{}}});
  assert.equal(migration.summary.unresolved,0,'QA seed captured in undo/redo must be a durable image');assert.equal(migration.summary.changed,0);assert.deepEqual(migration.snapshot,saved);
  const source=Buffer.from(await (await fetch(base+'/src/features/image-relight/qa/source.png')).arrayBuffer()),request={kind:'image.relight',nodeId:'relight-source',sourceNodeId:'relight-source',prompt:'',inputs:[{type:'image',role:'source_image',nodeId:'relight-source',url:'data:image/png;base64,'+source.toString('base64'),width:512,height:320}],parameters:{angle:{preset:'top_front_right_45'},brightnessPercent:100,temperatureK:3000,rimEnabled:true,rimPreset:'low_back_45'}};
  const response=await fetch(base+'/api/generation/tasks',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':randomUUID(),'X-Generation-Configuration-Id':config.configurationId},body:JSON.stringify(request)});assert.equal(response.status,202);let job=await response.json();
  for(let i=0;i<50&&job.status!=='succeeded';i++){await new Promise(resolve=>setTimeout(resolve,20));job=await (await fetch(base+'/api/generation/tasks/'+job.id)).json();}
  assert.equal(job.status,'succeeded',job.error);assert.equal(job.outputs.length,1);assert.match(job.outputs[0].url,/^\/api\/generation\/media\/[a-f0-9-]+$/);assert.equal(job.localization.state,'ready');
  const actual=decodePNG(Buffer.from(await (await fetch(base+job.outputs[0].url)).arrayBuffer()));assert.deepEqual([actual.width,actual.height],[768,512]);
  const audit=await (await fetch(base+'/api/generation/fixture-audit')).json();assert.equal(audit.sdkPosts,1);assert.equal(audit.sourceBytes[0],source.length);assert.equal(audit.requests[0].mainLight.preset,'top_front_right_45');assert.equal(audit.requests[0].rimLight.preset,'low_back_45');assert.equal(audit.requests[0].size,'auto');assert(audit.archiveEntries>0);
  assert.equal((await fetch(base+'/api/private')).status,403);assert.equal((await fetch(base+'/canvas-data.js')).status,404);
 }finally{await host.close();}
});
