const {test}=require('node:test');
const assert=require('node:assert/strict');
const moduleReady=import('../src/features/local-resource-migration/display-image.mjs');
const deferred=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve:value=>resolve(value)};};
test('persistent asset resolves to browser URL and ignores replaced node',async()=>{
 const {bindLocalImage}=await moduleReady,waiting=deferred(),image={},sources=[];let current=true;
 const binding=bindLocalImage(image,{source:'asset:original',isCurrent:()=>current,resolveAsset:ref=>(sources.push(ref),waiting.promise)});
 assert.equal(image.src,undefined);current=false;waiting.resolve('blob:http://localhost/old');await binding.ready;
 assert.equal(image.src,undefined);assert.deepEqual(sources,['asset:original']);
 const fresh={};await bindLocalImage(fresh,{source:'asset:new',isCurrent:()=>true,resolveAsset:async()=> 'blob:http://localhost/new'}).ready;
 assert.equal(fresh.src,'blob:http://localhost/new');
});
test('missing full image resolves local thumbnail once and never requests original service',async()=>{
 const {bindLocalImage}=await moduleReady,image={},reads=[];
 await bindLocalImage(image,{source:'asset:missing',fallback:'asset:thumbnail',isCurrent:()=>true,resolveAsset:async ref=>{reads.push(ref);if(ref==='asset:missing')throw Error('missing');return 'blob:http://localhost/thumbnail';}}).ready;
 assert.equal(image.src,'blob:http://localhost/thumbnail');assert.deepEqual(reads,['asset:missing','asset:thumbnail']);
 const blocked={};await bindLocalImage(blocked,{source:'https://files.tapnow.ai/old.png',isCurrent:()=>true,resolveAsset:()=>assert.fail('remote was resolved')}).ready;
 assert.equal(blocked.src,undefined);assert.match(blocked.title,/待导入/);
});
test('removed image cannot receive late source or fallback',async()=>{
 const {bindLocalImage}=await moduleReady,image={},waiting=deferred();
 const binding=bindLocalImage(image,{source:'asset:pending',fallback:'/assets/fallback.png',isCurrent:()=>true,resolveAsset:()=>waiting.promise});
 binding.dispose();waiting.resolve('blob:http://localhost/late');await binding.ready;assert.equal(image.src,undefined);assert.equal(image.onerror,null);
});
