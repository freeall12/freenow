'use strict';
const fs=require('node:fs'),path=require('node:path'),root=path.resolve(__dirname,'..');
const bootstrap=`(() => {
  const session=new URLSearchParams(location.search).get('session')||'manual',prefix='qa-generation-history:'+encodeURIComponent(session)+':',storage=window.localStorage;
  Object.defineProperty(window,'localStorage',{value:{getItem:key=>storage.getItem(prefix+key),setItem:(key,value)=>storage.setItem(prefix+key,String(value)),removeItem:key=>storage.removeItem(prefix+key)}});
  window.CANVAS_DB_NAME=prefix+'canvas';window.LOCAL_ASSETS_DB_NAME=prefix+'assets';
})();`;
const csp="default-src 'self' blob: data:; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; connect-src 'self' blob: data:; img-src 'self' blob: data:; media-src 'self' blob: data:; font-src 'self' data:; object-src 'none'; base-uri 'self'";
let html=fs.readFileSync(path.join(root,'index.html'),'utf8').replace('<head>','<head><base href="/"><meta http-equiv="Content-Security-Policy" content="'+csp+'"><script>'+bootstrap+'</script>');
for(const name of ['canvas-data','editor-data','sidebar-data','versions-data'])html=html.replace(new RegExp('src="'+name+'\\.js[^\"]*"'),'src="defaults/'+name+'.js"');
html=html.replace('<script src="defaults/canvas-data.js"></script>','<script src="defaults/canvas-data.js"></script><script>window.CANVAS_DATA.nodes=[];window.CANVAS_DATA.edges=[];</script>');
html=html.replace('</body>','<script type="module" src="src/features/generation-history/qa-controls.mjs"></script></body>');
fs.writeFileSync(path.join(root,'qa/generation-history-app.html'),html);
console.log('Open /qa/generation-history-app.html?session=unique. Real synthetic PNG, no model calls. Keep the same session URL after refresh.');
