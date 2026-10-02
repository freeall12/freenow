import { Editor, Node } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown, MarkdownManager } from '@tiptap/markdown';

// Use the parser already shipped by Tiptap, with the source site's static-preview policy.
const marked = new MarkdownManager().instance;
const renderer = new marked.Renderer();
renderer.html = () => '';
renderer.image = () => '';
renderer.link = function (token) {
  return '<span class="canvas-text-markdown-link">' + this.parser.parseInline(token.tokens) + '</span>';
};
const cache = new Map();
function html(markdown = '') {
  if (cache.has(markdown)) return cache.get(markdown);
  const result = marked.parser(marked.lexer(markdown, { gfm: false }), { renderer, gfm: false });
  if (cache.size >= 200) cache.delete(cache.keys().next().value);
  cache.set(markdown, result);
  return result;
}
function create({ element, content = '', editable = true, onUpdate, onSelectionUpdate }) {
  let editor;
  editor = new Editor({
    element, content: editorHTML(content), editable,
    extensions: [StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: false, underline: false, trailingNode: false }), Markdown.configure({ markedOptions: { gfm: false } })],
    editorProps: {
      attributes: { class: 'canvas-text-markdown', role: 'textbox', 'aria-label': '文本正文', 'aria-multiline': 'true' },
      handlePaste: (_view, event) => {
        const plain = event.clipboardData?.getData('text/plain');
        if (!plain || event.clipboardData.getData('text/html')) return false;
        event.preventDefault(); editor.commands.insertContent(editorHTML(plain)); return true;
      },
      clipboardTextSerializer: slice => editor.markdown.serialize({ type: 'doc', content: slice.content.toJSON() }),
    },
    onUpdate: ({ editor }) => onUpdate?.(editor.getMarkdown()),
    onSelectionUpdate: ({ editor }) => onSelectionUpdate?.(editor),
    onTransaction: ({ editor }) => onSelectionUpdate?.(editor),
  });
  return editor;
}
const editableRenderer = new marked.Renderer();
const escape = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
editableRenderer.html = token => token.block ? '<p>' + escape(token.text) + '</p>' : escape(token.text);
editableRenderer.link = renderer.link;
editableRenderer.image = renderer.image;
function editorHTML(value) { return marked.parser(marked.lexer(value, { gfm: false }), { renderer: editableRenderer, gfm: false }); }
function setContent(editor, value) { editor.commands.setContent(editorHTML(value), { emitUpdate: false }); }
window.TextEditor = { create, html, setContent };

// Prompt references are atomic nodes, keeping readable text and typed bindings together.
const PromptReference=Node.create({
  name:'promptReference',group:'inline',inline:true,atom:true,
  addAttributes(){return {id:{default:''},label:{default:''},kind:{default:'image'},image:{default:''}};},
  parseHTML(){return [{tag:'span[data-prompt-reference]'}];},
  renderHTML({node}){const a=node.attrs;return ['span',{'data-prompt-reference':a.id,'data-kind':a.kind,class:'prompt-reference',contenteditable:'false'},...(a.image?[['img',{src:a.image,alt:''}]]:[]),'@ '+a.label];},
  renderText({node}){return '@'+node.attrs.label;},
});
window.TextEditor.createPrompt=({element,onUpdate,onCursor})=>new Editor({
  element,extensions:[StarterKit.configure({heading:false,link:false,underline:false,trailingNode:false}),PromptReference],
  content:'<p></p>',editorProps:{attributes:{class:'video-creation-prompt',role:'textbox','aria-label':'视频延长提示词','aria-multiline':'true'}},
  onUpdate:({editor})=>onUpdate?.(editor.getText({blockSeparator:'\n'}),editor),onSelectionUpdate:({editor})=>onCursor?.(editor)
});
