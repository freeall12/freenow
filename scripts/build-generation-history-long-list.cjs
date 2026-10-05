'use strict';
const fs=require('node:fs'),path=require('node:path'),root=path.resolve(__dirname,'..');
const csp="default-src 'self' blob: data:; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; connect-src 'self' blob: data:; img-src 'self' blob: data:; media-src 'self' blob: data:; font-src 'self' data:; object-src 'none'; base-uri 'self'";
let html=fs.readFileSync(path.join(root,'index.html'),'utf8').replace('<head>','<head><base href="/"><meta http-equiv="Content-Security-Policy" content="'+csp+'"><script src="src/features/generation-history/qa/long-list-fixture.js"></script>');
for(const name of ['canvas-data','editor-data','sidebar-data','versions-data'])html=html.replace(new RegExp('src="'+name+'\\.js[^"]*"'),'src="defaults/'+name+'.js"');
html=html.replace('</body>','<script type="module" src="src/features/generation-history/qa/long-list-controls.mjs"></script></body>');
fs.writeFileSync(path.join(root,'qa/generation-history-long-list.html'),html);
console.log('Open /qa/generation-history-long-list.html?session=long-list-1005p. Uses isolated IDB and actual synthetic PNG; no model calls.');
