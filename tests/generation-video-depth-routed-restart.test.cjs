'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {execFile}=require('node:child_process'),{promisify}=require('node:util');
const {createGenerationGateway}=require('../server/generation.cjs');
const {MODEL,ALIAS}=require('../server/generation-video-depth.cjs');
const sourcePath=path.join(__dirname,'../src/features/video-generation/qa/media/2.mp4'),depthPath=path.join(__dirname,'../src/features/video-depth/qa/media/depth-contract.mp4');

test('routed depth count2 resumes original parent and children after durable restart and archives both actual MP4s',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'freenow-depth-routed-restart-')),key='synthetic-depth-routed-restart-key';let gateway,server,complete=false;
 t.after(async()=>{if(server?.listening){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}await gateway?.close();await fs.rm(directory,{recursive:true,force:true});});
 const alternate=path.join(directory,'alternate.mp4');await promisify(execFile)('ffmpeg',['-hide_banner','-loglevel','error','-nostdin','-i',depthPath,'-an','-vf','negate','-c:v','libx264','-pix_fmt','yuv420p',alternate]);
 const source=await fs.readFile(sourcePath),results=[await fs.readFile(depthPath),await fs.readFile(alternate)],calls=[],downloads=[];
 assert.notDeepEqual(results[0],results[1]);
 const input={kind:'video.depth',nodeId:'empty-depth-target',prompt:'',inputs:[{id:'incoming-video-source',type:'video',url:'data:video/mp4;base64,'+source.toString('base64'),width:64,height:48,duration:2}],parameters:{workflow:'depth-video-studio',protocol:'local-depth-v1',model:ALIAS,resolution:'source',width:64,height:48,duration:2,preserveDuration:true,promptUsed:false,count:2,times:2,resultMode:'variants',batch_count:1}};
 const fetchImpl=async(url,options)=>{
  const target=new URL(url);assert.equal(target.origin,'https://queue.fal.run');assert.equal(options.redirect,'error');assert.equal(new Headers(options.headers).get('authorization'),'Key '+key);calls.push({url,method:options.method});
  if(options.method==='POST'){
   assert.equal(target.pathname,'/'+MODEL);const body=JSON.parse(options.body);assert.deepEqual(body,{video_url:input.inputs[0].url,model:'VDA-Large',colormap:'grayscale',resolution:'auto',max_frames:40,output_fps:null,side_by_side:false,include_raw_depths:false});
   const ordinal=calls.filter(call=>call.method==='POST').length;assert.ok(ordinal<=2,'restart may never enqueue a replacement');return Response.json({request_id:'native-child-'+ordinal,status:'IN_QUEUE'});
  }
  assert.equal(options.method,'GET');const match=new RegExp('^/'+MODEL+'/requests/(native-child-[12])(/status)?$').exec(target.pathname);assert.ok(match,'only original accepted child identities may be queried');const id=match[1];
  if(match[2]){assert.equal(target.search,'?logs=0');return Response.json({request_id:id,status:complete?'COMPLETED':'IN_PROGRESS'});}
  assert.equal(target.search,'');assert.equal(complete,true);const bytes=results[Number(id.at(-1))-1];return Response.json({request_id:id,video:{url:'https://depth-fixture.example.test/'+id+'.mp4',content_type:'video/mp4',file_size:bytes.length},raw_depths:null});
 };
 const videoDepthDownloadImpl=async(url,options)=>{
  const match=/^https:\/\/depth-fixture\.example\.test\/(native-child-[12])\.mp4$/.exec(url);assert.ok(match);assert.equal(options.kind,'video');assert.equal(options.headers,undefined);downloads.push(match[1]);const bytes=results[Number(match[1].at(-1))-1];return {mime:'video/mp4',expectedBytes:bytes.length,stream:(async function*(){yield bytes;})(),close(){}};
 };
 server=http.createServer((req,res)=>{void gateway.handle(req,res,new URL(req.url,'http://127.0.0.1').pathname,{
  json:(out,status,value)=>{out.writeHead(status,{'Content-Type':'application/json'});out.end(JSON.stringify(value));},
  body:async incoming=>{const chunks=[];for await(const chunk of incoming)chunks.push(chunk);return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');}
 }).catch(()=>{if(res.headersSent)res.destroy();else{res.writeHead(500);res.end('Isolated integration fixture failed');}});});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
 const open=async()=>{gateway=createGenerationGateway({directory:path.join(directory,'tasks'),localPort:server.address().port,providers:{depth:{protocol:'fal-video-depth-native',apiKey:key,modelMap:{[ALIAS]:{kind:'video.depth',model:MODEL}}}},routes:{'video.depth':{models:{[ALIAS]:'depth'}}},fetchImpl,videoDepthDownloadImpl});await gateway.ready;};
 const json=async route=>{const response=await fetch(origin+route);assert.equal(response.status,200);return response.json();};
 const submit=async()=>{const response=await fetch(origin+'/api/generation/tasks',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':'depth-routed-original-two-results'},body:JSON.stringify(input)});assert.equal(response.status,202);return response.json();};
 const record=id=>fs.readFile(path.join(directory,'tasks',id+'.json'),'utf8').then(JSON.parse);
 await open();const configuration=await json('/api/generation/config');assert.equal(configuration.providers.depth.capabilities.videoDepth[ALIAS].maxCount,2);assert.equal(JSON.stringify(configuration).includes(key),false);
 const created=await submit(),pending=await json('/api/generation/tasks/'+created.id),before=await record(created.id);assert.ok(['queued','running'].includes(pending.status));assert.equal(before.submissionState,'accepted');assert.equal(calls.filter(call=>call.method==='POST').length,2);
 assert.equal(before.request.nodeId,'empty-depth-target');assert.equal(before.request.inputs[0].id,'incoming-video-source');assert.notEqual(before.request.nodeId,before.request.inputs[0].id);assert.match(before.providerTaskId,/^rg1\./);
 const routeIdentity=JSON.parse(Buffer.from(before.providerTaskId.slice(4),'base64url').toString('utf8'));assert.equal(routeIdentity[0],'depth');const parentId=routeIdentity[2];assert.match(parentId,/^vd2\./);
 const manifestFile=path.join(directory,'tasks-video-depth','depth',parentId.slice(4)+'.json'),manifest=JSON.parse(await fs.readFile(manifestFile,'utf8'));assert.deepEqual(manifest.children.map(child=>child.phase),['accepted','accepted']);assert.deepEqual(manifest.children.map(child=>JSON.parse(Buffer.from(child.id.slice(4),'base64url').toString('utf8'))[2]),['native-child-1','native-child-2']);assert.equal(manifest.nodeId,input.nodeId);assert.equal(manifest.sourceNodeId,input.inputs[0].id);assert.equal(JSON.stringify(manifest).includes('data:'),false);
 await gateway.close();complete=true;await open();const recovered=await json('/api/generation/tasks/by-key/depth-routed-original-two-results');assert.equal(recovered.id,created.id);assert.equal(recovered.status,'succeeded');assert.equal(recovered.localization.state,'ready');assert.equal(recovered.outputs.length,2);assert.deepEqual(recovered.outputs.map(output=>output.sourceFileId),['native-child-1','native-child-2']);assert.deepEqual(downloads,['native-child-1','native-child-2']);assert.equal((await record(created.id)).providerTaskId,before.providerTaskId);
 assert.equal(calls.filter(call=>call.method==='POST').length,2);assert.equal(calls.filter(call=>call.method!=='GET'&&call.method!=='POST').length,0);assert.ok(calls.slice(2).every(call=>call.method==='GET'));assert.ok(calls.filter(call=>call.method==='GET').every(call=>/\/requests\/native-child-[12](?:\/status\?logs=0)?$/.test(call.url)));
 for(const [index,output]of recovered.outputs.entries()){
  assert.match(output.url,/^\/api\/generation\/media\/[a-f0-9-]{36}$/);assert.deepEqual([output.width,output.height,output.duration],[64,48,2]);const response=await fetch(origin+output.url);assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'video/mp4');assert.deepEqual(Buffer.from(await response.arrayBuffer()),results[index]);
  const resource=JSON.parse(await fs.readFile(path.join(directory,'tasks-media',output.url.split('/').at(-1)+'.json'),'utf8'));assert.equal(resource.taskId,created.id);assert.equal(resource.mime,'video/mp4');assert.equal(resource.bytes,results[index].length);
 }
 assert.equal((await submit()).id,created.id);assert.equal(calls.filter(call=>call.method==='POST').length,2);assert.equal((await record(created.id)).status,'succeeded');assert.equal(JSON.stringify(recovered).includes(key),false);
});
