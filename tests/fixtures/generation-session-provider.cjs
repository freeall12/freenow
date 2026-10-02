'use strict';
// Local synthetic tasks-v1 fixture. No credentials, external calls or paid API.
const http=require('node:http');
const {readFixtureSource}=require('./generation-local-media-server.cjs');
let PNG;
const source={fixture:true,nonAI:true,width:96,height:64,description:'本机合成 96 × 64 彩色棋盘格，非 AI 生成'};
const tasks=new Map(),counts={posts:0,polls:0,cancels:0,authorizationReceived:false};
const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
const server=http.createServer(async(req,res)=>{
 try{
  const pathname=new URL(req.url,'http://localhost').pathname;
  if(pathname==='/status')return json(res,200,{...counts,taskCount:tasks.size,...source});
  counts.authorizationReceived ||= !!req.headers.authorization;
  if(pathname==='/v1/tasks'&&req.method==='POST'){
   let text='';for await(const part of req){text+=part;if(Buffer.byteLength(text)>1024*1024)return json(res,413,{error:'fixture payload too large'});}
   const input=JSON.parse(text),id='qa-session-task-'+(++counts.posts),outputs=input.kind==='text.generate'?[{type:'text',text:'本机合成 tasks-v1 验证结果'}]:[{type:'image',url:'data:image/png;base64,'+PNG,title:source.description,width:source.width,height:source.height}];
   const task={id,status:'succeeded',outputs};tasks.set(id,task);return json(res,200,task);
  }
  const match=pathname.match(/^\/v1\/tasks\/([^/]+)$/),task=match&&tasks.get(decodeURIComponent(match[1]));
  if(task&&req.method==='GET'){counts.polls++;return json(res,200,task);}
  if(task&&req.method==='DELETE'){counts.cancels++;return json(res,200,{id:task.id,status:'cancelled'});}
  return json(res,404,{error:'fixture task not found'});
 }catch{return json(res,400,{error:'fixture invalid request'});}
});
readFixtureSource().then(({bytes})=>{PNG=bytes.toString('base64');server.listen(Number(process.env.QA_PROVIDER_PORT||0),'127.0.0.1',()=>console.log('Synthetic tasks-v1 (96x64 geometric PNG, not AI): http://127.0.0.1:'+server.address().port+'/v1 | counters /status'));}).catch(()=>{console.error('Synthetic fixture PNG unavailable');process.exitCode=1;});
for(const event of ['SIGINT','SIGTERM'])process.once(event,()=>server.close(()=>process.exit(0)));
