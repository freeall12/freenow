'use strict';
function mediaContent(inputs=[]){
 if(!Array.isArray(inputs)||inputs.length>12)throw Error('附件数量无效');let bytes=0;
 return inputs.flatMap(item=>{
  if(!item||typeof item.name!=='string'||item.name.length>240||typeof item.imageUrl!=='string'||!/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(item.imageUrl))throw Error('附件画面格式无效');
  bytes+=item.imageUrl.length;if(bytes>700000)throw Error('附件画面过大');const buffer=Buffer.from(item.imageUrl.split(',')[1],'base64');if(buffer[0]!==255||buffer[1]!==216||buffer[2]!==255)throw Error('附件不是 JPEG 画面');
  if(item.time!==undefined&&(!Number.isFinite(item.time)||item.time<0))throw Error('附件时间无效');
  return [{type:'input_text',text:JSON.stringify({attachment:item.name,...(item.time!==undefined?{sampledVideoFrameSeconds:item.time}:{})})},{type:'input_image',image_url:item.imageUrl,detail:'auto'}];
 });
}
module.exports={mediaContent};
