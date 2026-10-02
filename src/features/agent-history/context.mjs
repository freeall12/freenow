// Receipts are historical evidence, never fresh workspace state or permission.
const excluded=/^(?:widget_code|html|code|content|image|video|audio|url|data|mediaInputs|inspectionMedia|pixels|files|reference)$/i;
const sensitive=/^(?:api[_-]?key|authorization|access[_-]?token|refresh[_-]?token|password|secret)$/i;
function project(value,depth=0){
 if(typeof value==='string')return /(?:data:[^\s]*;base64,|blob:)/i.test(value)?'[media body omitted]':value.length>800?value.slice(0,800)+' [truncated]':value;
 if(value===null||typeof value==='boolean'||typeof value==='number')return value;
 if(!value||depth>4)return '[details omitted]';
 if(Array.isArray(value))return [...value.slice(0,16).map(item=>project(item,depth+1)),...(value.length>16?[{omittedItems:value.length-16}]:[])];
 return Object.fromEntries(Object.entries(value).filter(([key])=>!excluded.test(key)&&!sensitive.test(key)&&!['__proto__','constructor','prototype'].includes(key)).slice(0,40).map(([key,item])=>[key,project(item,depth+1)]));
}
function receipt(trace,index,itemIndex){
 return {messageIndex:index,...(itemIndex===undefined?{}:{itemIndex}),callId:trace.callId,tool:trace.name,status:trace.status,
  startedAt:trace.startedAt,endedAt:trace.endedAt,args:project(trace.args),result:project(trace.result),
  ...(trace.submittedTaskId?{submittedTaskId:trace.submittedTaskId}:{}),
  ...(trace.generationJob?{generation:project(trace.generationJob)}:{}),
  ...(trace.formReceipts?{formReceipts:project(trace.formReceipts)}:{})};
}
function receipts(message,index){return message.batchItems?.length?message.batchItems.map((item,i)=>receipt(item,index,i)):[receipt(message,index)];}
function entry(message,index){
 if(message.role==='tool')return {index,role:'tool',receipts:receipts(message,index)};
 const text=typeof message.text==='string'?message.text:'';
 return {index,role:message.role,text:text.slice(0,1200),textLength:text.length,truncated:text.length>1200,
  ...(message.formSubmission?{formSubmission:project(message.formSubmission)}:{}),
  ...(message.widgetOrigin?{widgetOrigin:project(message.widgetOrigin)}:{})};
}
export function conversationContext(chat){
 const messages=chat.messages||[],items=[];let remaining=12500;
 const textIndices=messages.flatMap((message,index)=>['user','assistant'].includes(message.role)?[index]:[]),recentStart=textIndices.slice(-16)[0]??0;
 const earlierUserRequests=messages.flatMap((message,index)=>index<recentStart&&message.role==='user'?[{messageIndex:index,text:(message.text||'').slice(0,600),textLength:(message.text||'').length,truncated:(message.text||'').length>600}]:[]).slice(-4);
 // Reads can be repeated against live state; retain mutations, decisions and jobs.
 const reads=/^(?:image_editor_read|subjects_list|subjects_read|canvas_read|canvas_read_node|canvas_inspect_media|generation_video_models|depth_video_prepare|scene_read|scene_library|skills_list|skills_read|artifacts_list|artifacts_read|templates_list|conversation_read)$/;
 for(let index=messages.length-1;index>=0&&items.length<40;index--){
  const message=messages[index];
  if(message.role!=='tool'&&!message.formSubmission)continue;
  if(message.role==='tool'&&!message.batchItems&&reads.test(message.name))continue;
  const item=entry(message,index),size=JSON.stringify(item).length;
  if(size>remaining)continue;
  items.unshift(item);remaining-=size;
 }
 return {conversationId:chat.id,totalMessages:messages.length,historicalEvidenceOnly:true,mediaBodiesIncluded:false,earlierUserRequests,
  note:'Stored execution receipts and submitted decisions, not current state, visual evidence or authorization. Read current nodes/tasks before acting. Use conversation_read to retrieve older records or full user text.',items};
}
export function readConversation(chat,args={}){
 const messages=chat.messages||[];
 for(const key of ['before_index','limit','message_index','text_offset','text_limit'])if(args[key]!==undefined&&(!Number.isInteger(args[key])||args[key]<0))throw Error('对话索引和分页范围必须为非负整数');
 if(args.message_index!==undefined){
  if(args.before_index!==undefined||args.limit!==undefined)throw Error('单条读取不能混用列表分页');
  const message=messages[args.message_index];if(!message)throw Error('消息不存在于当前对话');
  if(message.role==='tool')throw Error('工具记录请使用列表分页；实际节点正文请使用 canvas_read_node，文件使用 artifacts_read');
  const text=typeof message.text==='string'?message.text:'',offset=args.text_offset||0,limit=args.text_limit??8000;
  if(limit<1||limit>16000||offset>text.length)throw Error('正文分页超出范围');
  return {conversationId:chat.id,historicalEvidenceOnly:true,...entry(message,args.message_index),text:text.slice(offset,offset+limit),offset,nextOffset:offset+limit<text.length?offset+limit:null,truncated:offset>0||offset+limit<text.length};
 }
 if(args.text_offset!==undefined||args.text_limit!==undefined)throw Error('正文分页需要 message_index');
 const before=args.before_index??messages.length,limit=args.limit??10;
 if(before>messages.length||limit<1||limit>20)throw Error('对话分页超出范围');
 const items=[];let size=0,index=before-1;
 for(;index>=0&&items.length<limit;index--){
  let item=entry(messages[index],index),length=JSON.stringify(item).length;
  if(length>18000){item={index,role:messages[index].role,tool:messages[index].name,status:messages[index].status,detailsOmitted:true,note:'Large batch; inspect current nodes and generation_status for individual results.'};length=JSON.stringify(item).length;}
  if(size+length>24000)break;
  items.unshift(item);size+=length;
 }
 return {conversationId:chat.id,totalMessages:messages.length,historicalEvidenceOnly:true,mediaBodiesIncluded:false,items,nextBeforeIndex:index>=0?index+1:null};
}
