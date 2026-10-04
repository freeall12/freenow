'use strict';
// Keep originals for canvas/detail use; the gallery needs only 640px previews.
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),catalogPath=path.join(root,'src/features/workflow-templates/resources/templates.json');
const catalog=JSON.parse(fs.readFileSync(catalogPath,'utf8')),output=path.join(root,'assets/workflow-templates');
fs.mkdirSync(output,{recursive:true});
let originalBytes=0,thumbnailBytes=0;
for(const template of catalog.templates){
 if(typeof template.image!=='string'||!/^\/assets\/[A-Za-z0-9_./-]+$/.test(template.image)||template.image.split('/').includes('..'))throw Error('Template cover must be a local asset');
 const source=path.join(root,template.image.slice(1)),bytes=fs.readFileSync(source),digest=createHash('sha256').update(bytes).digest('hex').slice(0,20),name=digest+'-thumb.webp',target=path.join(output,name);
 const result=spawnSync(process.env.FFMPEG_PATH||'ffmpeg',['-nostdin','-v','error','-y','-i',source,'-vf','scale=w=min(640\\,iw):h=-2','-frames:v','1','-c:v','libwebp','-quality','84','-compression_level','6',target],{encoding:'utf8'});
 if(result.status!==0)throw Error('Local FFmpeg thumbnail conversion failed: '+(result.error?.message||result.stderr));
 template.thumbnail='/assets/workflow-templates/'+name;
 originalBytes+=bytes.length;thumbnailBytes+=fs.statSync(target).size;
}
fs.writeFileSync(catalogPath,JSON.stringify(catalog,null,2)+'\n');
console.log(JSON.stringify({templates:catalog.templates.length,originalBytes,thumbnailBytes}));
