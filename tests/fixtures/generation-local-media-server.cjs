'use strict';
const http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createGenerationGateway}=require('../../server/generation.cjs');
const {createGenerationMediaStore}=require('../../server/generation-media-store.cjs');
const {createGenerationMediaMaterializer}=require('../../server/generation-media-materializer.cjs');
const {deflateSync}=require('node:zlib');
const root=path.resolve(__dirname,'../..');
const staticFiles=new Map([
 ['/', ['qa/generation-local-media.html','text/html; charset=utf-8']],
 ['/qa/generation-local-media.html',['qa/generation-local-media.html','text/html; charset=utf-8']],
 ['/qa/generation-local-media.mjs',['qa/generation-local-media.mjs','text/javascript; charset=utf-8']],
 ['/generation-api.js',['generation-api.js','text/javascript; charset=utf-8']],
 ['/src/features/generation-results/validate-media.mjs',['src/features/generation-results/validate-media.mjs','text/javascript; charset=utf-8']],
 ['/src/features/generation-results/media-ref.mjs',['src/features/generation-results/media-ref.mjs','text/javascript; charset=utf-8']],
]);
function json(res,status,value){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));}
async function body(req){let bytes=0,text='';for await(const chunk of req){bytes+=chunk.length;if(bytes>65536)throw Object.assign(Error('Fixture request too large'),{status:413});text+=chunk;}try{return JSON.parse(text);}catch{throw Object.assign(Error('Fixture JSON invalid'),{status:400});}}
function builtinQAPng(){
 const width=96,height=64,rows=Buffer.alloc((width*4+1)*height);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const offset=y*(width*4+1)+1+x*4,color=(Math.floor(x/16)+Math.floor(y/16))%2?[214,91,44,255]:[36,119,112,255];
  for(let channel=0;channel<4;channel++)rows[offset+channel]=color[channel];
 }
 const chunk=(type,content)=>{const name=Buffer.from(type),value=Buffer.concat([name,content]);let crc=0xffffffff;
  for(const byte of value){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
  const result=Buffer.alloc(content.length+12);result.writeUInt32BE(content.length);name.copy(result,4);content.copy(result,8);result.writeUInt32BE((crc^0xffffffff)>>>0,result.length-4);return result;};
 const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);
}
async function readFixtureSource(sourcePath){
 if(sourcePath===undefined)return {bytes:builtinQAPng(),sourceKind:'内置 QA 合成 PNG（96 × 64 棋盘格，非模型结果）'};
 if(typeof sourcePath!=='string'||!sourcePath||sourcePath.startsWith('--'))throw Error('Invalid local PNG source');
 const filename=path.resolve(sourcePath),stat=await fs.stat(filename);
 if(!stat.isFile()||stat.size<24||stat.size>100*1024*1024)throw Error('Invalid local PNG source');
 const bytes=await fs.readFile(filename);
 if(!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw Error('Local source must be PNG');
 return {bytes,sourceKind:'操作员显式指定的本机 PNG（非模型结果）'};
}
async function createLocalMediaFixture({port=4174,failFirst=true,sourcePath}={}){
 if(!Number.isInteger(port)||port<0||port>65535)throw Error('Invalid fixture port');
 const {bytes,sourceKind}=await readFixtureSource(sourcePath);
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'generation-local-media-fixture-'));await fs.chmod(directory,0o700);
 const source='data:image/png;base64,'+bytes.toString('base64');
 const store=createGenerationMediaStore({directory:path.join(directory,'media'),maxBytes:100*1024*1024});await store.ready;
 const actual=createGenerationMediaMaterializer({store});let taskPosts=0,providerPosts=0,attempts=0,recoveryReleased=!failFirst;
 const materializer={verify:actual.verify,localize:async(outputs,options)=>{attempts++;if(!recoveryReleased)throw Object.assign(Error('Fixture save failure'),{code:'media_fixture_save_failed'});return actual.localize(outputs,options);}};
 // Sentinel only satisfies the existing tasks-v1 configured gate. No real Key
 // is read or needed, and this provider transport never invokes network fetch.
 const gateway=createGenerationGateway({directory:path.join(directory,'tasks'),mediaStore:store,mediaMaterializer:materializer,baseUrl:'https://fixture.invalid',apiKey:'fixture-no-secret',fetchImpl:async(url,options)=>{
  if(url!=='https://fixture.invalid/tasks'||options.method!=='POST')throw Error('Fixture provider forbids every other request');
  providerPosts++;return {ok:true,json:async()=>({status:'succeeded',outputs:[{type:'image',url:source,image:source,fullImage:source,poster:source,sourceUrl:source,mime:'image/png',title:'固定本地验收素材（非 AI 生成）'}]})};
 }});await gateway.ready;
 const server=http.createServer(async(req,res)=>{
  try{
   const address=server.address(),allowed=new Set(['127.0.0.1:'+address.port,'localhost:'+address.port]);
   if(!allowed.has(req.headers.host)||req.headers.origin&&!['http://127.0.0.1:'+address.port,'http://localhost:'+address.port].includes(req.headers.origin))return json(res,403,{error:'Fixture allows exact local host and origin only'});
   const url=new URL(req.url,'http://'+req.headers.host),pathname=url.pathname;
   if(url.search)return json(res,404,{error:'Fixture route not found'});
   if(pathname==='/api/fixture/state'&&req.method==='GET')return json(res,200,{fixture:true,source:'固定本地 PNG，非 AI 生成',sourceKind,taskPostCount:taskPosts,providerPostCount:providerPosts,localizationAttempts:attempts,failureMode:failFirst?'等待显式 GET 取回后解除保存故障':'直接本地保存'});
   if(pathname.startsWith('/api/generation/')){
    if(pathname==='/api/generation/tasks'&&req.method==='POST')taskPosts++;
    if(/^\/api\/generation\/tasks\/by-key\/[^/]+$/.test(pathname)&&req.method==='GET'&&req.headers['x-fixture-recover-original']==='1')recoveryReleased=true;
    return gateway.handle(req,res,pathname,{json,body:async request=>{const input=await body(request);if(input.kind!=='image.generate'||input.inputs?.length||input.prompt!=='固定本地 PNG，非 AI 生成')throw Object.assign(Error('Fixture accepts its fixed image request only'),{status:400});return input;}});
   }
   const file=staticFiles.get(pathname);if(!file||!['GET','HEAD'].includes(req.method))return json(res,404,{error:'Fixture route not found'});
   const content=await fs.readFile(path.join(root,file[0]));res.writeHead(200,{'Content-Type':file[1],'Content-Length':content.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(req.method==='HEAD'?undefined:content);
  }catch(error){if(!res.headersSent)json(res,error.status||500,{error:'Fixture operation failed'});else res.destroy();}
 });
 try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});}catch(error){await gateway.close();throw error;}
 let closing;const close=()=>closing||(closing=(async()=>{await new Promise(resolve=>server.close(resolve));await gateway.close();})());
 return {server,port:server.address().port,close};
}
if(require.main===module){
 const index=process.argv.indexOf('--port'),port=index>=0?Number(process.argv[index+1]):4174;
 const sourceIndex=process.argv.indexOf('--source'),sourcePath=sourceIndex>=0?process.argv[sourceIndex+1]:undefined;
 if(sourceIndex>=0&&!sourcePath){process.stderr.write('Fixture --source requires a local PNG path\n');process.exitCode=1;}else createLocalMediaFixture({port,failFirst:!process.argv.includes('--success'),sourcePath}).then(fixture=>{
  process.stdout.write('Local media QA fixture (fixed PNG, not AI): http://127.0.0.1:'+fixture.port+'/qa/generation-local-media.html\n');
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>fixture.close().then(()=>process.exit(0),()=>process.exit(1)));
 }).catch(error=>{process.stderr.write('Fixture startup failed: '+(error.code||'fixture_error')+'\n');process.exitCode=1;});
}
module.exports={createLocalMediaFixture,readFixtureSource};
