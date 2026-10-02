'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),fsp=require('node:fs/promises'),vm=require('node:vm'),path=require('node:path'),os=require('node:os');
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
const source=fs.readFileSync(require.resolve('../server/server.cjs'),'utf8'),begin=source.indexOf('http.createServer(')+'http.createServer('.length,end=source.indexOf('\nPromise.all([generation.ready',begin),callback=source.slice(begin,end).trim().replace(/\);$/,'');
async function fixture(t,ready){
 const root=await fsp.mkdtemp(path.join(os.tmpdir(),'local-index-route-review-'));t.after(()=>fsp.rm(root,{recursive:true,force:true}));await fsp.mkdir(path.join(root,'assets'));await fsp.writeFile(path.join(root,'assets/local-resource-index.json'),'stale-on-disk-table');let staticReads=0;
 const context={URL,path,root,port:4173,localResourceIndexReady:ready,mime:{'.json':'application/json'},json:(res,status,value)=>{res.status=status;res.payload=value;},fs:{promises:fsp,createReadStream:file=>({pipe:res=>{staticReads++;res.body=fs.readFileSync(file,'utf8');}})}};
 const handler=vm.runInNewContext('('+callback+')',context);
 function request(url,method='GET'){const res={writeHead(status){this.status=status;},end(){this.ended=true;},headersSent:false};return{res,done:handler({headers:{host:'localhost:4173'},url,method},res)};}
 return{request,staticReads:()=>staticReads};
}
const aliases=['/assets/local-resource-index.json','/assets//local-resource-index.json','/assets///local-resource-index.json','/assets/%2Flocal-resource-index.json','/assets/./local-resource-index.json','/assets/%2e/local-resource-index.json'];
test('failed startup index never exposes the stale disk table through canonical or normalized aliases',async t=>{
 const f=await fixture(t,Promise.resolve({published:false}));for(const alias of aliases){const {res,done}=f.request(alias);await done;assert.equal(res.status,503,alias);assert.equal(res.payload.code,'local_resource_index_unavailable');assert.equal(res.body,undefined);}
 assert.equal(f.staticReads(),0);
});
test('successful empty public index comes from the validated startup result for all path aliases',async t=>{
 const index={version:1,algorithm:'sha256-exact-utf8',entries:{}},f=await fixture(t,Promise.resolve({published:true,index}));for(const alias of aliases){const {res,done}=f.request(alias);await done;assert.equal(res.status,200,alias);assert.deepEqual(res.payload,index);assert.equal(res.body,undefined);}
 assert.equal(f.staticReads(),0);const {res,done}=f.request('/assets//local-resource-index.json','HEAD');await done;assert.equal(res.status,405);
});
test('index request waits for actual startup verification rather than falling back to an existing table',async t=>{
 const gate=deferred(),f=await fixture(t,gate.promise),{res,done}=f.request('/assets//local-resource-index.json');await new Promise(setImmediate);assert.equal(res.status,undefined);assert.equal(f.staticReads(),0);gate.resolve({published:false});await done;assert.equal(res.status,503);
});
