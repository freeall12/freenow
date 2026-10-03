import {sourcePixelDimensions,prepareSourceCrop,commitSourceCrop,prepareObjectErasure,commitObjectErasure,canEraseObject} from './object-editing.mjs';
import {normalizePose,renderPoseSource,readLayerPose,canRegeneratePose,poseCapabilities} from './agent-pose.mjs';
import {artworkEntries,ensureArtworkIds,serializedArtworkFonts,findArtwork,assertArtworkUnlocked,artworkTransform,prepareArtworkUpdate,commitArtworkUpdate,removeArtwork,reorderArtwork,prepareArtworkHierarchy,commitArtworkHierarchy} from './group-objects.mjs';
// The bridge operates on live Fabric instances. Coordinates are artboard logical
// pixels; only create accepts infinite-canvas world coordinates.
const fail=(code,message)=>Object.assign(new Error(message),{code});
const checkSignal=signal=>{if(signal?.aborted)throw fail('cancelled','操作已取消');};
const finite=(value,name,min=-100000,max=100000)=>{if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)throw fail('invalid_argument',`${name} 数值无效`);return value;};
const stamp=node=>JSON.stringify([node?.editorDoc,node?.image,node?.fullImage]);
const unsupportedGroupStyles=['fill','stroke','strokeWidth'];
const keys=new Set(['left','top','width','height','scaleX','scaleY','angle','fill','stroke','strokeWidth','opacity','visible','locked','name','text','fontFamily','fontSize','fontWeight','fontStyle','textAlign','rx','ry','flipX','flipY']);
export function createImageEditorAgent({getCurrent,open,create,app,fabric,loadFont,fontCatalog,store}) {
  let busy=false;
  const nodeFor=id=>app.getState().nodes.find(node=>node.id===id);
  const assertSource=editor=>{const node=nodeFor(editor.nodeId);if(!node||node!==editor.sourceNode||stamp(node)!==editor.sourceStamp)throw fail('source_changed','来源图片节点已变化，请重新打开编辑器');return node;};
  const dirty=editor=>JSON.stringify(editor.document())!==editor.saved;
  function idle(editor){if(editor.loading||editor.saving||editor.crop||editor.drawing||editor.penPoints?.length||editor.canvas.getActiveObject()?.isEditing||editor.pendingObjects?.size||editor.canvas._currentTransform||editor.resizing||editor.poseDialog?.isConnected)throw fail('editor_busy','编辑器正在加载、拖动、裁剪或编辑，请完成当前操作');}
  function artboardTransform(object){
    return artworkTransform(object,fabric.util);
  }
  function summary(editor,args={}){
    const entries=artworkEntries(editor.canvas.getObjects()),all=entries.map(entry=>entry.object),offset=args.offset??0,limit=args.limit??30;
    if(!Number.isInteger(offset)||offset<0||!Number.isInteger(limit)||limit<1||limit>50)throw fail('invalid_argument','图层分页范围无效');
    const safeText=value=>String(value||'').replace(/\b(?:data:[^\s]+|blob:[^\s]+)/gi,'[media omitted]');
    const detail=o=>({objectId:o.id,kind:o.type,index:all.indexOf(o),name:safeText(o.name).slice(0,200),...artboardTransform(o),width:o.width,height:o.height,originX:o.originX,originY:o.originY,opacity:o.opacity,visible:o.visible,locked:o.selectable===false,fill:typeof o.fill==='string'?o.fill:null,stroke:typeof o.stroke==='string'?o.stroke:null,strokeWidth:o.strokeWidth,...(/text/i.test(o.type)?{text:safeText(o.text).slice(0,1000),textLength:safeText(o.text).length,textTruncated:safeText(o.text).length>1000,textOffsetUnit:'UTF-16 code units after media redaction',fontFamily:o.fontFamily,fontSize:o.fontSize,fontWeight:o.fontWeight,fontStyle:o.fontStyle,textAlign:o.textAlign}:{}),...(o.type==='image'?{sourcePixelDimensions:sourcePixelDimensions(o),crop:{x:o.cropX||0,y:o.cropY||0,width:o.width,height:o.height},cropCoordinateSpace:'underlying-source-pixels',canCrop:!o.clipPath}:{}),...(readLayerPose(o)?{pose:readLayerPose(o),canRegeneratePose:canRegeneratePose(o)}:{}),canErase:canEraseObject(o,fabric.FabricImage),...(o.agentSourceNodeId?{sourceNodeId:o.agentSourceNodeId}:{})});
    let layers,nextOffset=offset+limit<all.length?offset+limit:null;
    if(args.objectId){if(args.offset!==undefined||args.limit!==undefined)throw fail('invalid_argument','单图层读取不能混用图层分页');const object=all.find(o=>o.id===args.objectId);if(!object)throw fail('missing_object','图层不存在');const item=detail(object),textOffset=args.textOffset??0,textLimit=args.textLimit??1000;if(!Number.isInteger(textOffset)||textOffset<0||!Number.isInteger(textLimit)||textLimit<1||textLimit>8000)throw fail('invalid_argument','文字分页范围无效');if(/text/i.test(object.type)){const text=safeText(object.text);Object.assign(item,{text:text.slice(textOffset,textOffset+textLimit),textLength:text.length,textOffset,nextTextOffset:textOffset+textLimit<text.length?textOffset+textLimit:null,textTruncated:textOffset>0||textOffset+textLimit<text.length});}layers=[item];nextOffset=null;}else{if(args.textOffset!==undefined||args.textLimit!==undefined)throw fail('invalid_argument','文字分页需要 objectId');layers=all.slice(offset,offset+limit).map(detail);}
    layers=layers.map(layer=>{const entry=findArtwork(entries,layer.objectId),object=entry.object;return {...layer,index:entry.index,flatIndex:all.indexOf(object),parentObjectId:entry.parent?.id||null,depth:entry.depth,ancestorObjectIds:entry.ancestors.map(parent=>parent.id),ancestorLocked:entry.ancestors.some(parent=>parent.selectable===false),...(String(object.type).toLowerCase()==='group'?{childObjectIds:object.getObjects().filter(child=>!child.excludeFromExport).map(child=>child.id),unsupportedUpdateProperties:[...unsupportedGroupStyles]}:{}),...(entry.parent?{localTransform:fabric.util.saveObjectTransform(object),canCrop:false,canErase:false,...(layer.pose?{canRegeneratePose:false}:{})}:{})};});
    return {nodeId:editor.nodeId,sessionId:editor.sessionId,revision:editor.revision,width:editor.width,height:editor.height,background:typeof editor.canvas.backgroundColor==='string'?editor.canvas.backgroundColor:null,dirty:dirty(editor),coordinateSpace:'artboard-logical-pixels',layerOrder:'depth-first, siblings bottom-to-top; index is within parent',layers,totalLayers:all.length,topLevelLayers:entries.filter(entry=>!entry.parent).length,offset,nextOffset,canUndo:editor.history.past.length>1,canRedo:!!editor.history.future.length,supportedKinds:['text','rect','ellipse','line','path','image'],capabilities:{brushPath:true,eraser:true,crop:true,pose:true,groupChildren:true,groupCreate:true,groupUngroup:true,groupReparent:true,groupReparentRequiresPlainAncestors:true,groupSameParentOnly:true,groupUngroupRequiresPlainCompositing:true,groupContainerStyleUpdate:false,groupUnsupportedUpdateProperties:[...unsupportedGroupStyles],groupChildActions:['read','update','remove','reorder','reparent'],cropRequiresTopLevelImage:true,poseRequiresTopLevelImage:true,eraserRequiresTopLevelLayers:true,cropRequiresUnmaskedImage:true,eraserRequiresCompatibleMask:true},poseGenerator:poseCapabilities(),fonts:Object.keys(fontCatalog())};
  }
  function properties(input={},kind){if(!input||typeof input!=='object'||Array.isArray(input))throw fail('invalid_argument','properties 必须是对象');const out={};for(const [key,value]of Object.entries(input)){if(!keys.has(key))throw fail('invalid_argument',`不支持属性 ${key}`);if(kind.toLowerCase()==='group'&&unsupportedGroupStyles.includes(key))throw fail('unsupported_group_style',`${key} 不作用于分组渲染，请显式修改未锁定的子图层`);if(['text','fontFamily','fontSize','fontWeight','fontStyle','textAlign'].includes(key)&&!['text','textbox','i-text'].includes(kind.toLowerCase()))throw fail('invalid_argument',`${key} 仅适用于文字`);if(['rx','ry'].includes(key)&&!['rect','ellipse'].includes(kind.toLowerCase()))throw fail('invalid_argument',`${key} 不适用于此图层`);
    if(['left','top','angle'].includes(key))out[key]=finite(value,key);
    else if(['width','height','scaleX','scaleY','fontSize','rx','ry'].includes(key))out[key]=finite(value,key,['rx','ry'].includes(key)?0:.001,key.startsWith('scale')?1000:16384);
    else if(['opacity','strokeWidth'].includes(key))out[key]=finite(value,key,0,key==='opacity'?1:1024);
    else if(['visible','locked','flipX','flipY'].includes(key)){if(typeof value!=='boolean')throw fail('invalid_argument',`${key} 必须是布尔值`);if(key==='locked')Object.assign(out,{selectable:!value,evented:!value,lockMovementX:value,lockMovementY:value,lockScalingX:value,lockScalingY:value,lockRotation:value});else out[key]=value;}
    else if(['fill','stroke'].includes(key)){if(value!==null&&(typeof value!=='string'||!CSS.supports('color',value)))throw fail('invalid_argument',`${key} 必须是颜色`);out[key]=value;}
    else if(key==='fontWeight'&&typeof value==='number'){if(!Number.isInteger(value)||value<100||value>900||value%100)throw fail('invalid_argument','fontWeight 无效');out[key]=value;}
    else{if(typeof value!=='string'||value.length>(key==='text'?20000:200))throw fail('invalid_argument',`${key} 文本无效`);if(key==='fontFamily'&&!Object.keys(fontCatalog()).some(name=>name.toLowerCase()===value.toLowerCase()||(value==='OpenSans'&&name==='open sans')))throw fail('invalid_font','字体必须来自 read 返回的字体目录');if(key==='fontStyle'&&!['normal','italic','oblique'].includes(value))throw fail('invalid_argument','fontStyle 无效');if(key==='textAlign'&&!['left','center','right','justify','justify-left','justify-center','justify-right'].includes(value))throw fail('invalid_argument','textAlign 无效');if(key==='fontWeight'&&!/^(normal|bold|[1-9]00)$/.test(value))throw fail('invalid_argument','fontWeight 无效');out[key]=value;}}
    return out;
  }
  async function execute(action,args={}, {signal}={}){
    checkSignal(signal);if(busy)throw fail('editor_busy','另一个 Agent 图片编辑操作正在执行');busy=true;
    try{
      if(action==='create'||action==='open'){
        const existing=action==='create'?app.getState().nodes.find(n=>n.agentImageEditor?.operationId===args.operationId):null;
        let editor=getCurrent();if(editor&&editor.nodeId!==(existing?.id||args.nodeId)){idle(editor);if(dirty(editor))throw fail('unsaved_editor','当前图片编辑器有未保存内容，请先保存');}
        let node;
        if(action==='create'){
          if(typeof args.operationId!=='string'||!args.operationId.trim()||args.operationId.length>200)throw fail('invalid_argument','create 需要稳定 operationId');
          const width=finite(args.width,'width',16,4096),height=finite(args.height,'height',16,4096);if(!Number.isInteger(width)||!Number.isInteger(height))throw fail('invalid_argument','画板宽高必须是整数');finite(args.x,'x',-1000000,1000000);finite(args.y,'y',-1000000,1000000);
          const ids=args.sourceNodeIds||[];if(!Array.isArray(ids)||ids.length>32||new Set(ids).size!==ids.length||ids.some(id=>{const n=nodeFor(id);return !n||n.type!=='image'||!(n.fullImage||n.image);}))throw fail('invalid_argument','sourceNodeIds 必须为已有图片节点');
          if(args.title!==undefined&&(typeof args.title!=='string'||args.title.length>200))throw fail('invalid_argument','标题无效');
          const request=JSON.stringify({width,height,x:args.x,y:args.y,title:args.title||'Image Editor',sourceNodeIds:ids});
          node=app.getState().nodes.find(n=>n.agentImageEditor?.operationId===args.operationId);
          if(node&&node.agentImageEditor.request!==request)throw fail('operation_conflict','operationId 已用于不同的创建请求');
          if(!node){if(editor){editor.close();editor=null;}const view=app.getState().view;if(!view||![view.x,view.y,view.scale].every(Number.isFinite)||view.scale<=0)throw fail('invalid_view','画布视口无效');node=create({x:args.x*view.scale+view.x,y:args.y*view.scale+view.y},{width,height,title:args.title,sourceNodeIds:ids,agentImageEditor:{operationId:args.operationId,request}});}
        }else{node=nodeFor(args.nodeId);if(!node||node.tool!=='image-editor')throw fail('invalid_node','请选择现有图片编辑器节点');}
        if(editor&&editor.nodeId!==node.id)editor.close();editor=getCurrent()||open(node);if(!editor)throw fail('editor_busy','无法打开图片编辑器');await editor.ready;checkSignal(signal);if(getCurrent()!==editor||!editor.alive||editor.loadError)throw fail('editor_changed',editor.loadError?.message||'编辑器已关闭或发生变化');assertSource(editor);return summary(editor);
      }
      const editor=getCurrent();if(!editor||editor.nodeId!==args.nodeId||!editor.alive)throw fail('editor_not_open','请先打开指定图片编辑器');if(action!=='close')assertSource(editor);idle(editor);
      if(action==='read')return summary(editor,args);
      if(args.sessionId!==editor.sessionId||args.expectedRevision!==editor.revision)throw fail('revision_conflict','编辑器会话或版本已变化，请重新读取');
      const revision=editor.revision,baseline=JSON.stringify(editor.document());
      const guard=()=>{checkSignal(signal);if(getCurrent()!==editor||!editor.alive||editor.revision!==revision||JSON.stringify(editor.document())!==baseline)throw fail('revision_conflict','编辑器在操作期间发生变化');assertSource(editor);if(!editor.saving)idle(editor);};
      if(action==='close'){if(dirty(editor)&&args.discard!==true)throw fail('unsaved_editor','有未保存内容，请先保存或显式 discard');checkSignal(signal);const result={nodeId:editor.nodeId,sessionId:editor.sessionId,revision:editor.revision,closed:true,discarded:dirty(editor)};editor.close();return result;}
      if(action==='save'){const before=summary(editor);try{const result=await editor.save({signal,guard});return {...(editor.alive&&getCurrent()===editor?summary(editor):before),...result};}catch(error){if(error.applied)return {...(editor.alive&&getCurrent()===editor?summary(editor):before),applied:true,saved:false,...(typeof error.currentMatches==='boolean'?{currentMatches:error.currentMatches}:{}),error:error.message};throw error;}}
      const canvas=editor.canvas;let changedObject,editedObjectIds,hierarchyResult;
      if(['crop','pose','erase'].includes(action)){for(const id of args.objectIds||[args.objectId].filter(Boolean)){const entry=findArtwork(artworkEntries(canvas.getObjects()),id);if(entry.parent)throw fail('unsupported_group_operation','分组子图层目前只支持读取、属性更新、移除和组内排序');}}
      if(action==='group'||action==='ungroup'||action==='reparent'){
        const plan=await prepareArtworkHierarchy(action,args,canvas,fabric,{signal,guard});
        commitArtworkHierarchy(plan,canvas);hierarchyResult=plan.result;
      }else if(action==='add'){
        const kind=args.kind,opts=properties(args.properties,kind||'');let object;
        if(kind==='text'){await loadFont(opts.fontFamily||'OpenSans');guard();object=new fabric.Textbox(opts.text||'',{width:180,fontSize:40,fontFamily:'OpenSans',...opts});}
        else if(kind==='rect')object=new fabric.Rect({width:100,height:100,...opts});
        else if(kind==='ellipse'){object=new fabric.Ellipse({rx:(opts.width||100)/2,ry:(opts.height||100)/2,...opts});}
        else if(kind==='line'||kind==='path'){
          const points=args.points;if(!Array.isArray(points)||points.length<2||points.length>2048||(kind==='line'&&points.length!==2))throw fail('invalid_argument','line 需要 2 个点，path 需要 2–2048 个点');points.forEach(p=>{finite(p.x,'point.x');finite(p.y,'point.y');});
          if(['left','top','width','height'].some(key=>key in opts))throw fail('invalid_argument','线条和路径的位置由 points 指定，请勿同时指定 left/top/width/height');
          object=kind==='line'?new fabric.Line([points[0].x,points[0].y,points[1].x,points[1].y],{stroke:'#f0342c',strokeWidth:3,...opts}):new fabric.Path(points.map((p,i)=>`${i?'L':'M'} ${p.x} ${p.y}`).join(' '),{fill:null,stroke:'#f0342c',strokeWidth:3,strokeLineCap:'round',strokeLineJoin:'round',...opts});
        }else if(kind==='image'){
          if('width'in opts||'height'in opts)throw fail('invalid_argument','图片使用 scaleX/scaleY 缩放，保留原始像素尺寸');const source=nodeFor(args.sourceNodeId),src=source?.fullImage||source?.image;if(source?.type!=='image'||!src)throw fail('invalid_source','图片必须来自已有图片节点');const sourceStamp=stamp(source);const url=await window.LocalAssets.url(src);guard();if(nodeFor(source.id)!==source||stamp(source)!==sourceStamp)throw fail('source_changed','来源图片已变化');object=await fabric.FabricImage.fromURL(url,{crossOrigin:'anonymous',signal});try{guard();if(nodeFor(source.id)!==source||stamp(source)!==sourceStamp)throw fail('source_changed','来源图片已变化');}catch(error){object.dispose();throw error;}object.set({...opts,agentSourceNodeId:source.id});
        }else throw fail('invalid_argument','不支持的图层类型');
        guard();object.set({id:crypto.randomUUID(),originX:'left',originY:'top'});canvas.discardActiveObject();canvas.add(object);object.setCoords();changedObject=object;
      }else if(action==='pose'){
        const object=args.objectId?canvas.getObjects().find(o=>o.id===args.objectId&&!o.excludeFromExport):null;
        if(args.objectId&&!object)throw fail('missing_object','姿势图层不存在');
        if(object?.selectable===false)throw fail('locked_object','图层已锁定，先显式解锁');
        if(object&&!canRegeneratePose(object))throw fail('unsupported_pose','只能修改未裁剪、未擦除、未替换的原始姿势图层');
        if(object&&(!args.pose||!Object.keys(args.pose).length))throw fail('invalid_argument','修改姿势需要明确 color 或 joints');
        const pose=normalizePose(args.pose,object?readLayerPose(object):undefined),rendered=renderPoseSource(pose);
        guard();let image;
        try{image=await fabric.FabricImage.fromURL(rendered.source,{signal});guard();}catch(error){image?.dispose();throw error;}
        canvas.discardActiveObject();
        // The decoded element is transferred to the existing image. Disposing
        // the temporary Fabric wrapper would also dispose that shared element.
        if(object){object.setElement(image.getElement());object.set({agentPose:rendered.metadata,dirty:true});changedObject=object;}
        else{const scale=Math.min(editor.width/600,editor.height/440);image.set({id:crypto.randomUUID(),name:'姿势',originX:'center',originY:'center',left:editor.width/2,top:editor.height/2,scaleX:scale,scaleY:scale,agentPose:rendered.metadata});canvas.add(image);changedObject=image;}
        changedObject.setCoords();
      }else if(action==='update'||action==='remove'||action==='reorder'){
        let entry=findArtwork(artworkEntries(canvas.getObjects()),args.objectId);const object=entry.object;
        if(action==='update'){const opts=properties(args.properties,String(object.type));if(object.type.toLowerCase()==='image'&&('width'in opts||'height'in opts))throw fail('invalid_argument','图片使用 scaleX/scaleY 缩放');assertArtworkUnlocked(entry,opts.selectable===true);if(opts.fontFamily)await loadFont(opts.fontFamily);guard();let plan=prepareArtworkUpdate(entry,opts,fabric.util);canvas.discardActiveObject();if(!entry.parent)plan=prepareArtworkUpdate(entry,opts,fabric.util);commitArtworkUpdate(plan,fabric.util);changedObject=object;}
        else{assertArtworkUnlocked(entry);guard();if(action==='remove'){if(entry.parent&&entry.parent.getObjects().filter(o=>!o.excludeFromExport).length===1)throw fail('last_group_child','不能移除分组最后一个子图层，请显式移除该分组');canvas.discardActiveObject();removeArtwork(entry,canvas);}else{const index=finite(args.index,'index',0,(entry.parent||canvas).getObjects().length-1);if(!Number.isInteger(index))throw fail('invalid_argument','index 必须是整数');canvas.discardActiveObject();reorderArtwork(entry,canvas,index);}}
      }else if(action==='crop'){
        const image=canvas.getObjects().find(o=>o.id===args.objectId&&!o.excludeFromExport);if(!image)throw fail('missing_object','图片图层不存在');if(image.selectable===false)throw fail('locked_object','图层已锁定，先显式解锁');
        const plan=prepareSourceCrop(image,args.crop,fabric);guard();canvas.discardActiveObject();commitSourceCrop(plan);changedObject=image;
      }else if(action==='erase'){
        if(!Array.isArray(args.objectIds)||!args.objectIds.length||args.objectIds.length>50||new Set(args.objectIds).size!==args.objectIds.length)throw fail('invalid_argument','objectIds 需要 1–50 个不重复图层 ID');
        if(!Array.isArray(args.points)||args.points.length<2||args.points.length>2048)throw fail('invalid_argument','橡皮擦路径需要 2–2048 个点');
        args.points.forEach(p=>{finite(p.x,'point.x');finite(p.y,'point.y');});const strokeWidth=finite(args.strokeWidth,'strokeWidth',1,100);
        const targets=args.objectIds.map(id=>{const object=canvas.getObjects().find(o=>o.id===id&&!o.excludeFromExport);if(!object)throw fail('missing_object','擦除目标图层不存在');if(object.selectable===false)throw fail('locked_object','图层已锁定，先显式解锁');return object;});
        const path=new fabric.Path(args.points.map((p,i)=>`${i?'L':'M'} ${p.x} ${p.y}`).join(' '),{fill:null,stroke:'#000',strokeWidth,strokeLineCap:'round',strokeLineJoin:'round',globalCompositeOperation:'destination-out',objectCaching:false});
        let prepared;try{prepared=prepareObjectErasure(targets,path,{...fabric,guard});guard();canvas.discardActiveObject();commitObjectErasure(prepared);editedObjectIds=prepared.map(({object})=>object.id);}catch(error){if(prepared)for(const {clipPath}of prepared){try{clipPath.dispose();}catch{}}throw error;}finally{path.dispose();}
      }else if(action==='resize'){
        const width=finite(args.width,'width',16,4096),height=finite(args.height,'height',16,4096);if(!Number.isInteger(width)||!Number.isInteger(height))throw fail('invalid_argument','宽高必须是整数');if(args.background!==undefined&&!CSS.supports('color',args.background))throw fail('invalid_argument','背景颜色无效');guard();canvas.discardActiveObject();editor.width=width;editor.height=height;canvas.setDimensions({width,height});if(args.background!==undefined)canvas.backgroundColor=args.background;editor.fit();
      }else if(action==='undo'||action==='redo'){
        const history=editor.history,snapshot=action==='undo'?history.past.at(-2):history.future.at(-1);if(!snapshot)return {...summary(editor),changed:false};const doc=JSON.parse(snapshot),stage=new fabric.StaticCanvas(null,{width:doc.width,height:doc.height});try{await Promise.all(serializedArtworkFonts(doc.canvas.objects||[]).map(loadFont));guard();await stage.loadFromJSON(doc.canvas,undefined,{signal});guard();const objects=stage.getObjects();stage.remove(...objects);canvas.discardActiveObject();canvas.remove(...canvas.getObjects());canvas.add(...objects);ensureArtworkIds(canvas.getObjects());canvas.backgroundColor=stage.backgroundColor;canvas.backgroundImage=stage.backgroundImage;canvas.overlayColor=stage.overlayColor;canvas.overlayImage=stage.overlayImage;canvas.clipPath=stage.clipPath;stage.backgroundImage=stage.overlayImage=stage.clipPath=undefined;editor.width=doc.width;editor.height=doc.height;canvas.setDimensions({width:doc.width,height:doc.height});action==='undo'?history.undo():history.redo();editor.revision++;editor.fit();editor.refresh();canvas.requestRenderAll();return {...summary(editor),changed:true};}finally{await stage.dispose();}
      }else throw fail('invalid_action','不支持的图片编辑操作');
      editor.setMode('none');editor.record();return {...summary(editor),changed:editor.revision!==revision,...(changedObject?{objectId:changedObject.id}:{}),...(editedObjectIds?{editedObjectIds}:{}),...hierarchyResult};
    }finally{busy=false;}
  }
  return {execute};
}
export {stamp as imageEditorSourceStamp};
