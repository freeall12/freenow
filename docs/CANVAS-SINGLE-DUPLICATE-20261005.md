# 普通单节点“副本”行为

本批只还原图片、视频、音频、文本的普通单节点副本。分组、堆叠、多选、图片编辑器等 `tool` 所有者及3D片场保持已有分支；HTML和其他未知类型未在本批收口。Ctrl/Cmd-D的既有复制粘贴链没有改动。

## 官方与安装包证据

`reference/canvas-current-readable.js`：

- `Jdt/U`，44782–44865：以 `vn(Q)+100`、`y:0` 调用绝对位置转换，使用 `Zdt(mD(...))` 创建副本；移除父组及 `extent:'parent'`；复制全部出边与入边。
- `vn`，6626–6630：宽度依次取 `width/measured.width/dimensions.width`，默认250。
- `Vd/ui/mD`，6773–6786：解析绝对位置；新ID；`loading:false`、`taskInfo:null`。
- `$Ae/Ns/SX`，10178–10285：出边按目标当前最大order+1追加，连续出边逐条计数；入边保留原order；保留handles与其余边信息，去掉selected。未标order按官方 `2**30` 哨兵参与最大值计算。
- `CX/Zdt`，10286及44782：仅图片/视频清空options及本地历史队列，移除历史来源/预览；保留当前媒体src。

已读安装包 `/Applications/TapNow.app/Contents/Resources/web/assets/page-DVqoHdTT.js` 交叉确认。其 `Mme` 副本分支使用 `fc(...,{x:mn(U)+100,y:0})`、`Rme(xj(...))`，去父组与parent extent，出边在前、入边 `preserveOrder:!0`；`IR` 清图库及历史队列，与网页读取结果一致。只读本机安装包，未调用账户/模型服务。

安装包 `course-api-base-url-CGXqZmAy.js` 的 `jbe` 克隆函数也确认新ID、`loading:!1`、`taskInfo:null`，并显式拒绝克隆3D Studio状态所有者；与本地保留片场禁用分支相符。

2026-10-05主任务补充官方live只读观察：对Video标签右键，菜单依次为“保存到素材库”、“复制 ⌘C”、“粘贴 ⌘V”（disabled）、“副本”、“删除 ⌫del”、“反馈问题”。随后按Esc关闭；未点击官方副本、修改节点或调用模型。此处仅记录入口和标签，不发布用户画布ID或官方画布截图。

2026-10-05 在官方 Web 对视频节点真实右键，确认菜单显示“复制 ⌘C / 粘贴 ⌘V（禁用）/ 副本 / 删除”。随后按 Escape 关闭；未在官方项目执行副本、删除或生成。该步骤验证菜单入口，坐标与数据行为依据上述源码和安装包交叉确认。

## 本地映射

`canvas-clipboard.js` 新增纯函数 `duplicateNode`；`app.js` 仅在一个已选择普通节点、无tool、无堆叠成员、无附带后代时调用。分组里的普通子节点可以单独复制；本地x/y本来就是绝对坐标，不再次叠加父组坐标。

旧节点的当前视频和生成草稿可能只存在按原ID索引的 `EDITOR_DATA` 或编辑器drafts。副本入口在换ID前物化原始视频ref；仅对原节点本来满足编辑器eligible条件（已有EDITOR_DATA、生成标题、或缺image）的节点，通过真实 `NodeEditor.getConfig` 读取缺失生成参数。已有generation/params优先保留，原节点不被写回；普通上传媒体不会因副本新增默认generation而打开生成面板。原始ref保留待导入状态，不经显示策略过滤后保存。

| 官方字段/行为 | 本地处理 |
| --- | --- |
| 新ID、x+宽度+100、y不变 | 新节点和 incident edges 创建UUID；保留小数坐标 |
| 无parentId/parent extent | 删除parentId，只删除值为parent的extent |
| loading false / taskInfo null | 同名字段赋官方值 |
| 原节点的执行归属 | 删除pendingOperation、generationRun、generationRecovery、workflowRecoveryResult；原节点保持原样 |
| options与图片/视频图库 | 清options、versions、imageHistory、videoHistory、兼容imageOptions/videoOptions及官方本地队列字段 |
| 历史选择与预览 | 去historySourceNodeId/historyPreviewSrc及已失效的currentImageOptionId/currentVideoOptionId |
| 当前媒体及来源 | 保留image/fullImage/video、clip、实际尺寸、generation/params、provenance/currentSourceFileId |
| flat order / 官方data.order | 沿用原边order所在层级；无order时创建本地flat order |
| 其余边字段 | 深复制handles、purpose、样式及自定义数据；去selected |

本地 `edge.path` 是导入时烘焙的绝对坐标缓存。新边清除此缓存，由生产几何重新计算；保留旧缓存会在刷新后沿旧位置画线。它是本地坐标适配，非删掉边语义。

节点、generation/params、媒体provenance和边数据全部深复制，后续编辑副本不会改变来源对象。保留当前媒体来源中的历史taskId是文件来源，不是任务执行归属；不粗删未知metadata。音频/文本没有官方CX清图库证据，本批保留其历史数据，只清执行归属。

## 验证

```bash
node --test tests/canvas-clipboard.test.cjs tests/canvas-app-persistence.test.cjs
node --check canvas-clipboard.js
node --check app.js
```

37项通过，其中新增5个纯函数与8个真实duplicate函数回归。覆盖小数/绝对坐标、组子脱离、出入边order/handles/metadata、自环、未排序哨兵、媒体图库与任务所有权、来源内容独立、旧ID媒体/生成草稿迁移、待导入原始引用保留、上传媒体不新增生成面板、一次保存、撤销/重做，以及group/multi/tool与copy/paste既有分支。持久化测试只替换DOM与异步存储边界，duplicate和新helper使用真实生产代码；旧配置回归执行node-editor.js真实defaults/countConfiguration/normalizeCountConfig/getConfig，覆盖drafts和EDITOR_DATA回退优先级。

隔离生产QA：`/src/features/canvas-clipboard/qa/main.html?session=duplicate-1005l-1`。使用自有运行时PNG，CanvasStore/LocalAssets/模板库均有独立命名，localStorage为内存；阻断真实API和外部请求。固定session支持刷新，已有项目不被seed覆盖。

验收路径：右键“右键此图 → 副本”图片，选择副本。来源为x450.75/y140.5/宽220；副本应为x770.75/y140.5、脱离父组、图库空、入边order3、出边order10，原图不变、`writesSinceBaseline:1`。在画布按Cmd-Z或点“生产撤销”，应完整恢复原图与边，`exactUndoRestored:true`、`writesSinceBaseline:2`。诊断回读实际生产图和真实CanvasStore保存调用。

主任务已在 `main.html?session=duplicate-1005l-root1` 完成正式页面CUA验收：在源图真正右键打开菜单并点击“副本”。新增节点 `60e54445-20e2-4e3c-a6e1-fb9279f033e2` 的x770.75/y140.5/宽220，parentId与parent extent均已移除；loading false、taskInfo null、history与versions均为0、historyVariantCount为1。原图未改变，当前媒体一致；出边order10、入边order3，handles及custom字段保留。诊断记录 `writesSinceBaseline:1`、完成保存数2，无模型调用或外联。

点击QA“生产撤销”（调用正式 `CanvasApp.undo`）后，副本节点及新增边均为空，`exactUndoRestored:true`、`writesSinceBaseline:2`、完成保存数3。验收截图：[正式页面右键副本](screenshots/canvas-single-duplicate-20261005.jpg)，由真实CDP全视口截图取得。

旧视频媒体/参数兼容本轮由定向生产closure、真实getConfig回归和独立交审验证，未单独CUA播放。其他节点类型及正在执行真实供应商任务的取消/迟到结果链，未作为本批模型实测范围。
