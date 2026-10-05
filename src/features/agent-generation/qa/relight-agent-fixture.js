// Load after the relight QA isolation bootstrap and before production scripts.
// Only model replies are fixed. Generation requests retain the host's actual
// generation gateway or its explicitly labeled boundary fixture.
(()=>{
 const host=window.RelightFixture;
 if(host?.ready!==true)throw Error('Agent打光夹具必须运行在已隔离的打光验收宿主');
 const inherited=window.fetch.bind(window),runs=new Map();
 const state=window.RelightAgentFixture={turns:0,requests:[],generationReceipts:[],lighting:{angle:{preset:'top_front_right_45'},brightnessPercent:100,temperatureK:3000,rimEnabled:true,rimPreset:'low_back_45'}};
 state.setLighting=value=>{window.AgentTools.parse('generation_submit',{kind:'image.relight',nodeId:'relight-source',prompt:'',relight:value});state.lighting=structuredClone(value);};
 window.fetch=async(input,options={})=>{
  const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,document.baseURI||location.href),method=(options.method||input?.method||'GET').toUpperCase();
  if(url.origin!==location.origin||!url.pathname.startsWith('/api/agent/')){
   if(url.origin===location.origin&&url.pathname==='/api/generation/tasks'&&method==='POST'&&state.turns){
    const id=new Headers(options.headers).get('Idempotency-Key'),record=await window.CanvasStore.readRecord('agent-conversations:'+(window.CanvasProjects?.id()||'canvas'));
    const acknowledged=record?.chats?.some(chat=>chat.messages?.some(trace=>trace.name==='generation_submit'&&trace.args?.kind==='image.relight'&&trace.submittedTaskId===id));
    state.generationReceipts.push({id,acknowledged:acknowledged===true});
    if(!acknowledged)throw Error('Agent打光夹具：真实持久对话缺少派发前原任务ID');
   }
   return inherited(input,options);
  }
  state.requests.push({path:url.pathname,method});
  if(url.pathname==='/api/agent/config'&&method==='GET')return Response.json({configured:true,model:'固定本机打光验收回复'});
  const body=options.body?JSON.parse(options.body):null;
  if(url.pathname==='/api/agent/turn'&&method==='POST'){
   if(!body?.binding)throw Error('Agent打光夹具缺少实际对话绑定');
   const args=window.AgentTools.parse('generation_submit',{kind:'image.relight',nodeId:'relight-source',prompt:'',relight:structuredClone(state.lighting)}).args;
   const id='qa-relight-'+crypto.randomUUID();state.turns++;runs.set(id,JSON.stringify(body.binding));
   return Response.json({sessionId:id,round:1,done:false,text:'本机固定回复：按明确参数编辑完整来源图。任务与保存状态来自验收宿主，未调用真实Agent模型。',calls:[{callId:id+'-call',name:'generation_submit',args,mutates:true}]});
  }
  if(url.pathname==='/api/agent/continue'&&method==='POST'){
   if(!runs.has(body?.sessionId)||runs.get(body.sessionId)!==JSON.stringify(body.binding))throw Error('Agent打光夹具对话绑定已变化');
   return Response.json({sessionId:body.sessionId,round:2,done:true,text:'已收到工具回执；任务ID只证明提交，请检查实际生成任务和画布保存状态。',calls:[]});
  }
  if(url.pathname==='/api/agent/cancel'&&method==='POST')return Response.json({cancelled:true});
  throw Error('Agent打光夹具未声明此接口或方法');
 };
})();
