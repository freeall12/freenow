'use strict';
const fs=require('node:fs'),path=require('node:path'),root=path.resolve(__dirname,'../../../..');
let html=fs.readFileSync(path.join(root,'index.html'),'utf8');
html=html.replace('<head>','<head>\n<base href="/">');
const scripts=[];
html=html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/g,(full,attributes,text)=>{
 const type=attributes.match(/\btype="([^"]+)"/)?.[1];if(type==='importmap')return full;
 const src=attributes.match(/\bsrc="([^"]+)"/)?.[1];if(src?.startsWith('canvas-data.js'))return '';
 scripts.push({src,type,text:src?undefined:text});return '';
});
if(!scripts.some(item=>item.src?.startsWith('app.js'))||!scripts.some(item=>item.src?.startsWith('sidebars.js')))throw Error('Production canvas entry scripts not found');
// Dynamic loading yields between classic scripts. Install the independent
// local media service before any production app/history initializer can run.
const localAssets=scripts.findIndex(item=>item.src==='local-assets.js');if(localAssets<0)throw Error('Production LocalAssets loader not found');const [mediaService]=scripts.splice(localAssets,1);scripts.splice(scripts.findIndex(item=>item.src?.startsWith('app.js')),0,mediaService);
const payload=JSON.stringify(scripts).replace(/</g,'\\u003c');
html=html.replace('</body>',`<script src="/src/features/library-asset-roundtrip/qa/fixture.js"></script>\n<script src="/src/features/generation-config/qa/configuration.js"></script>\n<script type="application/json" id="generation-readiness-production-scripts">${payload}</script>\n<script type="module" src="/src/features/generation-config/qa/boot.mjs"></script>\n</body>`);
fs.writeFileSync(path.join(__dirname,'main.html'),html.replace(/[ \t]+$/gm,''));console.log('Generated feature QA with isolated IDB bootstrap and production scripts');
