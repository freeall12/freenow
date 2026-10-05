import {open} from '../ui.mjs';
const fixture=window.VideoSegmentationFixture,app=window.CanvasApp,panel=document.createElement('aside'),title=document.createElement('strong'),note=document.createElement('p'),report=document.createElement('pre');panel.setAttribute('aria-label','SAM2 首次识别隔离验收');panel.style.cssText='position:fixed;left:80px;top:65px;z-index:80;background:#171717;color:white;padding:10px;font:12px sans-serif;max-width:365px;max-height:75vh;overflow:auto';panel.onpointerdown=event=>event.stopPropagation();title.textContent=fixture.native?'SAM2 真实本地任务链 · 合成供应商边界':'SAM2 前端故障验收 · 合成 DTO';note.textContent=fixture.native?'5秒/10fps公开合成视频，播放选段[1,4)，提示2.5秒。识别直连本机真实native服务，外部供应商传输由测试服务注入。':'8秒/30fps公开视频，播放选段[1,5)。此模式只模拟任务状态和移动RLE，不能证明实际SAM2分割质量。';panel.append(title,note);
const source=()=>app.getState().nodes.find(node=>node.id==='mask-source');
const action=(label,fn)=>{const button=document.createElement('button');button.type='button';button.textContent=label;button.onclick=()=>Promise.resolve().then(fn).catch(error=>{fixture.lastError=error.message;write();});panel.append(button);return button;};
const save=window.CanvasStore.save.bind(window.CanvasStore);window.CanvasStore.save=(snapshot,...args)=>{if(fixture.failMaskSave&&snapshot?.nodes?.some(node=>node.videoMask?.taskId))return Promise.reject(Error('QA 蒙层画布保存失败'));return save(snapshot,...args);};
action('打开生产物体移除',()=>{if(!fixture.mediaReady)throw Error('QA 实际视频正在保存，请稍候');return open(source(),'remove');});action('打开生产物体替换',()=>{if(!fixture.mediaReady)throw Error('QA 实际视频正在保存，请稍候');return open(source(),'replace');});action('切换蒙层保存失败',()=>fixture.failMaskSave=!fixture.failMaskSave);action('切换任务凭据保存失败',()=>fixture.failReceipt=!fixture.failReceipt);action('刷新页面恢复同一项目',()=>location.reload());
if(!fixture.native){action('下一次创建丢失响应',()=>fixture.loseCreate=true);action('切换模型版本',()=>fixture.changeVersion=!fixture.changeVersion);}
action('改变来源片段',()=>app.updateNode(source().id,{clip:source().clip?null:{start:1,end:fixture.native?4:5}}));action('撤销来源修改',()=>app.undo());action('创建并切换项目',()=>window.CanvasProjectsUI.create());
panel.append(report);document.body.append(panel);
function write(){let receipt;try{const key='freenow:video-segmentation:v1:'+encodeURIComponent(app.projectIdentity().id)+':mask-source';receipt=JSON.parse(window.localStorage.getItem(key)||'null');}catch{}report.textContent=JSON.stringify({native:fixture.native,ready:fixture.ready,mediaReady:fixture.mediaReady===true,sourceAsset:source()?.video??null,projectId:app.projectIdentity().id,posts:fixture.posts,gets:fixture.gets,resumes:fixture.resumes,cancels:fixture.cancels,failReceipt:fixture.failReceipt,failMaskSave:fixture.failMaskSave,blockedExternal:fixture.blockedExternal,blockedAPI:fixture.blockedAPI,receipt:receipt?{taskId:receipt.taskId,status:receipt.status,dispatched:receipt.dispatched,maskAsset:receipt.maskAsset}:null,mask:source()?.videoMask??null,lastError:fixture.lastError??null},null,2);}
if(fixture.ready){
  // Seed only an empty QA source after hydration. A persisted asset and its
  // mask are reused verbatim on reload; no placeholder URL enters history.
  try{
    for(let attempt=0;;attempt++){try{await app.saveProject();break;}catch(error){if(attempt>=199||!error.message.includes('尚未成功读取'))throw error;await new Promise(resolve=>setTimeout(resolve,25));}}
    const node=source(),projectId=app.projectIdentity().id;if(!node)throw Error('当前项目没有 QA 来源节点');
    if(typeof node.video==='string'&&node.video.startsWith('asset:'))await window.LocalAssets.url(node.video);
    else {
      if(node.video||node.videoMask)throw Error('QA 已有来源或蒙层不会被替换；旧 URL 会话请另起 session');
      const response=await fetch(fixture.native?'/qa/sam2-source.mp4':'/qa/trim-scenes.mp4');if(!response.ok)throw Error('QA 合成 MP4 读取失败');const blob=await response.blob();if(!blob.size||!blob.type.startsWith('video/'))throw Error('QA 来源没有实际视频字节');
      const asset=await window.LocalAssets.put(blob);if(app.projectIdentity().id!==projectId||!app.getState().nodes.includes(node)||node.video||node.videoMask)throw Error('QA 初始化期间来源已变化，未替换');app.updateNode(node.id,{video:asset});await app.saveProject();
    }
    fixture.mediaReady=true;
  }catch(error){fixture.lastError=error.message;fixture.mediaReady=false;}
}
const timer=setInterval(write,300);window.addEventListener('pagehide',()=>clearInterval(timer),{once:true});write();
