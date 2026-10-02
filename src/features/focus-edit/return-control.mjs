import {focusReturnIcon} from './icons.mjs';

// Official lgt: reveal beyond 200 world units; keep zoom and place the source
// 40% of its height above the viewport center over a 500ms transition.
export function createReturnControl({app, sourceId, container, canvas, layout = node => node}) {
  const document = container.ownerDocument;
  const button = document.createElement('button'), divider = document.createElement('span');
  button.className = 'focus-mode-return'; button.type = 'button'; button.ariaLabel = '返回来源节点'; button.innerHTML = focusReturnIcon;
  divider.className = 'focus-mode-divider'; divider.ariaHidden = 'true';
  button.hidden = divider.hidden = true; container.append(button, divider);
  function current() {
    const state = app.getState(), node = state.nodes.find(item => item.id === sourceId);
    return node ? {node: layout(node), view: state.view} : null;
  }
  function update() {
    const value = current(); let visible = false;
    if (value) {
      const {node, view} = value;
      const x = (canvas.clientWidth / 2 - view.x) / view.scale, y = (canvas.clientHeight / 2 - view.y) / view.scale;
      visible = Math.hypot(x - (node.x + node.width / 2), y - (node.y + node.height / 2)) > 200;
    }
    if (button.hidden === visible) button.hidden = !visible;
    if (divider.hidden === visible) divider.hidden = !visible;
  }
  button.onclick = () => {
    const value = current(); if (!value) return;
    const {node, view} = value, x = node.x + node.width / 2, y = node.y + node.height / 2;
    app.transitionView({scale: view.scale, x: canvas.clientWidth / 2 - x * view.scale, y: canvas.clientHeight / 2 - (y + node.height * .4) * view.scale}, 500);
  };
  update(); return {update};
}
