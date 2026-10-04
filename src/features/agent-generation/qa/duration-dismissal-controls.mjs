import {openParameterMenu} from '../menu.mjs';
const video=document.getElementById('video'),audio=document.getElementById('audio'),receipt=document.getElementById('receipt');
let menu=null,count=0,closes=0,videoValue=5,audioValue=30;
const draw=()=>{video.textContent=`Seedance 整数时长：${videoValue}s`;audio.textContent=`音频数值时长：${audioValue}s`;receipt.textContent=`选择回调次数：${count}\n关闭次数：${closes}\nSeedance时长：${videoValue}\n音频时长：${audioValue}\n焦点：${document.activeElement?.getAttribute('aria-label')||document.activeElement?.id||document.activeElement?.className||document.activeElement?.tagName}`;};
function open(trigger,isAudio){if(menu){menu.close();return;}menu=openParameterMenu(trigger,{label:'时长',duration:true,value:isAudio?audioValue:videoValue,numericSpec:isAudio?{min:3,max:300,step:1}:null,options:(isAudio?[null,30,60]:Array.from({length:12},(_,i)=>i+4)).map(value=>({value,label:value===null?'自动':`${value}s`})),onSelect:value=>{count++;if(isAudio)audioValue=value;else videoValue=value;draw();},onClose:()=>{menu=null;closes++;draw();}});draw();}
video.onclick=()=>open(video,false);audio.onclick=()=>open(audio,true);
document.addEventListener('focusin',draw);document.addEventListener('keydown',()=>queueMicrotask(draw));draw();
