// Timings and examples come from the official Studio page's Mr composer options.
export const sceneExamples=[
  '一条科幻飞船走廊，镜头从入口缓慢推进',
  '雨后的城市街角，镜头跟随行人穿过霓虹灯光',
  '阳光穿过森林，镜头绕着林间小屋缓缓移动'
];
export function createTypingPlaceholder({input,mount}){
  const element=document.createElement('span');element.className='studio-typing-placeholder';element.ariaHidden='true';
  const text=document.createElement('span'),cursor=document.createElement('span');cursor.className='studio-typing-cursor';cursor.textContent='|';element.append(text,cursor);mount.append(element);
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');let timer=0,index=0,length=0,deleting=false,disposed=false;
  function sync(){element.hidden=!!input.innerText.trim();}
  function schedule(delay){clearTimeout(timer);if(!disposed&&!document.hidden&&!reduced.matches)timer=setTimeout(tick,delay);}
  function tick(){const example=sceneExamples[index];length+=deleting?-1:1;text.textContent=example.slice(0,length);if(length===example.length&&!deleting){deleting=true;schedule(2200);}else if(length===0&&deleting){index=(index+1)%sceneExamples.length;deleting=false;schedule(54);}else schedule(deleting?30:54);}
  function reset(){clearTimeout(timer);if(reduced.matches){text.textContent=sceneExamples[0];cursor.hidden=true;}else{cursor.hidden=false;schedule(300);}sync();}
  input.addEventListener('input',sync);document.addEventListener('visibilitychange',reset);reduced.addEventListener('change',reset);reset();
  return {sync,destroy(){disposed=true;clearTimeout(timer);input.removeEventListener('input',sync);document.removeEventListener('visibilitychange',reset);reduced.removeEventListener('change',reset);element.remove();}};
}
