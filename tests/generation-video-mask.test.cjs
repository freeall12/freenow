'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {Readable}=require('node:stream'),{createHash}=require('node:crypto');
const {createVideoMaskProvider,parseVideoMaskModelMap}=require('../server/generation-video-mask.cjs');
const {encodeRGBA}=require('../server/generation-png-alpha.cjs');
const MODEL='fal-ai/wan-vace-14b/inpainting',KEY='fixture-wan-only-key';
const modelMap=Object.fromEntries(['video.erase','video.replace'].map(kind=>[kind,{kind,model:MODEL,semantics:'explicit-native-alternative'}]));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const png=encodeRGBA(2,2,Buffer.alloc(16,128));
const fixture=()=>fs.readFile(path.join(__dirname,'../qa/trim-scenes.mp4'));
const metadata={width:320,height:180,fps:30,numFrames:240,duration:8,pts:Array.from({length:240},(_,i)=>i/30),hasAudio:false};
// Queue/codec contract stubs deliberately stand in for external generation and
// actual output decoding. The separate combined test uses real 720p MP4 bytes.
const outputMetadata={...metadata,width:1280,height:720};
function request(bytes,kind='video.erase',patch={}){return {kind,label:'视频遮罩',nodeId:'source',prompt:'',inputs:[{type:'video',role:'source_video',url:'data:video/mp4;base64,'+bytes.toString('base64')},...(kind==='video.replace'?[{type:'image',role:'replacement_image',url:'data:image/png;base64,'+png.toString('base64')}]:[])],parameters:{action:kind==='video.replace'?'replace':'remove',sourceClip:null,mask:{encoding:'rle-zero-based-row-major',width:320,height:180,fps:30,frames:Array.from({length:240},(_,i)=>`${i%100} 3`)},aspectRatio:'adaptive',resolution:'720p',candidateCount:1,...patch}};}
async function setup(t,options={}){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'wan-mask-provider-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const bytes=await fixture(),calls=[],uploads=[],events=[],codecCalls=[];
 const mediaTools={prepareMedia:async(input)=>{codecCalls.push({kind:'prepare',input});return {video:{bytes:input.source.bytes,mime:'video/mp4',metadata},mask:{bytes,mime:'video/mp4',metadata},audio:null,metadata,sourceRange:{start:input.sourceClip?.start??0,end:input.sourceClip?.end??8}};},validateResult:async(input,prepared)=>{codecCalls.push({kind:'validate',input,prepared});return {...input,metadata:outputMetadata};},preserveAudio:async(input,prepared)=>{codecCalls.push({kind:'audio',input,prepared});return {...input,metadata:outputMetadata};}};
 const uploader={upload:async(file,{onStage})=>{uploads.push(file);const identity={fileUrl:'https://v3.fal.media/'+file.fileName,mime:file.mime,bytes:file.bytes.length,sha256:sha(file.bytes)};for(const stage of ['initiating','initiated','uploading','uploaded']){const event={stage,status:stage==='uploaded'?'uploaded':'preparing',identity:stage==='initiating'?null:identity};events.push(event);await onStage(event);}return {status:'uploaded',...identity};}};
 const fetchImpl=async(url,options)=>{calls.push({url:String(url),method:options.method,body:options.body&&JSON.parse(options.body),headers:new Headers(options.headers)});return Response.json(options.method==='POST'?{request_id:'wan-original',status:'IN_QUEUE'}:options.method==='PUT'?{request_id:'wan-original',status:'CANCELLATION_REQUESTED'}:String(url).includes('/status')?{request_id:'wan-original',status:'COMPLETED'}:{video:{url:'https://v3.fal.media/result.mp4',content_type:'video/mp4',width:1280,height:720,fps:30,num_frames:240,duration:8,file_size:bytes.length}},{status:options.method==='PUT'?202:200});};
 const download=async(url,options)=>{assert.equal(options.headers,undefined);assert.equal(options.kind,'video');return {mime:'video/mp4',stream:Readable.from([bytes]),expectedBytes:bytes.length};};
 const create=patch=>createVideoMaskProvider({apiKey:KEY,modelMap,directory,mediaTools,uploader,fetchImpl,download,...options,...patch});
 return {directory,bytes,calls,uploads,events,codecCalls,mediaTools,uploader,fetchImpl,download,create,p:create()};
}
test('only exact explicit kind mappings expose the distinct bounded video-mask profile',async t=>{
 const s=await setup(t),p=s.p;assert.equal(p.configured,true);assert.equal(p.metadata.protocol,'fal-video-mask-native');assert.deepEqual(p.metadata.capabilities.kinds,['video.erase','video.replace']);assert.equal(p.metadata.capabilities.videoMask.semantics,'explicit-native-alternative');assert.equal(p.metadata.capabilities.videoMask.preservesSourceAudio,'local-remux');
 for(const map of [{erase:modelMap['video.erase']},{'video.erase':{...modelMap['video.erase'],model:'fal-ai/wan-vace-14b'}},{'video.erase':{...modelMap['video.erase'],kind:'video.replace'}},{'video.erase':{kind:'video.erase',model:MODEL}},{'video.erase':{...modelMap['video.erase'],audio:false}}])assert.throws(()=>parseVideoMaskModelMap(map));
 for(const patch of [{apiKey:''},{modelMap:{}},{baseUrl:'https://queue.fal.run/other'},{baseUrl:'https://other.example'},{baseUrl:'https://queue.fal.run?key=x'}])assert.equal(s.create(patch).configured,false);
 for(const hidden of [KEY,MODEL,'queue.fal.run',s.directory])assert.ok(!JSON.stringify(p.metadata).includes(hidden));
});
test('prepare is identity-preserving pure validation with no directories codecs uploads or generation',async t=>{
 const s=await setup(t),directory=path.join(s.directory,'not-created'),p=s.create({directory}),input=request(s.bytes),before=structuredClone(input);assert.equal(p.prepare(input),input);assert.deepEqual(input,before);await assert.rejects(fs.stat(directory),{code:'ENOENT'});assert.equal(s.codecCalls.length,0);assert.equal(s.uploads.length,0);assert.equal(s.calls.length,0);
});
test('unsupported action mask references clips audio controls and unknown fields reject before dispatch',async t=>{
 const s=await setup(t),base=request(s.bytes),cases=[
  request(s.bytes,'video.erase',{action:'replace'}),request(s.bytes,'video.erase',{candidateCount:2}),request(s.bytes,'video.erase',{resolution:'1080p'}),request(s.bytes,'video.erase',{aspectRatio:'16:9'}),request(s.bytes,'video.erase',{generateAudio:false}),request(s.bytes,'video.erase',{seed:2}),request(s.bytes,'video.erase',{model:'tapnow-video-edit'}),request(s.bytes,'video.erase',{providerParameters:{model:'video.erase',quality:'high'}}),
  {...base,prompt:'discard me'},{...base,references:{}},{...base,references:[{url:'x'}]},{...base,sourceClip:{start:0,end:4}},{...base,inputs:[{...base.inputs[0],clip:{start:0,end:4}}]},request(s.bytes,'video.replace'),
  request(s.bytes,'video.erase',{sourceClip:{start:.01,end:4}}),request(s.bytes,'video.erase',{sourceClip:{start:0,end:9}}),request(s.bytes,'video.erase',{sourceClip:{start:0,end:1}}),
  request(s.bytes,'video.erase',{mask:{...base.parameters.mask,encoding:'rectangle'}}),request(s.bytes,'video.erase',{mask:{...base.parameters.mask,frames:Array(240).fill('')}}),request(s.bytes,'video.erase',{mask:{...base.parameters.mask,frames:Array(240).fill('4 -1')}}),request(s.bytes,'video.erase',{mask:{...base.parameters.mask,fps:120}}),request(s.bytes,'video.erase',{mask:{...base.parameters.mask,rectangle:{x:1}}}),
  {...base,inputs:[{...base.inputs[0],url:'https://tapnow.media/private.mp4'}]},{...base,inputs:[{...base.inputs[0],url:'https://127.0.0.1/x.mp4'}]},{...base,inputs:[{...base.inputs[0],url:'blob:private'}]},{...base,inputs:[{...base.inputs[0],duration:4}]}
 ];cases[13].inputs.pop();
 for(const input of cases)assert.throws(()=>s.p.prepare(input));assert.equal(s.calls.length,0);assert.equal(s.uploads.length,0);assert.equal(s.codecCalls.length,0);
});
test('selected frame-boundary clip consumes full mask and requires a target inside the selected range',async t=>{
 const s=await setup(t),input=request(s.bytes,'video.erase',{sourceClip:{start:1,end:6}});assert.equal(s.p.prepare(input),input);
 const hidden=request(s.bytes,'video.erase',{sourceClip:{start:1,end:6}});hidden.parameters.mask.frames=hidden.parameters.mask.frames.map((v,i)=>i<30?v:'');assert.throws(()=>s.p.prepare(hidden),/没有目标/);
 await s.p.submit(input);const prepared=s.codecCalls[0].input;assert.equal(prepared.mask.frames.length,240);assert.deepEqual(prepared.sourceClip,{start:1,end:6});assert.deepEqual(prepared.source.bytes,s.bytes);
});
test('replace uploads actual source mask and decoded reference once then posts exact native body',async t=>{
 const s=await setup(t),input=request(s.bytes,'video.replace'),before=structuredClone(input),states=[],identities=[];const accepted=await s.p.submit(input,{onPreparationState:async v=>states.push(structuredClone(v)),onTaskIdentity:async id=>identities.push(id)});
 assert.deepEqual(input,before);assert.equal(s.uploads.length,3);assert.deepEqual(s.uploads[0].bytes,s.bytes);assert.deepEqual(s.uploads[2].bytes,png);assert.equal(s.calls.length,1);assert.equal(s.calls[0].url,'https://queue.fal.run/'+MODEL);assert.equal(s.calls[0].headers.get('authorization'),'Key '+KEY);
 assert.deepEqual(s.calls[0].body,{prompt:'Replace the masked object with the subject in the reference image, preserving the surrounding scene and motion.',video_url:'https://v3.fal.media/video.mp4',mask_video_url:'https://v3.fal.media/mask.mp4',ref_image_urls:['https://v3.fal.media/reference.png'],resolution:'720p',aspect_ratio:'auto',match_input_num_frames:true,match_input_frames_per_second:true,enable_prompt_expansion:false,enable_auto_downsample:false,temporal_downsample_factor:0,num_interpolated_frames:0,preprocess:false,enable_safety_checker:true,sync_mode:false});
 assert.deepEqual(identities,[accepted.id]);assert.equal(states[0].stage,'media-preparing');assert.equal(states.at(-1).stage,'generation-accepted');assert.equal(accepted.status,'queued');assert.ok(accepted.id.length<2048);
 for(const state of states)assert.deepEqual(Object.keys(state).sort(),['kind','preparationId','protocol','requestHash','stage','status','version']);
 const stat=await fs.stat(path.join(s.directory,states[0].preparationId,'manifest.json'));assert.equal(stat.mode&0o777,0o600);assert.ok(!JSON.stringify(states).includes('https:'));assert.ok(!JSON.stringify(states).includes(KEY));
});
test('awaited durable checkpoint failure stops the next upload or billable generation phase',async t=>{
 for(const stop of ['media-preparing','media-ready','upload-initiating','upload-initiated','uploading','uploaded','generation-dispatching']){
  const s=await setup(t),states=[];await assert.rejects(()=>s.p.submit(request(s.bytes),{onPreparationState:async state=>{states.push(state);if(state.stage===stop)throw Object.assign(Error('fixture storage'),{code:'storage_error'});}}));assert.equal(s.calls.length,0);if(['media-preparing','media-ready'].includes(stop))assert.equal(s.uploads.length,0);assert.equal(states.at(-1).stage,stop);
 }
});
test('uncertain upload and lost generation receipt restart only reads original preparation without republishing',async t=>{
 const s=await setup(t),states=[],badUploader={upload:async(file,{onStage})=>{await onStage({stage:'initiating',status:'unknown',identity:null});throw Error('fixture lost receipt');}};
 await assert.rejects(()=>s.create({uploader:badUploader}).submit(request(s.bytes),{onPreparationState:async state=>states.push(state)}),{code:'unknown'});assert.equal(s.calls.length,0);
 const readOnly=s.create({uploader:{upload:()=>assert.fail('no restart upload')},fetchImpl:()=>assert.fail('no restart generation')});assert.deepEqual(await readOnly.resumePreparation(states.at(-1),{request:request(s.bytes)}),{status:'unknown',code:'media_preparation_unconfirmed'});
 const lost=[],p=s.create({fetchImpl:async()=>{lost.push('POST');throw Error('fixture lost queue');}}),queueStates=[];await assert.rejects(()=>p.submit(request(s.bytes),{onPreparationState:async v=>queueStates.push(v)}),{code:'unknown'});assert.equal(lost.length,1);assert.equal((await readOnly.resumePreparation(queueStates.at(-1))).status,'unknown');
});
test('original task identity is persisted before callback and recovered read-only if callback fails',async t=>{
 const s=await setup(t),states=[];await assert.rejects(()=>s.p.submit(request(s.bytes),{onPreparationState:async v=>states.push(v),onTaskIdentity:async()=>{throw Object.assign(Error('fixture identity storage failed'),{code:'storage_error'});}}),{code:'storage_error'});
 const restored=await s.create({apiKey:'fixture-rotated-key',uploader:{upload:()=>assert.fail()}}).resumePreparation(states.at(-1),{request:request(s.bytes)});assert.equal(restored.status,'queued');assert.ok(restored.id.startsWith('wm1.'));assert.equal(s.calls.filter(v=>v.method==='POST').length,1);
 await assert.rejects(()=>s.p.resumePreparation(states.at(-1),{request:{...request(s.bytes),nodeId:'changed'}}),{code:'provider_identity_mismatch'});
});
test('poll validates actual result and always handles original audio before publishing verified local bytes',async t=>{
 const s=await setup(t),states=[],accepted=await s.p.submit(request(s.bytes),{onPreparationState:async v=>states.push(v)}),restart=s.create({uploader:{upload:()=>assert.fail('no uploads on poll')}});
 const result=await restart.poll(accepted.id,{request:request(s.bytes),preparationState:states.at(-1)});assert.equal(result.status,'succeeded');assert.deepEqual(Buffer.from(result.outputs[0].url.split(',')[1],'base64'),s.bytes);assert.deepEqual(result.outputs[0].sourceRange,{start:0,end:8});assert.equal(s.codecCalls.filter(v=>v.kind==='validate').length,1);assert.equal(s.codecCalls.filter(v=>v.kind==='audio').length,1);
 assert.deepEqual(s.calls.slice(1).map(v=>v.url),['https://queue.fal.run/fal-ai/wan-vace-14b/requests/wan-original/status?logs=0','https://queue.fal.run/fal-ai/wan-vace-14b/requests/wan-original']);const before=s.calls.length;assert.equal((await s.create().poll(accepted.id)).status,'succeeded');assert.equal(s.calls.length,before);assert.equal(s.calls.filter(v=>v.method==='POST').length,1);
});
test('staged output orphan from interrupted manifest commit is replaceable without resubmitting',async t=>{
 const s=await setup(t),states=[],accepted=await s.p.submit(request(s.bytes),{onPreparationState:async v=>states.push(v)});await fs.writeFile(path.join(s.directory,states[0].preparationId,'result.bin'),Buffer.from('uncommitted-orphan'),{mode:0o600});assert.equal((await s.p.poll(accepted.id)).status,'succeeded');assert.equal(s.calls.filter(v=>v.method==='POST').length,1);
});
test('bad actual timing supplier metadata result URL and secret echoes never publish or resubmit',async t=>{
 for(const mode of ['timing','metadata','secret-json','secret-url','secret-bytes','wrong-id']){
  const s=await setup(t),accepted=await s.p.submit(request(s.bytes));let downloads=0;
  const fetchImpl=async(url,options)=>{const response=await s.fetchImpl(url,options),value=await response.json();if(String(url).includes('/status')){if(mode==='wrong-id')value.request_id='other';if(mode==='secret-json')value.unused={key:KEY};}else if(value.video){if(mode==='metadata')value.video.num_frames=239;if(mode==='secret-url')value.video.url+='?x='+encodeURIComponent(KEY);}return Response.json(value);};
  const mediaTools={...s.mediaTools,validateResult:async(...args)=>{if(mode==='timing')throw Error('fixture actual PTS mismatch');return s.mediaTools.validateResult(...args);}};
  const download=async(...args)=>{downloads++;if(mode==='secret-bytes')return {mime:'video/mp4',stream:Readable.from([Buffer.from(KEY)])};return s.download(...args);};
  await assert.rejects(()=>s.create({fetchImpl,download,mediaTools}).poll(accepted.id));if(['secret-json','secret-url','wrong-id'].includes(mode))assert.equal(downloads,0);assert.equal(s.calls.filter(v=>v.method==='POST').length,1);
 }
});
test('forged cross-kind identity changed configuration corrupted cache and cancellation keep original semantics',async t=>{
 const s=await setup(t),states=[],accepted=await s.p.submit(request(s.bytes),{onPreparationState:async v=>states.push(v)}),parts=JSON.parse(Buffer.from(accepted.id.slice(4),'base64url'));
 parts[1]='video.replace';await assert.rejects(()=>s.p.poll('wm1.'+Buffer.from(JSON.stringify(parts)).toString('base64url')),{code:'provider_identity_mismatch'});
 await assert.rejects(()=>s.create({modelMap:{}}).poll(accepted.id));assert.deepEqual(await s.p.cancel(accepted.id),{id:accepted.id,status:'unknown'});assert.equal(s.calls.at(-1).url,'https://queue.fal.run/fal-ai/wan-vace-14b/requests/wan-original/cancel');assert.equal(s.calls.at(-1).method,'PUT');
 await s.p.poll(accepted.id);await fs.writeFile(path.join(s.directory,states[0].preparationId,'result.bin'),Buffer.from('corrupted'),{mode:0o600});await assert.rejects(()=>s.create().poll(accepted.id),{code:'unknown'});assert.equal(s.calls.filter(v=>v.method==='POST').length,1);
});
test('real lazy uploader constructor uses the supported single-shot 90MiB cap',async t=>{
 const s=await setup(t),module=require('../server/generation-fal-upload.cjs'),original=module.createFalUpload;let constructed=0;
 module.createFalUpload=options=>{constructed++;assert.equal(options.maxBytes,module.MAX_FILE_BYTES);assert.doesNotThrow(()=>original(options));return s.uploader;};
 try{const p=s.create({uploader:undefined});assert.equal(constructed,0);p.prepare(request(s.bytes));assert.equal(constructed,0);assert.equal((await p.submit(request(s.bytes))).status,'queued');assert.equal(constructed,1);}finally{module.createFalUpload=original;}
});
test('local output pixel acceptance rejects low-resolution pixels rather than believing 720p labels',async t=>{
 const s=await setup(t),accepted=await s.p.submit(request(s.bytes)),p=s.create({mediaTools:{...s.mediaTools,validateResult:async input=>({...input,metadata:{...metadata,width:16,height:9}})}});await assert.rejects(()=>p.poll(accepted.id),{code:'unknown'});assert.equal(s.codecCalls.filter(v=>v.kind==='audio').length,0);assert.equal(s.calls.filter(v=>v.method==='POST').length,1);
});
test('poll and read-only preparation recovery bind the private manifest to the original local durable task',async t=>{
 const s=await setup(t),localTaskId='12345678-1234-4123-8123-123456789012',wrong='12345678-1234-4123-8123-123456789013',states=[],accepted=await s.p.submit(request(s.bytes),{localTaskId,onPreparationState:async value=>states.push(value)}),before=s.calls.length;
 await assert.rejects(()=>s.p.poll(accepted.id,{localTaskId:wrong}),{code:'provider_identity_mismatch'});await assert.rejects(()=>s.p.resumePreparation(states.at(-1),{localTaskId:wrong}),{code:'provider_identity_mismatch'});assert.equal(s.calls.length,before);
 assert.equal((await s.p.resumePreparation(states.at(-1),{localTaskId})).id,accepted.id);assert.equal((await s.p.poll(accepted.id,{localTaskId})).status,'succeeded');
 const generated=await s.p.generate(request(s.bytes),{localTaskId,pollInterval:1});assert.equal(generated.status,'succeeded');
});
