'use strict';
// This host loads only public synthetic pixels and production scripts. Its
// trusted HTTP/download hooks replace vendor boundaries, never PNG validation.
const http=require('node:http'),fs=require('node:fs'),fsp=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{randomUUID,createHash}=require('node:crypto'),{execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'../../../..'),{encodeRGBA,decodePNG}=require(path.join(root,'server/generation-png-alpha.cjs')),{createGenerationGateway}=require(path.join(root,'server/generation.cjs'));
const API_ORIGIN='https://api.magnific.com',TASK_PATH='/v1/ai/image-upscaler-precision-v2',CDN_ORIGIN='https://magnific-qa.example.test';
function publicImage(width,height){const rgba=Buffer.alloc(width*height*4);for(let y=0;y<height;y++)for(let x=0;x<width;x++){const vase=(x-width*.5)**2/(width*.18)**2+(y-height*.56)**2/(height*.35)**2<1;rgba.set(vase?[176,87,45,255]:y>height*.85?[59,72,60,255]:[219,213,192,255],(y*width+x)*4);}return encodeRGBA(width,height,rgba);}
async function startMagnificFrontendQA({port=0,agent=false}={}){
 if(!Number.isSafeInteger(port)||port<0||port>65535||port===4173)throw Error('Use an independent QA port.');
 const key='synthetic-magnific-qa-only-key',directory=await fsp.mkdtemp(path.join(os.tmpdir(),'freenow-magnific-isolated-qa-')),source=publicImage(512,320),result=publicImage(768,512);
 const audit={supplierPosts:0,supplierGets:0,resultDownloads:0,sourceBytes:[],requests:[],queriedIds:[],downloadedIds:[]},tasks=new Map(),heldUnknown=new Set();let armUnknown=false;
 const receipt=(id,status)=>Response.json({data:{task_id:id,status,generated:status==='COMPLETED'?[CDN_ORIGIN+'/result/'+id+'.png']:[]}});
 const fetchImpl=async(url,options={})=>{
  const parsed=new URL(String(url)),headers=new Headers(options.headers);
  if(parsed.origin!==API_ORIGIN||parsed.search||parsed.hash||headers.get('x-magnific-api-key')!==key||headers.has('authorization')||options.redirect!=='error')throw Error('Traffic outside exact synthetic Magnific API contract is blocked.');
  if(parsed.pathname===TASK_PATH&&options.method==='POST'){
   const body=JSON.parse(options.body);
   if(Object.keys(body).sort().join(',')!=='image,scale_factor,sharpen,smart_grain,ultra_detail'||typeof body.image!=='string'||body.image.startsWith('data:'))throw Error('Unexpected Magnific wire fields.');
   const bytes=Buffer.from(body.image,'base64'),actual=decodePNG(bytes),id=randomUUID();tasks.set(id,true);audit.supplierPosts++;audit.sourceBytes.push(bytes.length);audit.requests.push({id,parameters:{scaleFactor:body.scale_factor,sharpen:body.sharpen,smartGrain:body.smart_grain,ultraDetail:body.ultra_detail},input:{width:actual.width,height:actual.height,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}});
   if(armUnknown){armUnknown=false;heldUnknown.add(id);return receipt(id,'CREATED');}return receipt(id,'COMPLETED');
  }
  const prefix=TASK_PATH+'/';if(options.method==='GET'&&parsed.pathname.startsWith(prefix)){
   const id=parsed.pathname.slice(prefix.length);if(!tasks.has(id))throw Error('Unknown synthetic original task UUID');audit.supplierGets++;audit.queriedIds.push(id);
   if(heldUnknown.has(id))throw Error('Synthetic original task status is unavailable until explicitly released');return receipt(id,'COMPLETED');
  }
  throw Error('Undeclared synthetic Magnific API method or path');
 };
 const magnificDownloadImpl=async(url,{kind,signal}={})=>{
  const parsed=new URL(String(url)),id=parsed.pathname.slice('/result/'.length,-'.png'.length);
  if(parsed.origin!==CDN_ORIGIN||parsed.search||parsed.hash||parsed.pathname!=='/result/'+id+'.png'||!tasks.has(id)||kind!=='image'||signal?.aborted)throw Error('Undeclared synthetic result download');
  audit.resultDownloads++;audit.downloadedIds.push(id);return {mime:'image/png',expectedBytes:result.length,stream:(async function*(){yield result;})(),close(){}};
 };
 const gateway=createGenerationGateway({providers:{magnific:{protocol:'magnific-native',baseUrl:API_ORIGIN,apiKey:key,modelMap:{'image.upscale:magnific':{kind:'image.upscale',model:'magnific-v2'}}}},routes:{'image.upscale':{models:{'image.upscale:magnific':'magnific'}}},fetchImpl,magnificDownloadImpl,directory:path.join(directory,'tasks')});await gateway.ready;
 const seed=[{id:'magnific-source',type:'image',title:'完整源图 · 公开合成陶瓶',image:'data:image/png;base64,'+source.toString('base64'),fullImage:'data:image/png;base64,'+source.toString('base64'),x:320.25,y:100.5,width:384,height:240}];
 const publicFiles=new Set(execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean));
 let html=fs.readFileSync(path.join(root,'index.html'),'utf8').replace('<head>','<head><base href="/"><script src="src/features/image-upscale/qa/fixture.js"></script>'+(agent?'<script src="src/features/agent-generation/qa/magnific-agent-fixture.js"></script>':''));
 for(const name of ['canvas-data','editor-data','sidebar-data','versions-data'])html=html.replace(new RegExp('src="'+name+'\\.js[^\"]*"'),'src="defaults/'+name+'.js"');
 html=html.replace('<script src="defaults/canvas-data.js"></script>','<script src="defaults/canvas-data.js"></script><script>window.CANVAS_DATA.nodes='+JSON.stringify(seed)+';window.CANVAS_DATA.edges=[];</script>');
 html=html.replace('</body>','<script type="module" src="src/features/image-upscale/qa/controls.mjs"></script></body>');
 const csp="default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; connect-src 'self' data: blob:; img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self' data:; worker-src 'self' blob:; frame-src 'self'; object-src 'none'; form-action 'none'; base-uri 'self'";
 const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.json':'application/json','.woff2':'font/woff2','.glb':'model/gltf-binary'};
 const send=(res,status,content,type)=>{res.writeHead(status,{'content-type':type,'cache-control':'no-store','content-security-policy':csp});res.end(content);},json=(res,status,value)=>send(res,status,JSON.stringify(value),mime['.json']);
 const body=async req=>{let size=0;const parts=[];for await(const chunk of req){if((size+=chunk.length)>64*1024*1024)throw Error('QA request too large');parts.push(chunk);}return JSON.parse(Buffer.concat(parts));};
 const server=http.createServer((req,res)=>{void(async()=>{try{const pathname=new URL(req.url,'http://127.0.0.1').pathname;
  if(pathname==='/api/generation/fixture-audit')return json(res,200,{...audit,heldUnknown:heldUnknown.size,archiveEntries:(await fsp.readdir(path.join(directory,'tasks'))).length,syntheticOutput:{width:768,height:512,notVendorEffect:true}});
  if(pathname==='/api/generation/fixture-control'&&req.method==='POST'){const value=await body(req);if(value.unknown===true)armUnknown=true;if(value.releaseUnknown===true)heldUnknown.clear();return json(res,200,{armed:armUnknown,heldUnknown:heldUnknown.size});}
  if(pathname.startsWith('/api/generation/')){if(pathname==='/api/generation/config'&&req.method!=='GET')return json(res,403,{error:'QA configuration is immutable'});return gateway.handle(req,res,pathname,{json,body});}
  if(!['GET','HEAD'].includes(req.method))return send(res,403,'Boundary fixture only','text/plain');
  if(pathname==='/')return send(res,200,html,mime['.html']);
  if(pathname==='/src/features/image-upscale/qa/source.png')return send(res,200,source,mime['.png']);
  if(pathname==='/assets/local-resource-index.json')return json(res,200,{version:1,algorithm:'sha256-exact-utf8',entries:{}});
  if(pathname.startsWith('/api/'))return send(res,403,'No production APIs','text/plain');
  const name=decodeURIComponent(pathname).replace(/^\//,''),filename=path.resolve(root,name),relative=path.relative(root,filename),three=relative.startsWith('node_modules/three/build/')||relative.startsWith('node_modules/three/examples/jsm/');
  if(relative.startsWith('..')||path.isAbsolute(relative)||!publicFiles.has(relative)&&!three||!mime[path.extname(relative)]||['canvas-data.js','editor-data.js','sidebar-data.js','versions-data.js'].includes(relative))return send(res,404,'Public source only','text/plain');
  return send(res,200,fs.readFileSync(filename),mime[path.extname(relative)]);
 }catch{return send(res,404,'Not served','text/plain');}})().catch(()=>{if(res.headersSent)res.destroy();else send(res,500,'Isolated fixture failed','text/plain');});});
 return new Promise(resolve=>server.listen(port,'127.0.0.1',()=>resolve({url:'http://127.0.0.1:'+server.address().port+'/?mode=pipeline&session=magnific-frontend-1005',audit:()=>structuredClone(audit),close:async()=>{await new Promise(resolve=>server.close(resolve));await gateway.close();await fsp.rm(directory,{recursive:true,force:true});}})));
}
if(require.main===module)startMagnificFrontendQA({port:Number(process.argv[2]??0),agent:process.argv.includes('agent')}).then(host=>{console.log(host.url);console.log('PID '+process.pid);for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>void host.close().then(()=>process.exit(0)));});
module.exports={startMagnificFrontendQA};
