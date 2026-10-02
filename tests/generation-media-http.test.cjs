'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),http=require('node:http'),{randomUUID}=require('node:crypto'),{Readable}=require('node:stream');
const {createGenerationMediaStore}=require('../server/generation-media-store.cjs');
const {createGenerationMediaHttp}=require('../server/generation-media-http.cjs');
const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
test('media ID route verifies task membership, serves GET/HEAD and single ranges through read-only handles',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'generation-media-http-')),store=createGenerationMediaStore({directory});await store.ready;
 const taskId=randomUUID(),content=Buffer.from('0123456789'),record=await store.put({taskId,outputIndex:0,role:'main',mime:'video/mp4',format:'mp4'},Readable.from([content]));let allowed=true,closed=0;
 const original=store.open;store.open=async(...args)=>{const opened=await original(...args),close=opened.handle.close.bind(opened.handle);opened.handle.close=async()=>{closed++;return close();};return opened;};
 const route=createGenerationMediaHttp({store,ownsResource:async(task,id)=>allowed&&task===taskId&&id===record.resourceId});
 const server=http.createServer((req,res)=>{const id=req.url.match(/^\/api\/generation\/media\/([^/?]+)$/)?.[1];if(!id)return json(res,404,{error:'unknown'});route.handle(req,res,id,{json});});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const endpoint='http://127.0.0.1:'+server.address().port+'/api/generation/media/'+record.resourceId;
 t.after(async()=>{await new Promise(resolve=>server.close(resolve));await route.close();await store.close();await fs.rm(directory,{recursive:true,force:true});});
 let response=await fetch(endpoint);assert.equal(response.status,200);assert.equal(await response.text(),'0123456789');assert.equal(response.headers.get('Content-Type'),'video/mp4');assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');assert.equal(response.headers.get('Access-Control-Allow-Origin'),null);const etag=response.headers.get('ETag');
 response=await fetch(endpoint,{method:'HEAD'});assert.equal(response.status,200);assert.equal(response.headers.get('Content-Length'),'10');assert.equal(await response.text(),'');
 for(const [range,text,expected]of [['bytes=2-5','2345','bytes 2-5/10'],['bytes=-3','789','bytes 7-9/10'],['bytes=8-','89','bytes 8-9/10']]){response=await fetch(endpoint,{headers:{Range:range}});assert.equal(response.status,206);assert.equal(response.headers.get('Content-Range'),expected);assert.equal(await response.text(),text);}
 for(const range of ['bytes=50-','bytes=1-2,4-5','bytes=-0','bytes=5-4','items=0-1']){response=await fetch(endpoint,{headers:{Range:range}});assert.equal(response.status,416);assert.equal(response.headers.get('Content-Range'),'bytes */10');assert.equal(await response.text(),'');}
 response=await fetch(endpoint,{headers:{'If-None-Match':etag}});assert.equal(response.status,304);response=await fetch(endpoint,{headers:{Range:'bytes=2-3','If-Range':'"different"'}});assert.equal(response.status,200);assert.equal(await response.text(),'0123456789');
 allowed=false;response=await fetch(endpoint);assert.equal(response.status,404);assert.equal(await response.text(),JSON.stringify({code:'media_not_found',error:'本地媒体尚未发布或不属于已完成任务'}));
 allowed=true;response=await fetch(endpoint+'?url=https://secret.invalid');assert.equal(response.status,404);response=await fetch(endpoint.replace(record.resourceId,'not-an-id'));assert.equal(response.status,404);
 await fs.unlink(path.join(directory,record.resourceId+'.bin'));response=await fetch(endpoint);assert.equal(response.status,409);assert.equal((await response.json()).code,'media_integrity_error');assert.ok(closed>=13);
});
test('HTTP close aborts a stalled response pipeline and releases its read handle',async()=>{
 const {Writable}=require('node:stream');let released=0,entered;const started=new Promise(resolve=>entered=resolve),taskId=randomUUID(),id=randomUUID();
 const route=createGenerationMediaHttp({store:{open:async()=>({info:{taskId,resourceId:id,bytes:10,mime:'video/mp4',sha256:'a'.repeat(64)},handle:{createReadStream:()=>Readable.from([Buffer.from('0123456789')]),close:async()=>{released++;}}})},ownsResource:async()=>true});
 const response=new Writable({write(_chunk,_encoding,_callback){entered();}});response.headersSent=false;response.writeHead=()=>{response.headersSent=true;};const pending=route.handle({method:'GET',headers:{}},response,id,{json});await started;
 await Promise.race([route.close(),new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('HTTP close blocked on backpressure')),500);timer.unref();})]);await pending;assert.equal(response.destroyed,true);assert.equal(released,1);
});
