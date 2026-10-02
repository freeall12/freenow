(function (root) {
  'use strict';
  const clone = value => structuredClone(value);
  const textControls='input,textarea,select,[contenteditable],[role="textbox"]';
  const interactiveControls='a,button,[role="button"],[role="combobox"],[role="dialog"],[role="alertdialog"],[role="listbox"],[role="menu"],[role="menuitem"],[role="slider"]';
  function eventTarget(event, document) {
    const path=event.composedPath?.()[0],target=path?.closest?path:event.target;
    return !target||target===document.body||target===document.documentElement?document.activeElement||target:target;
  }
  function keyboardScope(target, canvas) {
    if(!target?.closest)return 'external';
    const explicit=target.closest('[data-keyboard-scope]')?.getAttribute('data-keyboard-scope');
    if(['external','local-tool','overlay','text-editor'].includes(explicit))return explicit;
    if(target.isContentEditable||target.closest(textControls))return 'text-editor';
    if(target.closest(interactiveControls))return 'external';
    return canvas?.contains(target)?'canvas':'external';
  }
  const isComposing=event=>event.isComposing||event.keyCode===229||event.key==='Process';
  const clipboardFiles=data=>Array.from(data?.files||[]).length?Array.from(data.files):Array.from(data?.items||[]).filter(item=>item.kind==='file').map(item=>item.getAsFile()).filter(Boolean);
  function capture(nodes, edges, selected) {
    const ids = new Set(selected),byId=new Map(),children=new Map(),queue=[...ids];
    for(const node of nodes){byId.set(node.id,node);if(node.parentId){let siblings=children.get(node.parentId);if(!siblings)children.set(node.parentId,siblings=[]);siblings.push(node.id);}}
    // Parent order is arbitrary after imports. Walk each descendant once rather
    // than rescanning the complete canvas once per level of a deep group.
    for(let cursor=0;cursor<queue.length;cursor++){
      const id=queue[cursor];
      for(const child of [...(children.get(id)||[]),...(byId.get(id)?.memberIds||[])])if(!ids.has(child)){ids.add(child);queue.push(child);}
    }
    const picked = nodes.filter(n => ids.has(n.id));
    if (!picked.length) throw Error('请选择要复制的节点');
    if (picked.some(n => n.type === 'studio')) throw Error('暂不支持复制 3D 片场');
    return { nodes: clone(picked).map(n => { if (!ids.has(n.parentId)) delete n.parentId; return n; }), edges: clone(edges.filter(e => ids.has(e.target))) };
  }
  function remap(value, ids, key = '') {
    if (Array.isArray(value)) return value.map(v => remap(v, ids, key));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, remap(v, ids, k)]));
    if (typeof value === 'string' && ['referenceOrder','referenceKey'].includes(key) && value.startsWith('node:')) return 'node:' + (ids.get(value.slice(5)) || value.slice(5));
    return typeof value === 'string' && ['id', 'nodeId', 'sourceId', 'parentId', 'referenceIds', 'referenceBindings'].includes(key) ? ids.get(value) || value : value;
  }
  function instantiate(snapshot, existing, point, iteration = 0, scale = 1, idFactory = () => crypto.randomUUID()) {
    if (!snapshot?.nodes?.length || ![point.x, point.y, scale].every(Number.isFinite) || scale <= 0) throw Error('粘贴位置无效');
    const hidden = new Set(snapshot.nodes.flatMap(n => n.memberIds || [])), visible = snapshot.nodes.filter(n => !hidden.has(n.id));
    const dx = point.x - Math.min(...visible.map(n => n.x)) + iteration * 40 / scale;
    const dy = point.y - Math.min(...visible.map(n => n.y)) + iteration * 40 / scale;
    const ids = new Map(snapshot.nodes.map(n => [n.id, idFactory()]));
    const nodes = snapshot.nodes.map(source => {
      const n = clone(source); n.id = ids.get(source.id); n.x += dx; n.y += dy;
      n.parentId = ids.get(n.parentId); if (!n.parentId) delete n.parentId;
      if (n.memberIds) n.memberIds = n.memberIds.map(id => ids.get(id));
      if (n.sourceId) n.sourceId = ids.get(n.sourceId) || n.sourceId;
      if (n.clips) n.clips = n.clips.map(c => ({...c, id: idFactory(), sourceId: ids.get(c.sourceId) || c.sourceId}));
      if (n.generation) n.generation = remap(n.generation, ids);
      if (n.audioConfig) n.audioConfig = remap(n.audioConfig, ids);
      return n;
    });
    const live = new Set([...existing.map(n => n.id), ...nodes.map(n => n.id)]);
    const edges = snapshot.edges.map(e => ({ ...clone(e), id: idFactory(), source: ids.get(e.source) || e.source, target: ids.get(e.target), path: undefined })).filter(e => live.has(e.source) && live.has(e.target));
    return { nodes, edges, selected: nodes.filter((n, i) => !n.parentId && !hidden.has(snapshot.nodes[i].id)).map(n => n.id) };
  }
  const api = { capture, instantiate, eventTarget, keyboardScope, isComposing, clipboardFiles };
  if (typeof module !== 'undefined') module.exports = api; else root.CanvasClipboard = api;
})(typeof window === 'undefined' ? globalThis : window);
