# 分组、多选复制与普通副本的区别

1005m补齐分组、多选的复制→粘贴链，保留1005l已验收的普通单节点右键“副本”。不增加官方没有的分组右键入口，不改模板、供应商或公共分组模块。

## 官方证据

依据 `reference/canvas-current-readable.js`，并只读安装包 `/Applications/TapNow.app/Contents/Resources/web/assets/page-DVqoHdTT.js` 交叉核对clipboard链，`course-api-base-url-CGXqZmAy.js`交叉核对GroupNode组件与克隆helper：

| 功能 | 网页源码 | 安装包对应 | 实际规则 |
| --- | --- | --- | --- |
| 复制选中组、多选 | qdt，44625–44635 | Ime | 递归组后代，含选中堆叠成员；重复选中组子不会复制两次 |
| 复制边 | fae，44640–44643 | wO | 仅保留target在复制集合的边：内部边与外部入边；不带出边 |
| 不包含父组的节点 | Ydt，44644–44651 | Ame | 先转绝对坐标，再脱离父组并删parent extent；父组在集合则保层级 |
| 复制图库与临时标记 | YAe/Vb，10298–10304 | Zq/yu/IR | COPY时清图片/视频图库，清copyFrom与selected/dragging；playlist去__playlist运行字段 |
| 粘贴坐标 | Kdt/Xdt，44636–44639及44652–44676 | kme/Tme | 绝对bbox左上对齐指针或画布中心；重复原位粘贴加iteration×40/zoom；保父子相对距离 |
| 粘贴新身份 | Xdt→mD，44652及6784–6787 | Tme→xj | 新ID、loading false、taskInfo null、selected true、dragging false；父ID与pile成员重新映射 |
| 粘贴边 | Qdt→SX/Ns，44677–44681、10265–10285 | jme→yj | 新边ID，入边order保留，handles与其余数据保留，清selected |
| Cmd/Ctrl-D | fF，44748–44758 | Y_ | 与Cmd-C使用同一copy；D随后立即paste，使用指针/中心位置 |
| 普通右键副本 | Jdt/U，44844–44864 | Mme | 当前节点x+width+100、y不变；复制出边和入边，出边追加order |
| 分组入口 | GJ，23333–23349 | course-api模块WJ/GroupNode | 组自身阻断contextmenu；组工具条无副本，多选Upt工具条亦无独立副本 |

上述来源不涉及官方账户写入或模型调用。上一批只修普通副本并保留旧clipboard；本批新读取YAe/Vb证明copy本身也清图库，因此替换了原先“粘贴保留图库”的旧测试预期。

## 本地修改

`canvas-clipboard.js`保留已有递归遍历、绝对坐标、父ID/pile/reference映射及内部/外部入边策略；只补以下明确差距：

- capture按官方store清图片/视频图库与临时标记；脱离外部父组时清parent extent；清playlist的__playlist运行字段。
- instantiate清loading/taskInfo及本地pendingOperation、generationRun、generationRecovery、workflowRecoveryResult；媒体provenance/currentSourceFileId保留。清边selected和导入绝对path缓存，缺失order按新目标的既有复制边追加。
- app.duplicate中的组/多选分支走现有CanvasMenus.copy→paste，替代原来的固定+80/+100与仅内部边分支。普通单节点副本、单tool所有者、堆叠原分支保留。
- 经主任务授权扩展app.captureSelection：只对捕获到的节点换ID前物化旧EDITOR_DATA视频ref及原本eligible的编辑器配置。已有generation/params优先；普通上传媒体不新增generation/生成面板；原来源节点不被写回。待导入ref原样保留。

本地所有节点x/y已经是绝对坐标，因此整体dx/dy对组和每个后代各加一次，不再次叠加父组坐标。官方ReactFlow在节点记录上选择所有新节点，本地CanvasApp以可见根节点作为规范selection，避免把选中整组误显示为组子多选工具条；copied节点记录仍清旧selected/dragging，paste记录设selected true。

当前媒体、clip、尺寸、正文、generation/params、provenance以及边元数据均深复制。组包含本地studio所有者时仍拒绝复制；未知编辑器节点的特定运行数据未擅自清除。

## 定向验证

```sh
node --test tests/canvas-clipboard.test.cjs tests/canvas-app-persistence.test.cjs
node --check canvas-clipboard.js
node --check app.js
node --check src/features/canvas-clipboard/qa/group-fixture.js
node --check src/features/canvas-clipboard/qa/group-controls.mjs
```

44项通过。新增覆盖反序嵌套组和大绝对坐标、外层父组不复制、组+子重复选择、多选脱离父组、入边保留/出边排除、order/handles/custom、图库与运行归属清理、来源不变、旧视频和真实getConfig配置回退、params与generation的本地引用绑定重映射、上传媒体无新面板、一次保存、原位再次粘贴40/zoom与精确撤销。

持久化回归现执行真实canvas-menus.js copy/paste、app.captureSelection/pasteGraph/duplicate和真实Clipboard实现，移除上批instantiate存根；仅替换DOM、OS剪贴板写入和异步存储边界。大坐标浮点比较容差1e-8，撤销图仍完全相等。

## 隔离生产QA

入口：`/src/features/canvas-clipboard/qa/group-main.html?session=group-copy-1005m-1`。group-frame加载正式index与脚本，使用自有运行时PNG。独立Canvas/LocalAssets/模板库命名、内存localStorage，固定session支持刷新，不覆盖已有seed；阻断真实API和外部fetch。source的loading/taskInfo/workflowRecoveryResult只是隔离夹具的合成状态，没有模型任务。

1. 组：在正式画布点击“复制此嵌套组”的边框，或用“准备：选择嵌套组”按钮只选组。按⌘C，移动指针到右侧空白，按⌘V；也可⌘D。应新增组、图片、文本3节点；新组无外层parent/parent extent，两孩子保新组父ID，图片相对组x30.5/y45，文本相对组x45.25/y255.25。
2. 多选：另开session，先点文本节点body，再Shift点图片body，按⌘C/⌘V或⌘D。应只新增图片+文本且均脱离父组；两者x差14.75/y差210.25。
3. 两种复制：媒体保持，图库空、loading false/taskInfo null、workflowRecoveryResult移除；外部入边order3、内部边order4及handles/custom保留，外部出边数0；originalsUnchanged/mediaMatchesSource均true，每次paste的writesSinceBaseline增加1。
4. 同一指针位置第二次⌘V偏移40屏幕像素。按⌘Z或点生产撤销，直到exactUndoRestored true且copies/addedEdges为空。诊断回读真实图与CanvasStore保存调用。

准备按钮仅改变正式selection并聚焦画布，不复制、不派发键盘事件；多选仍需真实Shift点击。浏览器与键盘验收由主任务完成，本代理未进行browser操作。旧视频兼容由生产closure/getConfig定向回归验证，未宣称真实供应商任务或旧视频单独CUA播放。


## 主任务生产页面验收

2026-10-05主任务已完成实际CUA：组复制保留新组的父子层级、内部边和外部入边，清图库及运行归属；同一指针位置连续粘贴的位移为40屏幕像素。通过准备按钮选择组后，在生产画布按真实super+d，同样新增组、图片、文本3节点且边正确；原生撤销精确恢复。

多选采用真实CDP先点击文本body，再Shift点击图片body，随后原生super+c/super+v。得到两个脱离原父组的节点，x差14.75/y差210.25，外部入边1、内部边1、外部出边0；只保存1次，原图和当前媒体不变。super+z后exactUndoRestored为true。操作顺序避免先选图片时composer遮住文本；Playwright对子iframe标题点击存在坐标问题，本轮使用真实body点击完成验收，不据此归为产品缺陷。

验收截图：[分组复制的正式生产画布](screenshots/canvas-group-copy-20261005.jpg)。最后params绑定适配亦由独立交审只读复核，新增case单独1/1通过。未重跑此前已通过的44项测试。

本轮日志有1条MutationObserver.observe参数非Node异常；主任务回读的栈不含项目URL，顶层scriptId4/URL为空，末帧为Electron sandbox宿主栈。本批clipboard及新QA未发现对应生产调用，因此不能归因到生产复制流程；未据此修改生产代码。
