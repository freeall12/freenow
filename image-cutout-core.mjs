export const sourceOf=node=>node?.fullImage||node?.image;
export function request(source,targetId,url){if(source?.type!=='image'||!sourceOf(source)||!url)throw Error('未选择图片');return {kind:'image.remove-background',label:'抠图',nodeId:targetId,sourceNodeId:source.id,prompt:'',inputs:[{type:'image',nodeId:source.id,url}],parameters:{}};}
export function sourceMatches(node,original,source){return node===original&&node?.type==='image'&&sourceOf(node)===source;}
export function untouched(node,original,snapshot){return node===original&&!!node&&JSON.stringify(node)===snapshot;}
