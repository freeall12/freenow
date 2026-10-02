import {icons as subjectIcons} from '../subject-library/icons.mjs';
import {subjectToken} from '../subject-library/model.mjs';
import {createLibraryPicker} from './library-picker.mjs';
import {assetToken,assetSegments,assetReference} from './library-mentions.mjs';
import {Editor,Node} from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import {documentText,promptDocument,mentionItems} from './prompt-state.mjs';
import {referenceIcons} from '../agent-composer/reference-icons.mjs';
import {referencePreviews} from './reference-preview.mjs';
import {icons,musicIcon} from './icons.mjs';
const el=(tag,cls,text)=>{const e=document.createElement(tag);e.className=cls;if(text!==undefined)e.textContent=text;return e;};
function mentionDOM(attrs,onRemove) {
  const root=el('span','composer-mention mention-'+attrs.type);root.contentEditable='false';root.dataset.promptToken=attrs.token;root.dataset.referenceKey=attrs.key;
  const thumb=el('span','composer-mention-icon');
  if(attrs.thumbnail&&['image','video'].includes(attrs.type)){const img=el('img','');img.alt='';Promise.resolve(window.LocalAssets?.url(attrs.thumbnail)||attrs.thumbnail).then(url=>{if(root.isConnected)img.src=url;});thumb.append(img);}
  else thumb.innerHTML=attrs.type==='subject'?subjectIcons.subject:attrs.type==='audio'?musicIcon:referenceIcons[attrs.type+'Type']||'';
  root.append(thumb);if(onRemove){const remove=el('button','composer-mention-remove');remove.type='button';remove.tabIndex=-1;remove.ariaLabel='移除引用 '+attrs.label;remove.innerHTML=icons.close;remove.onpointerdown=event=>event.preventDefault();remove.onclick=event=>{event.preventDefault();event.stopPropagation();onRemove();};root.append(remove);}root.append(el('span','composer-mention-label',attrs.label));return root;
}
const Mention=Node.create({name:'promptMention',inline:true,group:'inline',atom:true,selectable:false,
 addAttributes(){return Object.fromEntries(['token','key','type','label','thumbnail','url'].map(key=>[key,{default:''}]));},
 parseHTML(){return [{tag:'span[data-prompt-token]',getAttrs:element=>({token:element.dataset.promptToken})}];},
 renderHTML({node}){return ['span',{'data-prompt-token':node.attrs.token},node.attrs.token];},renderText({node}){return node.attrs.token;},
 addNodeView(){return ({node,getPos,editor})=>({stopEvent:event=>Boolean(event.target.closest('button')),dom:mentionDOM(node.attrs,()=>{const pos=getPos();if(typeof pos==='number')editor.commands.deleteRange({from:pos,to:pos+1});})});},
 addKeyboardShortcuts(){return {Backspace:()=>{const {empty,$from,from}=this.editor.state.selection;if(!empty)return false;const before=$from.nodeBefore;if(before?.type.name==='promptMention')return this.editor.commands.deleteRange({from:from-1,to:from});return false;}};}
});
export function createNodePrompt({element,value,getItems,getLibrary=()=>({library:[],folders:[]}),getPolicy=()=>({enabled:false,allowed:[]}),getSubjects=()=>[],onChange,onSubmit}) {
  let syncing=false,openingLibrary=false,destroyed=false,suspended=false,picker=null,libraryPicker=null,queryRange=null,dismissedQuery=null,active=0,expanded=false,rows=[];
  const editor=new Editor({element,content:promptDocument(value,getItems()),extensions:[StarterKit.configure({blockquote:false,bold:false,bulletList:false,code:false,codeBlock:false,heading:false,horizontalRule:false,italic:false,listItem:false,listKeymap:false,orderedList:false,strike:false,link:false,underline:false,trailingNode:false}),Mention],
    editorProps:{attributes:{class:'prompt-editor',role:'textbox','aria-label':'生成提示词','aria-multiline':'true','data-keyboard-scope':'text-editor'},
      clipboardTextSerializer:slice=>documentText({content:slice.content.toJSON()}),
      handlePaste:(_view,event)=>{const text=event.clipboardData?.getData('text/plain');if(text===undefined)return false;event.preventDefault();editor.commands.insertContent(promptDocument(text,getItems()).content);return true;},
      handleDOMEvents:{keydown:(_view,event)=>{event.stopPropagation();return false;},compositionend:()=>{queueMicrotask(suggest);return false;}},
      handleKeyDown:(_view,event)=>{
        if(previews.dismissEscape(event))return true;
        if(event.defaultPrevented||event.isComposing||event.keyCode===229)return false;
        if(picker&&/^[1-9]$/.test(event.key)&&editor.state.doc.textBetween(queryRange.from,queryRange.to)==='@'){const item=mentionItems(getItems())[Number(event.key)-1];if(item){event.preventDefault();insert(item,queryRange);return true;}}
        if(picker&&['ArrowDown','ArrowUp','Enter','Tab','Escape'].includes(event.key)){event.preventDefault();if(event.key==='Escape')close();else if(event.key==='Enter'||event.key==='Tab')rows[active]?.click();else{active=(active+(event.key==='ArrowDown'?1:-1)+rows.length)%Math.max(1,rows.length);mark();}return true;}
        if(event.key==='Enter'&&!event.shiftKey&&!event.ctrlKey&&!event.metaKey){event.preventDefault();onSubmit();return true;}
        return false;
      }
    },
    onUpdate(){if(syncing)return;editor.view.dom.dataset.empty=String(editor.isEmpty);onChange(documentText(editor.getJSON()));suggest();},
    onSelectionUpdate(){if(!syncing)suggest();},onFocus(){suggest();}
  });
  editor.view.dom.dataset.empty=String(editor.isEmpty);
  const previews=referencePreviews(editor.view.dom,[],{selector:'.composer-mention',enterDelay:300,resolve:chip=>getItems().find(item=>item.key===chip.dataset.referenceKey)||assetSegments(chip.dataset.promptToken).filter(part=>typeof part!=='string').map(part=>assetReference(part.asset))[0]});
  function close(){if(queryRange&&!editor.isDestroyed)dismissedQuery=querySignature(queryRange);previews.hide();libraryPicker?.destroy();libraryPicker=null;picker?.remove();picker=null;queryRange=null;editor.view.dom.setAttribute('aria-expanded','false');editor.view.dom.removeAttribute('aria-activedescendant');}
  // Restoring focus also updates selection; Esc keeps that same query dismissed.
  function querySignature(range){const end=editor.state.doc.content.size,from=Math.min(range.from,end),to=Math.max(from,Math.min(range.to,end));return range.from+':'+range.to+':'+editor.state.doc.textBetween(from,to);}
  function mark(){rows.forEach((row,i)=>row.setAttribute('aria-selected',String(i===active)));if(rows[active]){editor.view.dom.setAttribute('aria-activedescendant',rows[active].id);rows[active].scrollIntoView({block:'nearest'});}}
  function insert(item,range){close();editor.chain().focus().insertContentAt(range||editor.state.selection,[{type:'promptMention',attrs:{token:`{{${item.renderText}}}`,key:item.key,type:item.type,label:item.title,thumbnail:item.thumbnail||'',url:item.url||''}},{type:'text',text:' '}]).run();}
  function suggest(){
    if(destroyed||suspended||!element.isConnected||!editor.isEditable||editor.view.composing)return;
    if(!editor.view.dom.contains(document.activeElement)&&!libraryPicker?.contains(document.activeElement)&&!picker?.contains(document.activeElement))return;
    const {empty,$from,from}=editor.state.selection,match=empty&&$from.parent.textBetween(0,$from.parentOffset,'\n','\ufffc').match(/(?:^|\s)@([^@\s]*)$/);
    if(!match){close();dismissedQuery=null;return;}
    const range={from:from-match[1].length-1,to:from};if(querySignature(range)===dismissedQuery)return;dismissedQuery=null;queryRange=range;
    if(getPolicy().enabled){
      if(!libraryPicker){const range={...queryRange};openingLibrary=true;try{libraryPicker=createLibraryPicker({anchor:()=>editor.view.coordsAtPos(Math.min(range.from,editor.state.doc.content.size-1)),getData:()=>({...getLibrary(),linked:mentionItems(getItems()),subjects:getSubjects()}),allowed:getPolicy().allowed,onPick:choice=>{libraryPicker=null;if(choice.linked)insert(choice.linked,range);else{close();editor.chain().focus().insertContentAt(range,[...promptDocument(choice.subject?subjectToken(choice.subject):assetToken(choice.asset),getItems()).content[0].content,{type:'text',text:' '}]).run();}},onClose:focus=>{libraryPicker=null;close();if(focus)editor.commands.focus();}});}finally{openingLibrary=false;}}
      return;
    }
    const items=mentionItems(getItems()).filter(item=>(item.title+' '+item.renderText).toLowerCase().includes(match[1].toLowerCase()));
    if(!picker){picker=el('div','composer-mention-menu');picker.role='listbox';picker.ariaLabel='引用已连接素材';picker.onkeydown=event=>{event.stopPropagation();if(event.defaultPrevented||event.isComposing||event.keyCode===229)return;if(event.key==='Escape'){event.preventDefault();close();editor.commands.focus();}else if(['ArrowDown','ArrowUp','Enter','Tab'].includes(event.key)){event.preventDefault();if(event.key==='Enter'||event.key==='Tab')rows[active]?.click();else{active=(active+(event.key==='ArrowDown'?1:-1)+rows.length)%Math.max(1,rows.length);mark();}}};document.body.append(picker);active=0;expanded=false;}
    const heading=el('div','composer-mention-heading');heading.append(el('span','','已连接节点'),el('span','','输入序号快选'));picker.replaceChildren(heading);rows=[];
    const addRow=(label,action,item)=>{const row=el('button','composer-mention-option');row.type='button';row.role='option';row.id='composer-mention-option-'+rows.length;row.onpointerdown=e=>e.preventDefault();row.onclick=action;const index=rows.length;row.onpointerenter=()=>{active=index;mark();};if(item){const preview=mentionDOM({...item,label:'',token:'',thumbnail:item.thumbnail});preview.className='composer-mention-menu-thumb';row.append(preview);}row.append(el('span','composer-mention-option-label',label));if(item){row.append(el('span','composer-mention-number','#'+(mentionItems(getItems()).findIndex(ref=>ref.key===item.key)+1)));const type=el('span','composer-mention-option-type');type.innerHTML=referenceIcons[item.type+'Type']||musicIcon;row.append(type);}rows.push(row);picker.append(row);};
    for(const item of expanded?items:items.slice(0,3))addRow(item.title,()=>insert(item,queryRange),item);
    if(!expanded&&items.length>3)addRow('显示更多（'+(items.length-3)+'）',()=>{expanded=true;suggest();});
    if(!items.length)picker.append(el('div','composer-mention-empty','没有匹配的节点'));
    const rect=editor.view.coordsAtPos(queryRange.from);picker.style.left=Math.max(8,Math.min(innerWidth-328,rect.left))+'px';picker.style.top=Math.max(8,rect.top-picker.offsetHeight-8)+'px';
    active=Math.min(active,Math.max(0,rows.length-1));editor.view.dom.setAttribute('aria-expanded','true');mark();
  }
  const outside=event=>{if(openingLibrary)return;if(!element.contains(event.target)&&!picker?.contains(event.target)&&!libraryPicker?.contains(event.target)&&!previews.contains(event.target))close();};
  const pagehide=()=>{suspended=true;close();},pageshow=()=>{suspended=false;};
  document.addEventListener('pointerdown',outside);document.addEventListener('focusin',outside);window.addEventListener('pagehide',pagehide);window.addEventListener('pageshow',pageshow);
  const control={dom:editor.view.dom,getText:()=>documentText(editor.getJSON()),
    sync(text){const doc=promptDocument(text,getItems());if(JSON.stringify(doc)===JSON.stringify(editor.getJSON()))return;syncing=true;const {from,to}=editor.state.selection;editor.chain().setContent(doc,{emitUpdate:false}).setMeta('addToHistory',false).run();const end=editor.state.doc.content.size-1;editor.commands.setTextSelection({from:Math.min(from,end),to:Math.min(to,end)});editor.view.dom.dataset.empty=String(editor.isEmpty);syncing=false;close();},
    insert(item){const current=mentionItems(getItems()).find(next=>next.key===item.key);if(current&&editor.isEditable)insert(current);},
    setEditable(value){editor.setEditable(value,false);if(!value)close();},
    captureSelection(){return {from:editor.state.selection.from,to:editor.state.selection.to,initialValue:documentText(editor.getJSON())};},
    commitTranscript(snapshot,text){if(snapshot.initialValue!==documentText(editor.getJSON())||editor.isDestroyed||!editor.isEditable)return false;editor.chain().focus().insertContentAt({from:snapshot.from,to:snapshot.to},promptDocument(text,getItems()).content).run();return true;},
    close,destroy(){if(destroyed)return;destroyed=true;close();previews.destroy();document.removeEventListener('pointerdown',outside);document.removeEventListener('focusin',outside);window.removeEventListener('pagehide',pagehide);window.removeEventListener('pageshow',pageshow);editor.destroy();}
  };return control;
}
