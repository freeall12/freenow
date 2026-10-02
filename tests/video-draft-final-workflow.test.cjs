const test=require('node:test'),assert=require('node:assert/strict');
let sequence=0;
const workflow=()=>import('../src/features/video-generation/draft-final-workflow.mjs');

async function fixture({existing=true}={}){
 const core=await workflow(),prefix=`workflow-${++sequence}`;
 const source={id:`${prefix}-draft`,type:'video',title:'样片',video:'/draft-v1.mp4',currentSourceFileId:'file-v1',
  x:53284.3,y:-2180.48,width:435.25,height:250.125,
  generation:{model:'Seedance 2.5 Draft',duration:12,ratio:'9:16',quality:'480p',draftEstimateMedia:{images:['/reference.png'],videos:[],audios:[]}}};
 const state={nodes:[source],edges:[]},calls={create:[],submit:[]},jobs=[];
 const commit=()=>{const plan=core.createFinalPlan(source,state.nodes,{id:`${prefix}-final`,edgeId:`${prefix}-edge`});state.nodes.push(plan.node);state.edges.push(plan.edge);return plan.node;};
 let target=existing?commit():null;
 const app={getState:()=>state,async createDraftFinalNode(id){calls.create.push(id);target=commit();return target;}};
 const api={getJobs:()=>jobs,submit(request){calls.submit.push(request);const job={id:`job-${jobs.length}`,request,status:'queued'};jobs.push(job);return job;}};
 return{core,source,state,calls,jobs,app,api,commit,get target(){return target;},get edge(){return state.edges.find(edge=>edge.target===target?.id);}};
}
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const requestFor=f=>({kind:'video.generate',nodeId:f.target.id,prompt:'stale prompt',inputs:[{type:'image',url:'/stale.png'}],parameters:{model:'Seedance 2.5',draftVideoId:'caller-forged-file',duration:4}});

test('new final submission uses one atomic app operation and rejects duplicate calls while creation awaits',async()=>{
 const f=await fixture({existing:false}),gate=deferred();
 f.app.createDraftFinalNode=async id=>{f.calls.create.push(id);await gate.promise;return f.commit();};
 const first=f.core.submitDraftFinal({sourceId:f.source.id},f);
 await assert.rejects(f.core.submitDraftFinal({sourceId:f.source.id},f),/正在提交/);
 assert.deepEqual(f.calls.create,[f.source.id]);assert.equal(f.calls.submit.length,0);assert.equal(f.state.nodes.length,1);assert.equal(f.state.edges.length,0);
 f.source.currentSourceFileId='file-v2';gate.resolve();const result=await first;
 assert.equal(f.state.nodes.length,2);assert.equal(f.state.edges.length,1);assert.equal(f.calls.submit.length,1);
 const request=f.calls.submit[0];assert.equal(request.parameters.draftVideoId,'file-v2');assert.equal(request.prompt,'');assert.deepEqual(request.inputs,[]);assert.equal(request.parameters.quality,'1080p');assert.equal(result.nodeId,request.nodeId);assert.equal(result.sourceId,f.source.id);assert.equal(result.job,f.jobs[0]);
});

test('failed atomic creation releases the submission lock without creating a generation job',async()=>{
 const f=await fixture({existing:false});f.app.createDraftFinalNode=async()=>{throw Error('atomic commit failed');};
 await assert.rejects(f.core.submitDraftFinal({sourceId:f.source.id},f),/atomic commit failed/);assert.equal(f.calls.submit.length,0);
 f.app.createDraftFinalNode=async()=>f.commit();const result=await f.core.submitDraftFinal({sourceId:f.source.id},f);assert.equal(result.job.status,'queued');
});

test('source and target pending, queued, running and applying states prevent submission',async()=>{
 for(const owner of ['source','target'])for(const mode of ['pending','queued','running','applying']){
  const f=await fixture(),node=f[owner];
  if(mode==='pending')node.pendingOperation={id:'pending'};
  else f.jobs.push({request:{nodeId:node.id},status:mode==='applying'?'succeeded':mode,applying:mode==='applying'});
  await assert.rejects(f.core.submitDraftFinal({targetId:f.target.id},f),/正在生成/);
  assert.equal(f.calls.submit.length,0);assert.equal(f.calls.create.length,0);
 }
});

test('each existing final submission and request preparation resolves current source file and parameters',async()=>{
 const f=await fixture();await f.core.submitDraftFinal({targetId:f.target.id},f);
 await assert.rejects(f.core.submitDraftFinal({targetId:f.target.id},f),/正在生成/);
 f.jobs[0].status='failed';f.source.currentSourceFileId='file-v2';f.source.video='/draft-v2.mp4';f.source.generation.duration=18;
 await f.core.submitDraftFinal({targetId:f.target.id},f);
 assert.equal(f.calls.create.length,0);assert.deepEqual(f.calls.submit.map(request=>request.parameters.draftVideoId),['file-v1','file-v2']);assert.equal(f.calls.submit[1].parameters.duration,18);
 const request=requestFor(f),before=structuredClone(request),prepared=f.core.prepareDraftFinalRequest(request,f.app);
 assert.equal(prepared.request.parameters.draftVideoId,'file-v2');assert.equal(prepared.request.parameters.duration,18);assert.equal(prepared.request.prompt,'');assert.deepEqual(prepared.request.inputs,[]);assert.deepEqual(request,before);assert.doesNotThrow(prepared.guard);
});

test('prepared final guard rejects changed source, reference edge and target but allows visual movement',async()=>{
 const mutations={
  sourceFile:f=>{f.source.currentSourceFileId='file-v2';},
  sourceMedia:f=>{f.source.video='/replacement.mp4';},
  sourceParameters:f=>{f.source.generation.duration=18;},
  sourceEstimateMedia:f=>{f.source.generation.draftEstimateMedia.images.push('/new.png');},
  sourceDeleted:f=>{f.state.nodes=f.state.nodes.filter(node=>node!==f.source);},
  edgeSource:f=>{f.edge.source='missing';},
  edgePurpose:f=>{f.edge.purpose='generation-input';},
  edgeAdded:f=>{f.state.edges.push({...f.edge,id:'duplicate'});},
  targetDeleted:f=>{f.state.nodes=f.state.nodes.filter(node=>node!==f.target);},
  targetReplaced:f=>{f.state.nodes=f.state.nodes.map(node=>node===f.target?structuredClone(node):node);},
  targetType:f=>{f.target.type='image';},
  targetModel:f=>{f.target.generation.model='other-model';},
  targetFileClaim:f=>{f.target.generation.draftVideoId='other-file';},
  targetDraftMode:f=>{f.target.generation.draft=true;},
 };
 for(const [name,mutate] of Object.entries(mutations)){
  const f=await fixture(),{guard}=f.core.prepareDraftFinalRequest(requestFor(f),f.app);mutate(f);assert.throws(guard,undefined,name);
 }
 const f=await fixture(),{guard}=f.core.prepareDraftFinalRequest(requestFor(f),f.app);f.source.x+=.125;f.target.y-=.375;f.target.title='重命名';assert.doesNotThrow(guard);
});

test('invalid final declarations cannot fall through to ordinary video generation',async()=>{
 const f=await fixture(),ordinary={...f.source,id:'ordinary',generation:{model:'Seedance 2.5'}};f.state.nodes.push(ordinary);
 for(const nodeId of [ordinary.id,'missing'])for(const value of ['forged','',0,NaN,false,null,undefined])for(const shape of ['top','provider']){
  const parameters=shape==='top'?{model:'Seedance 2.5',draftVideoId:value}:{model:'Seedance 2.5',providerParameters:{draft_video_id:value}};
  assert.throws(()=>f.core.prepareDraftFinalRequest({kind:'video.generate',nodeId,parameters},f.app),undefined,`${nodeId}/${shape}/${String(value)}`);
 }
 const ordinaryRequest={kind:'video.generate',nodeId:ordinary.id,prompt:'ordinary',parameters:{model:'Seedance 2.5'}};
 assert.deepEqual(f.core.prepareDraftFinalRequest(ordinaryRequest,f.app),{request:ordinaryRequest});
});

test('missing or invalid graph references never create jobs or use ordinary generation fallback',async()=>{
 const mutations=[f=>{f.state.edges=[];},f=>{f.edge.purpose='generation-input';},f=>{f.source.currentSourceFileId='';},f=>{f.source.generation.model='other-model';},f=>{f.target.generation.model='other-model';}];
 for(const mutate of mutations){
  const f=await fixture();mutate(f);await assert.rejects(f.core.submitDraftFinal({targetId:f.target.id},f));assert.throws(()=>f.core.prepareDraftFinalRequest(requestFor(f),f.app));assert.equal(f.calls.submit.length,0);assert.equal(f.calls.create.length,0);
 }
 const f=await fixture();await assert.rejects(f.core.submitDraftFinal({targetId:f.target.id,sourceId:'different-source'},f),/不一致/);assert.equal(f.calls.submit.length,0);
});
