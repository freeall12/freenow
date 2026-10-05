'use strict';
// Public synthetic pixels and API boundary fixtures only. Never loads production
// generation settings, environment credentials, user projects or asset stores.
const http=require('node:http'),fs=require('node:fs'),fsp=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'../../../..'),{encodeRGBA}=require(path.join(root,'server/generation-png-alpha.cjs')),{createOpenAIPanoramaEditProvider}=require(path.join(root,'server/generation-panorama-edit-openai.cjs'));
function publicImage(width,height){const rgba=Buffer.alloc(width*height*4);for(let y=0;y<height;y++)for(let x=0;x<width;x++){const vase=(x-width*.5)**2/(width*.18)**2+(y-height*.56)**2/(height*.35)**2<1;rgba.set(vase?[176,87,45,255]:y>height*.85?[59,72,60,255]:[219,213,192,255],(y*width+x)*4);}return encodeRGBA(width,height,rgba);}
async function startPanoramaEditFrontendQA({port=0}={}){
 if(!Number.isSafeInteger(port)||port<0||port>65535||port===4173)throw Error('Use an independent QA port.');
 const metadata=createOpenAIPanoramaEditProvider({apiKey:'synthetic-panorama-edit-qa-metadata-only',modelMap:{'panorama.edit':{kind:'panorama.edit',model:'gpt-image-2',semantics:'perspective-mask-reproject',quality:'high',cropSize:'1024x1024'}},fetchImpl:()=>{throw Error('No external network');}}).metadata;
 const directory=await fsp.mkdtemp(path.join(os.tmpdir(),'freenow-panorama-edit-isolated-qa-')),audit={sdkPosts:0,sourceBytes:[],requests:[]},key='synthetic-panorama-edit-qa-only-key';
 const resultPng=publicImage(1024,1024);
 const fetchImpl=async(url,options)=>{
  if(String(url)!=='https://api.openai.com/v1/images/edits'||options.method!=='POST'||new Headers(options.headers).get('authorization')!=='Bearer '+key)throw Error('All supplier traffic is blocked outside the exact synthetic image-edit boundary.');
  const form=await new Request(url,{...options,duplex:'half'}).formData(),images=form.getAll('image[]');if(images.length!==1||images[0].type!=='image/png'||!form.has('mask'))throw Error('Incorrect actual SDK multipart contract');
  const bytes=Buffer.from(await images[0].arrayBuffer()),mask=form.get('mask');audit.sdkPosts++;audit.sourceBytes.push(bytes.length);audit.requests.push({model:form.get('model'),size:form.get('size'),n:form.get('n'),imageMime:images[0].type,maskMime:mask.type,maskBytes:mask.size});
  return Response.json({data:[{b64_json:resultPng.toString('base64')} ]});
 };
 const {createGenerationGateway}=require(path.join(root,'server/generation.cjs'));
 const gateway=createGenerationGateway({providers:{'panorama-edit':{protocol:'openai-panorama-edit-native',apiKey:key,modelMap:{'panorama.edit':{kind:'panorama.edit',model:'gpt-image-2',semantics:'perspective-mask-reproject',quality:'high',cropSize:'1024x1024'}}}},routes:{'panorama.edit':'panorama-edit'},fetchImpl,directory:path.join(directory,'tasks')});await gateway.ready;
 const source=publicImage(2048,1024),result=source;
 const objects=[{id:'qa-cube',kind:'cube',name:'公开合成立方体',position:[0,0,-3],rotation:[0,0,0],scale:[1,1,1],color:'#b6643d'},{id:'qa-sphere',kind:'sphere',name:'公开合成球体',position:[2,0,-4],rotation:[0,0,0],scale:[1,1,1],color:'#637860'}];
 const studio={version:1,duration:3,loop:false,ground:{y:-1,size:20,grid:true,room:false},environment:{background:'none',azimuth:0,intensity:1},room:{width:5,depth:12,height:3.2,guides:true,lineMarkers:false,style:'standard',spacing:.5},viewer:{position:[0,1,3],rotation:[0,0,0],order:'YXZ',focal:24,aspect:16/9},objects,keyframes:[],captures:[],activeSetup:'qa-setup',setups:[{id:'qa-setup',name:'合成验收状态',objects:structuredClone(objects),keyframes:[],duration:3}],baseline:{objects:[],keyframes:[],duration:3}};
 const seed=[{id:'panorama-studio',type:'studio',title:'全景局部编辑 · 正式片场验收',x:320,y:100,width:375,height:250,studio}];
 const publicFiles=new Set(execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean));
 let html=fs.readFileSync(path.join(root,'index.html'),'utf8').replace('<head>','<head><base href="/"><script>window.PanoramaEditFixtureConfiguration='+JSON.stringify(metadata)+';</script><script src="src/features/panorama-edit/qa/fixture.js"></script>');
 for(const name of ['canvas-data','editor-data','sidebar-data','versions-data'])html=html.replace(new RegExp('src="'+name+'\\.js[^\"]*"'),'src="defaults/'+name+'.js"');
 html=html.replace('<script src="defaults/canvas-data.js"></script>','<script src="defaults/canvas-data.js"></script><script>window.CANVAS_DATA.nodes='+JSON.stringify(seed)+';window.CANVAS_DATA.edges=[];</script>');
 html=html.replace('</body>','<script type="module" src="src/features/panorama-edit/qa/controls.mjs"></script></body>');
 const csp="default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; connect-src 'self' data: blob:; img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self' data:; worker-src 'self' blob:; frame-src 'self'; object-src 'none'; form-action 'none'; base-uri 'self'";
 const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.json':'application/json','.woff2':'font/woff2','.glb':'model/gltf-binary'};
 const send=(res,status,content,type)=>{res.writeHead(status,{'content-type':type,'cache-control':'no-store','content-security-policy':csp});res.end(content);};
 const json=(res,status,value)=>send(res,status,JSON.stringify(value),mime['.json']);
 const body=async req=>{let size=0;const parts=[];for await(const chunk of req){if((size+=chunk.length)>64*1024*1024)throw Error('QA request too large');parts.push(chunk);}return JSON.parse(Buffer.concat(parts));};
 const server=http.createServer((req,res)=>{void(async()=>{try{const pathname=new URL(req.url,'http://127.0.0.1').pathname;
  if(pathname==='/api/generation/fixture-audit')return json(res,200,{...audit,archiveEntries:(await fsp.readdir(path.join(directory,'tasks'))).length});
  if(pathname.startsWith('/api/generation/')){if(pathname==='/api/generation/config'&&req.method!=='GET')return json(res,403,{error:'QA configuration is immutable'});return gateway.handle(req,res,pathname,{json,body});}
  if(!['GET','HEAD'].includes(req.method))return send(res,403,'Boundary fixture only','text/plain');
  if(pathname==='/')return send(res,200,html,mime['.html']);
  if(pathname==='/src/features/panorama-edit/qa/source.png')return send(res,200,source,mime['.png']);
  if(pathname==='/api/generation/media/10050000-0000-4000-8000-000000000001')return send(res,200,result,mime['.png']);
  if(pathname==='/assets/local-resource-index.json')return send(res,200,JSON.stringify({version:1,algorithm:'sha256-exact-utf8',entries:{}}),mime['.json']);
  if(pathname.startsWith('/api/'))return send(res,403,'No production APIs','text/plain');
  const name=decodeURIComponent(pathname).replace(/^\//,''),filename=path.resolve(root,name),relative=path.relative(root,filename),three=relative.startsWith('node_modules/three/build/')||relative.startsWith('node_modules/three/examples/jsm/');
  if(relative.startsWith('..')||path.isAbsolute(relative)||!publicFiles.has(relative)&&!three||!mime[path.extname(relative)]||['canvas-data.js','editor-data.js','sidebar-data.js','versions-data.js'].includes(relative))return send(res,404,'Public source only','text/plain');
  return send(res,200,fs.readFileSync(filename),mime[path.extname(relative)]);
 }catch{return send(res,404,'Not served','text/plain');}})().catch(()=>{if(res.headersSent)res.destroy();else send(res,500,'Isolated fixture failed','text/plain');});});
 return new Promise(resolve=>server.listen(port,'127.0.0.1',()=>resolve({url:'http://127.0.0.1:'+server.address().port+'/?session=panorama-edit-frontend-1005',audit:()=>structuredClone(audit),close:async()=>{await new Promise(resolve=>server.close(resolve));await gateway.close();await fsp.rm(directory,{recursive:true,force:true});}})));
}
if(require.main===module)startPanoramaEditFrontendQA({port:Number(process.argv[2]??0)}).then(host=>{console.log(host.url);for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>void host.close().then(()=>process.exit(0)));});
module.exports={startPanoramaEditFrontendQA};
