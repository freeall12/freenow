const prompt='创建一个简洁的街道场景：一个人沿街向前走，两侧有几栋楼。镜头从人物后方缓慢跟随，持续 5 秒。';
export function createStudioWelcome(onChoose){
  const root=document.createElement('section');root.className='agent-studio-welcome';
  const image=document.createElement('img');image.src='/assets/agent-motion-slow.webp';image.alt='';root.append(image);
  for(const [tag,text] of [['p','你好，创作者！'],['h2','让 AI 帮你搭场景、设计运镜'],['p','描述你想要的场景和镜头运动…']]){const element=document.createElement(tag);element.textContent=text;root.append(element);}
  const example=document.createElement('button');example.type='button';example.textContent=prompt;example.onclick=()=>onChoose(prompt);root.append(example);return root;
}
const style=document.createElement('link');style.rel='stylesheet';style.href=new URL('./welcome.css',import.meta.url);document.head.append(style);
