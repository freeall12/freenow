import {localLifecycleScript} from './local-lifecycle.mjs';
// The captured HTML/GLB stay unchanged on disk. In this opaque sandbox the
// official modern ImageBitmapLoader fetches its own blob URL, which is forbidden
// by connect-src 'none'. The packaged TextureLoader already loads that exact
// embedded JPEG via <img>, allowed by img-src blob:, without network access.
export const actorEmotionReferenceSha256 = '63ee986bdf5b9572cad5edc838da540eda6147007ab3f011604959467616437f';
const original = 'typeof createImageBitmap>"u"||P&&w<17||C&&u<98?this.textureLoader=new kn(this.options.manager):this.textureLoader=new Nn(this.options.manager)';
const local = 'this.textureLoader=new kn(this.options.manager)';
// The official controls debounce state writes for 350ms, while wb immediately
// saves guide pixels. The local persistence contract must commit that exact
// confirmation snapshot first; cancel the debounce so it cannot change state
// identity during the asynchronous guide write. FK keeps the SDK's serial queue.
const originalConfirmation = 'await JK();try{const D=await gb(RD,g,Gg,A);';
const localConfirmation = 'await JK();try{rB!==null&&(clearTimeout(rB),rB=null);await FK(IT(g));const D=await gb(RD,g,Gg,A);';
const startup = 'Qb();</script>';
const closeFlush = 'async function actorCloseFlush(){if(!RD||!zA)return false;SB();if(rB!==null){clearTimeout(rB);rB=null}await FK(IT(zA));return true}';
export async function localizeActorEmotionResources(html, name, version) {
  if (name !== 'actor-emotion') return html;
  if (version !== 'v1') throw Error('unsupported local actor-emotion resource version');
  if (typeof html !== 'string') throw Error('actor-emotion resource must be captured HTML');
  const bytes = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(html));
  const hash = [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, '0')).join('');
  if (hash !== actorEmotionReferenceSha256 || html.split(original).length !== 2 || html.split(originalConfirmation).length !== 2 || html.split(startup).length !== 2) throw Error('actor-emotion local resource integrity mismatch');
  return html.replace(original, local).replace(originalConfirmation, localConfirmation).replace(startup, closeFlush + localLifecycleScript({root: 'PM', flush: 'actorCloseFlush()', busy: 'hg'}) + startup);
}
