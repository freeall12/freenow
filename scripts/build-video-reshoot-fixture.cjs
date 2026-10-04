'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),root=path.resolve(__dirname,'..');
function build(){
 let html=fs.readFileSync(path.join(root,'index.html'),'utf8').replace('<head>','<head><base href="/"><script src="qa/video-reshoot-fixture.js"></script>');
 for(const name of ['canvas-data','editor-data','sidebar-data','versions-data']){const pattern=new RegExp('src="'+name+'\\.js[^\"]*"');assert(pattern.test(html),'Missing root data: '+name);html=html.replace(pattern,'src="defaults/'+name+'.js"');}
 const data='<script src="defaults/canvas-data.js"></script>';assert(html.includes(data));
 html=html.replace(data,data+'<script>window.CANVAS_DATA.nodes=[{id:"reshoot-source",type:"video",title:"视频重拍 · 本地合成素材",video:"/qa/trim-scenes.mp4",generation:{modelId:"other-source-model",resolution:"1080p",generateAudio:false},x:320.25,y:140.75,width:320,height:180}];window.CANVAS_DATA.edges=[];</script>');
 const production='<script src="generation-ui.js';assert(html.includes(production));html=html.replace(production,'<script src="qa/video-reshoot-audit.js"></script>'+production);
 html=html.replace('</body>','<script type="module" src="qa/video-reshoot-controls.mjs"></script></body>');fs.writeFileSync(path.join(root,'qa/video-reshoot-native-app.html'),html);return html;
}
if(require.main===module){build();console.log('Rebuilt production reshoot fixture: /qa/video-reshoot-native-app.html?mode=unconfigured|native|delayed&session=unique');}
module.exports={build};
