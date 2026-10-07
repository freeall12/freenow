'use strict';
const fs=require('node:fs'),path=require('node:path'),root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8')
 .replace('<head>','<head><base href="/"><script src="/src/features/canvas-command-menu/qa/fixture.js"></script>')
 .replace('</body>','<script type="module" src="/src/features/canvas-command-menu/qa/controls.mjs"></script></body>');
const output=path.join(root,'qa/canvas-command-menu');
fs.mkdirSync(output,{recursive:true});
fs.writeFileSync(path.join(output,'app.html'),html);
console.log('Created current-entry QA: /qa/canvas-command-menu/app.html?session=menu-review');
