const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {TaskService,httpProvider}=require('../generation-api.js');
const routingReady=import('../src/features/node-composer/provider-configuration.mjs');
const ui=fs.readFileSync(require.resolve('../generation-ui.js'),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const output={outputs:[{type:'text',text:'local contract result'}]};
const open={configured:true,protocol:'openai-native',missing:[],capabilities:{kinds:['image.generate','image.recognize','video.analyze','text.generate'],models:{'gpt-image-2':{kind:'image.generate'},'image.recognize':{kind:'image.recognize'},'video.analyze':{kind:'video.analyze'},available:{kind:'text.generate'}},imageReferences:{'gpt-image-2':{transport:'inline',maxImages:1}},analysis:{'image.recognize':{kind:'image.recognize',operation:'point-detection',transport:'inline',maxImages:1}},videoAnalysis:{'video.analyze':{kind:'video.analyze',transport:'inline'}}}};
const ark={configured:true,protocol:'ark-native',missing:[],capabilities:{kinds:['video.generate'],models:{'seedance-2.0':{kind:'video.generate'}}}};
const metadata=()=>({protocol:'routed',configured:true,providers:{open:structuredClone(open),ark:structuredClone(ark),missing:{configured:false,protocol:'ark-native',missing:['ARK_API_KEY'],capabilities:{kinds:['video.generate']}}},routes:{'image.generate':{default:'open',models:{'image-alias':'missing'}},'image.recognize':{default:'open',models:{}},'video.analyze':{default:'open',models:{}},'video.generate':{default:'ark',models:{blocked:'missing'}},'text.generate':{models:{available:'open'}}}});
async function harness(config){
 const routing=await routingReady,localProvider={generate:async()=>output},service=new TaskService(),taskNativeConfigurations=new WeakMap();service.setProvider(localProvider);
 const context={localProvider,service,taskNativeConfigurations,taskConfigurationIds:new WeakMap(),serverConfiguration:Promise.resolve(config),providerConfigurationReady:Promise.resolve(routing),structuredClone};
 context.refreshServerConfiguration=()=>context.serverConfiguration;
 vm.runInNewContext(ui.slice(ui.indexOf('  localProvider.isConfigured='),ui.indexOf('  function submitJob(')),context);
 return {...context,context,availability:context.availability};
}
async function settle(job){for(let i=0;i<50&&['queued','running'].includes(job.status);i++)await tick();assert.ok(!['queued','running'].includes(job.status));return job;}

test('route aliases use wire/modelId/model precedence, own keys and explicit defaults without sibling fallback',async()=>{
 const r=await routingReady,m=metadata();
 assert.equal(r.selectedProviderId(m,{kind:'video.generate',parameters:{providerParameters:{model:'blocked'},modelId:'other',model:'another'}}),'missing');
 assert.equal(r.providerConfigured(m,{kind:'video.generate',parameters:{providerParameters:{model:'blocked'},modelId:'other'}}),false);
 assert.equal(r.selectedProviderId(m,{kind:'video.generate',parameters:{modelId:'blocked',model:'other'}}),'missing');
 assert.equal(r.selectedProviderId(m,{kind:'video.generate',parameters:{model:'blocked'}}),'missing');
 assert.equal(r.providerConfigured(m,{kind:'video.generate',parameters:{modelId:'unmapped-default'}}),false);
 assert.equal(r.providerConfigured(m,{kind:'video.generate',parameters:{modelId:'seedance-2.0'}}),true);
 assert.equal(r.providerConfigured(m,{kind:'text.generate',parameters:{modelId:'unmapped'}}),false);
 assert.equal(r.providerConfigured(m,{kind:'text.generate'}),false);
 assert.equal(r.providerConfigured(m,{kind:'audio.generate'}),false);
 assert.equal(r.providerConfigured(m,{kind:'text.generate',parameters:{modelId:'available'}}),true);
 assert.equal(r.providerConfigured(m),true);
 m.routes['video.generate']={models:{}};assert.equal(r.providerConfigured(m,{kind:'video.generate',parameters:{modelId:'toString'}}),false);
 m.routes['video.generate']='ark';assert.equal(r.providerConfigured(m,{kind:'video.generate',parameters:{modelId:'seedance-2.0'}}),true);
});

test('real routed native metadata exposes only public aliases and matches frontend preflight readiness',async()=>{
 const {createGenerationRouter}=require('../server/generation-router.cjs'),r=await routingReady;
 const router=createGenerationRouter({providers:{open:{protocol:'openai-native',client:{},modelMap:{text:{kind:'text.generate',model:'hidden-native-text'},'video.analyze':{kind:'video.analyze',model:'hidden-native-vision'}}},ark:{protocol:'ark-native',apiKey:'local-contract-only',baseUrl:'https://local-contract.invalid',modelMap:{video:{kind:'video.generate',model:'hidden-native-video',modes:{TEXT_TO_VIDEO:{ratios:['16:9'],resolutions:['720p'],durations:[5],audio:true}}}}}},routes:{'text.generate':'open','video.analyze':'open','image.generate':'open','video.generate':'ark'}});
 assert.equal(router.configured,true);
 for(const [request,configured]of [[{kind:'text.generate',parameters:{modelId:'text'}},true],[{kind:'text.generate',parameters:{modelId:'missing'}},false],[{kind:'video.analyze'},true],[{kind:'image.generate',parameters:{modelId:'text'}},false],[{kind:'video.generate',parameters:{modelId:'video'}},true],[{kind:'video.generate',parameters:{modelId:'unmapped'}},false]])assert.equal(r.providerConfigured(router.metadata,request),configured,JSON.stringify(request));
 assert.ok(!JSON.stringify(router.metadata).includes('hidden-native'));assert.equal(r.providerConfigured(router.metadata),true);
});

test('a native provider ready for another operation cannot pass route readiness',async()=>{
 const r=await routingReady,m=metadata();m.routes['video.generate']={default:'open',models:{}};
 assert.equal(r.providerConfigured(m,{kind:'video.generate'}),false);
 const f=await harness(m);let decoded=0;f.service.prepareInputs=request=>{decoded++;return request;};
 assert.equal((await settle(f.service.submit({kind:'video.generate'}))).status,'configuration_required');assert.equal(decoded,0);
 m.providers.open={configured:true,protocol:'tasks-v1',capabilities:{kinds:[]}};assert.equal(r.providerConfigured(m,{kind:'video.generate'}),true);
});

test('globally ready router blocks absent and unconfigured selected routes before decoding or planning',async()=>{
 const f=await harness(metadata());let media=0,dispatch=0;f.service.prepareInputs=request=>{media++;return request;};f.localProvider.generate=async()=>{dispatch++;return output;};
 for(const request of [{kind:'audio.generate'},{kind:'text.generate',parameters:{modelId:'not-mapped'}},{kind:'video.generate',parameters:{modelId:'blocked'}},{kind:'video.generate',parameters:{modelId:'seedance-1.5-pro'}},{kind:'image.generate',parameters:{modelId:'not-mapped'}}])assert.equal((await settle(f.service.submit(request))).status,'configuration_required');
 assert.equal(media,0);assert.equal(dispatch,0);
 const ready=await settle(f.service.submit({kind:'video.generate',parameters:{modelId:'seedance-2.0'}}));assert.equal(ready.status,'succeeded');assert.equal(media,1);assert.equal(dispatch,1);
});

test('local availability keeps overall noarg behavior and scopes request/kind readiness',async()=>{
 const f=await harness(metadata());
 assert.equal((await f.availability()).configured,true);
 assert.equal((await f.availability({kind:'video.analyze'})).configured,true);
 assert.equal((await f.availability({kind:'audio.generate'})).configured,false);
 assert.equal((await f.availability({request:{kind:'video.generate',parameters:{modelId:'blocked'}}})).configured,false);
 assert.equal((await f.availability({kind:'video.generate'})).configured,true);
 assert.equal((await f.availability({kind:'text.generate'})).configured,true);
 const unmapped=await f.availability({request:{kind:'video.generate',parameters:{modelId:'not-mapped'}}});
 assert.equal(unmapped.configured,false);assert.match(unmapped.reason,/modelMap/);assert.match(unmapped.reason,/seedance-2\.0/);
 assert.equal((await f.availability({request:{kind:'video.generate'}})).configured,false);
 let release;f.service.setProvider({isConfigured:()=>new Promise(resolve=>release=resolve),generate:async()=>output});
 const pending=f.availability({kind:'video.generate'});await tick();f.service.setProvider({isConfigured:()=>false,generate:async()=>output});release(true);assert.equal((await pending).configured,false);
});

test('captured task keeps local provider and native metadata through pending config refresh/provider switch',async()=>{
 const f=await harness(metadata()),original=metadata();let release;
 f.context.serverConfiguration=new Promise(resolve=>release=resolve);let selected,dispatch=0,replacement=0;
 f.service.prepareInputs=(request,{signal})=>{selected=f.taskNativeConfigurations.get(signal);return request;};
 f.localProvider.generate=async()=>{dispatch++;return output;};
 const job=f.service.submit({kind:'image.generate',parameters:{modelId:'gpt-image-2'}});await tick();
 f.context.serverConfiguration=Promise.resolve({...metadata(),providers:{open:{configured:false,protocol:'openai-native'}}});
 f.service.setProvider({generate:async()=>{replacement++;return output;}});release(original);await settle(job);
 assert.equal(job.status,'succeeded');assert.equal(selected,original.providers.open);assert.equal(dispatch,1);assert.equal(replacement,0);
});

test('configuration callbacks receive a request copy and direct tasks-v1 remains independent of local router',async()=>{
 const service=new TaskService();let input;
 service.setProvider({isConfigured:({request})=>{input=structuredClone(request);request.parameters.modelId='mutated';return true;},generate:async request=>{assert.equal(request.parameters.modelId,'original');return output;}});
 const job=await settle(service.submit({kind:'text.generate',parameters:{modelId:'original'}}));assert.equal(job.status,'succeeded');assert.equal(input.parameters.modelId,'original');
 const f=await harness(metadata());let sent;
 f.service.setProvider(httpProvider({baseUrl:'https://local-contract.invalid',fetchImpl:async(url,options)=>{sent=JSON.parse(options.body);return {ok:true,json:async()=>output};}}));
 const direct=await settle(f.service.submit({kind:'audio.generate',parameters:{model:'direct-only'}}));assert.equal(direct.status,'succeeded');assert.equal(sent.parameters.model,'direct-only');assert.equal((await f.availability({kind:'audio.generate'})).configured,true);
});

test('routed native metadata preserves image/recognition/video profile guards while Ark video remains ordinary',async()=>{
 const [image,recognition,analysis]=await Promise.all([import('../src/features/node-composer/generation-media.mjs'),import('../src/features/node-composer/recognition-media.mjs'),import('../src/features/node-composer/video-analysis-media.mjs')]);
 const m=metadata(),noRead=()=>assert.fail('capability rejection must precede media reads');
 await assert.rejects(image.prepareGenerationMediaRequest({kind:'image.generate',inputs:[{type:'image',url:'asset:a'},{type:'image',url:'asset:b'}],parameters:{model:'gpt-image-2'}},{nativeConfiguration:m,resolveMedia:noRead}),/上限/);
 m.providers.open.capabilities.analysis={};await assert.rejects(recognition.prepareRecognitionMedia({kind:'image.recognize',inputs:[{type:'image',url:'asset:a'}]},{nativeConfiguration:m,resolveMedia:noRead}),/尚未配置/);
 m.providers.open.capabilities.videoAnalysis={};await assert.rejects(analysis.prepareVideoAnalysisMedia({kind:'video.analyze',inputs:[{type:'video',url:'asset:v'}]},{nativeConfiguration:m,transport:noRead}),{code:'configuration_required'});
 const video=await image.prepareGenerationMediaRequest({kind:'video.generate',prompt:'local test',inputs:[{type:'image',url:'https://media.invalid/frame.png'}],parameters:{model:'seedance-2.0',mode:'首尾帧'}},{nativeConfiguration:m,resolveMedia:async n=>({url:n.image,width:640,height:360}),transport:async(request,options)=>{assert.notEqual(options.inlineImages,true);return request;}});assert.equal(video.inputs[0].url,'https://media.invalid/frame.png');
});

test('readiness describes operation/provider/missing names without endpoint, key or native model IDs',async()=>{
 const r=await routingReady,m=metadata();Object.assign(m.providers.open,{apiKey:'must-not-render-secret',baseUrl:'https://must-not-render.invalid',modelMap:{'model-alias':{model:'must-not-render-native-id'}}});
 const rows=r.configurationReadiness(m),value=JSON.stringify(rows);assert.ok(rows.some(row=>row.operation==='视频生成'&&row.provider==='missing'&&!row.configured&&row.missing.includes('ARK_API_KEY')));assert.ok(rows.some(row=>row.operation==='图片生成'&&row.provider==='open'&&row.configured));assert.ok(!value.includes('must-not-render'));assert.ok(!value.includes('image-alias'));
 const legacy={protocol:'openai-native',configured:true};assert.equal(r.resolveProviderConfiguration(legacy,{kind:'audio.generate'}),legacy);assert.equal(r.providerConfigured(legacy,{kind:'audio.generate'}),true);assert.deepEqual(r.configurationReadiness(legacy),[]);
});

test('existing API dialog renders per-operation readiness and missing names and keeps direct connection controls',async()=>{
 const routing=await routingReady,m=metadata(),elements=[];
 const el=(tag,cls='',text)=>{const value={tag,className:cls,textContent:text||'',children:[],isConnected:true,append(...children){this.children.push(...children);},replaceChildren(...children){this.children=[...children];},setAttribute(){},showModal(){this.open=true;},close(){this.open=false;this.onclose?.();},remove(){this.isConnected=false;}};elements.push(value);return value;};
 const body=el('body'),button=(text,fn)=>Object.assign(el('button','',text),{onclick:fn});
 const context={el,button,document:{body,querySelector:()=>null},providerConfigurationReady:Promise.resolve(routing),serverConfiguration:Promise.resolve(m),refreshServerConfiguration:()=>Promise.resolve(m),configurationClientReady:Promise.resolve({saveLocalGenerationConfiguration:async input=>{assert.deepEqual({...input},{mode:'environment'});return m;}}),service:{setProvider(){}},localProvider:{},AbortSignal};
 vm.runInNewContext(ui.slice(ui.indexOf('  function configure('),ui.indexOf('  function runInPlace(')),context);context.configure();await tick();
 const dialog=body.children[0],readiness=dialog.children[2],rendered=readiness.children.map(row=>row.textContent).join('\n');
 assert.equal(dialog.open,true);assert.match(rendered,/图片生成 · open · 已就绪/);assert.match(rendered,/视频生成 · missing · 待配置 · 缺少 ARK_API_KEY/);assert.ok(!rendered.includes('image-alias'));assert.equal(elements.filter(element=>element.tag==='input').length,2);assert.ok(elements.some(element=>element.tag==='button'&&element.textContent==='保存配置'));
 await elements.find(element=>element.tag==='button'&&element.textContent==='使用本机服务').onclick();assert.equal(dialog.open,false);
});

test('direct ElevenLabs readiness is limited to the actual configured audio alias',async()=>{
 const {providerConfigured}=await import('../src/features/node-composer/provider-configuration.mjs');
 const metadata={configured:true,protocol:'elevenlabs-native',capabilities:{kinds:['audio.generate'],models:{eleven_v3:{kind:'audio.generate'}}}};
 assert.equal(providerConfigured(metadata,{kind:'audio.generate',parameters:{model:'eleven_v3'}}),true);
 for(const request of [{kind:'audio.generate',parameters:{model:'mureka-v8'}},{kind:'text.generate',parameters:{model:'eleven_v3'}},{kind:'audio.generate'}])assert.equal(providerConfigured(metadata,request),false);
});
