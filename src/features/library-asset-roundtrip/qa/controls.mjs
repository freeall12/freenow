const app=window.CanvasApp,output=document.createElement('pre'),panel=document.createElement('aside');
panel.ariaLabel='素材往返验收';panel.style.cssText='position:fixed;right:12px;top:70px;width:360px;z-index:5000;padding:12px;background:#222;color:#eee;font:12px monospace;max-height:70vh;overflow:auto';output.ariaLabel='素材往返结果';output.style.whiteSpace='pre-wrap';
const note=document.createElement('p');note.textContent='隔离QA：固定本地测试素材，非模型生成。准备源→画布真实保存到素材库→空白右键添加资产→真实下载→刷新。';panel.append(note);
const session=new URLSearchParams(location.search).get('session')||'default',capacity=new URLSearchParams(location.search).get('capacity')==='1';
// QA receipts share no quota with the user's existing localStorage content.
const receiptDatabase=new Promise((resolve,reject)=>{
 const request=indexedDB.open('qa-library-roundtrip:'+encodeURIComponent(session)+':receipts',1);
 request.onupgradeneeded=()=>request.result.createObjectStore('records');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);request.onblocked=()=>reject(Error('QA收据数据库被旧页面阻塞，请关闭同session旧页面'));
});
async function receipt(mode,value){
 const db=await receiptDatabase;return new Promise((resolve,reject)=>{
  const transaction=db.transaction('records',mode),store=transaction.objectStore('records'),request=mode==='readonly'?store.get('baseline'):store.put(value,'baseline');let result;
  request.onsuccess=()=>{result=request.result;};transaction.oncomplete=()=>resolve(result);transaction.onabort=transaction.onerror=()=>reject(transaction.error||request.error||Error('QA收据存储失败'));
 });
}
let cachedBaseline,receiptWrites=Promise.resolve();const receiptsReady=receipt('readonly').then(value=>cachedBaseline=value);
async function saveBaseline(value){cachedBaseline=value;receiptWrites=receiptWrites.catch(()=>{}).then(()=>receipt('readwrite',value));await receiptWrites;}
const sha=async blob=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))).map(value=>value.toString(16).padStart(2,'0')).join('');
const bitmap=async blob=>{const image=await createImageBitmap(blob);const size={width:image.width,height:image.height};image.close();return size;};
function button(label,action){const b=document.createElement('button');b.textContent=label;b.onclick=async()=>{b.disabled=true;try{await action();}catch(error){output.textContent='失败：'+error.message;}finally{b.disabled=false;}};panel.append(b);return b;}
const blobOf=async source=>{const response=await fetch(await LocalAssets.url(source));if(!response.ok)throw Error('本地素材读取失败');return response.blob();};
async function baseline(){await receiptsReady;await receiptWrites;if(!cachedBaseline)throw Error('先准备测试源');return cachedBaseline;}
function report(value){const summary=JSON.parse(JSON.stringify(value,(_key,item)=>typeof item==='string'&&item.startsWith('data:')?item.slice(0,item.indexOf(',')+1)+'['+item.length+' characters]':item));output.textContent=JSON.stringify(summary,null,2);window.LIBRARY_ROUNDTRIP_QA_REPORT=summary;}
async function prepare(type){
 let media,preview,details,dimensions;
 if(type==='image'){
  const c=document.createElement('canvas');c.width=2048;c.height=1152;const ctx=c.getContext('2d');ctx.fillStyle='#55765d';ctx.fillRect(0,0,c.width,c.height);ctx.fillStyle='#d9c9a5';ctx.fillRect(120,120,1800,900);ctx.fillStyle='#3d493f';ctx.font='100px sans-serif';ctx.fillText('LOCAL ORIGINAL · 2048 × 1152',170,600);if(capacity){const pixels=ctx.createImageData(c.width,c.height);for(let offset=0;offset<pixels.data.length;offset+=65536)crypto.getRandomValues(pixels.data.subarray(offset,Math.min(offset+65536,pixels.data.length)));for(let offset=3;offset<pixels.data.length;offset+=4)pixels.data[offset]=255;ctx.putImageData(pixels,0,0);ctx.fillStyle='#111';ctx.fillRect(150,400,1748,260);ctx.fillStyle='#fff';ctx.fillText('LOCAL CAPACITY · 2048 × 1152',170,560);}media=await new Promise(resolve=>c.toBlob(resolve,'image/png'));
  const p=document.createElement('canvas');p.width=128;p.height=72;p.getContext('2d').drawImage(c,0,0,128,72);preview=await new Promise(resolve=>p.toBlob(resolve,'image/png'));details={pixelWidth:2048,pixelHeight:1152};dimensions={width:444.625,height:250.125};
 }else{
  media=await (await fetch('/src/features/video-history/qa/landscape.mp4')).blob();preview=await (await fetch('/src/features/video-history/qa/landscape.png')).blob();details={videoMetadata:{width:320,height:180,duration:4},clip:{start:.5,end:2.5}};dimensions={width:435.125,height:244.75};
 }
 const original=capacity&&type==='image'?await new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.readAsDataURL(media);}):await LocalAssets.put(media),thumb=await LocalAssets.put(preview),title=type==='image'?(capacity?'容量原图2048':'往返原图2048'):'往返裁切视频',patch={x:54015.125,y:-4155.375,...dimensions,...details,currentSourceFileId:'qa-local-'+type,provenance:{kind:'imported',mediaSource:original,model:null},editorDoc:{qaOnly:'should not follow asset'},agentImageEditor:{qaOnly:'source editor state'},...(type==='image'?{fullImage:original}:{video:original})};
 const node=app.addNode(type,{x:600,y:400},thumb,title,patch);app.fitNode(node.id,{duration:0});await app.saveProject();
 await receiptsReady;await saveBaseline({type,nodeId:node.id,node:structuredClone(node),original,thumbnail:thumb,originalSha:await sha(media),originalBytes:media.size});report({prepared:true,type,title,originalBytes:media.size,originalSha:await sha(media),originalPixelDimensions:type==='image'?await bitmap(media):{width:320,height:180},clip:details.clip||null,step:'使用实际画布工具栏「保存到素材库」，再关闭素材库，空白右键→添加资产→选择同名素材。'});
}
// Record actual production-picker activation before its real onclick inserts.
// Evidence persists across reload; canvas display is checked afresh each time.
const literalAssetImageErrors=[];
document.addEventListener('error',event=>{const image=event.target;if(image instanceof HTMLImageElement&&image.getAttribute('src')?.startsWith('asset:'))literalAssetImageErrors.push(image.getAttribute('src'));},true);
document.addEventListener('click',event=>{
 const selectedButton=event.target.closest?.('.command-assets-grid button'),image=selectedButton?.querySelector('img');if(!selectedButton||!image)return;
 const b=cachedBaseline;if(!b||selectedButton.getAttribute('aria-label')!==b.node.title)return;
 b.pickerEvidence={name:selectedButton.getAttribute('aria-label'),naturalWidth:image.naturalWidth,naturalHeight:image.naturalHeight,resolvedSource:image.currentSrc||image.src,literalAssetSource:!!image.getAttribute('src')?.startsWith('asset:')};void saveBaseline(b).catch(error=>{output.textContent='失败：'+error.message;});
},true);
async function check(){
 await CanvasLibrary.flush();await window.LibraryRoundtripQAStorage.flush();
 const b=await baseline(),state=app.getState(),source=state.nodes.find(n=>n.id===b.nodeId),saved=CanvasLibrary.items.filter(item=>item.nodeId===b.nodeId).at(-1),selected=state.nodes.find(n=>state.selected.includes(n.id)&&n.id!==b.nodeId)||state.nodes.find(n=>n.id===b.insertedNodeId);
 if(!saved)throw Error('先通过实际保存到素材库对话框保存');if(!selected)throw Error('先通过实际素材picker加入，并选择新节点');
 const fields=b.type==='image'?['image','fullImage','pixelWidth','pixelHeight','width','height','currentSourceFileId','provenance']:['image','video','videoMetadata','clip','width','height','currentSourceFileId','provenance'];
 const savedExact=fields.every(field=>JSON.stringify(saved[field])===JSON.stringify(b.node[field])),insertedExact=fields.every(field=>JSON.stringify(selected[field])===JSON.stringify(b.node[field])),sourceExact=source&&JSON.stringify(source)===JSON.stringify(b.node),noSourceDocuments=!['tool','editorDoc','agentImageEditor','pendingOperation','generationRun','worldResource'].some(field=>selected[field]!==undefined),sourceUrl=b.type==='image'?selected.fullImage:selected.video,blob=await blobOf(sourceUrl),actualSha=await sha(blob);
 const displayed=document.querySelector(`.node[data-id="${CSS.escape(selected.id)}"] .node-body img`),display={naturalWidth:displayed?.naturalWidth||0,naturalHeight:displayed?.naturalHeight||0,resolvedSource:displayed?.currentSrc||displayed?.src||'',literalAssetSource:!!displayed?.getAttribute('src')?.startsWith('asset:')},picker=b.pickerEvidence||null,pickerDecoded=!!picker&&picker.naturalWidth>0&&picker.naturalHeight>0&&!picker.literalAssetSource,canvasDecoded=display.naturalWidth>0&&display.naturalHeight>0&&!display.literalAssetSource&&(b.type!=='image'||display.naturalWidth===2048&&display.naturalHeight===1152);
 const durable=await CanvasStore.readRecord('agent-library:personal-v1');const authorityExact=durable?.items?.some(item=>JSON.stringify(item)===JSON.stringify(saved));
 const result={type:b.type,capacity,authorityExact,libraryWriteAttempts:window.LibraryRoundtripQAStorage.libraryWriteAttempts,picker,pickerDecoded,display,canvasDecoded,literalAssetImageErrors:[...literalAssetImageErrors],savedExact,insertedExact,sourceExact:!!sourceExact,noSourceDocuments,originalHashExact:actualSha===b.originalSha,insertedNodeId:selected.id,actualSourceBytes:blob.size,...(b.type==='image'?{decoded:await bitmap(blob)}:{clip:selected.clip,metadata:selected.videoMetadata})};
 result.passed=[authorityExact,window.LibraryRoundtripQAStorage.libraryWriteAttempts===0,(!capacity||b.type!=='image'||b.originalBytes>5*1024*1024),savedExact,insertedExact,sourceExact,noSourceDocuments,result.originalHashExact,pickerDecoded,canvasDecoded,literalAssetImageErrors.length===0].every(Boolean);if(result.passed){b.insertedNodeId=selected.id;await saveBaseline(b);}report(result);return {baseline:b,node:selected,result};
}
let releaseCapture;
button(capacity?'准备容量原图验收':'准备原图验收',()=>prepare('image'));button('准备视频裁切验收',()=>prepare('video'));button('核对保存 / picker / 刷新',check);
button('捕获下一次真实下载',async()=>{
 const {baseline:b,node}=await check();releaseCapture?.();const original=URL.createObjectURL;
 releaseCapture=()=>{if(URL.createObjectURL===capture)URL.createObjectURL=original;releaseCapture=null;};
 function capture(blob){const url=original.call(URL,blob);if(blob.type===(b.type==='image'?'image/png':'video/mp4')){releaseCapture();void inspect(blob);}return url;}
 async function inspect(blob){
  try{
   if(!app.getState().nodes.includes(node)||(b.type==='image'?node.fullImage:node.video)!==b.original)throw Error('下载期间选中结果已变化');
   if(b.type==='image'){const actualSha=await sha(blob);report({downloadCaptured:true,downloadHashExact:actualSha===b.originalSha,downloadBytes:blob.size,decoded:await bitmap(blob),expected:{width:2048,height:1152},passed:actualSha===b.originalSha});}
   else{const video=document.createElement('video'),url=original.call(URL,blob);try{await new Promise((resolve,reject)=>{video.onloadedmetadata=resolve;video.onerror=()=>reject(Error('导出视频解码失败'));video.src=url;});report({downloadCaptured:true,downloadBytes:blob.size,duration:video.duration,expectedDuration:2,decoded:{width:video.videoWidth,height:video.videoHeight},passed:Math.abs(video.duration-2)<.15&&video.videoWidth===320&&video.videoHeight===180});}finally{video.pause();video.removeAttribute('src');video.load();URL.revokeObjectURL(url);}}
  }catch(error){output.textContent='失败：'+error.message;}
 }
 URL.createObjectURL=capture;output.textContent='已准备：现在使用新节点真实工具栏的「下载」或「下载视频」。视频必须使用工具栏下载，触发已有本地trim导出。';
});
button('停止捕获',()=>{releaseCapture?.();output.textContent='已停止捕获';});window.addEventListener('pagehide',()=>releaseCapture?.());
panel.append(output);document.body.append(panel);receiptsReady.then(()=>report({ready:true,session,savedBaseline:!!cachedBaseline,receiptStorage:'isolated IndexedDB'})).catch(error=>{output.textContent='失败：'+error.message;});
window.addEventListener('pagehide',()=>{void receiptDatabase.then(db=>db.close()).catch(()=>{});});
