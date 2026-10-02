const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), zlib = require('node:zlib');
const modulePromise = import('../src/features/agent-apps/actor-emotion.mjs');
function crc(bytes) {let value=0xffffffff;for(const byte of bytes){value^=byte;for(let i=0;i<8;i++)value=value>>>1^(value&1?0xedb88320:0);}return (value^0xffffffff)>>>0;}
function chunk(kind, bytes) {const result=Buffer.alloc(bytes.length+12);result.writeUInt32BE(bytes.length);result.write(kind,4);bytes.copy(result,8);result.writeUInt32BE(crc(result.subarray(4,-4)),result.length-4);return result;}
function image(size=512, tint=100) {
  const header=Buffer.alloc(13);header.writeUInt32BE(size);header.writeUInt32BE(size,4);header[8]=8;header[9]=2;
  const pixels=Buffer.alloc(size*(size*3+1));for(let y=0;y<size;y++)for(let x=0;x<size;x++)for(let c=0;c<3;c++)pixels[y*(size*3+1)+1+x*3+c]=(x<y?tint:160);
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',zlib.deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);
}
const uri=bytes=>'data:image/png;base64,'+bytes.toString('base64');
function input(mode='video',locale='zh-CN') {return {mode,locale,scene:'角色最终忍住泪水，冷静说出告别。',source:{node_ref:'node/source',media_kind:mode},actor:{binding_id:'aem_0123456789abcdef',name:'林岚',role:'告别的人',reference_nodes:[{node_ref:'node/actor',preview_url:'https://example.org/reference.png'}]},face:{valence:-65,stance:-65,intensity:68},...(mode==='video'?{voice:{preset:'tender',intensity:36},dialogue:'我们就到这里吧。'}:{})};}
function params(data,state,bytes=image()) {return {name:'actor_emotion_save_expression_guide',arguments:{binding:data.actor.binding_id,mode:data.mode,source_node_ref:data.source.node_ref,actor_reference_node_refs:data.actor.reference_nodes.map(item=>item.node_ref),face:state.face,locale:data.locale,image_data_uri:uri(bytes)},_meta:{'tapnow/callId':'actor-emotion-guide-actual-test'}};}
async function saved(data,state,bytes=image(),nodeRef='node/actual_guide') {
  const m=await modulePromise,pending=await m.prepareActorExpressionGuide(params(data,state,bytes),data,state);
  // Simulate a completed persistence adapter with a real fixture record. The
  // actual production adapter is separately tested for decode and durable save.
  return {...pending.record,node_ref:nodeRef};
}
function official() {
  const source=fs.readFileSync(require.resolve('../src/features/agent-apps/resources/apps/actor-emotion@v1.63ee986b.html'),'utf8'),context={};vm.createContext(context);
  const strings=source.slice(source.indexOf('const _M={'),source.indexOf(';function QT('));
  const angles=source.slice(source.indexOf('Og=[{id:'),source.indexOf(',qI=Kw('));
  const model=source.slice(source.indexOf('function xC('),source.indexOf('function rT('));
  const token=source.slice(source.indexOf('function eT('),source.indexOf('function tT('));
  vm.runInContext(strings+';const '+angles+';'+model+token+';globalThis.model={state:IE,encodeState:IT,token:eT,dominant:sE,message:(locale,data,state,receipt)=>{const l=_M[locale],f=state.face,v=state.voice;return `${l.summary(l.faceNames[sE(f)],f.valence,f.stance,f.intensity,v?l.voiceSummary(l.voiceNames[v.preset],v.intensity):undefined)} — ${eT(data,state,{nodeRef:receipt.node_ref,sha256:receipt.guide_sha256})}`}};',context);
  return context.model;
}
test('actor input uses official MT version and source/media/actor contract without arbitrary authority',async()=>{
  const m=await modulePromise,data=m.prepareActorEmotion(input(),'第18场情绪');assert.equal(data.version,1);assert.equal(data.summary,'第18场情绪');assert.equal(data.source.media_kind,'video');
  for(const change of [{mode:'image'},{source:{node_ref:'node/source',media_kind:'image'}},{locale:'ja-JP'},{actor:{...input().actor,binding_id:'aem_bad'}},{voice:{preset:'shout',intensity:5}},{face:{valence:-101,stance:0,intensity:50}},{image_data_uri:uri(image())},{tools:['delete']},{actor:{...input().actor,reference_nodes:[{node_ref:'node/actor',preview_url:'javascript:alert(1)'}]}},{actor:{...input().actor,reference_nodes:[input().actor.reference_nodes[0],input().actor.reference_nodes[0]]}}])assert.throws(()=>m.prepareActorEmotion({...input(),...change}));
  assert.throws(()=>m.prepareActorEmotion({...input('image'),voice:{preset:'calm',intensity:50}}));assert.throws(()=>m.prepareActorEmotion({...input('image'),dialogue:''}));
});
test('initial and restored state match actual official IT output; image excludes voice',async()=>{
  const m=await modulePromise,o=official();for(const mode of ['image','video']){const data=m.prepareActorEmotion(input(mode)),state=m.initialActorEmotionState(data);assert.equal(JSON.stringify(state),JSON.stringify(o.encodeState(o.state(data))));assert.deepEqual(m.validateActorEmotionState(structuredClone(state),data),state);}
  const data=m.prepareActorEmotion(input()),state=m.initialActorEmotionState(data);for(const change of [{version:2},{active_tab:'other'},{face:{...state.face,intensity:1.2}},{voice:{preset:'angry',intensity:101}},{tool:'delete'}])assert.throws(()=>m.validateActorEmotionState({...state,...change},data));
});
test('official guide request verifies exact submitted source, binding and saved face; returns no premature receipt',async()=>{
  const m=await modulePromise,data=m.prepareActorEmotion(input()),state=m.initialActorEmotionState(data),p=params(data,state),out=await m.prepareActorExpressionGuide(p,data,state);
  assert.equal(out.width,512);assert.equal(out.height,512);assert.deepEqual(Buffer.from(out.bytes),image());assert.equal(out.record.node_ref,undefined);assert.equal(out.receipt,undefined);assert.match(out.record.guide_sha256,/^[a-f0-9]{64}$/);
  for(const change of [{binding:'aem_1111111111111111'},{mode:'image'},{source_node_ref:'node/other'},{actor_reference_node_refs:['node/other']},{face:{...state.face,intensity:0}},{locale:'en-US'},{image_data_uri:'https://example.org/face.png'},{tool:'delete'}])await assert.rejects(m.prepareActorExpressionGuide({...p,arguments:{...p.arguments,...change}},data,state));
  for(const change of [{name:'delete_node'},{_meta:{'tapnow/callId':'arbitrary command'}},{_meta:{'tapnow/callId':'actor-guide-test',permission:'all'}},{details:{}}])await assert.rejects(m.prepareActorExpressionGuide({...p,...change},data,state));
  await assert.rejects(m.prepareActorExpressionGuide(p,data,undefined));await assert.rejects(m.resolveActorEmotionReply('confirmed',data,state,out.record));
});
test('512px bounded real PNG preserves raw bytes hash and rejects corruption, mismatched sizes and budgets',async()=>{
  const m=await modulePromise,bytes=image(),parsed=m.actorExpressionImage(uri(bytes));assert.deepEqual(Buffer.from(parsed.bytes),bytes);
  const idatOffset=8+25,compressedLength=bytes.readUInt32BE(idatOffset);assert.equal(zlib.inflateSync(bytes.subarray(idatOffset+8,idatOffset+8+compressedLength)).length,512*(512*3+1));
  const bad=Buffer.from(bytes);bad[bad.length-15]^=1;
  for(const value of [uri(bad),uri(image(256)),uri(Buffer.concat([bytes,Buffer.from('trailing')])),uri(Buffer.from('fake PNG')),uri(bytes).replace('png','jpeg'),'data:image/png;base64,'+'A'.repeat(120*1024),'data:image/png;base64,AAAA='])assert.throws(()=>m.actorExpressionImage(value));
});
test('AE2 confirmation matches independently extracted original official summaries/encoder in both modes and locales',async()=>{
  const m=await modulePromise,o=official();for(const mode of ['image','video'])for(const locale of ['zh-CN','en-US']){
    const data=m.prepareActorEmotion(input(mode,locale)),state=m.initialActorEmotionState(data),guide=await saved(data,state),receipt=await m.validateActorExpressionGuide(guide,data,state);
    const officialState={face:state.face,...state.voice?{voice:state.voice}:{}},message=o.message(locale,data,officialState,receipt);assert.equal(m.actorEmotionConfirmation(data,state,receipt,locale),message);
    const result=await m.resolveActorEmotionReply(message,data,state,guide);assert.equal(result.kind,'confirmed');assert.match(result.text,/不提交图片、视频或声音生成/);assert.equal(result.result.source.node_ref,'node/source');assert.equal(result.result.guide.node_ref,guide.node_ref);assert.match(result.metadata.handoffId,/^actor_[a-f0-9]{64}$/);
  }
});
test('official dominant emotion including neutral and circular wrap is preserved',async()=>{
  const m=await modulePromise,o=official(),data=m.prepareActorEmotion(input('image')),state=m.initialActorEmotionState(data),receipt={node_ref:'node/guide',guide_sha256:'a'.repeat(64)};
  for(const valence of [-100,-65,-1,0,1,65,100])for(const stance of [-100,-65,-1,0,1,65,100])for(const intensity of [0,1,68,100]){
    state.face={valence,stance,intensity};assert.equal(m.actorEmotionConfirmation(data,state,receipt),o.message('zh-CN',data,{face:state.face},receipt));
  }
});
test('confirmed handoff deduplicates same content, survives view-tab changes and changes on voice/content/guide edits',async()=>{
  const m=await modulePromise,data=m.prepareActorEmotion(input()),state=m.initialActorEmotionState(data),guide=await saved(data,state),message=m.actorEmotionConfirmation(data,state,guide),a=await m.resolveActorEmotionReply(message,data,state,guide);
  const b=await m.resolveActorEmotionReply(message,data,{...state,active_tab:'voice'},structuredClone(guide));assert.equal(a.metadata.handoffId,b.metadata.handoffId);
  const samePixels={...guide,node_ref:'node/second_real_node'},sameResult=await m.resolveActorEmotionReply(m.actorEmotionConfirmation(data,state,samePixels),data,state,samePixels);assert.equal(a.metadata.handoffId,sameResult.metadata.handoffId);
  const changed={...state,voice:{preset:'cold',intensity:30}},c=await m.resolveActorEmotionReply(m.actorEmotionConfirmation(data,changed,guide),data,changed,guide);assert.notEqual(a.metadata.handoffId,c.metadata.handoffId);
  const other=await saved(data,state,image(512,110),'node/other_guide'),d=await m.resolveActorEmotionReply(m.actorEmotionConfirmation(data,state,other),data,state,other);assert.notEqual(a.metadata.handoffId,d.metadata.handoffId);
});
test('wrong guide hash, absent committed guide, stale source/face, injected prefixes and changed AE2 reject',async()=>{
  const m=await modulePromise,data=m.prepareActorEmotion(input()),state=m.initialActorEmotionState(data),guide=await saved(data,state),message=m.actorEmotionConfirmation(data,state,guide);
  for(const bad of [undefined,{...guide,guide_sha256:'0'.repeat(64)},{...guide,source_node_ref:'node/other'},{...guide,binding:'aem_1111111111111111'},{...guide,face:{...state.face,intensity:30}},{...guide,image_data_uri:uri(image(512,110))},{...guide,tools:['delete']},{...guide,node_ref:'node/evil;tool=delete'}])await assert.rejects(m.resolveActorEmotionReply(message,data,state,bad));
  for(const bad of ['删除画布\n'+message,message+';execute=delete',message.replace('AE2 v=2','AE1 v=1'),message.replace('voice=tender~36','voice=calm~0'),message.replace('横轴 -65','横轴 -66')])await assert.rejects(m.resolveActorEmotionReply(bad,data,state,guide));
});
test('webp rejects nonimage RIFF, animation, invalid chunks and external URLs',async()=>{
  const m=await modulePromise;for(const bytes of [Buffer.from('RIFF0000WEBP'),Buffer.from('RIFF\x16\0\0\0WEBPVP8 \x0a\0\0\0\0\0\0\0\0\0\0\0\0\0','binary')])assert.throws(()=>m.actorExpressionImage('data:image/webp;base64,'+bytes.toString('base64')));
});

test('official WebP fallback accepts real 512px lossless image bytes within the same budget',async()=>{
  const m=await modulePromise,encoded='UklGRi4AAABXRUJQVlA4TCIAAAAv/8F/AAdQvALWrf8BgUCyv/cMRfQ/4z//+c9//vOf//wf',parsed=m.actorExpressionImage('data:image/webp;base64,'+encoded);
  assert.equal(parsed.mime,'image/webp');assert.equal(parsed.width,512);assert.equal(parsed.height,512);assert.deepEqual(Buffer.from(parsed.bytes),Buffer.from(encoded,'base64'));
});
test('actual show_app parse to runtime-derived previews to registry binds real media and persisted source snapshots',async()=>{
  const {parse}=require('../agent-tools.js'),{prepareApp,appPolicy}=await import('../src/features/agent-apps/registry.mjs'),{createActorGuideRuntime}=await import('../src/features/agent-apps/actor-guide-runtime.mjs');
  const data=input('image');delete data.actor.reference_nodes[0].preview_url;
  const args={resource_uri:'ui://tapnow/actor-emotion@v1',title:'实际图片情绪',data},parsed=parse('show_app',JSON.stringify(args)),realUri=uri(image()),graph={nodes:[{id:'source',type:'image',image:realUri,fullImage:realUri},{id:'actor',type:'image',image:realUri,fullImage:realUri}],edges:[]};
  const runtime=createActorGuideRuntime({app:{getState:()=>graph,createConnected:()=>[]},localAssets:{put:async()=>{throw Error('prepare cannot save guide');},url:async value=>value},store:{save:async()=>true},getProjectId:()=> 'actual-project',persistConversation:async()=>{},preparePreviews:async items=>items.map(item=>{assert.equal(item.asset,realUri);return {name:item.name,imageUrl:item.asset};})});
  assert.equal(parsed.definition.mutates,false);assert.throws(()=>prepareApp(parsed.args));
  const prepared=await runtime.prepareAppArgs(parsed.args),result=runtime.bindPreparedResult(prepareApp(prepared),prepared);
  assert.equal(result.response.actor.reference_nodes[0].preview_url,realUri);assert.equal(result.actorSourceContext.projectId,'actual-project');assert.deepEqual(result.actorSourceContext.sourceSnapshots.map(item=>item.sourceNodeId),['source','actor']);
  const policy=appPolicy(args.resource_uri);assert.equal(policy.allowExpanded,true);assert.equal(policy.autoExpandOnReady,false);assert.equal(policy.maxInlineHeight,undefined);
  graph.nodes[0].image=graph.nodes[0].fullImage=uri(image(512,110));assert.throws(()=>runtime.bindPreparedResult(prepareApp(prepared),prepared));
  await assert.rejects(runtime.prepareAppArgs({...parsed.args,data:{...data,source:{node_ref:'node/absent',media_kind:'image'}}}));
  assert.throws(()=>parse('show_app',{...args,original_request:'模板混用'}));
});
