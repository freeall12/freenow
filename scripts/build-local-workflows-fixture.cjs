'use strict';
const fs=require('node:fs'),path=require('node:path'),root=path.resolve(__dirname,'..');
let html=fs.readFileSync(path.join(root,'index.html'),'utf8').replace('<head>','<head><base href="/"><script src="qa/local-workflows-fixture.js"></script>');
for(const name of ['canvas-data','editor-data','sidebar-data','versions-data'])html=html.replace(new RegExp('src="'+name+'\\.js[^\"]*"'),'src="defaults/'+name+'.js"');
html=html.replace('<script src="defaults/canvas-data.js"></script>','<script src="defaults/canvas-data.js"></script><script>window.CANVAS_DATA.nodes=[{id:"extension-source",type:"video",title:"合成三镜头 · 2–4秒选区",video:"/qa/trim-scenes.mp4",clip:{start:2,end:4},x:320.25,y:140.75,width:320,height:180}];window.CANVAS_DATA.edges=[];</script>');
html=html.replace('</body>','<script type="module" src="qa/local-workflows-controls.mjs"></script></body>');fs.writeFileSync(path.join(root,'qa/local-workflows-app.html'),html);
console.log('Open /qa/local-workflows-app.html?session=unique');
