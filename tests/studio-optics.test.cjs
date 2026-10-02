const test=require('node:test'),assert=require('node:assert/strict');
const source=import('../studio-optics.mjs'),three=import('three'),timeline=import('../studio-timeline.mjs');
test('focus uses camera-axis depth and follows transformed object offsets',async()=>{
 const {resolveFocus,optics}=await source,{PerspectiveCamera,Group}=await three,camera=new PerspectiveCamera();camera.position.set(0,0,5);camera.lookAt(0,0,0);camera.updateMatrixWorld();
 assert.equal(resolveFocus(optics({focus:{mode:'point',target:[4,0,0]}}),camera),5);
 const root=new Group();root.position.set(0,0,1);root.scale.setScalar(2);const lens=optics({focus:{mode:'object',entityId:'subject',offset:[0,0,1]}});assert.equal(resolveFocus(lens,camera,new Map([['subject',{root}]])),2);root.position.z=2;assert.equal(resolveFocus(lens,camera,new Map([['subject',{root}]])),1);
});
test('optical blur follows aperture and focal length; default cameras stay deep-focus',async()=>{
 const {apertureCoefficient,optics,validateOpticsPatch}=await source;assert.equal(optics().depthOfFieldMode,'deepFocus');const base={focal:85,focusDistance:3};assert.ok(apertureCoefficient({...base,apertureFNumber:1.4})>apertureCoefficient({...base,apertureFNumber:22})*15);assert.ok(apertureCoefficient({...base,focal:135})>apertureCoefficient(base));assert.throws(()=>validateOpticsPatch({focus:{mode:'point'}}),/不完整/);assert.throws(()=>validateOpticsPatch({focus:{mode:'distance',distance:0}}),/不完整/);
});
test('camera keys interpolate aperture and focus distance independently of position',async()=>{
 const {sampleTrack}=await timeline,frames=[{id:'a',time:0,state:{position:[0,0,5],apertureFNumber:1.4,focusDistance:2,focus:{mode:'distance',distance:2},depthOfFieldMode:'aperture'}},{id:'b',time:4,state:{position:[0,0,5],apertureFNumber:5.6,focusDistance:8,focus:{mode:'distance',distance:8},depthOfFieldMode:'deepFocus'}}];const middle=sampleTrack(frames,2);assert.equal(middle.focus.distance,5);assert.equal(middle.focusDistance,5);assert.ok(Math.abs(middle.apertureFNumber-3.5)<1e-9);assert.equal(middle.depthOfFieldMode,'aperture');assert.equal(sampleTrack(frames,4).depthOfFieldMode,'deepFocus');
});
test('invalid optics cannot enter rendering through scene tools',async()=>{
 const {validateOpticsPatch}=await source;
 for(const patch of [{focus:null},{focus:{mode:'invalid'}},{focus:{mode:'point',target:[0,NaN,0]}},{focus:{mode:'object',entityId:'subject',offset:[0,1]}},{focusDistance:Infinity},{focusDistance:1001},{apertureFNumber:0},{depthOfFieldMode:'wrong'}])assert.throws(()=>validateOpticsPatch(patch));
});
test('viewer optics are undoable while camera edits remain a draft until completion',async()=>{
 const {installOptics,optics}=await source;class Studio{}installOptics(Studio,{});
 const studio=new Studio();Object.assign(studio,{lens:optics(),data:{viewer:{}},root:{querySelector:()=>null},remember(){this.previous=structuredClone(this.data);},persist(){this.saved=true;},refreshOptics(){}});
 studio.setOptics({focusDistance:3});assert.equal(studio.data.viewer.optics.focus.distance,3);assert.deepEqual(studio.previous,{viewer:{}});
 studio.cameraEdit={id:'camera'};studio.saved=false;studio.setOptics({focusDistance:7});assert.equal(studio.lens.focus.distance,7);assert.equal(studio.data.viewer.optics.focus.distance,3);assert.equal(studio.saved,false);
 studio.playing=true;assert.throws(()=>studio.setOptics({focusDistance:2}),/播放/);assert.equal(studio.lens.focus.distance,7);
});
