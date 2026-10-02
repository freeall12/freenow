import {initialRange,constrainRange,moveRange,resizeRange,pointerTime,keyboardRange,frameSignature,cutDistance,segmentsFromCuts} from './video-trim-core.mjs';
import {openVideoFrames} from './video-frames.mjs';
const app=window.CanvasApp, $=(q,root=document)=>root.querySelector(q), make=(tag,cls,text)=>{const e=document.createElement(tag);e.className=cls||'';if(text!==undefined)e.textContent=text;return e;};
const icons=window.CANVAS_MENU_ICONS, source=n=>n.video||window.EDITOR_DATA?.nodes[n.id]?.video;
const shortcuts=[['Arrow Left / Arrow Right','移动选区'],['Arrow Left / Arrow Right','扩展/收缩选区'],['Shift + Arrow Left / Arrow Right','精确微调 (0.01s)'],['Ctrl/Cmd + Arrow Left / Arrow Right','快速调整 (1s)'],['I / O','设置入点/出点'],['Enter','确认剪辑'],['Esc','取消'],['Space','播放/暂停预览'],['Hold Shift','精确模式（禁用吸附）']];
let current;
const button=(label,icon,fn,cls='')=>{const b=make('button',cls);b.type='button';b.setAttribute('aria-label',label);b.title=label;b.innerHTML=icons[icon]||'';b.onclick=fn;return b;};
class TrimEditor {
  constructor(node){
    this.id=node.id;this.src=source(node);this.sourceClip=JSON.stringify(node.clip||null);this.base=node.clip?.start||0;this.node=node;this.visible=true;this.busy=false;this.alive=true;
    this.listeners=new AbortController();this.decodeController=new AbortController();this.range={start:0,end:0};this.duration=0;
    this.root=make('section','video-trim-editor');this.root.tabIndex=0;this.root.setAttribute('aria-label','视频剪辑选区');
    this.exit=button('退出剪辑','trimExit',()=>this.close(),'video-trim-exit');this.confirm=button('确认裁剪','trimConfirm',()=>this.exportRanges([this.range]),'video-trim-confirm');this.confirm.disabled=true;
    this.track=make('div','video-trim-track');this.track.setAttribute('aria-label','视频缩略图时间轴');this.film=make('div','video-trim-film');this.selection=make('div','video-trim-selection');this.selection.tabIndex=0;this.selection.setAttribute('aria-label','移动选区');
    this.leftShade=make('div','video-trim-shade left');this.rightShade=make('div','video-trim-shade right');this.durationLabel=make('output','video-trim-duration','加载中…');this.playhead=make('div','video-trim-playhead');this.hoverTime=make('output','video-trim-hover');this.hoverTime.hidden=true;
    this.handles={};for(const edge of ['start','end']){const handle=make('div','video-trim-handle '+edge);handle.tabIndex=0;handle.setAttribute('role','slider');handle.setAttribute('aria-label',edge==='start'?'裁剪入点':'裁剪出点');handle.setAttribute('aria-valuemin','0');handle.append(make('i'));this.handles[edge]=handle;}
    this.track.append(this.film,this.selection,this.leftShade,this.rightShade,this.durationLabel,this.handles.start,this.handles.end,this.playhead,this.hoverTime);
    const footer=make('div','video-trim-footer');this.hint=button('点击查看完整快捷键列表','trimKeyboard',()=>this.showHelp(),'video-trim-hint');this.hintText=make('span');this.hint.prepend(this.hintText);this.smart=button('智能剪辑','trimSmart',()=>this.analyze(),'video-trim-smart');this.smart.append('智能剪辑');this.smart.title='自动检测镜头切换';this.smart.disabled=true;footer.append(this.hint,this.smart);
    this.status=make('div','video-trim-status');this.status.setAttribute('role','status');this.status.hidden=true;this.root.append(this.exit,this.track,this.confirm,footer,this.status);document.body.append(this.root);document.body.classList.add('video-trimming');
    this.video=$(`.node[data-id="${this.id}"] .node-video`);if(!this.video)throw Error('视频播放器尚未就绪');this.video.pause();this.originalControls=this.video.controls;this.video.controls=false;
    this.controls=make('div','video-trim-player');this.play=button('播放预览','trimPlay',()=>this.togglePlay());this.time=make('output');const fullscreen=button('全屏预览','playerFullscreen',()=>this.video.requestFullscreen?.());this.controls.append(this.play,this.time,fullscreen);this.video.parentElement.append(this.controls);
    const opts={signal:this.listeners.signal};this.root.addEventListener('pointerdown',e=>e.stopPropagation(),opts);this.root.addEventListener('click',e=>e.stopPropagation(),opts);this.root.addEventListener('dblclick',e=>e.stopPropagation(),opts);
    for(const [part,element]of [['middle',this.selection],...Object.entries(this.handles)])element.onpointerdown=e=>this.dragStart(e,part);
    this.track.onpointermove=e=>{if(!this.duration||this.drag)return;this.hoverTime.hidden=false;const x=Math.max(0,Math.min(this.track.clientWidth,e.clientX-this.track.getBoundingClientRect().left));this.hoverTime.style.left=x+'px';this.hoverTime.textContent=(x/this.track.clientWidth*this.duration).toFixed(2)+'s';};this.track.onpointerleave=()=>this.hoverTime.hidden=true;
    this.track.onpointerdown=e=>{if(e.target!==this.track&&e.target!==this.film&&!e.target.closest('.video-trim-film'))return;if(!this.busy&&this.duration)this.seek(pointerTime(e.clientX-this.track.getBoundingClientRect().left,this.track.clientWidth,this.duration,e.shiftKey));};
    document.addEventListener('keydown',e=>this.key(e),{...opts,capture:true});document.addEventListener('keyup',e=>{if(e.key==='Shift')this.root.classList.remove('is-precise');},opts);
    document.addEventListener('pointerdown',e=>{if(!e.target.closest('.video-trim-editor,.video-trim-help,.video-trim-player,.video-trim-job')&&!e.target.closest(`.node[data-id="${this.id}"]`))this.close();},opts);
    document.addEventListener('canvas:render',()=>{const n=app.getState().nodes.find(n=>n.id===this.id);if(!n||source(n)!==this.src||JSON.stringify(n.clip||null)!==this.sourceClip){this.cancel();return;}if(this.visible&&!app.getState().selected.includes(this.id)){this.close();return;}this.place();},opts);window.addEventListener('resize',()=>this.place(),opts);
    this.video.addEventListener('timeupdate',()=>this.tick(),opts);this.video.addEventListener('play',()=>this.tick(),opts);this.video.addEventListener('pause',()=>this.tick(),opts);
    this.hintIndex=0;this.paintHint();this.hintTimer=setInterval(()=>{this.hint.classList.add('changing');this.hintDelay=setTimeout(()=>{this.hintIndex=(this.hintIndex+1)%shortcuts.length;this.paintHint();this.hint.classList.remove('changing');},300);},4000);
    this.place();this.root.focus({preventScroll:true});this.ready=this.load().catch(e=>{if(e.name!=='AbortError')this.error(e.message);});
  }
  async load(){
    const url=await window.LocalAssets.url(this.src);this.reader=await openVideoFrames(url,this.decodeController.signal);if(!this.alive){this.reader.dispose();return;}
    this.duration=Math.max(0,Math.min(this.node.clip?.end??this.reader.duration,this.reader.duration)-this.base);if(!Number.isFinite(this.duration)||this.duration<=0)throw Error('无效的视频时长');
    this.range=initialRange(this.duration);this.fit();this.paint();this.seek(this.range.start);
    const tiles=[];for(let i=0;i<10;i++){const frame=await this.reader.at(this.base+this.duration*i/10,160);if(!this.alive)return;const tile=make('div');tile.style.backgroundImage=`url("${frame.toDataURL('image/jpeg',.7)}")`;tiles.push(tile);this.film.append(tile);}
    this.loaded=true;this.confirm.disabled=this.duration<1;this.smart.disabled=false;this.paint();
  }
  fit(){
    const canvas=$('#canvas').getBoundingClientRect(),n=this.node;const scale=Math.min((canvas.width-144)/n.width,(innerHeight-380)/n.height,2);
    if(scale<=0)return;const availableHeight=innerHeight-280,top=80+Math.max(0,(availableHeight-(n.height*scale+100))/2);
    app.setView({x:canvas.width/2-(n.x+n.width/2)*scale,y:top-n.y*scale,scale});
  }
  place(){if(!this.visible)return;const state=app.getState(),n=state.nodes.find(n=>n.id===this.id);if(!n)return;const canvas=$('#canvas').getBoundingClientRect(),width=Math.min(Math.max(n.width*state.view.scale,480),n.width<n.height?800:640,canvas.width-24);this.root.style.width=width+'px';this.root.style.left=Math.max(12,Math.min(canvas.right-width-12,canvas.left+(n.x+n.width/2)*state.view.scale+state.view.x-width/2))+'px';this.root.style.top=Math.max(80,Math.min(innerHeight-100,n.y*state.view.scale+state.view.y+n.height*state.view.scale+36))+'px';}
  paintHint(){const [key,text]=shortcuts[this.hintIndex];this.hintText.replaceChildren(make('kbd','',key),make('span','',text));}
  paint(){
    const a=this.duration?this.range.start/this.duration*100:0,b=this.duration?this.range.end/this.duration*100:100;
    this.selection.style.left=a+'%';this.selection.style.right=(100-b)+'%';this.leftShade.style.width=a+'%';this.rightShade.style.left=b+'%';this.handles.start.style.left=`clamp(0px, ${a}% - 16px, 100% - 20px)`;this.handles.end.style.left=`clamp(0px, ${b}% - 4px, 100% - 20px)`;this.durationLabel.style.left=(a+b)/2+'%';this.durationLabel.textContent=(this.range.end-this.range.start).toFixed(2)+'s';
    this.root.dataset.start=this.range.start;this.root.dataset.end=this.range.end;this.root.dataset.duration=this.duration;
    for(const [edge,h]of Object.entries(this.handles)){h.setAttribute('aria-valuemax',this.duration);h.setAttribute('aria-valuenow',this.range[edge]);h.setAttribute('aria-valuetext',this.range[edge].toFixed(2)+'秒');}
    this.tick();
  }
  setRange(range,seek=true){if(this.busy)return;this.range=constrainRange(this.duration,range.start,range.end);this.paint();if(seek)this.seek(this.range.start);}
  seek(time){if(!Number.isFinite(time))return;this.video.currentTime=this.base+Math.max(0,Math.min(this.duration,time));this.tick();}
  tick(){const time=Math.max(0,this.video.currentTime-this.base);if(!this.video.paused&&!this.drag&&(time>=this.range.end-.02||time<this.range.start-.02)){this.seek(this.range.start);return;}this.playhead.style.left=Math.min(100,time/Math.max(.001,this.duration)*100)+'%';this.time.textContent=time.toFixed(1)+'s / '+this.duration.toFixed(1)+'s';this.play.innerHTML=icons[this.video.paused?'playerPlay':'playerPause'];this.play.setAttribute('aria-label',this.video.paused?'播放预览':'暂停预览');}
  togglePlay(){if(!this.duration||this.busy)return;if(!this.video.paused)this.video.pause();else{const t=this.video.currentTime-this.base;if(t<this.range.start||t>=this.range.end-.02)this.seek(this.range.start);this.video.play().catch(e=>this.error(e.message));}}
  dragStart(e,part){
    if(e.button!==0||this.busy||!this.duration)return;e.preventDefault();e.stopPropagation();this.video.pause();this.root.focus({preventScroll:true});const target=e.currentTarget;target.setPointerCapture(e.pointerId);this.drag={part,x:e.clientX,y:e.clientY,range:{...this.range},moved:false};this.root.classList.add('is-dragging');
    const move=event=>{const drag=this.drag;if(!drag)return;if(!drag.moved&&Math.hypot(event.clientX-drag.x,event.clientY-drag.y)<5)return;drag.moved=true;const r=this.track.getBoundingClientRect(),time=pointerTime(event.clientX-r.left,r.width,this.duration,event.shiftKey);this.range=part==='middle'?moveRange(drag.range,time-(drag.range.end-drag.range.start)/2-drag.range.start,this.duration):resizeRange(this.range,part,time,this.duration);this.paint();};
    const end=event=>{if(!this.drag)return;const drag=this.drag;this.drag=null;if(event.type==='pointercancel')this.range=drag.range;else if(!drag.moved&&part==='middle'){const r=this.track.getBoundingClientRect();this.seek(pointerTime(event.clientX-r.left,r.width,this.duration,event.shiftKey));}else this.seek(this.range.start);this.root.classList.remove('is-dragging');this.paint();target.removeEventListener('pointermove',move);target.removeEventListener('pointerup',end);target.removeEventListener('pointercancel',end);if(target.hasPointerCapture(e.pointerId))target.releasePointerCapture(e.pointerId);};
    target.addEventListener('pointermove',move);target.addEventListener('pointerup',end);target.addEventListener('pointercancel',end);
  }
  key(e){
    if(!this.visible||e.target.closest('input,textarea,[contenteditable]'))return;
    if(this.help){if(e.key==='Tab'){e.preventDefault();e.stopImmediatePropagation();this.help.querySelector('button').focus();return;}if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();this.closeHelp();}return;}
    if(e.key==='Shift')this.root.classList.add('is-precise');
    if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','i','I','o','O','Enter','Escape',' '].includes(e.key))return;e.preventDefault();e.stopImmediatePropagation();
    if(e.key==='Escape'){this.close();return;}if(this.busy||!this.loaded)return;
    if(e.key==='Enter'){this.exportRanges([this.range]);return;}if(e.key===' '){this.togglePlay();return;}
    this.setRange(keyboardRange(this.range,e.key,{shiftKey:e.shiftKey,ctrlKey:e.ctrlKey,metaKey:e.metaKey,time:this.video.currentTime-this.base,duration:this.duration}));
  }
  closeHelp(restoreFocus=true){if(!this.help)return;this.help.close();this.help.remove();this.help=null;if(restoreFocus&&this.visible)this.hint.focus({preventScroll:true});}
  showHelp(){
    if(this.help){this.closeHelp();return;}
    this.help=make('dialog','video-trim-help');this.help.setAttribute('aria-label','键盘快捷键');
    const heading=make('h2','','键盘快捷键'),icon=make('span');icon.innerHTML=icons.trimKeyboard;heading.prepend(icon);this.help.append(heading);
    const grid=make('div','video-trim-shortcuts');for(const [key,text]of shortcuts){const row=make('div');row.append(make('kbd','',key),make('span','',text));grid.append(row);}this.help.append(grid);
    this.help.append(button('关闭快捷键','trimExit',()=>this.closeHelp()));
    this.help.addEventListener('cancel',e=>{e.preventDefault();this.closeHelp();});
    this.help.addEventListener('click',e=>{if(e.target!==this.help)return;const r=this.help.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)this.closeHelp();});
    document.body.append(this.help);this.help.showModal();this.help.querySelector('button').focus();
  }
  error(message){if(!this.alive)return;this.status.hidden=false;this.status.textContent=message;}
  assertSource(){const n=app.getState().nodes.find(n=>n.id===this.id);if(!n||source(n)!==this.src||JSON.stringify(n.clip||null)!==this.sourceClip)throw Error('来源视频已变化，请重新剪辑');return n;}
  progress(text){if(this.visible){this.status.hidden=false;this.status.textContent=text;}if(this.jobLabel)this.jobLabel.textContent=text;}
  beginJob(){this.busy=true;this.video.pause();this.confirm.disabled=this.smart.disabled=true;this.confirm.innerHTML=icons.trimLoading;this.confirm.classList.add('is-loading');this.jobController=new AbortController();this.job=make('section','video-trim-job');this.jobLabel=make('span','','正在处理…');this.job.append(this.jobLabel,button('停止视频处理','trimExit',()=>this.cancel()));document.body.append(this.job);}
  endJob(){this.busy=false;this.job?.remove();this.confirm.classList.remove('is-loading');this.confirm.innerHTML=icons.trimConfirm;this.confirm.disabled=!this.loaded||this.duration<1;this.smart.disabled=!this.loaded;}
  async inputBlob(){const url=await window.LocalAssets.url(this.src),response=await fetch(url,{signal:this.jobController.signal});if(!response.ok)throw Error('视频读取失败');const blob=await response.blob();if(blob.size>80*1024*1024)throw Error('本地剪辑暂支持不超过 80 MB 的视频');return blob;}
  async buildOutputs(ranges,blob,reader){const outputs=[];for(const [i,range]of ranges.entries()){this.assertSource();this.progress(`正在处理 ${i+1}/${ranges.length}…`);const result=await window.LocalMedia.process('trim',blob,{start:this.base+range.start,end:this.base+range.end,signal:this.jobController.signal});const frame=await reader.at(this.base+range.start,320);outputs.push({type:'video',title:`剪辑结果 (${(range.end-range.start).toFixed(2)}s)`,video:await window.LocalMedia.asDataUrl(result),image:frame.toDataURL('image/jpeg',.85),width:this.node.width,height:this.node.height,originalVideo:this.src,clipParams:{start:this.base+range.start,end:this.base+range.end}});}return outputs;}
  async exportRanges(ranges){if(this.busy||!this.loaded||ranges.some(r=>r.end-r.start<1))return;this.beginJob();let reader;try{const blob=await this.inputBlob();reader=await openVideoFrames(await window.LocalAssets.url(this.src),this.jobController.signal);const outputs=await this.buildOutputs(ranges,blob,reader);this.assertSource();if(this.jobController.signal.aborted)return;this.endJob();this.close();app.createConnected(this.id,outputs);app.notify('视频剪辑成功');}catch(e){if(e.name!=='AbortError'){this.error(e.message);if(!this.visible)app.notify(e.message);}}finally{reader?.dispose();this.endJob();if(!this.visible)this.dispose();}}
  async analyze(){if(this.busy||!this.loaded)return;this.beginJob();let reader;try{const blob=await this.inputBlob();reader=await openVideoFrames(await window.LocalAssets.url(this.src),this.jobController.signal);const cuts=[];let previous;const step=.2;for(let time=0;time<this.duration;time+=step){const frame=await reader.at(this.base+time,96),signature=frameSignature(frame.getContext('2d').getImageData(0,0,frame.width,frame.height).data);if(previous&&cutDistance(previous,signature)>.55)cuts.push(time);previous=signature;this.progress(`正在分析 ${Math.min(99,Math.round(time/this.duration*100))}% · 点击空白处可退出`);}
      const ranges=segmentsFromCuts(this.duration,cuts);this.assertSource();if(ranges.length===1){this.progress('未检测到明显镜头切换');if(!this.visible)app.notify('未检测到明显镜头切换');return;}
      const outputs=await this.buildOutputs(ranges,blob,reader);this.assertSource();if(this.jobController.signal.aborted)return;this.endJob();this.close();app.createConnected(this.id,outputs);app.notify(`智能剪辑完成，已生成 ${outputs.length} 个片段`);
    }catch(e){if(e.name!=='AbortError'){this.error(e.message);if(!this.visible)app.notify(e.message);}}finally{reader?.dispose();this.endJob();if(!this.visible)this.dispose();}}
  cancel(){this.jobController?.abort();this.busy=false;this.close();this.dispose();}
  dispose(){this.alive=false;this.decodeController.abort();this.reader?.dispose();}
  close(){if(!this.visible)return;this.visible=false;this.listeners.abort();clearInterval(this.hintTimer);clearTimeout(this.hintDelay);this.video.pause();this.video.controls=this.originalControls;this.controls.remove();this.closeHelp(false);this.root.remove();document.body.classList.remove('video-trimming');if(current===this)current=null;if(!this.busy)this.dispose();app.render();}
}
export function open(node){if(!source(node))throw Error('没有可剪辑的视频');current?.close();window.NodeActions.close();window.NodeActions.closePop();window.NodeEditor.closePopover();current=new TrimEditor(node);return current;}
