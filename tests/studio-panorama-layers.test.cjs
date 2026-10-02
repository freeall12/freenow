const test=require('node:test'),assert=require('node:assert/strict');
const layers=import('../studio-panorama-layers.mjs');
test('malformed local masks cannot silently replace the entire panorama',async()=>{const {regionPlanes,maskPanoramaPixels}=await layers;assert.throws(()=>regionPlanes([[0,0,0],[1,0,0],[0,1,0]]),/无效/);assert.throws(()=>regionPlanes([[0,0,1],[0,0,1],[0,1,0]]),/退化/);assert.throws(()=>maskPanoramaPixels(new Uint8ClampedArray(8),new Uint8ClampedArray(8),2,1,[]),/缺少/);});
test('spherical layer mask changes only intended directions, including panorama seam',async()=>{
 const {regionPlanes,containsDirection,maskPanoramaPixels}=await layers;
 const front=[[-.3,.3,-1],[.3,.3,-1],[.3,-.3,-1],[-.3,-.3,-1]],planes=regionPlanes(front);assert.ok(containsDirection([0,0,-1],planes));assert.equal(containsDirection([0,0,1],planes),false);
 const width=100,height=50,base=new Uint8ClampedArray(width*height*4),overlay=base.map((_,i)=>i%4===0||i%4===3?255:0);const result=maskPanoramaPixels(base,overlay,width,height,[{directions:front}]);assert.equal(result[(25*100+50)*4],255);assert.equal(result[(25*100+10)*4],0);
 const back=front.map(([x,y,z])=>[x,y,-z]),seam=new Uint8ClampedArray(base.length);maskPanoramaPixels(seam,overlay,width,height,[{directions:back}]);assert.equal(seam[(25*100)*4],255);assert.equal(seam[(25*100+99)*4],255);assert.equal(seam[(25*100+50)*4],0);
});
test('multiple local layers stay independent when a previous layer is disabled',async()=>{
 const {maskPanoramaPixels}=await layers,w=64,h=32,size=w*h*4,front=[[-.3,.3,-1],[.3,.3,-1],[.3,-.3,-1],[-.3,-.3,-1]],back=front.map(([x,y,z])=>[x,y,-z]);
 const red=Uint8ClampedArray.from({length:size},(_,i)=>i%4===0||i%4===3?255:0),green=Uint8ClampedArray.from({length:size},(_,i)=>i%4===1||i%4===3?255:0);
 const both=new Uint8ClampedArray(size);maskPanoramaPixels(both,red,w,h,[{directions:front}]);maskPanoramaPixels(both,green,w,h,[{directions:back}]);assert.equal(both[(16*w+32)*4],255);assert.equal(both[(16*w)*4+1],255);
 const disabled=new Uint8ClampedArray(size);maskPanoramaPixels(disabled,green,w,h,[{directions:back}]);assert.equal(disabled[(16*w+32)*4],0);assert.equal(disabled[(16*w)*4+1],255);
});
test('anchor persistence clones records, isolates setups and excludes deleted histories',async()=>{
 const {visibleAnchors,saveAnchor}=await layers,data={},anchor={id:'a',setupId:'s',patches:[{id:'p'}]};saveAnchor(data,anchor);anchor.patches[0].deletedAt=1;assert.equal(visibleAnchors(data,'s').length,1);assert.equal(visibleAnchors(data,'other').length,0);saveAnchor(data,anchor);assert.equal(visibleAnchors(data,'s').length,0);assert.equal(data.panoramaSessions.length,1);
});
