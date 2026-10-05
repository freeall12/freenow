'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{createRequire}=require('node:module');
const core=require('../audio-core.js'),tools=require('../agent-tools.js'),{createSoniloProvider}=require('../server/generation-sonilo.cjs');
const metadata=createSoniloProvider({apiKey:'synthetic-sonilo-ui-key'}).metadata;
const modules=Promise.all([import('../src/features/audio-generation/native-profile.mjs'),import('../src/features/agent-generation/audio.mjs'),import('../src/features/agent-generation/model.mjs'),import('../src/features/agent-generation/batch.mjs')]);
const segments=[{start:0,prompt:'铺垫',label:'intro'},{start:5,prompt:'旋律',label:'verse'}];
const args={kind:'audio.generate',nodeId:'target',model:'sonilo',audioScene:'Music',prompt:'',referenceIds:['video'],count:2,segments};
const node={id:'target',type:'audio',audioConfig:core.transition({prompt:''},'sonilo-music','Music')},video={id:'video',type:'video',title:'合成MP4',video:'asset:video'};
node.audioConfig.references=[{id:'video',type:'video'}];
const request={kind:'audio.generate',prompt:'音乐',inputs:[],parameters:{model:'sonilo-music',virtualModel:'sonilo-music',scene:'Music',duration:10,count:2,segments}};
test('Sonilo direct+routed profile validates ranges, exact counts and segments without dispatch or normalization',async()=>{
 const [native]=await modules,routed={protocol:'routed',configured:true,providers:{music:metadata},routes:{'audio.generate':{models:{'sonilo-music':'music'}}}};
 for(const config of [metadata,routed]){
  assert.equal(native.audioNativeProfile(config,request).maxCount,10);assert.equal(native.audioNativeRequestState(config,request).ready,true);
  for(const p of [{duration:4},{duration:361},{duration:5.1},{count:0},{count:11},{count:1.5},{times:3},{lyrics:''},{providerParameters:{seed:1}},{segments:[]},{segments:[{start:1,prompt:'x'}]},{segments:[{start:0,prompt:'x'},{start:4,prompt:'x'}]},{segments:[{start:0,prompt:'x'},{start:6,prompt:'x'}]},{segments:[{start:0,prompt:'x',label:'invented'}]},{segments:[{start:0,prompt:'x',end:5}]},{segments:[{start:0,prompt:'x'.repeat(201)}]}])assert.equal(native.audioNativeRequestState(config,{...request,parameters:{...request.parameters,...p}}).ready,false,JSON.stringify(p));
  for(const count of [1,10])assert.equal(native.audioNativeRequestState(config,{...request,parameters:{...request.parameters,count}}).ready,true);
  for(const duration of [5,360])assert.equal(native.audioNativeRequestState(config,{...request,parameters:{...request.parameters,duration,segments:undefined}}).ready,true);
  assert.deepEqual(native.applyAudioNativeConfiguration(config,request).parameters,request.parameters);
 }
});
test('Agent schema and repeated confirmation keep count+segments and omit only implicit video duration',async()=>{
 const [,audio,model]=await modules,nodes=[structuredClone(node),structuredClone(video)],original={...args,segments:[segments[0]]};
 assert.deepEqual(tools.parse('generation_submit',original).args,original);
 for(const changed of [{segments:[{start:1,prompt:'x'}]},{segments:[{start:0,prompt:'x'},{start:4,prompt:'x'}]},{kind:'image.generate'}])assert.throws(()=>tools.parse('generation_submit',{...original,...changed}));
 const draft=model.createGenerationDraft(original,{},nodes);assert.equal(draft.count,2);assert.deepEqual(draft.segments,original.segments);
 const confirmed=model.confirmedArguments(original,draft,nodes,[],{audioMetadata:metadata});assert.equal(Object.hasOwn(confirmed,'duration'),false);assert.equal(confirmed.count,2);assert.deepEqual(confirmed.segments,original.segments);
 const repeated=model.confirmedArguments(confirmed,model.createGenerationDraft(confirmed,{},nodes),nodes,[],{audioMetadata:metadata});assert.equal(Object.hasOwn(repeated,'duration'),false);assert.deepEqual(repeated.segments,original.segments);
 const target=audio.audioRequestConfig(core,node.audioConfig,repeated);assert.equal(target.params.count,2);assert.deepEqual(target.params.segments,original.segments);
 for(const unsupported of [{lyricsMode:'auto'},{lyrics:''},{loop:false},{count:11},{duration:361}]){const raw={...original,...unsupported};assert.throws(()=>model.confirmedArguments(raw,model.createGenerationDraft(raw,{},nodes),nodes,[],{audioMetadata:metadata}));}
});
function harness(native,audio,{mode='valid',duration=10}={}){
 const nodes=[structuredClone(node),structuredClone(video)],state={nodes,edges:[]},local=nodes[0],ref=nodes[1];let reads=0,fetches=0,release,project='project';const hold=new Promise(resolve=>release=resolve);
 if(['clip','trim','sourceClip','segments'].includes(mode))ref[mode]={start:0,end:5};
 if(mode==='source-hidden')local.audioConfig.params.lyrics='';
 const context={app:{getState:()=>state,projectIdentity:()=>({id:project})},core,nativeUnderTest:native,audioUnderTest:audio,drafts:new Map(),saveTimers:new Map(),structuredClone,setTimeout,clearTimeout,
  window:{GenerationAPI:{availability:async()=>{if(['source-drift','project-drift'].includes(mode))await hold;return {configured:mode!=='missing',reason:'Sonilo 未配置'};},configuration:async()=>metadata},LocalAssets:{url:async()=>{reads++;return 'blob:real-video';}}},
  document:{createElement:()=>({duration,set src(value){if(mode==='reference-drift')hold.then(()=>this.onloadedmetadata());else queueMicrotask(()=>this.onloadedmetadata());},removeAttribute(){},load(){}})},fetch:async()=>{fetches++;return {blob:async()=>({})};},FileReader:class{readAsDataURL(){this.result='data:video/mp4;base64,AAAA';this.onload();}}};
 const source=fs.readFileSync(require.resolve('../audio-ui.js'),'utf8'),start=source.indexOf(' async function buildRequest('),end=source.indexOf(' async function generate()',start),body=source.slice(start,end).replace("await import('./src/features/audio-generation/native-profile.mjs')",'nativeUnderTest').replace("await import('./src/features/agent-generation/audio.mjs')",'audioUnderTest');
 vm.createContext(context);vm.runInContext(body+'\nglobalThis.buildUnderTest=buildRequest;',context);
 return {context,nodes,release,changeProject:()=>project='other',stats:()=>({reads,fetches})};
}
test('production AudioAPI keeps precise real duration, count and segments; rejects stale sources and selections before byte reads',async()=>{
 const [native,audio]=await modules;
 for(const mode of ['valid','missing','clip','trim','sourceClip','segments','source-hidden','source-drift','reference-drift','project-drift','explicit-conflict','short']){
  const f=harness(native,audio,{mode,duration:mode==='short'?4:10.03}),overrides={...args,...mode==='explicit-conflict'?{duration:11}:{}};
  const pending=f.context.buildUnderTest('target',overrides);
  if(['source-drift','reference-drift','project-drift'].includes(mode)){await new Promise(resolve=>setImmediate(resolve));if(mode==='source-drift')f.nodes[0].audioConfig.prompt='已改';else if(mode==='reference-drift')f.nodes[1].video='asset:new';else f.changeProject();f.release();}
  if(mode==='valid'){const output=await pending;assert.equal(output.parameters.duration,10.03);assert.equal(output.inputs[0].duration,10.03);assert.equal(output.parameters.count,2);assert.deepEqual(output.parameters.segments,segments);assert.equal(f.stats().fetches,1);assert.equal(f.nodes[0].audioConfig.params.duration,60);}
  else{await assert.rejects(pending);assert.equal(f.stats().fetches,0,mode);}
 }
});
test('production Agent confirmation waits, cancels without submission, and destroyed card ignores late native metadata',async()=>{
 const [,audio,model,batch]=await modules,requireFabric=createRequire(require.resolve('fabric')),canvasPath=requireFabric.resolve('canvas'),previous=require.cache[canvasPath];require.cache[canvasPath]={exports:{createCanvas:undefined}};let JSDOM;
 try{({JSDOM}=requireFabric('jsdom'));}finally{if(previous)require.cache[canvasPath]=previous;else delete require.cache[canvasPath];}
 for(const mode of ['cancel','destroy','confirm']){
  const dom=new JSDOM('<main></main>',{url:'http://localhost:4173',runScripts:'outside-only',pretendToBeVisual:true}),context=dom.getInternalVMContext(),decisions=[];let release;const hold=new Promise(resolve=>release=resolve);
  Object.assign(context,audio,model,batch,{structuredClone,icons:{},referenceIcons:{},audioTypeIcon:'',createGenerationPromptEditor(){throw Error('unexpected editor');},generationPromptPreviews:()=>({hide(){},destroy(){}}),renderGenerationPrompt:text=>dom.window.document.createTextNode(text),generationMentionData(){},appendRecoveryActions(){},openParameterMenu:()=>({close(){}})});
  const source=fs.readFileSync(require.resolve('../src/features/agent-generation/card.mjs'),'utf8').replace(/^import[^\n]*\n/gm,'').replace(/^export \{[^\n]*\n/gm,'').replace(/^export /gm,'');vm.runInContext(source,context);
  const trace={id:'sonilo-approval',name:'generation_submit',status:'pending',args:{...args,segments:[segments[0]]}},card=context.createGenerationCard(trace,{getNodes:()=>[node,video],getAudioConfiguration:()=>hold,onConfirm:(value,allowed,confirmed)=>decisions.push({allowed,confirmed})});dom.window.document.querySelector('main').append(card.element);
  const button=label=>[...card.element.querySelectorAll('button')].find(button=>button.textContent===label);
  try{assert.equal(button('确认').disabled,true);if(mode==='destroy')card.destroy();release(metadata);await new Promise(resolve=>setImmediate(resolve));if(mode==='destroy'){assert.equal(decisions.length,0);assert.equal(card.element.isConnected,false);}else{assert.match(card.element.textContent,/Sonilo Music 原生音乐/);button(mode==='cancel'?'取消':'确认').click();assert.equal(decisions.length,1);assert.equal(decisions[0].allowed,mode==='confirm');if(mode==='confirm'){assert.equal(Object.hasOwn(decisions[0].confirmed,'duration'),false);assert.equal(decisions[0].confirmed.count,2);assert.deepEqual(decisions[0].confirmed.segments,[segments[0]]);}}}finally{card.destroy();dom.window.close();}
 }
});
test('Sonilo approval shows exact variant billing and every segment instruction for video and text music',async()=>{
 const [,audio,model,batch]=await modules,requireFabric=createRequire(require.resolve('fabric')),canvasPath=requireFabric.resolve('canvas'),previous=require.cache[canvasPath];require.cache[canvasPath]={exports:{createCanvas:undefined}};let JSDOM;
 try{({JSDOM}=requireFabric('jsdom'));}finally{if(previous)require.cache[canvasPath]=previous;else delete require.cache[canvasPath];}
 for(const mode of ['video','text','explicit-video']){
  const dom=new JSDOM('<main></main>',{url:'http://localhost:4173',runScripts:'outside-only',pretendToBeVisual:true}),context=dom.getInternalVMContext();
  Object.assign(context,audio,model,batch,{structuredClone,icons:{},referenceIcons:{},audioTypeIcon:'',createGenerationPromptEditor(){throw Error('unexpected editor');},generationPromptPreviews:()=>({hide(){},destroy(){}}),renderGenerationPrompt:text=>dom.window.document.createTextNode(text),generationMentionData(){},appendRecoveryActions(){},openParameterMenu:()=>({close(){}})});
  const source=fs.readFileSync(require.resolve('../src/features/agent-generation/card.mjs'),'utf8').replace(/^import[^\n]*\n/gm,'').replace(/^export \{[^\n]*\n/gm,'').replace(/^export /gm,'');vm.runInContext(source,context);
  const sourceNode=structuredClone(node);sourceNode.audioConfig.params.times=3;
  const original={...args,segments:[{start:0,prompt:'保留完整第一段\n包含中文与换行',label:'intro'},{start:5,prompt:'完整第二段',label:'chorus'}],...(mode==='text'?{prompt:'音乐',referenceIds:[],duration:10}:mode==='explicit-video'?{duration:5}:{} )};delete original.count;
  const card=context.createGenerationCard({id:'summary-'+mode,name:'generation_submit',status:'pending',args:original},{getNodes:()=>[sourceNode,video],getAudioConfiguration:async()=>metadata,onConfirm(){}});dom.window.document.querySelector('main').append(card.element);
  try{await new Promise(resolve=>setImmediate(resolve));const text=card.element.textContent;assert.match(text,/3 个 WAV 变体.*按每个变体计费/);assert.match(text,mode==='video'?/跟随完整视频，生成前读取真实时长/:mode==='explicit-video'?/时长：明确指定 5 秒；提交前须与源视频实测时长一致/:/时长：10 秒/);if(mode==='explicit-video'){assert.match(card.element.querySelector('.generation-chip[title="时长"]').textContent,/要求 5s/);assert.equal((text.match(/明确指定 5 秒/g)||[]).length,2);}assert.match(text,/0 秒 · intro/);assert.match(text,/5 秒 · chorus/);assert.match(text,/保留完整第一段\n包含中文与换行/);assert.match(text,/完整第二段/);assert.equal(card.element.querySelector('details.generation-native-audio-segments').open,true);}finally{card.destroy();dom.window.close();}
 }
});
