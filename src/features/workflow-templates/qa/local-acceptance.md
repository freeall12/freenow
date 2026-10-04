# 本地工作流模板验收

数据包：公开列表的 10 份模板，72 个节点、112 条连线。原始公开响应、精确来源映射和下载记录位于被忽略的 `reference/`；运行时只读取 `resources/templates.json` 和本地 `assets/`。初始编译清单 173,691 bytes；190 个图/视频/封面/版本资源字段均对应实际存在的本地文件，没有原站媒体地址或用户/组织/任务绑定。

已验证：真实数据的完整节点/连线数、提示词和模型不变、输出版本数量不变；精确相对坐标、ID/内部引用重映射；10 个工作流均为有向无环图。公开模板导入只调用一次 `CanvasApp.insertGraph`，沿用现有单次撤销和持久化。预览/应用不调用模型或原站使用记录接口。

针对性回归：

```sh
node --test tests/workflow-template-qa.test.cjs tests/workflow-templates.test.cjs tests/workflow-template-ui.test.cjs tests/templates.test.cjs tests/library-template-lifecycle.test.cjs tests/library-template-resource-migration.test.cjs
```

35 项通过，覆盖编译安全边界、精确几何、导入重映射、跨项目拒绝、卡片查看不冒泡应用、搜索 blur 保留 click 目标、个人应用单次执行、导航保护、关闭后焦点回到实际点击来源/重建卡片/当前标签、旧个人模板存储迁移/冲突/读取失败、分类与搜索相交及未知历史分类、正式 QA 会话隔离、本地读取/网络写入边界、存储额度失败闭锁和原始生产入口保留。最新日志为 `focused-tests-20261005.log`。

分类白名单来自 2026-10-05 无认证公开 GET `/api/canvas/v1/official-template-categories?template_type=executable`，原始响应在 `reference/public-workflow-categories-20261005.json`。8 项为 Seedance 2.0、广告、电商、影视、生活、工具、有趣、ACG；抽屉分类选择和模板库侧栏均使用真实 ID，分类与搜索取交集。模板保留公开 `category_ids` 中合法 UUID；一个历史 ID 已不在当前分类响应中，不补造名称，该模板仍可在“全部”看到。旧清单缺省 `categoryIds` 仍兼容。

官方 `EW` 详情组件原样展示 `created_at`，`SW` 仅本地化标题/说明，没有日期 formatter。按本地中文习惯，展示层用 `zh-CN` 和浏览器本地时区显示年月日及秒，`time.datetime` 保留标准时间；原始 `createdAt` 不变。公开 `workflow` 标签显示为“工作流”，其余标签原样保留。macOS 点击按钮可能不改变 `activeElement`，所以预览入口显式记录 `event.currentTarget`，关闭后再解析当前抽屉的有效来源。

主任务浏览器验收路径：

1. 左侧模板 → 搜索 `Tech` → hover 显示“查看 / 应用”。
2. 查看 → 详情显示完整日期、标签、说明 → 返回列表 → 搜索其他项 → 关闭，焦点回原模板卡。
3. 标题/应用 → 新分组含图与视频及连线 → 右键“撤销”整组移除 → 重做整组恢复。
4. 浏览全部 → 10 项列表 → 我的模板 / 最近使用 / 搜索 / 创建选中分组。
5. 应用复杂 29 节点电商模板 → 检查节点、文本、版本、连线 → 刷新保留 → 撤销。

卡片和缩略图使用原生 lazy loading，不预加载模板图中的 72 个节点媒体。`thumbnail` 可指向经核对的本地封面派生缩略图，详情仍使用原图。下节记录主任务实际浏览器结果，静态/回归检查不替代浏览器验收。

## 正式入口隔离 QA

```sh
node src/features/workflow-templates/qa/generate-main.cjs
```

访问 `/src/features/workflow-templates/qa/main.html?session=workflow-template-1005`。不同 `session` 使用独立 CanvasStore、LocalAssets、TemplateAPI 数据库和 localStorage/Web Locks 命名空间；省略 session 时页面自动生成，刷新保持同一会话。画布从空 defaults 启动，保持生产 `app.js`、`sidebars.js`、`templates-ui.js` 和 `CanvasStore`。所有查看、应用、撤销、重做和保存继续使用正式操作。

右上 `#workflow-template-qa-receipt` 只观察真实节点/连线/小数坐标/历史，并在正式持久写入完成后回读独立库；没有替代正式操作的 QA 按钮。GET/HEAD 本地读取正常，模型/服务写请求和外部请求被显式拒绝。`WorkflowTemplateMainQA.diagnostics()`、`snapshot()`、`read()` 提供同一只读证据。

整个隔离初始化都在统一失败处理内；数据库名称先设置为独立会话，再访问 localStorage/fetch/Web Locks 并预检偏好写入。发生 `QuotaExceededError`、storage getter 的 `SecurityError`、storage/locks 不可重定义等错误时，页面显示“隔离 QA 初始化失败，已停止验收”和 `ready:false` 回执，通过本 QA 页附加 `script-src 'none'` CSP 停止后续生产脚本并拒绝请求。即使部分包装已安装也不会继续生产脚本；旧数据不删除，不能把这类失败页面当作应用验收结果。

## 最近使用持久化补充验收

公共应用及 `TemplateAPI.use()` 个人应用均在成功插入分组后记录最近使用，等待存储提交再完成 UI 操作。沿用 TemplateAPI 数据库命名空间，单独使用 `${TEMPLATE_DB_NAME}:recent`（普通页面为 `tapnow-local-templates:recent`），不会写 localStorage 或改动个人模板数据库版本/记录。仅存最多 30 个 `{id, kind, usedAt}`，以公共/个人来源区分同名 ID，事务内读取后去重写入；刷新、关闭重开读取已提交列表，已删除模板不展示。

最近使用写入失败时，画布保持已成功插入的分组，显示“模板已应用，但最近使用记录未保存：…”并返回该分组，不重插图。读取失败也显式提示。此次专项命令与日志：

```sh
node --test tests/workflow-template-recent.test.cjs tests/workflow-template-qa.test.cjs tests/workflow-template-ui.test.cjs
```

17 项通过，含最近使用跨存储重开恢复、会话隔离、30 条上限、写入失败保留已提交记录、公/个人应用失败提示且插入一次、图库关闭重开恢复真实来源，所有初始化异常闭锁回归，以及个人应用等待存储就绪后重新检查项目/来源有效性，销毁图库或切换项目后不迟到插图。开发机日志为 `recent-tests-20261005.log`（不提交）。前批 35 项证据仍有效，本次未重复全套。

## 主任务 Computer Use 结果

2026-10-05，隔离会话 `workflow-template-1005-local`。实际卡片标题应用Tech后3节点/1边，撤销0/0，重做节点ID/精确坐标/边完全相同。复杂电商模板另插30节点（含外层组）/51边，合计33/52；刷新所有节点和连线一致，一次撤销回3/1。本地PNG解码5504×3072，正式视频预览1280×720、5.06195秒、readyState4并播放到ended。

电商+Tech筛选、工具空分类、搜索后的首次查看、中文日期与ISO datetime、Escape回查看按钮和Close回浏览全部按钮均通过。真实创建个人模板“本机产品工作流”，更新后公共/个人各应用一次；刷新最近使用仍按顺序显示两项，合计9节点/3边。回执externalAttempts及blockedNetworkWrites始终为空。

localhost原有localStorage配额已满时打开另一个新会话，实际显示可见初始化失败/ready:false/QuotaExceededError，页面添加 `script-src 'none'`，正式脚本未接管静态入口。没有清理任何旧数据；正常功能验证在独立127.0.0.1 origin中完成。两者不是可互通的用户数据入口。

[完整截图与本批范围](../../../../docs/LOCAL-WORKFLOW-AND-NATIVE-AUDIO-20261005.md)记录公开媒体、来源和剩余边界。未使用真实模型Key，公共模板应用不产生外部写入。

主任务已生成 10 张 640px WebP 本地派生封面，清单写入 `thumbnail`。列表封面总计 331,824 bytes，原图 95,114,405 bytes 保留给详情预览。重新编译清单后必须再次执行：

```sh
node scripts/build-workflow-template-thumbnails.cjs
```

该脚本只使用现有 FFmpeg，不新增依赖。QA 入口实时读取最新本地清单，生成入口不会覆盖模板数据或缩略图。
