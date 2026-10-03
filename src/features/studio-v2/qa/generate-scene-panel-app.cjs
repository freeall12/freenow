const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../../../..'),target=path.join(__dirname,'scene-panel-main.html');
let source=fs.readFileSync(path.join(root,'index.html'),'utf8');
source=source.replace('<head>','<head>\n  <base href="/">\n  <meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\' \'unsafe-inline\'; style-src \'self\' \'unsafe-inline\'; connect-src \'self\' blob: data:; img-src \'self\' blob: data:; media-src \'self\' blob: data:; font-src \'self\' data:; worker-src \'self\' blob:; frame-src \'none\'; object-src \'none\'; form-action \'none\'; base-uri \'self\'">\n  <script src="src/features/studio-v2/qa/scene-panel-fixture.js"></script>');
for(const name of ['canvas-data','editor-data','sidebar-data','versions-data'])source=source.replace(new RegExp('src="'+name+'\\.js[^\"]*"','g'),'src="defaults/'+name+'.js"');
source=source.replace('<title>未命名画布 · 画布复刻</title>','<title>片场目录与分页 · 隔离 QA</title>');
source=source.replace('</body>','<script type="module" src="src/features/studio-v2/qa/scene-panel-controls.mjs"></script></body>');
fs.writeFileSync(target,source);console.log(target);
