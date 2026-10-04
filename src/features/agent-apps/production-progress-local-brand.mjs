// Keep captured reference bytes, protocol names and host-provided content intact.
// Only this known renderer's fixed UI labels and footer mark are derived locally.
export const productionProgressReferenceSha256 = 'acd4e750bc11ca20c2e44a87a7a7c1ba0bfd0053d8d1c8ecbf87d38be98a9b4f';
export const productionProgressBrandSha256 = '408aa0c0d3fad94e812df60f5258218e685a3ae915c36656198a8444bb957b93';
export const productionProgressBrandUrl = new URL('../../../assets/branding/freenow-mark.svg', import.meta.url).href;
const labels = [
  ['generating:{en:"TapNow is working…",zh:"TapNow 正在生成…"}', 'generating:{en:"freenow is working…",zh:"freenow 正在生成…"}'],
  ['pendingState:{en:"TapNow is working",zh:"TapNow 正在生成"}', 'pendingState:{en:"freenow is working",zh:"freenow 正在生成"}'],
  ['openProject:{en:"Open in TapNow",zh:"在 TapNow 中打开"}', 'openProject:{en:"Open in freenow",zh:"在 freenow 中打开"}'],
  ['timedOut:{en:"The panel stopped refreshing. The task may still be running — check TapNow or the chat for the result.",zh:"面板已停止刷新。任务可能仍在进行，请到 TapNow 或对话里查看结果。"}', 'timedOut:{en:"The panel stopped refreshing. The task may still be running — check freenow or the chat for the result.",zh:"面板已停止刷新。任务可能仍在进行，请到 freenow 或对话里查看结果。"}'],
  ['blockedBalance:{en:"Not enough credits for this generation. Top up in TapNow and try again.",zh:"额度不足，本次生成未能开始。请在 TapNow 充值后重试。"}', 'blockedBalance:{en:"The configured provider reports insufficient quota. Check its account balance and API configuration before retrying.",zh:"已配置供应商报告额度不足。请核对供应商账户余额和 API 配置后重试。"}'],
];
const brandStyle = '.open-link .brand { width: 15px; height: 15px; }';
const localBrandStyle = brandStyle + '\n    .open-link img.brand { flex-shrink: 0; object-fit: contain; filter: invert(1); }\n    :root[data-theme="light"] .open-link img.brand { filter: none; }';
async function sha256(text) {
  const bytes = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, '0')).join('');
}
export async function localizeProductionProgressBrand(html, name, version, brandSvg) {
  if (name !== 'production-progress') return html;
  if (version !== 'v1') throw Error('unsupported local production-progress brand version');
  if (typeof html !== 'string' || await sha256(html) !== productionProgressReferenceSha256) throw Error('production-progress reference integrity mismatch');
  if (typeof brandSvg !== 'string' || brandSvg.length > 4096 || await sha256(brandSvg) !== productionProgressBrandSha256) throw Error('production-progress local brand integrity mismatch');
  for (const [original, local] of [...labels, [brandStyle, localBrandStyle]]) {
    if (html.split(original).length !== 2) throw Error('production-progress brand target integrity mismatch');
    html = html.replace(original, local);
  }
  // The entire source hash pins this single minified function and its boundary.
  // Encode unchanged SVG bytes so no SVG text can become inline script syntax.
  const start = 'function I_(){', end = 'we.ontoolresult=';
  if (html.split(start).length !== 2 || html.split(end).length !== 2) throw Error('production-progress mark target integrity mismatch');
  const from = html.indexOf(start), to = html.indexOf(end, from);
  if (to < from) throw Error('production-progress mark boundary integrity mismatch');
  const dataUrl = 'data:image/svg+xml;base64,' + btoa(brandSvg);
  const local = 'function I_(){const n=document.createElement("img");n.setAttribute("class","brand freenow-brand-mark"),n.setAttribute("alt",""),n.setAttribute("aria-hidden","true"),n.src=' + JSON.stringify(dataUrl) + ';return n}';
  return html.slice(0, from) + local + html.slice(to);
}
