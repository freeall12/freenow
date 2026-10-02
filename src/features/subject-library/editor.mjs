import {el,button,preview,loadStyles} from './ui.mjs';
import {assetIcons} from './asset-icons.mjs';
import {assetPreviews} from './asset-preview.mjs';
import {bindAssetSort,sortAssets} from './asset-sort.mjs';
import {saveSubject} from './store.mjs';
import {pickSubjectAssets} from './canvas-picker.mjs';
import {panelWidth,panelMotion} from './panel-layout.mjs';
import {confirmDiscard} from '../../shared/draft-dismissal.mjs';
export function editSubject({scope='personal',subject,onSave=()=>{},onClose=()=>{}}={}) {
  loadStyles();const panel=el('aside','subject-editor-v2'),abort=new AbortController();panel.ariaLabel=subject?'编辑主体':'新建主体';
  let assets=structuredClone(subject?.assets||[]),filter='全部',picker=null,closed=false,uploading=false,sorter=null,uploadType=null;
  const head=el('header'),title=el('h2','',panel.ariaLabel);head.append(title,button('取消',close,'subject-icon-button','close'));
  const form=el('div','subject-editor-scroll'),name=el('input'),description=el('textarea');name.value=subject?.name||'';name.maxLength=50;name.required=true;name.ariaLabel='名称';name.placeholder='例如：男主角';description.value=subject?.description||'';description.ariaLabel='主体描述';description.placeholder='描述模型应该如何理解这个主体';description.rows=2;
  const draft=()=>JSON.stringify([name.value,description.value,assets]),initialDraft=draft();let saved=false,discardConfirmation=null;
  for(const [text,input] of [['名称',name],['主体描述',description]]){const label=el('label','subject-field'),caption=el('span','',text);if(input===name)caption.append(el('span','subject-required','*'));label.append(caption,input);form.append(label);}
  const section=el('section'),filters=el('div','subject-editor-filters'),grid=el('div','subject-editor-assets'),status=el('p','subject-editor-status');status.role='status';const file=el('input');file.type='file';file.multiple=true;file.accept='image/*,video/*,audio/*';file.hidden=true;
  const done=button('完成',()=>{try{const value={...subject,id:subject?.id||crypto.randomUUID(),scope,name:name.value.trim(),description:description.value.trim(),assets,createdAt:subject?.createdAt||Date.now(),updatedAt:Date.now()};if(!value.name||uploading)return;picker?.complete();saveSubject(value);saved=true;onSave(value);close();}catch(error){status.textContent='保存失败：'+error.message;}},'subject-primary');name.oninput=()=>done.disabled=!name.value.trim()||uploading;
  const types={全部:null,图片:'image',视频:'video',音频:'audio',文本:'text'};for(const key of Object.keys(types)){const b=button(key,()=>{filter=key;picker?.setTypes(types[key]?[types[key]]:['image','video','audio','text']);draw();});b.dataset.filter=key;filters.append(b);}
  const foot=el('footer');foot.append(button('取消',close),done);section.append(el('h3','','添加参考素材'),filters,grid,file,status);form.append(section);panel.append(head,form,foot);
  const previews=assetPreviews(panel);
  function draw(){sorter?.cancel();previews.hide();for(const b of filters.children){const key=b.dataset.filter;b.textContent=key+' ('+assets.filter(a=>!types[key]||a.type===types[key]).length+')';b.ariaLabel=b.textContent;b.setAttribute('aria-pressed',String(key===filter));}grid.replaceChildren();
    const upload=button('本地上传',()=>{uploadType=types[filter];file.click();},'subject-editor-add','plus');upload.append(el('span','','本地上传'));upload.disabled=uploading;file.accept=types[filter]?types[filter]+'/*':'image/*,video/*,audio/*';
    const canvas=button('画布',()=>{if(picker){picker.complete();return;}picker=pickSubjectAssets({app:window.CanvasApp,types:types[filter]?[types[filter]]:undefined,getAssets:()=>assets,setAssets:value=>{assets=value;if(!closed)draw();},onClose:()=>{picker=null;if(!closed)draw();}});canvas.setAttribute('aria-pressed','true');},'subject-editor-add subject-editor-canvas','canvas');canvas.setAttribute('aria-pressed',String(!!picker));canvas.append(el('span','','从画布选择'));if(filter!=='文本')grid.append(upload);grid.append(canvas);
    assets.forEach((asset,index)=>{if(types[filter]&&asset.type!==types[filter])return;
      const card=el('div','subject-editor-asset');card.dataset.assetId=asset.id;card.dataset.index=index;
      const thumb=el('div','subject-editor-thumbnail'),open=button(asset.name,()=>previews.open(asset,open),'subject-asset-open');
      if(['text','audio'].includes(asset.type)){const fallback=el('span','subject-asset-nonvisual');fallback.innerHTML=assetIcons[asset.type];open.append(fallback);}else open.append(preview(asset));
      const overlay=el('span','subject-asset-shade'),badge=el('span','subject-asset-type');badge.innerHTML=assetIcons[asset.type]||'';badge.ariaHidden='true';
      const handle=button('排序 '+asset.name,()=>{},'subject-asset-sort');handle.innerHTML=assetIcons.grip;handle.ariaPressed='false';handle.setAttribute('aria-roledescription','可排序素材');
      const remove=button('移除 '+asset.name,()=>{assets.splice(index,1);picker?.remove(asset);draw();},'subject-asset-remove','close');
      handle.onpointerenter=remove.onpointerenter=()=>previews.hide();
      thumb.append(open,overlay,badge,handle,remove);
      card.append(thumb,el('span','subject-asset-name',asset.name));previews.bind(card,asset);grid.append(card);
    });done.disabled=!name.value.trim()||uploading;
  }
  sorter=bindAssetSort(grid,{onStart:()=>previews.hide(),announce:text=>status.textContent=text,onCommit:(from,to)=>{assets=sortAssets(assets,types[filter],from,to);draw();grid.querySelector('[data-asset-id="'+CSS.escape(from)+'"] .subject-asset-sort')?.focus({preventScroll:true});}});
  file.onchange=async()=>{
    const expected=uploadType,files=[...file.files];uploading=true;status.textContent='正在导入素材…';draw();
    try{let supported=0;
      for(const f of files){
        const type=f.type.startsWith('image/')?'image':f.type.startsWith('video/')?'video':f.type.startsWith('audio/')?'audio':null;
        if(!type||(expected&&type!==expected))continue;supported++;
        const uploadFingerprint=[f.name,f.size,f.lastModified].join(':');if(assets.some(asset=>asset.uploadFingerprint===uploadFingerprint))continue;
        const url=await window.LocalAssets.put(f);if(closed)return;
        assets.push({id:crypto.randomUUID(),type,name:f.name,url,source:'upload',uploadFingerprint});
      }
      status.textContent=files.length&&!supported?'不支持的素材类型':'';
    }catch(error){status.textContent=error.message;}
    finally{uploading=false;file.value='';if(!closed)draw();}
  };
  function close({discard=false,onDiscard}={}){if(closed)return true;if(uploading){status.textContent='正在导入素材，请完成后再关闭';return false;}if(!discard&&!saved&&draft()!==initialDraft){if(!discardConfirmation)discardConfirmation=confirmDiscard({owner:panel,title:'放弃主体修改？',message:'主体有未保存的修改。继续编辑可保留当前内容。',onCancel:()=>{discardConfirmation=null;},onDiscard:()=>{discardConfirmation=null;if(close({discard:true}))onDiscard?.();}});return false;}closed=true;discardConfirmation?.cancel();discardConfirmation=null;unregisterNavigation?.();picker?.close();sorter.destroy();previews.destroy();observer.disconnect();releaseWidth();abort.abort();motion.exit();onClose();return true;}
  const unregisterNavigation=window.CanvasProjects?.registerNavigationGuard(()=>closed?null:uploading?'主体素材正在导入，请完成后再切换项目':!saved&&draft()!==initialDraft?'主体有未保存的修改，请先完成或取消编辑，再切换项目':null);
  panel.addEventListener('keydown',e=>{e.stopPropagation();if(e.key==='Escape'){e.preventDefault();close();}},{signal:abort.signal});
  const releaseWidth=panelWidth(panel,{minimum:370,initial:520,onStart:()=>previews.hide()}),motion=panelMotion(panel);
  const observer=new ResizeObserver(()=>{grid.style.gridTemplateColumns='repeat('+(panel.getBoundingClientRect().width>=448?4:2)+',minmax(0,1fr))';});observer.observe(panel);
  document.body.append(panel);motion.enter();draw();name.focus({preventScroll:true});return {close,element:panel};
}
