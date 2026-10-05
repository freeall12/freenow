const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

function harness(){
  const source=fs.readFileSync(path.join(__dirname,'../generation-ui.js'),'utf8');
  const refresh=source.slice(source.indexOf('  function refreshServerConfiguration(){'),source.indexOf('  let serverConfiguration=refreshServerConfiguration();'));
  const readiness=source.slice(source.indexOf('  localProvider.isConfigured=async'),source.indexOf('  async function availability('));
  const snapshot=source.slice(source.indexOf('  function configurationSnapshot(){'),source.indexOf('  function submitJob(request,options){'));
  const pending=[];
  const api=vm.runInNewContext(`
    let serverConfigured=false,serverConfigurationRevision=0,serverConfigurationSnapshot=null,serverConfiguration;
    const localProvider={},service={provider:localProvider};
    const taskNativeConfigurations=new WeakMap(),taskConfigurationIds=new WeakMap();
    const providerConfigurationReady=Promise.resolve({resolveProviderConfiguration:metadata=>metadata,
      providerConfigurationStatus:metadata=>({configured:metadata?.configured===true})});
    ${refresh}
    ${readiness}
    ${snapshot}
    ({refresh:refreshServerConfiguration,snapshot:configurationSnapshot,
      configured:()=>serverConfigured,switchProvider:()=>{service.provider={};},provider:localProvider,
      taskConfigurationId:signal=>taskConfigurationIds.get(signal),nativeConfiguration:signal=>taskNativeConfigurations.get(signal)})
  `,{structuredClone,AbortSignal,fetch:()=>new Promise((resolve,reject)=>pending.push({resolve,reject}))});
  return {...api,pending,respond(index,value){pending[index].resolve({ok:true,json:async()=>value});}};
}

test('synchronous approval snapshot follows latest resolved configuration and rejects stale refresh overwrite',async()=>{
  const h=harness(),initial=h.refresh();h.respond(0,{configured:true,configurationId:'approved-A',routing:{id:'a'}});await initial;
  assert.equal(h.snapshot().configurationId,'approved-A');
  const old=h.refresh(),latest=h.refresh();h.respond(2,{configured:true,configurationId:'current-B',routing:{id:'b'}});await latest;
  h.respond(1,{configured:true,configurationId:'stale-C'});await old;
  assert.equal(h.snapshot().configurationId,'current-B');
  const clone=h.snapshot();clone.routing.id='mutated';
  assert.equal(h.snapshot().routing.id,'b');
  h.switchProvider();assert.equal(h.snapshot(),null);
});

test('failed or malformed current refresh clears approval snapshot instead of reusing old readiness',async()=>{
  const h=harness(),initial=h.refresh();h.respond(0,{configured:true,configurationId:'approved-A'});await initial;
  const broken=h.refresh();h.pending[1].reject(Error('offline'));await broken;
  assert.equal(h.snapshot(),null);assert.equal(h.configured(),false);
  const recovered=h.refresh();h.respond(2,{configured:true,configurationId:'current-B'});await recovered;
  const invalid=h.refresh();h.respond(3,{configurationId:'missing-readiness'});await invalid;
  assert.equal(h.snapshot(),null);assert.equal(h.configured(),false);
});

test('stale task readiness cannot bind an unapproved header; a current session still dispatches its exact ID',async()=>{
  const {TaskService,httpProvider}=require('../generation-api.js');
  const {configurationBoundProvider}=await import('../src/features/generation-config/client.mjs');
  const h=harness(),approved={configured:true,configurationId:'approved-environment-A'},headers=[];
  const initial=h.refresh();h.respond(0,approved);await initial;
  const transport=configurationBoundProvider(httpProvider,{baseUrl:'http://localhost:9999/api/generation',
    getConfigurationId:signal=>h.taskConfigurationId(signal),fetchImpl:async(_url,options)=>{
      headers.push(options.headers['X-Generation-Configuration-Id']);
      return Response.json({status:'succeeded',outputs:[{type:'video',url:'data:video/mp4;base64,c3ludGhldGlj'}]});
    }});
  h.provider.generate=transport.generate;
  const service=new TaskService();service.setProvider(h.provider);
  const settle=job=>new Promise(resolve=>{const unsubscribe=service.subscribe(value=>{
    if(value.id===job.id&&['succeeded','failed','configuration_required'].includes(value.status)){unsubscribe();resolve(value);}
  });});
  const stale=service.submit({kind:'video.erase'},{beforeDispatch:()=>assert.equal(h.snapshot()?.configurationId,approved.configurationId)}),staleSettled=settle(stale);
  await new Promise(resolve=>setImmediate(resolve));assert.equal(h.pending.length,2);
  const latest=h.refresh();h.respond(2,approved);await latest;
  h.respond(1,{configured:true,configurationId:'unapproved-session-B'});
  const failed=await staleSettled;
  assert.equal(failed.status,'configuration_required');assert.equal(failed.providerDispatched,false);
  assert.match(failed.error,/配置.*变化/);assert.equal(h.snapshot().configurationId,approved.configurationId);
  assert.equal(h.taskConfigurationId(stale.controller.signal),undefined);
  assert.equal(h.nativeConfiguration(stale.controller.signal),undefined);
  assert.deepEqual(headers,[]);assert.equal(h.pending.length,3,'stale lookup must not retry');

  const current={configured:true,configurationId:'current-session-C'},currentRefresh=h.refresh();h.respond(3,current);await currentRefresh;
  const valid=service.submit({kind:'video.erase'},{beforeDispatch:()=>assert.equal(h.snapshot()?.configurationId,current.configurationId)}),validSettled=settle(valid);
  await new Promise(resolve=>setImmediate(resolve));h.respond(4,current);
  assert.equal((await validSettled).status,'succeeded');
  assert.equal(h.taskConfigurationId(valid.controller.signal),current.configurationId);
  assert.deepEqual(headers,[current.configurationId]);
});

test('parallel tasks with identical public configuration each dispatch once with the approved header',async()=>{
  const {TaskService,httpProvider}=require('../generation-api.js');
  const {configurationBoundProvider}=await import('../src/features/generation-config/client.mjs');
  const h=harness(),approved={configured:true,configurationId:'approved-A',routing:{id:'same'}},headers=[];
  const initial=h.refresh();h.respond(0,approved);await initial;
  const transport=configurationBoundProvider(httpProvider,{baseUrl:'http://localhost:9999/api/generation',
    getConfigurationId:signal=>h.taskConfigurationId(signal),fetchImpl:async(_url,options)=>{
      headers.push({configurationId:options.headers['X-Generation-Configuration-Id'],taskId:options.headers['Idempotency-Key']});
      return Response.json({status:'succeeded',outputs:[{type:'video',url:'data:video/mp4;base64,c3ludGhldGlj'}]});
    }});
  h.provider.generate=transport.generate;
  const service=new TaskService();service.setProvider(h.provider);
  const terminal=new Map();
  const settled=new Promise(resolve=>{service.subscribe(value=>{
    if(['succeeded','failed','configuration_required'].includes(value.status))terminal.set(value.id,value);
    if(terminal.size===2)resolve();
  });});
  const guard=()=>assert.equal(JSON.stringify(h.snapshot()),JSON.stringify(approved));
  const first=service.submit({kind:'video.erase'},{beforeDispatch:guard}),second=service.submit({kind:'video.erase'},{beforeDispatch:guard});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(h.pending.length,3);
  h.respond(2,approved);await new Promise(resolve=>setImmediate(resolve));h.respond(1,approved);await settled;
  for(const job of [first,second]){
    assert.equal(terminal.get(job.id).status,'succeeded');assert.equal(h.taskConfigurationId(job.controller.signal),approved.configurationId);
    assert.equal(headers.filter(header=>header.taskId===job.id).length,1);
  }
  assert.equal(headers.length,2);assert(headers.every(header=>header.configurationId===approved.configurationId));
  assert.equal(h.pending.length,3,'identical stale lookup must not retry');
});

test('stale readiness rejects identical old metadata after the newest refresh fails',async()=>{
  const h=harness(),approved={configured:true,configurationId:'approved-A'},initial=h.refresh();h.respond(0,approved);await initial;
  const signal=new AbortController().signal,old=h.provider.isConfigured({request:{kind:'video.erase'},signal});
  const latest=h.refresh();h.pending[2].reject(Error('offline'));await latest;
  h.respond(1,approved);
  await assert.rejects(old,error=>error.code==='configuration_required'&&error.providerDispatched===false);
  assert.equal(h.snapshot(),null);assert.equal(h.taskConfigurationId(signal),undefined);assert.equal(h.nativeConfiguration(signal),undefined);
  assert.equal(h.pending.length,3);
});

test('matching configuration IDs do not authorize stale capability metadata',async()=>{
  const h=harness(),approved={configured:true,configurationId:'approved-A',capabilities:{protocol:'current'}},initial=h.refresh();h.respond(0,approved);await initial;
  const signal=new AbortController().signal,old=h.provider.isConfigured({request:{kind:'video.erase'},signal});
  const latest=h.refresh();h.respond(2,approved);await latest;
  h.respond(1,{...approved,capabilities:{protocol:'stale'}});
  await assert.rejects(old,error=>error.code==='configuration_required'&&error.providerDispatched===false);
  assert.equal(h.taskConfigurationId(signal),undefined);assert.equal(h.nativeConfiguration(signal),undefined);
  assert.equal(h.snapshot().capabilities.protocol,'current');assert.equal(h.pending.length,3);
});

test('saving a local connection immediately updates the approval snapshot and captured transport',async()=>{
  const source=fs.readFileSync(path.join(__dirname,'../generation-ui.js'),'utf8');
  const commit=source.slice(source.indexOf('    const commit=async input=>{'),source.indexOf("    const environment=button('使用本机服务'"));
  const previous={configured:true,configurationId:'old-environment',source:'environment',csrfToken:'synthetic-csrf-token'};
  const saved={configured:true,configurationId:'new-session',source:'session',capabilities:{kinds:['image.relight']}};
  const controls=Array.from({length:6},()=>({disabled:false,value:'synthetic-input'}));let closed=false,selected,displayed;
  const context={structuredClone,AbortSignal,saving:false,viewRevision:0,serverConfigurationRevision:4,serverConfigured:true,
    serverConfigurationSnapshot:structuredClone(previous),serverConfiguration:Promise.resolve(previous),
    close:controls[0],environment:controls[1],save:controls[2],url:controls[3],key:controls[4],error:{textContent:''},
    refreshServerConfiguration:async()=>previous,configurationClientReady:Promise.resolve({saveLocalGenerationConfiguration:async(input,options)=>{
      assert.deepEqual(input,{mode:'environment'});assert.equal(options.token,previous.csrfToken);return saved;
    }}),localProvider:{id:'same-origin'},service:{setProvider:provider=>{selected=provider;}},showConfiguration:async value=>{displayed=value;},d:{isConnected:true,close:()=>{closed=true;}}};
  vm.runInNewContext(commit+'\nthis.commit=commit;',context);
  await context.commit({mode:'environment'});
  assert.equal(context.serverConfigurationRevision,5);assert.deepEqual(context.serverConfigurationSnapshot,saved);
  assert.equal(await context.serverConfiguration,saved);assert.equal(selected,context.localProvider);assert.equal(displayed,saved);assert.equal(closed,true);
  assert.equal(context.key.value,'');assert(controls.every(control=>control.disabled===false));
  saved.capabilities.kinds.push('changed-after-save');assert.deepEqual(context.serverConfigurationSnapshot.capabilities.kinds,['image.relight']);
});
