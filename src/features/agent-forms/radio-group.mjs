// Match the official RadioGroup: arrows select; Home/End/Page keys only focus.
export function bindRadioGroup(group,items,{label,value,inactive}){
 group.role='radiogroup';group.ariaLabel=label;
 const tabStop=index=>items.forEach((item,i)=>{item.tabIndex=i===index?0:-1;});
 const sync=()=>{
  const selected=items.findIndex(item=>item.value===value());
  items.forEach((item,i)=>{item.ariaChecked=String(i===selected);});
  tabStop(Math.max(0,selected));
 };
 for(const item of items){
  item.role='radio';
  item.onfocus=()=>tabStop(items.indexOf(item));
  item.onkeydown=event=>{
   if(event.key==='Enter'){event.preventDefault();return;}
   if(inactive()||event.altKey||event.ctrlKey||event.metaKey||event.shiftKey)return;
   const arrows=['ArrowLeft','ArrowUp','ArrowRight','ArrowDown'];
   if(![...arrows,'Home','End','PageUp','PageDown'].includes(event.key))return;
   event.preventDefault();
   const enabled=items.filter(candidate=>!candidate.disabled),index=enabled.indexOf(item);
   if(index<0||!enabled.length)return;
   let key=event.key;
   if(getComputedStyle(group).direction==='rtl'){
    if(key==='ArrowLeft')key='ArrowRight';else if(key==='ArrowRight')key='ArrowLeft';
   }
   const next=['Home','PageUp'].includes(key)?0:['End','PageDown'].includes(key)?enabled.length-1:(index+(['ArrowLeft','ArrowUp'].includes(key)?-1:1)+enabled.length)%enabled.length;
   const target=enabled[next];target.focus();
   if(arrows.includes(key)&&target.value!==value())target.click();
  };
 }
 group.onfocusout=()=>queueMicrotask(()=>{if(!group.contains(document.activeElement))sync();});
 sync();return sync;
}
