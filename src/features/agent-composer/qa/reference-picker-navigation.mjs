import {createReferencePicker} from '../reference-picker.mjs';
const anchor=document.getElementById('anchor'),receipt=document.getElementById('receipt');
const data={nodes:[],library:[{id:'qa-personal',name:'雨夜参考',folder:'场景',scope:'personal',type:'text'},{id:'qa-team',name:'雨夜参考',folder:'场景',scope:'team',type:'text'}],folders:[]};
let control=null,picks=[],cancels=[];
function draw(){const selected=document.querySelector('.agent-reference-picker:not([aria-hidden=true]) .selected');receipt.textContent=`选择次数：${picks.length}\n选择：${JSON.stringify(picks.at(-1)||null)}\n关闭：${JSON.stringify(cancels)}\n当前选项：${selected?.ariaLabel||selected?.textContent||'无'}\n焦点：${document.activeElement?.ariaLabel||document.activeElement?.id||document.activeElement?.tagName}`;}
anchor.onclick=()=>{control?.destroy();control=createReferencePicker({anchor,getData:()=>data,onPick:ref=>{picks.push(ref);control=null;anchor.focus();draw();},onCancel:focus=>{cancels.push(focus);control=null;if(focus)anchor.focus();draw();}});draw();};
for(const name of ['keydown','pointerenter','click','input','focusin'])document.addEventListener(name,()=>requestAnimationFrame(draw),true);draw();
