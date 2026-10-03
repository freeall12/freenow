'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const ready=import('../src/features/local-resource-migration/node-video-repair.mjs');
const old='https://files.tapnow.media/unknown-video.mp4?token=synthetic-only',bytes=Buffer.from('synthetic-video-byte-contract'),cover=Buffer.from('synthetic-decoded-jpeg-byte-contract');
const file=()=>new Blob([bytes],{type:'video/mp4'}),hash=value=>createHash('sha256').update(value).digest('hex');
async function fixture(){
 const {createNodeVideoRepair}=await ready;
 let node={id:'selected',type:'video',video:old,image:old+'.jpg',fullImage:'asset:old-cover',poster:old+'.jpg',thumbnail:old+'.jpg',clip:{start:20,end:24},durationMs:30000,x:10,y:20,width:240,height:160,generation:{duration:8,model:'old-model'},sourceJournal:{source:old,signature:'keep'}},project='qa',current=true,jobs=[],fallback=old,stored={nodes:[structuredClone(node)]};
 const other=structuredClone({...node,id:'other'}),undo=[],blobs=new Map();let puts=0,updates=0,saves=0,reads=0;
 const options={nodeId:'selected',getNode:()=>node,getProjectId:()=>project,isCurrent:()=>current,getJobs:()=>jobs,getVideoSource:n=>n?.video||fallback,
  assets:{put:async blob=>{const ref='asset:video-qa-'+(++puts);blobs.set(ref,blob);return ref;}},readAsset:async ref=>{reads++;return blobs.get(ref);},hashBytes:async value=>hash(value),
  decodeVideo:async blob=>{assert.deepEqual(Buffer.from(await blob.arrayBuffer()),bytes);return {width:320,height:180,duration:2.5,thumbnailBlob:new Blob([cover],{type:'image/jpeg'})};},
  updateNode:(_id,patch)=>{updates++;undo.push(structuredClone(node));Object.assign(node,patch);},saveProject:async()=>{saves++;stored={nodes:[structuredClone(node),structuredClone(other)]};},readProject:async()=>structuredClone(stored)};
 return {options,create:()=>createNodeVideoRepair(options),node:()=>node,other,undo,counts:()=>({puts,updates,saves,reads}),setProject:value=>{project=value;},setCurrent:value=>{current=value;},setJobs:value=>{jobs=value;},setNode:value=>{node=value;},setFallback:value=>{fallback=value;},stored:()=>stored};
}
test('video repair verifies video and real-reader cover bytes, uses actual dimensions/duration and resets old clip with one undo',async()=>{
 const f=await fixture(),before=structuredClone(f.node()),other=structuredClone(f.other),result=await f.create().repair(file());
 assert.equal(result.persisted,true);assert.equal(result.sha256,hash(bytes));assert.equal(result.bytes,bytes.length);assert.equal(f.node().video,'asset:video-qa-1');for(const key of ['image','fullImage','poster','thumbnail'])assert.equal(f.node()[key],'asset:video-qa-2');
 assert.equal(f.node().pixelWidth,320);assert.equal(f.node().pixelHeight,180);assert.equal(f.node().durationMs,2500);assert.equal(f.node().clip,null);assert.deepEqual(f.node().provenance,{kind:'imported',mediaSource:result.ref,model:null});assert.deepEqual(f.node().sourceJournal,before.sourceJournal);assert.deepEqual(f.node().generation,before.generation);assert.equal(f.node().width,240);assert.deepEqual(f.other,other);assert.deepEqual(f.undo,[before]);assert.deepEqual(f.counts(),{puts:2,updates:1,saves:1,reads:2});
});
test('EDITOR_DATA fallback is replaced on the selected node without rewriting the fallback map',async()=>{
 const f=await fixture();delete f.node().video;const result=await f.create().repair(file());assert.equal(result.persisted,true);assert.equal(f.node().video,result.ref);assert.equal(f.node().sourceJournal.source,old);
});
test('MIME, decode, dimensions, duration, frame and actual-byte failures do not publish an edit',async()=>{
 for(const mode of ['mime','empty','oversize','decode','dimensions','zero-duration','infinite-duration','overflow-duration','frame','video-bytes','poster-bytes','poster-mime']){
  const f=await fixture(),before=structuredClone(f.node()),normal=f.options.decodeVideo,read=f.options.readAsset;let input=file();
  if(mode==='mime')input=new Blob([bytes],{type:'application/octet-stream'});if(mode==='empty')input=new Blob([],{type:'video/mp4'});if(mode==='oversize')input=new Blob([new Uint8Array(100*1024*1024+1)],{type:'video/mp4'});
  f.options.decodeVideo=async blob=>{if(mode==='decode')throw Error('decoder rejected');const metadata=await normal(blob);if(mode==='dimensions')metadata.width=9000;if(mode==='zero-duration')metadata.duration=0;if(mode==='infinite-duration')metadata.duration=Infinity;if(mode==='overflow-duration')metadata.duration=Number.MAX_VALUE;if(mode==='frame')metadata.thumbnailBlob=null;return metadata;};
  f.options.readAsset=async ref=>{if(mode==='video-bytes'&&ref.endsWith('-1'))return new Blob([Buffer.from(bytes).fill(1)],{type:'video/mp4'});if(mode==='poster-bytes'&&ref.endsWith('-2'))return new Blob([Buffer.from(cover).fill(1)],{type:'image/jpeg'});if(mode==='poster-mime'&&ref.endsWith('-2'))return new Blob([cover],{type:'image/png'});return read(ref);};
  await assert.rejects(f.create().repair(input));assert.deepEqual(f.node(),before);assert.equal(f.counts().updates,0);assert.equal(f.counts().saves,0);
 }
});
test('node/source/context changes and active generation during import prevent a late replacement',async()=>{
 for(const mode of ['node','identity','fallback','project','current','pending','queued','running','applying']){
  const f=await fixture();if(mode==='fallback')delete f.node().video;const read=f.options.readAsset;
  f.options.readAsset=async ref=>{const blob=await read(ref);if(mode==='node')f.node().generation.prompt='later';if(mode==='identity')f.setNode(structuredClone(f.node()));if(mode==='fallback')f.setFallback(old+'changed');if(mode==='project')f.setProject('other');if(mode==='current')f.setCurrent(false);if(mode==='pending')f.node().pendingOperation='video.generate';if(['queued','running','applying'].includes(mode))f.setJobs([{id:'job',status:mode==='applying'?'succeeded':mode,applying:true,request:{parameters:{canvasResults:{targetNodeIds:['selected']}}}}]);return blob;};
  await assert.rejects(f.create().repair(file()));assert.equal(f.counts().updates,0);assert.equal(f.counts().saves,0);
 }
});
test('failed save keeps applied media; retry imports nothing and adds no undo; successful retry is idempotent',async()=>{
 const f=await fixture(),normal=f.options.saveProject;let first=true;f.options.saveProject=async()=>{if(first){first=false;throw Error('disk failure');}return normal();};
 const service=f.create(),result=await service.repair(file());assert.equal(result.applied,true);assert.equal(result.persisted,false);assert.equal(f.stored().nodes[0].video,old);const retry=await service.retrySave();assert.equal(retry.persisted,true);assert.equal(f.undo.length,1);assert.equal(f.counts().puts,2);const counts=f.counts();assert.equal((await service.retrySave()).persisted,true);assert.deepEqual(f.counts(),counts);
});
test('save/read awaits recheck project, target and poster; drift reports unconfirmed without rollback',async()=>{
 for(const mode of ['project','identity','poster','video','clip','duration','pixels','alias','attribution']){
  const f=await fixture(),save=f.options.saveProject,read=f.options.readProject;
  if(mode==='project')f.options.saveProject=async()=>{await save();f.setProject('other');};
  else f.options.readProject=async()=>{const value=await read();if(mode==='identity')f.setNode(structuredClone(f.node()));if(mode==='poster')f.node().image='asset:later-poster';if(mode==='video')f.node().video=old;if(mode==='clip')f.node().clip={start:0,end:1};if(mode==='duration')f.node().durationMs=9000;if(mode==='pixels')f.node().pixelWidth=700;if(mode==='alias')f.node().thumbnail='asset:later-cover';if(mode==='attribution')f.node().provenance.kind='generation-result';return value;};
  const service=f.create(),result=await service.repair(file());assert.equal(result.applied,true);assert.equal(result.persisted,false);assert.equal(service.status().persisted,false);
 }
});
test('moving the target is retained and an already local primary is not a pending video repair',async()=>{
 const f=await fixture(),read=f.options.readAsset;f.options.readAsset=async ref=>{f.node().x=500;return read(ref);};await f.create().repair(file());assert.equal(f.node().x,500);
 const local=await fixture();local.node().video='asset:existing';assert.throws(()=>local.create(),/没有待修复/);
});
