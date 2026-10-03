import {displayMediaRef} from './display-media.mjs';

/** Resolve persistent asset references without letting a replaced node receive late pixels. */
export function bindLocalImage(image,{source,fallback,isCurrent,resolveAsset=ref=>globalThis.LocalAssets.url(ref)}) {
  let revision=0,disposed=false;
  const current=version=>!disposed&&version===revision&&isCurrent();
  async function show(ref,allowFallback) {
    const version=++revision;
    try {
      const safe=displayMediaRef(ref);
      if(!safe)throw Error('图片资源待导入本地');
      const url=displayMediaRef(safe.startsWith('asset:')?await resolveAsset(safe):safe);
      if(!current(version))return;
      if(!url)throw Error('图片资源待导入本地');
      image.onerror=()=>{
        if(!current(version))return;
        if(allowFallback&&fallback&&fallback!==ref)void show(fallback,false);
        else {image.onerror=null;image.title='本地图片无法解码，请重新导入';}
      };
      image.src=url;
    } catch(error) {
      if(!current(version))return;
      if(allowFallback&&fallback&&fallback!==ref)await show(fallback,false);
      else {image.onerror=null;image.title=error.message;}
    }
  }
  const ready=show(source,true);
  return {ready,dispose(){disposed=true;revision++;image.onerror=null;}};
}
