const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const proxies = ['src/features/agent-apps/resources/mcp-app-proxy.html', 'src/features/agent-apps/resources/production-progress-proxy.html', 'src/features/agent-apps/resources/cutlist-review-proxy.html', 'src/features/agent-widgets/widget-proxy.html'];
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('all app and widget proxies accept only their exact serving origin', () => {
  for (const file of proxies) {
    const source = read(file), policy = source.slice(source.indexOf('// ENV_POLICY:BEGIN'), source.indexOf('// ENV_POLICY:END'));
    for (const origin of ['http://localhost:4173', 'http://127.0.0.1:4173']) {
      const context = {URL, location: {origin}};vm.createContext(context);vm.runInContext(policy, context);
      assert.equal(context.isAllowedOrigin(origin), true, file);
      for (const other of ['null', '*', 'https://app.tapnow.media', 'https://preview.tapnow.ai', 'https://tapnow-cn-pr-1.vercel.app', 'http://localhost:4174', 'https://localhost:4173', 'http://localhost:4173/', 'https://evil.test', null]) assert.equal(context.isAllowedOrigin(other), false, `${file}: ${other}`);
    }
  }
});

test('MCP app CSP does not allow host arguments to restore remote resource fetching', () => {
  for (const file of proxies.slice(0, 3)) {
    const source = read(file), start = source.indexOf('function buildCspPolicy('), end = source.indexOf('function buildSrcdocWithCsp(', start), context = {};
    vm.createContext(context);vm.runInContext(source.slice(start, end), context);
    const policy = context.buildCspPolicy({imgDomains:['https://files.tapnow.media'],mediaDomains:['https://files.tapnow.media']});
    assert.match(policy, /connect-src 'none'/);assert.match(policy, /img-src data: blob:;/);assert.doesNotMatch(policy, /https?:/);
    assert.match(policy, file.includes('mcp-app-proxy') ? /media-src blob:;/ : /media-src blob: data:;/);
  }
});
