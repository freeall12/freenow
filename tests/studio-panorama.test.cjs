const test=require('node:test'),assert=require('node:assert/strict');
const math=import('../studio-panorama-math.mjs'),three=import('three');
test('panorama rectangle round trips exact viewport offsets and arbitrary camera pose',async()=>{
 const {rectangleDirections,projectRegion}=await math,{PerspectiveCamera}=await three;
 for(const viewport of [{left:217,top:83,width:889,height:1011},{left:-36,top:52,width:390,height:600}]){
  const camera=new PerspectiveCamera(67,viewport.width/viewport.height,.03,1000);camera.position.set(23,-4,11);camera.rotation.set(.3,2.8,.07);camera.updateMatrixWorld(true);
  const a={x:viewport.left+45,y:viewport.top+88},b={x:viewport.left+180,y:viewport.top+251},directions=rectangleDirections(a,b,viewport,camera),points=projectRegion(directions,camera,viewport);
  const expected=[[a.x,a.y],[b.x,a.y],[b.x,b.y],[a.x,b.y]];points.forEach((p,i)=>{assert.ok(Math.abs(p.x-expected[i][0])<1e-8);assert.ok(Math.abs(p.y-expected[i][1])<1e-8);});
 }
});
test('panorama regions stay attached across yaw seam and clip behind-camera polygons',async()=>{
 const {rectangleDirections,projectRegion}=await math,{PerspectiveCamera}=await three,viewport={left:0,top:0,width:800,height:600};
 const camera=new PerspectiveCamera(60,4/3,.03,1000);camera.rotation.y=Math.PI-.05;
 const region=rectangleDirections({x:200,y:200},{x:500,y:400},viewport,camera);
 camera.rotation.y=-Math.PI+.05;const visible=projectRegion(region,camera,viewport);assert.ok(visible.length>=3);assert.ok(visible.every(p=>p.x>=0&&p.x<=800&&p.y>=0&&p.y<=600));
 camera.rotation.y=0;assert.deepEqual(projectRegion(region,camera,viewport),[]);
});
test('panorama undo invalidates pending jobs even when returning to identical region state',async()=>{
 const {PanoramaHistory,matchesPanoramaRequest}=await math,history=new PanoramaHistory();history.change({image:'base',regions:[{id:'a'}]});
 const request={nodeId:'a',setupId:'b',sessionId:'c',revision:history.revision};history.change({image:'base',regions:[]});assert.equal(history.undo(),true);assert.equal(history.state.regions.length,1);assert.equal(matchesPanoramaRequest(request,{...request,revision:history.revision}),false);assert.equal(matchesPanoramaRequest(request,{...request,sessionId:'new'}),false);assert.equal(matchesPanoramaRequest(request,request),true);history.undo(true);assert.equal(history.state.regions.length,0);
});
test('panorama requests snapshot world directions and require complete 2:1 image output',async()=>{
 const {makePanoramaRequest,PanoramaHistory,directionToUV}=await math,{PerspectiveCamera}=await three,history=new PanoramaHistory({regions:[{id:'a',directions:[[0,0,-1]]}],image:'base'}),camera=new PerspectiveCamera();
 const request=makePanoramaRequest({nodeId:'n',setupId:'s',sessionId:'e',history,camera,prompt:'修改树叶',image:'data:image/png;base64,test'});history.state.regions[0].directions[0][0]=1;
 assert.equal(request.parameters.regions[0].directions[0][0],0);assert.equal(request.parameters.output.composite,true);assert.equal(request.parameters.output.width/request.parameters.output.height,2);assert.deepEqual(directionToUV([0,0,-1]),{u:.5,v:.5});assert.equal(directionToUV([0,1,0]).v,1);
 assert.throws(()=>makePanoramaRequest({history:new PanoramaHistory(),prompt:''}),/描述/);
});
test('panorama capture restores helpers, render target, viewport and ratio after renderer failure',async()=>{
 const {capturePanorama}=await import('../studio-panorama.mjs'),T=await three;
 const helper={visible:true},path={visible:false},entity={visible:false},saved={target:{id:'old'},size:new T.Vector2(889,1011),ratio:1.25,viewport:new T.Vector4(4,5,889,1011),scissor:new T.Vector4(0,0,100,100),test:true};
 const renderer={coordinateSystem:T.WebGLCoordinateSystem,xr:{enabled:false},getSize:v=>v.copy(saved.size),getPixelRatio:()=>saved.ratio,getViewport:v=>v.copy(saved.viewport),getScissor:v=>v.copy(saved.scissor),getScissorTest:()=>saved.test,getRenderTarget:()=>saved.target,getActiveCubeFace:()=>0,getActiveMipmapLevel:()=>0,setRenderTarget:v=>saved.target=v,setPixelRatio:v=>saved.ratio=v,setSize:(x,y)=>saved.size.set(x,y),setViewport:v=>saved.viewport.copy(v),setScissor:v=>saved.scissor.copy(v),setScissorTest:v=>saved.test=v,render(){throw Error('fixture render failure');}};
 const studio={renderer,transform:{getHelper:()=>helper},motionPath:path,entities:new Map([['c',{root:entity}]]),object:()=>({kind:'camera'}),camera:new T.PerspectiveCamera(),scene:new T.Scene()};
 assert.throws(()=>capturePanorama(studio),/fixture render failure/);assert.equal(helper.visible,true);assert.equal(path.visible,false);assert.equal(entity.visible,false);assert.equal(saved.target.id,'old');assert.equal(saved.ratio,1.25);assert.equal(saved.test,true);assert.deepEqual(saved.viewport.toArray(),[4,5,889,1011]);
});
