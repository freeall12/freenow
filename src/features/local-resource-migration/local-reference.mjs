import {isStaticAssetRef} from './index-format.mjs';
import {isGenerationMediaRef} from '../generation-results/media-ref.mjs';
import {isOriginalServiceHost} from './origin-policy.mjs';

// Only known durable public routes may shed a same-origin absolute prefix.
// A local server URL alone does not establish a public or persistent resource.
export function localResourcePath(value, {baseUrl = globalThis.document?.baseURI || globalThis.location?.href,
  origin = globalThis.location?.origin} = {}) {
  if (typeof value !== 'string' || !/^https?:\/\//i.test(value) || /[\s\\]/.test(value)) return null;
  try {
    const base = new URL(baseUrl), url = new URL(value);
    if (!['http:', 'https:'].includes(base.protocol) || url.origin !== (origin || base.origin) ||
        url.username || url.password || url.search || url.hash || isOriginalServiceHost(url.hostname)) return null;
    // Reject encoded or literal traversal instead of silently trusting URL's
    // normalization of an ambiguous stored descriptor.
    const rawPath = value.replace(/^https?:\/\/[^/]+/i, '');
    if (rawPath.split('/').some(part => ['.', '..'].includes(decodeURIComponent(part)))) return null;
    return isStaticAssetRef(url.pathname) || isGenerationMediaRef(url.pathname) ? url.pathname : null;
  } catch { return null; }
}
