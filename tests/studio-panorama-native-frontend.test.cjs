const test=require('node:test'),assert=require('node:assert/strict');
const {createOpenAIPanoramaEditProvider}=require('../server/generation-panorama-edit-openai.cjs');
const metadata=()=>createOpenAIPanoramaEditProvider({apiKey:'synthetic-test-only',modelMap:{'panorama.edit':{kind:'panorama.edit',model:'gpt-image-2',semantics:'perspective-mask-reproject',quality:'high',cropSize:'1024x1024'}},fetchImpl:()=>{throw Error('No network');}}).metadata;
async function harness({history=false}={}){
 const T=await import('three'),{installPanorama}=await import('../studio-panorama.mjs'),{PanoramaHistory,rectangleDirections,makePanoramaRequest}=await import('../studio-panorama-math.mjs');
 class Studio{};Object.assign(Studio.prototype,{tick(){},close(){},keyDown(){},switchSetup(){}});installPanorama(Studio,{el(){},button(){}});
 let project='qa-project';const data={activeSetup:'setup',objects:[],keyframes:[],environment:{intensity:1},room:{},ground:{}},node={id:'studio',type:'studio'},state={nodes:[node],edges:[]};
 const app={getState:()=>state,projectIdentity:()=>({id:project}),updateNode:(id,patch)=>Object.assign(node,patch)},camera=new T.PerspectiveCamera(60,4/3);camera.updateMatrixWorld(true);
 const e={id:'editor',setupId:'setup',camera,abort:new AbortController(),base:'asset:base',history:new PanoramaHistory({image:'asset:base',regions:[{id:'region',directions:rectangleDirections({x:200,y:150},{x:400,y:330},{left:0,top:0,width:800,height:600},camera)}]}),prompt:{textContent:'将区域改为陶土色'},applied:new Set(),generationGuards:new Map(),pendingSaves:new Map(),busy:false};
 const calls={media:0,dispatch:0,compose:0,images:0,remember:0,persist:0,save:0,flush:0,preview:0,notify:0},s=new Studio();Object.assign(s,{nodeId:'studio',data,panoramaEditor:e,notify(){calls.notify++;},remember(){calls.remember++;},refreshPanoramaUI(){},renderPanoramaRegions(){},persist(){calls.persist++;node.studio=structuredClone(data);},loadPanoramaPreview:async()=>{calls.preview++;},panoramaThumbnail:()=> 'data:image/jpeg;base64,fixture'});
 let meta=metadata(),providerRevision=0;const api={providerRevision:()=>providerRevision,configurationSnapshot:()=>structuredClone(meta),configuration:async()=>structuredClone(meta),availability:async()=>({configured:true}),submit:(r,options)=>{calls.dispatch++;api.last={request:r,options};return {id:'job',status:'queued'};},subscribe:()=>()=>{}};
 global.window={CanvasApp:app,GenerationAPI:api,LocalAssets:{url:async()=>{calls.media++;return 'data:image/png;base64,test';}}};
 if(history){const {installPanoramaHistory}=await import('../studio-panorama-history.mjs');installPanoramaHistory(Studio,{el(){},button(){},compose:async()=>{calls.compose++;return 'composite';},store:async image=>{calls.images++;return image;}});s.refreshPanoramaUI=()=>{};s.renderPanoramaHistory=()=>{};s.panoramaChange=patch=>e.history.change({...e.history.state,...patch});}
 window.CanvasStore={save:async(_state,_id,options)=>{calls.save++;options.beforeCommit();},flush:async()=>{calls.flush++;}};
 const request=()=>makePanoramaRequest({nodeId:s.nodeId,setupId:e.setupId,sessionId:e.id,history:e.history,camera:e.camera,prompt:e.prompt.textContent,image:e.history.state.image});
 return {s,e,node,state,app,api,calls,request,project:value=>{project=value;},metadata:value=>{meta=value;},providerChange:()=>{providerRevision++;}};
}
test('native submit checks current configuration and passes original image contract to TaskService before reading pixels',async()=>{
 const h=await harness();await h.s.submitPanorama();assert.equal(h.calls.media,0);assert.equal(h.calls.dispatch,1);assert.equal(h.api.last.request.inputs[0].image,'asset:base');assert.equal(h.api.last.request.inputs[0].projection,'equirectangular');h.api.last.options.beforeDispatch();
});
test('missing configuration and unsupported global native intent reject before media reads and dispatch',async()=>{
 for(const missing of [true,false]){const h=await harness();if(missing){h.api.availability=async()=>({configured:false,reason:'缺 Key'});h.metadata({...metadata(),configured:false});}else h.e.history.state.regions=[];
 await assert.rejects(h.s.submitPanorama(),missing?/缺 Key/:/框选/);assert.equal(h.calls.media,0);assert.equal(h.calls.dispatch,0);}
});
test('configuration/source changes while readiness is pending never dispatch or read pixels',async()=>{
 for(const mutate of [h=>h.e.prompt.textContent='变化',h=>h.e.camera.fov=70,h=>h.s.data.environment.intensity=2,h=>h.e.history.revision++,h=>h.s.data.activeSetup='different',h=>h.project('new-project'),h=>h.state.nodes=[{...h.node}],h=>h.s.panoramaEditor=null]){
 const h=await harness();let release;h.api.availability=()=>new Promise(resolve=>{release=resolve;});const pending=h.s.submitPanorama();mutate(h);release({configured:true});await assert.rejects(pending,/变化|关闭|切换/);assert.equal(h.calls.dispatch,0);assert.equal(h.calls.media,0);}
});
test('final TaskService guard covers fresh source, prompt, camera, region, scene and configuration',async()=>{
 for(const mutate of [h=>h.e.prompt.textContent='变化',h=>h.e.camera.quaternion.x=.1,h=>h.e.history.state.regions[0].directions[0][0]+=.1,h=>h.s.data.objects.push({id:'new'}),h=>h.metadata({...metadata(),configurationId:'changed'})]){
 const h=await harness();await h.s.submitPanorama();mutate(h);assert.throws(h.api.last.options.beforeDispatch,/变化/);}
});
test('tasks-v1 preserves established image body and scoped submit gate',async()=>{
 const h=await harness();h.metadata({protocol:'tasks-v1',configured:true});const previousFetch=global.fetch,reader=global.FileReader;
 global.fetch=async()=>new Response('png');global.FileReader=class{readAsDataURL(){this.result='data:image/png;base64,legacy';this.onload();}};
 try{await h.s.submitPanorama();assert.equal(h.calls.media,1);assert.equal(h.api.last.request.inputs[0].image,'data:image/png;base64,legacy');assert.equal(h.api.last.request.inputs[0].url,undefined);}finally{global.fetch=previousFetch;global.FileReader=reader;}
});
test('save failure retry reuses one staged patch and composite with no premature applied marker',async()=>{
 const h=await harness({history:true}),job={id:'job',request:h.request()};let fail=true;window.CanvasStore.save=async(_state,_id,options)=>{h.calls.save++;options.beforeCommit();if(fail){fail=false;throw Error('synthetic save failure');}};
 await assert.rejects(h.s.commitPanoramaOutput(job,'asset:result'),/save failure/);assert.equal(h.e.applied.has(job.id),false);assert.equal(h.e.pendingSaves.size,1);assert.equal(h.s.data.panoramaSessions[0].patches.length,1);
 const counts=structuredClone(h.calls);const result=await h.s.acceptPanoramaGeneration(job);assert.equal(result.applied,true);assert.equal(h.e.pendingSaves.size,0);assert.equal(h.s.data.panoramaSessions[0].patches.length,1);assert.equal(h.s.data.panoramaEdits.length,1);
 for(const key of ['compose','images','remember','persist','preview'])assert.equal(h.calls[key],counts[key],key+' repeated');assert.equal(h.calls.dispatch,0);assert.equal(h.calls.flush,1);
 assert.equal((await h.s.commitPanoramaOutput(job)).duplicate,true);
});
test('flush must complete before applied and closed editor loses pending-save authority',async()=>{
 const h=await harness({history:true}),job={id:'job',request:h.request()};let release;window.CanvasStore.flush=()=>new Promise(resolve=>{release=resolve;});const pending=h.s.commitPanoramaOutput(job,'asset:result');while(!release)await new Promise(resolve=>setImmediate(resolve));assert.equal(h.e.applied.has(job.id),false);assert.equal(h.e.pendingSaves.size,1);h.s.panoramaEditor=null;release();await assert.rejects(pending,/关闭/);assert.equal(h.e.applied.has(job.id),false);
});
test('save transaction commit guard rejects source mutation without recomposing or creating another patch',async()=>{
 const h=await harness({history:true}),job={id:'job',request:h.request()};window.CanvasStore.save=async(_state,_id,options)=>{h.s.data.environment.intensity=4;options.beforeCommit();};await assert.rejects(h.s.commitPanoramaOutput(job,'asset:result'),/变化/);const n=h.calls.compose;await assert.rejects(h.s.commitPanoramaOutput(job),/变化/);assert.equal(h.calls.compose,n);assert.equal(h.s.data.panoramaSessions[0].patches.length,1);
});
test('real persist housekeeping is rebased before durable guard without repeating the patch on retry',async()=>{
 const h=await harness({history:true}),job={id:'job',request:h.request()};h.s.persist=()=>{h.calls.persist++;h.s.data.duration=3;h.s.data.setups=[{id:'setup',duration:3,objects:[],keyframes:[]}];h.s.data.captures=[];h.node.studio=structuredClone(h.s.data);};let fail=true;window.CanvasStore.save=async(_state,_id,options)=>{options.beforeCommit();if(fail){fail=false;throw Error('one failure');}};
 await assert.rejects(h.s.commitPanoramaOutput(job,'asset:result'),/one failure/);await h.s.commitPanoramaOutput(job);assert.equal(h.calls.persist,1);assert.equal(h.calls.compose,1);assert.equal(h.e.applied.has(job.id),true);
});
test('pending save preserves retry receipt through undo/reframe/close/setup and Agent prompt attempts',async()=>{
 const h=await harness({history:true}),job={id:'job',request:h.request()};let fail=true;window.CanvasStore.save=async(_state,_id,options)=>{options.beforeCommit();if(fail){fail=false;throw Error('one failure');}};
 await assert.rejects(h.s.commitPanoramaOutput(job,'asset:result'));const prompt=h.e.prompt.textContent;
 for(const run of [()=>h.s.panoramaUndo(),()=>h.s.panoramaAction({action:'generate',prompt:'改变描述'}),()=>h.s.panoramaAction({action:'clear'}),()=>h.s.selectPanoramaAnchor('other'),()=>h.s.close(),()=>h.s.switchSetup('other')])await assert.rejects(Promise.resolve().then(run),/尚未保存/);
 assert.throws(()=>h.s.reframePanorama(),/尚未保存/);assert.throws(()=>h.s.selectPanoramaPatch('job'),/尚未保存/);assert.equal(h.s.closePanoramaEditor(),false);assert.equal(h.s.panoramaEditor,h.e);assert.equal(h.e.prompt.textContent,prompt);
 await h.s.commitPanoramaOutput(job);assert.equal(h.calls.compose,1);assert.equal(h.s.data.panoramaEdits.length,1);assert.equal(h.e.pendingSaves.size,0);
});
test('provider A to B to A during first availability is rejected even with identical null metadata',async()=>{
 const h=await harness();h.metadata(null);let release;h.api.availability=()=>new Promise(resolve=>{release=resolve;});const pending=h.s.submitPanorama();h.providerChange();h.providerChange();release({configured:true});await assert.rejects(pending,/供应商已变化/);assert.equal(h.calls.media,0);assert.equal(h.calls.dispatch,0);
});
test('configuration guard detects custom provider switch after metadata query and final dispatch',async()=>{
 for(const stage of ['configuration','dispatch']){const h=await harness();h.metadata(null);const fetchBefore=global.fetch,reader=global.FileReader;global.fetch=async()=>new Response('png');global.FileReader=class{readAsDataURL(){this.result='data:image/png;base64,legacy';this.onload();}};
 try{if(stage==='configuration'){h.api.configuration=async()=>{h.providerChange();return null;};await assert.rejects(h.s.submitPanorama(),/供应商已变化/);assert.equal(h.calls.media,0);}else{await h.s.submitPanorama();h.providerChange();assert.throws(h.api.last.options.beforeDispatch,/供应商已变化/);}}finally{global.fetch=fetchBefore;global.FileReader=reader;}}
});
test('pending receipt cannot mark an externally replaced or removed staged patch as saved',async()=>{
 const h=await harness({history:true}),job={id:'job',request:h.request()};window.CanvasStore.save=async()=>{throw Error('one failure');};await assert.rejects(h.s.commitPanoramaOutput(job,'asset:result'));h.node.studio.panoramaSessions[0].patches=[];
 await assert.rejects(h.s.commitPanoramaOutput(job),/变化/);assert.equal(h.e.applied.has(job.id),false);assert.equal(h.calls.compose,1);
});
