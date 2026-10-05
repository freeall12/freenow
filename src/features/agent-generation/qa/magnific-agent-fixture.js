// Only Agent replies are fixed; media, native HTTP and persistence come from
// the isolated enhancement host and production scripts.
(()=>{
 if(window.MagnificFixture?.ready!==true)throw Error('Magnific Agent 夹具需要已隔离的增强验收宿主');
 const inherited=window.fetch.bind(window),runs=new Map();
 const state=window.MagnificAgentFixture={turns:0,requests:[],generationReceipts:[],upscale:{provider:'magnific',scaleFactor:3,sharpen:14,smartGrain:29,ultraDetail:41},targetNodeId:null};
 const argumentsFor=()=>({kind:'image.upscale',nodeId:window.MagnificFixture.sourceNodeId||'magnific-source',prompt:'',upscale:{...state.upscale},...(state.targetNodeId?{targetNodeId:state.targetNodeId}:{})});
 state.setParameters=value=>{window.AgentTools.parse('generation_submit',{...argumentsFor(),upscale:value});state.upscale=structuredClone(value);};
 state.useTarget=id=>{window.AgentTools.parse('generation_submit',{...argumentsFor(),...(id?{targetNodeId:id}:{})});state.targetNodeId=id||null;};
 window.fetch=async(input,options={})=>{
  const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,document.baseURI||location.href),method=(options.method||input?.method||'GET').toUpperCase();
  if(url.origin!==location.origin||!url.pathname.startsWith('/api/agent/')){
   if(url.origin===location.origin&&url.pathname==='/api/generation/tasks'&&method==='POST'&&state.turns){
    const id=new Headers(options.headers).get('Idempotency-Key'),record=await window.CanvasStore.readRecord('agent-conversations:'+(window.CanvasProjects?.id()||'canvas'));
    const acknowledged=record?.chats?.some(chat=>chat.messages?.some(trace=>trace.name==='generation_submit'&&trace.args?.kind==='image.upscale'&&trace.args?.upscale?.provider==='magnific'&&trace.submittedTaskId===id));
    state.generationReceipts.push({id,acknowledged:acknowledged===true});
    if(!acknowledged)throw Error('Magnific Agent 夹具：真实持久对话缺少派发前原任务 ID');
   }
   return inherited(input,options);
  }
  state.requests.push({path:url.pathname,method});
  if(url.pathname==='/api/agent/config'&&method==='GET')return Response.json({configured:true,model:'固定本机 Magnific 验收回复'});
  const body=options.body?JSON.parse(options.body):null;
  if(url.pathname==='/api/agent/turn'&&method==='POST'){
   if(!body?.binding)throw Error('Magnific Agent 夹具缺少实际对话绑定');
   const args=window.AgentTools.parse('generation_submit',argumentsFor()).args,id='qa-magnific-'+crypto.randomUUID();state.turns++;runs.set(id,JSON.stringify(body.binding));
   return Response.json({sessionId:id,round:1,done:false,text:'本机固定回复：按明确 Magnific 四参数放大完整来源图，将结果保存为增强节点的新版本。正式审批、原生接口和保存状态来自验收宿主，未调用真实 Agent 模型。',calls:[{callId:id+'-call',name:'generation_submit',args,mutates:true}]});
  }
  if(url.pathname==='/api/agent/continue'&&method==='POST'){
   if(!runs.has(body?.sessionId)||runs.get(body.sessionId)!==JSON.stringify(body.binding))throw Error('Magnific Agent 夹具对话绑定已变化');
   return Response.json({sessionId:body.sessionId,round:2,done:true,text:'已收到工具回执；任务 ID 只证明提交，请检查原任务、增强节点版本和实际画布保存状态。',calls:[]});
  }
  if(url.pathname==='/api/agent/cancel'&&method==='POST')return Response.json({cancelled:true});
  throw Error('Magnific Agent 夹具未声明此接口或方法');
 };
})();
