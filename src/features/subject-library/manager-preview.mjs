import {el,button,preview} from './ui.mjs';
import {mediaView} from './preview-media.mjs';
export function subjectPreview(subject,onApply) {
  const root=el('aside','subject-manager-preview');root.ariaLabel='主体预览：'+subject.name;
  const frame=el('div','subject-preview-frame'),assets=subject.assets.slice(0,4);frame.dataset.count=assets.length;frame.dataset.square=String(subject.assets.length===1&&assets[0].type==='image');
  let player=null;
  if(assets.length===1){player=mediaView(assets[0],{hover:true});frame.append(player.element);}
  else for(const asset of assets){const tile=el('div','subject-preview-tile');tile.append(preview(asset));frame.append(tile);}
  if(!assets.length)frame.append(preview(null));root.dispose=()=>player?.destroy();
  const body=el('div','subject-preview-body'),info=el('div','subject-preview-info'),heading=el('div');heading.append(el('strong','',subject.name),el('span','',subject.assets.length+' 个素材'));info.append(heading,el('p','',subject.description||'可以稍后添加参考素材'));body.append(info,button('添加到画布',onApply,'subject-preview-apply'));root.append(frame,body);return root;
}
