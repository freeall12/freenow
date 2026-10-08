# 场地／房间菜单合同

`createSpaceMenu` 返回 `HTMLElement`，提供 `refresh()`、`handleEscape()` 和 `dispose()`，兼容现有 `createMenus`。宿主在关闭／替换菜单时调用 `dispose()`，由菜单控制器恢复入口焦点。

```js
createSpaceMenu({
  read: () => ({source, roomConfig, busy, scenes, loading, error, hasOriginal}),
  setSource: async source => ({ok: true}),
  updateRoom: async patch => ({ok: true}),
  beginRoomEdit: async () => ({onMove, onEnd, onCancel}),
  resolveThumbnail: source => window.LocalAssets.url(source), // 可选
  close,
  onError,
});
```

`setSource`／`updateRoom` 仅接受明确的 `{ok:true}`。room patch 是部分字段，例如 `{width:6}` 或 `{trackingGuides:{enabled:false}}`；宿主负责合并参考图案其余字段、执行作者权限门禁、历史事务和持久保存。`read()` 应同步返回最新 accepted／preview 值，不能返回纯 UI 草稿。`busy` 阻止新操作。

连续尺寸编辑调用一次 `beginRoomEdit()`，其返回 lease 必须含 `onMove(patch)`、`onEnd()`、`onCancel()`。这些方法可同步或异步；`false`／`{ok:false}` 为拒绝，其他返回值为成功。移动串行执行；Escape、pointercancel、菜单销毁及离开房间取消事务；异步 lease 迟到后仍取消。宿主取消应回滚整次 preview。不要在 `onMove` 中创建独立历史条目。pointer >3px 才 begin，公式 `start * 2^(dx/160)`；wheel 使用 `2^(delta/1200)`，200ms 同一 burst 一条事务。

来源值分别为 `{kind:'empty'}`、`{kind:'mesh-preset',preset:'room'}`、`{kind:'world-asset'}` 和 `{kind:'history-world',historyAssetId,label,thumbnailSrc?,threedMeta}`。成功选择关闭菜单并回焦。房间当前激活时才显示“设置”；设置与场景选择为同一个菜单内的侧栏，移动窗口改为叠层显示。

数值复用 `bindEntityInspectorNumberField`；显示一位小数不会写回真实精度。仅显式草稿的 Enter／change／blur 提交。宽深限制 1–100m，高度 2–20m，有限超界值按官方 clamp；空／非法数值拒绝，草稿与错误保留可重新修改。正在输入／提交时 refresh 不覆盖草稿。IME 不提交／取消。Escape 依次取消连续手势或未接受草稿、关闭侧栏并聚焦其入口、关闭菜单并恢复原入口；第一层取消草稿保留错误提示。

场景项 `{id,label,thumbnailSrc?,createdAtLabel?,threedMeta}` 由宿主提供：仅本地 world 节点／outputType=world 的非对象场景，具有真实本地 GLB／SPZ descriptor。菜单不请求生成历史，不生成、不发网络请求。搜索匹配 label 和日期；空列表、无匹配、loading、传入 error 为实际状态。官方 z7 无 error/retry 分支；协议没有 loadMore/retry 回调，所以不添加伪请求按钮。资源解析仅挂载 `/`、`blob:`、`data:image/` URL；拒绝远端 URL，迟到解析不得更新已替换或已销毁 DOM。

官方依据：`docs/research/STUDIO-V3-PLAN-20261008.md`；安装包 `ThreeDWorkspace-BzPphAqB.js` 的 d9（819805）、e9（812288）、o9（814032）、pE（778313）、mE（783486）、z7/B7/H7/V7（798650 起）；`EnvironmentLightingPickerContent-CigxxFZu.js` 的 bc/wc/xc/Sc；`index-BsHyQ2qj.js` 的中文 space 字典（9175347）。CSS 按原 class 数值转写：280px 侧栏、36px 行、64×28px 数值、32px segmented、28px thumbnail、312px 场景列表。两块面板的边框／背景／blur／shadow来自 `ThreeDActivityOverlay-CIotE4kO.js` 的 panelProminent/panelSubtle。外层共享菜单由专属 `:has(>.sv3-space-menu)` 自动调整为内容宽度以容纳侧栏，不要求宿主预留空侧栏。图标复用既有官方提取模块，不给场地选择额外添加装饰图标。尚未进行实际浏览器视觉核验。

Chrome 兼容：共享 motion 外壳的 `will-change:opacity` 会建立 backdrop root，使子面板无法采样外部场景。仅场地菜单外壳覆盖为 `will-change:transform`，保留原 opacity 展开／收起动画及全部官方视觉数值；主任务浏览器复验模糊效果。

专项验证：`node --test tests/studio-v3-space-menu.test.cjs`。
