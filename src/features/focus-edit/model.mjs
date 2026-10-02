const tokens = /\{\{magic_item:(\{.*?\})\}\}/g;
export function splitPrompt(prompt = '') {
  const pieces = []; let end = 0;
  for (const match of prompt.matchAll(tokens)) {
    try {
      const mark = JSON.parse(match[1]);
      if (typeof mark._markId !== 'string') continue;
      pieces.push(prompt.slice(end, match.index), {mark, token: match[0]}); end = match.index + match[0].length;
    } catch { /* Malformed user text stays editable text. */ }
  }
  pieces.push(prompt.slice(end)); return pieces;
}
export function token(mark) {return '{{magic_item:' + JSON.stringify(mark) + '}}';}
export function replaceMark(prompt, id, mark) {return splitPrompt(prompt).map(part => typeof part === 'string' ? part : part.mark._markId === id ? mark ? token(mark) : '' : part.token).join('');}
export function detections(value) {
  const items = value?.items;
  if (!Array.isArray(items)) throw Error('识别服务未返回元素列表');
  const result = items.filter(item => typeof item?.label_name === 'string' && item.label_name.trim() && Array.isArray(item.box_2d) && item.box_2d.length === 4 && item.box_2d.every(n => Number.isFinite(n) && n >= 0 && n <= 1) && item.box_2d[2] > item.box_2d[0] && item.box_2d[3] > item.box_2d[1]).map(item => ({label_name: item.label_name, box_2d: [...item.box_2d], ...(typeof item.label_desc === 'string' ? {label_desc: item.label_desc} : {})}));
  if (!result.length) throw Error('未识别到该位置的物体');
  return result;
}
export function point(rect, x, y) {return {x: Math.max(0, Math.min(1, (x - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (y - rect.top) / rect.height))};}
