'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),root=path.resolve(__dirname,'..');
function build(){
 let html=fs.readFileSync(path.join(root,'index.html'),'utf8').replace('<head>','<head><base href="/"><script src="qa/video-mask-native-fixture.js"></script>');
 for(const name of ['canvas-data','editor-data','sidebar-data','versions-data']){const pattern=new RegExp('src="'+name+'\\.js[^\"]*"');assert(pattern.test(html),'Missing root data: '+name);html=html.replace(pattern,'src="defaults/'+name+'.js"');}
 const data='<script src="defaults/canvas-data.js"></script>';assert(html.includes(data));
 html=html.replace(data,data+'<script>window.CANVAS_DATA.nodes=[{id:"mask-source",type:"video",title:"视频蒙层 · 公开合成素材",video:"/qa/trim-scenes.mp4",x:320.25,y:140.75,width:320,height:180},{id:"mask-reference",type:"image",title:"替换参考 · 原创合成图",x:750,y:150,width:180,height:180}];window.CANVAS_DATA.edges=[];if(window.VideoMaskFixture.mode==="pipeline"){window.CANVAS_DATA.nodes[0].video="/qa/native-video-mask-source.mp4";window.CANVAS_DATA.nodes[0].clip={start:1,end:9.1};}</script>');
 const production='<script src="generation-ui.js';assert(html.includes(production));html=html.replace(production,'<script src="qa/video-mask-native-audit.js"></script>'+production);
 html=html.replace('</body>','<script type="module" src="qa/video-mask-native-controls.mjs"></script></body>');fs.writeFileSync(path.join(root,'qa/video-mask-native-app.html'),html);return html;
}
if(require.main===module){build();console.log('Rebuilt production masked-video fixture: /qa/video-mask-native-app.html?mode=unconfigured|native|delayed|pipeline&session=unique');}
module.exports={build};
