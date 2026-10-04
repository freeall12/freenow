'use strict';
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),root=path.resolve(__dirname,'..');
// A deterministic 2:1 RGB fixture, not a model-generated panorama.
function crc32(data){let crc=0xffffffff;for(const byte of data){crc^=byte;for(let i=0;i<8;i++)crc=crc&1?0xedb88320^(crc>>>1):crc>>>1;}return (crc^0xffffffff)>>>0;}
function chunk(type,data){const tag=Buffer.from(type),length=Buffer.alloc(4),crc=Buffer.alloc(4);length.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([tag,data])));return Buffer.concat([length,tag,data,crc]);}
const width=1024,height=512,raw=Buffer.alloc(height*(1+width*3));for(let y=0;y<height;y++)for(let x=0;x<width;x++){const offset=y*(1+width*3)+1+x*3;raw[offset]=40+(Math.floor(x/128)%2)*110;raw[offset+1]=y<height/2?140:60;raw[offset+2]=y<height/2?180:90;}
const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=2;
fs.writeFileSync(path.join(root,'qa/agent-image-processing-panorama-result.png'),Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]));
// Restrict real connections to local QA media paths. In particular, 'self'
// would allow /api after a bootstrap error, so it is absent from connect-src.
const csp="default-src 'self' blob: data:; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; connect-src http://localhost:*/qa/ http://127.0.0.1:*/qa/ http://localhost:*/runtime-reference/skills-catalog.json http://127.0.0.1:*/runtime-reference/skills-catalog.json blob: data:; img-src 'self' blob: data:; media-src 'self' blob: data:; font-src 'self' data:; frame-src 'none'; worker-src 'none'; object-src 'none'; form-action 'none'; base-uri 'self'";
let html=fs.readFileSync(path.join(root,'index.html'),'utf8').replace('<head>','<head><meta http-equiv="Content-Security-Policy" content="'+csp+'"><base href="/"><script src="qa/agent-image-processing-fixture.js"></script>');
for(const name of ['canvas-data','editor-data','sidebar-data','versions-data'])html=html.replace(new RegExp('src="'+name+'\\.js[^\"]*"'),'src="defaults/'+name+'.js"');
html=html.replace('<script src="defaults/canvas-data.js"></script>','<script src="defaults/canvas-data.js"></script><script>window.CANVAS_DATA.nodes=[{id:"image-source",type:"image",title:"本地512×320原图 · 32×20缩略图",image:"/qa/agent-image-processing-thumbnail.png",fullImage:"/qa/agent-image-processing-source.png",x:100,y:240,width:320,height:200}];window.CANVAS_DATA.edges=[];</script>');
html=html.replace('</body>','<script type="module" src="qa/agent-image-processing-controls.mjs"></script></body>');
fs.writeFileSync(path.join(root,'qa/agent-image-processing-app.html'),html);
console.log('Open /qa/agent-image-processing-app.html?session=unique ; &kind=angle&auto for explicit multi-angle, &kind=panorama for the actual panorama confirmation card.');
