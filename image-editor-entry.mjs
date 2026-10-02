import { Canvas, StaticCanvas, Control, controlsUtils, Rect, Circle, Ellipse, Line, Path, Textbox, FabricImage, FabricObject, PencilBrush, ActiveSelection, Polygon, Group, Point, util, config, loadSVGFromString } from 'fabric';
import { PoseSelection, drawPose } from './image-editor-pose.mjs';
import { DocumentHistory, dimensions, encodePSD } from './image-editor-core.mjs';
import {layoutLinkedImages, needsLinkedImages, linkedImageInputs, loadLinkedImages} from './src/features/image-editor/linked-images.mjs';
import {prepareSourceCrop,commitSourceCrop,prepareObjectErasure,commitObjectErasure} from './src/features/image-editor/object-editing.mjs';
import {createImageEditorAgent, imageEditorSourceStamp} from './src/features/image-editor/agent-bridge.mjs';
import {normalizePose,renderPoseSource} from './src/features/image-editor/agent-pose.mjs';
import {ensureArtworkIds,serializedArtworkFonts} from './src/features/image-editor/group-objects.mjs';
FabricObject.customProperties = ['id', 'name', 'agentSourceNodeId', 'agentPose', 'selectable', 'evented', 'lockMovementX', 'lockMovementY', 'lockScalingX', 'lockScalingY', 'lockRotation'];
// Four-digit JSON rounding accumulates through nested Group transforms on every
// save/undo. Keep the editor's actual fractional geometry when serializing.
config.NUM_FRACTION_DIGITS = 16;
const $ = (s, root = document) => root.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const el = (tag, cls, text) => { const n = document.createElement(tag); n.className = cls || ''; if (text !== undefined) n.textContent = text; return n; };
const icon = name => window.IMAGE_EDITOR_ICONS[name] || '';
const button = (name, title, fn, text) => { const b = el('button', 'ie-button'); b.type = 'button'; b.setAttribute('aria-label', title); b.dataset.ieTip = title; b.innerHTML = text === undefined ? icon(name) : esc(text); b.onclick = fn; return b; };
const presets = ['#1f4a61', '#5f9fc1', '#fab4c7', '#ffecac'];
const fonts = new Map();
let current;
async function loadFont(name) {
  if (fonts.has(name)) return fonts.get(name);
  const f = window.IMAGE_EDITOR_FONTS, key = name.toLowerCase() === 'opensans' ? 'open sans' : name.toLowerCase(), file = f.catalog[key];
  if (!file) return;
  const url = 'assets/fonts/' + encodeURIComponent(file);
  const task = new FontFace(name, `url("${url}")`).load().then(face => { document.fonts.add(face); }); fonts.set(name, task);
  try { await task; } catch (e) { fonts.delete(name); throw Error('字体读取失败：' + name); }
}
function colorChannels(color, context) {
  context.fillStyle=color;const normalized=context.fillStyle;
  if(/^#[0-9a-f]{6}$/i.test(normalized))return [1,3,5].map(i=>parseInt(normalized.slice(i,i+2),16)).concat(255);
  const rgba=normalized.match(/^rgba?\(([^)]+)\)$/);
  if(rgba){const channels=rgba[1].split(',').map(Number);return channels.slice(0,3).concat((channels[3]??1)*255);}
  context.clearRect(0,0,1,1);context.fillRect(0,0,1,1);return [...context.getImageData(0,0,1,1).data];
}
class ImageEditor {
  constructor(node) {
    this.nodeId = node.id; this.sessionId = crypto.randomUUID(); this.sourceNode = node; this.sourceStamp = imageEditorSourceStamp(node); this.width = node.editorDoc?.width || 600; this.height = node.editorDoc?.height || 600;
    this.history = new DocumentHistory(); this.mode = 'none'; this.color = '#f0342c'; this.strokeWidth = 10; this.ratio = 'custom'; this.exportRatio = 2;
    this.alive = true; this.loading = true; this.revision = 0; this.quantity = 4; this.generateType = 'image'; this.listeners = new AbortController();
    this.root = el('section', 'image-editor'); this.root.setAttribute('role', 'dialog'); this.root.setAttribute('aria-label', '图片编辑器'); this.root.tabIndex = -1;
    this.root.innerHTML = '<div class="ie-stage"><div class="ie-artboard"><canvas></canvas></div></div><header class="ie-header"><div class="ie-top-left"></div><div class="ie-context-region"><div class="ie-context"></div></div><div class="ie-top-right"></div></header><nav class="ie-left"></nav><aside class="ie-layers" aria-label="图层"></aside><nav class="ie-toolbar" aria-label="编辑工具"></nav><div class="ie-generation"></div><div class="ie-hint" hidden></div><div class="ie-status" role="status" hidden></div>';
    document.body.append(this.root); document.body.classList.add('media-editing');
    this.canvas = new Canvas($('canvas', this.root), {width:this.width, height:this.height, backgroundColor:'#ffffff', preserveObjectStacking:true, uniformScaling:false, selection:true, fireRightClick:true, stopContextMenu:true});
    this.canvas.on('object:modified', () => {if(this.crop)this.syncCrop();else this.record();}); this.canvas.on('path:created', e => { if(this.eraser)this.erasePath(e.path);else this.record(); });
    this.canvas.on('text:editing:exited', () => this.record());
    for (const event of ['selection:created', 'selection:updated', 'selection:cleared']) this.canvas.on(event, () => { this.context(); this.layers(); });
    this.canvas.on('mouse:down', e => this.pointerDown(e)); this.canvas.on('mouse:move', e => this.pointerMove(e)); this.canvas.on('mouse:up', e => this.pointerUp(e));
    this.canvas.on('mouse:dblclick', e => { if (e.target instanceof FabricImage&&!e.target.clipPath) this.startCrop(); });
    this.build(); this.resizeHandles(); this.events(); this.ready = this.restore(node.editorDoc || {width:600,height:600,canvas:{objects:[],background:'#ffffff'}}).then(async () => { if (!this.alive) return; this.loading = false; this.history.reset(this.document()); this.saved = JSON.stringify(this.document()); this.refresh(); this.root.focus(); if(needsLinkedImages(node))await this.initializeLinkedImages(); }).catch(e=>{if(this.alive){this.loading=false;this.loadError=e;this.status(e.message||'编辑器读取失败');}});
  }
  document() { return {version:1, initialized:true, width:this.width, height:this.height, canvas:this.canvas.toJSON()}; }
  async initializeLinkedImages() {
    const app=window.CanvasApp,inputs=linkedImageInputs(this.nodeId,app.getState());
    if(!inputs.length)return;
    const baseline=JSON.stringify(this.document()),revision=this.revision;
    this.status('正在加载关联图片…');
    const {loaded,failed}=await loadLinkedImages(inputs,async(input,signal)=>{
      const image=await FabricImage.fromURL(await window.LocalAssets.url(input.src),{crossOrigin:'anonymous',signal});
      image.set({id:crypto.randomUUID(),name:input.name});return image;
    },this.listeners.signal);
    if(!this.alive)return;
    const state=app.getState(),currentInputs=linkedImageInputs(this.nodeId,state);
    if(!state.nodes.some(node=>node.id===this.nodeId)||this.revision!==revision||JSON.stringify(this.document())!==baseline||JSON.stringify(currentInputs)!==JSON.stringify(inputs)){
      loaded.forEach(({image})=>image.dispose());this.status('编辑器或关联图片已变化，已取消自动排版');return;
    }
    if(!loaded.length){this.status('关联图片加载失败，可从画布图片菜单重试');return;}
    const placements=layoutLinkedImages(loaded.map(({image})=>({width:image.width,height:image.height})),{width:this.width,height:this.height});
    for(const [index,{image}] of loaded.entries()){
      image.set({...placements[index],originX:'left',originY:'top'});this.canvas.add(image);image.setCoords();
    }
    this.canvas.backgroundColor='#ffffff';this.record();this.fit();
    if(failed.length)this.status(`${failed.length} 张关联图片加载失败，其余图片已排版`);
    else{clearTimeout(this.statusTimer);$('.ie-status',this.root).hidden=true;}
  }
  async restore(doc) {
    this.closeMenu();
    this.loading = true;
    await Promise.all(serializedArtworkFonts(doc.canvas?.objects || []).map(f => loadFont(f).catch(e => this.status(e.message))));
    if (!this.alive) return;
    await this.canvas.loadFromJSON(doc.canvas || {objects:[]}, undefined, {signal:this.listeners.signal});
    if (!this.alive) return;
    ({width:this.width,height:this.height} = dimensions(doc.width,doc.height)); this.canvas.setDimensions({width:this.width,height:this.height}); this.fit(); this.canvas.requestRenderAll(); ensureArtworkIds(this.canvas.getObjects()); this.loading = false; this.revision++; this.refresh();
  }
  record() { if (!this.alive || this.loading || this.crop) return; ensureArtworkIds(this.canvas.getObjects()); if (this.history.push(this.document())) this.revision++; this.refresh(); this.canvas.requestRenderAll(); }
  refresh() { this.context(); this.layers(); this.undoButton.disabled = this.history.past.length < 2; this.redoButton.disabled = !this.history.future.length; }
  status(message) { if (!this.alive) return; const n = $('.ie-status',this.root); n.textContent = message; n.hidden = false; clearTimeout(this.statusTimer); this.statusTimer = setTimeout(() => {n.hidden = true;},5000); }
  safe(fn) { return (...args) => Promise.resolve().then(() => fn(...args)).catch(e => this.status(e.message)); }
  fit() { this.zoom = Math.min(innerWidth / (this.width + 400), innerHeight / (this.height + 400)); this.pan = {x:0,y:0}; this.place(); }
  place() { const board=$('.ie-artboard',this.root); board.style.width=this.width+'px';board.style.height=this.height+'px';board.style.setProperty('--editor-scale',this.zoom);board.style.transform=`translate(${this.pan.x}px,${this.pan.y}px) scale(${this.zoom})`;this.canvas.calcOffset(); }
  build() {
    const left = $('.ie-top-left',this.root);
    this.ratioButton = button('chevron','画布比例',e=>this.ratios(e.currentTarget),'custom'); this.ratioButton.classList.add('ie-ratio'); this.ratioButton.insertAdjacentHTML('beforeend',icon('chevron'));
    this.backgroundButton = button('', '背景颜色',e=>this.colorMenu(e.currentTarget,this.canvas.backgroundColor||'#ffffff',v=>{this.canvas.backgroundColor=v;this.canvas.requestRenderAll();this.record();}));this.backgroundButton.classList.add('ie-bg');left.append(this.ratioButton,this.backgroundButton);
    const right=$('.ie-top-right',this.root);right.append(button('download','导出',e=>this.exportMenu(e.currentTarget)),button('save','保存',this.safe(()=>this.save())),button('close','关闭编辑器',()=>this.requestClose()));
    const side=$('.ie-left',this.root);side.append(button('folder','画布中的图片',e=>this.assets(e.currentTarget,false)),button('history','历史记录',e=>this.assets(e.currentTarget,true)),button('shapes','图形',e=>this.shapes(e.currentTarget)),button('person','姿势生成器',()=>this.pose()));
    const bar=$('.ie-toolbar',this.root),modes=el('div','ie-modes');bar.append(modes);this.modeButtons=new Map();for(const [mode,ico,label] of [['none','select','选择'],['brush','palette','绘画'],['rect','rect','矩形'],['arrow','arrow','箭头'],['pen','pen','钢笔']]){const b=button(ico,label,()=>this.setMode(mode));b.dataset.mode=mode;b.setAttribute('aria-pressed',mode==='none');this.modeButtons.set(mode,b);modes.append(b);}
    bar.append(button('','文字',this.safe(()=>this.addText()),'T'),button('image','上传图片',()=>this.upload()),el('i','ie-divider'));
    this.undoButton=button('undo','撤销',this.safe(()=>this.undo()));this.redoButton=button('redo','重做',this.safe(()=>this.undo(true)));bar.append(this.undoButton,this.redoButton,el('i','ie-divider'),button('fit','适应画布',()=>this.fit()));
    const generation=$('.ie-generation',this.root);this.generationMode=button('photo','生成类型',e=>this.menu(e.currentTarget,p=>{for(const [type,label] of [['image','生成图片'],['video','生成视频']])p.append(button(type==='image'?'photo':'video',label,()=>{this.generateType=type;this.generationMode.innerHTML=icon(type==='image'?'photo':'video');this.closeMenu();},label));}));
    this.prompt=el('textarea');this.prompt.placeholder='请输入图像生成的提示词';this.prompt.setAttribute('aria-label','生成提示词');this.prompt.rows=1;
    const strip=el('div','ie-generate-strip'),count=el('div','ie-count');this.countLabel=el('span','','4');count.append(button('minus','减少生成数量',()=>{this.quantity=Math.max(1,this.quantity-1);this.countLabel.textContent=this.quantity;}),this.countLabel,button('plus','增加生成数量',()=>{this.quantity=Math.min(4,this.quantity+1);this.countLabel.textContent=this.quantity;}));
    this.generateButton=button('generate','生成',this.safe(()=>this.generate()));this.generateButton.append(' 生成');this.generateButton.disabled=true;this.prompt.oninput=()=>{this.generateButton.disabled=!this.prompt.value.trim();};strip.append(this.prompt,count,this.generateButton);generation.append(this.generationMode,strip);
  }
  resizeHandles(){
    const board=$('.ie-artboard',this.root);
    for(const side of ['left','right','top','bottom']){
      const handle=el('div','ie-resize '+side);handle.setAttribute('role','separator');handle.setAttribute('aria-label','调整画布'+({left:'左边缘',right:'右边缘',top:'上边缘',bottom:'下边缘'}[side]));board.append(handle);
      let drag;
      handle.onpointerdown=e=>{e.preventDefault();e.stopPropagation();if(this.crop)return;this.canvas.discardActiveObject();this.resizing=true;drag={x:e.clientX,y:e.clientY,width:this.width,height:this.height,pan:{...this.pan},objects:this.canvas.getObjects().map(o=>({o,left:o.left,top:o.top}))};handle.setPointerCapture(e.pointerId);};
      handle.onpointermove=e=>{if(!drag)return;const horizontal=side==='left'||side==='right',negative=side==='left'||side==='top',raw=Math.round((horizontal?e.clientX-drag.x:e.clientY-drag.y)/this.zoom),original=horizontal?drag.width:drag.height,size=Math.max(16,Math.min(4096,original+(negative?-raw:raw))),delta=(size-original)*(negative?-1:1);this.width=horizontal?size:drag.width;this.height=horizontal?drag.height:size;this.pan={x:drag.pan.x+(horizontal?delta*this.zoom/2:0),y:drag.pan.y+(!horizontal?delta*this.zoom/2:0)};if(negative)for(const {o,left,top}of drag.objects){o.set({left:left-(horizontal?delta:0),top:top-(!horizontal?delta:0)});o.setCoords();}this.canvas.setDimensions({width:this.width,height:this.height});this.place();};
      handle.onpointerup=()=>{if(drag){this.resizing=false;drag=null;this.ratio='custom';this.ratioButton.innerHTML='custom'+icon('chevron');this.record();}};
      handle.onpointercancel=()=>{if(!drag)return;this.resizing=false;this.width=drag.width;this.height=drag.height;this.pan=drag.pan;for(const {o,left,top}of drag.objects)o.set({left,top});this.canvas.setDimensions({width:this.width,height:this.height});this.place();drag=null;};
    }
  }
  events() {
    const opts={signal:this.listeners.signal};window.addEventListener('resize',()=>this.fit(),opts);
    this.root.addEventListener('pointerdown',e=>{if(this.popup&&!this.popup.contains(e.target)&&!this.popupAnchor?.contains(e.target))this.closeMenu();},opts);
    this.root.addEventListener('keydown',e=>this.key(e),opts);
    this.root.addEventListener('paste',e=>{if(e.target.closest('input,textarea,[contenteditable]')||this.canvas.getActiveObject()?.isEditing)return;e.preventDefault();this.safe(async()=>{if(e.target.closest('input,textarea,[contenteditable]')||this.canvas.getActiveObject()?.isEditing)return;const file=[...e.clipboardData.items].find(i=>i.type.startsWith('image/'))?.getAsFile();if(file){e.preventDefault();await this.addFile(file);}else if(this.copied){e.preventDefault();await this.pasteObjects();}else{const text=e.clipboardData.getData('text/plain');if(text){e.preventDefault();await this.addText(text);}}})();},opts);
    const stage=$('.ie-stage',this.root);stage.addEventListener('wheel',e=>{e.preventDefault();const r=this.root.getBoundingClientRect(),x=e.clientX-r.width/2,y=e.clientY-r.height/2;if(e.ctrlKey||e.metaKey){const old=this.zoom;this.zoom=Math.min(8,Math.max(.1,old*Math.exp(-e.deltaY*.002)));this.pan.x=x-(x-this.pan.x)*this.zoom/old;this.pan.y=y-(y-this.pan.y)*this.zoom/old;}else{this.pan.x-=e.deltaX;this.pan.y-=e.deltaY;}this.place();},{...opts,passive:false});
    stage.addEventListener('pointerdown',e=>{if(e.target===stage||e.button===1||this.space){e.preventDefault();this.panning={x:e.clientX,y:e.clientY,pan:{...this.pan}};stage.setPointerCapture(e.pointerId);}},opts);
    stage.addEventListener('pointermove',e=>{if(this.panning){this.pan={x:this.panning.pan.x+e.clientX-this.panning.x,y:this.panning.pan.y+e.clientY-this.panning.y};this.place();}},opts);stage.addEventListener('pointerup',()=>{this.panning=null;},opts);
    window.addEventListener('keyup',e=>{if(e.code==='Space'){this.space=false;this.canvas.skipTargetFind=false;}},opts);
    this.root.addEventListener('dragover',e=>e.preventDefault(),opts);this.root.addEventListener('drop',this.safe(async e=>{e.preventDefault();for(const file of e.dataTransfer.files)if(file.type.startsWith('image/'))await this.addFile(file);}),opts);
  }
  key(e) {
    if(e.target.closest('.ie-modal-shade'))return;
    if(e.target.closest('input,textarea,[contenteditable]')||this.canvas.getActiveObject()?.isEditing)return;
    const mod=e.metaKey||e.ctrlKey;
    if(mod&&['z','y','s','c','v','a','d'].includes(e.key.toLowerCase())){e.preventDefault();e.stopPropagation();const k=e.key.toLowerCase();if(k==='z'||k==='y')this.safe(()=>this.undo(k==='y'||e.shiftKey))();if(k==='s')this.safe(()=>this.save())();if(k==='c')this.copy();if(k==='v')this.safe(()=>this.pasteObjects())();if(k==='d'){this.copy();this.safe(()=>this.pasteObjects())();}if(k==='a'){if(this.crop)this.applyCrop();this.canvas.setActiveObject(new ActiveSelection(this.canvas.getObjects(),{canvas:this.canvas}));this.canvas.requestRenderAll();}return;}
    if(e.key==='Escape'){e.preventDefault();if(this.popup)this.closeMenu();else if(this.crop)this.cancelCrop();else if(this.penPoints?.length)this.finishPen(false);else this.canvas.discardActiveObject().requestRenderAll();}
    if(e.key==='Enter'){if(this.crop)this.applyCrop();else if(this.penPoints?.length)this.finishPen(true);}
    if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();this.remove();}
    if(e.code==='Space'){e.preventDefault();this.space=true;this.canvas.skipTargetFind=true;}
    if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();const step=e.shiftKey?10:1;for(const o of this.canvas.getActiveObjects()){o.left+=e.key==='ArrowLeft'?-step:e.key==='ArrowRight'?step:0;o.top+=e.key==='ArrowUp'?-step:e.key==='ArrowDown'?step:0;o.setCoords();}if(this.crop)this.syncCrop();this.canvas.requestRenderAll();this.record();}
  }
  menu(anchor,build,cls='') { if(this.popupAnchor===anchor){this.closeMenu();return;}this.closeMenu();this.popupAnchor=anchor;this.popupObjects=$('.ie-context',this.root).contains(anchor)?this.canvas.getActiveObjects():null;anchor.setAttribute('aria-expanded','true');this.popup=el('div','ie-popup '+cls);this.popup.setAttribute('role','menu');this.root.append(this.popup);build(this.popup);this.popup.onkeydown=e=>{if(e.target.matches('input,textarea')&&e.key!=='Escape')return;if(e.key==='Escape'){e.preventDefault();e.stopPropagation();const anchor=this.popupAnchor;this.closeMenu();const target=anchor?.isConnected?anchor:[...this.root.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')===anchor?.getAttribute('aria-label'));target?.focus();return;}if(!['ArrowDown','ArrowUp','Home','End'].includes(e.key))return;e.preventDefault();const items=[...this.popup.querySelectorAll('button:not(:disabled)')],i=items.indexOf(document.activeElement);items[e.key==='Home'?0:e.key==='End'?items.length-1:(i+(e.key==='ArrowDown'?1:-1)+items.length)%items.length]?.focus();};const r=anchor.getBoundingClientRect(),p={width:this.popup.offsetWidth,height:this.popup.offsetHeight};if(cls==='ie-assets-menu'){this.popup.style.left=Math.max(8,Math.min(innerWidth-p.width-8,r.right+14))+'px';this.popup.style.top=Math.max(8,Math.min(innerHeight-p.height-8,r.top))+'px';return;}const property=cls.includes('ie-property-menu'),margin=property?0:8,gap=property?14:cls==='ie-font-menu'?12:8;this.popup.style.left=Math.max(margin,Math.min(innerWidth-p.width-margin,r.left))+'px';this.popup.style.top=(r.top>innerHeight*.65?Math.max(8,r.top-p.height-gap):Math.min(innerHeight-p.height-8,r.bottom+gap))+'px'; }
  closeMenu() {this.popup?.remove();this.popup=null;this.popupAnchor?.setAttribute('aria-expanded','false');this.popupAnchor=null;this.popupObjects=null;}
  field(parent,label,value,min,max,onChange,step=1){const row=el('label','ie-field',label),input=el('input');input.type='number';input.value=value;input.min=min;input.max=max;input.step=step;input.setAttribute('aria-label',label);input.onchange=this.safe(()=>{const n=Number(input.value);if(!Number.isFinite(n)||n<min||n>max)throw Error(label+'超出范围');onChange(n);});row.append(input);parent.append(row);return input;}
  colorMenu(anchor,value,apply){this.menu(anchor,p=>this.colorControls(p,value,apply),'ie-color-menu');}
  colorControls(p,value,apply,{compact=false,onCommit=()=>{}}={}){
      const sample=document.createElement('canvas').getContext('2d');const [r,g,b,a]=colorChannels(value,sample);
      const max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min;let h=d?(max===r?((g-b)/d)%6:max===g?(b-r)/d+2:(r-g)/d+4)*60:0;if(h<0)h+=360;let saturation=max?d/max:0,brightness=max/255,alpha=a/255;
      const square=el('div','ie-saturation');square.setAttribute('role','slider');square.setAttribute('aria-label','饱和度和亮度');square.tabIndex=0;const marker=el('i');square.append(marker);
      const hue=el('input','ie-hue');hue.type='range';hue.min=0;hue.max=360;hue.value=h;hue.setAttribute('aria-label','色相');
      const opacity=el('input','ie-alpha');opacity.type='range';opacity.min=0;opacity.max=100;opacity.value=alpha*100;opacity.setAttribute('aria-label','透明度');
      const rgba=el('input','ie-rgba');rgba.setAttribute('aria-label','RGBA');
      const rgb=()=>{const c=brightness*saturation,x=c*(1-Math.abs((h/60)%2-1)),m=brightness-c,base=h<60?[c,x,0]:h<120?[x,c,0]:h<180?[0,c,x]:h<240?[0,x,c]:h<300?[x,0,c]:[c,0,x];return base.map(v=>Math.round((v+m)*255));};
      const update=(commit=true)=>{const channels=rgb(),color=`rgba(${channels.join(',')},${Number(alpha.toFixed(3))})`;square.style.backgroundColor=`hsl(${h} 100% 50%)`;marker.style.left=saturation*100+'%';marker.style.top=(1-brightness)*100+'%';square.setAttribute('aria-valuetext',`饱和度 ${Math.round(saturation*100)}，亮度 ${Math.round(brightness*100)}`);opacity.style.setProperty('--alpha-color',`rgb(${channels.join(',')})`);rgba.value=color;if(commit)apply(color);};
      let dragging=false;const point=e=>{const r=square.getBoundingClientRect();saturation=Math.max(0,Math.min(1,(e.clientX-r.left)/r.width));brightness=1-Math.max(0,Math.min(1,(e.clientY-r.top)/r.height));update();};
      square.onpointerdown=e=>{dragging=true;square.setPointerCapture(e.pointerId);point(e);};square.onpointermove=e=>{if(dragging)point(e);};square.onpointerup=()=>{dragging=false;};square.onpointercancel=()=>{dragging=false;};square.onkeydown=e=>{if(!e.key.startsWith('Arrow'))return;e.preventDefault();saturation=Math.max(0,Math.min(1,saturation+(e.key==='ArrowRight'?.01:e.key==='ArrowLeft'?-.01:0)));brightness=Math.max(0,Math.min(1,brightness+(e.key==='ArrowUp'?.01:e.key==='ArrowDown'?-.01:0)));update();};
      const setColor=color=>{const [r,g,b,a]=colorChannels(color,sample),max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min;h=d?(max===r?((g-b)/d)%6:max===g?(b-r)/d+2:(r-g)/d+4)*60:0;if(h<0)h+=360;saturation=max?d/max:0;brightness=max/255;alpha=a/255;hue.value=h;opacity.value=alpha*100;update();};
      hue.oninput=()=>{h=Number(hue.value);update();};opacity.oninput=()=>{alpha=Number(opacity.value)/100;update();};rgba.oninput=()=>{const value=rgba.value;if(CSS.supports('color',value)){setColor(value);rgba.value=value;}};rgba.onchange=this.safe(()=>{if(!CSS.supports('color',rgba.value))throw Error('颜色格式无效');setColor(rgba.value);});
      const row=el('div','ie-swatches');for(const color of ['#ffffff','#000000',...presets]){const b=button('','颜色 '+color,()=>setColor(color));b.style.background=color;row.append(b);}
      p.append(square,hue,opacity);if(!compact)p.append(rgba,row);else p.classList.add('ie-compact-color');
      for(const n of [square,hue,opacity,rgba]){n.addEventListener('pointerup',onCommit);n.addEventListener('change',onCommit);n.addEventListener('keyup',onCommit);n.addEventListener('blur',onCommit);}update(false);
  }
  ratios(anchor){this.menu(anchor,p=>{for(const ratio of ['custom','16:9','9:16','4:3','3:4','1:1','3:2','2:3','7:4','4:7','21:9']){const b=button('',ratio,()=>{this.ratio=ratio;if(ratio!=='custom'){const [w,h]=ratio.split(':').map(Number);this.resize(Math.round(600*w/Math.max(w,h)),Math.round(600*h/Math.max(w,h)));}this.ratioButton.innerHTML=esc(ratio)+icon('chevron');this.closeMenu();},ratio);p.append(b);}this.field(p,'宽度',this.width,16,4096,n=>this.resize(n,this.height));this.field(p,'高度',this.height,16,4096,n=>this.resize(this.width,n));},'ie-ratio-menu');}
  resize(w,h){dimensions(w,h);this.width=w;this.height=h;this.canvas.setDimensions({width:w,height:h});this.fit();this.record();}
  setMode(mode){if(this.crop)this.applyCrop();if(this.penPoints?.length)this.finishPen(false);this.mode=mode;this.eraser=false;this.canvas.discardActiveObject();this.canvas.selection=mode==='none';this.canvas.skipTargetFind=mode!=='none';this.canvas.isDrawingMode=mode==='brush';this.canvas.defaultCursor=mode==='none'?'default':'crosshair';if(mode==='brush')this.setBrush();for(const [key,b]of this.modeButtons)b.setAttribute('aria-pressed',key===mode);const hint=$('.ie-hint',this.root);hint.textContent='点击画布即可绘制形状。按 Enter 完成，按 ESC 取消。';hint.hidden=mode!=='pen';this.context();}
  erasePath(path){
    this.canvas.remove(path);path.globalCompositeOperation='destination-out';
    try{const stroke=path.getBoundingRect();const targets=this.canvas.getObjects().filter(object=>{if(!object.visible||object.selectable===false||object.excludeFromExport)return false;const bounds=object.getBoundingRect();return bounds.left<=stroke.left+stroke.width&&bounds.left+bounds.width>=stroke.left&&bounds.top<=stroke.top+stroke.height&&bounds.top+bounds.height>=stroke.top;});const prepared=prepareObjectErasure(targets,path,{FabricImage,util});commitObjectErasure(prepared);if(prepared.length)this.record();else this.canvas.requestRenderAll();}
    catch(error){this.canvas.requestRenderAll();this.status(error.message||'擦除失败，图层未修改');}
  }
  setBrush(){const b=new PencilBrush(this.canvas);b.width=this.strokeWidth;b.color=this.eraser?'#000000':this.color;this.canvas.freeDrawingBrush=b;}
  add(object){object.id=crypto.randomUUID();this.canvas.add(object);this.canvas.setActiveObject(object);this.canvas.requestRenderAll();this.record();return object;}
  center(object){object.set({left:this.width/2,top:this.height/2,originX:'center',originY:'center'});return object;}
  async addText(text='我的文本'){await loadFont('OpenSans');if(!this.alive)return;this.setMode('none');return this.add(this.center(new Textbox(text,{width:180,fontSize:40,fontFamily:'OpenSans',fill:this.color})));}
  pointerDown({e,scenePoint:p}){if(this.loading||this.space||e.button!==0||this.crop)return;if(this.mode==='pen'){this.penPoints ||= [];this.penPoints.push({x:p.x,y:p.y});this.previewPen(p);return;}if(!['rect','arrow'].includes(this.mode))return;this.start={x:p.x,y:p.y};this.drawing=this.mode==='rect'?new Rect({left:p.x,top:p.y,width:1,height:1,fill:this.color,selectable:false}):new Path(`M ${p.x} ${p.y} L ${p.x+1} ${p.y+1}`,{fill:null,stroke:this.color,strokeWidth:3,selectable:false});this.canvas.add(this.drawing);}
  pointerMove({scenePoint:p}){if(this.mode==='pen'&&this.penPoints?.length){this.previewPen(p);return;}if(!this.drawing)return;const s=this.start;if(this.mode==='rect')this.drawing.set({left:Math.min(s.x,p.x),top:Math.min(s.y,p.y),width:Math.max(1,Math.abs(p.x-s.x)),height:Math.max(1,Math.abs(p.y-s.y))});else{this.canvas.remove(this.drawing);const a=Math.atan2(p.y-s.y,p.x-s.x),len=16;this.drawing=new Path(`M ${s.x} ${s.y} L ${p.x} ${p.y} M ${p.x-len*Math.cos(a-.5)} ${p.y-len*Math.sin(a-.5)} L ${p.x} ${p.y} L ${p.x-len*Math.cos(a+.5)} ${p.y-len*Math.sin(a+.5)}`,{fill:null,stroke:this.color,strokeWidth:3,selectable:false});this.canvas.add(this.drawing);}this.canvas.requestRenderAll();}
  pointerUp(){if(!this.drawing)return;const o=this.drawing;this.drawing=null;o.set({selectable:true});o.setCoords();this.setMode('none');this.canvas.setActiveObject(o);this.record();}
  previewPen(point){if(this.penPreview)this.canvas.remove(this.penPreview);const points=[...this.penPoints,point];this.penPreview=new Path(points.map((p,i)=>`${i?'L':'M'} ${p.x} ${p.y}`).join(' '),{fill:null,stroke:this.color,strokeWidth:2,selectable:false,evented:false,excludeFromExport:true});this.canvas.add(this.penPreview);this.canvas.requestRenderAll();}
  finishPen(commit){if(this.penPreview)this.canvas.remove(this.penPreview);if(commit&&this.penPoints.length>1)this.add(new Path(this.penPoints.map((p,i)=>`${i?'L':'M'} ${p.x} ${p.y}`).join(' ')+' Z',{fill:this.color,stroke:this.color,strokeWidth:1}));this.penPoints=[];this.penPreview=null;this.canvas.requestRenderAll();if(commit)this.setMode('none');}
  change(patch){for(const o of this.canvas.getActiveObjects()){if(patch.fill&&o instanceof Group){const fillChildren=group=>{for(const child of group.getObjects())child instanceof Group?fillChildren(child):!(child instanceof FabricImage)&&child.set({fill:patch.fill});};fillChildren(o);}o.set(patch);o.setCoords();}this.canvas.requestRenderAll();this.record();}
  remove(){if(this.crop)return;this.canvas.remove(...this.canvas.getActiveObjects());this.canvas.discardActiveObject();this.record();}
  async undo(redo=false){if(this.loading)return;if(this.crop)this.cancelCrop();const doc=redo?this.history.redo():this.history.undo();if(doc)await this.restore(doc);}
  copy(){const ids=new Set(this.canvas.getActiveObjects().map(o=>o.id));this.copied=this.document().canvas.objects.filter(o=>ids.has(o.id));}
  async pasteObjects(){if(!this.copied?.length)return;const objects=await util.enlivenObjects(this.copied);if(!this.alive)return;for(const o of objects){o.id=crypto.randomUUID();o.set({left:o.left+10,top:o.top+10});this.canvas.add(o);}this.setMode('none');this.canvas.setActiveObject(objects.length===1?objects[0]:new ActiveSelection(objects,{canvas:this.canvas}));this.record();}
  order(direction){const items=this.canvas.getActiveObjects();for(const o of direction==='front'?items:[...items].reverse())direction==='front'?this.canvas.bringObjectToFront(o):this.canvas.sendObjectToBack(o);this.canvas.discardActiveObject();this.canvas.requestRenderAll();this.record();}
  layers(){const panel=$('.ie-layers',this.root),scroll=panel.querySelector('.ie-layer-list')?.scrollTop||0;panel.replaceChildren();const up=button('up','向上滚动图层',()=>list.scrollBy({top:-112,behavior:'smooth'})),list=el('div','ie-layer-list'),down=button('down','向下滚动图层',()=>list.scrollBy({top:112,behavior:'smooth'}));panel.append(up,list,down);const selected=this.crop?[this.crop.image]:this.canvas.getActiveObjects();for(const o of [...this.canvas.getObjects()].reverse().filter(o=>!o.excludeFromExport)){const b=button('','选择图层 '+(o.name||o.text||o.type),()=>{if(this.crop)this.applyCrop();this.setMode('none');this.canvas.setActiveObject(o);this.canvas.requestRenderAll();this.layers();});b.classList.add('ie-layer');b.setAttribute('aria-pressed',selected.includes(o));b.draggable=true;b.dataset.objectId=o.id;b.ondragstart=e=>{e.dataTransfer.setData('text/x-editor-layer',o.id);};b.ondragover=e=>e.preventDefault();b.ondrop=e=>{e.preventDefault();e.stopPropagation();const source=this.canvas.getObjects().find(a=>a.id===e.dataTransfer.getData('text/x-editor-layer'));if(source){this.canvas.moveObjectTo(source,this.canvas.getObjects().indexOf(o));this.record();}};if(o instanceof Textbox)b.textContent=o.text;else{try{const img=new Image();img.src=o.toDataURL({multiplier:Math.min(1,48/Math.max(o.getScaledWidth(),o.getScaledHeight(),1))});b.append(img);}catch{b.textContent=o.name||o.type;}}list.append(b);}list.scrollTop=scroll;const limits=()=>{up.disabled=list.scrollTop<=0;down.disabled=list.scrollTop+list.clientHeight>=list.scrollHeight-1;};list.onscroll=limits;requestAnimationFrame(()=>{if(list.isConnected)limits();});this.backgroundButton.style.setProperty('--background',this.canvas.backgroundColor||'transparent');}
  context(){
    const selection=this.canvas.getActiveObjects();
    if(this.popupObjects&&(selection.length!==this.popupObjects.length||selection.some((o,i)=>o!==this.popupObjects[i])))this.closeMenu();
    const bar=$('.ie-context',this.root),anchor=this.popupAnchor,anchorLabel=bar.contains(anchor)?anchor.getAttribute('aria-label'):null,focused=bar.contains(document.activeElement)?document.activeElement.getAttribute('aria-label'):null;
    this.buildContext();
    // Rebuilding properties after a committed gesture must not detach the live
    // popup's trigger or strand keyboard focus on the removed button.
    if(anchorLabel){const replacement=[...bar.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')===anchorLabel);if(replacement){this.popupAnchor=replacement;replacement.setAttribute('aria-expanded','true');}else this.closeMenu();}
    if(focused)[...bar.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')===focused)?.focus({preventScroll:true});
  }
  buildContext(){
    const bar=$('.ie-context',this.root);bar.replaceChildren();bar.classList.remove('ie-image-context','ie-crop-context');
    if(this.mode==='brush'){
      const brush=button('brush','画笔',()=>{this.eraser=false;this.setBrush();this.context();}),eraser=button('eraser','橡皮擦',()=>{this.eraser=true;this.setBrush();this.context();});brush.setAttribute('aria-pressed',!this.eraser);eraser.setAttribute('aria-pressed',this.eraser);bar.append(brush,eraser,button('palette','画笔设置',e=>this.menu(e.currentTarget,p=>{this.field(p,'画笔宽度',this.strokeWidth,1,100,n=>{this.strokeWidth=n;this.setBrush();});const colors=el('div','ie-swatches');for(const color of presets){const b=button('','画笔颜色 '+color,()=>{this.color=color;this.setBrush();});b.style.background=color;colors.append(b);}const input=el('input');input.type='color';input.value=this.color;input.setAttribute('aria-label','自定义画笔颜色');input.oninput=()=>{this.color=input.value;this.setBrush();};p.append(colors,input);})));
      return;
    }
    const o=this.canvas.getActiveObject();if(this.crop){this.cropContext(bar);return;}if(!o||this.canvas.getActiveObjects().length>1)return;
    if(o instanceof FabricImage){bar.classList.add('ie-image-context');const cutout=button('cutout','抠图',this.safe(()=>this.generate('image.remove-background')));cutout.classList.add('ie-cutout');cutout.disabled=this.pendingObjects?.has(o.id)||false;cutout.insertAdjacentHTML('afterbegin','<div class="ie-uiverse">'+Array.from({length:12},(_,i)=>'<div class="circle circle-'+(12-i)+'"></div>').join('')+'</div>');cutout.append('抠图');bar.append(cutout);}
    bar.append(button('reset','重置位置',()=>{const scale=o.getScaledWidth()/o.getScaledHeight()>=this.width/this.height?this.width/o.width:this.height/o.height;o.set({scaleX:scale,scaleY:scale});this.center(o);o.setCoords();this.canvas.requestRenderAll();this.record();}),button('front','置于顶层',()=>this.order('front')),button('back','置于底层',()=>this.order('back')),button('delete','删除对象',()=>this.remove()),el('i','ie-divider'));
    if(!(o instanceof FabricImage)){const fill=button('','填充颜色',e=>this.colorMenu(e.currentTarget,o.fill||this.color,v=>this.change({fill:v})));fill.classList.add('ie-fill');fill.style.setProperty('--fill',typeof o.fill==='string'?o.fill:'#000');bar.append(fill);}
    if(o instanceof Textbox){
      const font=button('chevron','字体',e=>this.fontMenu(e.currentTarget),o.fontFamily);font.classList.add('ie-font');font.insertAdjacentHTML('beforeend',icon('chevron'));bar.append(font);
      for(const [ico,label,key,on,off,text]of [['','粗体','fontWeight','bold','normal','B'],['italic','斜体','fontStyle','italic','normal'],['underline','下划线','underline',true,false],['strike','删除线','linethrough',true,false]]){const b=button(ico,label,()=>this.change({[key]:o[key]===on?off:on}),text);b.setAttribute('aria-pressed',o[key]===on);bar.append(b);}
      bar.append(button(o.textAlign==='center'?'alignCenter':o.textAlign==='right'?'alignRight':'align','对齐方式',()=>{const list=['left','center','right'];this.change({textAlign:list[(list.indexOf(o.textAlign)+1)%list.length]});}),button('spacing','文字间距',e=>this.spacing(e.currentTarget,o)));
    }
    const reset=bar.querySelector('[aria-label=重置位置]');reset.classList.add('ie-reset-expand');reset.append(el('span','','重置位置'));
    if(o instanceof FabricImage){bar.append(button('crop','裁剪',()=>this.startCrop()),button('flipX','水平翻转',()=>this.change({flipX:!o.flipX})),button('flipY','垂直翻转',()=>this.change({flipY:!o.flipY})));}
    else if(!(o instanceof Group))bar.append(button('stroke','边框',e=>this.strokeMenu(e.currentTarget,o)));
    if(o instanceof Rect)bar.append(button('rect','圆角',e=>this.menu(e.currentTarget,p=>this.range(p,'圆角',o.rx||0,0,100,1,n=>this.previewProperty(o,{rx:n,ry:n})),'ie-property-menu')));
    bar.append(button('opacity','不透明度',e=>this.menu(e.currentTarget,p=>this.range(p,'透明度',o.opacity,0,1,.001,n=>this.previewProperty(o,{opacity:n})),'ie-property-menu')));
  }
  range(parent,label,value,min,max,step,preview){
    const row=el('label','ie-range-field'),header=el('span','ie-range-heading'),current=el('output','',value),input=el('input');header.append(el('span','',label),current);input.type='range';input.min=min;input.max=max;input.step=step;input.value=value;input.setAttribute('aria-label',label);
    const paint=()=>{current.textContent=Number(input.value);input.style.setProperty('--range-progress',((Number(input.value)-min)/(max-min)*100)+'%');};paint();
    let pending=false;const commit=()=>{if(!pending)return;pending=false;this.record();};input.oninput=()=>{pending=true;paint();preview(Number(input.value));};input.onchange=commit;input.onpointercancel=commit;input.onblur=commit;row.append(header,input);parent.append(row);return input;
  }
  previewProperty(object,patch){if(!this.canvas.getObjects().includes(object))return;object.set(patch);object.setCoords();this.canvas.requestRenderAll();}
  spacing(anchor,o){this.menu(anchor,p=>{this.range(p,'字间距',o.charSpacing,-100,100,.01,n=>this.previewProperty(o,{charSpacing:n}));this.range(p,'行高',o.lineHeight,.01,10,.01,n=>this.previewProperty(o,{lineHeight:n}));},'ie-property-menu');}
  strokeMenu(anchor,o){this.menu(anchor,p=>{
    const picker=el('div'),sync=()=>{picker.hidden=!o.strokeWidth;};
    const input=this.range(p,'边框宽度',o.strokeWidth||0,0,20,.001,n=>{this.previewProperty(o,{strokeWidth:n});sync();});
    const styles=el('div','ie-stroke-styles');for(const [key,label,patch]of [['strokeNone','无',{strokeWidth:0}],['strokeSolid','实线',{strokeWidth:2,strokeDashArray:null}],['strokeDashed','虚线',{strokeWidth:2,strokeDashArray:[5,10]}]])styles.append(button(key,label,()=>{this.previewProperty(o,patch);input.value=o.strokeWidth;input.dispatchEvent(new Event('input'));this.record();sync();}));
    this.colorControls(picker,o.stroke||'#ffffff',color=>this.previewProperty(o,{stroke:color}),{compact:true,onCommit:()=>this.record()});p.append(styles,picker);sync();
  },'ie-property-menu ie-stroke-menu');}
  fontMenu(anchor){this.menu(anchor,p=>{
    const list=el('div','ie-font-list');p.append(list);for(const name of Object.keys(window.IMAGE_EDITOR_FONTS.catalog)){
      const b=button('',name,this.safe(async()=>{const target=this.canvas.getActiveObject();await loadFont(name);if(!this.alive||!this.canvas.getObjects().includes(target))return;target.set({fontFamily:name});target.setCoords();this.canvas.requestRenderAll();this.record();this.closeMenu();}),name);delete b.dataset.ieTip;b.setAttribute('role','menuitem');b.classList.toggle('is-current',this.canvas.getActiveObject()?.fontFamily===name);
      const show=()=>{b.style.fontFamily=name;b.classList.add('is-loaded');};if(fonts.has(name))show();b.onpointerenter=b.onfocus=()=>loadFont(name).then(()=>{if(b.isConnected)show();}).catch(()=>{});list.append(b);
    }
  },'ie-font-menu');}
  shapes(anchor){this.menu(anchor,p=>{p.append(el('h3','','基本图形'));const grid=el('div','ie-shapes-grid');for(const [ico,label,make]of [['rect','矩形',()=>new Rect({width:150,height:120,fill:this.color})],['circle','圆形',()=>new Circle({radius:75,fill:this.color})],['line','直线',()=>new Line([0,0,160,0],{stroke:this.color,strokeWidth:3})]])grid.append(button(ico,label,()=>{this.setMode('none');this.add(this.center(make()));this.closeMenu();}));p.append(grid,el('h3','','SVG图形'));const svgGrid=el('div','ie-shapes-grid');for(const [i,name]of ['星形','三角形','SVG 圆形'].entries()){const url=`assets/image-editor-shape-${i}.svg`,b=button('',name,this.safe(async()=>{const response=await fetch(url);if(!response.ok)throw Error('图形资源读取失败');const {objects,options}=await loadSVGFromString(await response.text());if(!this.alive)return;this.setMode('none');this.add(this.center(util.groupSVGElements(objects.filter(Boolean),options)));this.closeMenu();}));const image=new Image();image.src=url;image.alt=name;image.width=24;image.height=24;b.append(image);svgGrid.append(b);}p.append(svgGrid);},'ie-shapes-menu');}
  upload(){const input=el('input');input.type='file';input.accept='image/*';input.multiple=true;input.onchange=this.safe(async()=>{for(const file of input.files)await this.addFile(file);});input.click();}
  async addFile(file){if(file.size>40*1024*1024)throw Error('图片不能超过 40MB');const src=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('图片读取失败'));reader.readAsDataURL(file);});return this.addImage(src,file.name);}
  async addImage(src,name='图片',properties={}){const image=await FabricImage.fromURL(await window.LocalAssets.url(src),{crossOrigin:'anonymous'});if(!this.alive)return;const scale=Math.min(this.width/image.width,this.height/image.height);image.set({scaleX:scale,scaleY:scale,name,...properties});this.setMode('none');return this.add(this.center(image));}
  assets(anchor,history){this.menu(anchor,p=>{
    const state=window.CanvasApp.getState(),generated=new Set((window.GenerationAPI?.getJobs()||[]).filter(j=>j.status==='succeeded').flatMap(j=>j.resultIds||[]));
    const incoming=new Set(state.edges.filter(e=>e.target===this.nodeId).map(e=>e.source));
    const images=state.nodes.filter(n=>n.type==='image'&&n.image).map(n=>({id:n.id,name:n.title,image:n.image,fullImage:n.fullImage}));
    const histories=[...images.filter(n=>generated.has(n.id)),...(window.SIDEBAR_DATA?.history||[]).filter(n=>n.image)];
    const tabs=el('div','ie-asset-tabs'),body=el('div','ie-asset-body'),grid=el('div','ie-assets-grid');body.append(grid);p.append(tabs,body);
    if(history){p.classList.add('ie-history-menu');const backdrop=el('div','ie-history-glow');for(let i=0;i<4;i++)backdrop.append(el('i'));p.prepend(backdrop);}
    const render=linked=>{
      grid.replaceChildren();for(const t of tabs.children)t.setAttribute('aria-selected',String(t.dataset.linked===String(linked)));
      const items=history?histories:images.filter(n=>!linked||incoming.has(n.id));
      if(!items.length){grid.append(el('p','ie-assets-empty','未找到图片'));return;}
      for(const n of items){const b=button('',n.name||'图片',this.safe(async()=>{b.disabled=true;try{await this.addImage(n.fullImage||n.image,n.name);}finally{b.disabled=false;}}));delete b.dataset.ieTip;const img=new Image();img.src=n.image;img.alt=n.name||'图片';img.loading='lazy';b.append(img);if(!history){const overlay=el('span','ie-asset-add');overlay.innerHTML=icon('plus');b.append(overlay);}grid.append(b);}
    };
    tabs.setAttribute('role','tablist');for(const [linked,label]of history?[[false,`图片历史 (${histories.length})`]]:[[false,'画布中的图片'],[true,'关联的图片']]){const b=button('',label,()=>render(linked),label);delete b.dataset.ieTip;b.dataset.linked=linked;b.setAttribute('role','tab');tabs.append(b);}render(false);
  },'ie-assets-menu');}
  pose(){
    this.closeMenu();const modal=this.modal('姿势生成器'),model=new PoseSelection(),stage=el('canvas','ie-pose'),wrap=el('div','ie-pose-wrap'),palette=el('div','ie-pose-colors');
    this.poseDialog=modal.root;modal.root.classList.add('ie-pose-modal');stage.width=600;stage.height=440;stage.setAttribute('aria-label','姿势关节编辑画布');const ctx=stage.getContext('2d');let color='red';
    const draw=()=>{drawPose(ctx,model,color);stage.style.cursor=model.drag?'grabbing':model.marquee?'crosshair':model.selected.size?'move':'pointer';};
    for(const name of ['red','blue','green','yellow']){const b=button('',name,()=>{color=name;for(const c of palette.children)c.setAttribute('aria-pressed',c===b);draw();});delete b.dataset.ieTip;b.style.backgroundColor=name;b.setAttribute('aria-pressed',name===color);palette.append(b);}
    const pos=e=>{const r=stage.getBoundingClientRect();return[(e.clientX-r.left)*600/r.width,(e.clientY-r.top)*440/r.height];};
    stage.onpointerdown=e=>{e.preventDefault();model.down(pos(e),e.ctrlKey||e.metaKey);stage.setPointerCapture(e.pointerId);draw();};stage.onpointermove=e=>{if(model.drag||model.marquee){model.move(pos(e));draw();}};stage.onpointerup=stage.onpointercancel=()=>{model.up();draw();};
    wrap.append(stage,palette);const bottom=el('div','ie-pose-bottom'),instructions=el('div','ie-pose-instructions');for(const text of ['拖拽关节点来调整火柴人的姿势','按住 Ctrl/Cmd 点击关节可多选，拖拽空白区域进行框选','选中关节后可拖拽整体移动'])instructions.append(el('p','',text));
    modal.actions.append(button('','重置姿势',()=>{model.reset();draw();},'重置姿势'),button('','生成姿势',this.safe(async()=>{const rendered=renderPoseSource(normalizePose({color,joints:model.points}));await this.addImage(rendered.source,'姿势',{agentPose:rendered.metadata});modal.dismiss();}),'生成姿势'));
    bottom.append(instructions,modal.actions);modal.body.append(wrap,bottom);draw();
  }
  cropContext(bar){
    const {image,rect}=this.crop;
    bar.classList.add('ie-crop-context');
    bar.append(button('reset','重置位置',()=>{rect.set({scaleX:image.scaleX,scaleY:image.scaleY,width:image.width,height:image.height});rect.setPositionByOrigin(image.getCenterPoint(),'center','center');rect.setCoords();this.syncCrop();this.canvas.requestRenderAll();}),button('front','置于顶层',()=>{this.applyCrop();this.canvas.setActiveObject(image);this.order('front');}),button('back','置于底层',()=>{this.applyCrop();this.canvas.setActiveObject(image);this.order('back');}),button('delete','删除对象',()=>{this.cancelCrop();this.remove();}),el('i','ie-divider'),button('cropDone','完成裁剪',()=>this.applyCrop()));
  }
  startCrop(){
    const image=this.canvas.getActiveObject();if(!(image instanceof FabricImage)||image.clipPath||this.crop)return;this.closeMenu();this.setMode('none');
    const center=image.getCenterPoint(),source=image.getElement(),original={};for(const key of ['left','top','width','height','cropX','cropY','selectable'])original[key]=image[key];
    const fullWidth=source.naturalWidth||source.width,fullHeight=source.naturalHeight||source.height,matrix=image.calcTransformMatrix();
    const fullCenter=new Point((fullWidth-image.width)/2-(image.cropX||0),(fullHeight-image.height)/2-(image.cropY||0)).transform(matrix);
    image.set({cropX:0,cropY:0,width:fullWidth,height:fullHeight,selectable:false});image.setPositionByOrigin(fullCenter,'center','center');image.setCoords();
    const overlay=new Rect({left:fullCenter.x,top:fullCenter.y,originX:'center',originY:'center',width:fullWidth,height:fullHeight,scaleX:image.scaleX,scaleY:image.scaleY,angle:image.angle,fill:'rgba(0,0,0,.5)',strokeWidth:0,selectable:false,evented:false,excludeFromExport:true});
    const rect=new Rect({left:center.x,top:center.y,originX:'center',originY:'center',width:original.width,height:original.height,scaleX:image.scaleX,scaleY:image.scaleY,angle:image.angle,fill:'rgba(255,255,255,.3)',globalCompositeOperation:'overlay',strokeWidth:0,borderColor:'#ffffff80',excludeFromExport:true,lockRotation:true,lockScalingFlip:true,cornerSize:44});
    const glyph=new Image();glyph.src='data:image/svg+xml;base64,'+btoa(icon('cropResize'));glyph.onload=()=>{if(this.alive&&this.crop?.rect===rect)this.canvas.requestRenderAll();};
    rect.controls={br:new Control({x:.5,y:.5,offsetX:-22,offsetY:-22,cursorStyleHandler:controlsUtils.scaleSkewCursorStyleHandler,actionHandler:controlsUtils.scalingEqually,getActionName:controlsUtils.scaleOrSkewActionName,render:(ctx,x,y)=>{ctx.save();ctx.fillStyle='#33a8ff';ctx.strokeStyle='#ffffff80';ctx.lineWidth=1;ctx.beginPath();ctx.arc(x,y,14,0,Math.PI*2);ctx.fill();ctx.stroke();if(glyph.complete&&glyph.naturalWidth)ctx.drawImage(glyph,x-11,y-11,22,22);ctx.restore();}})};
    this.crop={image,rect,overlay,original,values:{x:original.cropX||0,y:original.cropY||0,width:original.width,height:original.height}};
    this.canvas.add(overlay,rect);this.canvas.setActiveObject(rect);this.canvas.requestRenderAll();this.context();this.layers();
    rect.on('moving',()=>this.syncCrop());rect.on('scaling',()=>this.syncCrop());
    rect.on('deselected',()=>{const crop=this.crop;queueMicrotask(()=>{if(this.alive&&this.crop===crop&&crop)this.applyCrop();});});
  }
  syncCrop(){
    if(!this.crop)return;const {image,rect}=this.crop,transform=image.calcTransformMatrix(),inv=util.invertTransform(transform);
    const bounds=()=>{rect.setCoords();const local=rect.getCoords().map(p=>p.transform(inv));return{x:Math.min(...local.map(p=>p.x))+image.width/2,y:Math.min(...local.map(p=>p.y))+image.height/2,right:Math.max(...local.map(p=>p.x))+image.width/2,bottom:Math.max(...local.map(p=>p.y))+image.height/2};};
    let box=bounds();const scale=Math.min(1,image.width/(box.right-box.x),image.height/(box.bottom-box.y));if(scale<1){rect.scaleX*=scale;rect.scaleY*=scale;box=bounds();}
    const dx=box.x<0?-box.x:box.right>image.width?image.width-box.right:0,dy=box.y<0?-box.y:box.bottom>image.height?image.height-box.bottom:0;
    rect.left+=transform[0]*dx+transform[2]*dy;rect.top+=transform[1]*dx+transform[3]*dy;box=bounds();
    const x=Math.max(0,box.x),y=Math.max(0,box.y);this.crop.values={x,y,width:Math.min(image.width-x,box.right-box.x),height:Math.min(image.height-y,box.bottom-box.y)};
  }
  finishCropPreview(){const crop=this.crop;if(!crop)return;this.crop=null;this.canvas.remove(crop.rect,crop.overlay);crop.image.set({selectable:crop.original.selectable});this.canvas.requestRenderAll();this.context();this.layers();return crop;}
  cancelCrop(){if(!this.crop)return;const {image,original}=this.crop;image.set(original);image.setCoords();this.finishCropPreview();this.canvas.setActiveObject(image);this.canvas.requestRenderAll();}
  applyCrop(){
    if(!this.crop)return;const {image,values}=this.crop;
    commitSourceCrop(prepareSourceCrop(image,values,{Point}));this.finishCropPreview();this.record();
  }
  modal(title){
    this.closeMenu();const returnFocus=document.activeElement,root=el('div','ie-modal-shade'),panel=el('section','ie-modal'),header=el('header'),body=el('div','ie-modal-body'),actions=el('footer');
    const dismiss=()=>{root.remove();if(this.closePrompt?.root===root)this.closePrompt=null;if(returnFocus?.isConnected)returnFocus.focus({preventScroll:true});else if(this.alive)this.root.focus({preventScroll:true});};
    const close=button('close','关闭对话框',dismiss);panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-label',title);header.append(el('h2','',title),close);panel.append(header,body,actions);root.append(panel);this.root.append(root);
    root.onpointerdown=e=>{e.stopPropagation();if(e.target===root)dismiss();};
    root.onkeydown=e=>{e.stopPropagation();if(e.key==='Escape'){e.preventDefault();dismiss();return;}if(e.key==='Tab'){const items=[...panel.querySelectorAll('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),[tabindex="0"]')].filter(item=>!item.hidden);const first=items[0],last=items.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}};close.focus();return{root,body,actions,close,dismiss};
  }
  async renderExport(multiplier=1,background){const data=this.document();const c=new StaticCanvas(null,{width:this.width,height:this.height,enableRetinaScaling:false});try{await c.loadFromJSON(data.canvas);if(background)c.backgroundColor=background;return c.toCanvasElement(multiplier);}finally{await c.dispose();}}
  download(blob,name){const url=URL.createObjectURL(blob),a=el('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
  exportMenu(anchor){this.menu(anchor,p=>{for(const [type,label]of [['png','导出 PNG'],['jpeg','导出 JPG'],['psd','导出 PSD']])p.append(button('download',label,this.safe(async()=>{this.closeMenu();await this.export(type);}),label));this.field(p,'导出比例',this.exportRatio,1,4,n=>{this.exportRatio=n;});});}
  async exportPSD(){
    if(this.crop)this.applyCrop();
    const doc=this.document(),objects=await util.enlivenObjects(doc.canvas.objects),width=this.width*this.exportRatio,height=this.height*this.exportRatio;
    if(width>4096||height>4096)throw Error('PSD 输出宽高不能超过 4096 像素，请降低导出比例');
    if(width*height*Math.max(1,objects.length)>32*1024*1024)throw Error('PSD 图层像素过多，请减少图层或尺寸');
    const composite=await this.renderExport(this.exportRatio),layers=[];
    // An eraser affects only content below it. Bake those alpha masks into each
    // preceding layer so the PSD composite agrees with the canvas export.
    const renderLayer=async(object,index)=>{
      const c=new StaticCanvas(null,{width:this.width,height:this.height,enableRetinaScaling:false});
      try{
        if(object){const clone=await object.clone();clone.visible=true;c.add(clone);}else c.backgroundColor=doc.canvas.background;
        for(const eraser of objects.slice(index+1).filter(o=>o.globalCompositeOperation==='destination-out'&&o.visible))c.add(await eraser.clone());
        c.renderAll();return c.toCanvasElement(this.exportRatio).getContext('2d').getImageData(0,0,width,height).data;
      }finally{await c.dispose();}
    };
    if(doc.canvas.background)layers.push({name:'背景',pixels:await renderLayer(null,-1)});
    for(const [i,o]of objects.entries())if(o.globalCompositeOperation!=='destination-out')layers.push({name:o.name||o.text||o.type,hidden:!o.visible,pixels:await renderLayer(o,i)});
    const bytes=encodePSD(width,height,layers,composite.getContext('2d').getImageData(0,0,width,height).data);
    return new Blob([bytes],{type:'image/vnd.adobe.photoshop'});
  }
  async export(type){
    if(this.crop)this.applyCrop();
    if(this.width*this.height*this.exportRatio**2>32*1024*1024&&type!=='psd')throw Error('导出尺寸过大，请降低导出比例');
    if(type==='psd'){this.download(await this.exportPSD(),'Image Editor.psd');this.status('PSD 已导出；图层保留为独立像素层');return;}
    const c=await this.renderExport(this.exportRatio);if(type==='jpeg'){const ctx=c.getContext('2d');ctx.save();ctx.globalCompositeOperation='destination-over';ctx.fillStyle='#ffffff';ctx.fillRect(0,0,c.width,c.height);ctx.restore();}const blob=await new Promise(resolve=>c.toBlob(resolve,'image/'+type,.95));if(!blob)throw Error('导出失败');this.download(blob,'Image Editor.'+(type==='jpeg'?'jpg':type));this.status('图片已导出');
  }
  async save({signal,guard}={}){
    if(this.loading||this.saving)throw Error('编辑器仍在加载或保存');if(this.crop)this.applyCrop();
    const app=window.CanvasApp,source=this.sourceNode,version=this.revision,doc=this.document(),serialized=JSON.stringify(doc);
    const validate=()=>{signal?.throwIfAborted();guard?.();const node=app.getState().nodes.find(n=>n.id===this.nodeId);if(!this.alive||node!==source||imageEditorSourceStamp(node)!==this.sourceStamp)throw Error('来源节点已变化，请重新打开编辑器');if(this.revision!==version||JSON.stringify(this.document())!==serialized)throw Error('图片在保存时发生变化，请重新保存');return node;};
    validate();this.saving=true;let applied=false;
    try{
      const full=await this.renderExport(1);validate();
      const cover=el('canvas'),scale=Math.min(1,600/Math.max(this.width,this.height));cover.width=Math.max(1,Math.round(this.width*scale));cover.height=Math.max(1,Math.round(this.height*scale));cover.getContext('2d').drawImage(full,0,0,cover.width,cover.height);
      const fullImage=full.toDataURL('image/png'),image=cover.toDataURL('image/png');const node=validate();
      app.updateNode(this.nodeId,{editorDoc:doc,image,fullImage,height:node.width*this.height/this.width});applied=true;this.sourceStamp=imageEditorSourceStamp(node);const appliedStamp=this.sourceStamp;
      const state=app.getState();if(!window.CanvasStore?.save)throw Error('本地画布存储不可用');if(await window.CanvasStore.save({version:1,nodes:state.nodes,edges:state.edges})===false)throw Error('本地画布保存未完成');
      // Persistence cannot be cancelled after apply. Return the durable receipt,
      // retaining any edits made while IndexedDB was writing as dirty state.
      this.saved=serialized;const currentMatches=this.alive&&current===this&&this.revision===version&&JSON.stringify(this.document())===serialized&&app.getState().nodes.find(n=>n.id===this.nodeId)===source&&imageEditorSourceStamp(source)===appliedStamp;this.status(currentMatches?'已保存':'本次版本已保存，当前编辑内容已变化');return {applied:true,saved:true,nodeId:this.nodeId,savedRevision:version,currentMatches};
    }catch(error){error.applied=applied;error.saved=false;error.currentMatches=this.alive&&current===this&&this.revision===version&&JSON.stringify(this.document())===serialized&&app.getState().nodes.find(n=>n.id===this.nodeId)===source&&imageEditorSourceStamp(source)===this.sourceStamp;if(applied)this.status('已更新画布，但本地保存失败，可重试保存');throw error;}finally{this.saving=false;}
  }
  requestClose(){
    if(this.closePrompt?.root.isConnected){this.closePrompt.close.focus();return;}
    if(this.loading||this.saving){this.status('正在加载或保存，请稍候');return;}
    if(JSON.stringify(this.document())===this.saved){this.close();return;}
    const modal=this.closePrompt=this.modal('有未保存的更改，需要保存后再退出吗？');this.field(modal.body,'导出比例',this.exportRatio,1,4,n=>{this.exportRatio=n;});modal.body.append(el('p','',`尺寸大小: ${this.width*this.exportRatio} x ${this.height*this.exportRatio} px`));
    const save=button('save','保存并关闭',this.safe(async()=>{save.disabled=true;try{const receipt=await this.save();if(receipt.saved&&receipt.currentMatches&&this.alive&&modal.root.isConnected)this.close();else if(this.alive)this.status('保存期间编辑内容发生变化，请确认当前内容后再退出');}finally{if(save.isConnected)save.disabled=false;}}),'保存并关闭');
    modal.actions.append(button('','直接退出',()=>this.close(),'直接退出'),save);
  }
  async generate(kind){
    if(this.crop)this.applyCrop();
    const prompt=this.prompt.value.trim();if(!kind&&!prompt)return;
    const o=this.canvas.getActiveObject(),request={kind:kind||this.generateType+'.generate',label:kind==='image.remove-background'?'图片抠图':'图片编辑器生成',nodeId:this.nodeId,prompt,count:kind?1:this.quantity,parameters:{width:this.width,height:this.height},referenceBindings:[],editorContext:{revision:this.revision,objectId:o?.id||null,document:this.document()}};
    const objectTask=kind==='image.remove-background'&&o instanceof FabricImage;
    // Object services receive the untransformed source window. Applying the
    // returned pixels must not bake the existing rotation or flips twice.
    let snapshot;
    if(objectTask){snapshot=el('canvas');snapshot.width=o.width;snapshot.height=o.height;snapshot.getContext('2d').drawImage(o.getElement(),o.cropX||0,o.cropY||0,o.width,o.height,0,0,o.width,o.height);}
    else snapshot=await this.renderExport();
    if(!this.alive)return;request.references=[{type:'image',url:snapshot.toDataURL('image/png')}];
    if(request.editorContext.revision!==this.revision)throw Error('画布已变化，请重新发起生成');
    if(!objectTask){const job=window.GenerationAPI.submit(request);this.status(job.status==='configuration_required'?'待连接 API':'已创建生成任务，可在任务面板查看');return job;}
    if(this.pendingObjects?.has(o.id))throw Error('此图片正在处理中');
    this.pendingObjects ||= new Set();this.pendingObjects.add(o.id);this.context();
    const revision=this.revision,guard=()=>{if(!this.alive||this.revision!==revision||!this.canvas.getObjects().includes(o)||!window.CanvasApp.getState().nodes.some(n=>n.id===this.nodeId))throw Error('图片或编辑器已变化，请重新发起抠图');};
    let renderedOpacity;
    const before=()=>{renderedOpacity=o.opacity;o.opacity*=.5;},after=()=>{o.opacity=renderedOpacity;};
    this.canvas.on('before:render',before);this.canvas.on('after:render',after);this.canvas.requestRenderAll();
    try{
      this.status(window.GenerationAPI.isConfigured()?'正在抠图…':'待连接 API');
      return await window.GenerationAPI.runInPlace(request,{type:'image',guard,apply:async output=>{
        const replacement=await FabricImage.fromURL(await window.LocalAssets.url(output.image||output.url),{crossOrigin:'anonymous'});guard();
        const center=o.getCenterPoint(),width=o.getScaledWidth(),height=o.getScaledHeight();o.setElement(replacement.getElement());o.set({cropX:0,cropY:0,scaleX:width/o.width,scaleY:height/o.height});o.setPositionByOrigin(center,'center','center');o.setCoords();this.record();this.status('抠图完成');
      }});
    }finally{this.canvas.off('before:render',before);this.canvas.off('after:render',after);this.pendingObjects.delete(o.id);if(this.alive){this.canvas.requestRenderAll();this.context();}}
  }
  close(){if(!this.alive)return;this.alive=false;this.listeners.abort();clearTimeout(this.statusTimer);this.closeMenu();this.canvas.dispose();this.root.remove();document.body.classList.remove('media-editing');if(current===this)current=null;document.querySelector('#canvas')?.focus({preventScroll:true});}
}
function renderNode(node,element){if(node.tool!=='image-editor')return;element.classList.add('image-editor-node');const body=$('.node-body',element);if(body.querySelector('.ie-open-node'))return;const open=button('image','打开编辑器',e=>{e.stopPropagation();openEditor(node);},'打开编辑器');open.classList.add('ie-open-node');open.onpointerdown=e=>e.stopPropagation();body.append(open);}
function openEditor(node){if(current){if(current.nodeId===node.id)return current;current.requestClose();return null;}window.CanvasApp.select(null);current=new ImageEditor(node);return current;}
window.CanvasImageEditor={create(point,options={}){
  const {width,height}=dimensions(options.width||600,options.height||600),app=window.CanvasApp;
  const patch={tool:'image-editor',width:600,height:600*height/width,...(options.agentImageEditor?{agentImageEditor:options.agentImageEditor}:{}),editorDoc:{version:1,initialized:false,width,height,canvas:{objects:[],background:'#ffffff'}}};
  let n;
  if(options.agentImageEditor){
    // Import the editor and incoming references together as one undoable graph.
    const id=crypto.randomUUID(),view=app.getState().view,world={x:(point.x-view.x)/view.scale,y:(point.y-view.y)/view.scale};
    const graph=app.pasteGraph({nodes:[{id,type:'image',title:options.title||'Image Editor',x:world.x,y:world.y,image:null,...patch}],edges:(options.sourceNodeIds||[]).map(source=>({source,target:id,sourceHandle:'right',targetHandle:'left'}))},world,0);
    n=app.getState().nodes.find(node=>node.id===graph.nodes[0].id);
  }else n=app.addNode('image',point,null,options.title||'Image Editor',patch);
  const element=document.querySelector(`.node[data-id="${CSS.escape(n.id)}"]`);if(element)renderNode(n,element);openEditor(n);return n;
},open:openEditor,renderNode,get current(){return current;}};
window.CanvasImageEditor.agent=createImageEditorAgent({getCurrent:()=>current,open:openEditor,create:(...args)=>window.CanvasImageEditor.create(...args),app:window.CanvasApp,fabric:{Rect,Ellipse,Line,Path,Textbox,FabricImage,StaticCanvas,Group,Point,util},loadFont,fontCatalog:()=>window.IMAGE_EDITOR_FONTS.catalog,store:window.CanvasStore});
document.addEventListener('canvas:render',event=>{if(event?.detail?.viewportOnly)return;for(const n of window.CanvasApp.getState().nodes)if(n.tool==='image-editor'){const e=document.querySelector(`.node[data-id="${CSS.escape(n.id)}"]`);if(e)renderNode(n,e);}});
