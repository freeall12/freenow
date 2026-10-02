export const titleLimit = 100;

export function historyEntries(chats) {
  return chats.filter(chat => chat.messages?.length > 0)
    .map((chat, index) => ({ ...chat, sourceOrder: index }))
    .sort((a, b) => {
      const dateA = Date.parse(a.updatedAt || a.createdAt) || 0;
      const dateB = Date.parse(b.updatedAt || b.createdAt) || 0;
      return dateB - dateA || b.sourceOrder - a.sourceOrder;
    });
}

export function normalizeTitle(value) {
  return String(value ?? '').slice(0, titleLimit).trim();
}

// Day.js relative-time thresholds used by the official bundle; preserve missing
// legacy timestamps rather than inventing a creation date for old local chats.
export function relativeTime(value, now = Date.now()) {
  const date = Date.parse(value);
  if (!Number.isFinite(date)) return '';
  const seconds = (now - date) / 1000;
  if (seconds >= 0 && seconds < 60) return '刚刚';
  const past = seconds >= 0, distance = Math.abs(seconds);
  let amount, label;
  if (Math.round(distance) <= 89) { amount = 1; label = '分钟'; }
  else if (Math.round(distance / 60) <= 44) { amount = Math.round(distance / 60); label = '分钟'; }
  else if (Math.round(distance / 60) <= 89) { amount = 1; label = '小时'; }
  else if (Math.round(distance / 3600) <= 21) { amount = Math.round(distance / 3600); label = '小时'; }
  else if (Math.round(distance / 3600) <= 35) { amount = 1; label = '天'; }
  else if (Math.round(distance / 86400) <= 25) { amount = Math.round(distance / 86400); label = '天'; }
  else if (Math.round(distance / 86400) <= 45) { amount = 1; label = '个月'; }
  else {
    const months = Math.abs(monthDifference(new Date(now), new Date(date)));
    if (Math.round(months) <= 10) { amount = Math.round(months); label = '个月'; }
    else if (Math.round(months) <= 17) { amount = 1; label = '年'; }
    else { amount = Math.round(months / 12); label = '年'; }
  }
  return `${amount} ${label}${past ? '前' : '后'}`;
}

function monthDifference(a, b) {
  if (a.getDate() < b.getDate()) return -monthDifference(b, a);
  const whole = (b.getFullYear() - a.getFullYear()) * 12 + b.getMonth() - a.getMonth();
  const addMonths = count => {
    const result = new Date(a); result.setDate(1); result.setMonth(result.getMonth() + count);
    const last = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
    result.setDate(Math.min(a.getDate(), last)); return result;
  };
  const anchor = addMonths(whole), before = b - anchor < 0;
  const adjacent = addMonths(whole + (before ? -1 : 1));
  return -(whole + (b - anchor) / (before ? anchor - adjacent : adjacent - anchor)) || 0;
}
