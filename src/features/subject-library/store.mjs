const key = () => window.SUBJECT_LIBRARY_KEY || 'tapnow-subject-library-v1';
function allSubjects() {
  try {const value = JSON.parse(localStorage.getItem(key()) || '[]'); return Array.isArray(value) ? value.filter(s => s && Array.isArray(s.assets)) : [];} catch {return [];}
}
export function listSubjects(scope) {return allSubjects().filter(s=>!s.deletedAt&&(!scope||s.scope===scope));}
export function archiveSubject(id) {const subject=listSubjects().find(s=>s.id===id);if(subject)saveSubject({...subject,deletedAt:Date.now()});}
export function saveSubject(subject) {
  const items = allSubjects(), at = items.findIndex(s => s.id === subject.id);
  if (at < 0) items.push(subject);
  else {
    // An editor can stay open across an Agent save. Keep the committed receipts
    // even when the user's later edit deliberately replaces the subject content.
    const receipts=items[at].agentOperations;
    items[at] = {...subject,...(Array.isArray(receipts)?{agentOperations:receipts}:{})};
  }
  localStorage.setItem(key(), JSON.stringify(items));
  document.dispatchEvent(new Event('subjects:changed'));
}
export function assetFromNode(n) {
  const url = n.type === 'video' ? n.video || window.EDITOR_DATA?.nodes[n.id]?.video : n.type === 'audio' ? n.audio : n.fullImage || n.image;
  return {id:n.id, sourceNodeId:n.id, source:'canvas', type:n.type, name:n.title, url, image:n.image, text:n.content, durationMs:n.durationMs};
}
