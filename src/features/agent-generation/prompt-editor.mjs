import {Editor,Node} from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import {generationPromptPreviews} from './prompt-preview.mjs';
import {generationPromptDocument,generationPromptText,generationMentionDOM,generationMentionData} from './prompt.mjs';
export function createGenerationPromptEditor({element,value,args,getNodes,label,onChange,onOpenNode,resolveAsset,onError}){
 const Mention=Node.create({name:'generationMention',inline:true,group:'inline',atom:true,selectable:false,draggable:false,
  addAttributes(){return Object.fromEntries(['token','label','type','nodeId','subjectId','thumbnail','url','text'].map(key=>[key,{default:''}]));},
  // Paste is parsed from plain token text, never trusted HTML node IDs.
  renderHTML({node}){return ['span',{'data-generation-token':node.attrs.token},node.attrs.token];},renderText({node}){return node.attrs.token;},
  addNodeView(){return ({node,getPos,editor})=>({stopEvent:event=>!!event.target.closest('button'),dom:generationMentionDOM(node.attrs,{onOpenNode,resolveAsset,onError,onRemove:()=>{const pos=getPos();if(typeof pos==='number')editor.commands.deleteRange({from:pos,to:pos+1});}})});}
 });
 const editor=new Editor({element,content:generationPromptDocument(value,args,getNodes()),extensions:[StarterKit.configure({blockquote:false,bold:false,bulletList:false,code:false,codeBlock:false,heading:false,horizontalRule:false,italic:false,listItem:false,listKeymap:false,orderedList:false,strike:false,link:false,underline:false,trailingNode:false}),Mention],
  editorProps:{attributes:{class:'generation-rich-prompt',role:'textbox','aria-label':label,'aria-multiline':'true','data-keyboard-scope':'text-editor'},
   clipboardTextSerializer:slice=>generationPromptText({content:slice.content.toJSON()}),
   handlePaste:(_view,event)=>{const text=event.clipboardData?.getData('text/plain');if(text===undefined)return false;event.preventDefault();editor.commands.insertContent(generationPromptDocument(text,args,getNodes()).content);return true;},
   handleDOMEvents:{keydown:(_view,event)=>{event.stopPropagation();return false;}}
  },onUpdate(){onChange(generationPromptText(editor.getJSON()));}
 });
 const previews=generationPromptPreviews(editor.view.dom,{resolve:generationMentionData,editing:true,resolveAsset});
 return {dom:editor.view.dom,getText:()=>generationPromptText(editor.getJSON()),focus:()=>editor.commands.focus(),capture:()=>({from:editor.state.selection.from,to:editor.state.selection.to}),restore:range=>editor.chain().focus().setTextSelection(range).run(),setEditable:value=>editor.setEditable(value),destroy:()=>{previews.destroy();editor.destroy();}};
}
