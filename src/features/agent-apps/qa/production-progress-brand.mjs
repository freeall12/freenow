import {createMcpAppCard} from '../card.mjs';
import {createMcpAppHost} from '../host.mjs';
import {appPolicy, prepareApp} from '../registry.mjs';
import {productionProgressUri, normalizeProductionProgressResult, validateProductionProgressRequest} from '../production-progress.mjs';
const status = document.getElementById('status'), cards = document.getElementById('cards');
const title = document.getElementById('title'), locale = document.getElementById('locale'), theme = document.getElementById('theme');
const projectUrl = new URL('/', location.href).href, nodeIds = ['qa-brand-pending-image'];
let card, trace, host, blocked = false, queries = 0;
function render() {
  card?.destroy();
  const args = {resource_uri: productionProgressUri, title: title.value || '用户项目', data: {node_ids: nodeIds, project_id: 'qa-brand-display-only', project_url: projectUrl, ...(blocked ? {status: 'blocked', reason: 'insufficient_balance'} : {})}};
  trace = {id: crypto.randomUUID(), name: 'show_app', args, status: 'done', result: prepareApp(args)};
  const current = trace;
  document.body.dataset.theme = theme.value;
  card = createMcpAppCard({trace, policy: {...appPolicy(productionProgressUri), resourceUri: productionProgressUri}, hostOptions: {theme: theme.value, locale: locale.value}, isCurrent: () => trace === current, createHost(options) {
    host = createMcpAppHost({...options, callbacks: {...options.callbacks,
      onReady() {options.callbacks.onReady?.();status.textContent = `已加载生产双层 iframe；${blocked ? '额度不足' : '待处理'}为本地显示测试，未提交生成。查询 ${queries} 次。`;},
      onProductionProgressQuery(args) {
        validateProductionProgressRequest(args, current.result.response);queries += 1;
        return normalizeProductionProgressResult({structuredContent: {items: nodeIds.map(node_id => ({node_id, status: 'pending', media_type: 'image', title: title.value || '用户项目'})), project_url: projectUrl}}, current.result.response);
      },
    }});return host;
  }});
  cards.replaceChildren(card.element);
}
document.getElementById('running').onclick = () => {blocked = false;render();};
document.getElementById('blocked').onclick = () => {blocked = true;render();};
title.onchange = render;
locale.onchange = () => host?.updateHostContext({locale: locale.value});
theme.onchange = () => {document.body.dataset.theme = theme.value;host?.updateHostContext({theme: theme.value});};
render();
