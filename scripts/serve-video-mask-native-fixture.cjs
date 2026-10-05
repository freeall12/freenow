'use strict';
// Read-only static QA host: no environment loading, model gateways or user stores.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const {build}=require('./build-video-mask-native-fixture.cjs');
const root=path.resolve(__dirname,'..'),port=Number(process.argv[2]??0);
if(!Number.isSafeInteger(port)||port<0||port>65535||port===4173)throw Error('Use a temporary port other than 4173 (default: OS-assigned).');
build();
const publicFiles=new Set(execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean));
for(const name of ['qa/video-mask-native-app.html','qa/video-mask-native-fixture.js','qa/video-mask-native-audit.js','qa/video-mask-native-controls.mjs'])publicFiles.add(name);
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.mp4':'video/mp4','.woff2':'font/woff2','.gltf':'model/gltf+json'};
const server=http.createServer((req,res)=>{
 let name;try{name=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname).replace(/^\//,'');}catch{res.writeHead(400);return res.end();}
 if(!['GET','HEAD'].includes(req.method)||name.startsWith('api/')){res.writeHead(403);return res.end('No API or mutation routes on the QA host.');}
 const file=path.resolve(root,name),relative=path.relative(root,file),three=relative.startsWith('node_modules/three/build/')||relative.startsWith('node_modules/three/examples/jsm/');
 if(relative.startsWith('..')||path.isAbsolute(relative)||!publicFiles.has(relative)&&!three){res.writeHead(404);return res.end('Only public checkout files are served.');}
 fs.stat(file,(error,stat)=>{
  if(error||!stat.isFile()){res.writeHead(404);return res.end();}
  let start=0,end=stat.size-1,status=200;const match=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range??'');
  if(match){start=Number(match[1]);end=match[2]?Math.min(Number(match[2]),end):end;if(start>end||start>=stat.size){res.writeHead(416,{'Content-Range':'bytes */'+stat.size});return res.end();}status=206;}
  const headers={'Content-Type':types[path.extname(file)]??'application/octet-stream','Content-Length':end-start+1,'Accept-Ranges':'bytes','Cache-Control':'no-store','Content-Security-Policy':"default-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' data: blob:; worker-src 'self' blob:; object-src 'none'"};
  if(status===206)headers['Content-Range']=`bytes ${start}-${end}/${stat.size}`;res.writeHead(status,headers);if(req.method==='HEAD')return res.end();fs.createReadStream(file,{start,end}).on('error',()=>res.destroy()).pipe(res);
 });
});
server.listen(port,'127.0.0.1',()=>console.log(`Video mask QA: http://127.0.0.1:${server.address().port}/qa/video-mask-native-app.html?mode=unconfigured&session=unique\nModes: unconfigured, native, delayed. Synthetic media/config only; no model calls.`));
