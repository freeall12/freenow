const test=require('node:test'),assert=require('node:assert/strict'),camera=require('../studio-camera.js');
test('original camera frame uses half viewport area and centered pixel geometry',()=>{
 assert.deepEqual(camera.frame(889,1011,1.5),{x:34,y:232,width:821,height:547});
 for(const [,aspect] of camera.ratios){const f=camera.frame(889,1011,aspect);assert.ok(f.width<=845&&f.height<=961);assert.ok(Math.abs(f.width/f.height-aspect)<.015);}
});
test('capture and expanded preview project scene points to the same frame pixels',()=>{
 for(const [,aspect] of camera.ratios){const f=camera.frame(889,1011,aspect),fov=camera.fov(35,aspect),preview=camera.expandedFov(fov,f.height/1011);const point=.2;const capturePixels=point/Math.tan(fov*Math.PI/360)*f.height/2;const previewPixels=point/Math.tan(preview*Math.PI/360)*1011/2;assert.ok(Math.abs(capturePixels-previewPixels)<1e-8);}
 assert.ok(Math.abs(camera.fov(35,1.5)-37.84928883210247)<1e-8);
});
