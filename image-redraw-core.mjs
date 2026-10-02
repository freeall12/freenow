export function prompt(text,reference=false){
 const value=String(text??'').trim();if(!value)throw Error('请输入重绘描述');
 return 'Naturally redraw only the transparent-channel area in the image. The last image is the main image with transparency to redraw; keep the original content and aspect ratio of that image.'+(reference?' Image 1 is a reference for the redrawn area.':'')+' Redraw prompt: '+value;
}
export function candidates(nodes,sourceId){return nodes.filter(n=>n.id!==sourceId&&n.type==='image'&&(n.fullImage||n.image));}
export function referenceSnapshot(node){return {id:node.id,url:node.fullImage||node.image};}
export function assertReference(snapshot,nodes){if(!snapshot)return;const n=nodes.find(n=>n.id===snapshot.id);if(!n||(n.fullImage||n.image)!==snapshot.url)throw Error('参考图片已变化，请重新选择');}
