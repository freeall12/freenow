'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),qa=path.join(root,'qa');
for(const color of ['red','blue']){
 const video=path.join(qa,'playlist-contract-'+color+'.mp4');
 if(!fs.existsSync(video)){
  const result=spawnSync(process.env.FFMPEG_PATH||'ffmpeg',['-hide_banner','-loglevel','error','-nostdin','-f','lavfi','-i',`color=c=${color}:s=320x180:r=24:d=8`,'-vf','drawbox=x=30:y=30:w=200:h=80:color=white@0.65:t=fill','-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart','-y',video],{encoding:'utf8'});
  if(result.status!==0)throw Error(result.error?.message||result.stderr||'QA FFmpeg fixture creation failed');
 }
}
const html=fs.readFileSync(path.join(root,'index.html'),'utf8').replace('<head>','<head><base href="/"><script src="/src/features/canvas-playlist/qa/fixture.js"></script>').replace('</body>','<script type="module" src="/src/features/canvas-playlist/qa/controls.mjs"></script></body>');
fs.writeFileSync(path.join(qa,'playlist-contract.html'),html);
console.log('Created current-entry QA shell: /qa/playlist-contract.html?session=playlist-review');
