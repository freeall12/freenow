import {icons} from './icons.mjs';
export const el=(tag,cls='',text)=>{const node=document.createElement(tag);node.className=cls;if(text!==undefined)node.textContent=text;return node;};
export function button(label,icon,action,cls='',text=''){const node=el('button',cls);node.type='button';node.ariaLabel=label;if(icons[icon])node.innerHTML=icons[icon];if(text)node.append(document.createTextNode(text));node.onclick=action?event=>{try{Promise.resolve(action(event)).catch(error=>window.CanvasApp?.notify(error.message));}catch(error){window.CanvasApp?.notify(error.message);}}:null;return node;}
