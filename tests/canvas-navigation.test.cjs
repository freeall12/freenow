const test=require('node:test'),assert=require('node:assert/strict'),N=require('../canvas-navigation.js');
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
test('fit uses absolute coordinates once and excludes hidden pile members',()=>{const nodes=[{id:'group',type:'group',x:228000,y:183000,width:1000,height:800},{id:'pile',type:'pile',parentId:'group',x:228100,y:183100,width:435,height:250,memberIds:['a','b']},{id:'a',type:'video',x:-100000,y:-100000,width:435,height:250},{id:'b',type:'video',x:1000000,y:1000000,width:435,height:250}];assert.deepEqual(N.bounds(N.visible(nodes)),{x:228000,y:183000,width:1000,height:800});assert.equal(N.latest(nodes).id,'pile');const v=N.fit(nodes,{width:1000,height:800});near(v.scale,.91);near(228500*v.scale+v.x,500);near(183400*v.scale+v.y,400);});
test('return targets final current node at max 20 percent, retaining subpixel source coordinates',()=>{const nodes=[{id:'old',x:0,y:0,width:100,height:100},{id:'new',x:53284.3,y:-2180.48,width:375,height:250}];const v=N.fit(nodes,{width:889,height:1011},'latest');assert.equal(v.scale,.2);near(v.x,-10249.86);near(v.y,916.596);});
test('empty and zero-size canvas do not produce invalid camera targets',()=>{assert.equal(N.fit([],{width:889,height:1011}),null);assert.equal(N.fit([{x:0,y:0,width:0,height:2}],{width:889,height:1011}),null);assert.equal(N.fit([{x:0,y:0,width:20,height:20}],{width:0,height:700}),null);});
test('viewport visibility includes touching edges and respects panel-reduced width',()=>{const n={x:711,y:200,width:435,height:250},v={x:0,y:0,scale:1};assert.equal(N.intersects(n,v,{width:711,height:720}),true);assert.equal(N.intersects(n,v,{width:710,height:720}),false);assert.equal(N.intersects(n,{...v,y:-450},{width:889,height:720}),true);});
test('smooth zoom uses analytic camera path, cubic time and exact endpoints',()=>{const start={x:0,y:0,scale:1},end={x:-500,y:-400,scale:2},v={width:1000,height:800},path=N.interpolate(start,end,v);assert.deepEqual(path(0),start);assert.deepEqual(path(1),end);near(path(.5).scale,Math.SQRT2);near((500-path(.5).x)/path(.5).scale,500);const far=N.interpolate(start,{x:-450000,y:-360000,scale:2},v);assert.ok(far(.5).scale<.02);assert.deepEqual(start,{x:0,y:0,scale:1});});
test('wheel matches source Mac pinch, native delta modes and 1.2 pan multiplier',()=>{const v={x:20,y:-10,scale:.5},p={x:300,y:200};assert.deepEqual(N.wheel(v,{deltaX:10,deltaY:20,deltaMode:0},p),{x:8,y:-34,scale:.5});assert.deepEqual(N.wheel(v,{deltaX:1,deltaY:2,deltaMode:1},p),{x:-4,y:-58,scale:.5});const zoom=N.wheel(v,{ctrlKey:true,deltaY:-10,deltaMode:0},p);near(zoom.scale,.5*2**.2);near((p.x-zoom.x)/zoom.scale,(p.x-v.x)/v.scale);assert.deepEqual(N.wheel(v,{shiftKey:true,deltaX:0,deltaY:10,deltaMode:0},p,false),{x:8,y:-10,scale:.5});});
test('saved viewport validates finite translation and supported scale',()=>{assert.deepEqual(N.parseView('{"x":-10249.86,"y":916.596,"scale":0.2}'),{x:-10249.86,y:916.596,scale:.2});for(const value of ['null','{}','bad','{"x":1,"y":2,"scale":0}','{"x":1,"y":2,"scale":3}'])assert.equal(N.parseView(value),null);});
test('gesture queue merges raw moves and keeps threshold crossings when the latest point returns',()=>{
 const queue=N.gestureQueue(),gesture={mode:'node',x:100,y:200},applied=[];
 for(let i=0;i<100;i++)queue.push(gesture,{clientX:100+i,clientY:200-i},{view:{x:0,y:0,scale:.4},snap:false});
 queue.push(gesture,{clientX:101.25,clientY:201.125},{view:{x:0,y:0,scale:.4},snap:false});
 assert.equal(gesture.thresholdCrossed,true);assert.equal(applied.length,0);assert.equal(queue.pending,true);
 assert.equal(queue.flush(gesture,point=>{applied.push(point);assert.equal(queue.pending,false);assert.equal(queue.flush(gesture,()=>assert.fail('reentrant apply')),null);}),false);
 assert.equal(applied.length,1);assert.equal(applied[0].clientX,101.25);assert.equal(applied[0].clientY,201.125);assert.equal(queue.flush(gesture,()=>assert.fail('duplicate apply')),null);
});
test('gesture final flush uses latest pointerup but cancellation retains last move and clears stale work',()=>{
 const queue=N.gestureQueue(),gesture={mode:'group-resize',x:0,y:0},points=[];
 queue.push(gesture,{clientX:20.25,clientY:30.5},{view:{scale:.25},snap:true});
 queue.push(gesture,{clientX:25.125,clientY:35.75},{view:{scale:.25},snap:true});
 queue.flush(gesture,p=>points.push([p.clientX,p.clientY,p.view.scale,p.snap]));assert.deepEqual(points,[[25.125,35.75,.25,true]]);
 queue.push(gesture,{clientX:40.25,clientY:42.75});queue.flush(gesture,p=>points.push([p.clientX,p.clientY]));queue.clear();assert.equal(queue.pending,false);assert.deepEqual(points.at(-1),[40.25,42.75]);
 queue.push(gesture,{clientX:99,clientY:99});assert.equal(queue.flush({mode:'node'},()=>assert.fail('old gesture leaked')),null);assert.equal(queue.pending,false);
 queue.push(gesture,{clientX:100,clientY:100});queue.clear();assert.equal(queue.flush(gesture,()=>assert.fail('cleared point leaked')),null);
});
test('gesture queue retains input-time scale and snap, uses absolute group snapshots, and distinguishes pan',()=>{
 const groups=require('../canvas-groups.js'),queue=N.gestureQueue(),nodes=[{id:'a',x:53284.3,y:-2180.48},{id:'b',x:53800.25,y:-1800.8}],gesture={mode:'node',x:100,y:200,positions:nodes.map(n=>({...n})),saved:false};let remembers=0;
 const apply=point=>{if(gesture.thresholdCrossed){if(!gesture.saved){remembers++;gesture.saved=true;}groups.translate(nodes,gesture.positions,(point.clientX-gesture.x)/point.view.scale,(point.clientY-gesture.y)/point.view.scale,point.snap);}};
 queue.push(gesture,{clientX:112.5,clientY:209.25},{view:{scale:.4},snap:false});queue.flush(gesture,apply);near(nodes[0].x,53315.55);near(nodes[0].y,-2157.355);
 queue.push(gesture,{clientX:140,clientY:220},{view:{scale:.5},snap:true});queue.flush(gesture,apply);assert.equal(nodes[0].x,53360);assert.equal(nodes[0].y,-2140);near(nodes[1].x-nodes[0].x,515.95);assert.equal(remembers,1);
 const pan={mode:'right-pan',x:0,y:0};queue.push(pan,{clientX:2,clientY:2});assert.equal(pan.thresholdCrossed,undefined);queue.push(pan,{clientX:4,clientY:0});queue.push(pan,{clientX:0,clientY:0});assert.equal(pan.thresholdCrossed,true);assert.equal(queue.flush(pan,()=>{}),true);
});
