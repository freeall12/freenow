import {createStore} from '../store.mjs';
const context=window.CanvasProjectContext.resolve(),store=createStore({namespace:context.namespace}),path='artifacts/discussion-qa.html';
const panel=document.createElement('aside');panel.style.cssText='position:fixed;left:80px;top:80px;width:320px;max-height:65vh;overflow:auto;z-index:3000;background:#222;color:#ddd;padding:16px;font:13px/1.5 system-ui';
const heading=document.createElement('strong');heading.textContent='HTML 讨论 · 隔离完整画布';panel.append(heading);
const note=document.createElement('p');note.textContent='真实产物存储、侧栏与对话草稿。没有模型请求；数据位于专用会话空间。';panel.append(note);
const output=document.createElement('pre');output.ariaLabel='实际产物与持久引用';output.style.cssText='white-space:pre-wrap;overflow-wrap:anywhere';
async function report(){const record=await window.CanvasStore.readRecord('agent-conversations:'+context.id);output.textContent=JSON.stringify({files:await store.list(),conversations:record?.chats?.map(chat=>({id:chat.id,draft:chat.text,references:chat.artifactRefs,messages:chat.messages.length}))},null,2);}
function button(label,action){const button=document.createElement('button');button.textContent=label;button.style.cssText='display:block;margin:8px 0;padding:8px';button.onclick=async()=>{try{await action();await report();}catch(error){output.textContent=error.message;}};panel.append(button);}
button('保存真实 HTML 并打开助手',async()=>{const prior=(await store.list()).find(file=>file.artifact_path===path);if(!prior)await store.write({artifact_path:path,title:'QA 本地讨论作品',content_type:'html',content:'<!doctype html><meta charset="utf-8"><style>body{background:#e9eee6;color:#234232;font:24px system-ui;padding:40px}input{font:inherit}</style><h1>本地作品 · 初版</h1><label>交互输入 <input value="真实本地内容"></label>',expected_revision:0});window.AgentUI.open();});
button('提交作品的新版本',async()=>{const file=await store.get(path);await store.write({artifact_path:path,title:'QA 本地讨论作品',content_type:'html',content:file.content.replace(/本地作品 · [^<]+/,'本地作品 · revision '+(file.revision+1)),expected_revision:file.revision});});
button('读取实际持久引用',report);panel.append(output);document.body.append(panel);await report();
