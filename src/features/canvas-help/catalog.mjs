export const helpItems = [
  {id:'updates',label:'最近更新',testId:'canvas-user-guide-latest-updates-btn'},
  {id:'guide',label:'使用教程',testId:'canvas-user-guide-btn'},
  {id:'agent',label:'连接 Agent'},
  {id:'feedback',label:'反馈问题',testId:'canvas-feedback-trigger-btn'},
  {id:'shortcuts',label:'快捷键',testId:'canvas-user-guide-hotkeys-btn'},
];

// Symbols and gesture assets follow the observed official macOS help panel;
// the modifier label adapts to the local platform without changing the actions.
export function shortcutColumns(mac=true) {
  const mod=mac?'⌘':'Ctrl';
  return [
    [
      {title:'基础',rows:[['删除',['⌫']],['撤销',[mod,'Z']],['重做',['⇧',mod,'Z']],['复制',[mod,'C']],['粘贴',[mod,'V']],['堆叠',[mod,'G']],['搜索节点',[mod,'F']],['多选',['⇧','mouse']]]},
      {title:'缩放',rows:[['放大',[mod,'+']],['缩小',[mod,'−']],['键盘',[mod,'mouse']],['触控板',['zoom']]]},
    ],
    [
      {title:'移动画布',rows:[['键盘',[mod,'Space','mouse']],['触控板',['pan']]]},
      {title:'时间轴',rows:[['切割',['C']],['向左裁切',['Q']],['向右裁切',['E']]]},
      {title:'其他',rows:[['打开/关闭 Agent',[mod,'J']],['焦点编辑',[mod,'I']],['语音输入',['长按','V']],['完成语音输入',['V']]]},
    ],
  ];
}
