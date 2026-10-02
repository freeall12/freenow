import {listSubjects,readySubjects} from '../subject-library/store.mjs';
import {mediaView} from '../subject-library/preview-media.mjs';
import {loadStyles,preview} from '../subject-library/ui.mjs';
const el=(tag,cls,text)=>{const node=document.createElement(tag);node.className=cls;if(text!==undefined)node.textContent=text;return node;};
// Official V0e/Pq: subject mentions use a 320px detail card with four type counts.
export function generationSubjectPreview(ref){
 loadStyles();const element=el('div','generation-subject-preview'),frame=el('div','generation-subject-frame'),body=el('div','generation-subject-body');let destroyed=false;const cleanups=[];
 const clear=()=>{for(const cleanup of cleanups.splice(0))cleanup();frame.querySelectorAll('video').forEach(video=>{video.pause();video.removeAttribute('src');video.load();});};
 function draw(){
  if(destroyed)return;clear();frame.replaceChildren();body.replaceChildren();
  const subject=listSubjects('personal').find(item=>item.id===ref.subjectId),assets=subject?.assets.slice(0,4)||[];frame.dataset.count=String(assets.length);
  if(assets.length===1){const view=mediaView(assets[0],{hover:true});frame.append(view.element);cleanups.push(view.destroy);}
  else if(assets.length){for(const asset of assets){const tile=el('div','generation-subject-tile');tile.dataset.type=asset.type;tile.append(preview(asset));if(asset.type==='audio')tile.append(el('span','',asset.name));frame.append(tile);}}
  else frame.append(el('span','generation-subject-empty','暂无素材'));
  body.append(el('strong','',subject?.name||ref.label));if(subject?.description)body.append(el('p','',subject.description));
  const counts=el('div','generation-subject-counts');for(const [type,label]of [['image','图片'],['video','视频'],['audio','音频'],['text','文本']]){const count=el('span','');count.append(document.createTextNode(label+' '),el('b','',String(subject?.assets.filter(asset=>asset.type===type).length||0)));counts.append(count);}body.append(counts);
 }
 frame.append(el('span','generation-subject-empty','正在读取主体…'));body.append(el('strong','',ref.label));element.append(frame,body);
 readySubjects().then(()=>{if(!destroyed){draw();document.addEventListener('subjects:changed',draw);}},()=>{if(!destroyed)frame.replaceChildren(el('span','generation-subject-empty','主体读取失败'));});
 return {element,destroy(){destroyed=true;document.removeEventListener('subjects:changed',draw);clear();}};
}
