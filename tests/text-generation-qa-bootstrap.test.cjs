const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('synthetic text QA boots with a full localStorage quota without clearing or initializing writes',()=>{
 let writes=0,removed=0,loads=[];const storage={getItem:()=>null,setItem(){writes++;throw new DOMException('Quota exceeded','QuotaExceededError');},removeItem(){removed++;}},window={localStorage:storage,addEventListener(type,listener){if(type==='load')loads.push(listener);}};
 const context={window,location:{search:'?session=quota-regression'},URLSearchParams,Object};Object.defineProperty(context,'localStorage',{get:()=>window.localStorage});
 vm.runInNewContext(fs.readFileSync(require.resolve('../qa/text-fixture.js'),'utf8'),context);
 assert.equal(window.CANVAS_DATA.nodes.length,3);assert.equal(window.CANVAS_DATA.edges[0].source,'s');assert.equal(window.CANVAS_DB_NAME,'tapnow-qa-text-quota-regression');assert.equal(writes,0);assert.equal(removed,0);
 let view;window.CanvasApp={setView(value){view=value;}};loads[0]();assert.equal(view.x,-51880.25);assert.equal(writes,0);
});
test('public text reference QA shell uses tracked synthetic inputs and omits private data and unrelated marketing',()=>{
 const shell=fs.readFileSync(require.resolve('../src/features/text-generation/qa/text-app.html'),'utf8'),helper=fs.readFileSync(require.resolve('../src/features/text-generation/qa/text-references.html'),'utf8');
 assert(shell.indexOf('qa/text-fixture.js')<shell.indexOf('src="app.js'));assert(!/src="(?:canvas|editor|sidebar|versions)-data\.js/.test(shell));assert(!/Waste to energy|社区|额度|分享|reference-minimap\.svg|sidebars\.js|agent-client\.js|src="advanced-tools\.js|src="audio-ui\.js|src="studio\.mjs/.test(shell));
 assert(helper.includes("frame.src='/src/features/text-generation/qa/text-app.html?session='"));
 assert(shell.includes('src="project-context.js"'));assert(shell.indexOf('src="project-context.js"')<shell.indexOf('src="generation-ui.js'));
 const context={window:{CANVAS_DB_NAME:'text-qa-history'}};vm.runInNewContext(fs.readFileSync(require.resolve('../project-context.js'),'utf8'),context);assert.equal(context.window.CanvasProjectContext.resolve().namespace,'text-qa-history');
});
