import {Node} from '@tiptap/core';
import {referenceIcons as icons} from './reference-icons.mjs';
import {appCatalog} from '../agent-manager/catalog.mjs';
import {openReferencePreview} from './reference-preview.mjs';
export function referenceDOM(ref,onRemove){
 const root=document.createElement('span'),app=ref.kind==='app';root.contentEditable='false';root.onkeydown=event=>{if(event.target.closest('button'))event.stopPropagation();};root.className=app?'agent-skill-mention agent-app-mention':'agent-reference-mention';root.dataset.mentionType=app?(ref.id==='brainstorm'?'brainstorm':'plugin'):ref.kind==='node'?'node':ref.kind==='folder'?'library_folder':'library';
 const main=document.createElement(app?'span':'button');main.className='agent-reference-main';if(!app){main.type='button';main.tabIndex=-1;main.onclick=()=>openReferencePreview(ref,{getData:()=>window.AgentUI.referenceData(),onOpen:id=>window.AgentUI.openReferenceNode(id)});}
 const icon=document.createElement('span');icon.className='agent-reference-icon';if(app){const image=document.createElement('img');image.alt='';image.src=appCatalog.find(a=>a.id===ref.id)?.icon||'/assets/agent-brainstorm.svg';icon.append(image);}else icon.innerHTML=icons[ref.kind==='folder'?'folder':ref.mediaType]||icons.folder;
 const label=document.createElement('span');label.className='agent-reference-name';label.textContent=ref.label;main.append(icon,label);root.append(main);
 if(onRemove&&!app){const remove=document.createElement('button');remove.type='button';remove.tabIndex=-1;remove.className='agent-reference-remove';remove.ariaLabel='移除引用 '+ref.label;remove.innerHTML=icons.close;remove.onmousedown=e=>e.preventDefault();remove.onclick=event=>{event.stopPropagation();onRemove();};root.append(remove);}
 return root;
}
export const ReferenceMention=Node.create({name:'referenceMention',inline:true,group:'inline',atom:true,selectable:false,draggable:false,
 addAttributes(){return {kind:{default:'node'},id:{default:''},label:{default:''},mediaType:{default:''},scope:{default:'personal'}};},
 parseHTML(){return [{tag:'span[data-reference-mention]',getAttrs:element=>{try{const ref=JSON.parse(element.dataset.referenceMention);return ['node','library','folder','app'].includes(ref.kind)&&typeof ref.id==='string'&&ref.id.length<=240&&typeof ref.label==='string'&&ref.label.length<=500?ref:false;}catch{return false;}}}];},
 renderHTML({node}){return ['span',{'data-reference-mention':JSON.stringify(node.attrs)},node.attrs.label];},renderText({node}){return '@'+node.attrs.label;},
 addNodeView(){return ({node,getPos,editor})=>({stopEvent:event=>Boolean(event.target.closest('button')),dom:referenceDOM(node.attrs,()=>{const pos=getPos();if(typeof pos==='number')editor.commands.deleteRange({from:pos,to:pos+1});})});}
});
