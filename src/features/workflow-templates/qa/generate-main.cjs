'use strict';
const fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '../../../..');
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
for (const entry of ['canvas-store.js', 'app.js', 'sidebars.js', 'templates-core.js', 'templates-ui.js']) {
  if (!html.includes('src="' + entry)) throw Error('Production entry missing: ' + entry);
}
const policy = "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self' blob: data:; img-src 'self' blob: data:; media-src 'self' blob: data:; font-src 'self' data:; worker-src 'self' blob:; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'self'";
html = html.replace('<head>', '<head>\n<base href="/">\n<meta http-equiv="Content-Security-Policy" content="' + policy + '">\n<script src="src/features/workflow-templates/qa/fixture.js"></script>');
for (const name of ['canvas-data', 'editor-data', 'sidebar-data', 'versions-data']) {
  html = html.replace(new RegExp('src="' + name + '\\.js[^\"]*"', 'g'), 'src="defaults/' + name + '.js"');
}
html = html.replace('</body>', '<script type="module" src="src/features/workflow-templates/qa/observe.mjs"></script></body>');
fs.writeFileSync(path.join(__dirname, 'main.html'), html.replace(/[ \t]+$/gm, ''));
console.log('/src/features/workflow-templates/qa/main.html?session=workflow-template-1005');
