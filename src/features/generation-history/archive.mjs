import {assertReadableMediaSource, assertReadableResultMedia} from '../generation-results/media-ref.mjs';
import {inspectVideoThumbnail} from './video-thumbnail.mjs';
import {mediaSource,resultProvenance} from '../media-preview/provenance.mjs';
import {outputSnapshot} from './model.mjs';
export function createArchiver({assets, fetch: fetcher, asDataUrl, validate, materializeWorld, localizeAudio,inspectVideo=inspectVideoThumbnail,createMediaUrl=blob=>URL.createObjectURL(blob),revokeMediaUrl=url=>URL.revokeObjectURL(url)}) {
  async function blob(source,{signal}={}) {
    if (!source) throw Error('原始媒体地址不可恢复，请查询原任务');
    assertReadableMediaSource(source);
    const response = await fetcher(await assets.url(source),{redirect:'error',...(signal?{signal}:{})});
    if (!response.ok) throw Error('历史媒体读取失败');
    const value = await response.blob(); if (!value.size) throw Error('历史媒体内容为空'); return value;
  }
  async function archive(output, metadata) {
    if(output.type==='model'&&(output.format==='spz'||output.world!==undefined))outputSnapshot(output);
    assertReadableResultMedia(output);
    if (output.type === 'model') {
      const patch = await materializeWorld(output, metadata.parameters.outputType || 'asset');
      if (typeof patch.worldResource?.url!=='string'||!/^asset:[^\s]+$/.test(patch.worldResource.url)) throw Error('3D 结果未保存真实模型');
      const format=patch.worldResource.format;
      if(!['glb','spz'].includes(format)||output.format&&output.format!==format)throw Error('3D 历史格式与实际保存资源不一致');
      if(format==='spz'){
        const stored=outputSnapshot({...output,world:patch.worldResource.world});
        const key=value=>JSON.stringify(value,(_,entry)=>entry&&typeof entry==='object'&&!Array.isArray(entry)?Object.fromEntries(Object.keys(entry).sort().map(name=>[name,entry[name]])):entry);
        if(patch.worldResource.representation!=='gaussianSplat'||key(stored.world)!==key(output.world))throw Error('世界历史保存的原始元数据与任务结果不一致');
      }
      return {mediaRef: patch.worldResource.url, thumbnailRef: patch.worldResource.thumbnail, worldPatch: patch, mime: format==='spz'?'application/octet-stream':'model/gltf-binary'};
    }
    if (output.type === 'audio') {
      const mediaRef = await localizeAudio(output.url || output.audio);
      const value = await blob(mediaRef); return {mediaRef, mime: value.type, bytes: value.size};
    }
    const value = await blob(mediaSource(output));
    if (value.size > 100 * 1024 * 1024) throw Error('历史媒体超过本地归档的 100MB 上限');
    if (value.type && !value.type.startsWith(output.type + '/')) throw Error('历史媒体类型与生成结果不一致');
    const previewUrl = createMediaUrl(value); let dimensions,thumbnailRef=null,thumbnailError=null,thumbnailBlob;
    try {
      if(output.type==='video'){
        if(output.poster)try{const poster=await blob(output.poster),url=createMediaUrl(poster);try{await validate('image',url);}finally{revokeMediaUrl(url);}thumbnailRef=await assets.put(poster);}catch(error){thumbnailError=error.message;}
        try{const inspected=await inspectVideo(previewUrl,{thumbnail:!thumbnailRef}),{thumbnailBlob:frame,thumbnailError:frameError,...metadata}=inspected;dimensions=metadata;thumbnailBlob=frame;if(frameError)thumbnailError=frameError;else if(frame||thumbnailRef)thumbnailError=null;}
        catch(error){dimensions=await validate('video',previewUrl);thumbnailError=thumbnailRef?null:error.message;}
      }else dimensions=await validate(output.type,previewUrl);
    }finally{revokeMediaUrl(previewUrl);}
    const mediaRef = await assets.put(value);
    if(output.type==='image')thumbnailRef=mediaRef;
    if(thumbnailBlob)try{thumbnailRef=await assets.put(thumbnailBlob);thumbnailError=null;}catch(error){thumbnailError=error.message;}
    return {mediaRef, thumbnailRef, mime: value.type, bytes: value.size, ...dimensions,...(output.type==='video'?{thumbnailStatus:thumbnailRef?'ready':'failed',thumbnailError}: {})};
  }
  async function thumbnail(row,{signal}={}) {
    const value=await blob(row.mediaRef,{signal});if(signal?.aborted)throw signal.reason;
    const url=createMediaUrl(value);
    try{const result=await inspectVideo(url,{thumbnail:true,signal});if(signal?.aborted)throw signal.reason;
      if(!result.thumbnailBlob)return {thumbnailStatus:'failed',thumbnailError:result.thumbnailError || '视频首帧不可读取'};
      const thumbnailRef=await assets.put(result.thumbnailBlob);if(signal?.aborted)throw signal.reason;return {thumbnailRef,thumbnailStatus:'ready',thumbnailError:null};
    }catch(error){if(signal?.aborted)throw signal.reason;return {thumbnailStatus:'failed',thumbnailError:error.message};}
    finally{revokeMediaUrl(url);}
  }
  async function node(row) {
    if (row.archiveStatus !== 'ready') throw Error('历史素材尚未保存，请先重试归档');
    const base = {id: row.id, type: row.type === 'model' ? 'world' : row.type, title: row.title, x:0,y:0,width:375,height:250,
      generation: {...row.parameters, prompt: row.prompt, model: row.model}, createdAt:row.createdAt, sourceFileId: row.sourceFileId, generationHistory: {taskId:row.taskId,outputIndex:row.outputIndex,createdAt:row.createdAt}};
    if (row.type === 'model') {
      const resource=row.worldPatch?.worldResource;
      if(typeof resource?.url!=='string'||!/^asset:[^\s]+$/.test(resource.url)||row.mediaRef&&resource.url!==row.mediaRef||!['glb','spz'].includes(resource.format))throw Error('3D 历史缺少有效的原始素材或格式');
      if(resource.format==='spz')outputSnapshot({type:'model',format:'spz',representation:resource.representation,sourceFileId:resource.world?.worldId,world:resource.world,url:resource.world?.assets?.splats?.spzUrls?.[resource.world?.splatResolution]});
      await blob(resource.url);const patch=structuredClone(row.worldPatch);if(patch.image){assertReadableMediaSource(patch.image);if(patch.image.startsWith('asset:')&&typeof asDataUrl==='function')patch.image=await asDataUrl(await blob(patch.image));}return {...base,...patch,worldConfig:{...row.parameters,prompt:row.prompt,model:row.model}};
    }
    const value = await blob(row.mediaRef);
    if (row.type === 'audio') return {...base,audio:row.mediaRef,audioMode:'upload',durationMs:row.duration ? row.duration * 1000 : undefined};
    const source = await asDataUrl(value), dimensions = await validate(row.type,source);
    // Bind the saved task metadata to the materialized full-size file, so
    // changing the next composer request cannot relabel a historical result.
    const provenance=resultProvenance({id:row.taskId,request:{kind:row.kind,prompt:row.prompt,parameters:{model:row.model}}},{type:row.type,url:source,sourceRange:row.sourceRange});
    const ratio = dimensions.width / dimensions.height;
    if (Number.isFinite(ratio) && ratio > 0) base.height = 375 / ratio;
    if (row.type === 'image') return {...base,...provenance,image:source,fullImage:source,pixelWidth:dimensions.width,pixelHeight:dimensions.height};
    let image=null;if(row.thumbnailRef)try{image=await asDataUrl(await blob(row.thumbnailRef));}catch{/* A missing optional cover must not invalidate the archived video. */}
    const range=row.sourceRange,sourceRange=range&&Number.isFinite(range.start)&&Number.isFinite(range.end)&&range.start>=0&&range.end>range.start?{start:range.start,end:range.end}:undefined;
    return {...base,...provenance,video:source,image,durationMs:dimensions.duration * 1000,...(sourceRange?{sourceRange,content:row.text||''}:{})};
  }
  return {archive,node,blob,thumbnail};
}
