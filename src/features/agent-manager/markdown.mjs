import {MarkdownManager} from '@tiptap/markdown';
const parser=new MarkdownManager().instance,renderer=new parser.Renderer();
const escape=text=>String(text).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
renderer.html=()=>'';renderer.image=()=>'';
renderer.link=function(token){return '<a href="#" data-skill-link="'+escape(token.href)+'">'+this.parser.parseInline(token.tokens)+'</a>';};
export function renderSkillMarkdown(text){return parser.parser(parser.lexer(text,{gfm:true}),{renderer,gfm:true});}
