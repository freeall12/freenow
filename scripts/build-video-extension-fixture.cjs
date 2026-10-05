'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),root=path.resolve(__dirname,'..');
function build(){
 const media='data:video/mp4;base64,'+fs.readFileSync(path.join(root,'src/features/video-generation/qa/media/2.mp4')).toString('base64');
 let html=fs.readFileSync(path.join(root,'index.html'),'utf8').replace('<head>','<head><base href="/"><script>window.ExtensionFixtureOutput='+JSON.stringify(media)+'</script><script src="qa/video-extension-fixture.js"></script>');
 for(const name of ['canvas-data','editor-data','sidebar-data','versions-data']){const pattern=new RegExp('src="'+name+'\\.js[^\"]*"');assert(pattern.test(html),'Missing root data: '+name);html=html.replace(pattern,'src="defaults/'+name+'.js"');}
 const data='<script src="defaults/canvas-data.js"></script>';assert(html.includes(data));
 html=html.replace(data,data+'<script>window.CANVAS_DATA.nodes=[{id:"extension-source",type:"video",title:"延长镜头 · 本地合成素材",video:"/qa/trim-scenes.mp4",generation:{modelId:"other-source-model",resolution:"1080p",generateAudio:false},x:320.25,y:140.75,width:320,height:180}];window.CANVAS_DATA.edges=[];</script>');
 const production='<script src="generation-ui.js';assert(html.includes(production));
 // Count the genuine preparation hook; never replace production media logic.
 const audit='<script>(()=>{const Original=window.GenerationCore.TaskService;window.GenerationCore.TaskService=class extends Original{constructor(options={}){const prepare=options.prepareInputs;super({...options,prepareInputs:async(request,context)=>{if(request.kind==="video.extend")window.ExtensionFixture.mediaPrepares++;return prepare?prepare(request,context):request;}});}};})();</script>';
 html=html.replace(production,audit+production).replace('</body>','<script type="module" src="qa/video-extension-controls.mjs"></script></body>');
 fs.writeFileSync(path.join(root,'qa/video-extension-app.html'),html);return html;
}
if(require.main===module){build();console.log('Extension fixture: /qa/video-extension-app.html?mode=unconfigured|native|delayed|normal&session=unique');}
module.exports={build};
