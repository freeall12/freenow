'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const ready=import('../src/features/audio-generation/application.mjs'),core=require('../audio-core.js');
const request={kind:'audio.generate',nodeId:'audio',prompt:'accepted prompt',parameters:{model:'doubao-seed-audio-1-0',enable_subtitle:true}};
async function fixture(){
 const module=await ready,node={id:'audio',type:'audio',audioMode:'generate',title:'保持原音频标题',x:10,y:20,width:318,height:275,audio:'asset:old',audioDuration:99,durationMs:99000,audioConfig:{prompt:'accepted prompt',model:'doubao-seed-audio-1-0',params:{enable_subtitle:true}}},state={nodes:[node],edges:[{id:'input',source:'text',target:'audio'}],selected:['audio']},history=[];
 let latest=true,pending=false,localizes=0,inspections=0,saves=0;
 const app={getState:()=>state,updateNode:(id,patch)=>{assert.equal(id,node.id);history.push(structuredClone(state));Object.assign(node,patch);},saveProject:async()=>{saves++;}};
 const receipt={request:structuredClone(request),source:node,signature:module.audioGenerationSignature(node),subtitleSnapshot:{count:0,node:null,content:null},audioApplied:null},job={id:'task',status:'succeeded',request:structuredClone(request),createdAt:123,outputs:[{type:'audio',audio:'data:audio/wav;base64,AA==',duration:999,subtitle:{text:' 首项字幕\n原换行 '}},{type:'audio',audio:'data:audio/wav;base64,AQ==',subtitle:{text:'第二项字幕'}}]};
 const args={job,receipt,app,isCurrent:()=>latest,hasPendingEdits:()=>pending,localize:async()=> 'asset:result-'+(++localizes),inspect:async()=>({duration:++inspections===1?2:3})};
 return {module,node,state,history,app,receipt,job,args,setLatest:value=>{latest=value;},setPending:value=>{pending=value;},counts:()=>({localizes,inspections,saves})};
}
test('ordinary audio updates original ID once, preserves generation fields and keeps all localized options',async()=>{
 const f=await fixture(),original=structuredClone(f.node),edges=structuredClone(f.state.edges);let captured;
 f.args.onApplied=receipt=>{captured=receipt;assert.equal(f.counts().saves,0);};const result=await f.module.applyOrdinaryAudioResult(f.args);
 assert.equal(result,captured);assert.equal(f.state.nodes.length,1);assert.equal(f.node.id,original.id);assert.equal(f.node.audio,'asset:result-1');assert.equal(f.node.audioDuration,2);assert.equal(f.node.durationMs,2000);assert.equal(f.node.provenance.mediaSource,f.node.audio);assert.equal(f.node.provenance.model,request.parameters.model);
 for(const key of ['audioMode','title','x','y','width','height','audioConfig'])assert.deepEqual(f.node[key],original[key]);assert.deepEqual(f.state.edges,edges);assert.deepEqual(f.state.selected,['audio']);assert.equal(f.history.length,1);
 assert.deepEqual(f.node.options,['asset:result-1','asset:result-2']);assert.equal(f.node.audioResultMetadata[1].subtitle.text,'第二项字幕');assert.equal(f.node.audioResultMetadata[1].durationMs,3000);assert.equal(f.node.audioHistory.length,2);assert.equal(f.node.audioHistory[0].options[0].audio,'asset:old');assert.deepEqual(f.counts(),{localizes:2,inspections:2,saves:1});
});
test('decode/localize failures and source/project/latest/pending mutations never patch stale ordinary source',async()=>{
 for(const boundary of ['localize','inspect'])for(const mode of ['source','identity','ownership','pending','failure','outputs']){
  const f=await fixture(),normal=f.args[boundary];f.args[boundary]=async source=>{const result=await normal(source);if(mode==='source')f.node.audioConfig.prompt='changed';if(mode==='identity')f.state.nodes[0]={...f.node};if(mode==='ownership')f.setLatest(false);if(mode==='pending')f.setPending(true);if(mode==='outputs'){f.job.outputs[0].audio='asset:late';f.job.outputs[0].subtitle.text='late';}if(mode==='failure')throw Error('read failed');return result;};
  await assert.rejects(f.module.applyOrdinaryAudioResult(f.args));assert.equal(f.history.length,0);assert.equal(f.node.audio,'asset:old');assert.equal(f.counts().saves,0);
 }
});
test('ordinary audio save retry reuses applied source; undo, source edits or output edits cannot resurrect it',async()=>{
 for(const mode of ['retry','undo','source','outputs']){
  const f=await fixture();f.app.saveProject=async()=>{throw Error('disk failure');};await assert.rejects(f.module.applyOrdinaryAudioResult(f.args));assert.equal(f.history.length,1);f.app.saveProject=async()=>{};
  if(mode==='undo'){f.state.nodes=f.history[0].nodes;f.state.edges=f.history[0].edges;}if(mode==='source')f.node.audio='asset:user';if(mode==='outputs')f.job.outputs[0].audio='data:audio/wav;base64,Ag==';
  if(mode==='retry')await f.module.applyOrdinaryAudioResult(f.args);else await assert.rejects(f.module.applyOrdinaryAudioResult(f.args));assert.equal(f.history.length,1);assert.equal(f.counts().localizes,2);
 }
});
test('submitted subtitle ownership is retained across audio preparation, and non-audio/malformed outputs do not mutate',async()=>{
 for(const mode of ['subtitle-change','subtitle-add','non-audio','invalid-duration','invalid-ref']){
  const f=await fixture();if(mode==='subtitle-change'){const n={id:'subtitle',type:'text',sourceAudioNodeId:'audio',content:'old'};f.state.nodes.push(n);f.receipt.subtitleSnapshot={count:1,node:n,content:'old'};f.args.inspect=async()=>{n.content='user';return {duration:2};};}
  if(mode==='subtitle-add')f.args.inspect=async()=>{f.state.nodes.push({id:'subtitle',type:'text',sourceAudioNodeId:'audio',content:'user'});return {duration:2};};
  if(mode==='non-audio')f.job.outputs[1]={type:'text',text:'wrong'};if(mode==='invalid-duration')f.args.inspect=async()=>({duration:Infinity});if(mode==='invalid-ref')f.args.localize=async()=> 'https://provider/audio.wav';
  await assert.rejects(f.module.applyOrdinaryAudioResult(f.args));assert.equal(f.history.length,0);
 }
});
test('production AudioAPI buildRequest rejects source/refs/project/pending edits during async reference preparation',async()=>{
 const source=fs.readFileSync(require.resolve('../audio-ui.js'),'utf8'),start=source.indexOf(' async function buildRequest('),end=source.indexOf(' async function generate()',start);
 for(const mode of ['source','ref','project','pending','drag','unchanged']){
  const node={id:'audio',type:'audio',audioConfig:{virtualModel:'seed-audio-1-0',scene:'Text-to-Speech',model:'doubao-seed-audio-1-0',prompt:'old',params:{enable_subtitle:true},references:[{id:'reference',type:'audio'}]}},ref={id:'reference',type:'audio',audio:'asset:reference'},state={nodes:[node,ref],edges:[]},drafts=new Map(),saveTimers=new Map();let project='first',release;
  const held=new Promise(resolve=>{release=resolve;}),c={app:{getState:()=>state,projectIdentity:()=>({id:project})},core,drafts,saveTimers,window:{LocalAssets:{url:async()=>held}},structuredClone,Map,Object,JSON,Set,fetch:async()=>({blob:async()=>({})}),FileReader:class{readAsDataURL(){this.result='data:audio/wav;base64,AA==';this.onload();}}};vm.createContext(c);vm.runInContext(source.slice(start,end)+'\nglobalThis.buildUnderTest=buildRequest;',c);
  const pending=c.buildUnderTest('audio');await new Promise(resolve=>setImmediate(resolve));if(mode==='source')node.audioConfig.prompt='new';if(mode==='ref')ref.audio='asset:later';if(mode==='project')project='second';if(mode==='pending')drafts.set(node.id,{prompt:'unflushed'});if(mode==='drag')node.x=100;release('blob:actual');
  if(['drag','unchanged'].includes(mode)){const request=await pending;assert.equal(request.prompt,'old');}else await assert.rejects(pending,/变化/);
 }
});
test('production audio controls retain pointer target before click and composer uses free space above player',()=>{
 const source=fs.readFileSync(require.resolve('../audio-ui.js'),'utf8'),handler=source.slice(source.indexOf('  wrap.onpointerdown='),source.indexOf('wrap.onkeydown=',source.indexOf('  wrap.onpointerdown=')));
 const wave={},wrap={},selections=[];let stops=0;
 const c={wave,wrap,options:{},nodeId:'audio',app:{getState:()=>({selected:[]}),select:id=>selections.push(id)}};vm.createContext(c);vm.runInContext(handler,c);
 for(const target of [{closest:()=>({})},{...wave,closest:()=>null}]){
  // The actual canvas identity matters to the production handler.
  if(!target.closest('button')){Object.assign(wave,target);wrap.onpointerdown({target:wave,stopPropagation:()=>stops++});}else wrap.onpointerdown({target,stopPropagation:()=>stops++});
 }
 assert.equal(selections.length,0);assert.equal(stops,2);wrap.onpointerdown({target:{closest:()=>null},stopPropagation:()=>stops++});assert.deepEqual(selections,['audio']);
 const position=source.slice(source.indexOf(' function position(){'),source.indexOf(' function positionToolbar(',source.indexOf(' function position(){')));
 const p={hidden:false,offsetHeight:220,style:{}},context={panel:p,current:{x:40,y:140,width:300,height:300},app:{getState:()=>({view:{x:140,y:250,scale:.7}})},$:()=>({getBoundingClientRect:()=>({left:0,right:1120,width:1120,top:0})}),innerHeight:708,Math,placePop:()=>{}};vm.createContext(context);vm.runInContext(position+'\nposition();',context);
 assert.equal(p.style.top,'116px');assert.ok(Number.parseFloat(p.style.top)+p.offsetHeight<348);
});
