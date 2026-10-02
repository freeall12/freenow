// Unmodified platform-resize@v1.897f4688.html: ontoolresult/pm/mm/b_/g_.
export const platformResizeUri = 'ui://tapnow/platform-resize@v1';
export const platformResizeTool = 'resize_for_platform_apply';
export const platformResizePolicy = Object.freeze({allowExpanded:false,autoExpandOnReady:false});
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
const invalid = message => {throw Object.assign(Error(message || '平台裁切数据无效'), {code:'invalid_platform_resize'});};
const fields = (value, allowed) => {if (!object(value) || Object.keys(value).some(key => !allowed.includes(key))) invalid();};
const text = (value, max = 120) => {if (typeof value !== 'string' || !value.trim() || value.length > max) invalid();return value;};
const integer = (value, min, max) => {if (!Number.isSafeInteger(value) || value < min || value > max) invalid();return value;};
export function platformResizeNodeId(ref) {if (typeof ref !== 'string' || !/^node\/[A-Za-z0-9_-]{1,180}$/.test(ref)) invalid('平台裁切需要真实图片节点标识');return ref.slice(5);}
export function platformResizeRatio(id) {const match = /^r_([1-9]\d{0,2})_([1-9]\d{0,2})$/.exec(id);if (!match) invalid('平台规格宽高比无效');return {width:Number(match[1]),height:Number(match[2])};}
export function validatePlatformResizeSpecs(value) {
  if (!Array.isArray(value) || !value.length || value.length > 16) invalid('请提供1至16个平台规格');
  const ids = new Set();return value.map(item => {
    fields(item, ['platform','label_zh','label_en','ratio_id','selected']);text(item.platform,64);
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(item.platform) || ids.has(item.platform)) invalid('平台标识无效或重复');ids.add(item.platform);
    platformResizeRatio(item.ratio_id);text(item.label_zh);text(item.label_en);if (item.selected !== undefined && typeof item.selected !== 'boolean') invalid();
    return {...item};
  });
}
export function buildPlatformResizeFormats(specs, width, height) {
  integer(width,1,16384);integer(height,1,16384);
  return validatePlatformResizeSpecs(specs).map(item => {
    const ratio = platformResizeRatio(item.ratio_id), scale = ratio.width / ratio.height / (width / height);
    const w = scale >= 1 ? 1000 : Math.round(1000 * scale), h = scale <= 1 ? 1000 : Math.round(1000 / scale);
    if (w < 1 || h < 1) invalid('该图片无法提供规格所需的有效裁切像素');
    return {...item,x:Math.round((1000-w)/2),y:Math.round((1000-h)/2),w,h};
  });
}
export function preparePlatformResize(data, title = '按平台改尺寸') {
  fields(data,['node_ref','project_id','preview','platforms','locale','free']);platformResizeNodeId(data.node_ref);text(title,200);
  if (data.project_id !== undefined) text(data.project_id,180);
  if (data.locale !== undefined && !['zh-CN','en-US'].includes(data.locale)) invalid();
  if (data.free !== undefined && data.free !== true) invalid('本地裁切不调用计费生成');
  fields(data.preview,['data_uri','width','height']);integer(data.preview.width,1,16384);integer(data.preview.height,1,16384);
  if (typeof data.preview.data_uri !== 'string' || data.preview.data_uri.length > 800000 || !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(data.preview.data_uri)) invalid('真实裁切预览无效或超限');
  if (!Array.isArray(data.platforms)) invalid('平台规格无效');
  const specs = validatePlatformResizeSpecs(data.platforms.map(item => Object.fromEntries(Object.entries(item).filter(([key]) => !['x','y','w','h'].includes(key)))));
  const platforms = data.platforms.map((item,index) => {
    fields(item,['platform','label_zh','label_en','ratio_id','selected','x','y','w','h']);integer(item.w,1,1000);integer(item.h,1,1000);integer(item.x,0,1000-item.w);integer(item.y,0,1000-item.h);
    if (item.w !== 1000 && item.h !== 1000) invalid('官方平台裁切需保留最大可用取景范围');return {...specs[index],x:item.x,y:item.y,w:item.w,h:item.h};
  });
  return {node_ref:data.node_ref,...(data.project_id !== undefined ? {project_id:data.project_id}:{}),preview:{...data.preview},platforms,locale:data.locale || 'zh-CN',free:true};
}
export function validatePlatformResizeApply(args,response) {
  fields(args,['image_id','project_id','crops']);const source = preparePlatformResize(response);
  if (args.image_id !== source.node_ref || args.project_id !== source.project_id) invalid('裁切来源或项目与本次官方页面不符');
  if (!Array.isArray(args.crops) || !args.crops.length || args.crops.length > source.platforms.length) invalid('请至少选择一个平台规格');
  const ids = new Set(),ratios = new Set();let previous = -1;
  const crops = args.crops.map(crop => {
    fields(crop,['platform','x','y','w','h']);const index = source.platforms.findIndex(item => item.platform === crop.platform),spec = source.platforms[index];
    if (!spec || index <= previous || ids.has(crop.platform) || ratios.has(spec.ratio_id)) invalid('平台规格须按官方顺序且每宽高比只选一个');previous=index;ids.add(crop.platform);ratios.add(spec.ratio_id);
    if (crop.w !== spec.w || crop.h !== spec.h) invalid('裁切尺寸不能替换页面指定规格');integer(crop.x,0,1000-crop.w);integer(crop.y,0,1000-crop.h);return {...crop};
  });return {image_id:source.node_ref,...(source.project_id !== undefined ? {project_id:source.project_id}:{}),crops};
}
export function platformResizePixels(crop,width,height,ratioId) {
  integer(width,1,16384);integer(height,1,16384);fields(crop,['platform','x','y','w','h']);integer(crop.w,1,1000);integer(crop.h,1,1000);integer(crop.x,0,1000-crop.w);integer(crop.y,0,1000-crop.h);
  const ratio=platformResizeRatio(ratioId);
  let a=ratio.width,b=ratio.height;while(b){const next=a%b;a=b;b=next;}
  const unitWidth=ratio.width/a,unitHeight=ratio.height/a,multiple=Math.floor(Math.min(width/unitWidth,height/unitHeight));
  if(multiple<1)invalid('源图像素不足以提供此规格的精确宽高比');
  const outputWidth=unitWidth*multiple,outputHeight=unitHeight*multiple;
  // The official iframe quantizes geometry to thousandths. Recover an exact
  // platform ratio from the host-owned spec; keep the user's left/top framing
  // and clamp only the subpixel quantization at the source boundaries.
  const x=Math.min(width-outputWidth,Math.max(0,Math.round(crop.x*width/1000))),y=Math.min(height-outputHeight,Math.max(0,Math.round(crop.y*height/1000)));
  return {x,y,width:outputWidth,height:outputHeight};
}
