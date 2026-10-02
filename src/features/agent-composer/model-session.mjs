// Old local conversations do not reliably record a model. Never infer it from
// the current global preference: that preference can belong to another chat.
export function hasStartedSession(session) {
  return !!session && (!!session.selectedModelAtStart || !!session.messages?.length);
}
export function sessionModelId(session, preferredId) {
  return hasStartedSession(session) ? session.selectedModelAtStart || null : preferredId;
}
export function captureSessionModel(session, preferredId) {
  const id = sessionModelId(session, preferredId);
  if (!id) throw Error('此历史对话未记录使用的模型，请新建对话后继续。历史内容已保留。');
  session.selectedModelAtStart = id;
  return id;
}
