'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),directory=path.join(root,'src/features/local-resource-migration/qa');
const tone=path.join(root,'qa/node-audio-repair-tone.wav');
if(!fs.existsSync(tone)){
 const rate=48000,length=rate*2,buffer=Buffer.alloc(44+length*2);
 buffer.write('RIFF',0);buffer.writeUInt32LE(buffer.length-8,4);buffer.write('WAVE',8);buffer.write('fmt ',12);buffer.writeUInt32LE(16,16);buffer.writeUInt16LE(1,20);buffer.writeUInt16LE(1,22);buffer.writeUInt32LE(rate,24);buffer.writeUInt32LE(rate*2,28);buffer.writeUInt16LE(2,32);buffer.writeUInt16LE(16,34);buffer.write('data',36);buffer.writeUInt32LE(length*2,40);
 for(let index=0;index<length;index++)buffer.writeInt16LE(Math.round(Math.sin(index*2*Math.PI*440/rate)*8192),44+index*2);
 fs.writeFileSync(tone,buffer);
}
const html=fs.readFileSync(path.join(root,'index.html'),'utf8')
 .replace('<head>','<head><base href="/"><script src="/src/features/local-resource-migration/qa/node-audio-repair-main-fixture.js"></script>')
 .replace('</body>','<script type="module" src="/src/features/local-resource-migration/qa/node-audio-repair-main-controls.mjs"></script></body>');
fs.writeFileSync(path.join(directory,'node-audio-repair-main.html'),html);
console.log('Created current-entry QA shell: /src/features/local-resource-migration/qa/node-audio-repair-main.html?session=main-review');
