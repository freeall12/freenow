import {createCanvasHelp} from './ui.mjs';
const guide=new URL('./guide.html',import.meta.url);
window.CanvasHelp=createCanvasHelp({document,window,trigger:document.getElementById('help'),canvas:document.getElementById('canvas'),closeOtherMenus(){window.CanvasMenus?.close();window.CanvasCommands?.close();},run(action){
  if(action==='feedback')return window.FeedbackAPI.open(window.CanvasApp.getState().selected);
  if(action==='agent'){
    if(window.ExternalAgentUI)return window.ExternalAgentUI.open();
    window.CanvasApp.notify('外部 Agent 连接正在初始化，请稍后重试。');return;
  }
  const url=new URL(guide);url.searchParams.set('section',action==='updates'?'updates':'start');window.open(url.href,'_blank','noopener');
}});
