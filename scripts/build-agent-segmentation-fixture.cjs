'use strict';
const fs=require('node:fs'),path=require('node:path'),root=path.resolve(__dirname,'..');
function build(){
 let html=fs.readFileSync(path.join(root,'index.html'),'utf8');
 const replaceOne=(marker,value)=>{if(html.split(marker).length!==2)throw Error('Agent SAM2 fixture cannot locate one official entrypoint marker: '+marker);html=html.replace(marker,value);};
 replaceOne('<head>','<head><base href="/"><script src="src/features/agent-generation/qa/agent-segmentation-fixture.js"></script>');
 for(const name of ['canvas-data','editor-data','sidebar-data','versions-data'])html=html.replace(new RegExp('src="'+name+'\\.js[^\"]*"'),'src="defaults/'+name+'.js"');
 for(const name of ['canvas-data','editor-data','sidebar-data','versions-data'])if(!html.includes('src="defaults/'+name+'.js"'))throw Error('Agent SAM2 fixture requires public defaults/'+name+'.js in official entrypoint.');
 replaceOne('<script src="defaults/canvas-data.js"></script>','<script src="defaults/canvas-data.js"></script><script>window.CANVAS_DATA.nodes=[{id:"agent-segmentation-source",type:"video",title:"SAM2 Agent · 5秒公开合成移动矩形",video:new URL("/qa/sam2-source.mp4",location.href).href,clip:{start:1,end:4},x:160,y:240,width:320,height:180}];window.CANVAS_DATA.edges=[];</script>');
 replaceOne('<script src="local-assets.js"></script>','<script src="local-assets.js"></script><script src="src/features/agent-generation/qa/agent-segmentation-source.js"></script>');
 replaceOne('</body>','<script type="module" src="src/features/agent-generation/qa/agent-segmentation-controls.mjs"></script></body>');
 fs.writeFileSync(path.join(root,'src/features/agent-generation/qa/agent-segmentation-app.html'),html);
 return '/src/features/agent-generation/qa/agent-segmentation-app.html';
}
if(require.main===module)console.log(build());
module.exports={build};
