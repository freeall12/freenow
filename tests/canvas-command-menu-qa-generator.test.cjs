'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{execFileSync}=require('node:child_process');
test('menu QA generator creates a missing output directory and references versioned feature sources',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'canvas-command-menu-qa-'));
 try{
  fs.mkdirSync(path.join(root,'scripts'));fs.writeFileSync(path.join(root,'index.html'),'<html><head></head><body></body></html>');
  fs.copyFileSync(require.resolve('../scripts/create-canvas-command-menu-main-qa.cjs'),path.join(root,'scripts/create.cjs'));
  execFileSync(process.execPath,[path.join(root,'scripts/create.cjs')],{stdio:'pipe'});
  const html=fs.readFileSync(path.join(root,'qa/canvas-command-menu/app.html'),'utf8');
  for(const file of ['fixture.js','controls.mjs']){assert(html.includes('/src/features/canvas-command-menu/qa/'+file));assert(fs.existsSync(path.join(__dirname,'../src/features/canvas-command-menu/qa',file)));}
  assert(!html.includes('src="/qa/canvas-command-menu/fixture.js"'));assert(!html.includes('src="/qa/canvas-command-menu/controls.mjs"'));
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
