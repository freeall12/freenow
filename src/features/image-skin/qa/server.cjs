'use strict';
// Public synthetic pixels and API boundary fixtures only. Never loads production
// generation settings, environment credentials, user projects or asset stores.
const http=require('node:http'),fs=require('node:fs'),fsp=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'../../../..'),{encodeRGBA}=require(path.join(root,'server/generation-png-alpha.cjs')),{createSkinTasksProvider}=require(path.join(root,'server/generation-skin-tasks.cjs')),{createTasksProvider}=require(path.join(root,'server/generation-router.cjs'));
function publicImage(width,height){const rgba=Buffer.alloc(width*height*4);for(let y=0;y<height;y++)for(let x=0;x<width;x++){const vase=(x-width*.5)**2/(width*.18)**2+(y-height*.56)**2/(height*.35)**2<1;rgba.set(vase?[176,87,45,255]:y>height*.85?[59,72,60,255]:[219,213,192,255],(y*width+x)*4);}return encodeRGBA(width,height,rgba);}
async function startSkinFrontendQA({port=0,pipeline=false,agent=false}={}){
 if(!Number.isSafeInteger(port)||port<0||port>65535||port===4173)throw Error('Use an independent QA port.');
 const baseUrl='https://skin-qa.example.test',key='synthetic-skin-qa-only-key';
 const provider=createSkinTasksProvider({apiKey:key,transport:createTasksProvider({baseUrl,apiKey:key,fetchImpl:()=>{throw Error('Metadata does not submit');}})}),metadata=provider.metadata;
 const directory=await fsp.mkdtemp(path.join(os.tmpdir(),'freenow-skin-isolated-qa-')),audit={supplierPosts:0,supplierGets:0,sourceBytes:[],requests:[]},tasks=new Map(),heldUnknown=new Set();let armUnknown=false;
 const resultPng=publicImage(768,512);
 const fetchImpl=async(url,options)=>{
  const href=String(url),pathname=new URL(href).pathname;
  if(new URL(href).origin!==baseUrl||new Headers(options.headers).get('authorization')!=='Bearer '+key)throw Error('All traffic outside synthetic dedicated skin gateway is blocked.');
  if(pathname==='/tasks'&&options.method==='POST'){
   const request=JSON.parse(options.body),id='synthetic-skin-'+(++audit.supplierPosts);audit.sourceBytes.push(Buffer.from(request.inputs[0].url.split(',')[1],'base64').length);audit.requests.push({kind:request.kind,mode:request.parameters.mode,input:{role:request.inputs[0].role,width:request.inputs[0].width,height:request.inputs[0].height}});
   const succeeded={id,status:'succeeded',outputs:[{type:'image',url:'data:image/png;base64,'+resultPng.toString('base64'),width:768,height:512}]};tasks.set(id,succeeded);
   if(armUnknown){armUnknown=false;heldUnknown.add(id);return Response.json({id,status:'unknown'});}return Response.json(succeeded);
  }
  const id=decodeURIComponent(pathname.slice('/tasks/'.length));if(pathname.startsWith('/tasks/')&&tasks.has(id)){
   if(options.method==='GET'){audit.supplierGets++;return Response.json(heldUnknown.has(id)?{id,status:'unknown'}:tasks.get(id));}
   if(options.method==='DELETE')return Response.json({id,status:'cancelled'});
  }
  throw Error('Unknown synthetic task boundary');
 };
 const {createGenerationGateway}=require(path.join(root,'server/generation.cjs'));
 const gateway=createGenerationGateway({providers:{skin:{protocol:'skin-tasks-v1',baseUrl,apiKey:key}},routes:{'image.skin':'skin'},fetchImpl,directory:path.join(directory,'tasks')});await gateway.ready;
 const source=publicImage(512,320),result=resultPng,sourceDataUrl='data:image/png;base64,'+source.toString('base64');
 // The seed is captured in undo history when controls import it into LocalAssets.
 // Use durable pixels there too, rather than a dynamic fixture route.
 const seed=[{id:'skin-source',type:'image',title:'完整源图 · 公开合成陶瓶',image:sourceDataUrl,fullImage:sourceDataUrl,x:320.25,y:100.5,width:384,height:240}];
 const publicFiles=new Set(execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean));
 let html=fs.readFileSync(path.join(root,'index.html'),'utf8').replace('<head>','<head><base href="/"><script>window.SkinFixtureConfiguration='+JSON.stringify(metadata)+';</script><script src="src/features/image-skin/qa/fixture.js"></script>'+(agent?'<script src="src/features/agent-generation/qa/skin-agent-fixture.js"></script>':''));
 for(const name of ['canvas-data','editor-data','sidebar-data','versions-data'])html=html.replace(new RegExp('src="'+name+'\\.js[^\"]*"'),'src="defaults/'+name+'.js"');
 html=html.replace('<script src="defaults/canvas-data.js"></script>','<script src="defaults/canvas-data.js"></script><script>window.CANVAS_DATA.nodes='+JSON.stringify(seed)+';window.CANVAS_DATA.edges=[];</script>');
 html=html.replace('</body>','<script type="module" src="src/features/image-skin/qa/controls.mjs"></script></body>');
 const csp="default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; connect-src 'self' data: blob:; img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self' data:; worker-src 'self' blob:; frame-src 'self'; object-src 'none'; form-action 'none'; base-uri 'self'";
 const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.json':'application/json','.woff2':'font/woff2','.glb':'model/gltf-binary'};
 const send=(res,status,content,type)=>{res.writeHead(status,{'content-type':type,'cache-control':'no-store','content-security-policy':csp});res.end(content);};
 const json=(res,status,value)=>send(res,status,JSON.stringify(value),mime['.json']);
 const body=async req=>{let size=0;const parts=[];for await(const chunk of req){if((size+=chunk.length)>64*1024*1024)throw Error('QA request too large');parts.push(chunk);}return JSON.parse(Buffer.concat(parts));};
 const server=http.createServer((req,res)=>{void(async()=>{try{const pathname=new URL(req.url,'http://127.0.0.1').pathname;
  if(pathname==='/api/generation/fixture-audit')return json(res,200,{...audit,heldUnknown:heldUnknown.size,archiveEntries:(await fsp.readdir(path.join(directory,'tasks'))).length});
  if(pathname==='/api/generation/fixture-control'&&req.method==='POST'){const value=await body(req);if(value.unknown===true)armUnknown=true;if(value.releaseUnknown===true)heldUnknown.clear();return json(res,200,{armed:armUnknown,heldUnknown:heldUnknown.size});}
  if(pipeline&&pathname.startsWith('/api/generation/')){if(pathname==='/api/generation/config'&&req.method!=='GET')return json(res,403,{error:'QA configuration is immutable'});return gateway.handle(req,res,pathname,{json,body});}
  if(!['GET','HEAD'].includes(req.method))return send(res,403,'Boundary fixture only','text/plain');
  if(pathname==='/')return send(res,200,html,mime['.html']);
  if(pathname==='/src/features/image-skin/qa/source.png')return send(res,200,source,mime['.png']);
  if(pathname==='/api/generation/media/10050000-0000-4000-8000-000000000001')return send(res,200,result,mime['.png']);
  if(pathname==='/assets/local-resource-index.json')return send(res,200,JSON.stringify({version:1,algorithm:'sha256-exact-utf8',entries:{}}),mime['.json']);
  if(pathname.startsWith('/api/'))return send(res,403,'No production APIs','text/plain');
  const name=decodeURIComponent(pathname).replace(/^\//,''),filename=path.resolve(root,name),relative=path.relative(root,filename),three=relative.startsWith('node_modules/three/build/')||relative.startsWith('node_modules/three/examples/jsm/');
  if(relative.startsWith('..')||path.isAbsolute(relative)||!publicFiles.has(relative)&&!three||!mime[path.extname(relative)]||['canvas-data.js','editor-data.js','sidebar-data.js','versions-data.js'].includes(relative))return send(res,404,'Public source only','text/plain');
  return send(res,200,fs.readFileSync(filename),mime[path.extname(relative)]);
 }catch{return send(res,404,'Not served','text/plain');}})().catch(()=>{if(res.headersSent)res.destroy();else send(res,500,'Isolated fixture failed','text/plain');});});
 return new Promise(resolve=>server.listen(port,'127.0.0.1',()=>resolve({url:'http://127.0.0.1:'+server.address().port+'/'+(pipeline?'?mode=pipeline&session=skin-frontend-1005':'?session=skin-frontend-1005'),audit:()=>structuredClone(audit),close:async()=>{await new Promise(resolve=>server.close(resolve));await gateway.close();await fsp.rm(directory,{recursive:true,force:true});}})));
}
if(require.main===module)startSkinFrontendQA({port:Number(process.argv[2]??0),pipeline:process.argv.includes('pipeline'),agent:process.argv.includes('agent')}).then(host=>{console.log(host.url);for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>void host.close().then(()=>process.exit(0)));});
module.exports={startSkinFrontendQA};
