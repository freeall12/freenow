// Reuse the bundled skill renderer, which strips raw HTML and images. App
// descriptions use external links rather than skill-package file navigation.
export function renderAppMarkdown(target, text, renderSkillMarkdown) {
 const template=target.ownerDocument.createElement('template');
 template.innerHTML=renderSkillMarkdown(String(text??''));
 for(const link of template.content.querySelectorAll('a[data-skill-link]')){
  let url;
  try{url=new URL(link.getAttribute('data-skill-link'));}catch{}
  if(!url||!['http:','https:','mailto:'].includes(url.protocol)){
   link.replaceWith(...link.childNodes);continue;
  }
  link.removeAttribute('data-skill-link');link.href=url.href;
  link.target='_blank';link.rel='noopener noreferrer';
 }
 target.replaceChildren(template.content);
}
