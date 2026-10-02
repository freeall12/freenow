'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {createGenerationSessionConfiguration,endpoint}=require('../server/generation-session-config.cjs');
const {createDurableGenerationService}=require('../server/generation-durable.cjs');
const {createGenerationGateway}=require('../server/generation.cjs');
const reply=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
const request={kind:'text.generate',prompt:'session configuration test'};
const environment={provider:null,configured:false,fingerprint:null,metadata:{protocol:'tasks-v1',configured:false,missing:['GENERATION_API_BASE_URL','GENERATION_API_KEY']}};
const memoryStore=()=>{const data=new Map();return {data,readAll:async()=>[...data.values()].map(v=>structuredClone(v)),write:async value=>data.set(value.id,structuredClone(value))};};
const gate=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {resolve,promise};};

test('submit captures immutable version before async preparation and explicit IDs survive A to B to environment switches',async()=>{
 const calls=[],preparing=gate(),release=gate(),store=memoryStore();
 const registry=createGenerationSessionConfiguration({environment,fetchImpl:async(url,options)=>{calls.push({url,method:options.method,key:options.headers.Authorization,redirect:options.redirect});return reply(options.method==='POST'?{id:'original',status:'running'}:options.method==='DELETE'?{id:'original',status:'cancelled'}:{id:'original',status:'succeeded',outputs:[{type:'text',text:'original result'}]});}});
 const a=registry.configure({baseUrl:'https://a.test/v1',apiKey:'secret-A'});
 const service=createDurableGenerationService({store,providerRegistry:registry,prepareRequest:async value=>{preparing.resolve();await release.promise;return value;}});
 const job=await service.submit(request,{idempotencyKey:'version-capture-1'});await preparing.promise;
 const b=registry.configure({baseUrl:'https://b.test/v1',apiKey:'secret-B'});registry.configure({mode:'environment'});release.resolve();await service.get(job.id);
 assert.equal(calls[0].url,'https://a.test/v1/tasks');assert.equal(calls[0].key,'Bearer secret-A');assert.equal(calls[0].redirect,'error');
 const recovered=await service.get(job.id);assert.equal(recovered.status,'succeeded');assert.equal(calls[1].url,'https://a.test/v1/tasks/original');assert.equal(calls.filter(c=>c.method==='POST').length,1);
 const pinned=await service.submit(request,{idempotencyKey:'version-capture-2',configurationId:b.configurationId});await service.get(pinned.id);assert.equal(calls.at(-1).url,'https://b.test/v1/tasks');
 await service.cancel(pinned.id);assert.equal(calls.at(-1).method,'DELETE');assert.equal(calls.at(-1).key,'Bearer secret-B');
 assert.equal((await service.submit(request,{idempotencyKey:'version-capture-1',configurationId:'unknown-but-duplicate'})).id,job.id);
 await assert.rejects(service.submit(request,{idempotencyKey:'version-capture-3',configurationId:'unknown'}),{code:'configuration_changed',providerDispatched:false});
 assert.equal(store.data.size,2);assert.ok(!JSON.stringify([...store.data.values()]).includes('secret-'));assert.ok(!JSON.stringify([...store.data.values()]).includes('https://'));await service.close();
});

test('same endpoint key rotations keep old in-flight key while metadata and task records never contain credentials',async()=>{
 const calls=[],store=memoryStore(),registry=createGenerationSessionConfiguration({environment,fetchImpl:async(_url,options)=>{calls.push(options.headers.Authorization);return reply({id:'same-id',status:'running'});}});
 const old=registry.configure({baseUrl:'https://same.test/v1',apiKey:'old-private'});const service=createDurableGenerationService({store,providerRegistry:registry});
 const job=await service.submit(request,{idempotencyKey:'same-endpoint-version'});await service.get(job.id);registry.configure({baseUrl:'https://same.test/v1',apiKey:'new-private'});await service.get(job.id);
 assert.deepEqual(calls,['Bearer old-private','Bearer old-private']);assert.ok(!JSON.stringify(registry.metadata()).includes('private'));assert.ok(!JSON.stringify(registry.metadata()).includes('same.test'));assert.ok(!JSON.stringify(registry.metadata()).includes('fingerprint'));assert.equal(registry.capture(old.configurationId).id,old.configurationId);await service.close();
});

test('restart without key blocks recovery; re-entering original endpoint permits only original GET and rejects stale submission IDs',async()=>{
 const store=memoryStore(),calls=[];let registry=createGenerationSessionConfiguration({environment,fetchImpl:async(url,options)=>{calls.push([url,options.method]);return reply({id:'original-id',status:'running'});}});
 const old=registry.configure({baseUrl:'https://original.test/v1',apiKey:'never-persist'});let service=createDurableGenerationService({store,providerRegistry:registry});const job=await service.submit(request,{idempotencyKey:'restart-session-1'});await service.get(job.id);await service.close();
 registry=createGenerationSessionConfiguration({environment,fetchImpl:async(url,options)=>{calls.push([url,options.method]);return reply({id:'original-id',status:'succeeded',outputs:[{type:'text',text:'recovered original'}]});}});service=createDurableGenerationService({store,providerRegistry:registry});
 assert.equal((await service.get(job.id)).code,'configuration_required');registry.configure({baseUrl:'https://replacement.test/v1',apiKey:'replacement'});assert.equal((await service.get(job.id)).status,'unknown');assert.equal(calls.length,1);
 registry.configure({baseUrl:'https://original.test/v1',apiKey:'reentered'});const recovered=await service.get(job.id);assert.equal(recovered.status,'succeeded');assert.deepEqual(calls,[['https://original.test/v1/tasks','POST'],['https://original.test/v1/tasks/original-id','GET']]);
 await assert.rejects(service.submit(request,{idempotencyKey:'restart-session-2',configurationId:old.configurationId}),{code:'configuration_changed'});await service.close();
});

test('explicit self-hosted endpoint accepts empty key without Authorization and preserves environment missing-key contract',async()=>{
 let sent;const registry=createGenerationSessionConfiguration({environment,localPort:4173,fetchImpl:async(url,options)=>{sent={url,options};return reply({id:'self-hosted',status:'running'});}});
 assert.equal(registry.metadata().configured,false);const metadata=registry.configure({baseUrl:'http://localhost:9182/custom',apiKey:''});assert.equal(metadata.configured,true);assert.equal(metadata.source,'session');
 await registry.resolve(registry.capture()).provider.submit(request);assert.equal(sent.url,'http://localhost:9182/custom/tasks');assert.equal(sent.options.headers.Authorization,undefined);registry.configure({mode:'environment'});assert.equal(registry.metadata().configured,false);
 for(const url of ['https://tapnow.ai/v1','https://files.tapnow.media/v1','https://tamaredge.top','https://conversation-service-131786869360.asia-northeast1.run.app','http://127.1:4173/api/generation','http://localhost.:4173/other','http://[::1]:4173'])assert.throws(()=>endpoint(url,{localPort:4173}),{code:'configuration_destination_forbidden'});
});

async function fixture(t,extra={}){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'session-config-http-'));let gateway;
 const server=http.createServer(async(req,res)=>{try{await gateway.handle(req,res,new URL(req.url,'http://localhost').pathname,{json:(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));},body:async req=>{let value='';for await(const chunk of req)value+=chunk;return JSON.parse(value);}});}catch(error){res.writeHead(400);res.end(JSON.stringify({code:error.code,error:'fixture failure'}));}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
 gateway=createGenerationGateway({directory:path.join(directory,'tasks'),localPort:server.address().port,fetchImpl:extra.fetchImpl||(()=>assert.fail('configuration must not dispatch')), ...extra});await gateway.ready;
 t.after(async()=>{await new Promise(resolve=>server.close(resolve));await gateway.close();await fs.rm(directory,{recursive:true,force:true});});
 const metadata=await (await fetch(base+'/api/generation/config')).json();
 const save=async(input,headers={})=>fetch(base+'/api/generation/config',{method:'POST',headers:{Origin:base,'Content-Type':'application/json','X-Generation-Config-Token':metadata.csrfToken,...headers},body:typeof input==='string'?input:JSON.stringify(input)});
 return {base,directory,metadata,save};
}

test('local configuration HTTP rejects CSRF, cross origin, non-JSON, oversized bodies, unknown fields and recursive target without changing active config',async t=>{
 const f=await fixture(t),input={baseUrl:'https://custom.test/v1',apiKey:'secret-that-never-echoes'};
 const cases=[['csrf',{...input},{'X-Generation-Config-Token':'wrong'},403],['origin',{...input},{Origin:'https://attacker.test'},403],['missing origin',{...input},{Origin:''},403],['cross-site',{...input},{'Sec-Fetch-Site':'cross-site'},403],['content type',{...input},{'Content-Type':'text/plain'},415],['oversize','x'.repeat(17000),{},413],['unknown field',{...input,modelMap:{}},{},400],['control key',{...input,apiKey:'secret\nunsafe'},{},400],['recursive',{baseUrl:f.base+'/api/generation',apiKey:''},{},400]];
 for(const [name,value,headers,status]of cases){const response=await f.save(value,headers);assert.equal(response.status,status,name);assert.ok(!(await response.text()).includes('secret'));}
 assert.equal((await (await fetch(f.base+'/api/generation/config')).json()).source,'environment');
 const response=await f.save(input);assert.equal(response.status,200);const metadata=await response.json();assert.equal(metadata.source,'session');assert.equal(metadata.configured,true);assert.equal(metadata.recovery,true);assert.match(metadata.configurationId,/^[a-f0-9-]{36}$/);assert.ok(!JSON.stringify(metadata).includes(input.apiKey));assert.ok(!JSON.stringify(metadata).includes('custom.test'));
 const reset=await f.save({mode:'environment'});assert.equal(reset.status,200);assert.equal((await reset.json()).source,'environment');assert.deepEqual((await fs.readdir(path.join(f.directory,'tasks'))).filter(name=>name.endsWith('.json')),[]);
});

test('gateway configuration ID contract rejects unknown versions before provider dispatch',async t=>{
 let calls=0;const f=await fixture(t,{fetchImpl:async()=>{calls++;return reply({id:'id',status:'succeeded',outputs:[{type:'text',text:'local result'}]});}});const metadata=await (await f.save({baseUrl:'https://custom.test/v1',apiKey:''})).json();
 const submit=id=>fetch(f.base+'/api/generation/tasks',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':'config-contract-'+id,'X-Generation-Configuration-Id':id},body:JSON.stringify(request)});
 const blocked=await submit('unknown');assert.equal(blocked.status,409);assert.equal((await blocked.json()).providerDispatched,false);assert.equal(calls,0);
 const accepted=await submit(metadata.configurationId);assert.equal(accepted.status,202);const job=await accepted.json();await fetch(f.base+'/api/generation/tasks/'+job.id);assert.equal(calls,1);
 const record=await fs.readFile(path.join(f.directory,'tasks',job.id+'.json'),'utf8');assert.ok(!record.includes('https://custom.test'));assert.ok(JSON.parse(record).providerBinding);
});

test('session-generated media uses the single private owner route after environment switch and does not publish pending resources',async t=>{
 const PNG='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/S4sAAAAASUVORK5CYII=';
 const f=await fixture(t,{fetchImpl:async()=>reply({status:'succeeded',outputs:[{type:'image',url:'data:image/png;base64,'+PNG}]})});const config=await (await f.save({baseUrl:'https://image.test/v1',apiKey:'image-private-key'})).json();
 const accepted=await fetch(f.base+'/api/generation/tasks',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':'session-media-owner','X-Generation-Configuration-Id':config.configurationId},body:JSON.stringify({kind:'image.generate',prompt:'actual inline PNG'})});const first=await accepted.json();
 let job;for(let i=0;i<10;i++){job=await (await fetch(f.base+'/api/generation/tasks/'+first.id)).json();if(job.status==='succeeded')break;}
 assert.equal(job.status,'succeeded');const media=job.outputs[0].url;assert.match(media,/^\/api\/generation\/media\/[a-f0-9-]+$/);await f.save({mode:'environment'});
 const bytes=await fetch(f.base+media);assert.equal(bytes.status,200);assert.deepEqual(Buffer.from(await bytes.arrayBuffer()),Buffer.from(PNG,'base64'));
 const record=await fs.readFile(path.join(f.directory,'tasks',job.id+'.json'),'utf8');assert.ok(!record.includes('image-private-key'));assert.equal(job.providerBinding,undefined);assert.equal(job.providerResult,undefined);
});

test('credential-echoed provider receipt is never persisted or returned, and failures are generic without retries',async()=>{
 const secret='private-value-must-never-persist',store=memoryStore();let posts=0;
 const registry=createGenerationSessionConfiguration({environment,fetchImpl:async()=>{posts++;return reply({id:secret,status:'succeeded',outputs:[{type:'text',text:secret}]});}});registry.configure({baseUrl:'https://echo.test',apiKey:secret});
 const service=createDurableGenerationService({store,providerRegistry:registry});const first=await service.submit(request,{idempotencyKey:'secret-echo-rejection'}),job=await service.get(first.id);assert.equal(job.status,'unknown');assert.equal(job.providerTaskId,undefined);assert.ok(!JSON.stringify(job).includes(secret));assert.ok(!JSON.stringify([...store.data.values()]).includes(secret));assert.equal(posts,1);await service.close();
});

test('nonpersistent legacy gateway keeps GET contract but explicitly rejects configuration writes',async()=>{
 const gateway=createGenerationGateway(),results=[],json=(_res,status,value)=>results.push({status,value});await gateway.handle({method:'GET'},{},'/api/generation/config',{json,body:()=>assert.fail()});assert.equal(results[0].value.recovery,false);assert.equal(results[0].value.source,'environment');await gateway.handle({method:'POST'},{},'/api/generation/config',{json,body:()=>assert.fail()});assert.equal(results[1].status,409);assert.equal(results[1].value.code,'recovery_unavailable');await gateway.close();
});

test('credential-bearing POST stops at a redirect and never reaches its replacement destination',async t=>{
 let leaked=0,original=0;const destination=http.createServer((req,res)=>{leaked++;res.end('{}');});await new Promise(resolve=>destination.listen(0,'127.0.0.1',resolve));
 const provider=http.createServer((req,res)=>{original++;res.writeHead(307,{Location:'http://127.0.0.1:'+destination.address().port+'/tasks'});res.end();});await new Promise(resolve=>provider.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{await Promise.all([new Promise(resolve=>provider.close(resolve)),new Promise(resolve=>destination.close(resolve))]);});
 const registry=createGenerationSessionConfiguration({environment});registry.configure({baseUrl:'http://127.0.0.1:'+provider.address().port,apiKey:'redirect-private-key'});const service=createDurableGenerationService({store:memoryStore(),providerRegistry:registry});const first=await service.submit(request,{idempotencyKey:'redirect-stops-credentials'});const job=await service.get(first.id);assert.equal(job.status,'unknown');assert.equal(original,1);assert.equal(leaked,0);await service.close();
});

test('a restored identity pins its re-entered key version independently of subsequent same-endpoint rotations',async()=>{
 const store=memoryStore();let registry=createGenerationSessionConfiguration({environment,fetchImpl:async()=>reply({id:'old-process-task',status:'running'})});registry.configure({baseUrl:'https://restored.test',apiKey:'pre-restart'});let service=createDurableGenerationService({store,providerRegistry:registry});const first=await service.submit(request,{idempotencyKey:'restored-key-pinning'});await service.get(first.id);await service.close();
 const used=[];registry=createGenerationSessionConfiguration({environment,fetchImpl:async(_url,options)=>{used.push(options.headers.Authorization);return reply({id:'old-process-task',status:'running'});}});registry.configure({baseUrl:'https://restored.test',apiKey:'first-reentered'});service=createDurableGenerationService({store,providerRegistry:registry});await service.get(first.id);registry.configure({baseUrl:'https://restored.test',apiKey:'later-new-key'});await service.get(first.id);assert.deepEqual(used,['Bearer first-reentered','Bearer first-reentered']);await service.close();
});

test('quoted and backslash credentials echoed in IDs, result strings or field names cannot reach the task store',async()=>{
 for(const secret of ['fixture"secret','fixture\\secret'])for(const field of ['id','text','key']){
  const store=memoryStore(),value={id:'ordinary-id',status:'succeeded',outputs:[{type:'text',text:'ordinary text'}]};if(field==='id')value.id=secret;else if(field==='text')value.outputs[0].text=secret;else value.outputs[0][secret]='ordinary';
  const registry=createGenerationSessionConfiguration({environment,fetchImpl:async()=>reply(value)});registry.configure({baseUrl:'https://echo.test',apiKey:secret});const service=createDurableGenerationService({store,providerRegistry:registry});const job=await service.submit(request,{idempotencyKey:'escaped-echo-'+field});const exposed=await service.get(job.id);assert.equal(exposed.status,'unknown');assert.equal(exposed.providerTaskId,undefined);assert.equal(exposed.providerResult,undefined);assert.ok(!JSON.stringify([...store.data.values()]).includes(JSON.stringify(secret).slice(1,-1)));await service.close();
 }
});

test('all gateway protocols and routed SDK bases reject original-site destinations before any network or SDK call',async()=>{
 const {createGenerationRouter}=require('../server/generation-router.cjs'),{protectGenerationFetch}=require('../server/generation-endpoint-policy.cjs');
 const fetchImpl=()=>assert.fail('blocked original destination must not reach network');
 for(const protocol of ['tasks-v1','openai-native','ark-native','fal-native','tripo-native','minimax-native']){
  const gateway=createGenerationGateway({protocol,baseUrl:'https://api.tapnow.ai/v1',apiKey:'private-key',fetchImpl});assert.equal(gateway.configured,false);await gateway.close();
  const router=createGenerationRouter({providers:{blocked:{protocol,baseUrl:'https://api.tapnow.ai/v1',apiKey:'private-key'}},routes:{'text.generate':'blocked'},fetchImpl});assert.equal(router.configured,false);
 }
 const client={baseURL:'https://tapnow.media/v1',images:{generate:()=>assert.fail('blocked SDK must not execute')}};
 const sdk=createGenerationGateway({protocol:'openai-native',client,apiKey:'private-key',fetchImpl});assert.equal(sdk.configured,false);await sdk.close();
 const protectedFetch=protectGenerationFetch((url,options)=>({url,options}));assert.throws(()=>protectedFetch('https://assets.tapnow.media/file'),{code:'configuration_destination_forbidden'});assert.equal(protectedFetch('https://operator.test/v1',{redirect:'follow'}).options.redirect,'error');
});

test('installed injected SDK is cloned with the protected fetch and its base URL is part of provider identity',async()=>{
 const {createOpenAINativeProvider}=require('../server/generation-openai.cjs'),OpenAI=require('openai');let calls=0,redirect;
 const client=new OpenAI({apiKey:'injected-sdk-private',baseURL:'https://custom-sdk.test/v1',fetch:()=>assert.fail('shared client transport must not execute')});
 const modelMap={text:{kind:'text.generate',model:'fixture-text'}},provider=createOpenAINativeProvider({client,modelMap,fetchImpl:async(_url,options)=>{calls++;redirect=options.redirect;return reply({status:'completed',output_text:'actual SDK fixture'});}});
 const output=await provider.submit({kind:'text.generate',prompt:'safe SDK',parameters:{model:'text'}});assert.equal(output.outputs[0].text,'actual SDK fixture');assert.equal(calls,1);assert.equal(redirect,'error');assert.notEqual(provider.fingerprint,createOpenAINativeProvider({client:new OpenAI({apiKey:'x',baseURL:'https://other-sdk.test/v1'}),modelMap}).fingerprint);
 assert.equal(createOpenAINativeProvider({client,baseUrl:'https://contradictory-sdk.test/v1',modelMap}).configured,false);
});
