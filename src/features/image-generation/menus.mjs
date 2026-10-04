import { models, modelFor, normalize, selectModel, sizesFor, countsFor, gridColumns, ratioLabel, inputCompatibility } from './catalog.mjs';
import { panoramaIcon } from '../image-panorama/icons.mjs';
import { icons } from './assets.mjs';
import { check, lock } from './state-icons.mjs';
import { nativePanoramaIntentError } from './panorama-native.mjs';
export * from './catalog.mjs';
export { layoutFor, resizeNode } from './layout.mjs';

const css = document.createElement('link');
css.rel = 'stylesheet';
css.href = new URL('./menus.css', import.meta.url).href;
css.onload = () => document.dispatchEvent(new Event('image-menus:layout'));
document.head.append(css);

function element(tag, className, text) {
  const result = document.createElement(tag);
  if (className) result.className = className;
  if (text !== undefined) result.textContent = text;
  return result;
}
function button(text, action, className = '') {
  const result = element('button', className, text);
  result.type = 'button';
  result.addEventListener('click', action);
  return result;
}
function svg(name) {
  const result = element('span', 'image-parameter-icon');
  result.innerHTML = icons[name] || '';
  result.setAttribute('aria-hidden', 'true');
  return result;
}
export function ratioIcon(ratio, size = 14) {
  const wrap = element('span', 'image-ratio-icon');
  wrap.style.width = wrap.style.height = size + 'px';
  if (/^auto|^自适应/i.test(ratio)) { wrap.append(svg('auto')); return wrap; }
  const [width, height] = ratio.split(':').map(Number);
  const aspect = width > 0 && height > 0 ? width / height : 1;
  const shape = element('span', 'image-ratio-rectangle');
  shape.style.width = (aspect >= 1 ? size : size * aspect) + 'px';
  shape.style.height = (aspect >= 1 ? size / aspect : size) + 'px';
  wrap.append(shape);
  return wrap;
}
export function triggerLabel(config) {
  const model = modelFor(config.model);
  if (!model) return [config.ratio, config.quality].filter(Boolean).join(' · ');
  if (model.nativePanorama) return '图生360全景 · 2:1 · 原生尺寸';
  const next = normalize(config, model);
  return [next.isPanoramaPrompt ? '全景' : ratioLabel(next.ratio), next.imageSize, next.generateMode && ({ std: '标准', pro: '专业' }[next.generateMode]), next.outputQuality].filter(Boolean).join(' · ');
}
export function modelIcon(config) {
  const model = modelFor(config.model);
  if (!model) return null;
  const image = element('img', 'image-model-icon');
  image.src = model.icon;
  image.alt = '';
  return image;
}

function prepare(pop, label) {
  pop.replaceChildren();
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', label);
  pop.tabIndex = -1;
}
function keyboardNavigation(pop) {
  pop.onkeydown = event => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const buttons = [...pop.querySelectorAll('button:not(:disabled)')];
    const index = buttons.indexOf(document.activeElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus({ preventScroll: true });
    buttons[next]?.scrollIntoView({ block: 'nearest' });
  };
}

export function renderModels(pop, config, onSelect) {
  prepare(pop, '选择生成模型');
  pop.classList.add('image-model-menu');
  const entries = models.map(model => {
    let compatibility = inputCompatibility(model, config.inputCounts ?? config.refs?.length ?? 0);
    const intentError = model.nativePanorama && nativePanoramaIntentError(config);
    if (intentError) compatibility = {...compatibility, supported: false, reason: intentError};
    return {model, compatibility};
  });
  entries.sort((a, b) => Number(!a.compatibility.supported) - Number(!b.compatibility.supported));
  for (const { model, compatibility } of entries) {
    const row = button('', () => { if (compatibility.supported) onSelect(selectModel(config, model.id)); }, 'image-model-row');
    row.dataset.modelId = model.id;
    row.setAttribute('aria-label', model.name);
    const selected = modelFor(config.model)?.id === model.id;
    row.setAttribute('aria-pressed', selected);
    row.setAttribute('aria-disabled', !compatibility.supported);
    const heading = element('span', 'image-model-heading');
    const image = element('img', 'image-model-icon');
    image.src = model.icon;
    image.alt = '';
    heading.append(image, element('span', '', model.name));
    if (model.badge) heading.append(element('span', 'image-model-badge ' + (model.badge === 'NEW' ? 'new' : 'hot'), model.badge));
    row.append(heading);
    if (model.tag) {
      const tag = element('span', 'image-model-feature');
      tag.append(svg('diamond'), element('span', '', model.tag));
      const tags = element('span', 'image-model-features');
      tags.append(tag);
      const extra = { 'gpt-image-2.5-flare': '快速', 'gpt-image-2.5-sunburst': '精修' }[model.id];
      if (extra) tags.append(element('span', 'image-model-feature', extra));
      row.append(tags);
    }
    if (selected || !compatibility.supported) {
      const indicator = element('span', 'image-model-status');
      indicator.innerHTML = compatibility.supported ? check : lock;
      indicator.setAttribute('aria-hidden', 'true');
      row.append(indicator);
    }
    if (!compatibility.supported) {
      const reason = element('span', 'image-model-disabled-reason');
      reason.innerHTML = lock;
      reason.append(element('span', '', compatibility.reason));
      reason.id = `model-disabled-${model.id}`;
      row.setAttribute('aria-describedby', reason.id);
      row.append(reason);
    }
    pop.append(row);
  }
  keyboardNavigation(pop);
}

export function renderCount(pop, config, onSelect) {
  prepare(pop, '生成数量');
  pop.classList.add('image-count-menu');
  const model = modelFor(config.model);
  for (const count of countsFor(model,config.resultMode)) {
    const item = button(count*(model?.midjourney?4:1) + '×', () => onSelect(count), 'image-count-option');
    item.setAttribute('aria-pressed', config.count === count);
    pop.append(item);
  }
  keyboardNavigation(pop);
}

export function renderSpecifications(pop, initial, onChange) {
  prepare(pop, '生成规格');
  pop.classList.add('image-spec-menu');
  pop.onkeydown = null;
  let config = normalize(initial);
  const model = modelFor(config.model);
  const sync = [];
  if (!model) return;
  function choose(key, value) {
    const before = sizesFor(model, config.ratio).join(',');
    config = onChange(key === 'ratio' ? {ratio: value === '__panorama' ? '2:1' : value, isPanoramaPrompt: value === '__panorama'} : { [key]: value });
    if (before !== sizesFor(model, config.ratio).join(',')) {
      renderSpecifications(pop, config, onChange);
      [...pop.querySelectorAll('button[data-value]')].find(button => button.dataset.value === String(value))?.focus({ preventScroll: true });
    }
    else sync.forEach(update => update());
  }
  function section(label) {
    const wrap = element('div', 'image-parameter-section');
    wrap.append(element('div', 'image-parameter-label', label));
    pop.append(wrap);
    return wrap;
  }
  if (model.nativePanorama) {
    section('生成方式').append(element('div', 'image-parameter-auto', '图生360全景 · 单参考 · 单结果'));
    const projection = element('div', 'image-parameter-auto');
    projection.innerHTML = panoramaIcon;
    projection.append(element('span', '', '等距柱状全景 · 固定2:1'));
    section('画幅').append(projection);
    section('尺寸').append(element('div', 'image-parameter-auto', '供应商原生尺寸'));
    section('模型来源').append(element('div', 'image-parameter-auto', 'Hunyuan 独立供应商替代'));
    return;
  }
  function selection(group, key) {
    const highlight = element('span', 'image-parameter-selection');
    group.prepend(highlight);
    const update = () => {
      const buttons = [...group.querySelectorAll('button[data-value]')];
      for (const item of buttons) item.setAttribute('aria-pressed', item.dataset.value === String(key === 'ratio' && config.isPanoramaPrompt ? '__panorama' : config[key]));
      const item = buttons.find(item => item.getAttribute('aria-pressed') === 'true');
      if (!item) { highlight.hidden = true; return; }
      highlight.hidden = false;
      const g = group.getBoundingClientRect(), b = item.getBoundingClientRect();
      // The entry animation scales the fixed popup. Convert screen measurements
      // back to its layout coordinates so the highlight does not retain that scale.
      const scale = pop.getBoundingClientRect().width / pop.offsetWidth || 1;
      Object.assign(highlight.style, { left: (b.left - g.left) / scale + 'px', top: (b.top - g.top) / scale + 'px', width: b.width / scale + 'px', height: b.height / scale + 'px' });
    };
    sync.push(update);
    requestAnimationFrame(update);
  }
  function segment(label, values, key, render = value => value) {
    const group = element('div', 'image-parameter-segments');
    for (const value of values) {
      const item = button('', () => choose(key, value));
      item.dataset.value = String(value);
      const content = render(value);
      item.append(typeof content === 'string' ? document.createTextNode(content) : content);
      group.append(item);
    }
    section(label).append(group);
    selection(group, key);
  }
  if (model.modes.length) segment('模式', model.modes, 'generateMode', value => ({ std: '标准', pro: '专业' }[value]));
  const sizes = sizesFor(model, config.ratio);
  if (sizes.length) segment('画质', sizes, 'imageSize');
  else {
    const automatic = element('div', 'image-parameter-auto');
    automatic.append(svg('auto'), element('span', '', '自适应'));
    section('画质').append(automatic);
  }
  const panorama = model.ratios.includes('2:1');
  const cols = gridColumns(model.ratios.length) || (panorama ? Math.min(model.ratios.length - 1, 3) : 0);
  const ratios = element('div', 'image-parameter-ratios ' + (cols ? 'grid-layout' : 'inline-layout'));
  const remaining = element('div', 'image-ratio-grid');
  remaining.style.gridTemplateColumns = `repeat(${cols || model.ratios.length}, minmax(0, 1fr))`;
  const leading = panorama ? element('div', 'image-ratio-leading') : ratios;
  if (panorama) ratios.append(leading);
  model.ratios.forEach((ratio, index) => {
    const large = cols && index === 0;
    const item = button('', () => choose('ratio', ratio), large ? 'image-ratio-large' : 'image-ratio-small');
    item.dataset.value = ratio;
    item.setAttribute('aria-label', ratioLabel(ratio));
    item.append(ratioIcon(ratio, large ? 20 : 14), element('span', '', ratioLabel(ratio)));
    (large ? leading : remaining).append(item);
  });
  if (panorama) {
    const item = button('', () => choose('ratio', '__panorama'), 'image-ratio-panorama');
    item.dataset.value = '__panorama'; item.setAttribute('aria-label', '全景');
    item.innerHTML = panoramaIcon; item.append(element('span', '', '全景')); leading.append(item);
  }
  ratios.append(remaining);
  section('比例').append(ratios);
  selection(ratios, 'ratio');
  if (model.qualities.length) segment('输出质量', model.qualities, 'outputQuality');
  if (model.thinking) segment('思考时间', ['Minimal', 'high'], 'thinking', value => {
    const span = element('span', 'image-thinking-option');
    span.append(svg(value.toLowerCase()), element('span', '', value));
    return span;
  });
  if (model.webSearch && model.imageSearch) {
    const group = element('div', 'image-search-options');
    for (const [key, text] of [['webSearch', '联网'], ['imageSearch', '图片']]) {
      const label = element('label');
      const input = element('input');
      input.type = 'checkbox';
      input.setAttribute('aria-label', text);
      input.onchange = () => choose(key, input.checked);
      const face = element('span', 'image-search-face');
      face.append(element('span', 'image-search-check'), element('span', '', text));
      label.append(input, face);
      group.append(label);
      sync.push(() => { input.checked = !!config[key]; });
    }
    section('搜索').append(group);
  } else if (model.webSearch) segment('联网搜索', [true, false], 'webSearch', value => value ? 'ON' : 'OFF');
  if (model.transparent) segment('透明背景', ['transparent', 'opaque'], 'background', value => value === 'transparent' ? '开启' : '关闭');
  requestAnimationFrame(() => sync.forEach(update => update()));
}
