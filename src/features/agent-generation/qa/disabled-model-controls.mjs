import {openParameterMenu} from '../menu.mjs';
const trigger=document.getElementById('trigger'),receipt=document.getElementById('receipt');
let menu=null,count=0,closes=0;
const draw=()=>{receipt.textContent=`选择回调次数：${count}\n关闭次数：${closes}\n触发器展开：${trigger.getAttribute('aria-expanded')}`;};
trigger.onclick=()=>{if(menu){menu.close();return;}menu=openParameterMenu(trigger,{label:'视频模型',model:true,value:'seedance-2.5',options:[{value:'seedance-2.5',label:'Seedance 2.5'},{value:'flux-3',label:'FLUX 3',disabled:true,reason:'不支持当前参考视频'},{value:'unsupported',label:'未提供原因的禁用项',disabled:true}],onSelect:value=>{count++;trigger.textContent='模型：'+value;draw();},onClose:()=>{menu=null;closes++;draw();}});draw();};
