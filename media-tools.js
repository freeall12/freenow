(() => {
 const asDataUrl=blob=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(blob);});
 async function process(operation,blob,{start,end,duration,signal}={}){const query=operation==='trim'?'?'+new URLSearchParams({start,end}):duration?'?'+new URLSearchParams({duration}):'';const response=await fetch('/api/media/'+operation+query,{method:'POST',body:blob,headers:{'Content-Type':blob.type||'application/octet-stream'},signal});if(!response.ok){const error=await response.json();throw Error(error.error||'本地媒体处理失败');}return response.blob();}
 async function trim(node){const src=node.video||window.EDITOR_DATA?.nodes[node.id]?.video;if(!src)throw Error('没有视频源');const blob=await fetch(src).then(r=>r.blob());const result=await process('trim',blob,node.clip);const video=await asDataUrl(result);const added=window.CanvasApp.createConnected(node.id,[{type:'video',title:'已导出剪辑',image:node.image,video,width:node.width,height:node.height}]);return {blob:result,node:added[0]};}
 function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.hidden=true;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
 window.LocalMedia={process,trim,asDataUrl,download};
})();
