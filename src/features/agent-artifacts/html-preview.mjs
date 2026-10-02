import { icons } from './icons.mjs';

export function previewDocument(html) {
  // Opaque iframe origin: generated code cannot read the canvas, cookies or keys.
  // CSP blocks subresources/connections; the sandbox also forbids forms, popups and top navigation.
  const policy = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
  return '<!doctype html><meta http-equiv="Content-Security-Policy" content="' + policy + '"><meta name="referrer" content="no-referrer">' + html;
}
export function openHtmlPreview({ file, onShare, onError, showShare = false }) {
  const previousFocus = document.activeElement;
  const dialog = document.createElement('dialog'); dialog.className = 'agent-html-preview'; dialog.setAttribute('aria-label', 'HTML 预览');
  const side = document.createElement('aside'), main = document.createElement('div'); main.className = 'agent-html-main';
  const brand = document.createElement('div'); brand.className = 'agent-html-brand';
  const logo = document.createElement('img'); logo.src = 'assets/tap-logo-official.svg'; logo.alt = 'TapNow';
  brand.append(logo, document.createTextNode('TapNow')); side.append(brand);
  const title = document.createElement('h3'); title.textContent = file.title || file.artifact_path.split('/').at(-1); side.append(title);
  const disclaimer = document.createElement('p'); disclaimer.className = 'agent-html-disclaimer';
  disclaimer.textContent = '此页面由用户使用 AI 创建，可能包含不准确的信息，请自行核实。其内容与观点不代表 TapNow。'; side.append(disclaimer);
  const actions = document.createElement('div'); actions.className = 'agent-html-actions';
  const status = document.createElement('p'); status.role = 'status'; status.className = 'agent-artifact-status';
  function button(label, icon, action) {
    const button = document.createElement('button'); button.type = 'button'; button.ariaLabel = label; button.innerHTML = icons[icon]; button.append(document.createTextNode(label)); button.onclick = action; return button;
  }
  actions.append(button('下载 HTML', 'download', () => {
    const blob = new Blob([file.content], { type: 'text/html;charset=utf-8' }), url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = (file.artifact_path.split('/').at(-1).replace(/\.html?$/i, '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/^\.+|\.+$/g, '').slice(0,120) || 'creative-page') + '.html';
    dialog.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000);
  }));
  const share = button('分享此页面', 'share', async () => {
    if (share.disabled) return;
    share.disabled = true; status.textContent = '正在分享…';
    try {
      if (!onShare) throw Error('分享服务未配置');
      const result = await onShare({ artifact_path: file.artifact_path, revision: file.revision, title: file.title, html: file.content });
      const url = new URL(result.url);
      if (!['http:', 'https:'].includes(url.protocol)) throw Error('分享服务返回了无效链接');
      if (!dialog.isConnected) return;
      status.textContent = '分享链接'; const input = document.createElement('input'); input.readOnly = true; input.value = url.href; input.ariaLabel = '分享链接'; input.onfocus = () => input.select();
      share.replaceWith(input, button('复制', 'copy', async () => { try { await navigator.clipboard.writeText(url.href); status.textContent = '已复制链接'; } catch { status.textContent = '复制失败，请手动复制链接'; } }));
    } catch (error) { status.textContent = error.message; onError?.(error.message); } finally { share.disabled = false; }
  });
  if (showShare) actions.append(share); actions.append(status); side.append(actions);
  const frame = document.createElement('iframe'); frame.title = title.textContent; frame.setAttribute('sandbox', 'allow-scripts'); frame.referrerPolicy = 'no-referrer'; frame.srcdoc = previewDocument(file.content); main.append(frame);
  const close = button('关闭预览', 'close', () => dialog.close()); close.className = 'agent-html-close'; close.lastChild.remove();
  dialog.append(side, main, close); document.body.append(dialog);
  dialog.addEventListener('close', () => { dialog.remove(); previousFocus?.isConnected && previousFocus.focus(); }, { once: true });
  dialog.onkeydown = event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dialog.close(); } };
  dialog.showModal(); close.focus();
  return { close() { dialog.close(); } };
}
