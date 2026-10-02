'use strict';
const fs=require('node:fs'),path=require('node:path'),root=path.resolve(__dirname,'..');
let html=fs.readFileSync(path.join(root,'index.html'),'utf8').replace('<head>','<head><base href="/"><script src="qa/fal-native-fixture.js"></script>');
for(const name of ['canvas-data','editor-data','sidebar-data','versions-data'])html=html.replace(new RegExp('src="'+name+'\\.js[^\"]*"'),'src="defaults/'+name+'.js"');
html=html.replace('<script src="defaults/canvas-data.js"></script>','<script src="defaults/canvas-data.js"></script><script>window.CANVAS_DATA.nodes=[];window.CANVAS_DATA.edges=[];</script>');
html=html.replace('</body>','<script type="module" src="qa/fal-native-controls.mjs"></script></body>');fs.writeFileSync(path.join(root,'qa/fal-native-app.html'),html);
console.log('Open /qa/fal-native-app.html?session=unique. Synthetic source and fixed responses, no supplier calls.');
