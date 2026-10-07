'use strict';
const path = require('node:path');
const {parseEnv} = require('node:util');
const PORT = 4183;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const PARTITION = 'persist:freenow-desktop-v1';

// The provider file is local operator configuration, never renderer input. In
// particular it cannot inject Node flags, preload libraries or change origin.
function providerEnvironment(text) {
  const values = parseEnv(text), result = Object.create(null);
  for (const [key, value] of Object.entries(values)) {
    if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(key) ||
        /^(?:NODE_|ELECTRON_|FREENOW_|DYLD_|LD_|SSL_)/.test(key) ||
        /^(?:PORT|PATH|HOME|TMPDIR|USER|SHELL|CODEX_HOME|HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NO_PROXY)$/.test(key)) {
      throw Error('接口配置含不支持的运行环境选项，请使用配置模板。');
    }
    result[key] = value;
  }
  return result;
}
function serverEnvironment({text, dataDirectory, temporaryDirectory, platform = process.platform}) {
  return {
    ...providerEnvironment(text),
    PATH: platform === 'win32' ? process.env.PATH || '' : '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin',
    TMPDIR: temporaryDirectory,
    PORT: String(PORT),
    FREENOW_DATA_DIR: path.join(dataDirectory, 'backend'),
    FREENOW_PREBUILT_RESOURCES: '1',
  };
}
function isLocalNavigation(value) {
  try {const url = new URL(value); return url.origin === ORIGIN && !url.username && !url.password;}
  catch {return false;}
}
function providerTemplate(source) {
  return '# freenow desktop: Key 只由本地后台读取。修改后退出并重开应用。\n' +
    '# 不继承其他项目的环境变量；不要填写 PORT、NODE_OPTIONS 或代理环境变量。\n' +
    source.replace(/^PORT=.*\r?\n/gm, '').replace(/^# Example only[^\n]*\n# Start using[^\n]*\n/, '');
}
module.exports = {PORT, ORIGIN, PARTITION, providerEnvironment, serverEnvironment, isLocalNavigation, providerTemplate};
