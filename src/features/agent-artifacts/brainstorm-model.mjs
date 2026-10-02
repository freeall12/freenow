export const brainstormPath = 'artifacts/brainstorm.md';
export function parseBrainstorm(markdown = '') {
  const result = { title: '', sections: [] };
  let section = null, card = null, sectionLine = 0;
  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    const title = line.match(/^#\s+(.+?)\s*$/);
    if (title && !result.title) { result.title = title[1]; continue; }
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) { section = { title: heading[1], isEmpty: false, placeholder: null, fields: [], cards: [] }; result.sections.push(section); card = null; sectionLine = 0; continue; }
    if (!section) continue;
    sectionLine++;
    const candidate = line.match(/^###\s+(.+?)\s*$/);
    if (candidate) {
      const separator = candidate[1].indexOf('·');
      card = { shortLabel: (separator < 0 ? candidate[1] : candidate[1].slice(0, separator)).trim(), longLabel: separator < 0 ? null : candidate[1].slice(separator + 1).trim() || null, fields: [] };
      section.cards.push(card); section.isEmpty = false; section.placeholder = null; continue;
    }
    const field = line.match(/^\s*[-*+]\s+\*\*\s*(.+?)\s*\*\*\s*(.*?)\s*$/);
    if (field) {
      const name = field[1].replace(/[:：]\s*$/u, '').trim();
      const value = (/[:：]\s*$/u.test(field[1]) ? field[2] : field[2].replace(/^[:：]\s*/u, '')).trim();
      if (name && value) { (card || section).fields.push({ name, value }); section.isEmpty = false; section.placeholder = null; }
      continue;
    }
    const placeholder = !card && sectionLine === 1 && line.match(/^_(.+?)_\s*$/);
    if (placeholder) { section.isEmpty = true; section.placeholder = placeholder[1]; }
  }
  return result;
}
export function sectionMarkdown(markdown, title) {
  const lines = markdown.split(/\r?\n/), start = lines.findIndex(line => line.match(/^##\s+(.+?)\s*$/)?.[1].trim() === title.trim());
  if (start < 0) return '';
  let end = start + 1;
  while (end < lines.length && !/^##\s+/.test(lines[end])) end++;
  while (end > start + 1 && !lines[end - 1].trim()) end--;
  return lines.slice(start, end).join('\n');
}
export const cardKey = (section, card) => JSON.stringify([section, card]);
export function changesBetween(previous, next) {
  const sections = new Set(), cards = new Set();
  if (!previous?.sections.length) return { sections, cards };
  for (const section of next.sections) {
    const old = previous.sections.find(item => item.title === section.title);
    if (JSON.stringify(old) === JSON.stringify(section)) continue;
    sections.add(section.title);
    for (const card of section.cards) if (JSON.stringify(old?.cards.find(item => item.shortLabel === card.shortLabel)) !== JSON.stringify(card)) cards.add(cardKey(section.title, card.shortLabel));
  }
  return { sections, cards };
}
