import {createWidgetCard} from '../cards.mjs';
import {whiteboxDownloadContent} from './whitebox-download-content.mjs';

const mount=document.querySelector('#mount'),status=document.querySelector('#host-status');
const downloads=[],readbacks=[],previewUrls=new Set();
let card,active=true;
const digest=async blob=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer())),byte=>byte.toString(16).padStart(2,'0')).join('');
const shortHash=hash=>typeof hash==='string'?hash.slice(0,12)+'…'+hash.slice(-8):'无 SHA';
function summaryList(selector,items,empty) {
  const list=document.querySelector(selector);
  list.replaceChildren(...(items.length?items:[empty]).map(text=>{const item=document.createElement('li');item.textContent=text;return item;}));
}
const renderEvidence=()=>{
  document.querySelector('#downloads').textContent=JSON.stringify(downloads,null,2);
  document.querySelector('#readback-results').textContent=JSON.stringify(readbacks,null,2);
  summaryList('#download-summary',downloads.map(item=>`${item.filename} · ${item.bytes} 字节 · ${item.mime} · SHA ${shortHash(item.sha256)} · 已请求下载，落盘另验`),'尚无下载请求');
  summaryList('#readback-summary',readbacks.map(item=>item.error?`${item.filename} · 回读失败：${item.error}`:`${item.filename} · ${item.width} × ${item.height}${item.duration!=null?' · '+item.duration.toFixed(6)+' 秒':item.mime?.startsWith('video/')?' · 元数据未给出有限时长':''} · SHA ${item.matchesDownloadRequest?'匹配':'未匹配请求'} ${shortHash(item.sha256)}`),'尚未显式回读文件');
};
function appendPreview(media,file,result) {
  const figure=document.createElement('figure'),caption=document.createElement('figcaption');
  caption.textContent=`${file.name} · ${result.width} × ${result.height}${result.duration!=null?' · '+result.duration.toFixed(6)+' 秒':media.tagName==='VIDEO'?' · 元数据未给出有限时长':''}`;
  figure.append(caption,media);document.querySelector('#preview').append(figure);
}
function rebuild() {
  active=false;card?.destroy();active=true;
  const trace={id:crypto.randomUUID(),name:'show_widget',status:'done',args:{title:'真实白模捕获 QA',widget_code:whiteboxDownloadContent()},result:{kind:'widget'}};
  card=createWidgetCard({trace,document,isCurrent:()=>active,
    onError:message=>{status.textContent=message;},
    onUploadMedia:()=>{throw Error('此独立 QA 仅验下载；真实画布添加与持久保存未配置、未验收');},
    onDownloadMedia:async(blob,filename,{isCurrent,signal})=>{
      if(signal.aborted||!isCurrent())throw Error('下载交接已失效');
      const sha256=await digest(blob);
      if(signal.aborted||!isCurrent())throw Error('下载交接已失效');
      window.LocalMedia.download(blob,filename);
      downloads.push({status:'download_requested',filename,mime:blob.type,bytes:blob.size,sha256,requestedAt:new Date().toISOString(),diskSaveVerified:false});
      renderEvidence();status.textContent='正式下载函数已调用；请保存实际文件并回读，不能以此记录代替落盘证据。';
    }});
  mount.replaceChildren(card.element);status.textContent='等待正式 sandbox 握手；卡片出现后直接点击捕获按钮。';
}
async function inspect(file) {
  const sha256=await digest(file),request=downloads.findLast(item=>item.sha256===sha256&&item.bytes===file.size);
  const result={filename:file.name,mime:file.type,bytes:file.size,sha256,matchesDownloadRequest:!!request,...(request?{requestedFilename:request.filename}:{}),absolutePathAvailable:false};
  const url=URL.createObjectURL(file);previewUrls.add(url);
  if(file.type==='image/png'||/\.png$/i.test(file.name)) {
    const bitmap=await createImageBitmap(file),canvas=document.createElement('canvas');
    canvas.width=bitmap.width;canvas.height=bitmap.height;const context=canvas.getContext('2d');context.drawImage(bitmap,0,0);bitmap.close();
    result.width=canvas.width;result.height=canvas.height;
    result.samplePixels=[[8,8],[8,160],[90,90],[260,50]].filter(([x,y])=>x<canvas.width&&y<canvas.height).map(([x,y])=>({x,y,rgba:[...context.getImageData(x,y,1,1).data]}));
    const image=document.createElement('img');image.src=url;image.alt='显式回读的实际下载 PNG';appendPreview(image,file,result);
  } else {
    const video=document.createElement('video');video.controls=true;video.preload='metadata';
    await new Promise((resolve,reject)=>{video.onloadedmetadata=resolve;video.onerror=()=>reject(Error('所选文件无法解码'));video.src=url;});
    result.width=video.videoWidth;result.height=video.videoHeight;result.duration=Number.isFinite(video.duration)?video.duration:null;
    video.onloadedmetadata=video.onerror=null;appendPreview(video,file,result);
  }
  return result;
}
document.querySelector('#reset').onclick=rebuild;
document.querySelector('#readback').onchange=async event=>{
  for(const file of event.target.files) {
    try{readbacks.push(await inspect(file));}catch(error){readbacks.push({filename:file.name,error:error.message});}
    renderEvidence();
  }
  event.target.value='';
};
window.addEventListener('pagehide',()=>{active=false;card?.destroy();for(const url of previewUrls)URL.revokeObjectURL(url);});
rebuild();
