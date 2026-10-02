const test=require('node:test'),assert=require('node:assert/strict'),modulePromise=import('../media-preview-core.mjs');
test('media fit uses contain geometry without rounding source coordinates',async()=>{const c=await modulePromise,r=c.fit({left:10.25,top:20.375,width:500.125,height:400},{width:864,height:496});assert.equal(r.width,500.125);assert.equal(r.left,10.25);assert.equal(r.height,500.125*496/864);});
test('preview reserves source side panels and prompt remains 32px below media',async()=>{const c=await modulePromise,l=c.layout(889,1011,{width:864,height:496});assert.equal(l.box.width,425);assert.equal(l.frame.top,64+(771-l.frame.height)/2);assert.equal(l.promptTop,l.frame.top+l.frame.height+32);assert.equal(l.history,56);assert.equal(l.facts,176);});
test('history current resource is first and duplicate URLs collapse',async()=>{const c=await modulePromise,n={type:'video',video:'b',width:435,height:250,videoHistory:[{prompt:'A',parameters:{model:'one'},options:[{video:'a'}]},{prompt:'B',parameters:{model:'two'},options:[{video:'b'},{video:'a'}]}]},r=c.resources(n);assert.deepEqual(r.map(r=>r.src),['b','a']);assert.equal(r[0].prompt,'B');assert.equal(r[0].model,'two');});
test('image main patch keeps generation parameters and restores image dimensions',async()=>{const c=await modulePromise,p=c.mainPatch({type:'image',width:435},{src:'portrait',width:180,height:320,prompt:'new',generation:{model:'historical'}},{model:'current',count:4});assert.equal(p.image,'portrait');assert.equal(p.generation.model,'historical');assert.equal(p.generation.count,4);assert.equal(p.height,435*320/180);});
test('inspection maps preview into full contain region with zero drift',async()=>{const c=await modulePromise,l=c.layout(889,1011,{width:864,height:496}),bounds=c.constraints(l.frame,l.inspect),t=c.transform({zoom:1,panX:0,panY:0},bounds);assert.ok(Math.abs(t.scale-l.inspect.width/l.frame.width)<1e-12);assert.equal(l.frame.left+l.frame.width/2+t.x,l.inspect.left+l.inspect.width/2);});
test('zoom anchor stays at pointer except at pan limits and limits are bounded',async()=>{const c=await modulePromise,b={minZoom:.5,fitOffsetX:0,fitOffsetY:0,fitWidth:800,fitHeight:600},v=c.zoomAt({zoom:1,panX:0,panY:0},2,{x:100,y:50},b);assert.equal(v.panX,-100);assert.equal(v.panY,-50);const end=c.bound({zoom:99,panX:99999,panY:-99999},b);assert.deepEqual(end,{zoom:5,panX:1600,panY:-1200});});
test('zoom-out below contain removes panning and wheel matches source sensitivity',async()=>{const c=await modulePromise,b={minZoom:.4,fitWidth:800,fitHeight:600};assert.deepEqual(c.bound({zoom:.6,panX:100,panY:100},b),{zoom:.6,panX:0,panY:0});assert.equal(c.wheelZoom(1,-10000,false,.4),2**.12);assert.equal(c.wheelZoom(1,10000,true,.4),.4);});
test('time output supports empty, long videos and nonnegative clocks',async()=>{const c=await modulePromise;assert.equal(c.time(NaN),'00:00');assert.equal(c.time(125.8),'02:05');assert.equal(c.time(-1),'00:00');});

test('imported, analyzed and studio media never borrow the composer default model',async()=>{
 const c=await modulePromise;
 for(const type of ['image','video'])for(const metadata of [{},{sourceRange:{start:1,end:3}},{provenance:{kind:'studio-render',sceneId:'scene'}},{provenance:{kind:'video-analysis',mediaSource:'clip.mp4',model:null}}]){
  const node={type,...(type==='video'?{video:'clip.mp4'}:{image:'clip.png'}),generation:{model:'edited-next-model'},...metadata};
  assert.equal(c.resources(node,{model:'Seedance 2.0',prompt:'next request'})[0].model,null);
 }
});
test('actual generated media keeps submitted metadata after composer edits and storage reload',async()=>{
 const c=await modulePromise,{resultProvenance}=await import('../src/features/media-preview/provenance.mjs');
 for(const type of ['image','video']){
  const output={type,url:`result.${type==='video'?'mp4':'png'}`},job={id:'actual-job',request:{kind:`${type}.generate`,prompt:'submitted prompt',parameters:{model:'submitted-model'}}};
  const node=JSON.parse(JSON.stringify({type,[type]:output.url,...resultProvenance(job,output),generation:{model:'later choice',prompt:'later prompt'}}));
  const resource=c.resources(node,{model:'default-model',prompt:'draft prompt'})[0];assert.equal(resource.model,'submitted-model');assert.equal(resource.prompt,'submitted prompt');
  node[type]='replacement-file';assert.equal(c.resources(node,{model:'default-model'})[0].model,null);
 }
});
test('analysis outputs do not claim their visual description model generated physical clips',async()=>{
 const c=await modulePromise,{resultProvenance}=await import('../src/features/media-preview/provenance.mjs'),output={type:'video',url:'physical.mp4',sourceRange:{start:10,end:12}},job={id:'analysis-job',request:{kind:'video.analyze',parameters:{model:'visual-describer'}}};
 const node={type:'video',video:output.url,...resultProvenance(job,output)};assert.equal(node.provenance.kind,'video-analysis');assert.deepEqual(node.provenance.sourceRange,{start:10,end:12});assert.equal(c.resources(node,{model:'Seedance 2.0'})[0].model,null);
});
test('sourceRange and previous/imported history omit defaults while genuine batch model remains visible',async()=>{
 const c=await modulePromise,node={type:'video',video:'imported.mp4',videoHistory:[{id:'previous:v',parameters:{model:'Seedance 2.0'},options:[{video:'imported.mp4'}]},{id:'analysis-task',parameters:{model:'vision'},options:[{video:'analyzed.mp4',sourceRange:{start:0,end:2}}]},{id:'generation-task',parameters:{model:'historical-model'},options:[{video:'generated.mp4'}]}]};
 const resources=c.resources(node,{model:'next-model'});assert.deepEqual(resources.map(r=>r.model),[null,null,'historical-model']);
});
test('recorded variants preserve each origin and switching main survives reloading and subsequent edits',async()=>{
 const c=await modulePromise;
 for(const type of ['image','video']){
  const history=await import(type==='video'?'../video-history-core.mjs':'../image-history-core.mjs'),source={id:'source',type,width:250,height:200,[type]:'studio-file',provenance:{kind:'studio-render'},generation:{model:'default-model'}},job={id:'job',request:{kind:`${type}.generate`,prompt:'real prompt',parameters:{model:'actual-model'}},outputs:[{type,url:'generated-file',width:100,height:100}]};
  const generated={...source,...history.record(source,job)},resources=c.resources(generated,{model:'edited-model'});assert.equal(resources[0].model,'actual-model');assert.equal(resources[1].model,null);
  const restored=JSON.parse(JSON.stringify({...generated,...c.mainPatch(generated,resources[1],{model:'next-model'})}));assert.equal(restored.provenance.kind,'studio-render');assert.equal(c.resources(restored,{model:'changed-again'})[0].model,null);
  const back={...restored,...c.mainPatch(restored,c.resources(restored).find(r=>r.src==='generated-file'),{model:'next-model'})};assert.equal(c.resources(back,{model:'next-model'})[0].model,'actual-model');
 }
});
test('legacy versions show only their own saved model and cannot inherit mutable current config',async()=>{
 const c=await modulePromise,node={type:'image',image:'current',versions:[{image:'current'},{image:'old',generation:{model:'recorded-model'}},{image:'older',model:'older-model'}]};assert.deepEqual(c.resources(node,{model:'default-model'}).map(r=>r.model),[null,'recorded-model','older-model']);
});
test('missing dispatched model remains absent rather than defaulting after generation',async()=>{
 const c=await modulePromise,{resultProvenance}=await import('../src/features/media-preview/provenance.mjs'),output={type:'video',url:'result.mp4'},node={type:'video',video:output.url,...resultProvenance({id:'job',request:{kind:'video.generate'}},output)};assert.equal(c.resources(node,{model:'Seedance 2.0'})[0].model,null);
});
test('materialized asset URLs bind metadata to the stored file instead of the original remote URL',async()=>{
 const c=await modulePromise,{resultProvenance}=await import('../src/features/media-preview/provenance.mjs');
 for(const type of ['image','video']){
  const output={type,url:'https://provider.test/original',[type]:'asset:stored-output'},job={id:'job',request:{kind:`${type}.generate`,parameters:{model:'requested-display-model',modelId:'canonical-wire-model'}}};
  const node=JSON.parse(JSON.stringify({type,[type]:output[type],...resultProvenance(job,output)}));assert.equal(node.provenance.mediaSource,'asset:stored-output');assert.equal(c.resources(node,{model:'default'})[0].model,'requested-display-model');
  node[type]='asset:replaced-output';assert.equal(c.resources(node,{model:'default'})[0].model,null);
 }
});
