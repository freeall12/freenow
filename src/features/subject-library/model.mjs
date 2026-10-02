import {modelFor} from '../video-generation/settings.mjs';
const families = new Set(['Seedance 2.0','Seedance 2.0 Mini','Seedance 2.0 Fast','Seedance 2.5','MiniMax H3']);
export function subjectsEnabled(type, settings) {
  return type === 'video' && families.has(modelFor(settings.model || settings.modelId)?.name) && ['全能参考','REFERENCE_TO_VIDEO','REFERENCE_VIDEO_TO_VIDEO'].includes(settings.mode || settings.videoMode) && !settings.multiShot;
}
// Official ElementRef tokens encode the alias separately from the stable ID.
// Local subjects use UUIDs; the official service uses numeric IDs.
export const subjectToken = subject => '{{ElementRef:' + subject.id + ':' + encodeURIComponent(subject.name) + '}}';
export function subjectSegments(prompt = '') {
  const result = []; let cursor = 0;
  for (const match of prompt.matchAll(/\{\{ElementRef:([^:{}\s]+):([^{}]*)\}\}/g)) {
    let name; try {name = decodeURIComponent(match[2]);} catch {continue;}
    if (!name.trim()) continue;
    result.push(prompt.slice(cursor,match.index), {token:match[0], id:match[1], name}); cursor = match.index + match[0].length;
  }
  result.push(prompt.slice(cursor)); return result;
}
export const subjectIds = prompt => [...new Set(subjectSegments(prompt).filter(p => typeof p !== 'string').map(p => p.id))];
export function replaceSubjects(prompt, selected) {
  const ids = new Set(selected.map(s => s.id));
  const value = subjectSegments(prompt).map(p => typeof p === 'string' ? p : ids.has(p.id) ? p.token : '').join('');
  const existing = new Set(subjectIds(value));
  return [value,...selected.filter(s => !existing.has(s.id)).map(subjectToken)].filter(Boolean).join(' ');
}
export function projectSubjects(request, subjects) {
  const segments = subjectSegments(request.prompt || ''), ids = subjectIds(request.prompt || '');
  if (!ids.length) {
    if ((request.prompt || '').includes('{{ElementRef:')) throw Error('主体引用失效，请移除后重新选择');
    return request;
  }
  if (!subjectsEnabled(request.kind.split('.')[0], request.parameters || {})) throw Error('当前模型或模式不支持主体引用');
  const inputs = (request.inputs || []).map(i => ({...i})), snapshots = [], labels = new Map();
  for (const id of ids) {
    const subject = subjects.find(s => s.id === id);
    if (!subject || !Array.isArray(subject.assets)) throw Error('主体引用失效，请移除后重新选择');
    const refs = [];
    for (const asset of subject.assets) {
      if (asset.type === 'text') {if (asset.text?.trim()) refs.push(asset.text); continue;}
      if (!['image','video','audio'].includes(asset.type) || !asset.url) continue;
      let index = inputs.filter(i => i.type === asset.type).findIndex(i => i.url === asset.url || i.sourceUrl === asset.url);
      if (index < 0) {
        index = inputs.filter(i => i.type === asset.type).length;
        inputs.push({id:'subject:'+id+':'+asset.id, type:asset.type, url:asset.url, title:asset.name, subjectId:id, role:'subject_reference', ...(asset.durationMs ? {durationMs:asset.durationMs} : {})});
      }
      refs.push('{{'+asset.type[0].toUpperCase()+asset.type.slice(1)+' '+(index+1)+'}}');
    }
    if (!refs.length) throw Error('主体没有可用参考素材：'+subject.name);
    snapshots.push(structuredClone(subject));
    labels.set(id, [subject.name, subject.description, ...refs].filter(Boolean).join('：'));
  }
  const prompt = segments.map(p => typeof p === 'string' ? p : labels.get(p.id)).join('');
  if (prompt.includes('{{ElementRef:')) throw Error('主体引用失效，请移除后重新选择');
  return {...request, prompt, inputs, parameters:{...request.parameters, subjects:snapshots, subjectPrompt:request.prompt}};
}
