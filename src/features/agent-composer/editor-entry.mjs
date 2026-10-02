import {createReferencePicker} from './reference-picker.mjs';
import {ReferenceMention,referenceDOM} from './reference-node.mjs';
import {referenceNodes} from './reference-data.mjs';
import {Editor,Node,Extension} from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import {documentForDraft,documentText,mentionNames,textDocument} from './editor-state.mjs';
import {skillIcons} from '../agent-attachments/skill-icons.mjs';

const mounted=new Set();let focused=null;
function mentionDOM(name){const root=document.createElement('span');root.className='agent-skill-mention';root.dataset.mentionType='skill';root.contentEditable='false';
 const icon=document.createElement('span');icon.className='agent-mention-icon';icon.innerHTML=skillIcons['client-surface-routing'];const label=document.createElement('span');label.className='agent-mention-name';label.textContent=name;root.append(icon,label);return root;}
const SkillMention=Node.create({name:'skillMention',inline:true,group:'inline',atom:true,selectable:false,draggable:false,
 addAttributes(){return {name:{default:''}};},parseHTML(){return [{tag:'span[data-mention-type="skill"][data-skill-name]',getAttrs:element=>({name:element.dataset.skillName})}];},
 renderHTML({node}){return ['span',{'data-mention-type':'skill','data-skill-name':node.attrs.name},node.attrs.name];},renderText({node}){return '@'+node.attrs.name;},
 addNodeView(){return ({node})=>({dom:mentionDOM(node.attrs.name)});},
 addKeyboardShortcuts(){return {Backspace:()=>{const {$from,empty,from}=this.editor.state.selection;if(!empty)return false;const before=$from.nodeBefore;
  if(['skillMention','referenceMention'].includes(before?.type.name))return this.editor.commands.deleteRange({from:from-1,to:from});
  if(before?.isText&&before.text===' '&&['skillMention','referenceMention'].includes(this.editor.state.doc.resolve(from-1).nodeBefore?.type.name))return this.editor.commands.deleteRange({from:from-2,to:from});
  return false;
 }};}
});
export function createComposerEditor({element,value,label,placeholder='',onChange,onSubmit}){
 let destroyed=false,picker=null;const control={element,sessionId:value.id};
 const Submit=Extension.create({name:'agentSubmit',priority:1100,addKeyboardShortcuts(){return {Enter:()=>{if(editor.view.composing)return false;if(documentText(editor.getJSON()).trim())onSubmit();return true;}};}});
 const editor=new Editor({element,content:documentForDraft(value),extensions:[StarterKit.configure({blockquote:false,bold:false,bulletList:false,code:false,codeBlock:false,heading:false,horizontalRule:false,italic:false,listItem:false,listKeymap:false,orderedList:false,strike:false,link:false,underline:false,trailingNode:false}),SkillMention,ReferenceMention,Submit],
  editorProps:{attributes:{class:'agent-rich-input',role:'textbox','aria-label':label,'aria-multiline':'true','data-keyboard-scope':'text-editor'},
   handleTextInput(view,from,to,text){if(text!=='@'||view.composing)return false;view.dispatch(view.state.tr.insertText('@',from,to));queueMicrotask(()=>openPicker(from,from+1));return true;},
   handleDOMEvents:{keydown:(_view,event)=>{event.stopPropagation();return false;}},
   clipboardTextSerializer:slice=>documentText({content:slice.content.toJSON()}),
   handlePaste:(_view,event)=>{const text=event.clipboardData?.getData('text/plain'),html=event.clipboardData?.getData('text/html');if(html?.includes('data-skill-name')||html?.includes('data-reference-mention'))return false;if(text===undefined)return false;event.preventDefault();editor.commands.insertContent(textDocument(text).content);return true;}
  },
  onUpdate(){refreshEmpty();onChange({doc:editor.getJSON(),text:documentText(editor.getJSON())});},
  onFocus(){focused=control;},onCreate(){refreshEmpty();}
 });
 function openPicker(from,to){if(destroyed)return;picker?.destroy();picker=createReferencePicker({anchor:element.closest('.studio-v2-composer,.agent-composer')||element,getData:()=>window.AgentUI.referenceData(),onPick:ref=>{picker=null;editor.chain().focus().insertContentAt({from,to},[{type:'referenceMention',attrs:ref},{type:'text',text:' '}]).run();},onCancel:focus=>{picker=null;if(editor.state.doc.textBetween(from,to)==='@')editor.commands.deleteRange({from,to});if(focus)editor.commands.focus();}});}
 function refreshEmpty(){if(destroyed)return;editor.view.dom.dataset.empty=String(editor.isEmpty);editor.view.dom.dataset.placeholder=placeholder;}
 Object.assign(control,{dom:editor.view.dom,
  sync(next){control.sessionId=next.id;const doc=documentForDraft(next);if(JSON.stringify(doc)!==JSON.stringify(editor.getJSON())){picker?.destroy();picker=null;const {from,to}=editor.state.selection;editor.chain().setContent(doc,{emitUpdate:false}).setMeta('addToHistory',false).run();const end=editor.state.doc.content.size-1;editor.commands.setTextSelection({from:Math.min(from,end),to:Math.min(to,end)});refreshEmpty();}},
  setEditable(value){editor.setEditable(value,false);},getText(){return documentText(editor.getJSON());},
  setText(text){editor.commands.setContent(textDocument(text,mentionNames(editor.getJSON()),referenceNodes(editor.getJSON())));},
  focus(){editor.commands.focus();},insertReference(ref,text=''){if(!editor.isEditable)return false;editor.chain().focus().insertContent([{type:'referenceMention',attrs:ref},{type:'text',text:' '+text}]).run();return true;},insertSkill(name){if(!editor.isEditable)return false;editor.chain().focus().insertContent([{type:'skillMention',attrs:{name}},{type:'text',text:' '}]).run();return true;},
  destroy(){picker?.cancel(false);picker=null;destroyed=true;mounted.delete(control);if(focused===control)focused=null;editor.destroy();}
 });mounted.add(control);refreshEmpty();return control;
}
export function insertSessionSkill(sessionId,name){const candidates=[...mounted].filter(control=>control.sessionId===sessionId&&control.element.isConnected),target=candidates.includes(focused)?focused:candidates.at(-1);return target?.insertSkill(name)||false;}
export function renderComposerDocument(doc){const fragment=document.createDocumentFragment();for(const [index,block]of(doc.content||[]).entries()){if(index)fragment.append(document.createElement('br'));for(const node of block.content||[]){if(node.type==='skillMention')fragment.append(mentionDOM(node.attrs.name));else if(node.type==='referenceMention')fragment.append(referenceDOM(node.attrs));else if(node.type==='hardBreak')fragment.append(document.createElement('br'));else if(node.type==='text')fragment.append(document.createTextNode(node.text||''));}}return fragment;}
export {documentForDraft,documentText,mentionNames,textDocument,applyComposerSnapshot,appendSkill} from './editor-state.mjs';

export {referenceNodes,resolveReferenceData} from './reference-data.mjs';

export function insertSessionReference(sessionId,ref,text=''){const candidates=[...mounted].filter(control=>control.sessionId===sessionId&&control.element.isConnected),target=candidates.includes(focused)?focused:candidates.at(-1);if(!target?.insertReference(ref,text))throw Error('当前输入区不可编辑');}
export {renderSkillMarkdown} from '../agent-manager/markdown.mjs';

export {renderMessageMarkdown} from '../agent-messages/markdown.mjs';

export {createNodePrompt} from '../node-composer/prompt-editor.mjs';
export {createGenerationPromptEditor} from '../agent-generation/prompt-editor.mjs';
