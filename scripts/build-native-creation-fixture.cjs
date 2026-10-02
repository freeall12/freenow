'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {createMiniMaxProvider} = require('../server/generation-minimax.cjs');
const {createTripoProvider} = require('../server/generation-tripo.cjs');
const root = path.resolve(__dirname, '..');
const noNetwork = async () => {throw Error('QA builder must never contact a supplier');};
const ratios = ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'];
const durations = Array.from({length: 12}, (_, index) => index + 4);
const specification = {resolutions: ['768P', '2K'], durations};
const minimax = createMiniMaxProvider({baseUrl: 'https://api.minimax.io', apiKey: 'qa-fake-key-no-model-call', fetchImpl: noNetwork, modelMap: {
  'MiniMax-H3': {kind: 'video.generate', model: 'MiniMax-H3', modes: {
    TEXT_TO_VIDEO: {...specification, ratios},
    IMAGE_TO_VIDEO: {...specification, ratios: ['adaptive']},
    START_END_TO_VIDEO: {...specification, ratios: ['adaptive']},
    REFERENCE_TO_VIDEO: {...specification, ratios: ['adaptive', ...ratios], maxImages: 9, maxVideos: 3, maxAudios: 3, maxMedia: 12,
      videoDurationRange: {min: 2, max: 15, totalMax: 15}, audioDurationRange: {min: 2, max: 15, totalMax: 15}}
  }}
}}).metadata;
const tripo = createTripoProvider({apiKey: 'qa-fake-key-no-model-call', fetchImpl: noNetwork, modelMap: {
  'tripo-text-to-model-h3': {kind: 'world.generate', mode: 'text-to-model', model: 'v3.1-20260211', displayModel: 'Tripo H3.1'},
  'tripo-image-to-model-h3': {kind: 'world.generate', mode: 'image-to-model', model: 'v3.1-20260211', displayModel: 'Tripo H3.1'}
}}).metadata;
if (!minimax.configured || !tripo.configured) throw Error('Native QA provider metadata is not configured');
if (!fs.statSync(path.join(root, 'qa/trim-scenes.mp4')).size) throw Error('Fixed local QA video is missing');
const config = {configured: true, protocol: 'routed', missing: [], configurationError: null,
  providers: {minimax, tripo}, routes: {
    'video.generate': {models: {'MiniMax-H3': 'minimax'}},
    'world.generate': {models: {'tripo-text-to-model-h3': 'tripo', 'tripo-image-to-model-h3': 'tripo'}}
  }};
const csp = "default-src 'self' blob: data:; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; connect-src 'self' blob: data:; img-src 'self' blob: data:; media-src 'self' blob: data:; font-src 'self' data:; worker-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'self'";
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8').replace('<head>', '<head><base href="/"><meta http-equiv="Content-Security-Policy" content="' + csp + '"><script type="application/json" id="qa-native-configuration">' + JSON.stringify(config).replace(/</g, '\\u003c') + '</script><script src="qa/native-creation-fixture.js"></script>');
for (const name of ['canvas-data', 'editor-data', 'sidebar-data', 'versions-data']) html = html.replace(new RegExp('src="' + name + '\\.js[^\"]*"'), 'src="defaults/' + name + '.js"');
html = html.replace('<script src="defaults/canvas-data.js"></script>', '<script src="defaults/canvas-data.js"></script><script>window.CANVAS_DATA.nodes=[];window.CANVAS_DATA.edges=[];</script>');
html = html.replace('</body>', '<script type="module" src="qa/native-creation-controls.mjs"></script></body>');
fs.writeFileSync(path.join(root, 'qa/native-creation-app.html'), html);
console.log('Open /qa/native-creation-app.html?session=unique. QA fixed local MP4 + cube GLB; no real model call.');
