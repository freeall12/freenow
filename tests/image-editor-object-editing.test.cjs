const {test}=require('node:test');const assert=require('node:assert/strict');
const modulePromise=import('../src/features/image-editor/object-editing.mjs');
const fakeBitmap=(width,height)=>({width,height,classList:{add(){},remove(){}}});
test('source-pixel crop and expansion preserve image content under rotated, flipped, skewed ActiveSelection transforms',async()=>{
 const {prepareSourceCrop,commitSourceCrop}=await modulePromise;const {FabricImage,Rect,ActiveSelection,Point}=await import('fabric');
 const image=new FabricImage(fakeBitmap(500,400),{left:12.25,top:30.75,width:200,height:180,cropX:60,cropY:40,scaleX:1.4,scaleY:.7,angle:20,skewX:12,flipX:true});
 const selection=new ActiveSelection([image,new Rect({left:450,top:300,width:30,height:30})]);selection.set({left:240.25,top:50.5,angle:35,scaleX:.8,scaleY:1.3});
 const position=(x,y)=>new Point(x-image.cropX-image.width/2,y-image.cropY-image.height/2).transform(image.calcTransformMatrix());
 const reference=position(100,100),plan=prepareSourceCrop(image,{x:80.5,y:60.25,width:110.75,height:100.5},{Point});
 selection.removeAll();commitSourceCrop(plan);assert.ok(position(100,100).distanceFrom(reference)<1e-9);assert.equal(image.cropX,80.5);
 commitSourceCrop(prepareSourceCrop(image,{x:0,y:0,width:500,height:400},{Point}));assert.ok(position(100,100).distanceFrom(reference)<1e-9);assert.equal(image.width,500);
 const before=image.toObject();assert.throws(()=>prepareSourceCrop(image,{x:-1,y:0,width:50,height:50},{Point}),{code:'invalid_crop'});assert.deepEqual(image.toObject(),before);
 image.clipPath=new Rect();assert.throws(()=>prepareSourceCrop(image,{x:0,y:0,width:50,height:50},{Point}),{code:'unsupported_clip'});
});
test('eraser rejects incompatible clip paths before raster work and commits no layers when later mask preparation fails',async()=>{
 const {prepareObjectErasure,commitObjectErasure}=await modulePromise;const {Rect,Path,FabricImage,util}=await import('fabric');
 const first=new Rect({left:0,top:0,width:100,height:100}),second=new Rect({left:20,top:20,width:100,height:100});
 const path=new Path('M 0 0 L 100 100',{stroke:'#000',strokeWidth:10,fill:null,globalCompositeOperation:'destination-out',objectCaching:false});
 let allocations=0;
 const createCanvas=()=>{allocations++;if(allocations===2)throw Error('raster allocation failed');const ctx=new Proxy({globalAlpha:1},{get(target,key){return key in target?target[key]:()=>{};},set(target,key,value){target[key]=value;return true;}});return {...fakeBitmap(1,1),getContext:()=>ctx,toDataURL:()=> 'data:image/png;base64,unit-test-mask'};};
 second.clipPath=new Rect({width:10,height:10});assert.throws(()=>prepareObjectErasure([first,second],path,{FabricImage,util,createCanvas}),{code:'unsupported_clip'});assert.equal(allocations,0);assert.equal(first.clipPath,undefined);
 second.clipPath=undefined;
 assert.throws(()=>prepareObjectErasure([first,second],path,{FabricImage,util,createCanvas}),/raster allocation failed/);assert.equal(first.clipPath,undefined);assert.equal(second.clipPath,undefined);
 allocations=2;const prepared=prepareObjectErasure([first,second],path,{FabricImage,util,createCanvas});assert.equal(prepared.length,2);assert.equal(first.clipPath,undefined);assert.equal(second.clipPath,undefined);commitObjectErasure(prepared);assert.equal(first.clipPath,prepared[0].clipPath);assert.equal(second.clipPath,prepared[1].clipPath);
});
