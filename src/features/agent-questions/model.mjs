export const MAX_OPTIONS = 4;
export const MAX_FREE_TEXT = 200;

export function questionAnswer(question, selected = [], freeText = '', freeTextActive = true) {
  const valid = new Set((question.options || []).slice(0, MAX_OPTIONS).map(option => option.label));
  const text = String(freeText).slice(0, MAX_FREE_TEXT).trim();
  const labels = [...new Set(selected)].filter(label => valid.has(label));
  const includeText = !!text && (question.multiSelect === true || freeTextActive);
  const chosen = question.multiSelect === true ? labels : includeText ? [] : labels.slice(0, 1);
  return chosen.length || includeText ? {
    question_id: question.question_id,
    ...(chosen.length ? {selected_labels: chosen} : {}),
    ...(includeText ? {free_text: text} : {}),
  } : null;
}

export function questionDraft(questions, saved) {
  const answers = questions.map(question => {
    const previous = saved?.answers?.find(answer => answer?.question_id === question.question_id);
    return previous ? questionAnswer(question, previous.selected_labels, previous.free_text) : null;
  });
  const step = Number.isInteger(saved?.step) ? Math.max(0, Math.min(questions.length - 1, saved.step)) : 0;
  return {step, answers};
}

export function answerLabels(answer) {
  return [...(answer?.selected_labels || []), ...(answer?.free_text ? [answer.free_text] : [])];
}
