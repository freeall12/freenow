// Unmodified interactive-learning@v1.cd0bb18c.html: bm/m_/p_/f_/v_/__.
export const interactiveLearningUri = 'ui://tapnow/interactive-learning@v1';
export const interactiveLearningLocales = Object.freeze(['zh-CN', 'en-US', 'ja-JP', 'ko-KR', 'fr-FR']);
export const interactiveLearningQuestions = Object.freeze(['q1', 'q2', 'q3', 'q4', 'q5']);
export const interactiveLearningImageDomains = Object.freeze(['https://tap-testing.tamaredge.top', 'https://tap-testing2.tamaredge.top', 'https://files-testing.tapnow.art', 'https://files-testing.tapnow.media', 'https://files-testing.tapnow.top', 'https://files.tapnow.art', 'https://files.tapnow.media', 'https://files.tapnow.ai', 'https://files.tapnow.top']);
const hintQuestions = interactiveLearningQuestions.slice(1);
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
const fail = () => {throw Error('互动学习数据无效或与已保存草稿及进度不一致');};
function fields(value, allowed) {if (!object(value) || Object.keys(value).some(key => !allowed.includes(key))) fail();}
function text(value, limit, required = false) {
  if (typeof value !== 'string' || value.length > limit || required && !value.trim()) fail();
  try {encodeURIComponent(value);} catch {fail();} return value;
}
function integer(value, min, max) {if (!Number.isSafeInteger(value) || value < min || value > max) fail();return value;}
function list(value, max) {if (!Array.isArray(value) || value.length > max) fail();return value;}
function key(value) {if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,47}$/.test(value)) fail();return value;}
function unique(values) {if (new Set(values).size !== values.length) fail();return values;}
function questions(value) {
  const found = unique(list(value, 5).map(item => {if (!interactiveLearningQuestions.includes(item)) fail();return item;}));
  return interactiveLearningQuestions.filter(item => found.includes(item));
}
function preview(value) {
  text(value, 250000, true);
  if (/^data:image\/(?:png|webp|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) return value;
  let url;try {url = new URL(value);} catch {fail();}
  if (url.username || url.password || !interactiveLearningImageDomains.includes(url.origin)) fail();return value;
}
function course(value) {
  fields(value, ['title', 'creator', 'total_nodes']);
  return {title: text(value.title, 200, true), creator: text(value.creator, 200, true), total_nodes: integer(value.total_nodes, 1, 1000000)};
}
function levelSummary(value) {
  fields(value, ['key', 'title', 'why', 'state', 'done_questions']);
  if (!['locked', 'current', 'done'].includes(value.state)) fail();
  const done = questions(value.done_questions);
  if (value.state === 'locked' && done.length || value.state === 'done' && done.length !== 5 || value.state === 'current' && done.length === 5) fail();
  return {key: key(value.key), title: text(value.title, 200, true), why: text(value.why, 1000), state: value.state, done_questions: done};
}
function level(value) {
  fields(value, ['key', 'title', 'why', 'node_title', 'media', 'preview_url', 'learner_preview_url', 'contrast_url', 'creator_prompt', 'params', 'retries', 'questions', 'hints', 'done_questions', 'start_at']);
  const result = {key: key(value.key), title: text(value.title, 200, true), why: text(value.why, 1000), creator_prompt: text(value.creator_prompt, 4000, true)};
  if (!['image', 'video'].includes(value.media)) fail();result.media = value.media;
  for (const name of ['node_title', 'params']) if (value[name] !== undefined) result[name] = text(value[name], name === 'params' ? 1000 : 200);
  if (value.retries !== undefined) result.retries = integer(value.retries, 0, 1000000);
  for (const name of ['preview_url', 'learner_preview_url', 'contrast_url']) if (value[name] !== undefined) result[name] = preview(value[name]);
  fields(value.questions, hintQuestions);
  const {q2, q3, q4, q5} = value.questions;
  fields(q2, ['stem', 'options', 'explain']);fields(q3, ['parts', 'blanks', 'bank']);fields(q4, ['stem']);fields(q5, ['stem', 'formula']);
  const options = list(q2.options, 12).map(option => {fields(option, ['text', 'correct']);if (typeof option.correct !== 'boolean') fail();return {text: text(option.text, 1000, true), correct: option.correct};});
  if (options.length < 2 || options.filter(option => option.correct).length !== 1) fail();unique(options.map(option => option.text));
  const blanks = list(q3.blanks, 12).map(item => text(item, 200, true)), parts = list(q3.parts, 13).map(item => text(item, 2000)), bank = unique(list(q3.bank, 36).map(item => text(item, 200, true)));
  if (!blanks.length || parts.length !== blanks.length + 1 || blanks.some(item => !bank.includes(item))) fail();
  result.questions = {q2: {stem: text(q2.stem, 2000, true), options, explain: text(q2.explain, 2000, true)}, q3: {parts, blanks, bank}, q4: {stem: text(q4.stem, 2000, true)}, q5: {stem: text(q5.stem, 2000, true), ...(q5.formula !== undefined ? {formula: text(q5.formula, 2000)} : {})}};
  fields(value.hints, hintQuestions);result.hints = {};
  for (const name of hintQuestions) result.hints[name] = list(value.hints[name] ?? [], 4).map(item => text(item, 2000, true));
  result.done_questions = questions(value.done_questions ?? []);
  if (value.start_at !== undefined && !interactiveLearningQuestions.includes(value.start_at)) fail();result.start_at = value.start_at || 'q1';
  return result;
}
export function prepareInteractiveLearning(data, title = '互动学习') {
  fields(data, ['view', 'locale', 'course', 'chapters', 'level']);text(title, 200, true);
  if (!['syllabus', 'board'].includes(data.view) || data.locale !== undefined && !interactiveLearningLocales.includes(data.locale)) fail();
  const result = {title, summary: title, view: data.view, locale: data.locale || 'zh-CN'};
  if (data.view === 'syllabus') {
    if (data.level !== undefined) fail();result.course = course(data.course);
    const seen = new Set();result.chapters = list(data.chapters, 20).map(chapter => {
      fields(chapter, ['label', 'note', 'locked', 'levels']);if (typeof chapter.locked !== 'boolean') fail();
      const levels = list(chapter.levels, 50).map(item => {const summary = levelSummary(item);if (seen.has(summary.key) || chapter.locked && summary.state !== 'locked') fail();seen.add(summary.key);return summary;});
      if (!levels.length) fail();return {label: text(chapter.label, 200, true), locked: chapter.locked, levels, ...(chapter.note !== undefined ? {note: text(chapter.note, 1000)} : {})};
    });
    if (!seen.size || seen.size > 100 || seen.size > result.course.total_nodes || result.chapters.flatMap(chapter => chapter.levels).filter(item => item.state === 'current').length > 1) fail();
  } else {
    if (data.course !== undefined || data.chapters !== undefined) fail();result.level = level(data.level);
  }
  if (new TextEncoder().encode(JSON.stringify(result)).length > 512 * 1024) throw Error('互动学习输入过长，请缩短课程或图片数据');
  return result;
}
function prepared(response) {
  fields(response, ['title', 'summary', 'view', 'locale', 'course', 'chapters', 'level']);
  if (response.summary !== response.title) fail();const {title, summary, ...data} = response;return prepareInteractiveLearning(data, title);
}
export function validateInteractiveLearningState(value, response) {
  const source = prepared(response);if (source.view !== 'board') fail();
  fields(value, ['done', 'cur', 'hintShown', 'clozeFill', 'drafts']);
  const done = questions(value.done);
  if (source.level.done_questions.some(item => !done.includes(item)) || !interactiveLearningQuestions.includes(value.cur)) fail();
  fields(value.hintShown, hintQuestions);const hintShown = {};
  for (const name of hintQuestions) {
    const supplied = source.level.hints[name].length, available = (name === 'q2' || name === 'q3') && supplied < 4 ? supplied + 1 : supplied;
    hintShown[name] = integer(value.hintShown[name], 0, available);
  }
  let clozeFill = null;
  if (value.clozeFill !== null) {
    clozeFill = list(value.clozeFill, 12).map(item => {if (item !== null && !source.level.questions.q3.bank.includes(item)) fail();return item;});
    if (clozeFill.length !== source.level.questions.q3.blanks.length) fail();
  }
  fields(value.drafts, ['q4', 'q5']);const drafts = {};
  for (const name of ['q4', 'q5']) if (value.drafts[name] !== undefined) drafts[name] = text(value.drafts[name], 2000);
  return {done, cur: value.cur, hintShown, clozeFill, drafts};
}
export function initialInteractiveLearningState(response) {
  const source = prepared(response);if (source.view === 'syllabus') return null;
  const cur = source.level.start_at;
  return validateInteractiveLearningState({done: source.level.done_questions, cur, hintShown: {q2: 0, q3: 0, q4: 0, q5: 0}, clozeFill: cur === 'q3' ? source.level.questions.q3.blanks.map(() => null) : null, drafts: {}}, source);
}
// f_ removes IL1 delimiters and truncates UTF-16 units; it does not URI encode.
export function interactiveLearningAnswer(value) {
  text(value, 2000);const normalized = value.replace(/[\r\n]+/g, ' ').replace(/[;|=]/g, ' ').replace(/\s+/g, ' ').trim();
  const answer = normalized.slice(0, 300);text(answer, 300);return {text: answer, truncated: normalized.length > 300};
}
const messages = Object.freeze({
  'zh-CN': {go: '进入关卡 {key}·{title}', replay: '重玩关卡 {key}·{title}', q4: '提交关卡 {key} 反推答案，请点评', q5: '提交关卡 {key} 改编提示词，请生成', truncated: '（已截断）', next: '关卡 {key}·{title} 完成，进入下一关', skip: '先不上课了，继续刚才的事。'},
  'en-US': {go: 'Enter level {key}·{title}', replay: 'Replay level {key}·{title}', q4: 'Submitting level {key} reverse-prompt for review', q5: 'Submitting level {key} remix prompt for generation', truncated: '(truncated)', next: 'Level {key}·{title} complete, moving on', skip: 'Pausing the course - back to what we were doing.'},
  'ja-JP': {go: 'レベル{key}・{title}を開始', replay: 'レベル{key}・{title}に再挑戦', q4: 'レベル{key}の逆算プロンプトをレビューに提出', q5: 'レベル{key}のアレンジプロンプトを生成に提出', truncated: '（省略）', next: 'レベル{key}・{title}を完了し、次へ進む', skip: 'コースを一時停止して、元の作業に戻ります。'},
  'ko-KR': {go: '레벨 {key}·{title} 시작', replay: '레벨 {key}·{title} 다시 학습', q4: '레벨 {key} 역추론 프롬프트 검토 제출', q5: '레벨 {key} 리믹스 프롬프트 생성 제출', truncated: '(생략됨)', next: '레벨 {key}·{title} 완료, 다음으로 이동', skip: '강의를 잠시 멈추고 이전 작업으로 돌아갑니다.'},
  'fr-FR': {go: 'Commencer le niveau {key} · {title}', replay: 'Rejouer le niveau {key} · {title}', q4: 'Soumission du prompt inversé du niveau {key} pour analyse', q5: 'Soumission du prompt remixé du niveau {key} pour génération', truncated: '(tronqué)', next: 'Niveau {key} · {title} terminé, passage au suivant', skip: 'Mettre le cours en pause et reprendre le travail précédent.'},
});
const format = (template, values) => Object.entries(values).reduce((result, [name, value]) => result.split(`{${name}}`).join(String(value)), template);
async function handoff(message, result, instructions) {
  const prompt = `${message}\n\n已核对本应用来源和已保存状态。${instructions}题目完成标记包含用户自评，不能声称用户已真正学会或已经模型判分。此页面没有模型调用或真实媒体生成回执；媒体生成和画布修改仍须走正常工具权限与确认。\n${JSON.stringify(result)}`;
  if (prompt.length > 16384) throw Error('互动学习交接过长，请缩短题目或提示后重试');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(result)));
  return {kind: result.action, text: prompt, metadata: {handoffId: 'learning_' + [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')}, result};
}
export async function resolveInteractiveLearningReply(message, response, savedState) {
  text(message, 16384, true);const source = prepared(response), locale = messages[source.locale];
  if (source.view === 'syllabus') {
    for (const chapter of source.chapters) for (const item of chapter.levels) {
      if (chapter.locked || item.state === 'locked') continue;
      const expected = `${format(locale[item.state === 'done' ? 'replay' : 'go'], item)} — IL1 v=1;go=${item.key}`;
      if (message === expected) return handoff(message, {action: item.state === 'done' ? 'replay' : 'go', course: source.course, chapter: chapter.label, level: item}, '请根据真实课程来源打开该关学习板。目录卡只含关卡摘要，不能编造题目、提示词、参考图片或模型结果；缺少题目来源时先说明需要补充来源。');
    }
    fail();
  }
  if (message === locale.skip) return {kind: 'skip', text: message, metadata: {}};
  const state = validateInteractiveLearningState(savedState, source), item = source.level;
  for (const ask of ['q4', 'q5']) {
    const answer = interactiveLearningAnswer(state.drafts[ask] ?? '');if (!answer.text) continue;
    const summary = format(locale[ask], item) + (answer.truncated ? locale.truncated : ''), token = `IL1 v=1;lvl=${item.key}${state.done.length ? `;done=${state.done.join(',')}` : ''};ask=${ask};ans=${answer.text}`;
    if (message === `${summary} — ${token}`) {
      const question = item.questions[ask], result = {action: ask === 'q4' ? 'review' : 'generate', level_key: item.key, level_title: item.title, media: item.media, creator_prompt: item.creator_prompt, question, answer: answer.text, answer_truncated: answer.truncated, done_questions: state.done, completion_basis: 'page_checks_or_self_assessment', ...(item.params !== undefined ? {params: item.params} : {}), ...(item.node_title !== undefined ? {node_title: item.node_title} : {})};
      for (const name of ['preview_url', 'learner_preview_url', 'contrast_url']) if (item[name] !== undefined) result[name] = item[name];
      return handoff(message, result, ask === 'q4' ? '用户请求点评实际提交的反推答案；请区分参考技法与实际答案，未读取目标图片时不要声称看过。点评不会自动把本题标记为完成。' : '用户请求用实际提交的改编答案生成；超过300字符时只交接官方发送的截断内容，不能自动补全原草稿。先检查现有媒体/模型配置和正常生成流程，未返回真实任务结果时不得声称已经生成。');
    }
  }
  if (state.done.length === 5 && message === `${format(locale.next, item)} — IL1 v=1;lvl=${item.key};done=${state.done.join(',')};next=1`) {
    return handoff(message, {action: 'next', level_key: item.key, level_title: item.title, done_questions: state.done, completion_basis: 'page_checks_or_self_assessment'}, '用户提交本关五题完成标记，请在真实课程来源中记录自评进度并查找下一关；当前学习板没有下一关数据，不要编造解锁结果或虚构题目。');
  }
  fail();
}
