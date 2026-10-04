import {createMessageRenderer} from '../messages.mjs';
const mount=document.querySelector('#mount'),receipt=document.querySelector('#receipt');
let messages=[],renders=0;
let conversationDB;
function openConversations(){return conversationDB||(conversationDB=new Promise((resolve,reject)=>{const request=indexedDB.open('qa-agent-message-attachment-conversations-20261005',1);request.onupgradeneeded=()=>request.result.createObjectStore('conversations');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);}));}
async function saveMessages(){const db=await openConversations();await new Promise((resolve,reject)=>{const tx=db.transaction('conversations','readwrite');tx.objectStore('conversations').put(messages,'fixture');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});}
async function readMessages(){const db=await openConversations();return new Promise((resolve,reject)=>{const request=db.transaction('conversations').objectStore('conversations').get('fixture');request.onsuccess=()=>resolve(request.result||[]);request.onerror=()=>reject(request.error);});}
const renderer=createMessageRenderer({renderMarkdown:text=>text,onError:text=>receipt.textContent=text,onFeedback:()=>{},onFork:()=>{}});
function draw(){const old=mount.querySelector('video');renderer.reset();mount.replaceChildren(...messages.map((message,index)=>renderer.render(message,{key:'qa-attachments:'+index,index})));renders++;receipt.textContent=JSON.stringify({messages:messages.length,renders,sameVideo:old?old===mount.querySelector('video'):null,thumbnails:mount.querySelectorAll('.agent-message-attachment').length},null,2);}
document.querySelector('#prepare').onclick=async()=>{try{
 const [image,video]=await Promise.all(['/assets/agent-casting.png','/qa/trim-scenes.mp4'].map(async path=>{const response=await fetch(path);if(!response.ok)throw Error('夹具资源无法读取');return response.blob();}));
 const imageAsset=await window.LocalAssets.put(image),videoAsset=await window.LocalAssets.put(video);
 const uploads=[{id:'qa-image',asset:imageAsset,name:'真实本机图片.png',type:'image',mime:'image/png'},{id:'qa-video',asset:videoAsset,name:'真实本机视频.mp4',type:'video',mime:'video/mp4'},{id:'qa-missing',asset:'asset:qa-deliberately-missing',name:'缺失旧附件.png',type:'image',mime:'image/png'},{id:'qa-remote',asset:'https://files.tapnow.media/qa-blocked.png',name:'旧远程引用待导入.png',type:'image',mime:'image/png'},{id:'qa-unknown',asset:'data:application/pdf;base64,AA==',name:'未知旧附件.pdf',type:'file',mime:'application/pdf'}];
 messages=[{role:'user',sentAt:Date.now(),text:'发送后保留真实图片、视频及失败附件的归属。',uploads},{role:'user',text:'长附件行用于检查窄视口横向滚动。',uploads:[...uploads.slice(0,2),...Array.from({length:9},(_,i)=>({...uploads[0],id:'qa-image-'+i,name:'长中文附件名称用于检查第'+i+'项.png'}))]}];await saveMessages();draw();
 }catch(error){receipt.textContent=error.message;}};
document.querySelector('#rerender').onclick=draw;
document.querySelector('#restore').onclick=async()=>{try{messages=await readMessages();draw();}catch(error){receipt.textContent=error.message;}};
document.querySelector('#switch').onclick=()=>{messages=[];draw();};
window.addEventListener('pagehide',()=>renderer.destroy(),{once:true});
