const panel=document.createElement('aside');panel.style.cssText='position:fixed;left:80px;top:65px;z-index:80;background:#171717;color:white;padding:10px;font:12px sans-serif;max-width:315px';
const title=document.createElement('strong');title.textContent='隔离验收 · 固定结果回传，未调用 AI';panel.append(title);
const output=document.createElement('pre');panel.append(output);
function button(text,fn){const b=document.createElement('button');b.textContent=text;b.onclick=()=>Promise.resolve().then(fn).catch(error=>{output.textContent=error.message;});panel.append(b);}
async function source(){
 let node=CanvasApp.getState().nodes.find(n=>n.id==='fal-source');if(node)return node;
 const canvas=document.createElement('canvas');canvas.width=320;canvas.height=200;const ctx=canvas.getContext('2d');
 ctx.fillStyle='#ece5d8';ctx.fillRect(0,0,320,200);ctx.fillStyle='#df563e';ctx.fillRect(25,25,110,100);ctx.fillStyle='#214958';ctx.fillRect(155,50,140,85);ctx.fillStyle='#222';ctx.font='16px sans-serif';ctx.fillText('LOCAL TEST IMAGE',30,170);
 const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png')),asset=await LocalAssets.put(blob);
 return CanvasApp.addNode('image',{x:420.25,y:200.75},await LocalAssets.url(asset),'本地合成素材',{id:'fal-source',fullImage:asset,width:320,height:200});
}
button('打开图片增强',async()=>{const node=await source(),{open}=await import('/image-enhance-ui.mjs');open(node);});
button('执行图片抠图',async()=>{const node=await source(),{submit}=await import('/image-cutout-ui.mjs');await submit(node.id);});
const write=()=>{output.textContent=JSON.stringify({...window.FalNativeFixture,jobs:GenerationAPI.getJobs().map(job=>({kind:job.request.kind,status:job.status,applied:job.applied})),nodes:CanvasApp.getState().nodes.length},null,2);};
window.addEventListener('qa:fal-native',write);GenerationAPI.subscribe(write);document.addEventListener('canvas:render',write);document.body.append(panel);write();
