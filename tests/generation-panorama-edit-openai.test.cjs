'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {Vector3,Quaternion,PerspectiveCamera}=require('three');
const {createOpenAIPanoramaEditProvider,parsePanoramaEditModelMap}=require('../server/generation-panorama-edit-openai.cjs');
const {COORDINATES,preparePerspectiveEdit,reprojectPerspectiveEdit,directionAt,selected}=require('../server/generation-panorama-edit-geometry.cjs');
const {encodeRGBA,decodePNG,crc32}=require('../server/generation-png-alpha.cjs');
const key='synthetic-panorama-edit-contract-secret',pixels=Buffer.alloc(2048*1024*4);for(let i=0;i<pixels.length;i+=4){pixels[i]=(i/4)%251;pixels[i+1]=35;pixels[i+2]=80;pixels[i+3]=255;}
const source=encodeRGBA(2048,1024,pixels),url='data:image/png;base64,'+source.toString('base64'),red=Buffer.alloc(1024*1024*4);for(let i=0;i<red.length;i+=4){red[i]=255;red[i+3]=255;}
const result=encodeRGBA(1024,1024,red),b64=result.toString('base64');
const entry={kind:'panorama.edit',model:'gpt-image-2',semantics:'perspective-mask-reproject',quality:'high',cropSize:'1024x1024'};
const region=q=>({id:'region',color:'#75e845',directions:[[-.2,.2,-1],[.2,.2,-1],[.2,-.2,-1],[-.2,-.2,-1]].map(d=>new Vector3(...d).normalize().applyQuaternion(q).toArray())});
function request(q=new Quaternion()) {return {kind:'panorama.edit',label:'全景图编辑',nodeId:'node',prompt:'区域替换为花园',inputs:[{type:'image',image:url,projection:'equirectangular'}],parameters:{binding:{nodeId:'node',setupId:'setup',sessionId:'session',revision:0},camera:{position:[0,1,0],quaternion:q.toArray(),fov:60,aspect:1.5},regions:[region(q)],output:{projection:'equirectangular',width:2048,height:1024,composite:true},coordinates:{...COORDINATES}}};}
const provider=options=>createOpenAIPanoramaEditProvider({apiKey:key,modelMap:{'panorama.edit':entry},client:{images:{edit:async()=>({data:[{b64_json:b64}]})}},...options});
const response=(status=200,body={data:[{b64_json:b64}]},headers={})=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json',...headers}});
function chunk(type,data){const b=Buffer.alloc(data.length+12);b.writeUInt32BE(data.length);b.write(type,4);data.copy(b,8);b.writeUInt32BE(crc32(b.subarray(4,-4)),b.length-4);return b;}
function inserted(bytes,type,data){return Buffer.concat([bytes.subarray(0,33),chunk(type,data),bytes.subarray(33)]);}

test('matches actual studio makePanoramaRequest fields and rejects unmapped semantics',async()=>{
 const {makePanoramaRequest,PanoramaHistory}=await import('../studio-panorama-math.mjs'),camera=new PerspectiveCamera(60,1.5);camera.position.set(0,1,0);const history=new PanoramaHistory({regions:[region(new Quaternion())],image:url});
 const actual=makePanoramaRequest({nodeId:'node',setupId:'setup',sessionId:'session',history,camera,prompt:'区域替换为花园',image:url});assert.deepEqual(actual,request());
 assert.equal(provider().prepare(actual),actual);
 for(const map of [{alias:entry},{'panorama.edit':{...entry,semantics:'global-panorama'}},{'panorama.edit':{...entry,cropSize:'auto'}},{'panorama.edit':{...entry,model:'nano-banana'}},{'panorama.edit':{...entry,extra:true}}])assert.throws(()=>parsePanoramaEditModelMap(map));
 assert.equal(provider({apiKey:'rotated'}).fingerprint,provider().fingerprint);assert.equal(JSON.stringify(provider().metadata).includes(key),false);assert.equal(provider().poll,undefined);assert.equal(provider().metadata.capabilities.remoteRecovery,false);
});

test('ordinary and seam-crossing camera crop/mask and reproject preserve all outside pixels exactly',()=>{
 for(const q of [new Quaternion(),new Quaternion().setFromAxisAngle(new Vector3(0,1,0),Math.PI)]){
  const p=preparePerspectiveEdit(decodePNG(source),request(q).parameters),mask=decodePNG(p.mask),composite=reprojectPerspectiveEdit(p,decodePNG(result));
  assert.equal(mask.width,1024);let transparent=0,opaque=0;for(let i=3;i<mask.pixels.length;i+=4){assert.ok([0,255].includes(mask.pixels[i]));mask.pixels[i]===0?transparent++:opaque++;}assert.equal(transparent,p.editablePixels);assert.ok(opaque>0);
  let inside=0,left=0,right=0;for(let y=0;y<1024;y++)for(let x=0;x<2048;x++){const i=(y*2048+x)*4;if(selected(directionAt(x,y,2048,1024),p.frame)){assert.deepEqual([...composite.pixels.subarray(i,i+4)],[255,0,0,255]);inside++;if(x<50)left++;if(x>1998)right++;}else for(let c=0;c<4;c++)assert.equal(composite.pixels[i+c],pixels[i+c]);}
  assert.equal(inside,composite.selectedPixels);assert.ok(inside>0);if(q.y)assert.ok(left>0&&right>0);
  const transparentResult=decodePNG(encodeRGBA(1024,1024,Buffer.alloc(red.length)));assert.throws(()=>reprojectPerspectiveEdit(p,transparentResult),/透明/);
 }
});

test('real SDK sends one native image-edit POST with exact crop and alpha-zero mask, returns complete 2:1',async()=>{
 let calls=0;const p=provider({client:undefined,fetchImpl:async(endpoint,options)=>{calls++;assert.equal(endpoint,'https://api.openai.com/v1/images/edits');assert.equal(options.method,'POST');const form=await new Request(endpoint,{...options,duplex:'half'}).formData(),image=form.getAll('image[]');assert.equal(image.length,1);const crop=decodePNG(Buffer.from(await image[0].arrayBuffer())),mask=decodePNG(Buffer.from(await form.get('mask').arrayBuffer()));assert.equal(crop.width,1024);assert.equal(crop.height,1024);assert.equal(mask.width,crop.width);assert.equal(form.get('model'),'gpt-image-2');assert.equal(form.get('size'),'1024x1024');assert.equal(form.get('background'),'opaque');assert.equal(form.get('n'),'1');assert.equal(form.get('quality'),'high');assert.ok(form.get('prompt').includes('区域替换为花园'));return response();}});
 const before=request(),copy=structuredClone(before),receipt=await p.submit(before);assert.deepEqual(before,copy);assert.equal(calls,1);assert.equal(receipt.status,'succeeded');assert.equal(receipt.outputs[0].width,2048);assert.equal(receipt.outputs[0].height,1024);assert.equal(decodePNG(Buffer.from(receipt.outputs[0].url.split(',')[1],'base64')).width,2048);
});

test('global, invisible, nonconvex, malformed source and contradictory binding fail before dispatch',async()=>{
 let calls=0;const p=provider({client:{images:{edit:()=>{calls++;assert.fail();}}}});
 const changes=[r=>r.parameters.regions=[],r=>r.parameters.regions[0].directions[0]=[0,0,1],r=>r.parameters.regions[0].directions.reverse(),r=>r.parameters.camera.quaternion=[0,0,0,2],r=>r.parameters.output.width=4096,r=>r.parameters.binding.nodeId='other',r=>r.parameters.model='gpt-image-2',r=>r.inputs[0].image='https://example.test/panorama.png',r=>r.inputs[0].url=url];
 // Clockwise and counterclockwise are both valid; self-crossing corner order is not.
 changes[2]=r=>{const d=r.parameters.regions[0].directions;[d[1],d[2]]=[d[2],d[1]];};
 for(const change of changes){const r=request();change(r);await assert.rejects(p.submit(r),{code:'unsupported_generation'});}
 const r=request();r.parameters.regions[0].directions=[[-2,.2,-1],[2,.2,-1],[2,-.2,-1],[-2,-.2,-1]].map(d=>new Vector3(...d).normalize().toArray());await assert.rejects(p.submit(r),/视口/);assert.equal(calls,0);
});

test('credential echoes in decoded source/output pixels and independently compressed metadata never publish',async()=>{
 let calls=0;const p=provider({client:{images:{edit:()=>{calls++;assert.fail();}}}}),leak=Buffer.from(pixels);Buffer.from(key).copy(leak,0);
 for(const bytes of [encodeRGBA(2048,1024,leak),inserted(source,'zTXt',Buffer.from(key)),inserted(source,'iTXt',Buffer.from('safe metadata')),inserted(source,'iCCP',Buffer.from('safe metadata'))]){const r=request();r.inputs[0].image='data:image/png;base64,'+bytes.toString('base64');await assert.rejects(p.submit(r),e=>e.code==='unsupported_generation'&&!e.message.includes(key));}assert.equal(calls,0);
 const leaked=Buffer.from(red);Buffer.from(key,'utf16le').copy(leaked,1);
 for(const bytes of [encodeRGBA(1024,1024,leaked),inserted(result,'zTXt',Buffer.from(key))]){let submitted=0;await assert.rejects(provider({client:{images:{edit:async()=>{submitted++;return {data:[{b64_json:bytes.toString('base64')}]};}}}}).submit(request()),{code:'unknown'});assert.equal(submitted,1);}
});

test('unknown response and timeout do not retry; explicit SDK rejection is terminal',async()=>{
 for(const [status,body] of [[500,{error:{message:'uncertain'}}],[200,{data:[{url:'https://example.test/image.png'}]}],[200,{data:[{b64_json:source.toString('base64')}]}],[200,{data:[{b64_json:b64}],echo:key}]]){let calls=0;await assert.rejects(provider({client:undefined,fetchImpl:async()=>{calls++;return response(status,body);}}).submit(request()),{code:'unknown'});assert.equal(calls,1);}
 let calls=0;const rejected=await provider({client:undefined,fetchImpl:async()=>{calls++;return response(400,{error:{message:'private message',type:'invalid_request_error'}});}}).submit(request());assert.equal(rejected.status,'failed');assert.equal(rejected.code,'provider_rejected');assert.equal(calls,1);
 let release,posts=0;await assert.rejects(provider({timeoutMs:10,client:{images:{edit:()=>{posts++;return new Promise(resolve=>{release=resolve;});}}}}).submit(request()),{code:'unknown'});release({data:[{b64_json:b64}]});await new Promise(resolve=>setImmediate(resolve));assert.equal(posts,1);
});

test('browser materialization keeps image/projection contract and rejects original-site or wrong actual dimensions',async()=>{
 const {preparePanoramaEditMedia}=await import('../src/features/panorama-edit/media.mjs'),{panoramaEditRequestState}=await import('../src/features/panorama-edit/native-profile.mjs');const metadata=provider().metadata,r=request();r.inputs[0].image='asset:pano';let guards=0;
 const options={nativeConfiguration:metadata,baseUrl:'http://localhost:4173/',validateSources:()=>{guards++;},resolveMedia:async()=>({url}),transport:async value=>value,normalizePng:async input=>({...input,width:2048,height:1024})};
 const ready=await preparePanoramaEditMedia(r,options);assert.deepEqual(ready.inputs,[{type:'image',image:url,projection:'equirectangular'}]);assert.equal(r.inputs[0].image,'asset:pano');assert.ok(guards>=4);assert.equal(panoramaEditRequestState(metadata,request()).ready,true);
 await assert.rejects(preparePanoramaEditMedia(r,{...options,normalizePng:async input=>({...input,width:1024,height:512})}),/2048/);
 const remote=request();remote.inputs[0].image='https://tapnow.media/pano.png';await assert.rejects(preparePanoramaEditMedia(remote,{...options,resolveMedia:()=>assert.fail()}),/本机/);
 const global=request();global.parameters.regions=[];assert.equal(panoramaEditRequestState(metadata,global).ready,false);
 const malformed=structuredClone(metadata);malformed.capabilities.panoramaEdit.outsideRegionPixels='best-effort';assert.equal(panoramaEditRequestState(malformed,request()).ready,false);
 assert.equal(await preparePanoramaEditMedia(r,{nativeConfiguration:{protocol:'tasks-v1'}}),r);
});
