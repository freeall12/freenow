const test=require('node:test');
const assert=require('node:assert/strict');

test('mask video poster uses the actual first frame once and releases its decoder',async()=>{
 const {captureMaskedVideoPoster}=await import('../src/features/video-mask/media.mjs');
 const output={type:'video',url:'/api/generation/media/fixture'},calls=[];
 const options={resolveSource:async source=>{calls.push(['resolve',source]);return 'blob:local-result';},openFrames:async source=>{calls.push(['open',source]);return {width:1280,at:async(time,width)=>{calls.push(['frame',time,width]);return {toDataURL:(type,quality)=>{calls.push(['encode',type,quality]);return 'data:image/jpeg;base64,fixture';}};},dispose:()=>calls.push(['dispose'])};}};
 await captureMaskedVideoPoster(output,options);await captureMaskedVideoPoster(output,options);
 assert.deepEqual(calls,[['resolve',output.url],['open','blob:local-result'],['frame',0,320],['encode','image/jpeg',.85],['dispose']]);
});

test('cancelled or failed frame capture never publishes a poster and always releases the decoder',async()=>{
 const {captureMaskedVideoPoster}=await import('../src/features/video-mask/media.mjs');
 for(const mode of ['cancel','decode']){
  const controller=new AbortController(),output={type:'video',url:'/api/generation/media/fixture'};let disposed=0,encoded=0;
  await assert.rejects(captureMaskedVideoPoster(output,{signal:controller.signal,resolveSource:async source=>source,openFrames:async()=>({width:240,at:async()=>{if(mode==='decode')throw Error('invalid frame');controller.abort();return {toDataURL:()=>{encoded++;return 'data:image/jpeg;base64,fixture';}};},dispose:()=>disposed++})}));
  assert.equal(disposed,1);assert.equal(encoded,0);assert.equal(output.poster,undefined);
 }
});
