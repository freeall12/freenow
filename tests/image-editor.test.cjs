const {test}=require('node:test');const assert=require('node:assert/strict');
const core=()=>import('../image-editor-core.mjs');
test('linked-image collage centers the short final row and retains independent aspect ratios',async()=>{
 const {layoutLinkedImages}=await import('../src/features/image-editor/linked-images.mjs');
 assert.deepEqual(layoutLinkedImages(Array.from({length:3},()=>({width:100,height:100})),{width:600,height:600}),[
  {left:0,top:0,scaleX:3,scaleY:3},{left:300,top:0,scaleX:3,scaleY:3},{left:150,top:300,scaleX:3,scaleY:3}
 ]);
 const images=[{width:1920,height:1080},{width:720,height:1280},{width:1000,height:1000},{width:1600,height:400}];
 const placements=layoutLinkedImages(images,{width:600,height:600});
 const boxes=placements.map((p,i)=>({x:p.left,y:p.top,w:images[i].width*p.scaleX,h:images[i].height*p.scaleY}));
 for(const [i,b] of boxes.entries()){
  assert.equal(placements[i].scaleX,placements[i].scaleY);assert.ok(b.x>=-1e-9&&b.y>=-1e-9&&b.x+b.w<=600+1e-9&&b.y+b.h<=600+1e-9);
  for(const c of boxes.slice(i+1))assert.ok(b.x+b.w<=c.x+1e-9||c.x+c.w<=b.x+1e-9||b.y+b.h<=c.y+1e-9||c.y+c.h<=b.y+1e-9);
 }
});
test('saved empty image documents do not resurrect linked pictures; unsaved inputs retain edge order',async()=>{
 const {needsLinkedImages,linkedImageInputs}=await import('../src/features/image-editor/linked-images.mjs');
 assert.equal(needsLinkedImages({editorDoc:{canvas:{objects:[]}}}),true);
 assert.equal(needsLinkedImages({editorDoc:{initialized:true,canvas:{objects:[]}}}),false);
 assert.equal(needsLinkedImages({image:'saved-cover.png',editorDoc:{canvas:{objects:[]}}}),false);
 assert.equal(needsLinkedImages({editorDoc:{canvas:{objects:[{type:'Rect'}]}}}),false);
 const nodes=[{id:'a',type:'image',image:'a.png'},{id:'b',type:'image',image:'b.png',fullImage:'full.png'},{id:'v',type:'video',image:'poster.png'}];
 assert.deepEqual(linkedImageInputs('e',{nodes,edges:['b','v','a','b','missing'].map(source=>({source,target:'e'}))}).map(n=>[n.id,n.src]),[['b','full.png'],['a','a.png']]);
});
test('linked images tolerate a failed source and dispose late loads after closing',async()=>{
 const {loadLinkedImages}=await import('../src/features/image-editor/linked-images.mjs'),controller=new AbortController();
 let disposed=0;const load=async(input)=>{if(input.id==='bad')throw Error('missing');return {dispose(){disposed++;}};};
 const result=await loadLinkedImages([{id:'first'},{id:'bad'},{id:'last'}],load,controller.signal);
 assert.deepEqual(result.loaded.map(n=>n.input.id),['first','last']);assert.deepEqual(result.failed,[{id:'bad'}]);
 controller.abort();const canceled=await loadLinkedImages([{id:'late'}],load,controller.signal);
 assert.deepEqual(canceled,{loaded:[],failed:[]});assert.equal(disposed,1);
});
test('editor history branches and preserves fractional object coordinates',async()=>{const {DocumentHistory}=await core(),h=new DocumentHistory(2);h.reset({x:100.125});h.push({x:101.375});h.push({x:102.75});assert.deepEqual(h.undo(),{x:101.375});assert.deepEqual(h.redo(),{x:102.75});h.undo();h.push({x:999.125});assert.equal(h.redo(),null);assert.equal(h.push({x:999.125}),false);assert.deepEqual(h.undo(),{x:101.375});});
test('dimensions reject invalid sizes and constrain raster allocations',async()=>{const {dimensions}=await core();assert.deepEqual(dimensions(600,4096),{width:600,height:4096});for(const v of [0,15,4097,NaN,Infinity,30.2])assert.throws(()=>dimensions(v,600));});
test('PSD writer emits real channel planes, unicode layer records and composite',async()=>{const {encodePSD}=await core();const p=new Uint8Array(16*16*4);for(let i=0;i<p.length;i+=4){p[i]=200;p[i+3]=255;}const bytes=encodePSD(16,16,[{name:'文字图层',pixels:p}],p),b=Buffer.from(bytes);assert.equal(b.toString('ascii',0,4),'8BPS');assert.equal(b.readUInt16BE(4),1);assert.equal(b.readUInt16BE(12),3);assert.equal(b.readUInt32BE(14),16);assert.equal(b.readUInt32BE(18),16);assert.equal(b.readUInt16BE(24),3);const maskLength=b.readUInt32BE(34);assert.equal(b.readUInt16BE(42),1);assert.ok(b.includes(Buffer.from('8BIMluni')));const composite=38+maskLength;assert.equal(b.readUInt16BE(composite),0);assert.equal(b[composite+2],200);assert.equal(b[composite+2+256],0);assert.equal(b.length,composite+2+768);assert.throws(()=>encodePSD(16,16,[{pixels:new Uint8Array(4)}],p));});
