'use strict';
const fs=require('node:fs'),path=require('node:path'),root=path.resolve(__dirname,'..'),directory=path.join(root,'src/features/audio-subtitles/qa');
if(!fs.existsSync(path.join(root,'qa/node-audio-repair-tone.wav')))throw Error('真实本机 WAV 缺失；请保留已验证的音频修复夹具');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8')
 .replace('<head>','<head><base href="/"><script src="/src/features/audio-subtitles/qa/main-fixture.js"></script>')
 .replace('</body>','<script type="module" src="/src/features/audio-subtitles/qa/main-controls.mjs"></script></body>');
fs.mkdirSync(directory,{recursive:true});
for(const [source,target]of [['node-audio-repair-tone.wav','contract-tone.wav'],['node-audio-upload-newer.wav','contract-newer.wav']])fs.copyFileSync(path.join(root,'qa',source),path.join(directory,target));
fs.writeFileSync(path.join(directory,'main.html'),html);
console.log('Created current-entry subtitle QA: /src/features/audio-subtitles/qa/main.html?session=subtitle-review');
