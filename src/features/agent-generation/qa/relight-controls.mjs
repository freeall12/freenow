import {captureAgentRelightApproval,submitAgentRelight} from '../relight.mjs';
import {executeTracedCall,needsToolConfirmation} from '../../agent-execution/trace.mjs';
import {relightDisclosure} from '../../agent-execution/presentation.mjs';
import {attachGenerationJob} from '../jobs.mjs';

// A QA host supplies its isolated local task service and durable receipt writer.
// This helper never configures a provider, invents an output or reads a source.
export async function runAgentRelightQa(args,{
 app,api,parse=globalThis.AgentTools?.parse,mode='ask',confirm,signal,
 persistReceipt,changed=()=>{},callId='relight-qa',runId='relight-qa'
}={}){
 if(!['ask','auto'].includes(mode)||mode==='ask'&&typeof confirm!=='function')throw Error('Agent打光验收需要明确审批回调或auto模式');
 if(typeof parse!=='function'||typeof persistReceipt!=='function')throw Error('Agent打光验收需要正式工具解析器和持久回执入口');
 const parsed=parse('generation_submit',structuredClone(args));
 const approvalGuard=captureAgentRelightApproval(parsed.args,{app,signal});
 await api.availability({kind:'image.relight',signal});approvalGuard();
 const configuration=await api.configuration();approvalGuard();
 const approvedConfiguration=JSON.stringify(configuration??null),disclosure=relightDisclosure(configuration);
 let trace;
 return executeTracedCall({name:'generation_submit',callId,args:parsed.args},{runId,signal,
  confirm:needsToolConfirmation(parsed.definition,mode)?confirm:null,
  changed:value=>{trace=value;trace.relightDisclosure=disclosure;trace.confirmationMode=mode;changed(trace);},
  execute:async(_name,approvedArgs)=>{
   approvalGuard(approvedArgs);
   if(JSON.stringify(await api.configuration()??null)!==approvedConfiguration)throw Error('图片打光供应商配置已变化，请重新确认');
   approvalGuard(approvedArgs);
   return submitAgentRelight(approvedArgs,{app,api,signal,approvedConfiguration,approvalGuard,
    onSubmitted:async job=>{
     if(!trace)throw Error('Agent打光执行记录不存在');
     trace.submittedTaskId=job.id;attachGenerationJob(trace,job);
     if(await persistReceipt(trace)===false)throw Error('Agent打光任务回执未能保存，未派发供应商请求');
     changed(trace);
    }
   });
  }
 });
}
