const test=require('node:test'),assert=require('node:assert/strict');
const core=()=>import('../src/features/video-generation/draft-final.mjs');
const settings=()=>import('../src/features/video-generation/settings.mjs');
const draft=()=>({id:'draft',type:'video',title:'样片',video:'/draft.mp4',image:'/poster.png',currentSourceFileId:'file-v1',
 x:53284.3,y:-2180.48,width:435.25,height:250.125,parentId:'group',
 generation:{model:'Seedance 2.5 Draft',prompt:'原始动作及主体',videoMode:'REFERENCE_TO_VIDEO',mode:'全能参考',duration:12,ratio:'9:16',audio:false,quality:'480p'}});

test('draft identity is distinct from low resolution and usable draft media',async()=>{
 const {isDraftNode,isFinalNode,hasDraftResult,requireDraftSource}=await core(),source=draft();
 assert.equal(isDraftNode(source),true);assert.equal(hasDraftResult(source),true);
 assert.equal(isDraftNode({...source,generation:{model:'Seedance 2.5',quality:'480p'}}),false);
 assert.equal(isDraftNode({...source,generation:{model:'agent-video-generation-02',draft:true}}),true);
 assert.equal(isDraftNode({...source,generation:{model:'seedance_2_5',draft:true}}),true);
 assert.equal(isDraftNode({...source,type:'image'}),false);
 assert.equal(isDraftNode({...source,video:null}),true);assert.equal(hasDraftResult({...source,video:null}),false);
 assert.equal(hasDraftResult({...source,currentSourceFileId:' '}),false);
 assert.equal(isFinalNode({...source,generation:{model:'Seedance 2.5',draftVideoId:'file-v1'}}),true);
 assert.equal(isDraftNode({...source,generation:{model:'Seedance 2.5',draft:true,draftVideoId:'file-v1'}}),false);
 assert.equal(requireDraftSource({...source,currentSourceFileId:'untrusted'},[source]),source);
 for(const nodes of [[],[source,source],[{...source,video:''}],[{...source,currentSourceFileId:null}],[{...source,generation:{model:'Seedance 2.5',quality:'480p'}}]])assert.throws(()=>requireDraftSource(source,nodes),{code:'draft_reference_unavailable'});
});

test('final plan preserves exact official right-hand placement and keeps draft graph untouched',async()=>{
 const {createFinalPlan}=await core(),source=draft(),nodes=[source,{id:'group',type:'group',x:50000,y:-3000}],before=structuredClone(nodes);
 const {node,edge}=createFinalPlan(source,nodes,{id:'final',edgeId:'edge'});
 assert.equal(node.x,source.x+source.width+100);assert.equal(node.y,source.y);assert.equal(node.width,source.width);assert.equal(node.height,source.height);
 assert.equal(node.parentId,undefined);assert.equal(node.video,null);assert.equal(node.image,null);assert.equal(node.hide_inputbar,true);assert.equal(node.generation.prompt,'');assert.equal(node.generation.model,'Seedance 2.5');assert.equal(node.generation.draftVideoId,'file-v1');assert.equal(node.generation.quality,'1080p');assert.equal(node.generation.audio,false);assert.equal(node.generation.duration,12);assert.equal(node.generation.ratio,'9:16');
 assert.deepEqual(edge,{id:'edge',source:'draft',target:'final',sourceHandle:'right',targetHandle:'left',purpose:'draft-reference'});assert.deepEqual(nodes,before);
 for(const ids of [{id:'draft',edgeId:'edge'},{id:'',edgeId:'edge'},{id:'final',edgeId:''}])assert.throws(()=>createFinalPlan(source,nodes,ids),{code:'draft_reference_unavailable'});
 assert.throws(()=>createFinalPlan(source,[{...source,x:NaN}],{id:'final',edgeId:'edge'}),{code:'draft_reference_unavailable'});
});

test('final resolution uses one live draft edge, current file identity and immutable reference snapshots',async()=>{
 const {createFinalPlan,resolveDraftReference}=await core(),source=draft(),input={id:'image',type:'image',image:'/reference.png'};
 const {node,edge}=createFinalPlan(source,[source,input],{id:'final',edgeId:'edge'}),nodes=[source,input,node],edges=[edge,{source:'image',target:'draft'}];
 source.currentSourceFileId='file-v2';source.generation.duration=18;
 let resolved=resolveDraftReference(node,nodes,edges);assert.equal(resolved.source,source);assert.equal(resolved.draftVideoId,'file-v2');assert.equal(resolved.parameters.duration,18);assert.equal(resolved.parameters.draftVideoId,'file-v2');assert.deepEqual(resolved.draftEstimateMedia,{images:['/reference.png'],videos:[],audios:[]});
 source.generation.draftEstimateMedia={images:['/bound-subject.png'],videos:['/reference-video.mp4'],audios:[]};resolved=resolveDraftReference(node,nodes,edges);
 assert.deepEqual(resolved.draftEstimateMedia,source.generation.draftEstimateMedia);resolved.draftEstimateMedia.images.push('/other.png');assert.deepEqual(source.generation.draftEstimateMedia.images,['/bound-subject.png']);
 for(const incoming of [[],[{...edge,purpose:'generation-input'}],[edge,{source:'image',target:'final'}],[edge,{...edge,id:'duplicate'}],[{...edge,source:'missing'}],[{...edge,source:'final'}]])assert.throws(()=>resolveDraftReference(node,nodes,incoming),{code:'draft_reference_unavailable'});
 assert.throws(()=>resolveDraftReference(node,nodes.filter(n=>n!==node),edges),{code:'draft_reference_unavailable'});
 const nested={...edge,data:{purpose:'draft-reference'}};delete nested.purpose;assert.equal(resolveDraftReference(node,nodes,[nested]).source,source);
});

test('draft request forces 480p and captures fully projected references without changing caller input',async()=>{
 const {configuration,prepareVideoRequest}=await settings();
 for(const model of ['Seedance 2.5','seedance-2.5-draft']){
  const request={kind:'video.generate',prompt:'{{Image 1}}',parameters:{model,draft:true,quality:'1080p',draftEstimateMedia:{images:['/stale.png']}},inputs:[{id:'image',type:'image',url:'/new.png'},{id:'audio',type:'audio',url:'/sound.wav'}]},before=structuredClone(request),prepared=prepareVideoRequest(request);
  assert.equal(prepared.parameters.providerParameters.resolution,'480p');assert.equal(prepared.parameters.providerParameters.draft,true);assert.equal(prepared.parameters.quality,'480p');assert.deepEqual(prepared.parameters.draftEstimateMedia,{images:['/new.png'],videos:[],audios:['/sound.wav']});assert.deepEqual(request,before);assert.deepEqual(prepareVideoRequest(prepared),prepared);
 }
 const data=configuration({model:'Seedance 2.5',draft:true,quality:'1080p'});assert.deepEqual(data.options.resolutions,['480p']);assert.equal(data.settings.quality,'480p');
});

test('final request is an idempotent fixed-1080p draft-file operation and never ordinary regeneration',async()=>{
 const {configuration,prepareVideoRequest}=await settings();
 const request={kind:'video.generate',nodeId:'final',prompt:'should not be resubmitted',elementRefs:[{id:'subject'}],inputs:[{type:'video',url:'/draft.mp4'}],parameters:{model:'Seedance 2.5',draftVideoId:'file-v1',draft:true,quality:'480p',count:4,refs:['/reference.png'],subjects:[{id:'subject'}],images:['/reference.png'],providerParameters:{prompt:'stale',resolution:'480p'}}};
 const prepared=prepareVideoRequest(request);assert.deepEqual(prepared.parameters.providerParameters,{model:'seedance-2.5',draft_video_id:'file-v1',resolution:'1080p',times:1});assert.equal(prepared.prompt,'');assert.deepEqual(prepared.inputs,[]);assert.equal(prepared.elementRefs,undefined);assert.equal(prepared.parameters.refs,undefined);assert.equal(prepared.parameters.subjects,undefined);assert.equal(prepared.parameters.images,undefined);assert.equal(prepared.parameters.draft,false);assert.equal(prepared.parameters.count,1);assert.deepEqual(prepareVideoRequest(prepared),prepared);assert.equal(request.prompt,'should not be resubmitted');
 const data=configuration(request.parameters,request.inputs);assert.equal(data.error,'');assert.deepEqual(data.options.resolutions,['1080p']);
 for(const parameters of [{model:'unknown',draftVideoId:'x'},{model:'Seedance 2.5 Draft',draftVideoId:'x'},{model:'Seedance 2.5',draftVideoId:''},{model:'Seedance 2.5',draftVideoId:NaN}])assert.throws(()=>prepareVideoRequest({...request,parameters}),{code:'draft_reference_unavailable'});
});
