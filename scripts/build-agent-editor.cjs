const path=require('node:path');
const root=path.resolve(__dirname,'..');
require('esbuild').buildSync({entryPoints:[path.join(root,'src/features/agent-composer/editor-entry.mjs')],outfile:path.join(root,'assets/agent-editor.js'),bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true,legalComments:'linked'});
console.log('Built shared Agent Tiptap composer');
