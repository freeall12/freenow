const app=window.CanvasApp,fixture=window.PlaylistContractFixture,id='qa-playlist',bar=document.createElement('aside');bar.style.cssText='position:fixed;left:245px;right:185px;top:58px;z-index:2200;padding:10px;background:#25282b;color:#eee;font:12px system-ui;border:1px solid #555';
const heading=document.createElement('strong');heading.textContent='播放列表隔离 QA · 红/蓝视频为本机 FFmpeg 测试素材，不是模型结果';bar.append(heading,document.createElement('br'));
const output=document.createElement('output');output.ariaLabel='播放列表专项状态';output.style.cssText='display:block;white-space:pre-wrap;overflow-wrap:anywhere;max-height:110px;overflow:auto;margin-top:8px';
function draw(){const node=app.getState().nodes.find(node=>node.id===id);output.textContent=JSON.stringify({clips:node?.clips?.map(clip=>({id:clip.id,source:clip.title,start:clip.trimStart,duration:clip.duration})),playhead:window.CanvasPlaylist?.position,history:app.historyState(),posts:fixture.posts,reads:fixture.reads,downloads:fixture.downloads,pending:window.CanvasPlaylist?.pending},null,2);}
function action(label,run){const button=document.createElement('button');button.textContent=label;button.style.margin='5px 5px 0 0';button.onclick=async()=>{try{await run();draw();}catch(error){app.notify(error.message);}};bar.append(button);}
async function at(seconds){app.select(id);window.CanvasPlaylist.open(id,true);await window.CanvasPlaylist.seek(seconds);document.querySelector('#canvas').focus();draw();}
action('预览并定位 2 秒（可按 C/Q/E）',()=>at(2));
action('定位 0.5 秒（最短限制）',()=>at(.5));
action('恢复测试时间线',()=>{window.CanvasPlaylist.close();window.CanvasPlaylist.update(id,fixture.clips());app.select(id);});
action('撤销一次',()=>app.undo());
action('保存并回读',async()=>{await app.saveProject();const saved=await window.CanvasStore.load();const node=saved.nodes.find(node=>node.id===id);fixture.savedRanges=node.clips.map(clip=>[clip.trimStart,clip.duration]);app.notify('权威记录已回读：'+JSON.stringify(fixture.savedRanges));});
action('下载原始片段',()=>window.CanvasPlaylist.originals(id));
action('合并到画布',()=>window.CanvasPlaylist.exportMerged(id,true));
action('下一次合并延迟 6 秒',()=>{fixture.delayMerged=6000;app.notify('下次真实 FFmpeg 响应延迟返回，可取消或修改片段验证迟到保护。');});
action('下载合并 MP4',()=>window.CanvasPlaylist.exportMerged(id,false));
action('刷新验收',()=>location.reload());
bar.append(output);document.body.append(bar);
const originalDownload=window.LocalMedia.download;window.LocalMedia.download=(blob,name)=>{fixture.downloads.push({name,bytes:blob.size,type:blob.type});draw();return originalDownload(blob,name);};
document.addEventListener('canvas:render',()=>queueMicrotask(draw));window.addEventListener('qa:playlist-contract',draw);draw();
