'use strict';
// Deterministic localhost-only Responses fixture: real SDK transport, no model.
const http=require('node:http'),{randomUUID}=require('node:crypto');
const form={title:'创作参数确认',description:'本地 SDK 协议验收夹具，提交后创建新的用户回合。',accent:'blue',submit_label:'提交参数',fields:[
 {id:'style',type:'radio',label:'风格',required:true,options:[{value:'film',label:'电影',description:'自然光与电影构图'},{value:'art',label:'艺术',description:'抽象设计'}]},
 {id:'keep',type:'checkbox',label:'保留元素',options:[{value:'actor',label:'人物'},{value:'street',label:'街道'}]},
 {id:'model',type:'select',label:'画幅',options:[{value:'wide',label:'宽屏'},{value:'square',label:'方形'}]},
 {id:'brief',type:'text',label:'创作描述',multiline:true,max_length:500},
 {id:'rating',type:'rating',label:'风格强度',max:5},
 {id:'speed',type:'slider',label:'镜头速度',min:0,max:2,step:.25,unit:'x'},
 {id:'date',type:'date',label:'拍摄日期'},
 {id:'count',type:'number',label:'镜头数量',min:1,max:9,step:1},
 {id:'reference',type:'image_select',label:'参考选项',options:[{value:'a',label:'选项 A'},{value:'b',label:'选项 B'}]}
]};
function createProvider(){const records=[];const server=http.createServer(async(req,res)=>{
 if(req.url==='/stats'){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(records));return;}
 if(req.url!=='/v1/responses'||req.method!=='POST'){res.writeHead(404);res.end();return;}
 let body='';for await(const part of req)body+=part;const input=JSON.parse(body);records.push(input);
 const user=input.input.filter(item=>item.role==='user').at(-1),content=typeof user?.content==='string'?user.content:user?.content?.find(part=>part.type==='input_text')?.text||'';
 const submitted=content.includes('User-submitted form submission'),callId='qa_form_'+randomUUID(),text=submitted?'收到新的结构化用户回合。此固定回复仅验证表单协议；未调用任何生成服务。':'请选择本地测试参数。表单准备完成后本轮结束，提交会创建新用户回合。';
 const output=[{type:'message',role:'assistant',content:[{type:'output_text',text}],status:'completed'}];
 if(!submitted)output.push({type:'function_call',id:'fc_'+callId,call_id:callId,name:'show_form',arguments:JSON.stringify(form),status:'completed'});
 const response={id:'resp_'+randomUUID(),status:'completed',output,output_text:text};
 if(!input.stream){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(response));return;}
 res.writeHead(200,{'content-type':'text/event-stream'});res.write('data: '+JSON.stringify({type:'response.output_text.delta',delta:text})+'\n\n');res.end('data: '+JSON.stringify({type:'response.completed',response})+'\n\ndata: [DONE]\n\n');
 });return {server,records};}
module.exports={createProvider,form};
