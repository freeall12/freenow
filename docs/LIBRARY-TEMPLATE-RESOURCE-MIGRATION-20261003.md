# 素材库与模板的权威记录迁移

本轮只修改 `sidebars.js`、`templates-ui.js` 及专项测试。复用 `src/features/local-resource-migration/snapshot.mjs` 的纯映射器与 `canvas-load.mjs` 的同源索引读取器；不下载官方资源、不清理旧存储、不调用生成服务。索引来自 `/assets/local-resource-index.json`，来源 URL 的完整 UTF-8 SHA-256 必须精确命中，映射目标只能是索引中的本地 `/assets/` 文件。

## 入口

- 素材库 → 添加素材（现有 plus SVG 按钮）→「迁移本地资源」。结果在当前抽屉显示，抽屉关闭后不会被异步结果重新打开。
- 模板 →「我的模板」→「迁移本地资源」。公共模板目录不修改；个人模板封面、完整节点图、Fabric 图片图层、历史候选与生成引用统一迁移。
- `await CanvasLibrary.migrateResources()`、`await TemplateAPI.migrateResources()` 返回 `{status,persisted,summary,diagnostics}`；`migrationStatus()` 读取最近一次结果。`CanvasLibrary.flush()` 等待包括等待期间新排队的素材库写入。
- 专项验证可传 `{index,hashSource,migrate}` 或 `{indexState:{state,index}}`，生产菜单使用同源索引与默认哈希。

`ready` 表示本次快照无待导入引用，`pending_import` 表示未知/临时资源仍保留。只有真正提交才有 `persisted:true`；已经全为本地引用的重复检查不写盘。诊断只含数组位置与错误码，不含原 URL、签名、名称、prompt 或 provenance。仅留有 seed node ID 的旧视频会先读取实际后备视频来源，成功映射后把本地 video 引用提交到同一权威记录；预览和插入检查也使用实际后备来源。库条目的 `mediaKey` 保留原身份；收藏判断同时匹配已迁移的实际媒体引用，避免画布与素材库同时迁移后收藏丢失。

## 并发与保存失败

素材库仍以现有 `tapnow-library` localStorage 条目为权威，不重新命名或转换已有格式。生产浏览器支持 Web Locks 时，普通上传/收藏/重命名与迁移均使用同一个写锁；每次普通写入捕获自身快照并排队，锁内比较权威条目的原始字串再写。迁移映射期间有本页修改或其他窗口修改，返回 `local_edits`，不会替换缓存或权威记录。迁移仅更新素材条目，不写文件夹。

不支持 Web Locks 的旧环境保留原普通写入方式，显式迁移返回 `lock_unavailable`，避免把非原子的跨窗口写入当成安全迁移。外部绕过产品写锁直接修改 localStorage 的脚本不属于合作写入协议；正常页面的存储版本比较仍拒绝已观察到的外部变更。

模板继续使用原 IndexedDB `templates` object store。迁移在同一个读写事务内 `getAll` 比较完整原记录，确认没有其他窗口的变更后才批量 `put`，提交后才替换缓存。普通模板更新也在同一个事务内比较目标原记录，避免已捕获的旧模板覆盖刚完成的迁移或其他窗口的新版本。本页在异步映射期间保存新模板时，迁移暂停。

quota、事务 abort、索引缺失/不可读/格式无效不会产生成功报告；已存权威记录与原引用保留，迁移缓存也不提前替换。失败后可显式重试。普通素材库保存失败会提示并保留未保存状态，保存对话框不会关闭，重复保存不会追加重复条目。未成功读取的素材库拒绝写回空数组。项目切换/页面离开会保护排队写入与未保存修改。

## 运行期读取边界

图片、模板视频/封面不会把已识别 TapNow 官方域或其子域赋给 `src`；`asset:` 先通过 LocalAssets 解析。素材预览/插入及模板图使用拒绝尚未迁移的官方媒体引用。未知引用留在权威记录并报告待导入，不能通过“迁移成功”伪装成可用文件。prompt、说明、provenance 内的 URL 不修改，也不作为媒体读取。

这些入口的来源检查覆盖直接地址；主页面严格 CSP 的全局网络兜底由主任务独立负责。跨源跳转及其他模块的动态加载不由本专项单独证明。

## 验证与 Computer Use

新增五项跨两个真实生产入口的集中回归：完整提交/幂等/unknown；quota 与 IDB abort 重试；本页并发编辑；其他窗口版本变化；官方 `src`/预览/插入阻断及索引/锁缺失。使用 JSDOM 与可提交/中断的 IDB 双胞胎，不把它当成浏览器、GPU 或真实下载验收。

```sh
node --test tests/library-template-resource-migration.test.cjs tests/library-template-lifecycle.test.cjs tests/templates.test.cjs
node --check sidebars.js
node --check templates-ui.js
```

主任务 CUA 可从上述两个菜单进入，观察 ready/pending_import，reload 后确认权威记录仍为本地路径；在第二个窗口改名后再迁移应显示 local_edits；quota 故障时应保留抽屉/保存对话框与原媒体引用。应使用隔离数据 fixture，不覆盖现有用户素材。
