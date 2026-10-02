const path=require('node:path'),root=path.resolve(__dirname,'..');
require('esbuild').buildSync({entryPoints:[path.join(root,'image-mask-entry.mjs')],outfile:path.join(root,'assets/image-mask.js'),bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true,legalComments:'linked'});
console.log('Built local Fabric 6.7.0 floating mask engine');
