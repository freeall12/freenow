'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const modules=Promise.all(['archive','video-thumbnail','thumbnail-resources'].map(name=>import('../src/features/generation-history/'+name+'.mjs')));
test('a single decoded reader validates the video and encodes its real first frame, then disposes',async()=>{
  const [,{inspectVideoThumbnail}]=await modules;let opened=0,disposed=0,frames=0;const actualFrame={pixels:'actual black first frame'},cover=new Blob(['actual black frame'],{type:'image/jpeg'});
  const result=await inspectVideoThumbnail('blob:the-video',{openFrames:async source=>{opened++;assert.equal(source,'blob:the-video');return {width:180,height:320,duration:5,async at(time,width){frames++;assert.equal(time,0);assert.equal(width,180);return actualFrame;},dispose(){disposed++;}};},encodeFrame:async frame=>{assert.equal(frame,actualFrame);return cover;}});
  assert.equal(opened,1);assert.equal(frames,1);assert.equal(disposed,1);assert.equal(result.thumbnailBlob,cover);assert.equal(result.duration,5);
});
test('thumbnail encoding failure retains valid video metadata and always disposes the reader',async()=>{
  const [,{inspectVideoThumbnail}]=await modules;let disposed=0;const result=await inspectVideoThumbnail('blob:video',{openFrames:async()=>({width:640,height:480,duration:3,at:async()=>({}),dispose(){disposed++;}}),encodeFrame:async()=>{throw Error('canvas encoding unavailable');}});
  assert.equal(disposed,1);assert.equal(result.width,640);assert.equal(result.thumbnailError,'canvas encoding unavailable');assert.equal(result.thumbnailBlob,undefined);
});
async function archiver({inspect,posterFailure=false,thumbnailSaveFailure=false}={}){
  const [{createArchiver}]=await modules;const video=new Blob(['real video bytes'],{type:'video/mp4'}),cover=new Blob(['real decoded frame'],{type:'image/jpeg'}),reads=[],stored=[],created=[],revoked=[];let inspections=0,validations=0;
  const archive=createArchiver({assets:{url:async source=>source,put:async value=>{if(thumbnailSaveFailure&&value===cover)throw Error('thumbnail storage unavailable');stored.push(value);return 'asset:'+stored.length;}},fetch:async source=>{reads.push(source);return {ok:!(posterFailure&&source.includes('poster')),blob:async()=>source.includes('poster')?cover:video};},validate:async()=>{validations++;return {width:640,height:480,duration:5};},inspectVideo:async(source,options)=>{inspections++;return inspect?inspect(source,options):{width:640,height:480,duration:5,thumbnailBlob:cover};},createMediaUrl:value=>{created.push(value);return 'blob:preview-'+created.length;},revokeMediaUrl:url=>revoked.push(url)});
  return {archive,video,cover,reads,stored,created,revoked,inspections:()=>inspections,validations:()=>validations};
}
test('posterless archive reads video once and decodes once, stores actual video plus cover, releases temporary URL',async()=>{
  const f=await archiver(),row=await f.archive.archive({type:'video',url:'https://example.test/video.mp4'},{parameters:{}});
  assert.deepEqual(f.reads,['https://example.test/video.mp4']);assert.equal(f.inspections(),1);assert.equal(f.validations(),0);assert.deepEqual(f.stored,[f.video,f.cover]);assert.equal(row.mediaRef,'asset:1');assert.equal(row.thumbnailRef,'asset:2');assert.equal(row.thumbnailStatus,'ready');assert.deepEqual(f.revoked,['blob:preview-1']);
});
test('optional poster failure falls back to a real frame without fetching or decoding video again',async()=>{
  const f=await archiver({posterFailure:true}),row=await f.archive.archive({type:'video',url:'https://example.test/video.mp4',poster:'https://example.test/poster.jpg'},{parameters:{}});
  assert.equal(f.reads.filter(source=>source.endsWith('.mp4')).length,1);assert.equal(f.inspections(),1);assert.equal(row.thumbnailStatus,'ready');assert.equal(row.thumbnailError,null);assert.equal(row.mediaRef,'asset:1');
});
test('a valid supplied poster stays ready without a false cover error when first-frame reader falls back to video metadata',async()=>{
  const f=await archiver({inspect:()=>{throw Error('frame reader unavailable');}}),row=await f.archive.archive({type:'video',url:'https://example.test/video.mp4',poster:'https://example.test/poster.jpg'},{parameters:{}});
  assert.equal(row.thumbnailRef,'asset:1');assert.equal(row.mediaRef,'asset:2');assert.equal(row.thumbnailStatus,'ready');assert.equal(row.thumbnailError,null);assert.equal(row.width,640);assert.equal(f.inspections(),1);assert.equal(f.validations(),2);assert.deepEqual(f.stored,[f.cover,f.video]);
});
test('cover encoding/storage/read failure never changes a successfully archived video into failed media',async()=>{
  for(const options of [{inspect:()=>({width:640,height:480,duration:5,thumbnailError:'frame unavailable'})},{thumbnailSaveFailure:true},{inspect:()=>{throw Error('first-frame timeout');}}]){
    const f=await archiver(options),row=await f.archive.archive({type:'video',url:'https://example.test/video.mp4'},{parameters:{}});assert.ok(row.mediaRef.startsWith('asset:'));assert.equal(row.width,640);assert.equal(row.thumbnailStatus,'failed');assert.ok(row.thumbnailError);assert.equal(f.reads.length,1);assert.equal(f.inspections(),1);assert.equal(f.revoked.length,1);
  }
});
test('thumbnail leases share one read and URL, revoke only after final release and discard canceled late loads',async()=>{
  const [,,{createThumbnailResources}]=await modules;let reads=0,created=0,revoked=0;const pool=createThumbnailResources({load:async()=>{reads++;return {blob:new Blob(['real'])};},createUrl:()=> 'blob:owned-'+(++created),revokeUrl:()=>revoked++});
  const a=pool.acquire('same',{}),b=pool.acquire('same',{});assert.equal(await a.source,'blob:owned-1');assert.equal(await b.source,'blob:owned-1');assert.equal(reads,1);a.release();assert.equal(revoked,0);b.release();b.release();assert.equal(revoked,1);assert.equal(pool.size,0);
  let finish;const late=createThumbnailResources({load:()=>new Promise(resolve=>finish=resolve),createUrl:()=>{created++;return 'blob:late';},revokeUrl:()=>revoked++}),lease=late.acquire('late',{});await tick();lease.release();finish({blob:new Blob(['late'])});assert.equal(await lease.source,null);assert.equal(created,1);assert.equal(late.size,0);pool.dispose();late.dispose();
});
test('backfill queue bounds concurrent readers at two and never starts canceled waiting videos',async()=>{
  const [,,{createThumbnailQueue}]=await modules,queue=createThumbnailQueue();let active=0,peak=0,started=0;const releases=[];
  const execute=()=>queue.enqueue(async()=>{started++;active++;peak=Math.max(peak,active);await new Promise(resolve=>releases.push(resolve));active--;});
  const first=execute(),second=execute(),third=execute(),controller=new AbortController(),canceled=queue.enqueue(()=>{throw Error('canceled video must not decode');},{signal:controller.signal});canceled.catch(()=>{});controller.abort(new DOMException('closed','AbortError'));
  await tick();assert.equal(started,2);assert.equal(queue.active,2);releases.shift()();await first;await tick();assert.equal(started,3);while(releases.length)releases.shift()();await Promise.all([second,third]);await assert.rejects(canceled,{name:'AbortError'});assert.equal(peak,2);queue.dispose();
});
test('old ready posterless video backfills once from local Blob and persists its cover without provider calls',async()=>{
  const {install}=await import('../src/features/generation-history/entry.mjs');const row={id:'task:0',taskId:'task',outputIndex:0,type:'video',createdAt:'2026-10-02T08:00:00.000Z',archiveStatus:'ready',mediaRef:'asset:video',parameters:{},title:'real video'};let record={version:1,projectId:'p',rows:[row],receipts:[]},inspected=0;const reads=[],revoked=[];const video=new Blob(['actual video'],{type:'video/mp4'}),cover=new Blob(['first frame'],{type:'image/jpeg'});
  const history=await install({root:{addEventListener(){},removeEventListener(){}},project:{id:'p'},app:{notify(){}},generation:{subscribe:()=>()=>{}},store:{readRecord:async()=>structuredClone(record),writeRecord:async(_key,next)=>{record=structuredClone(next);}},assets:{url:async source=>source,put:async value=>{assert.equal(value,cover);return 'asset:cover';}},fetch:async source=>{reads.push(source);return {ok:true,blob:async()=>source==='asset:video'?video:cover};},inspectVideo:async()=>{inspected++;return {width:640,height:480,duration:5,thumbnailBlob:cover};},createThumbnailUrl:()=> 'blob:owned-cover',revokeThumbnailUrl:url=>revoked.push(url)});
  assert.equal(inspected,0);const a=history.acquireThumbnail(row),b=history.acquireThumbnail(row);assert.equal(await a.source,'blob:owned-cover');assert.equal(await b.source,'blob:owned-cover');assert.equal(inspected,1);assert.equal(reads.filter(source=>source==='asset:video').length,1);assert.equal(record.rows[0].thumbnailRef,'asset:cover');assert.equal(record.rows[0].archiveStatus,'ready');a.release();b.release();assert.deepEqual(revoked,['blob:owned-cover']);await history.thumbnail(history.get('task:0'));assert.equal(inspected,1);history.dispose();
});
