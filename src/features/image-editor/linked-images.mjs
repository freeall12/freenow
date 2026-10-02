// Official image designer ZQ: aspect-ratio-balanced rows, no gap, centered
// inside the logical artboard. Viewport zoom never enters these coordinates.
export function layoutLinkedImages(images, {width, height, gap = 0}) {
  if (!images.length) return [];
  if (![width, height].every(value => Number.isFinite(value) && value > 0) ||
      images.some(image => ![image.width, image.height].every(value => Number.isFinite(value) && value > 0))) {
    throw Error('图片或画布尺寸无效');
  }
  const ratios = images.map(image => image.width / Math.max(image.height, 1));
  const total = ratios.reduce((sum, ratio) => sum + ratio, 0);
  const count = Math.max(1, Math.min(Math.round(Math.sqrt(total / (width / height))), images.length));
  const rows = [], target = total / count;
  let start = 0;
  for (let row = 0; row < count; row++) {
    if (row === count - 1) {rows.push(ratios.map((_, index) => index).slice(start)); break;}
    let sum = 0, end = start + 1, closest = Infinity;
    for (let index = start; index < images.length - (count - row - 1); index++) {
      sum += ratios[index];
      const distance = Math.abs(sum - target);
      if (distance <= closest) {closest = distance; end = index + 1;} else break;
    }
    rows.push(ratios.map((_, index) => index).slice(start, end)); start = end;
  }
  const heights = rows.map(row => (width - (row.length - 1) * gap) / row.reduce((sum, index) => sum + ratios[index], 0));
  const average = rows.length > 1 ? heights.slice(0, -1).reduce((sum, value) => sum + value, 0) / (rows.length - 1) : heights[0];
  const plan = rows.map((indices, index) => {
    let rowHeight = heights[index], rowWidth = width;
    if (index === rows.length - 1 && rows.length > 1 && rowHeight > average * 1.3) {
      rowHeight = average;
      rowWidth = rowHeight * indices.reduce((sum, item) => sum + ratios[item], 0) + (indices.length - 1) * gap;
    }
    return {indices, height: rowHeight, width: rowWidth};
  });
  const totalHeight = plan.reduce((sum, row) => sum + row.height, 0) + (plan.length - 1) * gap;
  const scale = Math.min(1, height / totalHeight), result = new Array(images.length);
  let top = (height - totalHeight * scale) / 2;
  for (const row of plan) {
    let left = (width - row.width * scale) / 2;
    const rowHeight = row.height * scale;
    for (const index of row.indices) {
      const displayedWidth = rowHeight * ratios[index], imageScale = displayedWidth / images[index].width;
      result[index] = {left, top, scaleX: imageScale, scaleY: imageScale};
      left += displayedWidth + gap * scale;
    }
    top += rowHeight + gap * scale;
  }
  return result;
}

export function needsLinkedImages(node) {
  const doc = node.editorDoc;
  // Older saved empty documents have a cover. New documents carry an explicit
  // marker so deleting every layer and saving never resurrects source images.
  return doc?.initialized !== true && !doc?.canvas?.objects?.length && !node.image;
}

export function linkedImageInputs(nodeId, {nodes, edges}) {
  const byId = new Map(nodes.map(node => [node.id, node])), seen = new Set();
  return edges.filter(edge => edge.target === nodeId).flatMap(edge => {
    const node = byId.get(edge.source), src = node?.fullImage || node?.image;
    if (!node || node.type !== 'image' || !src || seen.has(node.id)) return [];
    seen.add(node.id); return [{id: node.id, src, name: node.title || '图片'}];
  });
}

export async function loadLinkedImages(inputs, load, signal) {
  const results = await Promise.all(inputs.map(async input => {
    try {return {input, image: await load(input, signal)};}
    catch (error) {return {input, error};}
  }));
  const loaded = results.filter(result => result.image);
  if (signal.aborted) {
    for (const {image} of loaded) image.dispose();
    return {loaded: [], failed: []};
  }
  return {loaded, failed: results.filter(result => result.error).map(result => result.input)};
}
