// Documents retain logical pixels. View scale never enters object serialization.
export function dimensions(width, height) {
  width = Number(width); height = Number(height);
  if (![width, height].every(n => Number.isInteger(n) && n >= 16 && n <= 4096)) throw Error('画布宽高须为 16–4096 的整数');
  return { width, height };
}
export class DocumentHistory {
  constructor(limit = 50) { this.limit = limit; this.past = []; this.future = []; }
  reset(value) { this.past = [JSON.stringify(value)]; this.future = []; }
  push(value) { const s = JSON.stringify(value); if (this.past.at(-1) === s) return false; this.past.push(s); if (this.past.length > this.limit + 1) this.past.shift(); this.future = []; return true; }
  undo() { if (this.past.length < 2) return null; this.future.push(this.past.pop()); return JSON.parse(this.past.at(-1)); }
  redo() { if (!this.future.length) return null; const s = this.future.pop(); this.past.push(s); return JSON.parse(s); }
}
// PSD v1: full-size RGBA raster layers plus a flattened RGB composite. Editable
// vectors remain in the Fabric document; PSD layers are explicitly rasterized.
export function encodePSD(width, height, layers, composite) {
  dimensions(width, height);
  if (width * height * 4 !== composite.length) throw Error('PSD composite dimensions do not match');
  const blocks = [];
  const bytes = (...v) => Uint8Array.from(v);
  const u16 = v => bytes(v >>> 8, v);
  const u32 = v => bytes(v >>> 24, v >>> 16, v >>> 8, v);
  const ascii = s => Uint8Array.from(s, c => c.charCodeAt(0));
  const join = parts => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let offset = 0; for (const p of parts) { out.set(p, offset); offset += p.length; } return out; };
  const records = [], channels = [], count = width * height;
  if (layers.length > 100) throw Error('PSD 最多导出 100 个图层');
  for (const layer of [...layers].reverse()) {
    if (layer.pixels.length !== count * 4) throw Error('PSD layer dimensions do not match');
    const name = String(layer.name || 'Layer');
    const legacy = ascii(name.replace(/[^\x20-\x7e]/g, '_').slice(0, 255));
    const pascal = join([bytes(legacy.length), legacy, new Uint8Array((4 - (legacy.length + 1) % 4) % 4)]);
    const unicode = join([u32(name.length), ...Array.from({length:name.length}, (_, i) => u16(name.charCodeAt(i)))]);
    const extra = join([u32(0), u32(0), pascal, ascii('8BIMluni'), u32(unicode.length), unicode, new Uint8Array(unicode.length % 2)]);
    records.push(join([u32(0), u32(0), u32(height), u32(width), u16(4), ...[0, 1, 2, 65535].flatMap(id => [u16(id), u32(count + 2)]), ascii('8BIMnorm'), bytes(255, 0, layer.hidden ? 2 : 0, 0), u32(extra.length), extra]));
    for (let c = 0; c < 4; c++) { const plane = new Uint8Array(count + 2); for (let i = 0; i < count; i++) plane[i + 2] = layer.pixels[i * 4 + c]; channels.push(plane); }
  }
  const info = join([u16(layers.length), ...records, ...channels]);
  const padded = join([info, new Uint8Array(info.length % 2)]);
  const layerMask = join([u32(padded.length), padded, u32(0)]);
  blocks.push(ascii('8BPS'), u16(1), new Uint8Array(6), u16(3), u32(height), u32(width), u16(8), u16(3), u32(0), u32(0), u32(layerMask.length), layerMask, u16(0));
  for (let c = 0; c < 3; c++) { const plane = new Uint8Array(count); for (let i = 0; i < count; i++) { const alpha = composite[i * 4 + 3] / 255; plane[i] = Math.round(composite[i * 4 + c] * alpha + 255 * (1 - alpha)); } blocks.push(plane); }
  return join(blocks);
}
