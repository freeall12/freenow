const test=require('node:test'),assert=require('node:assert/strict');
const api=require('../generation-api.js');
const ready=import('../src/features/generation-config/client.mjs');
test('configuration credentials are only posted to the same-origin local process with its CSRF token',async()=>{
 const {saveLocalGenerationConfiguration}=await ready;let sent;
 const result=await saveLocalGenerationConfiguration({baseUrl:' https://gateway.example/api ',apiKey:'fixture-secret'},{token:'local-token',fetchImpl:async(url,options)=>{sent={url,options};return Response.json({configured:true,source:'session',configurationId:'version-A'});}});
 assert.equal(sent.url,'/api/generation/config');assert.equal(sent.options.redirect,'error');assert.equal(sent.options.credentials,'same-origin');assert.equal(sent.options.headers['X-Generation-Config-Token'],'local-token');assert.deepEqual(JSON.parse(sent.options.body),{baseUrl:'https://gateway.example/api',apiKey:'fixture-secret'});assert.equal(result.configurationId,'version-A');
 await assert.rejects(saveLocalGenerationConfiguration({baseUrl:'https://gateway.example',apiKey:'fixture-secret'},{token:'local-token',fetchImpl:async()=>{throw Error('fixture-secret');}}),error=>!error.message.includes('fixture-secret')&&/不要自动重复/.test(error.message));
});
test('each dispatch is pinned to prepared configuration while recovery does not adopt a new identity',async()=>{
 const {configurationBoundProvider}=await ready;const signal=new AbortController().signal;let selected='A';const calls=[];
 const p=configurationBoundProvider(api.httpProvider,{baseUrl:'http://localhost:4173/api/generation',getConfigurationId:()=>selected,fetchImpl:async(url,options)=>{calls.push({url,options});return Response.json({id:'task',status:'succeeded',outputs:[{type:'text',text:'result'}]});}});
 const first=p.generate({kind:'text.generate'},{signal,jobId:'first'});selected='B';await first;await p.generate({kind:'text.generate'},{signal,jobId:'second'});await p.lookup('first');
 assert.deepEqual(calls.map(c=>c.options.headers['X-Generation-Configuration-Id']),['A','B',undefined]);assert.ok(calls.every(c=>c.url.startsWith('http://localhost:4173/api/generation/')));
});
test('known pre-dispatch configuration rejection never becomes an uncertain paid submission',async()=>{
 const {configurationBoundProvider}=await ready;let calls=0;
 const p=configurationBoundProvider(api.httpProvider,{baseUrl:'http://localhost:4173/api/generation',getConfigurationId:()=> 'stale',fetchImpl:async()=>{calls++;return Response.json({code:'configuration_changed',providerDispatched:false,error:'configuration changed'},{status:409});}});
 await assert.rejects(p.generate({kind:'text.generate'},{signal:new AbortController().signal,jobId:'once'}),e=>e.code==='configuration_required'&&e.providerDispatched===false);assert.equal(calls,1);
});
test('TaskService preserves the known no-dispatch receipt when a prepared configuration expires',async()=>{
 const {configurationBoundProvider}=await ready;let calls=0;
 const provider=configurationBoundProvider(api.httpProvider,{baseUrl:'http://localhost:4173/api/generation',getConfigurationId:()=> 'stale',fetchImpl:async()=>{calls++;return Response.json({code:'configuration_changed',providerDispatched:false},{status:409});}});
 const service=new api.TaskService();service.setProvider(provider);
 const finished=new Promise(resolve=>service.subscribe(job=>{if(['configuration_required','failed','succeeded','unknown'].includes(job.status))resolve(job);}));
 service.submit({kind:'text.generate'});const job=await finished;
 assert.equal(job.status,'configuration_required');assert.equal(job.providerDispatched,false);assert.equal(job.providerActive,false);assert.equal(calls,1);
});
