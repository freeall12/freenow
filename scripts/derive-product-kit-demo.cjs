'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),directory='src/features/agent-apps/resources/apps';
const sourceFile=directory+'/product-kit@v1.758d09b3.html';
const sourceSha256='758d09b3f06e99a6b4e47a782d33ef90b9f12935c140b8bdfe88ca41f76e2535';
const assetFile='assets/studio/library/chair-office.webp';
const original='https://files.tapnow.ai/demo/product-kit.webp';
const originalTransport='thumbnail_url:f().url().refine(e=>e.startsWith("https://"))';
const localTransport=String.raw`thumbnail_url:f().max(500000).regex(/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/)`;
const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
function deriveProductKitDemo(){
 const source=fs.readFileSync(path.join(root,sourceFile)),asset=fs.readFileSync(path.join(root,assetFile));
 if(digest(source)!==sourceSha256)throw Error('Product Kit captured source integrity mismatch');
 const html=source.toString('utf8');
 if(html.split(original).length!==2||html.split(originalTransport).length!==2)throw Error('Product Kit demo thumbnail targets must be unique');
 // A self-contained demo also works in the opaque iframe, without granting an image origin.
 const thumbnail='data:image/webp;base64,'+asset.toString('base64'),derived=html.replace(original,thumbnail).replace(originalTransport,localTransport);
 const derivedSha256=digest(derived),derivedFile=directory+'/product-kit@v1.'+derivedSha256.slice(0,8)+'.html';
 return {html:derived,thumbnail,metadata:{operation:'inline-local-demo-thumbnail',sourceFile,sourceSha256,derivedFile,derivedSha256,assetFile,assetSha256:digest(asset)}};
}
function publish(){
 const result=deriveProductKitDemo(),manifestFile=path.join(root,directory,'manifest.json'),manifest=JSON.parse(fs.readFileSync(manifestFile,'utf8'));
 const proxyFile=path.join(root,'src/features/agent-apps/resources/mcp-app-proxy.html'),proxy=fs.readFileSync(proxyFile,'utf8');
 const marker=/var productKitDemoDerivedSha256 = "[a-f0-9]{64}";/g;
 if([...proxy.matchAll(marker)].length!==1)throw Error('Product Kit derived integrity marker must be unique');
 fs.writeFileSync(path.join(root,result.metadata.derivedFile),result.html);
 manifest.widgets['product-kit@v1']=result.metadata.derivedSha256.slice(0,8);
 manifest.derivations={...manifest.derivations,'product-kit@v1':result.metadata};
 fs.writeFileSync(manifestFile,JSON.stringify(manifest,null,2)+'\n');
 fs.writeFileSync(proxyFile,proxy.replace(marker,'var productKitDemoDerivedSha256 = "'+result.metadata.derivedSha256+'";'));
 console.log(result.metadata.derivedFile);
}
if(require.main===module){if(process.argv[2]!=='--write')throw Error('Use --write to publish the verified local derivative');publish();}
module.exports={deriveProductKitDemo,originalTransport,localTransport};
