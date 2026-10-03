'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const directory=__dirname,root=path.resolve(directory,'../../../..');
const sources=[{id:'landscape',width:320,height:180,color:'0x974332'},{id:'portrait',width:180,height:320,color:'0x287960'},{id:'square',width:256,height:256,color:'0x386c9e'}];
function run(command,args){const result=spawnSync(command,args,{encoding:'utf8'});if(result.status!==0)throw Error(result.error?.message||result.stderr||command+' failed');return result.stdout;}
for(const source of sources){
 const file=path.join(directory,source.id+'.mp4'),poster=path.join(directory,source.id+'.png');
 if(!fs.existsSync(file))run(process.env.FFMPEG_PATH||'ffmpeg',['-hide_banner','-loglevel','error','-nostdin','-f','lavfi','-i',`color=c=${source.color}:s=${source.width}x${source.height}:r=24:d=4`,'-vf','drawbox=x=20:y=20:w=iw-40:h=ih-40:color=white@0.5:t=6,drawbox=x=30:y=40:w=40:h=40:color=yellow:t=fill','-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart','-y',file]);
 if(!fs.existsSync(poster))run(process.env.FFMPEG_PATH||'ffmpeg',['-hide_banner','-loglevel','error','-nostdin','-i',file,'-frames:v','1','-threads','1','-y',poster]);
 const metadata=JSON.parse(run(process.env.FFPROBE_PATH||'ffprobe',['-v','error','-select_streams','v:0','-show_entries','stream=width,height,codec_name:format=duration','-of','json',file]));
 if(metadata.streams[0]?.width!==source.width||metadata.streams[0]?.height!==source.height)throw Error(source.id+' dimensions mismatch');
 source.duration=Number(metadata.format.duration);source.codec=metadata.streams[0].codec_name;source.bytes=fs.statSync(file).size;source.posterBytes=fs.statSync(poster).size;
}
fs.writeFileSync(path.join(directory,'media-manifest.json'),JSON.stringify({synthetic:true,source:'FFmpeg lavfi color and drawbox; no personal assets or model calls',sources},null,2)+'\n');
let html=fs.readFileSync(path.join(root,'index.html'),'utf8');
html=html.replace('<head>','<head>\n<base href="/">\n<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\' \'unsafe-inline\' \'wasm-unsafe-eval\'; style-src \'self\' \'unsafe-inline\'; connect-src \'self\' blob: data:; img-src \'self\' blob: data:; media-src \'self\' blob: data:; font-src \'self\' data:; worker-src \'self\' blob:; frame-src \'none\'; object-src \'none\'; form-action \'none\'; base-uri \'self\'">\n<script src="src/features/video-history/qa/fixture.js"></script>');
for(const name of ['canvas-data','editor-data','sidebar-data','versions-data'])html=html.replace(new RegExp('src="'+name+'\\.js[^\"]*"','g'),'src="defaults/'+name+'.js"');
html=html.replace('<title>未命名画布 · 画布复刻</title>','<title>视频历史 · 真实本地媒体隔离 QA</title>');
html=html.replace('</body>','<script type="module" src="src/features/video-history/qa/controls.mjs"></script></body>');
fs.writeFileSync(path.join(directory,'history-main.html'),html);console.log('/src/features/video-history/qa/history-main.html?session=video-history-live-1003');
