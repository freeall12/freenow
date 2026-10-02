// Official show_form locale tables, current canvas release.
export const FORM_LABELS = {
  "zh": {
    "submit": "提交",
    "skip": "跳过",
    "edit": "修改",
    "submitted": "已提交",
    "skipped": "已跳过",
    "required": "此项为必填",
    "minSelect": "至少选择 {count} 项",
    "maxSelect": "最多选择 {count} 项",
    "maxLength": "最多 {count} 字",
    "numberMin": "不能小于 {count}",
    "numberMax": "不能大于 {count}",
    "selectPlaceholder": "请选择",
    "datePlaceholder": "选择日期",
    "unanswered": "未填写"
  },
  "en": {
    "submit": "Submit",
    "skip": "Skip",
    "edit": "Edit",
    "submitted": "Submitted",
    "skipped": "Skipped",
    "required": "This field is required",
    "minSelect": "Select at least {count}",
    "maxSelect": "Select at most {count}",
    "maxLength": "Up to {count} characters",
    "numberMin": "Must be at least {count}",
    "numberMax": "Must be at most {count}",
    "selectPlaceholder": "Select",
    "datePlaceholder": "Pick a date",
    "unanswered": "Not answered"
  },
  "ja": {
    "submit": "送信",
    "skip": "スキップ",
    "edit": "修正",
    "submitted": "送信済み",
    "skipped": "スキップ済み",
    "required": "この項目は必須です",
    "minSelect": "{count}件以上選択してください",
    "maxSelect": "選択は{count}件までです",
    "maxLength": "{count}文字以内で入力してください",
    "numberMin": "{count}以上で入力してください",
    "numberMax": "{count}以下で入力してください",
    "selectPlaceholder": "選択してください",
    "datePlaceholder": "日付を選択",
    "unanswered": "未回答"
  },
  "ko": {
    "submit": "제출",
    "skip": "건너뛰기",
    "edit": "수정",
    "submitted": "제출됨",
    "skipped": "건너뜀",
    "required": "필수 항목입니다",
    "minSelect": "최소 {count}개 선택하세요",
    "maxSelect": "최대 {count}개까지 선택할 수 있습니다",
    "maxLength": "{count}자 이내로 입력하세요",
    "numberMin": "{count} 이상이어야 합니다",
    "numberMax": "{count} 이하여야 합니다",
    "selectPlaceholder": "선택하세요",
    "datePlaceholder": "날짜 선택",
    "unanswered": "미응답"
  },
  "fr": {
    "submit": "Envoyer",
    "skip": "Passer",
    "edit": "Modifier",
    "submitted": "Envoyé",
    "skipped": "Passé",
    "required": "Ce champ est requis",
    "minSelect": "Sélectionnez au moins {count}",
    "maxSelect": "Sélectionnez au plus {count}",
    "maxLength": "{count} caractères maximum",
    "numberMin": "Doit être au moins {count}",
    "numberMax": "Doit être au plus {count}",
    "selectPlaceholder": "Sélectionner",
    "datePlaceholder": "Choisir une date",
    "unanswered": "Non renseigné"
  }
};

export const FIELD_TYPES = Object.freeze(['radio','checkbox','select','text','rating','slider','date','number','image_select']);
const string = (value, fallback = '') => typeof value === 'string' ? value : fallback;
const finite = value => typeof value === 'number' && Number.isFinite(value) ? value : undefined;
export function normalizeForm(input) {
  const source = input?.response?.form || input?.result?.form || input?.request || input?.args || input;
  if (!source || typeof source !== 'object') return null;
  const seen = new Set();
  const fields = (Array.isArray(source.fields) ? source.fields : []).flatMap(raw => {
    if (!raw || typeof raw !== 'object') return [];
    const id = string(raw.id).trim(), label = string(raw.label).trim();
    if (!id || !label || seen.has(id) || ['__proto__','constructor','prototype'].includes(id)) return [];
    seen.add(id);
    const options = [], values = new Set();
    for (const option of Array.isArray(raw.options) ? raw.options : []) {
      const value = string(option?.value).trim();
      if (!value || values.has(value)) continue;
      values.add(value); options.push({value, label:string(option.label).trim() || value, ...(string(option.file_id).trim() ? {file_id:option.file_id.trim()} : {}), ...(string(option.description).trim() ? {description:option.description.trim()} : {})});
    }
    return [{id, label, type:string(raw.type,'text').trim() || 'text', required:raw.required === true, description:string(raw.description).trim() || undefined, options, multiline:raw.multiline === true,
      ...Object.fromEntries(['min_select','max_select','max_length','min','max','step'].map(key => [key,finite(raw[key])])), ...Object.fromEntries(['placeholder','unit'].map(key => [key,string(raw[key]) || undefined]))}];
  });
  if (!fields.length) return null;
  return {title:string(source.title),fields,...Object.fromEntries(['description','submit_label','accent','form_icon','display_type'].map(key => [key,string(source[key]) || undefined]))};
}
export function formLanguage(form) {
  const text = [form.title,form.description || '',...form.fields.flatMap(field => [field.label,...(field.options || []).map(option => option.label)])].join(' ');
  return /[\uAC00-\uD7AF\u1100-\u11FF]/.test(text) ? 'ko' : /[\u3040-\u309F\u30A0-\u30FF]/.test(text) ? 'ja' : /[\u4E00-\u9FFF]/.test(text) ? 'zh' : /[àâçéèêëîïôùûüÿœæ]|qu'|aujourd'hui|est-ce/i.test(text) ? 'fr' : 'en';
}
export const compactOptions = field => ['radio','checkbox'].includes(field.type) && !!field.options?.length && field.options.every(option => option.label.length <= 14 && !option.description);
export const ratingMax = field => Math.min(10,Math.max(1,Math.round(field.max ?? 5)));
export function displayValue(field,value) {
  const optionLabel = value => {const option=field.options?.find(option => option.value === value); return option ? option.label === value ? option.label : `${option.label} (${value})` : value;};
  if(value == null) return null;
  if(['radio','select'].includes(field.type)) return typeof value === 'string' && value ? optionLabel(value) : null;
  if(['checkbox','image_select'].includes(field.type)) return Array.isArray(value) && value.length ? value.map(optionLabel).join(', ') : null;
  if(field.type === 'rating') return finite(value) !== undefined ? `${value}/${field.max ?? 5}` : null;
  if(['slider','number'].includes(field.type)) return finite(value) !== undefined ? `${value}${field.unit || ''}` : null;
  return typeof value === 'string' ? value.trim() || null : null;
}
export function validateField(field,value,labels=FORM_LABELS.zh) {
  const count = (key,value) => labels[key].replace('{count}',String(value));
  if(displayValue(field,value) === null) return field.required ? labels.required : null;
  const type=field.type, allowed=new Set(field.options?.map(option => option.value));
  if(['radio','select'].includes(type) && !allowed.has(value)) return labels.selectPlaceholder;
  if(['checkbox','image_select'].includes(type)) {
    if(value.some(item => typeof item !== 'string' || !allowed.has(item)) || new Set(value).size !== value.length) return labels.selectPlaceholder;
    if(finite(field.min_select) !== undefined && value.length < field.min_select) return count('minSelect',field.min_select);
    if(finite(field.max_select) !== undefined && value.length > field.max_select) return count('maxSelect',field.max_select);
  }
  if(type === 'text' || !FIELD_TYPES.includes(type)) if(finite(field.max_length) !== undefined && value.trim().length > field.max_length) return count('maxLength',field.max_length);
  if(['number','slider','rating'].includes(type)) {
    const min=type === 'rating' ? 1 : field.min ?? (type === 'slider' ? 0 : undefined), max=type === 'rating' ? ratingMax(field) : field.max ?? (type === 'slider' ? 100 : undefined);
    if(min !== undefined && value < min) return count('numberMin',min);
    if(max !== undefined && value > max) return count('numberMax',max);
    if(type === 'rating' && !Number.isInteger(value)) return labels.selectPlaceholder;
    if(type === 'slider') {const step=field.step>0?field.step:1,offset=(value-(field.min??0))/step;if(Math.abs(offset-Math.round(offset))>1e-7)return labels.selectPlaceholder;}
  }
  if(type === 'date' && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value+'T00:00:00Z')) || new Date(value+'T00:00:00Z').toISOString().slice(0,10) !== value)) return labels.datePlaceholder;
  return null;
}
export function validateForm(form,values={}) {
  const labels=FORM_LABELS[formLanguage(form)];
  return Object.fromEntries(form.fields.flatMap(field => {const error=validateField(field,values[field.id],labels);return error ? [[field.id,error]] : [];}));
}
export function formSubmission(form,values={},toolCallId='',skipped=false) {
  return {tool_call_id:toolCallId,form_title:form.title,skipped,values:skipped ? [] : form.fields.map(field => {const display=displayValue(field,values[field.id]);return {field_id:field.id,field_label:field.label,value:display === null ? null : field.type === 'text' || !FIELD_TYPES.includes(field.type) ? display : structuredClone(values[field.id]),display};})};
}
export function formDraft(form,saved) {
  const values=saved?.values && typeof saved.values==='object' && !Array.isArray(saved.values) ? saved.values : saved || {};
  return Object.fromEntries(form.fields.map(field => [field.id,structuredClone(values[field.id] ?? null)]));
}
export function formAccent(value) {
  const names={success:'#34d399',warning:'#fbbf24',danger:'#f87171'};
  if(names[value])return names[value];
  if(!/^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value || ''))return null;
  const rgb=[1,3,5].map(index => parseInt(value.slice(index,index+2),16)/255),high=Math.max(...rgb),low=Math.min(...rgb),delta=high-low,light=(high+low)/2;
  let hue=0;if(delta){hue=high===rgb[0]?(rgb[1]-rgb[2])/delta%6:high===rgb[1]?(rgb[2]-rgb[0])/delta+2:(rgb[0]-rgb[1])/delta+4;hue*=60;if(hue<0)hue+=360;}
  const saturation=delta===0?0:delta/(1-Math.abs(2*light-1)),l=Math.min(.72,Math.max(.56,light)),s=delta===0?0:Math.max(.18,saturation),chroma=(1-Math.abs(2*l-1))*s,x=chroma*(1-Math.abs(hue/60%2-1)),m=l-chroma/2;
  const channels=hue<60?[chroma,x,0]:hue<120?[x,chroma,0]:hue<180?[0,chroma,x]:hue<240?[0,x,chroma]:hue<300?[x,0,chroma]:[chroma,0,x];
  return '#'+channels.map(channel => Math.round((channel+m)*255).toString(16).padStart(2,'0')).join('');
}
