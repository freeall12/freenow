# 画布帮助入口与离线教程 · 2026-10-08

本批使用官方 Web 的帮助菜单与快捷键页面作为视觉和行为来源。运行入口是本地源码，不会访问官方文档、反馈服务或 MCP 地址。

## 来源与资源

官方画布现场读取确认五项顺序：最近更新、使用教程、连接 Agent、反馈问题、快捷键。菜单的公开 DOM 采集为 `reference/help-menu-live-20261008.json`，快捷键公开 DOM 为 `reference/help-shortcuts-live-20261008.json`；这些研究快照不作为运行时文件、不进入公开仓库。官方使用教程按钮实际打开 `https://docs.tapnow.media/zh/docs` 新标签页；本地对应打开独立的离线教程新标签页。

菜单复用现场 SVG，快捷键面板复用官方关闭按钮、鼠标示意 SVG 和两张原始 GIF；没有自行绘制图标。SVG 位于 [icons.mjs](../src/features/canvas-help/icons.mjs)，原始手势资源位于 `src/features/canvas-help/assets/`。

| 原始资源 | 本地文件 | SHA256 |
| --- | --- | --- |
| `f3881adc48fcfd5628a3c69429b8eeee555b1872/assets/zoom-9JfllZME.gif` | [zoom.gif](../src/features/canvas-help/assets/zoom.gif) | `5b550ed1fe4162c9a23c343fc77c39ecd192312fb86cb5743460c8894407d9b6` |
| 同一官方静态构建中的 `double-click-BJZPLkGG.gif` | [pan.gif](../src/features/canvas-help/assets/pan.gif) | `52d18a1dc24a9f3f286a936031fe4b99b3f24a54b5744eaa2973f4379ccb730a` |

资源来源为 `fe-assets.tapnow.media`，仅用于采集；生产代码只引用本地路径。本条来源记录不扩大第三方资源许可，沿用仓库来源/许可边界。

## 本地行为

- 帮助按钮打开底部弹层，五项 14px / 20px 字体、16px 图标、12px 行内边距、4px 间隔与16px外圆角；选择态同步视觉与 `aria-selected`。
- 点击第二次关闭；外部点击、真正移出焦点、滚轮或失焦关闭菜单。Escape 回到原按钮；Tab 原生移动，方向键从真实焦点出发，Enter / Space 确认当前高亮；输入法和修饰键不误触。
- 快捷键是640px、两列、24px圆角、24px/40px内边距和56px列间距的独立信息面板。对齐实际画布可视区域的底部中心，窄视口收窄/单列，防止官方在窄画布上负坐标裁切。五组21行保留实际键位，中文化“搜索节点”，Windows/Linux使用Ctrl。
- 快捷键关闭按钮、Escape和外部点击可关闭并正确回焦。隐藏的项目切换器不阻挡Escape，真正上层弹层拥有自己的Escape；点击画布关闭面板不修改选择或历史。
- 教程覆盖开始使用、画布、节点、文本/图片、视频/音频、3D、Agent、API配置、保存恢复和本地更新。章节 URL、前后翻页、浏览器前进/后退、窄屏目录开关和Escape均本地执行。
- “最近更新”展示 freenow 源码实际变更；“反馈问题”调用既有本地反馈保存流程；“连接 Agent”调用新的本机接入面板，不替换为内部模型设置。

源码在 [canvas-help](../src/features/canvas-help/)，主壳 `index.html` 引用独立样式/模块。仅把 `app.js` 的旧简略帮助弹框入口换为该模块；没有新增依赖或远程资源回退。

教程里的两张界面图是已有公开演示截图的原字节副本，位于该模块的 `assets/canvas-workflow.jpg` 与 `assets/model-preview.jpg`，通过模块相对 URL 加载。不能引用 `/docs/screenshots/` 作为运行资源：桌面准备脚本会排除 `docs/`。本次已修复这个打包缺口，保持文档截图和运行资产分开。

快捷键不是仅增加说明文字：实际缺失的G、Mac Command滚轮和长按V另有实现与逐项矩阵，见 [快捷键接线](CANVAS-SHORTCUTS-20261008.md)。真实麦克风和硬件触控板仍未本批验证。

## 验证

```sh
node --test tests/canvas-help-interactions.test.cjs
node --check src/features/canvas-help/ui.mjs
node --check src/features/canvas-help/guide.mjs
node scripts/create-canvas-command-menu-main-qa.cjs
```

5项定向检查最终通过。首次4/5通过，JSDOM不识别`onpointerenter` property事件，改为标准事件监听后通过。随后实机发现生产隐藏项目切换器被当作上层弹层，补充真实隐藏role=dialog回归，**仅重跑该项1/1**通过；没有重跑全库。

主线CUA在当前生成的真实主壳QA、独立数据库与空Key的4195服务验收：

1. 五项帮助菜单实际打开，Home/End/方向键进入快捷键；21行两列内容与两张本地GIF实际解码。
2. 动效结束后的实际面板为 `width=640`、`height=606`、`x=320`、`y=98`，对应默认1280×720视口，底部16px。未拿动画中的缩放尺寸作为漂移证据。[实际面板截图](screenshots/canvas-help-shortcuts-20261008.png)是该公开QA面板的区域截图。
3. 隐藏切换器修复后reload，Escape关闭快捷键、帮助按钮回焦；再次点击帮助按钮关闭而不重开，焦点保留在按钮。
4. “使用教程”实际打开 `http://localhost:4195/src/features/canvas-help/guide.html?section=start` 新标签；窄视口目录展开后选择“保存与恢复”，URL/主标题/正文同步变化，目录自动关闭并将焦点移到主内容。
5. 教程改用可打包的模块内图片后，真实目录操作进入“开始使用”与“3D 片场”，两张图片均 `complete=true`，自然尺寸分别为 1447×1566、1280×720，实际 `src` 位于 `/src/features/canvas-help/assets/`。源路径通过桌面 `isRuntimeFile` 白名单；本批没有重建或重新发布 Alpha，不把源路径检查称为新安装包验证。

本轮不声称官方全部帮助页面正文或所有布局断点逐像素一致。教程内容按 freenow 当前本机能力编写，不复制官方账户/团队/计费流程。反馈附件真实提交、全部浏览器/平台/输入法、所有关闭路径组合仍需要扩展验证；生成模型、麦克风和官方服务均未调用。
