const test=require('node:test'),assert=require('node:assert/strict'),audio=require('../audio-core.js');
test('audio waveform uses every sample and channel, including final partial bin',()=>{
 assert.deepEqual(audio.peaks([Float32Array.from([0,.5,0,0,0]),Float32Array.from([0,0,0,0,.75])],2),[.5,.75]);
 assert.deepEqual(audio.peaks([new Float32Array(20)],4),[0,0,0,0]);assert.deepEqual(audio.peaks([],10),[]);
});
test('audio model transitions discard incompatible media and model-specific parameters',()=>{
 const speech=audio.transition({prompt:'hello',references:[{id:'a',type:'audio'},{id:'v',type:'video'},{id:'t',type:'text'}]},'seed-audio-1-0','Text-to-Speech');
 assert.deepEqual(speech.references.map(r=>r.id),['a','t']);assert.equal(speech.params.sample_rate,24000);
 const music=audio.transition(speech,'mureka-v8');assert.equal(music.scene,'Music');assert.equal(music.params.sample_rate,undefined);assert.deepEqual(music.references.map(r=>r.id),['t']);assert.equal(music.prompt,'hello');
});
test('audio validation rejects mixed Seed references, empty custom lyrics and invalid duration',()=>{
 const speech=audio.transition({prompt:'你好'},'seed-audio-1-0');assert.throws(()=>audio.validate(speech,[{type:'image'},{type:'audio'}]),/混用/);
 const music=audio.transition({prompt:'民谣'},'elevenlabs-v3','Music');music.params.lyric_mode=true;assert.throws(()=>audio.validate(music),/歌词/);music.params.lyrics='[Verse]\nhello';music.params.music_length_ms=301000;assert.throws(()=>audio.validate(music),/时长/);music.params.music_length_ms=30000;assert.equal(audio.validate(music),'民谣');
 const video=audio.transition({},'sonilo-music');assert.equal(audio.validate(video,[{type:'video'}]),'');
});
test('local audio rejects empty, unsupported and oversized files before storage',()=>{
 assert.throws(()=>audio.validateFile({name:'a.wav',size:0}),/为空/);assert.throws(()=>audio.validateFile({name:'a.exe',size:20}),/格式/);assert.throws(()=>audio.validateFile({name:'a.mp3',size:51*1024*1024}),/50MB/);audio.validateFile({name:'a.wav',size:200});
});

test('Agent audio confirmation changes scene, clears unsupported fields, and sends automatic duration explicitly',async()=>{
 const {createAudioDraft,normalizeAudio,audioRequestConfig,validateAudioDraft}=await import('../src/features/agent-generation/audio.mjs');
 const old=audio.transition({prompt:'音乐'},'elevenlabs-v3','Music');old.params.music_length_ms=60000;old.params.lyric_mode=true;old.params.lyrics='旧歌词';
 const args={nodeId:'a',kind:'audio.generate',model:'elevenlabs',audioScene:'Music',prompt:'新提示',duration:null,lyricsMode:'instrumental'};
 const draft=createAudioDraft(args,[{id:'a',audioConfig:old}]);assert.equal(draft.duration,null);assert.equal(draft.lyrics,'');
 const request=audioRequestConfig(audio,old,draft);assert.equal(request.params.music_length_ms,undefined);assert.equal(request.params.force_instrumental,true);assert.equal(request.params.lyrics,'');assert.equal(request.prompt,'新提示');
 const speech=normalizeAudio({...draft,audioScene:'Text-to-Speech'});assert.equal(speech.lyricsMode,undefined);assert.equal(speech.duration,undefined);assert.equal(speech.stability,.5);
 const sound=normalizeAudio({...draft,audioScene:'Sound',duration:60});assert.equal(sound.duration,null);assert.equal(sound.promptInfluence,.3);
 assert.throws(()=>validateAudioDraft({...sound,duration:23}),/时长/);assert.throws(()=>validateAudioDraft({...draft,lyricsMode:'custom',lyrics:''}),/歌词/);
 const seed=normalizeAudio({...draft,model:'doubao-seed-audio'});assert.equal(seed.audioScene,'Text-to-Speech');assert.equal(seed.audioFormat,'wav');assert.equal(seed.sampleRate,24000);assert.equal(seed.lyricsMode,undefined);
});

test('Audio reference snapshot excludes output node, keeps original audit and rejects deleted references',async()=>{
 const {snapshotAudioCall}=await import('../src/features/agent-generation/audio.mjs');const {createGenerationDraft,confirmedArguments}=await import('../src/features/agent-generation/model.mjs');const {executeTracedCall}=await import('../src/features/agent-execution/trace.mjs');
 const state={nodes:[{id:'a',type:'audio',audioConfig:{references:[{id:'t',type:'text'}]}},{id:'t',type:'text',content:'参考文字'}],edges:[{source:'t',target:'a'}]};
 const original={callId:'call',name:'generation_submit',args:{nodeId:'a',kind:'audio.generate',model:'elevenlabs',prompt:'说这句话'}};
 const call=snapshotAudioCall(original,state);assert.deepEqual(call.args.referenceIds,['t']);assert.equal(original.args.referenceIds,undefined);assert.deepEqual(call.originalArgs,original.args);
 const draft=createGenerationDraft(call.args,{},state.nodes),confirmed=confirmedArguments(call.args,{...draft,referenceIds:['a']},state.nodes);assert.deepEqual(confirmed.referenceIds,['t']);
 assert.throws(()=>confirmedArguments(call.args,draft,state.nodes.slice(0,1)),/参考素材/);
 let trace;await executeTracedCall(call,{changed:value=>trace=value,confirm:async()=>({allowed:true,args:confirmed}),execute:async()=>({taskId:'real-adapter-task'}),createId:()=> 'trace'});assert.deepEqual(trace.originalArgs,original.args);
});

test('Audio wire parameters, schemas, and independent batch confirmations retain actual values',async()=>{
 const {createAudioDraft,audioRequestConfig}=await import('../src/features/agent-generation/audio.mjs');const {parse}=require('../agent-tools.js');
 const args={nodeId:'a',kind:'audio.generate',model:'doubao-seed-audio',prompt:'你好',audioFormat:'mp3',sampleRate:48000,speechRate:25,pitchRate:6,loudnessRate:-25,subtitle:true};parse('generation_submit',args);
 const config=audioRequestConfig(audio,{},args);assert.equal(config.model,'doubao-seed-audio-1-0');assert.deepEqual(config.params,{format:'mp3',sample_rate:48000,speech_rate:25,pitch_rate:6,loudness_rate:-25,enable_subtitle:true});
 parse('generation_submit',{...args,model:'elevenlabs',audioScene:'Music',duration:null});parse('generation_submit',{...args,model:'sonilo',duration:360});assert.throws(()=>parse('generation_submit',{...args,kind:'video.generate',duration:360}),/duration/);assert.throws(()=>parse('generation_submit',{...args,duration:'30'}),/number/);
 const {groupGenerationCalls,batchDraft,batchDecisions,changeBatch}=await import('../src/features/agent-generation/batch.mjs');const nodes=['a','b'].map(id=>({id,type:'audio'})),calls=nodes.map(n=>({callId:n.id,name:'generation_submit',args:{nodeId:n.id,kind:'audio.generate',model:'elevenlabs',audioScene:'Music',prompt:n.id,referenceIds:[]}}));
 assert.equal(groupGenerationCalls(calls,{nodes})[0].length,2);const trace={name:'generation_batch',args:calls[0].args,batchItems:calls},items=batchDraft(trace,()=>({}),nodes);const draft=changeBatch(items[0].args,items,'duration',47,nodes);assert.equal(draft.duration,47);const choices=batchDecisions(trace,{...draft,lyricsMode:'custom',lyrics:'最新歌词'},items,nodes);assert.equal(choices[1].args.lyrics,'最新歌词');assert.equal(audioRequestConfig(audio,{},choices[1].args).params.music_length_ms,47000);
});
