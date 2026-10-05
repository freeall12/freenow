const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const {deriveProductKitDemo,originalTransport,localTransport}=require('../scripts/derive-product-kit-demo.cjs');
const root=path.resolve(__dirname,'..'),resources=path.join(root,'src/features/agent-apps/resources');
const proxy=fs.readFileSync(path.join(resources,'mcp-app-proxy.html'),'utf8');
const transport=proxy.slice(proxy.indexOf('// PRODUCT_KIT_LOCAL_TRANSPORT:BEGIN'),proxy.indexOf('// PRODUCT_KIT_LOCAL_TRANSPORT:END'));
const localize=vm.runInNewContext(transport+';localizeProductKitTransport',{crypto:crypto.webcrypto,TextEncoder,Uint8Array});
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
test('published local demo is reproducible, preserves source evidence and embeds exact existing image bytes',()=>{
 const result=deriveProductKitDemo(),manifest=JSON.parse(fs.readFileSync(path.join(resources,'apps/manifest.json'),'utf8'));
 assert.deepEqual(manifest.derivations['product-kit@v1'],result.metadata);
 assert.equal(manifest.widgets['product-kit@v1'],result.metadata.derivedSha256.slice(0,8));
 assert.equal(fs.readFileSync(path.join(root,result.metadata.derivedFile),'utf8'),result.html);
 const source=fs.readFileSync(path.join(root,result.metadata.sourceFile));assert.equal(sha(source),result.metadata.sourceSha256);
 assert.equal(result.html.replace(result.thumbnail,'https://files.tapnow.ai/demo/product-kit.webp').replace(localTransport,originalTransport),source.toString('utf8'));
 assert.doesNotMatch(result.html,/files\.tapnow\.ai/);
 assert.deepEqual(Buffer.from(result.thumbnail.split(',')[1],'base64'),fs.readFileSync(path.join(root,result.metadata.assetFile)));
});
test('actual standalone startup mounts a local data thumbnail without connecting the app SDK',async()=>{
 const {html,thumbnail}=deriveProductKitDemo(),start=html.indexOf('U_={version:1,locale:'),end=html.indexOf(',wm=document',start);
 const demo=vm.runInNewContext('('+html.slice(start+3,end)+')');assert.equal(demo.product.thumbnail_url,thumbnail);
 // Standalone rendering validates U_ before mounting it. Its actual thumbnail
 // expression must accept the new data URI, not retain the original HTTPS gate.
 const expression=html.slice(html.indexOf(localTransport)+'thumbnail_url:'.length,html.indexOf('}),kit_version:',html.indexOf(localTransport)));
 const f=()=>{let max=Infinity,pattern;return {max(n){max=n;return this;},regex(rx){pattern=rx;return this;},parse(value){return value.length<=max&&pattern.test(value);}};};
 const parser=vm.runInNewContext(expression,{f});assert.equal(parser.parse(thumbnail),true);assert.equal(parser.parse('https://files.tapnow.ai/demo/product-kit.webp'),false);
 const {prepareProductKit}=await import('../src/features/agent-apps/product-kit.mjs');assert.equal(prepareProductKit(demo).product.thumbnail_url,thumbnail);
 let mounted,connections=0;const startup=html.slice(html.indexOf('async function F_(){'),html.indexOf('as();F_();',html.indexOf('async function F_(){')));
 const context=vm.createContext({os:true,U_:demo,zm:data=>{mounted=data;},Ut:{connect:()=>{connections++;throw Error('standalone SDK connection');}}});
 await vm.runInContext(startup+';F_()',context);assert.equal(mounted,demo);assert.equal(connections,0);
 const imageStart=html.indexOf('function j_('),imageEnd=html.indexOf('}co',imageStart)+1;
 const render=vm.runInNewContext(html.slice(imageStart,imageEnd)+';j_',{document:{createElement:tag=>({tag})}});
 const image=render(mounted.product.thumbnail_url,mounted.product.name);assert.equal(image.tag,'img');assert.equal(image.src,thumbnail);
});
test('actual manifest loader accepts the derived SHA and retains bounded local thumbnail transport',async()=>{
 const productKitInteractions=await import('../src/features/agent-apps/product-kit-local-interactions.mjs');
 const fetched=[],errors=[];let complete;const done=new Promise(resolve=>{complete=resolve;}),inner={};Object.defineProperty(inner,'srcdoc',{set:html=>complete(html)});
 const context=vm.createContext({location:{pathname:'/src/features/agent-apps/resources/mcp-app-proxy.html'},inner,resourceLoaded:false,currentNonce:null,parentOrigin:'*',manifestPromise:null,stopProxyReadyAnnouncements(){},fetch:async url=>{fetched.push(url);const file=path.resolve(resources,url);assert.ok(file.startsWith(resources+path.sep));const data=fs.readFileSync(file,'utf8');return {ok:true,json:async()=>JSON.parse(data),text:async()=>data};},productKitInteractions,localizeProductKitTransport:localize,localizeEcommerceBilling:html=>html,localizePrevisBilling:html=>html,localizePlatformResizeBrand:html=>html,buildCspPolicy:()=>"connect-src 'none'; img-src data: blob:",buildSrcdocWithCsp:(html,policy)=>{assert.match(policy,/img-src data: blob:/);return html;},notifyParent:(_,params)=>{errors.push(params);complete(null);}});
 const a=proxy.indexOf('var RESOURCE_NAME_REGEX'),b=proxy.indexOf('// 注意: 本 proxy',a),c=proxy.indexOf('function handleResourceReady('),d=proxy.indexOf('window.addEventListener("message"',c);
 // Invoke the actual imported module in the extracted loader without requiring
 // experimental vm module flags; unrelated app transforms remain identity stubs.
 vm.runInContext((proxy.slice(a,b)+proxy.slice(c,d)).replace('await import("../product-kit-local-interactions.mjs")','productKitInteractions')+';handleResourceReady({nonce:"local-demo",resource:{name:"product-kit",version:"v1"}},"http://localhost:4173");',context);
 let timer;const rendered=await Promise.race([done,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('loader timeout')),1000);})]).finally(()=>clearTimeout(timer));
 assert.deepEqual(errors,[]);assert.deepEqual(fetched,['./apps/manifest.json','./apps/product-kit@v1.'+deriveProductKitDemo().metadata.derivedSha256.slice(0,8)+'.html']);
 assert.ok(rendered.includes(deriveProductKitDemo().thumbnail));assert.match(rendered,/thumbnail_url:f\(\)\.max\(500000\)/);assert.doesNotMatch(rendered,/files\.tapnow\.ai/);
 await assert.rejects(localize(deriveProductKitDemo().html+' ','product-kit','v1'),/integrity/);
});
