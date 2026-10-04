'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {createRequire}=require('node:module'),core=require('../audio-core.js');
const {createVideoAudioProvider}=require('../server/generation-video-audio.cjs');
const metadata=createVideoAudioProvider({apiKey:'synthetic-agent-audio-key',modelMap:{'sonilo-sfx':{kind:'audio.generate',model:'fal-ai/thinksound/audio',semantics:'explicit-native-alternative'}}}).metadata;
const args={kind:'audio.generate',nodeId:'target',model:'sonilo',audioScene:'Sound',prompt:'',referenceIds:['video']};
const nodes=[{id:'target',type:'audio',audioConfig:core.transition({prompt:''},'sonilo-music','Sound')},{id:'video',type:'video',title:'合成视频身份',video:'asset:video'}];
const modules=Promise.all([import('../src/features/agent-generation/audio.mjs'),import('../src/features/agent-generation/model.mjs'),import('../src/features/agent-generation/batch.mjs')]);
test('actual ThinkSound metadata omits only default confirmation duration through repeated confirmation; generic Sonilo stays independent',async()=>{
 const [audio,model]=await modules;
 const draft=model.createGenerationDraft(args,{},nodes);assert.equal(draft.duration,10);assert.equal(draft.audioDurationExplicit,false);
 for(const config of [metadata,{protocol:'routed',configured:true,providers:{sound:metadata},routes:{'audio.generate':{models:{'sonilo-sfx':'sound'}}}}]){
  const confirmed=model.confirmedArguments(args,draft,nodes,[],{audioMetadata:config});assert.equal(Object.hasOwn(confirmed,'duration'),false);assert.equal(Object.hasOwn(confirmed,'audioDurationExplicit'),false);
  const validated=model.confirmedArguments(args,confirmed,nodes);assert.equal(Object.hasOwn(validated,'duration'),false,'batch envelope validation must not refill duration');
  const rebuilt=model.createGenerationDraft(confirmed,{},nodes),executed=model.confirmedArguments(confirmed,rebuilt,nodes,[],{audioMetadata:config});assert.equal(Object.hasOwn(executed,'duration'),false,'execution rebuild must not refill duration');
 }
 assert.equal(model.confirmedArguments(args,draft,nodes,[],{audioMetadata:{protocol:'tasks-v1',configured:true}}).duration,10);
 assert.equal(model.confirmedArguments(args,draft,nodes).duration,10);
 assert.equal(audio.audioSourceVideoState(null,draft,nodes).pending,true);
 for(const duration of [4,5]){const original={...args,duration},explicit=model.createGenerationDraft(original,{},nodes);assert.equal(explicit.audioDurationExplicit,true);assert.equal(model.confirmedArguments(original,explicit,nodes,[],{audioMetadata:metadata}).duration,duration);}
 assert.throws(()=>model.confirmedArguments({...args,duration:null},model.createGenerationDraft({...args,duration:null},{},nodes),nodes,[],{audioMetadata:metadata}),/时长/);
 assert.throws(()=>model.confirmedArguments({...args,duration:200},model.createGenerationDraft({...args,duration:200},{},nodes),nodes,[],{audioMetadata:metadata}),/时长/,'explicit invalid duration cannot be normalized into a default');
 const edited={...draft,duration:7,audioDurationExplicit:true};assert.equal(model.confirmedArguments(args,edited,nodes,[],{audioMetadata:metadata}).duration,7);
 for(const override of [{loop:false},{subtitle:false},{lyricsMode:'auto'},{count:2},{sampleRate:44100}]){
  const original={...args,...override};assert.throws(()=>model.confirmedArguments(original,model.createGenerationDraft(original,{},nodes),nodes,[],{audioMetadata:metadata}),/ThinkSound/,'confirmation normalization cannot erase an explicit unsupported instruction');
 }
});
test('batch confirmation preserves per-item duration provenance and shared user edits',async()=>{
 const [,model,batch]=await modules,other={...nodes[0],id:'other'},all=[...nodes,other];
 const calls=[{callId:'one',args:{...args,duration:10}},{callId:'two',args:{...args,nodeId:'other'}}],trace={name:'generation_batch',args:calls[0].args,batchItems:calls};
 const items=batch.batchDraft(trace,()=>({}),all),decisions=batch.batchDecisions(trace,items[0].args,items,all,{audioMetadata:metadata});
 assert.equal(decisions[0].args.duration,10);assert.equal(Object.hasOwn(decisions[1].args,'duration'),false);
 const edited=batch.changeBatch(items[0].args,items,'duration',4,all),changed=batch.batchDecisions(trace,edited,items,all,{audioMetadata:metadata});assert.deepEqual(changed.map(choice=>choice.args.duration),[4,4]);
 for(const choice of decisions)assert.equal(Object.hasOwn(choice.args,'audioDurationExplicit'),false);
});
test('production Agent execution normalization receives actual metadata and keeps implicit source-video duration absent',async()=>{
 const [,generationModel]=await modules,source=fs.readFileSync(require.resolve('../agent-client.js'),'utf8'),start=source.indexOf('       if(generationModel.supportsCard({name,args}))'),end=source.indexOf('       const authorizedArgs=',start);
 assert.ok(start>0&&end>start);
 for(const config of [metadata,{protocol:'tasks-v1',configured:true}]){
  const run={},d={activeRun:run},context={name:'generation_submit',args:structuredClone(args),generationModel,d,run,draft:()=>d,draftFinalApproval:undefined,runController:{signal:{aborted:false}},DOMException,window:{GenerationAPI:{configuration:async()=>config},NodeEditor:{getConfig:()=>({})}},app:{getState:()=>({nodes,edges:[]})}};
  vm.createContext(context);await vm.runInContext('(async()=>{'+source.slice(start,end)+'})()',context);
  assert.equal(Object.hasOwn(context.args,'duration'),config===metadata?false:true);
 }
});
test('implicit confirmation survives production AudioAPI preparation while a user duration mismatch is still rejected',async()=>{
 const [audio,model]=await modules,native=await import('../src/features/audio-generation/native-profile.mjs');
 const source=fs.readFileSync(require.resolve('../audio-ui.js'),'utf8'),start=source.indexOf(' async function buildRequest('),end=source.indexOf(' async function generate()',start);
 const body=source.slice(start,end).replace("await import('./src/features/audio-generation/native-profile.mjs')",'nativeUnderTest').replace("await import('./src/features/agent-generation/audio.mjs')",'audioUnderTest');
 // Metadata event and byte conversion are explicit mocks; this is not MP4/CUA evidence.
 for(const explicit of [false,true]){
  const original=explicit?{...args,duration:5}:args,confirmed=model.confirmedArguments(original,model.createGenerationDraft(original,{},nodes),nodes,[],{audioMetadata:metadata});
  const toolArgs=model.confirmedArguments(confirmed,model.createGenerationDraft(confirmed,{},nodes),nodes,[],{audioMetadata:metadata});let byteReads=0;
  const context={app:{getState:()=>({nodes,edges:[]}),projectIdentity:()=>({id:'project'})},core,audioUnderTest:audio,nativeUnderTest:native,drafts:new Map(),saveTimers:new Map(),structuredClone,setTimeout,clearTimeout,
   window:{GenerationAPI:{availability:async()=>({configured:true}),configuration:async()=>metadata},LocalAssets:{url:async()=> 'blob:video'}},
   document:{createElement:()=>({duration:4,set src(value){queueMicrotask(()=>this.onloadedmetadata());},removeAttribute(){},load(){}})},fetch:async()=>{byteReads++;return {blob:async()=>({})};},FileReader:class{readAsDataURL(){this.result='data:video/mp4;base64,AAAA';this.onload();}}};
  vm.createContext(context);vm.runInContext(body+'\nglobalThis.buildUnderTest=buildRequest;',context);
  if(explicit){await assert.rejects(()=>context.buildUnderTest('target',toolArgs),/明确指定.*不一致/);assert.equal(byteReads,0);}
  else{const request=await context.buildUnderTest('target',toolArgs);assert.equal(request.parameters.duration,4);assert.equal(request.inputs[0].duration,4);assert.equal(request.prompt,'');assert.equal(byteReads,1);}
 }
});
async function cardFixture({original=args,configuration=()=>Promise.resolve(metadata),savedDraft,editorFactory}={}){
 const [audio,model,batch]=await modules,requireFabric=createRequire(require.resolve('fabric')),canvasPath=requireFabric.resolve('canvas'),previous=require.cache[canvasPath];require.cache[canvasPath]={exports:{createCanvas:undefined}};
 let JSDOM;try{({JSDOM}=requireFabric('jsdom'));}finally{if(previous)require.cache[canvasPath]=previous;else delete require.cache[canvasPath];}
 const dom=new JSDOM('<main></main>',{url:'http://localhost:4173',runScripts:'outside-only',pretendToBeVisual:true}),context=dom.getInternalVMContext(),confirmations=[];
 Object.assign(context,audio,model,batch,{structuredClone,icons:{},referenceIcons:{},audioTypeIcon:'',createGenerationPromptEditor:editorFactory||(()=>{throw Error('unexpected prompt editing');}),generationPromptPreviews:()=>({hide(){},destroy(){}}),renderGenerationPrompt:text=>dom.window.document.createTextNode(text),generationMentionData(){},appendRecoveryActions(){},openParameterMenu(){return {close(){}};}});
 const source=fs.readFileSync(require.resolve('../src/features/agent-generation/card.mjs'),'utf8').replace(/^import[^\n]*\n/gm,'').replace(/^export \{[^\n]*\n/gm,'').replace(/^export /gm,'');
 vm.runInContext(source,context);
 const trace={id:'test-confirmation',name:'generation_submit',status:'pending',args:structuredClone(original),...(savedDraft?{confirmationDraft:savedDraft}:{})};
 const card=context.createGenerationCard(trace,{getNodes:()=>nodes,getAudioConfiguration:configuration,onConfirm:(trace,allowed,args)=>confirmations.push({allowed,args})});dom.window.document.querySelector('main').append(card.element);
 return {dom,card,trace,confirmations,confirm:()=>[...card.element.querySelectorAll('button')].find(button=>button.textContent==='确认')};
}
test('actual Agent card waits for metadata then displays follow-video and confirms without manufactured duration',async()=>{
 let release;const held=new Promise(resolve=>release=resolve),f=await cardFixture({configuration:()=>held});
 try{
  assert.equal(f.confirm().disabled,true);assert.match(f.card.element.textContent,/供应商待确认/);
  release(metadata);await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.confirm().disabled,false);assert.equal(f.card.element.querySelector('.generation-chip[title="时长"]').textContent,'跟随视频');assert.match(f.card.element.textContent,/实际供应商：ThinkSound.*显式替代 Sonilo/);
  f.confirm().click();assert.equal(f.confirmations.length,1);assert.equal(Object.hasOwn(f.confirmations[0].args,'duration'),false);assert.equal(Object.hasOwn(f.confirmations[0].args,'audioDurationExplicit'),false);
 }finally{f.card.destroy();f.dom.window.close();}
});
test('explicit duration, generic gateway and a restored older draft keep accurate card confirmation behavior',async()=>{
 const [,model]=await modules;
 for(const mode of ['explicit','generic','restored']){
  const f=await cardFixture({original:mode==='explicit'?{...args,duration:5}:args,configuration:()=>Promise.resolve(mode==='generic'?{protocol:'tasks-v1',configured:true}:metadata),...(mode==='restored'?{savedDraft:{...model.createGenerationDraft(args,{},nodes),audioDurationExplicit:undefined}}:{})});
  try{await new Promise(resolve=>setImmediate(resolve));f.confirm().click();assert.equal(f.confirmations.length,1);if(mode==='restored')assert.equal(Object.hasOwn(f.confirmations[0].args,'duration'),false);else assert.equal(f.confirmations[0].args.duration,mode==='explicit'?5:10);if(mode==='explicit')assert.equal(f.card.element.querySelector('.generation-chip[title="时长"]').textContent,'跟随视频（要求 5s）');if(mode==='generic')assert.doesNotMatch(f.card.element.textContent,/ThinkSound/);}finally{f.card.destroy();f.dom.window.close();}
 }
});
test('destroyed confirmation card ignores late provider metadata',async()=>{
 let release;const held=new Promise(resolve=>release=resolve),f=await cardFixture({configuration:()=>held});f.card.destroy();const previous=f.card.element.textContent;
 try{release(metadata);await new Promise(resolve=>setImmediate(resolve));assert.equal(f.card.element.isConnected,false);assert.equal(f.card.element.textContent,previous);assert.equal(f.confirmations.length,0);}finally{f.dom.window.close();}
});
test('late audio metadata preserves a prompt draft and its active selection during card rerender',async()=>{
 let release;const held=new Promise(resolve=>release=resolve);
 const editorFactory=({element,value})=>{
  const input=element.ownerDocument.createElement('textarea');input.value=value;element.append(input);
  return {dom:input,getText:()=>input.value,destroy:()=>input.remove(),setEditable(){},focus:()=>input.focus(),capture:()=>({start:input.selectionStart,end:input.selectionEnd}),restore:range=>{input.focus();input.setSelectionRange(range.start,range.end);}};
 };
 const f=await cardFixture({configuration:()=>held,editorFactory});
 try{
  f.card.element.querySelector('[aria-label="展开提示词"]').click();[...f.card.element.querySelectorAll('button')].find(button=>button.textContent==='编辑').click();await new Promise(resolve=>setImmediate(resolve));
  const initial=f.card.element.querySelector('textarea');initial.value='保留正在编辑的提示词';initial.focus();initial.setSelectionRange(2,5);
  release(metadata);await new Promise(resolve=>setImmediate(resolve));
  const latest=f.card.element.querySelector('textarea');assert.notEqual(latest,initial);assert.equal(latest.value,'保留正在编辑的提示词');assert.equal(f.dom.window.document.activeElement,latest);assert.equal(latest.selectionStart,2);assert.equal(latest.selectionEnd,5);
 }finally{f.card.destroy();f.dom.window.close();}
});
