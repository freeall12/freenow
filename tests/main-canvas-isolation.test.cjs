'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),fsp=require('node:fs/promises'),vm=require('node:vm'),path=require('node:path'),os=require('node:os');

test('production canvas GET and HEAD require local resources while preserving local Three workers and inline UI',async t=>{
 const root=await fsp.mkdtemp(path.join(os.tmpdir(),'canvas-isolation-'));t.after(()=>fsp.rm(root,{recursive:true,force:true}));await fsp.writeFile(path.join(root,'index.html'),'<!doctype html><title>local canvas</title>');
 const source=fs.readFileSync(require.resolve('../server/server.cjs'),'utf8'),begin=source.indexOf('http.createServer(')+'http.createServer('.length,end=source.indexOf('\nPromise.all([generation.ready',begin),callback=source.slice(begin,end).trim().replace(/\);$/,'');
 const handler=vm.runInNewContext('('+callback+')',{URL,path,root,port:4173,mime:{'.html':'text/html'},json:(res,status,data)=>{res.status=status;res.data=data;},fs:{promises:fsp,createReadStream:()=>({pipe:res=>res.end()})}});
 for(const url of ['/','/index.html','//index.html'])for(const method of ['GET','HEAD']){
  const res={writeHead(status,headers){this.status=status;this.headers=headers;},end(){this.ended=true;},headersSent:false};
  await handler({headers:{host:'localhost:4173'},url,method},res);assert.equal(res.status,200,url);
  const policy=res.headers['Content-Security-Policy'],directives=Object.fromEntries(policy.split(';').map(rule=>{const [name,...values]=rule.trim().split(/\s+/);return [name,values];}));
  for(const name of ['connect-src','img-src','media-src','font-src'])assert.deepEqual(directives[name],["'self'",'data:','blob:']);
  assert.deepEqual(directives['worker-src'],["'self'",'blob:']);assert.deepEqual(directives['frame-src'],["'self'",'blob:']);
  assert.ok(directives['script-src'].includes("'unsafe-eval'"));assert.ok(directives['style-src'].includes("'unsafe-inline'"));
  assert.deepEqual(directives['object-src'],["'none'"]);assert.equal(res.ended,true);
 }
});
