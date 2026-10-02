const test=require('node:test'),assert=require('node:assert/strict');
const ready=Promise.all([
 import('../src/features/video-generation/settings.mjs'),
 import('../src/features/node-composer/generation-media.mjs'),
 import('../src/features/agent-workflows/media-transport.mjs'),
 import('../src/features/agent-workflows/media-resolver.mjs')
]);
const baseUrl='http://localhost:4173/';
const modes=Object.fromEntries(['TEXT_TO_VIDEO','IMAGE_TO_VIDEO','START_END_TO_VIDEO','REFERENCE_TO_VIDEO'].map(mode=>[mode,{ratios:mode==='IMAGE_TO_VIDEO'||mode==='START_END_TO_VIDEO'?['adaptive']:['adaptive','21:9','16:9','4:3','1:1','3:4','9:16'],resolutions:['768P','2K'],durations:Array.from({length:12},(_,i)=>i+4)}]));
Object.assign(modes.REFERENCE_TO_VIDEO,{maxImages:9,maxVideos:3,maxAudios:3,maxMedia:12,videoDurationRange:{min:2,max:15,totalMax:15},audioDurationRange:{min:2,max:15,totalMax:15}});
const metadata={protocol:'minimax-native',configured:true,capabilities:{models:{'MiniMax-H3':{kind:'video.generate'},'MiniMax-H3-Max':{kind:'video.generate'}},video:{'MiniMax-H3':{modes,maxCount:1}}}};
const request=(parameters={},inputs=[])=>({kind:'video.generate',prompt:'主体向镜头走来，环境自然声音',parameters:{model:'MiniMax H3',...parameters},inputs});
const image=id=>({id,type:'image',url:'https://media.example/'+id+'.png'});
const serialize=async blob=>'data:'+blob.type+';base64,'+Buffer.from(await blob.arrayBuffer()).toString('base64');

test('captured H3 and Max UI identity, independent defaults and applicable controls remain faithful',async()=>{
 const [settings]=await ready;
 const h3=settings.configuration({model:'minimax_h3'});
 assert.equal(h3.model.id,'MiniMax-H3');assert.deepEqual(h3.options.resolutions,['768P','2K']);assert.deepEqual(h3.options.durations,Array.from({length:12},(_,i)=>i+4));assert.equal(h3.settings.quality,'2K');assert.equal(h3.settings.duration,5);
 assert.deepEqual(h3.modeOptions.map(mode=>mode.label),['首尾帧','全能参考']);assert.equal(h3.options.supportsAudio,undefined);
 assert.equal(h3.settings.videoMode,'TEXT_TO_VIDEO');assert.equal(settings.configuration({model:'MiniMax H3'},[image('person')]).settings.videoMode,'REFERENCE_TO_VIDEO');
 const inherited=settings.configuration({model:'MiniMax H3',mode:'全能参考',videoMode:'REFERENCE_TO_VIDEO'});
 assert.equal(inherited.settings.mode,'首尾帧');assert.equal(inherited.settings.videoMode,'TEXT_TO_VIDEO');assert.equal(inherited.modeOptions.find(mode=>mode.label==='全能参考').disabled,true);
 assert.equal(settings.prepareVideoRequest(request(inherited.settings)).parameters.providerParameters.modelType,'TEXT_TO_VIDEO');
 const max=settings.configuration({model:'minimax-h3-max'});
 assert.equal(max.model.id,'MiniMax-H3-Max');assert.deepEqual(max.options.resolutions,['480P','768P']);assert.equal(max.settings.quality,'768P');assert.deepEqual(max.modeOptions.map(mode=>mode.label),['首尾帧']);
 assert.equal(settings.configuration({model:'Tripo H3'}),null);
});

test('H3 submission preserves valid native selections and rejects incompatible explicit controls',async()=>{
 const [settings]=await ready;
 const prepared=settings.prepareVideoRequest(request({quality:'768P',duration:15,ratio:'21:9'}));
 assert.deepEqual(prepared.parameters.providerParameters,{model:'MiniMax-H3',modelType:'TEXT_TO_VIDEO',variant:'text',aspectRatio:'21:9',resolution:'768P',duration:15,times:1});
 assert.deepEqual(settings.prepareVideoRequest(prepared),prepared);
 for(const parameters of [{duration:3},{quality:'1080P'},{quality:'2K',resolution:'768P'},{mode:'视频编辑'},{videoMode:'VIDEO_EDIT'},{audio:false},{audio:true},{generateAudio:true},{generateMode:'pro'},{draft:true}]){
  assert.throws(()=>settings.prepareVideoRequest(request(parameters)),/不支持|不符|不一致/);
 }
 assert.throws(()=>settings.prepareVideoRequest(request({model:'MiniMax H3 Max',quality:'2K'})),/清晰度/);
 assert.throws(()=>settings.prepareVideoRequest(request({mode:'首尾帧',ratio:'16:9'},[image('first')])),/参考图片决定/);
 const frame=settings.prepareVideoRequest(request({mode:'首尾帧',ratio:'adaptive',quality:'768P'},[image('first')]));
 assert.equal(frame.parameters.providerParameters.modelType,'IMAGE_TO_VIDEO');assert.equal(frame.parameters.providerParameters.aspectRatio,undefined);
});

test('native roles preserve ordered first/last identity, and all omni media without copying URLs into parameters',async()=>{
 const [,media]=await ready;
 const resolveMedia=async node=>({url:node[node.type],width:640,height:360,duration:3});
 const frames=await media.prepareGenerationMediaRequest(request({mode:'首尾帧'},[image('last-selected-first'),image('first-selected-last')]),{baseUrl,nativeConfiguration:metadata,resolveMedia,transport:async value=>value});
 assert.deepEqual(frames.inputs.map(input=>[input.id,input.role]),[['last-selected-first','first_frame'],['first-selected-last','last_frame']]);
 const mixed=await media.prepareGenerationMediaRequest(request({mode:'全能参考',quality:'768P',duration:4},[image('person'),{id:'clip',type:'video',url:'https://media.example/cut.mp4'},{id:'voice',type:'audio',url:'https://media.example/voice.mp3'},{type:'text',text:'参考人物动作'}]),{baseUrl,nativeConfiguration:metadata,resolveMedia,transport:async value=>value});
 assert.deepEqual(mixed.inputs.map(input=>input.role),['reference_image','reference_video','reference_audio',undefined]);assert.equal(mixed.inputs[1].duration,3);assert.equal(mixed.parameters.providerParameters.duration,4);
  assert.ok(!JSON.stringify(mixed.parameters.providerParameters).includes('media.example'));
 const subjects=await media.prepareGenerationMediaRequest(request({mode:'全能参考'},[{...image('actor'),role:'subject_reference',subjectId:'actor'}]),{baseUrl,nativeConfiguration:metadata,resolveMedia,transport:async value=>value});
 assert.equal(subjects.inputs[0].role,'reference_image');assert.equal(subjects.inputs[0].subjectId,'actor');
 const tail=await media.prepareGenerationMediaRequest(request({mode:'首尾帧'},[{...image('tail'),role:'last_frame'}]),{baseUrl,nativeConfiguration:metadata,resolveMedia,transport:async value=>value});
 assert.equal(tail.inputs[0].role,'last_frame');
});

test('native missing route, shape/aggregate/roles/URLs and unexported clips fail before any media read',async()=>{
 const [,media]=await ready;const noRead=()=>assert.fail('must fail before media reads');
 const cases=[
  [request({},[image('x')]),{...metadata,capabilities:{models:{}}}],
  [request({count:2},[image('x')]),metadata],
  [request({times:2},[image('x')]),metadata],
  [request({mode:'全能参考'},[...Array.from({length:9},(_,i)=>image('i'+i)),...Array.from({length:3},(_,i)=>({id:'v'+i,type:'video',url:'https://media.example/'+i+'.mp4'})),{type:'audio',url:'https://media.example/a.wav'}]),metadata],
  [request({mode:'首尾帧'},[{...image('first'),role:'first_frame'},{...image('other'),role:'first_frame'}]),metadata],
  [request({mode:'全能参考'},[{type:'video',url:'https://media.example/source.mp4',clip:{start:1,end:4}}]),metadata],
  [request({},[{...image('x'),url:'http://public.example/i.png'}]),metadata],
  [request({},[{...image('x'),url:'https://192.168.1.8/i.png'}]),metadata],
  [request({},[{...image('x'),url:'https://user:pass@media.example/i.png'}]),metadata],
  [request({},[{...image('x'),url:'data:image/svg+xml;base64,PHN2Zy8+'}]),metadata],
  [{...request(),prompt:'x'.repeat(7001)},metadata],
  [{...request({},[image('x')]),prompt:'  \n  '},metadata]
 ];
 for(const [value,nativeConfiguration]of cases)await assert.rejects(media.prepareGenerationMediaRequest(value,{baseUrl,nativeConfiguration,resolveMedia:noRead,transport:noRead}),/配置|不超过|不符|裁剪|HTTPS|本地|用户名|格式|1 个结果|只能提供/);
});

test('narrow configured native count and format subsets reject before media reads',async()=>{
 const [,media]=await ready;
 for(const changes of [{maxImages:1},{maxVideos:0},{maxAudios:0},{maxMedia:2}]){
  const nativeConfiguration=structuredClone(metadata);Object.assign(nativeConfiguration.capabilities.video['MiniMax-H3'].modes.REFERENCE_TO_VIDEO,changes);
  const inputs=[image('a'),image('b'),{type:'video',url:'https://media.example/v.mp4'},{type:'audio',url:'https://media.example/a.mp3'}];
  await assert.rejects(media.prepareGenerationMediaRequest(request({mode:'全能参考'},inputs),{baseUrl,nativeConfiguration,resolveMedia:()=>assert.fail('no reads')}),/配置上限/);
 }
 for(const formats of [['image/jpeg'],[]]){
  const nativeConfiguration=structuredClone(metadata);nativeConfiguration.capabilities.video['MiniMax-H3'].mediaTransport={image:formats};
  await assert.rejects(media.prepareGenerationMediaRequest(request({mode:'首尾帧'},[{type:'image',url:'data:image/png;base64,eA=='}]),{baseUrl,nativeConfiguration,resolveMedia:()=>assert.fail('no reads')}),/配置/);
 }
});

test('native local image/video/audio transport submits actual bytes; audio duration and original formats are validated',async()=>{
 const [,media,transport,resolver]=await ready;
 const urls=Object.fromEntries(['image','video','audio'].map(type=>[type,URL.createObjectURL(new Blob(['actual-'+type],{type:type+'/'+(type==='image'?'png':type==='video'?'mp4':'wav')}))]));
 const factory=type=>()=>({naturalWidth:640,naturalHeight:360,videoWidth:640,videoHeight:360,duration:3,decode:async()=>{},removeAttribute(){},load(){},set src(url){queueMicrotask(()=>type==='image'?this.onload?.():this.onloadedmetadata?.());}});
 const resolveMedia=resolver.createWorkflowMediaResolver({baseUrl,localAssets:{url:async id=>urls[id.slice(6)]},createImage:factory('image'),createVideo:factory('video'),createAudio:factory('audio')});
 try{
  const submitted=request({mode:'全能参考'},['image','video','audio'].map(type=>({id:type,type,url:'asset:'+type})));
  const prepared=await media.prepareGenerationMediaRequest(submitted,{baseUrl,nativeConfiguration:metadata,resolveMedia,transport:(value,options)=>transport.prepareWorkflowInputs(value,{...options,serialize})});
  for(const input of prepared.inputs)assert.equal(Buffer.from(input.url.split(',')[1],'base64').toString(),'actual-'+input.type);
  assert.equal(prepared.inputs[1].role,'reference_video');assert.equal(prepared.inputs[2].duration,3);assert.equal(submitted.inputs[0].url,'asset:image');
  await assert.rejects(media.prepareGenerationMediaRequest(request({mode:'全能参考'},[image('person'),{type:'audio',url:'https://media.example/a.wav'}]),{baseUrl,nativeConfiguration:metadata,resolveMedia:async node=>({url:node[node.type],width:640,height:360,duration:1}),transport:()=>assert.fail('duration must fail before transport')}),/每段须为 2/);
  await assert.rejects(media.prepareGenerationMediaRequest(submitted,{baseUrl,nativeConfiguration:metadata,resolveMedia,transport:async value=>({...value,inputs:value.inputs.map(input=>input.type==='video'?{...input,url:'data:video/webm;base64,eA=='}:input)})}),/尚未编码|格式/);
 }finally{Object.values(urls).forEach(url=>URL.revokeObjectURL(url));}
});

test('Agent subject snapshots expand once into native references and source guards remain active during transport',async()=>{
 const [,media]=await ready;
 const {subjectToken}=await import('../src/features/subject-library/model.mjs');
 const subject={id:'actor',name:'角色',assets:[{id:'face',type:'image',url:'https://media.example/face.png'},{id:'action',type:'video',url:'https://media.example/action.mp4'},{id:'voice',type:'audio',url:'https://media.example/voice.mp3'}]};
 const resolveMedia=async node=>({url:node[node.type],width:640,height:360,duration:3});
 const submitted={...request({mode:'全能参考',subjects:[subject]}),prompt:subjectToken(subject)+'继续动作'};
 const prepared=await media.prepareGenerationMediaRequest(submitted,{baseUrl,nativeConfiguration:metadata,resolveMedia,transport:async value=>value});
 assert.deepEqual(prepared.inputs.map(input=>input.role),['reference_image','reference_video','reference_audio']);assert.match(prepared.prompt,/\{\{Image 1\}\}/);assert.match(prepared.prompt,/\{\{Audio 1\}\}/);
 const repeated=await media.prepareGenerationMediaRequest(prepared,{baseUrl,nativeConfiguration:metadata,resolveMedia,transport:async value=>value});assert.deepEqual(repeated,prepared);
 let changed=false;
 await assert.rejects(media.prepareGenerationMediaRequest(submitted,{baseUrl,nativeConfiguration:metadata,resolveMedia,validateSources:()=>{if(changed)throw Error('参考已变化');},transport:async(value,options)=>{changed=true;options.validateSources();return value;}}),/参考已变化/);
});
