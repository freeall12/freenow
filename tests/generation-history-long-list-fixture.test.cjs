'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../src/features/generation-history/qa/long-list-fixture.js'),'utf8');
function fixture(session='test'){class FixtureURL extends URL{}const forwarded=[],preferences={getItem(){throw Error('must not read real preferences');}},window={location:{},localStorage:preferences,fetch:async(...args)=>{forwarded.push(args);return Response.json({fixture:true});},addEventListener(){}};const context=vm.createContext({window,location:{href:'http://127.0.0.1:4173/qa/generation-history-long-list.html?session='+session,origin:'http://127.0.0.1:4173',search:'?session='+session},URL:FixtureURL,URLSearchParams,Response,XMLHttpRequest:class{open(){}},navigator:{}});vm.runInContext(source,context);return {window,context,forwarded};}
test('long-list boot isolates all IDB/preferences and refuses provider or external requests before production scripts',async()=>{
 const f=fixture();assert.equal(f.window.CANVAS_DB_NAME,'qa-history-long-list:test:canvas');assert.equal(f.window.LOCAL_ASSETS_DB_NAME,'qa-history-long-list:test:assets');assert.equal(f.window.localStorage.getItem('private'),null);f.window.localStorage.setItem('private','QA only');assert.equal(f.window.localStorage.getItem('private'),'QA only');
 const configured=await (await f.window.fetch('/api/generation/config')).json();assert.equal(configured.configured,false);assert.equal(f.forwarded.length,0);await assert.rejects(f.window.fetch('/api/generation/tasks'),/禁止模型/);await assert.rejects(f.window.fetch('https://provider.example/media.png'),/禁止外部/);assert.equal(f.forwarded.length,0);await f.window.fetch('data:image/png;base64,aA==');assert.equal(f.forwarded.length,1);assert.equal(f.window.HistoryLongListFixture.externalAttempts.length,1);assert.equal(f.window.HistoryLongListFixture.blockedAPIs.length,1);
});
test('invalid QA sessions fail without selecting a production namespace',()=>{
 assert.throws(()=>fixture('bad/session'),/session 无效/);
});
test('generated long-list entry runs the isolation guard first and uses public empty defaults',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../qa/generation-history-long-list.html'),'utf8');assert.ok(html.indexOf('src/features/generation-history/qa/long-list-fixture.js')<html.indexOf('src="defaults/canvas-data.js'));assert.match(html,/defaults\/sidebar-data\.js/);assert.match(html,/src\/features\/generation-history\/qa\/long-list-controls\.mjs/);assert.doesNotMatch(html,/src="(?:canvas-data|editor-data|sidebar-data|versions-data)\.js/);
});
