'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{createRequire}=require('node:module');
const core=require('../audio-core.js'),{createSoniloProvider}=require('../server/generation-sonilo.cjs');
const metadata=createSoniloProvider({apiKey:'synthetic-sonilo-sfx-ui-key',modelMap:{'sonilo-sfx':{kind:'audio.generate',model:'sonilo-sfx'}}}).metadata;
const modules=Promise.all([import('../src/features/audio-generation/native-profile.mjs'),import('../src/features/agent-generation/audio.mjs'),import('../src/features/agent-generation/model.mjs'),import('../src/features/agent-generation/batch.mjs')]);
const segments=[{start:0,end:3.25,prompt:'脚步'},{start:3.25,end:8,prompt:'风声'}];
const request={kind:'audio.generate',prompt:'',inputs:[{id:'video',type:'video',url:'asset:video',duration:8}],parameters:{model:'sonilo-sfx',virtualModel:'sonilo-music',scene:'Sound',duration:8,count:1,segments}};
const node={id:'target',type:'audio',audioConfig:core.transition({prompt:''},'sonilo-music','Sound')},video={id:'video',type:'video',title:'合成MP4',video:'asset:video'};node.audioConfig.references=[{id:'video',type:'video'}];
const args={kind:'audio.generate',nodeId:'target',model:'sonilo',audioScene:'Sound',prompt:'',referenceIds:['video'],segments};
test('SFX native profile keeps fractional boundaries, exact count and separate text/video eligibility',async()=>{
 const [native]=await modules,routed={protocol:'routed',configured:true,providers:{sfx:metadata},routes:{'audio.generate':{models:{'sonilo-sfx':'sfx'}}}};
 for(const config of [metadata,routed]){
  assert.equal(native.audioNativeProfile(config,request).scene,'Sound');assert.equal(native.audioNativeRequestState(config,request).ready,true);assert.deepEqual(native.applyAudioNativeConfiguration(config,request).parameters,request.parameters);
  assert.equal(native.audioNativeRequestState(config,{...request,parameters:{...request.parameters,virtualModel:'sonilo-sfx'}}).ready,true);
  assert.equal(native.audioNativeRequestState(config,{...request,prompt:'声'.repeat(2000)}).ready,true);
  for(const patch of [{count:2},{times:2},{format:'mp3'},{lyrics:''},{providerParameters:{prompt_influence:.3}},{segments:[]},{segments:[{start:0,end:2,prompt:'a'},{start:3,end:8,prompt:'b'}]},{segments:[{start:0,end:2,prompt:'a'},{start:1,end:8,prompt:'b'}]},{segments:[{start:0,end:9,prompt:'a'}]},{segments:[{start:0,end:8,prompt:'a',label:'intro'}]},{segments:[{start:0,end:8,prompt:'a'.repeat(201)}]}])assert.equal(native.audioNativeRequestState(config,{...request,parameters:{...request.parameters,...patch}}).ready,false,JSON.stringify(patch));
  for(const key of ['clip','trim','sourceClip','segments'])assert.equal(native.audioNativeRequestState(config,{...request,inputs:[{...request.inputs[0],[key]:{start:0,end:3}}]}).ready,false,key);
  const text={...request,prompt:'玻璃敲击',inputs:[],parameters:{...request.parameters,duration:.5,segments:undefined}};assert.equal(native.audioNativeRequestState(config,text).ready,true);
  assert.equal(native.audioNativeRequestState(config,{...text,parameters:{...text.parameters,segments}}).ready,false);
  for(const duration of [.49,180.1])assert.equal(native.audioNativeRequestState(config,{...text,parameters:{...text.parameters,duration}}).ready,false);
  for(const duration of [.5,480])assert.equal(native.audioNativeRequestState(config,{...request,inputs:[{...request.inputs[0],duration}],parameters:{...request.parameters,duration,segments:undefined}}).ready,true);
  assert.equal(native.audioNativeRequestState(config,{...request,prompt:'a'.repeat(2001)}).ready,false);
 }
 assert.equal(native.audioNativeRequestState(createSoniloProvider({apiKey:'synthetic-key'}).metadata,request).ready,false,'default Music binding never implies SFX');
});
test('Agent confirmation keeps segments and implicit duration provenance; unsupported originals cannot be normalized away',async()=>{
 const [,audio,model]=await modules,nodes=[structuredClone(node),structuredClone(video)],draft=model.createGenerationDraft(args,{},nodes),confirmed=model.confirmedArguments(args,draft,nodes,[],{audioMetadata:metadata});
 assert.equal(Object.hasOwn(confirmed,'duration'),false);assert.deepEqual(confirmed.segments,segments);
 for(const patch of [{count:2},{promptInfluence:.2},{audioFormat:'mp3'},{loop:false},{lyrics:''}]){const original={...args,...patch};assert.throws(()=>model.confirmedArguments(original,model.createGenerationDraft(original,{},nodes),nodes,[],{audioMetadata:metadata}),JSON.stringify(patch));}
 const text={...args,prompt:'玻璃敲击',referenceIds:[],duration:.5,segments:undefined};const target=audio.audioRequestConfig(core,node.audioConfig,text);assert.equal(target.params.duration,.5);
});
function harness(native,audio,{mode='valid',duration=8}={}){
 const nodes=[structuredClone(node),structuredClone(video)],state={nodes,edges:[]};let reads=0,fetches=0,release,project='project';const hold=new Promise(resolve=>release=resolve);
 if(mode==='clip')nodes[1].clip={start:0,end:5};
 const context={app:{getState:()=>state,projectIdentity:()=>({id:project})},core,nativeUnderTest:native,audioUnderTest:audio,drafts:new Map(),saveTimers:new Map(),structuredClone,setTimeout,clearTimeout,
  window:{GenerationAPI:{availability:async()=>{if(['source-drift','project-drift'].includes(mode))await hold;return {configured:mode!=='missing',reason:'Sonilo 未配置'};},configuration:async()=>metadata},LocalAssets:{url:async()=>{reads++;return 'blob:synthetic';}}},
  document:{createElement:()=>({duration,set src(value){if(mode==='reference-drift')hold.then(()=>this.onloadedmetadata());else queueMicrotask(()=>this.onloadedmetadata());},removeAttribute(){},load(){}})},fetch:async()=>{fetches++;return {blob:async()=>({})};},FileReader:class{readAsDataURL(){this.result='data:video/mp4;base64,AAAA';this.onload();}}};
 const source=fs.readFileSync(require.resolve('../audio-ui.js'),'utf8'),start=source.indexOf(' async function buildRequest('),end=source.indexOf(' async function generate()',start),body=source.slice(start,end).replace("await import('./src/features/audio-generation/native-profile.mjs')",'nativeUnderTest').replace("await import('./src/features/agent-generation/audio.mjs')",'audioUnderTest');vm.createContext(context);vm.runInContext(body+'\nglobalThis.buildUnderTest=buildRequest;',context);
 return {context,nodes,release,changeProject:()=>project='other',stats:()=>({reads,fetches})};
}
test('production preparation permits trusted native long video and rejects drift, clips, hidden instructions and explicit duration conflicts before bytes',async()=>{
 const [native,audio]=await modules;
 for(const mode of ['valid','long','missing','clip','source-drift','reference-drift','project-drift','explicit-conflict','hidden']){
  const f=harness(native,audio,{mode,duration:mode==='long'?240.25:8});if(mode==='hidden')f.nodes[0].audioConfig.params.prompt_influence=.3;
  const overrides={...args,...mode==='explicit-conflict'?{duration:5}:{}},pending=f.context.buildUnderTest('target',overrides);
  if(['source-drift','reference-drift','project-drift'].includes(mode)){await new Promise(resolve=>setImmediate(resolve));if(mode==='source-drift')f.nodes[0].audioConfig.prompt='changed';else if(mode==='reference-drift')f.nodes[1].video='asset:new';else f.changeProject();f.release();}
  if(['valid','long'].includes(mode)){const output=await pending;assert.equal(output.parameters.duration,mode==='long'?240.25:8);assert.deepEqual(output.parameters.segments,segments);assert.equal(f.stats().fetches,1);assert.equal(f.nodes[0].audioConfig.params.duration,10);}else{await assert.rejects(pending);assert.equal(f.stats().fetches,0,mode);}
 }
 const config=core.transition({prompt:''},'sonilo-music','Sound');config.params.duration=240;assert.throws(()=>core.validate(config,[{type:'video',duration:240}]));
});
test('production approval waits for native configuration, lists exact end boundaries and cancels safely for both video and text',async()=>{
 const [,audio,model,batch]=await modules,requireFabric=createRequire(require.resolve('fabric')),canvasPath=requireFabric.resolve('canvas'),previous=require.cache[canvasPath];require.cache[canvasPath]={exports:{createCanvas:undefined}};let JSDOM;try{({JSDOM}=requireFabric('jsdom'));}finally{if(previous)require.cache[canvasPath]=previous;else delete require.cache[canvasPath];}
 for(const mode of ['video','text','missing','destroy']){
  const dom=new JSDOM('<main></main>',{url:'http://localhost:4173',runScripts:'outside-only',pretendToBeVisual:true}),context=dom.getInternalVMContext(),decisions=[];let release;const hold=new Promise(resolve=>release=resolve);
  Object.assign(context,audio,model,batch,{structuredClone,icons:{},referenceIcons:{},audioTypeIcon:'',createGenerationPromptEditor(){throw Error('unexpected editor');},generationPromptPreviews:()=>({hide(){},destroy(){}}),renderGenerationPrompt:text=>dom.window.document.createTextNode(text),generationMentionData(){},appendRecoveryActions(){},openParameterMenu:()=>({close(){}})});
  const source=fs.readFileSync(require.resolve('../src/features/agent-generation/card.mjs'),'utf8').replace(/^import[^\n]*\n/gm,'').replace(/^export \{[^\n]*\n/gm,'').replace(/^export /gm,'');vm.runInContext(source,context);
  const original=mode==='text'?{...args,prompt:'玻璃敲击',referenceIds:[],duration:.5,segments:undefined}:args,card=context.createGenerationCard({id:'sfx-'+mode,name:'generation_submit',status:'pending',args:original},{getNodes:()=>[node,video],getAudioConfiguration:()=>hold,onConfirm:(trace,allowed,confirmed)=>decisions.push({allowed,confirmed})});dom.window.document.querySelector('main').append(card.element);const button=label=>[...card.element.querySelectorAll('button')].find(button=>button.textContent===label);
  try{assert.equal(button('确认').disabled,true);if(mode==='destroy')card.destroy();release(mode==='missing'?{...metadata,configured:false,missing:['SONILO_API_KEY']}:metadata);await new Promise(resolve=>setImmediate(resolve));if(mode==='destroy'){assert.equal(card.element.isConnected,false);assert.equal(decisions.length,0);}else if(mode==='missing'){assert.equal(button('确认').disabled,true);assert.match(card.element.textContent,/SONILO_API_KEY/);button('取消').click();assert.equal(decisions[0].allowed,false);}else{assert.match(card.element.textContent,/Sonilo SFX 原生音效/);if(mode==='video'){assert.match(card.element.textContent,/0–3.25 秒/);assert.match(card.element.textContent,/3.25–8 秒/);}else assert.match(card.element.textContent,/时长：0.5 秒/);button('取消').click();assert.equal(decisions[0].allowed,false);}}
  finally{card.destroy();dom.window.close();}
 }
});
