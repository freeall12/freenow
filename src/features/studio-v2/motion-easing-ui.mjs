import {el,button} from './dom.mjs';
import {easingOf,transitionType,defaultCurve} from './motion-easing.mjs';

const labels={LINEAR:'均匀过渡',CURVE:'曲线过渡',STEP:'瞬间切换',ORIGINAL:'原有曲线'};
const svg=(tag,attributes)=>{const node=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [key,value] of Object.entries(attributes))node.setAttribute(key,value);return node;};
export function createEasingUI(editor){
  let panel=null,menu=null,draft=null,gesture=null,graph=null,curvePath=null,guide=null,handles=[],select=null;const abort=new AbortController();
  const trigger=button('运动方式与曲线','运动方式与曲线',()=>panel?close():open());trigger.title='运动方式与曲线';trigger.setAttribute('aria-haspopup','dialog');trigger.setAttribute('aria-expanded','false');
  const curve=()=>draft||editor.tracks.map(easingOf).find(Boolean)?.curve||defaultCurve;
  const clamp=(index,x,y)=>{const c=[...curve()];c[index*2]=Math.max(index?c[0]:0,Math.min(index?1:c[2],x));c[index*2+1]=Math.max(index?c[1]:0,Math.min(index?1:c[3],y));return c;};
  function close(){gesture=draft=null;menu?.remove();menu=null;panel?.remove();panel=null;trigger.setAttribute('aria-expanded','false');}
  function place(){if(!panel)return;const r=trigger.getBoundingClientRect();panel.style.left=Math.max(12,Math.min(innerWidth-panel.offsetWidth-12,r.right-panel.offsetWidth))+'px';panel.style.top=Math.max(12,r.top-panel.offsetHeight-8)+'px';placeMenu();}
  function commit(type,c){try{editor.easing(type,c);render();}catch(error){let message=panel?.querySelector('[role=alert]');if(!message&&panel){message=el('p');message.role='alert';panel.append(message);}if(message)message.textContent=error.message;}}
  function draw(){const c=curve();curvePath.setAttribute('d',`M 0 100 C ${c[0]*100} ${100-c[1]*100}, ${c[2]*100} ${100-c[3]*100}, 100 0`);guide.setAttribute('d',`M 0 100 L ${c[0]*100} ${100-c[1]*100} M 100 0 L ${c[2]*100} ${100-c[3]*100}`);handles.forEach((handle,index)=>{handle.style.left=(5+c[index*2]*100)/110*100+'%';handle.style.top=(105-c[index*2+1]*100)/110*100+'%';handle.setAttribute('aria-description',`${c[index*2].toFixed(2)}, ${c[index*2+1].toFixed(2)}`);});}
  function placeMenu(){
    if(!menu||!select)return;if(!select.isConnected){closeMenu();return;}
    const rect=select.getBoundingClientRect(),padding=10,gap=4,width=Math.min(Math.max(128,rect.width),Math.max(0,innerWidth-padding*2));
    menu.style.width=width+'px';menu.style.maxHeight='none';
    const height=menu.offsetHeight,below=Math.max(0,innerHeight-padding-rect.bottom-gap),above=Math.max(0,rect.top-padding-gap),side=height<=below||below>=above?'bottom':'top',available=side==='bottom'?below:above;
    menu.dataset.side=side;menu.style.maxHeight=available+'px';
    menu.style.left=Math.max(padding,Math.min(innerWidth-padding-width,rect.left))+'px';
    menu.style.top=Math.max(padding,Math.min(innerHeight-padding-menu.offsetHeight,side==='bottom'?rect.bottom+gap:rect.top-gap-menu.offsetHeight))+'px';
  }
  function focusOutside(){queueMicrotask(()=>{if(panel&&!panel.contains(document.activeElement)&&!menu?.contains(document.activeElement)&&document.activeElement!==trigger)close();});}
  function closeMenu(focus=false){menu?.remove();menu=null;select?.setAttribute('aria-expanded','false');if(focus)select?.focus({preventScroll:true});}
  function openMenu(){
    if(menu){menu.querySelector('[tabindex="0"]')?.focus({preventScroll:true});return;}
    const mode=transitionType(editor.tracks);menu=el('div','studio-v2-popover _typeMenu_pn7dr_15 studio-v2-easing-options');menu.role='listbox';menu.ariaLabel='过渡方式';const options=[];
    for(const type of mode==='ORIGINAL'?['ORIGINAL','LINEAR','CURVE','STEP']:['LINEAR','CURVE','STEP']){
      const option=button(labels[type],null,()=>{closeMenu();if(type!==transitionType(editor.tracks))commit(type);select.focus({preventScroll:true});},'',labels[type]);option.role='option';option.disabled=type==='ORIGINAL';option.setAttribute('aria-selected',String(type===mode));option.tabIndex=-1;options.push(option);menu.append(option);
    }
    const available=options.filter(option=>!option.disabled);
    function focusOption(option){if(!option)return;available.forEach(item=>item.tabIndex=item===option?0:-1);option.focus({preventScroll:true});}
    document.body.append(menu);select.setAttribute('aria-expanded','true');placeMenu();menu.onfocusout=focusOutside;for(const type of ['pointerdown','keydown'])menu.addEventListener(type,e=>{if(editor.runtime.exporting){e.preventDefault();e.stopImmediatePropagation();}},{capture:true});
    // Imported mixed/cubic tracks expose ORIGINAL as a disabled selected row.
    // It must not leave all usable options outside the keyboard focus order.
    focusOption(available.find(option=>option.getAttribute('aria-selected')==='true')||available[0]);
    menu.onkeydown=e=>{
      e.stopPropagation();const at=available.indexOf(document.activeElement),next=e.key==='Home'?0:e.key==='End'?available.length-1:e.key==='ArrowDown'?Math.min(available.length-1,at+1):e.key==='ArrowUp'?Math.max(0,at-1):null;
      if(next!==null){e.preventDefault();focusOption(available[next]);}
      else if(e.key==='Escape'){e.preventDefault();closeMenu(true);}
      // Official SelectContentImpl prevents Tab while the list is open; Escape exits.
      else if(e.key==='Tab'){e.preventDefault();}
      // Enter/Space retain native button activation; no synthetic duplicate click.
    };
  }
  function render(){if(!panel||draft)return;menu?.remove();menu=null;handles=[];const mode=transitionType(editor.tracks);panel.replaceChildren();select=button('过渡方式','下拉',()=>menu?closeMenu(true):openMenu(),'_typeTrigger_pn7dr_14 studio-v2-easing-select');select.role='combobox';select.setAttribute('aria-expanded','false');select.setAttribute('aria-haspopup','listbox');select.prepend(el('span','',labels[mode]));select.onkeydown=e=>{if(['ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();e.stopPropagation();openMenu();}};panel.append(select);
    if(mode!=='ORIGINAL'){const wrap=el('div','_graphWrap_pn7dr_30');wrap.append(el('span','_progress_pn7dr_36','运动进度'));graph=el('div','_graph_pn7dr_30');const picture=svg('svg',{viewBox:'-5 -5 110 110',role:'img','aria-label':'时间与运动进度曲线'});picture.append(svg('path',{class:'_grid_pn7dr_52',d:'M 0 0 H 100 M 0 50 H 100 M 0 100 H 100 M 0 0 V 100 M 50 0 V 100 M 100 0 V 100'}));guide=svg('path',{class:'_guide_pn7dr_63'});if(mode==='CURVE')picture.append(guide);curvePath=svg('path',{class:'_curve_pn7dr_58',d:mode==='STEP'?'M 0 100 H 100 V 0':'M 0 100 L 100 0'});picture.append(curvePath,svg('circle',{cx:0,cy:100,r:1.7,fill:'currentColor'}),svg('circle',{cx:100,cy:0,r:1.7,fill:'currentColor'}));graph.append(picture);
      if(mode==='CURVE')for(let index=0;index<2;index++){const handle=button(index?'结束控制柄，方向键调整':'开始控制柄，方向键调整',null,null,'_handle_pn7dr_69');handle.onpointerdown=e=>{if(e.button!==0||editor.runtime.exporting)return;e.preventDefault();handle.focus();gesture=[...curve()];handle.setPointerCapture(e.pointerId);};handle.onpointermove=e=>{if(!gesture||!handle.hasPointerCapture(e.pointerId))return;const r=graph.getBoundingClientRect();gesture=draft=clamp(index,((e.clientX-r.left)/r.width*110-5)/100,(105-(e.clientY-r.top)/r.height*110)/100);draw();};handle.onpointerup=e=>{const value=gesture;gesture=draft=null;if(handle.hasPointerCapture(e.pointerId))handle.releasePointerCapture(e.pointerId);if(value)commit('CURVE',value);};const cancel=()=>{gesture=draft=null;draw();};handle.onpointercancel=handle.onlostpointercapture=cancel;handle.onkeydown=e=>{if(e.key==='Escape'){if(gesture){e.preventDefault();e.stopPropagation();cancel();}return;}if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();const c=curve(),step=e.shiftKey?.1:.01;commit('CURVE',clamp(index,c[index*2]+(e.key==='ArrowLeft'?-step:e.key==='ArrowRight'?step:0),c[index*2+1]+(e.key==='ArrowDown'?-step:e.key==='ArrowUp'?step:0)));handles[index]?.focus();};handles.push(handle);graph.append(handle);}if(mode==='CURVE')draw();const axes=el('div','_axis_pn7dr_95');axes.append(el('span','','0%'),el('span','','时间'),el('span','','100%'));wrap.append(graph,axes);panel.append(wrap);}
    if(mode!=='CURVE')panel.append(el('p','',mode==='ORIGINAL'?'保留原有动画。选择过渡方式后，将统一替换当前运镜的过渡效果。':mode==='STEP'?'保持上一姿态，到下一个关键帧时切换。':'两个关键帧之间均匀过渡。'));place();
  }
  function open(){panel=el('div','studio-v2-popover studio-v2-easing _panel_pn7dr_1');panel.role='dialog';panel.ariaLabel='运动方式与曲线';panel.onfocusout=focusOutside;panel.onkeydown=e=>{e.stopPropagation();if(e.key==='Escape'){e.preventDefault();close();trigger.focus();}if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='z'){e.preventDefault();editor.undo(e.shiftKey);render();}};for(const type of ['pointerdown','keydown'])panel.addEventListener(type,e=>{if(editor.runtime.exporting){e.preventDefault();e.stopImmediatePropagation();}},{capture:true});document.body.append(panel);trigger.setAttribute('aria-expanded','true');render();select.focus();}
  document.addEventListener('pointerdown',e=>{if(panel&&!panel.contains(e.target)&&!menu?.contains(e.target)&&!trigger.contains(e.target))close();else if(menu&&!menu.contains(e.target)&&e.target!==select&&!select.contains(e.target))closeMenu(true);},{capture:true,signal:abort.signal});window.addEventListener('resize',place,{signal:abort.signal});document.addEventListener('scroll',event=>{if(menu&&!menu.contains(event.target))placeMenu();},{capture:true,signal:abort.signal});
  return {element:trigger,refresh(){if(!editor.open)close();else if(panel)render();},dispose(){close();abort.abort();}};
}
