const test=require('node:test'),assert=require('node:assert/strict');

test('app detail markdown strips original-service links and preserves independent destinations and labels',async()=>{
 const {safeAppDetailLink,renderAppMarkdown}=await import('../src/features/agent-manager/app-detail-content.mjs');
 const values=['https://app.tapnow.media/source','https://FILES.TAPNOW.MEDIA.../source','https://tapnow.ai/source','https://tamaredge.top/source','https://conversation-service-131786869360.asia-northeast1.run.app/source','javascript:alert(1)','https://user:secret@example.org/','https://example.org/docs','mailto:hello@example.org'];
 const links=values.map(value=>({attrs:{'data-skill-link':value},childNodes:[{textContent:value}],getAttribute(name){return this.attrs[name];},removeAttribute(name){delete this.attrs[name];},replaceWith(...nodes){this.replacement=nodes;}}));
 const fragment={querySelectorAll:()=>links},template={content:fragment},target={ownerDocument:{createElement:()=>template},replaceChildren(value){this.content=value;}};
 renderAppMarkdown(target,'original source retained',text=>{assert.equal(text,'original source retained');return 'rendered';});
 assert.equal(target.content,fragment);
 for(const link of links.slice(0,7)){assert.equal(link.href,undefined);assert.deepEqual(link.replacement,link.childNodes);}
 for(const link of links.slice(7)){assert.equal(link.href,link.childNodes[0].textContent);assert.equal(link.target,'_blank');assert.equal(link.rel,'noopener noreferrer');assert.equal(link.attrs['data-skill-link'],undefined);}
 assert.equal(safeAppDetailLink('https://tapnow.media.example.org/docs'),'https://tapnow.media.example.org/docs');
});
