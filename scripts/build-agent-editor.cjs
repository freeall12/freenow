const path=require('node:path');
const root=path.resolve(__dirname,'..');
require('esbuild').build({entryPoints:[path.join(root,'src/features/agent-composer/editor-entry.mjs')],outfile:path.join(root,'assets/agent-editor.js'),bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true,legalComments:'linked',plugins:[{name:'shared-subject-store',setup(build){
  // The composer and lazy UI must share one authoritative IndexedDB cache.
  build.onResolve({filter:/subject-library\/store\.mjs$/},()=>({path:'/src/features/subject-library/store.mjs',external:true}));
}}]}).then(()=>console.log('Built shared Agent Tiptap composer')).catch(error=>{console.error(error);process.exitCode=1;});
