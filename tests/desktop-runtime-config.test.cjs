'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {providerEnvironment, providerTemplate, serverEnvironment, isLocalNavigation} = require('../desktop/runtime-config.cjs');
const {isRuntimeFile} = require('../scripts/prepare-desktop.cjs');
test('desktop provider configuration cannot mutate host runtime or stable origin', () => {
  for (const key of ['NODE_OPTIONS', 'ELECTRON_RUN_AS_NODE', 'FREENOW_DATA_DIR', 'PORT', 'DYLD_INSERT_LIBRARIES', 'PATH', 'HTTPS_PROXY']) assert.throws(() => providerEnvironment(`${key}=fixture`));
  const env = serverEnvironment({text: 'OPENAI_API_KEY=\nOPENAI_MODEL=operator-model\nCUSTOM_PROVIDER_KEY=\n', dataDirectory: '/tmp/freenow-contract', temporaryDirectory: '/tmp'});
  assert.equal(env.PORT, '4183'); assert.equal(env.FREENOW_DATA_DIR, '/tmp/freenow-contract/backend');
  assert.equal(env.FREENOW_PREBUILT_RESOURCES, '1'); assert.equal(env.OPENAI_MODEL, 'operator-model');
  assert.equal(env.HOME, undefined); assert.equal(env.CODEX_HOME, undefined);
  assert.equal(providerEnvironment(providerTemplate('PORT=4173\nOPENAI_API_KEY=\n')).PORT, undefined);
});
test('desktop navigation allows only its own loopback origin', () => {
  for (const url of ['http://127.0.0.1:4183/', 'http://127.0.0.1:4183/assets/spark.js']) assert.equal(isLocalNavigation(url), true);
  for (const url of ['http://localhost:4173/', 'https://app.tapnow.media/', 'file:///tmp/a.html', 'http://user@127.0.0.1:4183/', 'http://127.0.0.1:4184/']) assert.equal(isLocalNavigation(url), false);
});
test('desktop public allowlist excludes captures, credentials, QA and personal startup data', () => {
  for (const file of ['.env', '.env.local', 'server/.generation-media/x.png', 'reference/source.har', 'canvas-data.js', 'qa/trim-scenes.mp4', 'src/features/studio-v2/qa/main.html', 'assets/private.key', 'docs/research/source.json', 'src/../private']) assert.equal(isRuntimeFile(file), false, file);
  for (const file of ['index.html', 'app.js', 'server/server.cjs', 'defaults/canvas-data.js', 'src/features/desktop/lifecycle.mjs', 'assets/branding/freenow-mark.svg', 'runtime-reference/skills-catalog.json']) assert.equal(isRuntimeFile(file), true, file);
});
