export const normalizeResultMode=mode=>['pile','spread','variants'].includes(mode)?mode:'variants';
function resolve(options,currentTimes){
 const current=typeof currentTimes==='number'?currentTimes:Number(currentTimes);
 const times=options.includes(current)?current:[...options].reverse().find(value=>value<=current)??options[0];
 return {options,times};
}
// Official F4e/bJ count slots are request counts. Midjourney returns four images
// per request; its UI displays the product rather than changing provider times.
export function imageResultCounts({mode='variants',isMidjourney=false,currentTimes=1}={}){
 const variants=normalizeResultMode(mode)==='variants';
 const options=isMidjourney?(variants?[1]:[1,2,3]):(variants?[1,2,4]:[1,2,4,8,12]);
 const result=resolve(options,currentTimes),batchSize=isMidjourney?4:1;
 return {...result,batchSize,displayCount:result.times*batchSize};
}
// Video uses model variant slots, independent of image result layout (ene/$v).
export function videoResultCounts({currentTimes=1,timesOptions,final=false}={}){
 const valid=Array.isArray(timesOptions)?[...new Set(timesOptions.filter(value=>Number.isInteger(value)&&value>0))].sort((a,b)=>a-b):[];
 return resolve(final?[1]:valid.length?valid:[1,2],currentTimes);
}
