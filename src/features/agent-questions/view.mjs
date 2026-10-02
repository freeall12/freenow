import {MAX_OPTIONS, MAX_FREE_TEXT, questionAnswer, questionDraft, answerLabels} from './model.mjs';
import {checkIcon} from './icons.mjs';

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
export function loadQuestionStyles() {
  if (document.querySelector('link[data-agent-questions]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet'; link.href = new URL('./styles.css', import.meta.url).href;
  link.dataset.agentQuestions = ''; document.head.append(link);
}

// The official AskQuestionSheet is anchored above the composer. Closing its view
// never answers or cancels a live tool; the execution owner controls that state.
export function createQuestionSheet({trace, onSubmit, onDraftChange = () => {}, onFreeTextStart = () => {}, onHeightChange = () => {}}) {
  loadQuestionStyles();
  let current = trace, disposed = false, submitting = false, highlight = -1;
  let questions = current.args.questions, draft = questionDraft(questions, current.questionDraft);
  let selected = [], freeText = '', freeActive = false, list, input, previous, next, error, rows = [];
  const element = el('section', 'agent-question-sheet');
  element.dataset.traceId = current.id || current.callId;
  const surface = el('div', 'agent-question-surface'), lip = el('div', 'agent-question-lip');
  lip.ariaHidden = 'true'; element.append(surface, lip);
  const question = () => questions[draft.step];
  const answer = () => questionAnswer(question(), selected, freeText, freeActive);
  const options = () => question().options.slice(0, MAX_OPTIONS);
  const snapshot = () => ({step: draft.step, answers: draft.answers.map((value, index) => index === draft.step ? answer() : value)});
  function persist() {
    try { onDraftChange(current, snapshot()); return true; }
    catch (reason) { error.textContent = reason.message || '回答保存失败'; return false; }
  }
  function restore() {
    const saved = draft.answers[draft.step];
    selected = [...(saved?.selected_labels || [])]; freeText = saved?.free_text || '';
    freeActive = !!freeText; highlight = -1;
  }
  function sync() {
    const value = answer(), chosen = value?.selected_labels || [], hasFree = !!value?.free_text;
    rows.forEach((row, index) => {
      const active = index === highlight, picked = chosen.includes(options()[index].label);
      row.dataset.highlighted = String(active); row.ariaSelected = String(picked);
      row.querySelector('.agent-question-index').dataset.active = String(active || picked);
      row.querySelector('.agent-question-check').innerHTML = picked ? checkIcon : '';
      row.disabled = submitting;
    });
    input.disabled = submitting;
    const free = input.closest('.agent-question-free');
    free.dataset.highlighted = String(hasFree || highlight === options().length);
    free.dataset.inactive = String(!!freeText.trim() && !hasFree);
    free.querySelector('.agent-question-index').dataset.active = String(hasFree || highlight === options().length);
    previous.disabled = submitting || draft.step === 0;
    next.disabled = submitting || !value || typeof onSubmit !== 'function';
    next.replaceChildren(document.createTextNode(draft.step === questions.length - 1 ? '提交' : '下一题'));
    if (question().multiSelect && chosen.length) next.append(el('span', '', '(' + chosen.length + ')'));
    element.ariaBusy = String(submitting);
  }
  function choose(index) {
    if (submitting) return;
    const option = options()[index]; if (!option) return;
    highlight = index;
    selected = question().multiSelect ? selected.includes(option.label) ? selected.filter(label => label !== option.label) : [...selected, option.label] : [option.label];
    if (!question().multiSelect) freeActive = false;
    error.textContent = ''; sync(); persist();
  }
  function activateFree() { freeActive = true; if (!question().multiSelect) selected = []; }
  function move(delta) {
    const count = options().length + 1;
    highlight = highlight < 0 ? delta > 0 ? 0 : count - 1 : (highlight + delta + count) % count;
    if (highlight < options().length && !question().multiSelect) { selected = [options()[highlight].label]; freeActive = false; }
    sync(); persist();
    if (highlight === options().length) input.focus({preventScroll: true});
    else if (document.activeElement === input) list.focus({preventScroll: true});
  }
  function goBack() {
    if (submitting || draft.step === 0) return;
    draft.answers[draft.step] = answer(); draft.step--;
    restore(); render(); persist();
  }
  async function goNext() {
    if (disposed || submitting || !answer() || typeof onSubmit !== 'function') return false;
    if (!persist()) return false;
    draft.answers[draft.step] = answer();
    if (draft.step < questions.length - 1) { draft.step++; restore(); render(); return persist(); }
    if (draft.answers.some(value => !value)) return false;
    submitting = true; sync(); error.textContent = '';
    try { await onSubmit(current, {answers: structuredClone(draft.answers)}); return true; }
    catch (reason) { if (!disposed) { error.textContent = reason.message || '提交失败，请重试'; submitting = false; sync(); } return false; }
  }
  function keydown(event) {
    // Return/submit buttons retain native Enter/Space activation. List navigation
    // must never turn keyboard activation of the previous button into submission.
    if (event.target.closest('.agent-question-actions')) { event.stopPropagation(); return; }
    if (submitting || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.isComposing || event.keyCode === 229) { if (event.target !== input) input.focus(); return; }
    if (['ArrowUp', 'ArrowDown'].includes(event.key)) { event.preventDefault(); event.stopPropagation(); move(event.key === 'ArrowDown' ? 1 : -1); return; }
    if (event.target === input) {
      if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); goNext(); }
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); list.focus({preventScroll: true}); }
      return;
    }
    if (event.key === 'ArrowLeft') { event.preventDefault(); event.stopPropagation(); goBack(); }
    else if (event.key === 'Enter' || event.key === 'ArrowRight') { event.preventDefault(); event.stopPropagation(); goNext(); }
    else if (event.key === ' ') { event.preventDefault(); event.stopPropagation(); choose(highlight); }
    else if (event.key === String(options().length + 1)) { event.preventDefault(); event.stopPropagation(); input.focus(); }
    else if (/^[1-4]$/.test(event.key) && Number(event.key) <= options().length) { event.preventDefault(); event.stopPropagation(); choose(Number(event.key) - 1); }
    else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onFreeTextStart(''); }
    else if (event.key.length === 1) { event.preventDefault(); event.stopPropagation(); freeText = (freeText + event.key).slice(0, MAX_FREE_TEXT); activateFree(); input.value = freeText; input.focus(); sync(); persist(); }
  }
  function render() {
    surface.replaceChildren(); rows = [];
    list = el('div', 'agent-question-list'); list.tabIndex = -1; list.role = 'listbox';
    list.ariaLabel = question().question; list.ariaMultiSelectable = String(!!question().multiSelect); list.onkeydown = keydown;
    const heading = el('div', 'agent-question-heading');
    if (question().header) heading.append(el('span', 'agent-question-header', question().header));
    heading.append(el('span', 'agent-question-title', question().question));
    if (questions.length > 1) heading.append(el('span', 'agent-question-progress', (draft.step + 1) + ' / ' + questions.length));
    const choices = el('div', 'agent-question-options');
    options().forEach((option, index) => {
      const row = el('button', 'agent-question-row'); row.type = 'button'; row.role = 'option'; row.tabIndex = -1;
      row.dataset.multi = String(!!question().multiSelect); row.onmousedown = event => event.preventDefault(); row.onclick = () => choose(index);
      row.append(el('span', 'agent-question-index', String(index + 1)), el('span', 'agent-question-label', option.label));
      if (option.description) row.append(el('span', 'agent-question-description', option.description));
      const check = el('span', 'agent-question-check'); check.ariaHidden = 'true'; row.append(check); choices.append(row); rows.push(row);
    });
    const free = el('label', 'agent-question-row agent-question-free');
    free.append(el('span', 'agent-question-index', String(options().length + 1)));
    input = el('input', 'agent-question-text'); input.type = 'text'; input.maxLength = MAX_FREE_TEXT;
    input.value = freeText; input.placeholder = '或直接打字回答'; input.ariaLabel = input.placeholder;
    input.oninput = () => { freeText = input.value; activateFree(); error.textContent = ''; sync(); persist(); };
    input.onfocus = () => { highlight = options().length; if (freeText.trim()) activateFree(); sync(); persist(); };
    free.append(input); choices.append(free);
    const actions = el('div', 'agent-question-actions');
    previous = el('button', 'agent-question-previous', '上一题'); next = el('button', 'agent-question-next');
    for (const button of [previous, next]) { button.type = 'button'; button.onmousedown = event => event.preventDefault(); }
    previous.onclick = goBack; next.onclick = goNext; actions.append(previous, el('span', 'agent-question-spacer'), next);
    error = el('p', 'agent-question-error'); error.role = 'alert';
    list.append(heading, choices, actions, error); surface.append(list); sync();
    queueMicrotask(() => { if (!disposed && list.isConnected) list.focus({preventScroll: true}); });
  }
  const observer = new ResizeObserver(() => onHeightChange(Math.round(surface.getBoundingClientRect().height)));
  observer.observe(surface); restore(); render();
  return {
    element,
    getDraft: snapshot,
    submit: goNext,
    setFreeText(value) { freeText = String(value).slice(0, MAX_FREE_TEXT); activateFree(); input.value = freeText; sync(); persist(); },
    focus() { list.focus({preventScroll: true}); },
    destroy() { disposed = true; observer.disconnect(); onHeightChange(0); element.remove(); },
  };
}

export function renderQuestionSummary(trace) {
  loadQuestionStyles();
  if (['pending', 'running', 'waiting'].includes(trace.status)) return null;
  const answers = trace.result?.answers || [], answered = trace.status === 'done' && answers.length > 0;
  const root = el('div', 'agent-question-summary'); root.dataset.answered = String(answered);
  for (const question of trace.args.questions) {
    const row = el('div', 'agent-question-summary-row');
    if (question.header) row.append(el('span', 'agent-question-header', question.header));
    const answer = answers.find(value => value.question_id === question.question_id);
    row.append(el('span', 'agent-question-summary-question', question.question), el('span', 'agent-question-summary-answer', answered ? answerLabels(answer).join('、') || '未回答' : '未回答'));
    root.append(row);
  }
  return root;
}
