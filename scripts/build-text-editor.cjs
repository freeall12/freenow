const path = require('node:path');
const root = path.resolve(__dirname, '..');
require('esbuild').buildSync({
  entryPoints: [path.join(root, 'text-editor-entry.mjs')],
  outfile: path.join(root, 'assets/text-editor.js'),
  bundle: true, format: 'iife', platform: 'browser', target: 'es2022',
  minify: true, legalComments: 'linked',
});
console.log('Built local Tiptap editor and Markdown renderer');
