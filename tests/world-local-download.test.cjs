'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const bytes = Uint8Array.of(103,108,84,70,2,0,0,0), baseUrl = 'http://localhost:4173/index.html';
const durable = '/api/generation/media/00000000-0000-4000-8000-000000000001';
globalThis.window = {CanvasApp: {}, LocalAssets: {url: async value => value}, location: {href: baseUrl}};
let clicks = [];
globalThis.document = {createElement: tag => ({tag, click() {clicks.push({href: this.href, name: this.download});}})};
const ready = import('../src/features/world-node/resource.mjs');
const response = () => new Response(bytes, {headers: {'content-type': 'model/gltf-binary'}});

test('world downloads accept only local static/durable/asset/blob/model-data bytes and use the same no-redirect fetch path', async () => {
  const {readWorldDownloadBlob} = await ready, requests = [];
  const fetchImpl = async (url, options) => {requests.push([url, options]); return response();};
  for (const source of ['/assets/studio/local.glb', './assets/studio/local.glb', baseUrl.replace('/index.html', '/assets/studio/local.glb'), durable, 'asset:model', 'blob:http://localhost:4173/local', 'data:model/gltf-binary;base64,Z2xURgIAAAA=']) {
    const blob = await readWorldDownloadBlob(source, {baseUrl, fetchImpl, assets: {url: async () => 'blob:http://localhost:4173/model'}});
    assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), bytes);
  }
  assert.equal(requests.length, 7);
  for (const [, options] of requests) {assert.equal(options.redirect, 'error'); assert.equal(options.credentials, 'same-origin'); assert.ok(options.signal);}
  // Native fetch canonicalizes the URI scheme in Response.url. That is not a
  // redirect and must not reject an accepted uppercase data protocol.
  for (const source of ['data:model/gltf-binary;base64,Z2xURgIAAAA=', 'DATA:model/gltf-binary;base64,Z2xURgIAAAA=']) {
    const blob = await readWorldDownloadBlob(source, {baseUrl});
    assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), bytes);
  }
});

test('legacy supplier/original URLs, foreign Blob origins, credentials and unrelated local routes are rejected before any fetch or anchor', async () => {
  const {download, readWorldDownloadBlob} = await ready; let reads = 0; clicks = [];
  const options = {baseUrl, fetchImpl: async () => {reads++; return response();}};
  for (const url of ['https://supplier.invalid/legacy.glb', 'https://files.tapnow.media/legacy.glb', '//files.tapnow.media/legacy.glb', 'https://files.tapnow.ai./legacy.glb', 'blob:https://supplier.invalid/id', 'http://user@localhost:4173/assets/local.glb', '/api/agent/state', '/assets/local.glb?redirect=1', '/assets/%2f../local.glb']) {
    await assert.rejects(download({title: 'legacy', worldResource: {url}}, options), {code: 'media_localization_required'});
  }
  await assert.rejects(readWorldDownloadBlob('asset:unexpected', {...options, assets: {url: async () => 'https://supplier.invalid/legacy.glb'}}), {code: 'media_localization_required'});
  assert.equal(reads, 0); assert.deepEqual(clicks, []);
});

test('misbehaving redirected responses are cancelled and never turn into download/navigation; stream overflow and abort remain bounded', async () => {
  const {readWorldDownloadBlob} = await ready; let cancelled = 0;
  for (const url of ['https://files.tapnow.media/redirect.glb', 'http://localhost:4173/assets/another.glb']) {
    const result = new Response(new ReadableStream({cancel() {cancelled++;}}), {headers: {'content-type': 'model/gltf-binary'}});
    Object.defineProperty(result, 'url', {value: url});
    await assert.rejects(readWorldDownloadBlob('/assets/local.glb', {baseUrl, fetchImpl: async () => result}), {code: 'world_download_redirect_forbidden'});
  }
  const redirected = response(); Object.defineProperty(redirected, 'redirected', {value: true});
  await assert.rejects(readWorldDownloadBlob(durable, {baseUrl, fetchImpl: async () => redirected}), {code: 'world_download_redirect_forbidden'});
  assert.equal(cancelled, 2);
  const huge = new Response(new ReadableStream({start(controller) {controller.enqueue(new Uint8Array(12*1024*1024+1));}, cancel() {cancelled++;}}));
  await assert.rejects(readWorldDownloadBlob('/assets/huge.glb', {baseUrl, fetchImpl: async () => huge}), {code: 'size'}); assert.equal(cancelled, 3);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(readWorldDownloadBlob('/assets/local.glb', {baseUrl, signal: controller.signal, fetchImpl: async () => assert.fail('no aborted request')}), {name: 'AbortError'});
});

test('the production download anchor receives a newly created local Blob URL containing unchanged bytes, never a source address', async () => {
  const {download} = await ready; clicks = [];
  await download({title: 'local', worldResource: {url: '/assets/local.glb', name: 'local.glb'}}, {baseUrl, fetchImpl: async () => response()});
  assert.equal(clicks.length, 1); assert.equal(clicks[0].name, 'local.glb'); assert.ok(clicks[0].href.startsWith('blob:'));
  assert.deepEqual(new Uint8Array(await (await fetch(clicks[0].href)).arrayBuffer()), bytes); URL.revokeObjectURL(clicks[0].href);
});
