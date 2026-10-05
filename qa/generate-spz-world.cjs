'use strict';
const fs=require('node:fs'),path=require('node:path'),root=path.resolve(__dirname,'..');
let html=fs.readFileSync(path.join(root,'index.html'),'utf8');
html=html.replace('<head>',`<head><base href="/"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self' blob: data:; img-src 'self' blob: data:; media-src 'self' blob: data:; font-src 'self' data:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'"><script src="qa/spz-world-fixture.js"></script>`);
for(const name of ['canvas-data','editor-data','sidebar-data','versions-data'])html=html.replace(new RegExp('src="'+name+'\\.js[^\"]*"','g'),'src="defaults/'+name+'.js"');
html=html.replace('</body>','<script type="module" src="qa/spz-world-controls.mjs"></script></body>');
fs.writeFileSync(path.join(__dirname,'spz-world.html'),html);console.log('qa/spz-world.html');
