'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const ready=Promise.all([
  import('../src/features/video-generation/reference-validation.mjs'),
  import('../src/features/video-generation/settings.mjs'),
  import('../src/features/node-composer/generation-request.mjs'),
  import('../src/features/node-composer/generation-media.mjs'),
  import('../src/features/subject-library/model.mjs')
]);
const clip=(duration,id='video')=>({id,type:'video',url:'https://media.example/'+id+'.mp4',...(duration===undefined?{}:{duration})});
const request=(inputs=[],parameters={})=>({kind:'video.generate',prompt:'合成回归请求',inputs,parameters:{model:'Seedance 2.5',mode:'全能参考',videoMode:'REFERENCE_TO_VIDEO',...parameters}});
const variant=(settings,type='REFERENCE_TO_VIDEO',model='Seedance 2.5')=>settings.modelFor(model).variants.find(entry=>entry.modelType===type);

test('official upper-only tolerance preserves strict minima and per-video versus total failures',async()=>{
  const [rules,settings]=await ready,v=variant(settings);
  for(const duration of [2,30,30.2])assert.equal(rules.videoReferenceDurationViolation(v,[clip(duration)]),null);
  for(const duration of [1.8,1.9999,30.2001])assert.equal(rules.videoReferenceDurationViolation(v,[clip(duration)]).reason,'single_out_of_range');
  assert.equal(rules.videoReferenceDurationViolation(v,[clip(15.1,'a'),clip(15.1,'b')]),null);
  assert.equal(rules.videoReferenceDurationViolation(v,[clip(15.15,'a'),clip(15.15,'b')]).reason,'total_exceeded');
  const edit=variant(settings,'VIDEO_EDIT');
  assert.equal(rules.videoReferenceDurationViolation(edit,[clip(3.99)]).reason,'single_out_of_range');
  for(const duration of [4,30.2])assert.equal(rules.videoReferenceDurationViolation(edit,[clip(duration)]),null);
  const wan=variant(settings,'REFERENCE_VIDEO_TO_VIDEO','Wan 3.0');
  assert.equal(rules.videoReferenceDurationViolation(wan,[clip(.99)]).reason,'single_out_of_range');
  assert.equal(rules.videoReferenceDurationViolation(wan,[clip(15.2)]),null);
});

test('missing, invalid and milliseconds durations remain explicit with no output-duration substitution',async()=>{
  const [rules,settings]=await ready,v=variant(settings);
  assert.equal(rules.videoReferenceDurationViolation(v,[clip()]).code,'video_reference_duration_unknown');
  assert.equal(rules.videoReferenceDurationViolation(v,[clip()],{allowUnknown:true}),null);
  for(const duration of [NaN,Infinity,0,-1,'4',null])assert.equal(rules.videoReferenceDurationViolation(v,[clip(duration)]).code,'video_reference_duration_invalid');
  assert.equal(rules.videoReferenceDurationViolation(v,[{...clip(),durationMs:4000}]),null);
  assert.equal(rules.videoReferenceDurationViolation(v,[{...clip(),durationMs:'4000'}]).code,'video_reference_duration_invalid');
  assert.equal(rules.videoReferenceDurationViolation(v,[{...clip(),durationMs:4000}],{useDurationMs:false}).code,'video_reference_duration_unknown');
  assert.equal(rules.videoReferenceDurationViolation(v,[{...clip(),durationMs:999999}],{allowUnknown:true,useDurationMs:false}),null);
  assert.throws(()=>rules.assertVideoReferenceDurations(v,[clip(31)]),error=>error.code==='video_reference_duration'&&error.providerDispatched===false&&/未自动截短/.test(error.message));
  const audioVariant={referenceAudioDurationRange:{min:2,max:15,totalMax:15}};
  assert.equal(rules.videoReferenceDurationViolation(audioVariant,[{type:'audio',duration:16}]).reason,'single_out_of_range');
  assert.equal(rules.videoReferenceDurationViolation(audioVariant,[{type:'audio',duration:8},{type:'audio',duration:8}]).reason,'total_exceeded');
});

test('empty reference submission becomes real text mode without mutating the displayed configuration',async()=>{
  const [rules,settings]=await ready;
  for(const model of ['Seedance 2.0','Seedance 2.5','Seedance 2.5 样片','Wan 3.0','Kling 3.0 Omni']){
    const input=request([{type:'text',text:'上游文字'}],{model}),before=structuredClone(input);
    const prepared=settings.prepareVideoRequest(input);
    assert.equal(prepared.parameters.providerParameters.modelType,'TEXT_TO_VIDEO');
    assert.equal(prepared.parameters.videoMode,'TEXT_TO_VIDEO');
    assert.equal(prepared.parameters.variant,settings.modelFor(model).variants.find(entry=>entry.modelType==='TEXT_TO_VIDEO').key);
    assert.deepEqual(settings.prepareVideoRequest(prepared),prepared);assert.deepEqual(input,before);
    if(model==='Seedance 2.5 样片'){assert.equal(prepared.parameters.providerParameters.draft,true);assert.equal(prepared.parameters.providerParameters.resolution,'480p');}
  }
  assert.equal(rules.videoSubmissionMode(request(), 'REFERENCE_VIDEO_TO_VIDEO'),'TEXT_TO_VIDEO');
  assert.equal(rules.videoSubmissionMode(request(), 'VIDEO_EDIT'),'VIDEO_EDIT');
  assert.throws(()=>settings.prepareVideoRequest(request([],{videoMode:'VIDEO_EDIT',mode:'视频编辑'})),/不支持当前参考素材/);
  assert.equal(settings.configuration(request().parameters,[]).settings.videoMode,'REFERENCE_TO_VIDEO');
});

test('actual media, official element bindings and projected text-only subjects preserve reference mode',async()=>{
  const [,settings,preparation,,subjects]=await ready;
  const variants=[request([{type:'image',url:'/real-reference.png'}]),request([clip(4)]),request([{type:'audio',url:'/real-reference.wav'}]),
    request([],{elementList:[{element_id:'official-1'}]}),request([],{elementRefs:[{element_id:'official-1'}]}),
    {...request(),elementRefs:[{element_id:'official-1'}]},request([],{providerParameters:{element_refs:[{element_id:'official-1'}]}}),request([],{providerParameters:{elementRefs:[{element_id:'official-1'}]}})];
  for(const input of variants)assert.equal(settings.prepareVideoRequest(input).parameters.providerParameters.modelType,'REFERENCE_TO_VIDEO');
  for(const key of ['elementRefs','element_refs']){
    const input=request([],{providerParameters:{[key]:[{element_id:'official-1'}]}}),prepared=settings.prepareVideoRequest(input);
    assert.deepEqual(prepared.parameters.providerParameters[key],input.parameters.providerParameters[key]);
    assert.deepEqual(settings.prepareVideoRequest(prepared),prepared);
  }
  const subject={id:'person',name:'主体',assets:[{id:'words',type:'text',text:'红色外套'}]};
  const input={...request([],{subjects:[subject]}),prompt:subjects.subjectToken(subject)+'走进镜头'};
  const expanded=preparation.prepareGenerationRequest(input);
  assert.deepEqual(expanded.inputs,[]);assert.equal(expanded.parameters.providerParameters.modelType,'REFERENCE_TO_VIDEO');
  assert.deepEqual(expanded.parameters.subjects,[subject]);assert.match(expanded.prompt,/红色外套/);
  assert.deepEqual(preparation.prepareGenerationRequest(expanded),expanded);
});

test('draft and final identities bypass inappropriate generic mode and duration changes',async()=>{
  const [,settings]=await ready;
  const draft=settings.prepareVideoRequest(request([clip(4)],{model:'Seedance 2.5',draft:true,quality:'1080p'}));
  assert.equal(draft.parameters.providerParameters.draft,true);assert.equal(draft.parameters.providerParameters.resolution,'480p');assert.equal(draft.parameters.providerParameters.modelType,'REFERENCE_TO_VIDEO');
  const final=settings.prepareVideoRequest({...request([clip(-1)],{draftVideoId:'draft-file',elementList:[{element_id:'old'}]}),prompt:'旧提示'});
  assert.deepEqual(final.inputs,[]);assert.equal(final.prompt,'');assert.deepEqual(final.parameters.providerParameters,{model:'seedance-2.5',draft_video_id:'draft-file',resolution:'1080p',times:1});
  assert.equal(final.parameters.elementList,undefined);assert.deepEqual(settings.prepareVideoRequest(final),final);
  assert.throws(()=>settings.prepareVideoRequest(request([],{draftVideoId:''})),{code:'draft_reference_unavailable'});
});

test('preparation rejects known seconds but leaves unavailable metadata for the actual decoder',async()=>{
  const [,settings]=await ready;
  assert.match(settings.configuration(request().parameters,[clip(1.9)]).error,/时长超出模型限制/);
  assert.throws(()=>settings.prepareVideoRequest(request([clip(1.9)])),{code:'video_reference_duration'});
  assert.doesNotThrow(()=>settings.prepareVideoRequest(request([clip()])));
  assert.doesNotThrow(()=>settings.prepareVideoRequest(request([{...clip(),durationMs:999999}])));
});

test('decoded duration is authoritative: stale subject milliseconds update, unknown and invalid fail before transport',async()=>{
  const [,,,media,subjects]=await ready;
  let reads=0,transports=0;
  const subject={id:'actor',name:'主体',assets:[{id:'v',type:'video',url:'https://media.example/subject.mp4',durationMs:999999}]};
  const input={...request([],{subjects:[subject]}),prompt:subjects.subjectToken(subject)};
  const prepared=await media.prepareGenerationMediaRequest(input,{resolveMedia:async node=>{reads++;return {url:node.video,width:640,height:360,duration:4};},transport:async value=>{transports++;return value;}});
  assert.equal(reads,1);assert.equal(transports,1);assert.equal(prepared.inputs[0].duration,4);assert.equal(prepared.inputs[0].durationMs,4000);assert.equal(prepared.parameters.subjects[0].assets[0].durationMs,4000);assert.equal(subject.assets[0].durationMs,999999);
  for(const duration of [undefined,NaN,Infinity,0,1.9,31]){
    const before=transports;
    await assert.rejects(media.prepareGenerationMediaRequest(request([clip()],{duration:5}),{resolveMedia:async node=>({url:node.video,width:640,height:360,duration}),transport:async value=>{transports++;return value;}}),error=>/^video_reference_duration/.test(error.code)&&error.providerDispatched===false);
    assert.equal(transports,before);
  }
  const valid=await media.prepareGenerationMediaRequest(request([clip()]),{resolveMedia:async node=>({url:node.video,width:640,height:360,duration:30.2}),transport:async value=>value});
  assert.equal(valid.inputs[0].duration,30.2);
  await assert.rejects(media.prepareGenerationMediaRequest(request([clip(undefined,'a'),clip(undefined,'b')]),{resolveMedia:async node=>({url:node.video,width:640,height:360,duration:15.15}),transport:()=>assert.fail('total violation must precede transport')}),/合计不超过 30 秒/);
});

test('MiniMax strict explicit selection contracts remain before general empty-reference projection',async()=>{
  const [,settings]=await ready;
  const implicit=settings.prepareVideoRequest(request([],{model:'MiniMax H3',mode:undefined,videoMode:undefined}));
  assert.equal(implicit.parameters.providerParameters.modelType,'TEXT_TO_VIDEO');
  for(const parameters of [{mode:'全能参考',videoMode:'REFERENCE_TO_VIDEO'},{mode:undefined,videoMode:undefined,audio:true}]){
    assert.throws(()=>settings.prepareVideoRequest(request([],{model:'MiniMax H3',...parameters})),/不支持|不符/);
  }
});
