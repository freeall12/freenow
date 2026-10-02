'use strict';
// Never cut a serialized graph mid-JSON or silently discard the receipt ledger.
function workspaceMetadata(context){
 const input=context&&typeof context==='object'&&!Array.isArray(context)?context:{};
 const output={},omissions=[];let remaining=56000;
 const keys=[...new Set(['delegatedPrerequisiteResults','conversationMemory','widgetOrigin','studioNodeId','selectedSkills','references','selected','view','composerReferences','attachments','activeScene','artifacts',...Object.keys(input)])];
 for(const key of keys){
  if(!Object.hasOwn(input,key)||['__proto__','constructor','prototype'].includes(key))continue;
  const value=input[key],encoded=JSON.stringify(value);if(encoded===undefined)continue;
  const allowance=Math.min(remaining, key==='conversationMemory'?18000:24000);
  if(encoded.length+key.length+6<=allowance){output[key]=value;remaining-=encoded.length+key.length+6;continue;}
  if(Array.isArray(value)){
   let low=0,high=value.length;
   while(low<high){const mid=Math.ceil((low+high)/2);if(JSON.stringify(value.slice(0,mid)).length+key.length+6<=allowance)low=mid;else high=mid-1;}
   if(remaining>key.length+8){output[key]=value.slice(0,low);remaining-=JSON.stringify(output[key]).length+key.length+6;}
   omissions.push({field:key,included:low,total:value.length});
  }else omissions.push({field:key,omitted:true});
 }
 if(omissions.length)output.contextOmissions={fields:omissions.slice(0,40),total:omissions.length,note:'Metadata is partial. Use canvas_read, canvas_read_node, scene_read, artifacts_read or conversation_read for current or paged details. Missing fields are not proof of absence.'};
 return JSON.stringify(output);
}
module.exports={workspaceMetadata};
