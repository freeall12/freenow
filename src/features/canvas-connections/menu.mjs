import {draft as worldDraft} from '../world-node/model.mjs';
import {icons} from './icons.mjs';
import {menuPosition} from './geometry.mjs';

const descriptions = {text: '脚本、广告词、品牌文案', image: '宣传图、海报、封面', video: '宣传视频、动画、电影', audio: '配音、音效、背景音乐', imageEditor: '编辑和处理图片', world: '生成 3D 场景与对象', human: '图片+音频驱动的数字人视频'};
const labels = {text: '文本生成', image: '图片生成', video: '视频生成', audio: '音频生成', imageEditor: '图片编辑器', world: '3D', human: '数字人视频'};
const el = (tag, cls, text) => {const node = document.createElement(tag); node.className = cls; if (text) node.textContent = text; return node;};

export function keyboardBlocked(event) {
  return event.defaultPrevented || event.isComposing || event.keyCode === 229 ||
    !!document.querySelector('dialog[open]') ||
    !!event.target?.closest('input,textarea,[contenteditable],dialog,[role="dialog"],[aria-modal="true"],#agent-panel');
}

export function choices(node, side) {
  const left = {world: ['text', 'image', 'video'], image: ['text', 'image'], video: ['text', 'image', 'audio'], text: ['text', 'image'], audio: ['text']};
  const right = {image: ['text', 'image', 'video', 'audio', 'imageEditor', 'world'], video: ['text', 'audio', 'video', 'world'], text: ['text', 'image', 'video', 'audio', 'world'], audio: ['video', 'human']};
  return (side === 'left' ? left : right)[node.type] || [];
}

export function nodeDraft(type, origin, side, point) {
  const title = {text: 'Text', image: origin.type === 'image' && side === 'right' ? '图片生成' : 'Image', video: 'Video', audio: 'Audio', imageEditor: '图片编辑器', human: 'Video'}[type];
  const node = {type: type === 'imageEditor' ? 'image' : type === 'human' ? 'video' : type, title, image: null,
    x: point.x, y: point.y, width: ['text', 'imageEditor'].includes(type) ? 250 : 250 * 16 / 9, height: 250};
  if (type === 'text') Object.assign(node, {content: '', textMode: side === 'left' ? 'pure' : 'generate', ...(side === 'right' ? {generation: window.CanvasText.config({})} : {})});
  if (type === 'audio') {
    const model = side === 'right' && origin.type === 'image' ? 'seed-audio-1-0' : origin.type === 'video' ? 'sonilo-music' : 'elevenlabs-v3';
    node.audioConfig = window.AudioCore.transition({}, model, model === 'seed-audio-1-0' ? 'Text-to-Speech' : 'Music');
  }
  if (type === 'video' || type === 'human') {
    node.generation = {...window.NodeEditor.getConfig(node), mode: '首尾帧', modelType: origin.type === 'image' && side === 'right' ? 'IMAGE_TO_VIDEO' : 'TEXT_TO_VIDEO'};
    if (origin.type === 'video' && side === 'right') Object.assign(node.generation, {model: 'Kling O3', mode: '全能参考', modelType: 'REFERENCE_TO_VIDEO'});
    if (type === 'human') Object.assign(node.generation, {model: 'OmniHuman 1.5', modelType: 'DIGITAL_HUMAN'});
  }
  if (type === 'image') {
    node.generation = window.NodeEditor.getConfig(node);
    if (origin.generation?.isPanoramaPrompt) Object.assign(node.generation, {ratio: '2:1', isPanoramaPrompt: true});
    const [width, height] = (node.generation.ratio || '1:1').split(':').map(Number), ratio = width > 0 && height > 0 ? width / height : 1;
    node.width = ratio > 1 ? 250 * ratio : 250; node.height = ratio < 1 ? 250 / ratio : 250;
  }
  if (type === 'world') Object.assign(node, worldDraft());
  if (type === 'imageEditor') Object.assign(node, {tool: 'image-editor', editorDoc: {version: 1, initialized: false, width: 600, height: 600, canvas: {objects: [], background: '#ffffff'}}});
  node.y -= node.height / 2;
  return node;
}

export function openMenu({node, side, anchor, create, close, selectionKind}) {
  const root = el('div', 'connection-menu' + (selectionKind ? ' selection-connection-menu' : '')); root.setAttribute('role', 'listbox'); root.tabIndex = -1;
  const heading = selectionKind ? {image: '引用所有选中的图片节点生成', text: '引用所有选中的文本节点生成', mixed: '引用所有选中的节点生成'}[selectionKind] : side === 'left' ? '添加上下文' : '引用该节点生成';
  root.setAttribute('aria-label', heading); root.append(el('div', 'connection-menu-heading', heading));
  const options = selectionKind ? ['text', 'image', 'video', 'world', ...(selectionKind === 'image' ? ['imageEditor'] : [])] : choices(node, side);
  for (const type of options) {
    let label = labels[type], description = descriptions[type];
    if (selectionKind && type === 'imageEditor') {
      const separator = el('div', 'selection-connection-separator'); separator.setAttribute('role', 'separator');
      root.append(separator, el('div', 'connection-menu-heading', '一键拼接所有选中的图片节点')); description = '一键拼图生成情绪板';
    }
    if (side === 'left' && node.type === 'image') {label = type === 'text' ? '文本生成' : '图片处理'; description = type === 'text' ? '生成或编辑文本' : '生成或上传图片';}
    if (side === 'left' && ['audio', 'text'].includes(node.type)) label = type === 'text' ? '文本' : '图片';
    if (side === 'right' && node.type === 'text' && type === 'audio') {label = '音频'; description = '音乐、配音、音效';}
    const videoEdit = side === 'right' && node.type === 'video' && type === 'video';
    if (videoEdit) {label = '视频编辑'; description = '对传入的视频进行编辑';}
    const row = el('button', 'connection-menu-option'); row.type = 'button'; row.dataset.type = type;
    row.setAttribute('role', 'option'); row.setAttribute('aria-selected', 'false');
    row.disabled = type === 'world' && !window.WorldNode || type === 'imageEditor' && !window.CanvasImageEditor;
    if (type === 'world' && row.disabled) row.title = '3D 节点正在加载';
    if (type === 'imageEditor' && row.disabled) row.title = '图片编辑器尚未加载';
    const icon = el('span', 'connection-menu-icon'); icon.innerHTML = videoEdit ? window.CANVAS_MENU_ICONS.videoEdit : icons[type];
    const copy = el('span', 'connection-menu-copy'); copy.append(el('span', 'connection-menu-label', label), el('span', 'connection-menu-description', description));
    row.append(icon, copy); root.append(row);
    const select = () => { for (const item of root.querySelectorAll('button')) item.setAttribute('aria-selected', String(item === row)); };
    row.onpointerenter = select; row.onfocus = select; row.onclick = () => create(type);
  }
  document.body.append(root);
  const position = menuPosition(anchor, {width: 288, height: root.offsetHeight}, {width: innerWidth, height: innerHeight});
  Object.assign(root.style, {left: `${position.left}px`, top: `${position.top}px`, maxHeight: `${position.maxHeight}px`, transformOrigin: position.transformOrigin});
  (root.querySelector('button:not(:disabled)') || root).focus({preventScroll: true});
  root.addEventListener('keydown', event => {
    if (keyboardBlocked(event)) return;
    if (event.key === 'Escape') {event.stopImmediatePropagation(); event.preventDefault(); close(true); return;}
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const rows = [...root.querySelectorAll('button:not(:disabled)')], index = rows.indexOf(document.activeElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length;
    rows[next]?.focus({preventScroll: true}); rows[next]?.scrollIntoView({block: 'nearest'});
  });
  return root;
}
