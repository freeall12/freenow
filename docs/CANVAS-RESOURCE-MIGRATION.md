# 画布资源迁移读取接线

2026-10-03，本页读取 IndexedDB 的完整画布快照后、hydrate 前，接入 [纯资源迁移合同](LOCAL-RESOURCE-MIGRATION.md)。现有默认 `canvas` 与 `project:<ID>` 在各自实际打开时迁移，不扫描或清理未打开的用户项目。

## 读取流程

1. 原有 `CanvasStore.load()` 读取并记录本页版本；先验证图格式。
2. `canvas-load.mjs` 同源读取 `/assets/local-resource-index.json`，禁止重定向、使用 no-store，并校验索引结构。
3. 只按完整来源 UTF-8 SHA-256 索引替换模块明确支持的资源位置；当前图、undo/redo 等随完整快照迁移。原输入不改动，项目名称、时间、视口、边、结构和未知字段保持。
4. 有替换才保存；使用原 CAS 与 readwrite 事务。保存提交后才继续 hydrate 映射后的图。无替换不会增版本。
5. CAS 冲突重新读取最新图并重算，最多重读两次。不会把旧图节点或标题覆盖到其他窗口的新图。重复冲突、重读错误与保存错误均向原加载失败保护传播。

`CanvasStore.save(state,id,{preserveSnapshot:true,beforeCommit})` 是迁移专用的可选保护：禁止以尚未hydrate的seed图补元数据；`beforeCommit` 必须同步返回 true，在事务内真正 put 前再次检查本地编辑状态。普通模块原有两参数保存行为保持。

## 状态与隐私

404 为 `index_missing`，503或网络读取错误为 `index_unavailable`，无效JSON/schema为 `index_invalid`。这些状态没有有效 index，**不构造合法空表，也不标记资源迁移完成**。原图保留，页面显示待修复提示。公开安装经构建得到的合法空表可以使用；其中无法匹配的旧媒体仍保持 `pending_import`。

未知来源及临时 `blob:` 不替换或删除；页面展示未解决计数及「查看待修复位置」。位置使用节点序号、撤销/重做历史序号及固定媒体标签，不显示原URL、签名、提示词、节点ID或内容。对外 `CanvasApp.resourceMigrationStatus()` 只给状态、提交标记、统计和这些安全位置，不能据此声明所有资源已本地化。

若异步迁移或等待提交时出现本地修改，事务不写；本次恢复停止并保持内存中的修改，自动保存保持阻断，避免已有图被早期新节点替换。读取与保存失败时同时显示迁移未完成和已有存储保护提示。

## 任务边界

生成任务身份、requestId、provenance 和 `generationRecovery.signature` 按纯迁移合同原样保留。不伪造签名、不提交或重复发出生成请求。媒体引用改变可能使旧恢复基线签名失效；现有hydrate的孤儿清理会拒绝该失效基线。任务恢复/输入重新确认仍由既有生成恢复界面负责，本迁移不宣称旧任务可自动继续。

只覆盖纯模块明确支持的资源槽位。不迁移Agent会话、主体库、模板、shared apps或任意HTML/CSS字符串；不增加依赖、schema、清存储或全局正则替换。未知媒体的实际导入和最终网络边界仍需后续验收。

## 验证

```sh
node --test tests/canvas-resource-migration.test.cjs tests/local-resource-migration.test.cjs tests/local-resource-migration-index.test.cjs
node --test tests/canvas-projects.test.cjs tests/canvas-storage-reliability.test.cjs tests/canvas-app-persistence.test.cjs tests/canvas-navigation.test.cjs
```

迁移接线13项与纯模块/索引7项通过；既有画布相关62项通过。定向回归覆盖精确来源、标题/浮点视口/历史保留、空合法表与404区别、安全字段诊断、CAS重读、冲突上限、迟到编辑、实际IndexedDB put前阻挡，以及生产app hydrate不覆盖或自动保存早期本地编辑。本轮没有Computer Use、真实用户数据迁移验收或提交。
