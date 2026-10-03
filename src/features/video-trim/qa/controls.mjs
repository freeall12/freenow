import {open} from '../../../../video-trim-ui.mjs';
import {openVideoFrames} from '../../../../video-frames.mjs';

const app=window.CanvasApp,fixture=window.VideoTrimFixture;
const panel=document.createElement('aside');panel.setAttribute('aria-label','本机剪辑事务验收');panel.style.cssText='position:fixed;right:12px;bottom:12px;z-index:10000;width:360px;padding:12px;background:#171717;color:#eee;border:1px solid #555;font:13px sans-serif';
const heading=document.createElement('strong');heading.textContent='本机剪辑 · 保存与过期结果保护';
const output=document.createElement('pre');output.id='trim-transaction-results';output.style.cssText='white-space:pre-wrap;max-height:180px;overflow:auto;font:12px monospace';
const collapse=document.createElement('button');collapse.type='button';collapse.textContent='收起验收面板';collapse.setAttribute('aria-expanded','true');collapse.style.cssText='float:right;font-size:12px;padding:3px';
const content=document.createElement('div');content.append(output);panel.append(heading,collapse,content);document.body.append(panel);
collapse.onclick=()=>{content.hidden=!content.hidden;panel.style.width=content.hidden?'310px':'360px';collapse.textContent=content.hidden?'展开验收面板':'收起验收面板';collapse.setAttribute('aria-expanded',String(!content.hidden));};
let running=false;
const source=()=>app.getState().nodes.find(node=>node.id==='qa-trim-source');
const report=value=>{fixture.events.push(value);output.textContent=JSON.stringify(value,null,2);};
function action(label,run){
 const button=document.createElement('button');button.type='button';button.textContent=label;button.style.cssText='display:block;margin:8px 0;width:100%;padding:6px';content.insertBefore(button,output);
 button.onclick=async()=>{if(running)return;running=true;button.disabled=true;try{await run();}catch(error){report({ok:false,error:error.message});}finally{running=false;button.disabled=false;}};
}
async function editor(){
 if(!source())throw Error('本机来源节点不存在');app.select(source().id);app.setView({x:40,y:80,scale:1});
 const result=open(source());await result.ready;if(!result.loaded)throw Error('本机测试视频尚未解码');return result;
}
async function actualOutput(node){
 const reader=await openVideoFrames(await window.LocalAssets.url(node.video));
 try{await reader.at(0,64);return {id:node.id,duration:reader.duration,width:reader.width,height:reader.height};}finally{reader.dispose();}
}
action('打开本机剪辑选区',async()=>{await editor();report({status:'选区已打开，可手动确认或使用智能剪辑',processCount:fixture.processCount});});
action('验证真实剪辑并等待保存',async()=>{
 const trim=await editor(),before=fixture.processCount;await trim.exportRanges([{start:1,end:3}]);
 const receipt=trim.commit?.status();if(!receipt?.persisted)throw Error('剪辑保存尚未确认');const node=app.getState().nodes.find(node=>node.id===receipt.nodeIds[0]);
 const media=await actualOutput(node);report({ok:Math.abs(media.duration-2)<.1,status:'实际视频已解码且保存确认；刷新后可回读',processCalls:fixture.processCount-before,media,externalAttempts:fixture.externalAttempts.length});
});
action('注入保存失败，保留结果后手动重试',async()=>{
 const trim=await editor(),save=app.saveProject,before=fixture.processCount;app.saveProject=async()=>{throw Error('QA 注入保存回执失败');};
 try{await trim.exportRanges([{start:4,end:6}]);}finally{app.saveProject=save;}
 const receipt=trim.commit?.status();if(!receipt?.applied||receipt.persisted)throw Error('没有得到准确的保存失败收据');
 report({ok:true,status:'结果已加入；点击画面中的「重试保存剪辑结果」。重试应只保存',processCalls:fixture.processCount-before,nodeIds:receipt.nodeIds});
 fixture.failedEditor=trim;
});
action('读取保存重试结果并解码视频',async()=>{
 const trim=fixture.failedEditor,receipt=trim?.commit?.status();if(!receipt?.persisted)throw Error('请先点击「重试保存剪辑结果」');
 const media=await actualOutput(app.getState().nodes.find(node=>node.id===receipt.nodeIds[0]));report({ok:Math.abs(media.duration-2)<.1,status:'重试成功，视频仍为原结果',processCount:fixture.processCount,media});
});
action('验证后台剪辑拒绝撤销重建的同 ID 来源',async()=>{
 const trim=await editor(),original=source(),before=app.getState().nodes.length,processBefore=fixture.processCount;
 const serialize=window.LocalMedia.asDataUrl;let release,started;const gate=new Promise(resolve=>{release=resolve;}),waiting=new Promise(resolve=>{started=resolve;});
 window.LocalMedia.asDataUrl=async blob=>{started();await gate;return serialize(blob);};
 const pending=trim.exportRanges([{start:1,end:3}]);
 try{
  const began=await Promise.race([waiting.then(()=>true),pending.then(()=>false)]);if(!began)throw Error('实际媒体裁剪未进入输出序列化阶段');
  trim.close();app.remove([original.id]);app.undo();release();await pending;
  const replaced=source()!==original,after=app.getState().nodes.length;
  report({ok:replaced&&after===before,status:'真实撤销重建来源后，迟到输出被拒绝',sameNodeId:source().id===original.id,newObjectIdentity:replaced,nodeCountBefore:before,nodeCountAfter:after,processCalls:fixture.processCount-processBefore});
 }finally{release();window.LocalMedia.asDataUrl=serialize;}
});
action('读取已保存剪辑（可先刷新页面）',async()=>{
 const nodes=app.getState().nodes.filter(node=>node.type==='video'&&node.id!=='qa-trim-source'),media=[];for(const node of nodes)media.push(await actualOutput(node));
 report({ok:media.length>0,status:'当前隔离画布结果读取',media,projectId:app.projectIdentity().id,externalAttempts:fixture.externalAttempts.length});
});
report({status:'使用本机红蓝测试视频与生产剪辑控制器；媒体处理仅访问本机 FFmpeg',projectId:fixture.projectId});
