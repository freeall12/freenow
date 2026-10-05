// The installed and captured page remain byte-identical evidence. Its drag
// selection must obey the same one-format-per-ratio rule as its preset buttons.
export const platformResizeInteractionReferenceSha256 = '897f46887563e4ed59db6b0f33cb0896631715c0c39a7e8793470978c7383365';
// The shared proxy's existing four fixed freenow labels, with no other changes.
export const platformResizeBrandedReferenceSha256 = '7a1fa947d13cecfce3a51abcf989db260c600ec8ae96aa2c820f263f6fcc0001';
const original = 'n.x=d,n.y=l,re.has(n.platform)||re.add(n.platform),ae=null,Te()';
const local = 'n.x=d,n.y=l,(()=>{const selected=hm(n.ratio_id);selected!==null&&selected!==n.platform&&re.delete(selected);re.add(n.platform)})(),ae=null,Te()';
export async function localizePlatformResizeInteractions(html, name, version) {
  if (name !== 'platform-resize') return html;
  if (version !== 'v1') throw Error('unsupported local platform-resize interaction version');
  if (typeof html !== 'string') throw Error('platform-resize interaction must be captured HTML');
  const bytes = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(html));
  const hash = [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, '0')).join('');
  if (![platformResizeInteractionReferenceSha256, platformResizeBrandedReferenceSha256].includes(hash) || html.split(original).length !== 2) throw Error('platform-resize interaction reference integrity mismatch');
  return html.replace(original, local);
}
