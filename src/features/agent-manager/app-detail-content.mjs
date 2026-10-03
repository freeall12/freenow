import {independentNavigationUrl} from '../local-resource-migration/origin-policy.mjs';

export function safeAppDetailLink(value) {
 try {
  const url=new URL(value);
  if(url.protocol==='mailto:')return url.href;
  return independentNavigationUrl(value);
 }catch{return null;}
}

// Reuse the bundled skill renderer, which strips raw HTML and images. App
// descriptions use external links rather than skill-package file navigation.
export function renderAppMarkdown(target, text, renderSkillMarkdown) {
 const template=target.ownerDocument.createElement('template');
 template.innerHTML=renderSkillMarkdown(String(text??''));
 for(const link of template.content.querySelectorAll('a[data-skill-link]')){
  const href=safeAppDetailLink(link.getAttribute('data-skill-link'));
  if(!href){
   link.replaceWith(...link.childNodes);continue;
  }
  link.removeAttribute('data-skill-link');link.href=href;
  link.target='_blank';link.rel='noopener noreferrer';
 }
 target.replaceChildren(template.content);
}
