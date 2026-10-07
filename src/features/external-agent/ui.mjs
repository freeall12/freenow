export function createExternalAgentUI({window}) {
  const document = window.document, bridge = window.FreenowExternalAgent;
  let dialog, timer, loading = false, refreshing = false;
  const text = (tag, value, className) => {const node = document.createElement(tag); node.textContent = value; if (className) node.className = className; return node;};
  function close() {if (timer) window.clearInterval(timer); timer = null; dialog?.close(); dialog?.remove(); dialog = null;}
  async function open() {
    if (dialog?.open) {dialog.focus(); return;}
    if (!document.querySelector('link[data-external-agent-style]')) {
      const style = document.createElement('link'); style.rel = 'stylesheet'; style.href = new URL('./ui.css', import.meta.url).href; style.dataset.externalAgentStyle = ''; document.head.append(style);
    }
    dialog = document.createElement('dialog'); dialog.className = 'external-agent-dialog'; dialog.setAttribute('aria-label', '连接外部 Agent');
    const currentDialog = dialog;
    const header = text('header', ''); header.append(text('h2', '连接外部 Agent'));
    const dismiss = text('button', '关闭'); dismiss.type = 'button'; dismiss.addEventListener('click', close); header.append(dismiss); dialog.append(header);
    dialog.append(text('p', '允许支持本机 MCP stdio 的 Agent 读取当前画布的节点概要。连接成功后仍需逐个授权，有效期一小时。关闭、重载或切换画布后失效。'));
    dialog.append(text('p', '当前仅提供画布状态与节点列表，不开放正文、媒体、系统文件、写操作或生成。客户端可能把获准的概要发给自己的模型。云端连接器不能直接访问此本机通道。', 'external-agent-boundary'));
    const content = text('section', ''), notice = text('p', '', 'external-agent-notice'); notice.setAttribute('role', 'status'); dialog.append(content, notice);
    dialog.addEventListener('cancel', event => {event.preventDefault(); close();});
    dialog.addEventListener('keydown', event => {
      if (event.key !== 'Tab' || event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return;
      // Include asynchronous client controls in the dialog's focus cycle by
      // querying the live list for every key instead of retaining an early list.
      const controls = [...currentDialog.querySelectorAll('button,textarea,input,select,a[href],[tabindex]')].filter(element => !element.disabled && element.tabIndex >= 0 && !element.closest('[hidden],[inert]') && window.getComputedStyle(element).display !== 'none' && window.getComputedStyle(element).visibility !== 'hidden');
      if (!controls.length) return;
      event.preventDefault(); event.stopPropagation();
      const current = controls.indexOf(document.activeElement), next = current < 0 ? (event.shiftKey ? controls.length - 1 : 0) : (current + (event.shiftKey ? -1 : 1) + controls.length) % controls.length;
      controls[next].focus();
    });
    document.body.append(dialog); dialog.showModal();
    if (!bridge) {content.append(text('p', '请在 freenow 桌面版中使用此功能。浏览器版当前没有外部 MCP 通道。')); return;}
    const configLabel = text('label', '本机连接配置（将 freenow 项加入客户端的 MCP 配置）'), config = document.createElement('textarea'); config.readOnly = true; config.rows = 7; config.setAttribute('aria-label', '本机 MCP 连接配置');
    configLabel.append(config); content.append(configLabel);
    const copy = text('button', '复制配置'); copy.type = 'button'; copy.addEventListener('click', async () => {try {await window.navigator.clipboard.writeText(config.value); notice.textContent = '配置已复制。';} catch {config.focus(); config.select(); notice.textContent = '请复制已选中的配置文本。';}}); content.append(copy);
    const project = text('p', ''), heading = text('h3', '客户端连接'), list = text('div', ''); content.append(project, heading, list);
    const clientRows = new Map(), empty = text('p', '尚无客户端连接。添加上方配置并完成 MCP 握手后，客户端会显示在这里。');
    const action = async (method, connectionId) => {
      if (loading) return; loading = true; for (const row of clientRows.values()) row.button.disabled = true; notice.textContent = method === 'approve' ? '请在桌面授权窗口确认范围。' : '正在撤销连接…';
      try {const result = await bridge.invoke(method, {connectionId}); notice.textContent = result.error ? '操作未完成：' + result.error.code : result.cancelled ? '已取消授权。' : method === 'approve' ? '已允许读取当前画布概要。' : '连接授权已撤销。';}
      catch {notice.textContent = '桌面连接不可用，请重新打开面板。';}
      finally {loading = false; await refresh();}
    };
    async function refresh() {
      if (dialog !== currentDialog || !currentDialog.open || loading || refreshing) return; refreshing = true;
      try {
        const status = await bridge.invoke('status'); if (dialog !== currentDialog || !currentDialog.open) return;
        if (status.error) {notice.textContent = '桌面连接不可用：' + status.error.code; return;}
        const serialized = JSON.stringify(status.config, null, 2); if (config.value !== serialized) config.value = serialized;
        project.textContent = status.available ? '授权范围：当前画布「' + status.project.title + '」' : '画布尚未就绪，暂不能授权。';
        const currentIds = new Set(status.clients.map(client => client.id));
        for (const [id, entry] of clientRows) if (!currentIds.has(id)) {entry.row.remove(); clientRows.delete(id);}
        for (const client of status.clients) {
          let entry = clientRows.get(client.id);
          if (!entry) {
            const row = text('div', '', 'external-agent-client'), label = text('div', ''), name = text('strong', ''), state = text('small', ''), button = text('button', '');
            label.append(name, state); button.type = 'button'; row.append(label, button); entry = {row, name, state, button, client}; clientRows.set(client.id, entry);
            button.addEventListener('click', () => action(entry.client.state === 'authorized' ? 'revoke' : 'approve', entry.client.id)); list.append(row);
          }
          // Retain the same button during polling and authorization changes:
          // replacing it loses keyboard focus and native accessibility identity.
          entry.client = client;
          const stateLabel = '自报名称 · ' + ({pending: '待授权', authorized: '已授权', revoked: '已撤销', expired: '已过期'}[client.state] || '未授权'), buttonLabel = client.state === 'authorized' ? '撤销' : '授权读取';
          if (entry.name.textContent !== client.client.name) entry.name.textContent = client.client.name;
          if (entry.state.textContent !== stateLabel) entry.state.textContent = stateLabel;
          if (entry.button.textContent !== buttonLabel) entry.button.textContent = buttonLabel;
          entry.button.disabled = !status.available && client.state !== 'authorized';
        }
        if (clientRows.size) empty.remove(); else if (!empty.isConnected) list.append(empty);
      } catch {if (dialog?.open) notice.textContent = '无法读取连接状态，请重新打开面板。';}
      finally {refreshing = false;}
    }
    await refresh(); if (dialog === currentDialog && currentDialog.open) timer = window.setInterval(() => {void refresh();}, 2000);
  }
  const removeOpen = bridge?.onOpen(() => {void open();});
  window.addEventListener('pagehide', () => {close(); removeOpen?.();}, {once: true});
  return Object.freeze({open, close});
}
