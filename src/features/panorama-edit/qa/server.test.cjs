const test=require('node:test'),assert=require('node:assert/strict'),{startPanoramaEditFrontendQA}=require('./server.cjs');
test('isolated Studio QA serves public seed, real native config and blocks project data and external APIs',async()=>{
 const host=await startPanoramaEditFrontendQA();try{
 const response=await fetch(host.url),html=await response.text();assert.equal(response.status,200);assert.match(response.headers.get('content-security-policy'),/connect-src 'self' data: blob:/);assert.match(html,/src\/features\/panorama-edit\/qa\/fixture.js/);assert.match(html,/panorama-studio/);assert.match(html,/defaults\/canvas-data.js/);assert.doesNotMatch(html,/src="canvas-data.js/);
 const config=await (await fetch(new URL('/api/generation/config',host.url))).json();assert.equal(config.providers['panorama-edit'].protocol,'openai-panorama-edit-native');assert.equal(config.providers['panorama-edit'].capabilities.panoramaEdit.tapNowEquivalent,false);assert.equal(config.providers['panorama-edit'].capabilities.panoramaEdit.sourceWidth,2048);
 for(const path of ['/canvas-data.js','/.env','/server/generation.cjs','/api/agent/config'])assert.ok((await fetch(new URL(path,host.url))).status>=400,path);
 assert.equal((await fetch(new URL('/src/features/panorama-edit/qa/controls.mjs',host.url))).status,200);assert.equal(host.audit().sdkPosts,0);
 }finally{await host.close();}
});
test('synthetic pipeline runs actual SDK crop and mask, archive and pixel-preserving spherical output',async()=>{
 const host=await startPanoramaEditFrontendQA();try{
 const base=new URL(host.url).origin,config=await(await fetch(base+'/api/generation/config')).json(),source=Buffer.from(await(await fetch(base+'/src/features/panorama-edit/qa/source.png')).arrayBuffer());
 const {PerspectiveCamera}=await import('three'),{PanoramaHistory,rectangleDirections,makePanoramaRequest}=await import('../../../../studio-panorama-math.mjs'),camera=new PerspectiveCamera(60,4/3);camera.updateMatrixWorld(true);
 const history=new PanoramaHistory({image:'source',regions:[{id:'region',directions:rectangleDirections({x:280,y:190},{x:480,y:370},{left:0,top:0,width:800,height:600},camera)}]}),request=makePanoramaRequest({nodeId:'panorama-studio',setupId:'qa-setup',sessionId:'qa-editor',history,camera,prompt:'固定合成区域验收',image:'data:image/png;base64,'+source.toString('base64')});
 const response=await fetch(base+'/api/generation/tasks',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':require('node:crypto').randomUUID(),'X-Generation-Configuration-Id':config.configurationId},body:JSON.stringify(request)});assert.equal(response.status,202);let job=await response.json();
 for(let i=0;i<100&&!['succeeded','failed','unknown'].includes(job.status);i++){await new Promise(resolve=>setTimeout(resolve,25));job=await(await fetch(base+'/api/generation/tasks/'+job.id)).json();}
 assert.equal(job.status,'succeeded',job.error);assert.equal(job.localization.state,'ready');assert.equal(job.outputs.length,1);assert.match(job.outputs[0].url,/^\/api\/generation\/media\/[a-f0-9-]+$/);
 const {decodePNG}=require('../../../../server/generation-png-alpha.cjs'),actual=decodePNG(Buffer.from(await(await fetch(base+job.outputs[0].url)).arrayBuffer())),original=decodePNG(source);assert.deepEqual([actual.width,actual.height],[2048,1024]);assert.deepEqual(actual.pixels.subarray(0,4000),original.pixels.subarray(0,4000));assert.notDeepEqual(actual.pixels,original.pixels);
 const audit=host.audit();assert.equal(audit.sdkPosts,1);assert.equal(audit.requests[0].size,'1024x1024');assert.equal(audit.requests[0].imageMime,'image/png');assert.equal(audit.requests[0].maskMime,'image/png');assert.ok(audit.requests[0].maskBytes>0);
 }finally{await host.close();}
});
