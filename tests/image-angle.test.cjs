const {test}=require('node:test'),assert=require('node:assert/strict'),api=import('../image-angle-core.mjs');
test('angle defaults and invalid values match source clamp rules',async()=>{const c=await api;assert.deepEqual(c.parameters(),c.defaults);assert.deepEqual(c.parameters({rotate_right_left:200,move_forward:-2,vertical_angle:NaN,wide_angle_lens:'yes'}),{rotate_right_left:90,move_forward:0,vertical_angle:.5,wide_angle_lens:false});});
test('cube drag follows raw client pixels and correct tilt direction',async()=>{const c=await api;assert.deepEqual(c.drag(c.defaults,20,10),{rotate_right_left:-40,move_forward:0,vertical_angle:.4,wide_angle_lens:false});assert.equal(c.drag(c.defaults,1000,1000).vertical_angle,-1);assert.equal(c.drag(c.defaults,-1000,-1000).rotate_right_left,90);assert.equal(c.drag(c.defaults,.01,.01).vertical_angle,.5);});
test('preview and API use opposite rotation; zoom reaches two times',async()=>{const c=await api,p=c.change(c.defaults,{move_forward:10});assert.equal(c.cubeTransform(p),'rotateX(22.5deg) rotateY(30deg) scale3d(2, 2, 2)');assert.equal(c.requestParameters(p).rotate_right_left,30);assert.equal(p.rotate_right_left,-30);});
test('panel follows fractional world coordinates and zoom without viewport clamp',async()=>{const {panelPosition}=await api,n={x:52000.25,y:-1800.5,width:446.125,height:250.75},view={scale:.574324,x:-29700.2,y:980.125},p=panelPosition(n,view);assert.equal(p.left,(n.x+n.width/2-300)*view.scale+view.x);assert.equal(p.top,(n.y+n.height+12)*view.scale+view.y);assert.equal(p.scale,view.scale);assert.equal(n.x,52000.25);});

test('explicit native alternative is disclosed and unsupported original controls fail without changing values',async()=>{
 const {multiAngleNativeProfile,multiAngleNativeError}=await import('../src/features/image-multi-angle/native-profile.mjs');
 const profile={semantics:'explicit-native-alternative',label:'Qwen 2511 Multiple Angles'},native={protocol:'fal-native',capabilities:{multiAngle:profile}};
 assert.equal(multiAngleNativeProfile(native),profile);
 assert.equal(multiAngleNativeProfile({protocol:'tasks-v1',capabilities:{multiAngle:profile}}),null);
 const routed={protocol:'routed',providers:{angle:native},routes:{'image.multiAngle':'angle'}};assert.equal(multiAngleNativeProfile(routed),profile);
 const values={vertical_angle:-1,wide_angle_lens:false,move_forward:10};assert.match(multiAngleNativeError(values,profile),/-30°/);assert.equal(values.vertical_angle,-1);
 assert.match(multiAngleNativeError({...values,vertical_angle:.5,wide_angle_lens:true},profile),/不支持广角/);
 assert.equal(multiAngleNativeError({...values,vertical_angle:-2/3},profile),null);
 assert.equal(multiAngleNativeError(values,null),null);
});
