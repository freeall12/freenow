'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),http=require('node:http'),{execFileSync}=require('node:child_process'),{processMedia}=require('../server/media.cjs');
let server,base,dispatches=0;const sourceBytes=fs.readFileSync(require.resolve('../src/features/video-history/qa/landscape.mp4'));
test.before(async()=>{
 server=http.createServer(async(req,res)=>{const url=new URL(req.url,'http://localhost');if(url.pathname!=='/api/media/trim'){res.writeHead(404);res.end('missing');return;}dispatches++;try{await processMedia(req,res,'trim',url.searchParams);}catch(error){res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:error.message}));}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base='http://127.0.0.1:'+server.address().port;
});
test.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
function mediaDatabase(){const values=new Map();return {open(){const request={};queueMicrotask(()=>{request.result={createObjectStore(){},transaction(){const tx={};tx.objectStore=()=>({put(blob,id){values.set(id,blob);queueMicrotask(()=>tx.oncomplete?.());},get(id){const get={};queueMicrotask(()=>{get.result=values.get(id);get.onsuccess?.();});return get;}});return tx;}};request.onupgradeneeded?.();request.onsuccess?.();});return request;}};}
async function fixture(){
 const policy=await import('../src/features/local-resource-migration/display-media.mjs'),created=[],downloads=[],reads=[],notices=[];let project='qa',afterProcess=()=>{},afterRead=()=>{};
 const node={id:'video',type:'video',title:'真实本地视频',clip:{start:.5,end:2.5},image:'poster.png',width:435.125,height:244.75},nodes=[node],app={getState:()=>({nodes}),projectIdentity:()=>({id:project}),createConnected(id,items){created.push({id,items});return [{id:'exported',...items[0]}];}};
 const window={CanvasApp:app,CanvasResourceDisplayReady:Promise.resolve(policy),EDITOR_DATA:{nodes:{}}};
 class FileReader{readAsDataURL(blob){void blob.arrayBuffer().then(buffer=>{this.result='data:'+blob.type+';base64,'+Buffer.from(buffer).toString('base64');afterRead();this.onload();},error=>this.onerror(error));}}
 const fetchLocal=async(url,options)=>{reads.push(url);const response=await fetch(url.startsWith('/')?base+url:url,options);if(url.startsWith('/api/media/trim'))afterProcess();return response;};
 const context=vm.createContext({window,indexedDB:mediaDatabase(),crypto:require('node:crypto').webcrypto,URL,URLSearchParams,fetch:fetchLocal,FileReader,structuredClone,setTimeout,document:{}});
 vm.runInContext(fs.readFileSync(require.resolve('../local-assets.js'),'utf8'),context);node.video=await window.LocalAssets.put(new Blob([sourceBytes],{type:'video/mp4'}));
 vm.runInContext(fs.readFileSync(require.resolve('../media-tools.js'),'utf8'),context);
 const close=async()=>URL.revokeObjectURL(await window.LocalAssets.url(node.video).catch(()=>''));
 return {policy,window,context,node,nodes,app,created,downloads,notices,reads,close,changeProject:()=>project='other',afterProcess:fn=>afterProcess=fn,afterRead:fn=>afterRead=fn};
}
test('actual asset Blob resolves through real LocalAssets and production FFmpeg returns a decoded two-second export',async()=>{
 const f=await fixture(),before=structuredClone(f.node),result=await f.window.LocalMedia.trim(f.node);
 assert.equal(f.reads[0].startsWith('blob:'),true);assert.ok(f.reads.every(url=>!url.startsWith('asset:')));assert.equal(f.created.length,1);assert.deepEqual(f.node,before);assert.equal(result.blob.type,'video/mp4');
 const bytes=Buffer.from(await result.blob.arrayBuffer()),probe=JSON.parse(execFileSync('ffprobe',['-v','error','-show_entries','format=duration:stream=width,height','-of','json','-i','pipe:0'],{input:bytes,encoding:'utf8'}));
 assert.equal(probe.streams[0].width,320);assert.equal(probe.streams[0].height,180);assert.ok(Math.abs(Number(probe.format.duration)-2)<.15);assert.equal(f.created[0].items[0].video,'data:video/mp4;base64,'+bytes.toString('base64'));await f.close();
});
test('source HTTP 404 never dispatches the media API or creates an export',async()=>{
 const f=await fixture(),before=dispatches;f.window.LocalAssets.url=async()=>base+'/missing';await assert.rejects(f.window.LocalMedia.trim(f.node),/读取失败（404）/);assert.equal(dispatches,before);assert.equal(f.created.length,0);
});
test('display gate rejects original source or original resolver output before any fetch',async()=>{
 const f=await fixture();f.node.video='https://files.tapnow.media/retained.mp4';await assert.rejects(f.window.LocalMedia.trim(f.node),/原站资源/);assert.equal(f.reads.length,0);f.node.video='asset:redirect';f.window.LocalAssets.url=async()=> 'https://files.tapnow.media/retained.mp4';await assert.rejects(f.window.LocalMedia.trim(f.node),/原站资源/);assert.equal(f.reads.length,0);assert.equal(f.created.length,0);
});
for(const change of ['source','clip','project','replacement'])test(`pending local source resolution rejects ${change} before API dispatch`,async()=>{
 const f=await fixture(),resolver=f.window.LocalAssets.url;let release;f.window.LocalAssets.url=async ref=>{await new Promise(resolve=>release=resolve);return resolver(ref);};const before=dispatches,pending=f.window.LocalMedia.trim(f.node);while(!release)await Promise.resolve();
 if(change==='source')f.node.video='asset:replacement';if(change==='clip')f.node.clip.end=3;if(change==='project')f.changeProject();if(change==='replacement')f.nodes[0]={...f.node};release();await assert.rejects(pending,/已变化/);assert.equal(dispatches,before);assert.equal(f.created.length,0);
});
for(const phase of ['process','decode'])test(`project or source changes during real ${phase} rejects late exported node`,async()=>{
 const f=await fixture();if(phase==='process')f.afterProcess(f.changeProject);else f.afterRead(()=>f.node.clip.end=3);await assert.rejects(f.window.LocalMedia.trim(f.node),/已变化/);assert.equal(f.created.length,0);
});
for(const change of ['project','type'])test(`actual toolbar rechecks ${change} after trim returns before creating any download`,async()=>{
 const f=await fixture(),trim=f.window.LocalMedia.trim;f.window.LocalMedia.trim=async n=>{const result=await trim(n);if(change==='project')f.changeProject();else n.type='image';return result;};f.window.LocalMedia.download=(...args)=>f.downloads.push(args);
 Object.assign(f.context,{app:f.app,mediaDisplayReady:Promise.resolve(f.policy),source:n=>n.video,unavailableMedia:'原站资源已停用',notify:message=>f.notices.push(message)});
 const source=fs.readFileSync(require.resolve('../src/features/video-tools/entry.js'),'utf8'),start=source.indexOf('  async function downloadVideo('),end=source.indexOf('\n  async function extend(',start);vm.runInContext(source.slice(start,end)+';globalThis.downloadForTest=downloadVideo;',f.context);await f.context.downloadForTest(f.node);assert.equal(f.downloads.length,0);assert.match(f.notices.at(-1),/已变化/);
});
