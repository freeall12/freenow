// Official library Ve/Or: up to four columns, 360 x 300 world-unit spacing.
// Prepare every file before the single undoable graph transaction. Agent callers
// can freeze the world position and revalidate their subject immediately at commit.
export async function applySubject(subject,app,{signal,position,beforeCommit,mapNode,resolveUrl}={}) {
  const check=()=>{if(signal?.aborted)throw new DOMException('主体导入已取消','AbortError');};
  check();
  if(!subject.assets.length){app.notify('主体暂无参考素材');return;}
  if(position&&![position.x,position.y].every(Number.isFinite))throw Error('主体导入位置无效');
  const resolve=resolveUrl|| (async source=>{
    if(!source?.startsWith('asset:'))return source;
    const url=await window.LocalAssets.url(source);check();
    const response=await fetch(url,{signal});
    if(!response.ok)throw Error('主体素材读取失败');
    const result=await window.LocalMedia.asDataUrl(await response.blob());check();return result;
  });
  const columns=Math.min(4,Math.ceil(Math.sqrt(subject.assets.length)));
  const nodes=await Promise.all(subject.assets.map(async(asset,index)=>{
    check();
    const url=await resolve(asset.url,{signal}),image=asset.image===asset.url?url:await resolve(asset.image,{signal});check();
    const node={id:'subject-asset-'+index,type:asset.type,title:asset.name||subject.name,x:(index%columns)*360,y:Math.floor(index/columns)*300,width:250,height:250};
    if(asset.type==='image'){node.image=image||url;node.fullImage=url;}
    if(asset.type==='video'){node.image=image;node.video=url;}
    if(asset.type==='audio'){node.audio=url;node.audioMode='upload';}
    if(asset.type==='text'){node.content=asset.text||'';node.textMode='pure';}
    if(!['image','video','audio','text'].includes(asset.type))throw Error('不支持的主体素材类型');
    if(asset.type!=='text'&&!url)throw Error('主体素材地址失效');
    if(Number.isFinite(asset.durationMs)&&asset.durationMs>0)node.durationMs=asset.durationMs;
    if(node.image){
      const img=new Image();
      const abort=()=>{img.src='';};signal?.addEventListener('abort',abort,{once:true});
      try{img.src=node.image;await img.decode();check();const ratio=img.naturalWidth/img.naturalHeight;
        if(!Number.isFinite(ratio)||ratio<=0)throw Error('主体图片尺寸无效');
        node.width=Math.round(ratio>1?250*ratio:250);node.height=Math.round(ratio<1?250/ratio:250);
      }finally{signal?.removeEventListener('abort',abort);}
    }
    const mapped=mapNode?await mapNode(node,index):node;check();return mapped;
  }));
  let point=position;
  if(!point){
    const {view}=app.getState(),canvas=document.querySelector('#canvas');
    point={x:(canvas.clientWidth/2-view.x)/view.scale-125+(Math.random()*100-50)-(columns-1)*180,y:(canvas.clientHeight/2-view.y)/view.scale-125+(Math.random()*100-50)};
  }
  check();beforeCommit?.();check();
  return app.pasteGraph({nodes,edges:[]},point);
}
