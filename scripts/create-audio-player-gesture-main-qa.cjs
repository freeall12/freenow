'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),output=path.join(root,'src/features/audio-playback/qa/gesture-main.html');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8').replace('<head>','<head><base href="/"><script src="/src/features/audio-playback/qa/gesture-main-fixture.js"></script>');
fs.writeFileSync(output,html);
const tone=path.join(root,'build/qa/audio-player-gesture.wav');
if(!fs.existsSync(tone)){
 fs.mkdirSync(path.dirname(tone),{recursive:true});
 const rate=48000,length=rate*3,buffer=Buffer.alloc(44+length*2);
 buffer.write('RIFF',0);buffer.writeUInt32LE(buffer.length-8,4);buffer.write('WAVE',8);buffer.write('fmt ',12);
 buffer.writeUInt32LE(16,16);buffer.writeUInt16LE(1,20);buffer.writeUInt16LE(1,22);buffer.writeUInt32LE(rate,24);
 buffer.writeUInt32LE(rate*2,28);buffer.writeUInt16LE(2,32);buffer.writeUInt16LE(16,34);buffer.write('data',36);buffer.writeUInt32LE(length*2,40);
 for(let i=0;i<length;i++)buffer.writeInt16LE(Math.round(Math.sin(i*2*Math.PI*660/rate)*8192),44+i*2);
 fs.writeFileSync(tone,buffer);
}
console.log('Updated production audio gesture QA shell');
