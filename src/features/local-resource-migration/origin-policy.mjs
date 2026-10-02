const originalDomains = Object.freeze([
  'tapnow.media', 'tapnow.ai', 'tapnow.art', 'tapnow.top', 'tapnow.zone',
  'tapnow.plus', 'tapnow.tv', 'tamaredge.top',
  'conversation-service-131786869360.asia-northeast1.run.app'
]);

export function isOriginalServiceHost(hostname) {
  const host = String(hostname).toLowerCase().replace(/\.+$/, '');
  return originalDomains.some(domain => host === domain || host.endsWith('.' + domain));
}

// Generated widgets may link to independent sources, but cannot reinstate an
// original-service dependency through their host's user-activated openLink.
export function independentNavigationUrl(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw Error('链接地址无效');
  if (isOriginalServiceHost(url.hostname))
    throw Object.assign(Error('此链接指向原站服务，本地版本不连接该服务'), {code: 'original_service_blocked'});
  return url.href;
}
