import {createStore} from '../store.mjs';
import {createPanel} from '../panel.mjs';
const session=new URLSearchParams(location.search).get('session')||'default';
if(!/^[a-zA-Z0-9_-]{1,80}$/.test(session))throw Error('验收 session 仅接受 1–80 位字母、数字、下划线或连字符');
const namespace='freenow-qa-artifact-local-export-'+session;
// Keep every fixture asset and document out of the user's actual libraries.
window.LOCAL_ASSETS_DB_NAME=namespace+'-assets';
const store=createStore({namespace}),path='artifacts/离线互动.html',status=document.getElementById('status'),source=document.getElementById('source');
let selectedPath=path;
function delay(signal) {return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{signal.removeEventListener('abort',cancel);resolve();},3000);function cancel(){clearTimeout(timer);reject(signal.reason||Error('已取消'));}signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)cancel();});}
const panel=createPanel({store,onError:message=>{status.textContent=message;},getHtmlResourceOptions:async signal=>{if(document.getElementById('delay').checked)await delay(signal);return {assets:window.LocalAssets,fetchImpl:(url,options)=>{if(!String(url).startsWith('blob:'))throw Error('验收资源只允许读取本页本地 Blob');return fetch(url,options);}};},onAdd:()=>{throw Error('此验收页仅验证作品预览与导出');},onDiscuss:()=>{throw Error('本页未连接模型对话');}});
async function showSource() {
  const files=await store.list();document.getElementById('preview').disabled=!files.some(file=>file.artifact_path===selectedPath);
  if(!files.some(file=>file.artifact_path===selectedPath)){source.textContent='专用产物存储为空。请保存验收作品。';return;}
  const file=await store.get(selectedPath);source.textContent=`${file.artifact_path} · revision ${file.revision}\n${file.content}`;
}
async function write(content,title) {
  let revision=0;try{revision=(await store.get(path)).revision;}catch{}
  await store.write({artifact_path:path,content_type:'html',content,title,expected_revision:revision});selectedPath=path;await showSource();status.textContent='实际原文已提交专用IndexedDB；可预览、下载并刷新核对。';
}
const known=document.getElementById('known');known.onclick=async()=>{
  known.disabled=true;
  try {
    const svg='<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#d47a42"/><circle cx="160" cy="90" r="48" fill="#184c3d"/><text x="160" y="100" text-anchor="middle" font-size="24" fill="white">本地素材</text></svg>';
    const asset=await window.LocalAssets.put(new Blob([svg],{type:'image/svg+xml'}));
    await write('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>body{margin:24px;background:#f1eee7;color:#24372b;font:18px system-ui}img{display:block;width:min(100%,320px)}button{padding:12px;margin:12px 8px 0 0}</style></head><body><h1>本地互动作品</h1><img src="'+asset+'" alt="实际本地素材"><button id="count">计数 0</button><button id="navigate">尝试原站导航（应被阻止）</button><script>let n=0;document.getElementById("count").onclick=()=>{document.getElementById("count").textContent="计数 "+(++n)};document.getElementById("navigate").onclick=()=>{window.location.href="https://tapnow.media/offline-navigation-test"};</script></body></html>','本地互动作品');
  }catch(error){status.textContent=error.message;}finally{known.disabled=false;}
};
document.getElementById('unknown').onclick=async()=>{try{await write('<!doctype html><h1>未知资源不能宣称导出完成</h1><img src="https://files.tapnow.art/not-captured-offline-qa.png">','待修复作品');}catch(error){status.textContent=error.message;}};
document.getElementById('panel').onclick=()=>panel.open();
document.getElementById('preview').onclick=async()=>{panel.open();await panel.select(selectedPath);};
document.getElementById('replace').onclick=async()=>{try{const file=await store.get(path);await write(file.content.replace('本地互动作品','本地互动作品 · 新版本'),file.title+' · 新版本');}catch(error){status.textContent=error.message;}};
store.subscribe(()=>{void showSource().catch(error=>{status.textContent=error.message;});});
try{await showSource();for(const id of ['known','unknown','panel','replace'])document.getElementById(id).disabled=false;status.textContent='专用产物存储已就绪；原文不会被资源转换覆盖。';}catch(error){status.textContent='验收页未就绪：'+error.message;}
