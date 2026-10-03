'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),directory=path.join(root,'src/features/local-resource-migration/qa');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8')
 .replace('<head>','<head><base href="/"><script src="/src/features/local-resource-migration/qa/node-image-repair-main-fixture.js"></script>')
 .replace('</body>','<script type="module" src="/src/features/local-resource-migration/qa/node-image-repair-main-controls.mjs"></script></body>');
fs.writeFileSync(path.join(directory,'node-image-repair-main.html'),html);
console.log('Created current-entry QA shell: /src/features/local-resource-migration/qa/node-image-repair-main.html?session=main-review');
