# Agent 目录参考键盘导航 · 2026-10-04

本批补齐参考选择器目录页的实际导航缺口：空目录也能用键盘选择整目录引用，返回按钮与资产共用同一选择索引。仅产生既有 `onPick` 引用回调，不自动发送消息或派发生成。

## 官方依据

只使用可追溯官方发布包 `reference/vendor-pkg-canvas-BREtla0j.js`，来源记录见开发机 `reference/agent-references.md`；其 SHA256 为 `3709d30a9368348765cd2d9c00a3fceaff4598a685e43615e23e79e912e3bf62`。字符偏移按此原始文本、从0计数：

- `bj` 目录页，约237k–240k：返回按钮 `data-selectable-index=0`，`Reference folder` 为1；`qe=m?2:1` 给后续目录/资产留出偏移。
- `Bn`，约232k–235k：输入框 Escape 在目录页调用 `goBackToFolders`，根页才关闭；Tab/ShiftTab 使用可导航索引；Enter分别处理 `backToFolders`、`selectCurrentFolder`、`folderAsset`。
- `z0`，字符221450起：方向导航在首尾停留，未循环；`at`，字符224601起：返回上层并恢复索引0。
- 根/目录容器的 `onMouseDown` 阻止选择按钮抢走输入焦点；`Tn`（约234k）输入失焦到外部时关闭。
- 进入非空目录的 effect 选择索引1，即整目录引用；空目录保持返回项0。

本地原代码将返回和目录引用按钮排除在 `rows` 之外，键盘只能选择资产；空目录没有可导航项。Tab直接关闭、目录Escape直接关闭、首尾循环也与上述官方实现不同。localhost仅用于实现QA。

## 实现与入口

- `src/features/agent-composer/reference-picker.mjs`：共享索引登记；目录操作与资产共用hover和键盘选中；根/目录均支持Tab、ShiftTab及首尾停留；目录Escape先返回根层，根层Escape才取消。返回后清空搜索、恢复根首项并聚焦搜索框。选择按钮mousedown保持搜索焦点，搜索框自身保留原生点选文本光标；失焦到外部取消。无匹配选项的Tab允许原生离开、由blur关闭。输入的Left/Right保持原生文本光标语义，IME组合及keyCode229不执行导航/选择；关闭后的选择/取消回调幂等。
- `src/features/agent-composer/editor.css`：目录操作按钮选中背景使用既有颜色，无新增图标。
- `assets/agent-editor.js`：通过 `node scripts/build-agent-editor.cjs` 同步。主Agent通过该bundle执行选择器；CSS由 `agent-client.js` 的现有link直接加载。不能仅凭source修改认定主入口已更新。
- `src/features/agent-composer/qa/reference-picker-navigation.html` / `.mjs`：直接运行生产组件；仅本页内存夹具、回调收据；不保存用户会话，不请求供应商。角色为空目录，场景个人/团队各有一个同名真实夹具资产。

未改引用公共结构、素材解析、Agent提交或服务权限。scope继续沿用个人/团队对象，不按显示名混用。

## 验证

```sh
node --test tests/agent-reference-picker-navigation.test.cjs tests/agent-menu-dismissal.test.cjs
node scripts/build-agent-editor.cjs
node --check src/features/agent-composer/reference-picker.mjs
node --check src/features/agent-composer/qa/reference-picker-navigation.mjs
git diff --check
```

15项通过：新增7项执行真实生产模块与jsdom，另有8项菜单层级回归。覆盖空/非空目录、scope区别、搜索后索引、鼠标登记、返回焦点、根/目录Tab边界、两级Escape、IME不提交、关闭后迟到键盘/点击/取消事件、mousedown焦点所有权、无结果Tab以及外部取消。jsdom不提供完整pointerenter分派，单测显式调用生产pointerenter处理器；未将其声称为真实鼠标验收。

实际Computer Use入口：`http://127.0.0.1:4173/src/features/agent-composer/qa/reference-picker-navigation.html`。现场操作结果：

1. 搜索角色→Enter进入空目录，选择次数仍0；Tab选中Reference folder、Down在末项停留；Enter只产生一次 `{kind:folder,scope:personal,label:private:/角色}`。
2. 场景目录搜索雨夜→Down→Enter，仅选择本页实际 `qa-personal` 资产。个人/团队同名目录通过根列表索引分别进入；团队Reference folder回调的scope为team、label为team:/场景。
3. 目录Escape返回根层，无新增回调；第二次Escape关闭并回anchor。
4. 实际鼠标进入角色目录，焦点保持搜索，选择次数0；根列表搜索无匹配后Tab允许原生离开，取消一次且无选择。
5. 场景搜索不存在仍保留返回和Reference folder两项；鼠标点击返回后搜索清空、焦点在搜索框、根首项恢复；鼠标点击空角色Reference folder仅新增一次目录回调。

截图保存在开发机 `/tmp/agent-reference-folder-navigation-20261004.jpg`。浏览器使用默认大视口，没有宣称全屏像素还原；完整主Agent bundle入口还需由主任务隔离会话复验。供应商和LLM均未调用，本批不扩大工作流覆盖计数。

## 正式 bundle 主入口复验

主线程在隔离片场的正式agent-client/Tiptap入口输入@，打开个人角色空目录，以Tab选中Reference folder、Enter写入真实private:/角色原子引用并返回对话输入；没有发送消息、没有生成派发。最后打包重载后，鼠标进入目录实际焦点保持搜索；第一下Escape回根列表/搜索，第二下关闭并回到AI对话输入，原目录引用仍保留。该证据验证生产bundle与source同步。最终新增7项、相邻8项共15项通过，包含鼠标保持搜索焦点、外部blur和关闭幂等保护。
