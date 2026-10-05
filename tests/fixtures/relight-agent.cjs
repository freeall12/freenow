'use strict';
const {randomUUID}=require('node:crypto');
const {parse}=require('../../agent-tools.js');

// Reuse the relight QA's actual generation gateway. Only Agent model replies
// are fixed here; this fixture never creates or reports generated media.
function createRelightAgentFixture({nodeId,relight}={}){
 const args=parse('generation_submit',{kind:'image.relight',nodeId,prompt:'',relight}).args;
 const runs=new Map(),requests=[];
 return {requests,handle(pathname,method,body){
  if(!pathname.startsWith('/api/agent/'))return null;
  requests.push({path:pathname,method});
  const json=value=>({status:200,json:value});
  if(pathname==='/api/agent/config'&&method==='GET')return json({configured:true,model:'固定本机打光验收回复'});
  if(pathname==='/api/agent/turn'&&method==='POST'){
   if(!body?.binding)return {status:400,json:{error:'Agent验收缺少实际对话绑定'}};
   const id='qa-relight-'+randomUUID();runs.set(id,{binding:JSON.stringify(body.binding)});
   return json({sessionId:id,round:1,done:false,text:'本机协议验收：固定Agent回复请求按明确参数编辑来源图。真实提交与落图状态来自本机任务网关，结果为验收素材。',calls:[{callId:id+'-call',name:'generation_submit',args:structuredClone(args),mutates:true}]});
  }
  if(pathname==='/api/agent/continue'&&method==='POST'){
   const run=runs.get(body?.sessionId);
   if(!run||run.binding!==JSON.stringify(body.binding))return {status:400,json:{error:'Agent验收对话绑定已变化'}};
   return json({sessionId:body.sessionId,round:2,done:true,text:'已收到工具回执；任务ID只证明提交，生成与保存状态请查看实际任务记录。',calls:[]});
  }
  if(pathname==='/api/agent/cancel'&&method==='POST')return json({cancelled:true});
  return {status:404,json:{error:'本机Agent验收未声明该接口或方法'}};
 }};
}
module.exports={createRelightAgentFixture};
