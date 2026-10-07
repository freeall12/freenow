import {guideSections} from './guide-data.mjs';
const navigation=document.getElementById('guide-nav'),content=document.getElementById('guide-content'),toggle=document.getElementById('toggle-nav');
const element=(tag,text)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;};
function render({focus=false}={}){
  const selected=new URL(location.href).searchParams.get('section'),index=Math.max(0,guideSections.findIndex(section=>section.id===selected)),section=guideSections[index];
  document.title=section.title+' · freenow 使用教程';navigation.replaceChildren();
  for(const item of guideSections){const link=element('a',item.title);link.href='?section='+item.id;if(item.id===section.id)link.setAttribute('aria-current','page');link.onclick=event=>{if(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;event.preventDefault();history.pushState(null,'',link.href);render({focus:true});};navigation.append(link);}
  content.replaceChildren();const article=element('article');article.append(element('p','使用教程 / '+section.title),element('h1',section.title),element('p',section.lead));
  for(const [title,description]of section.steps){const block=element('section');block.append(element('h2',title),element('p',description));article.append(block);}
  if(section.image){const figure=element('figure'),image=element('img');image.src=section.image;image.alt=section.imageAlt;image.loading='lazy';figure.append(image,element('figcaption','实际本地界面；演示使用本地测试素材。'));article.append(figure);}
  const paging=element('nav');paging.setAttribute('aria-label','教程翻页');for(const [offset,label]of [[-1,'上一页'],[1,'下一页']]){const next=guideSections[index+offset];if(next){const link=element('a',label+' · '+next.title);link.href='?section='+next.id;paging.append(link);}}
  article.append(paging);content.append(article);document.body.classList.remove('guide-nav-open');toggle.setAttribute('aria-expanded','false');if(focus){window.scrollTo({top:0,behavior:'auto'});content.focus({preventScroll:true});}
}
toggle.onclick=()=>{const open=document.body.classList.toggle('guide-nav-open');toggle.setAttribute('aria-expanded',String(open));};
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&document.body.classList.contains('guide-nav-open')){document.body.classList.remove('guide-nav-open');toggle.setAttribute('aria-expanded','false');toggle.focus();}});
window.addEventListener('popstate',()=>render({focus:true}));render();
