const path = require('node:path');
const root = path.resolve(__dirname, '..');
require('esbuild').buildSync({entryPoints: [path.join(root, 'image-editor-entry.mjs')], outfile: path.join(root, 'assets/image-editor.js'), bundle:true, format:'iife', platform:'browser', target:'es2022', minify:true, legalComments:'linked'});
console.log('Built local Fabric 6.7.0 image editor');
