# 生产素材库本地容量（2026-10-05）

此前生产 `sidebars.js` 把完整媒体和文件夹分别写入 `tapnow-library`、`tapnow-folders` localStorage。高清 data URL 可能超过小容量配额，两个写入也可能只提交一半。独立 QA 使用自己的 IndexedDB preferences 并不能修复生产库。

## 当前实现

- 生产库通过既有 `CanvasStore.readRecord/writeRecord` 保存 `agent-library:personal-v1`，结构为 `{version:1,items,folders,storageRevision}`。复用既有 `documents` object store 和 IDB version 1，不新增依赖或数据库 schema。
- 素材、原始媒体字段和自建目录在一次事务中提交；提交使用库自己持有的显式 `expectedRevision`，不依赖其他 reader 推进的默认缓存。跨标签的新版本不能被旧窗口覆盖。
- 只有权威记录不存在时才读取两份旧 localStorage 源，并在初始写入前核对源仍一致。旧键不写、不删。已有权威记录不再读取旧源，localStorage 读异常不影响已有记录；首次迁移读异常、坏 JSON、坏数组或坏权威记录都会停止，不以空库替换。
- 新上传图片通过既有 `LocalAssets.put(File)` 保存 Blob，只在库里写 `asset:`。现有和节点保存时的大 data URL 可保存在 IDB 记录，未强制重写用户媒体。上传和提交失败不回收资源，避免删除仍被节点或草稿引用的 Blob。
- `CanvasLibrary.ready()` 完成后同步 `items/folders` 才可读取；ready 前 getter 明确报未就绪。库、普通资产 picker、Agent 和节点 composer 显示读取/错误状态。Agent picker 准备、恢复指纹和节点参考选择等待 ready；`runSubmission` 在创建 run/sent message 前也等待 ready，复核项目、会话、排队 item 指纹与取消状态，并核对 picker 原来源绑定。读取等待期间将原提交保留在持久队列中，加载/读取失败界面显示队列任务和真实“取消排队”按钮，不读取未就绪媒体；取消持久化后，hydration结束仍不能启动该项。失败暂停原项而不产生已开始任务；Agent referenceData 改读真实 folders，不再读旧键。
- 收藏操作在 ready 前等待并保留请求，挂起 intent 同步纳入卸载/导航保护；相应媒体按钮等待结果后绘制状态。提交失败保留内存草稿、既有记录和旧源，阻止项目跳转与页面卸载；非冲突失败可用侧栏“重试保存”或 API `retrySave()`。版本冲突进入独立状态，停止盲目重试旧 revision；侧栏与保存对话框改为“导出未保存素材”，保存按钮停用。导出为 JSON Blob，包含素材、文件夹、旧 revision 及所有 `asset:` 引用的实际本地媒体字节（mime/bytes/data URL）；读取不到任一引用时明确失败。导出不清理草稿、不解除卸载保护、不自动刷新、不自动合并或覆盖新记录。界面明确要求确认本机导出文件存在后，再手动刷新读取当前权威库。当前没有自动导入此草稿包的入口。
- `flush()` 等待 hydration、当前资源迁移和保存队列，包括等待期间追加的写入。资源迁移沿用现有媒体白名单和未解析引用保留规则，提交前同时验证内存内容与 IDB 版本，不再依赖 Web Locks 可用性。

同步消费者清点：`canvas-commands.js` 资产 picker；`agent-client.js` referenceData/恢复版本/Agent adapter；`src/features/agent-apps/library-picker-runtime.mjs`；`node-editor.js` config/reference/prompt/picker；`image-history-ui.mjs`、`src/features/video-history/ui.mjs`、`src/features/video-tools/entry.js`、`media-preview-ui.mjs` 的收藏状态，以及画布菜单和节点已有收藏渲染。无数据库适配器的独立旧宿主保持只读，并提示接线缺失。

## 定向验证

`tests/library-capacity.test.cjs` 首批9项通过；交叉审阅追加 pre-ready 卸载、CAS 冲突完整字节导出两项并定向通过。覆盖 6MB 旧媒体迁移与刷新、localStorage 读异常与坏源不初始化空库、已有坏记录不回退旧源、ready 前收藏、两标签 CAS、失败草稿显式 `retrySave` 保留 ID、初始迁移源变化、映射期间新编辑和缺持久化适配器。

容量/素材往返/Agent picker/媒体历史/媒体预览组合曾运行 62 项全通过；容量/生命周期/资源迁移组合 25 项全通过，后两类 fixture 已改为 record authority。随后扩大到相关 node-editor/sidebar 82 项：77 通过，2 个新增 ready 接线导致的 sidebar fixture 失败已修复并单独重跑六项全部通过。剩余两项 subject fixture 未注入既有 `readySubjects`、一项 node-editor footer fixture 未注入既有 `modelLabel`；本批没有修改这两个生产实现来适配旧 fixture。

`tests/agent-library-submission-ready.test.cjs` 新增三项通过：真实hydration等待期间保留持久队列、读取失败/换项目/换会话/取消/换源不beginRun、picker绑定在beginRun前确认。`tests/library-template-lifecycle.test.cjs` 追加真实保存对话框冲突回归一项通过：保存按钮停用、导出/保留关闭入口存在、旧权威与当前媒体草稿保留、侧栏不再显示误导性重试。交叉审阅后仅运行这六项新场景，未重复82组合。

后续复核补实际加载队列按钮取消一项，以及8MiB data URL报告摘要一项，均定向通过。QA报告仅展示 `data:<mime>;base64,[N characters]`，不把原图字节写进DOM；原source、baseline与内部字段/SHA比较保持完整。

修改的生产文件与 QA 脚本语法检查、`git diff --check` 通过。以上是定向自动检查，不代表实际浏览器媒体验收。

## 可复验入口

```sh
node src/features/library-asset-roundtrip/qa/generate-page.cjs
```

在本机项目服务打开：

```text
/src/features/library-asset-roundtrip/qa/roundtrip.html?session=<fresh-session>&capacity=1
```

沿用正式 production scripts 和独立 session 数据库，不读写、清理用户 origin localStorage。`capacity=1` 下仅对 QA 替代 preferences 的两旧库键强制 `QuotaExceededError` 并计数。

1. 点“准备容量原图验收”，创建带明确 LOCAL CAPACITY 标记的 2048×1152 随机 PNG，原图以大 data URL 进入实际源节点，压缩后要求大于 5MiB。素材是本地合成文件，不是模型生成。
2. 使用实际节点“保存到素材库”对话框，随后关闭库；画布空白右键“添加资产”，从正式 picker 点击同名素材。
3. 点“核对保存 / picker / 刷新”。除既有像素、源字段、SHA 和文档隔离检查外，要求 `authorityExact:true`（真实 CanvasStore 记录包含保存项）和 `libraryWriteAttempts:0`。
4. 刷新同一 session 再核对；可按既有“捕获下一次真实下载”验证实际 PNG 字节和解码尺寸。

Computer Use 与实际 IDB/媒体回读由主任务追加，本子任务未操作浏览器。IDB 仍受浏览器可用磁盘和 origin 配额限制，本批不包含垃圾回收、容量仪表盘、云同步或自动冲突合并。

## 主线程 CUA 容量验收

已实际用生产保存对话框保存 6,607,120 bytes / 2048×1152 本地合成 PNG，再从空白右键“添加资产”的正式 picker 重插。原 SHA256 为 `0e9a5c34a7274b5643bb6bd4ec3fb6aed93a20d91d41a81c63064677fa1bdb16`；源坐标 54015.125 / -4155.375 不漂移，picker 128×72、画布 2048×1152。权威记录、插入内容、来源与原 SHA 均 true，两次刷新后仍 true；两旧 localStorage 键写入 0。

本次未测下载，不继承另一素材往返验收的下载结论。上述结果证明实际权威记录和生产 picker 路径的容量 / 持久化行为。[完整本批记录](LOCAL-VIDEO-TOOLS-STORAGE-BRAND-20261005.md)。
