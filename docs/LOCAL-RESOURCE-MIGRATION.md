# 旧资源精确迁移底层

此模块构建本地资源索引、迁移克隆的画布快照。不读取浏览器数据库，不自动下载远端文件，不保存用户记录。存储接线必须单独完成。

## 构建索引

```bash
node src/features/local-resource-migration/cli.cjs /absolute/path/to/canvas-replica
node --test tests/local-resource-migration*.test.cjs
```

CLI 只发布到项目 `assets/local-resource-index.json`，该文件须列入 `.gitignore`。使用临时文件和原子 rename；原始来源 URL 不进入索引、日志或专项文档。运行时通过 `/assets/local-resource-index.json` 读取。

服务端也可直接调用：

```js
const {writeLocalResourceIndex} = require('./src/features/local-resource-migration/cli.cjs');
const result = await writeLocalResourceIndex({root: projectRoot});
if (!result.published) throw Error('本地资源映射需要修复');
```

`build-index.cjs` 导出 `buildLocalResourceIndex({root})`，只返回 `{index, stats, diagnostics}`，不写文件。白名单为 `agent-reference-assets.json`、`agent-attachment-assets.json`、`playlist-intro-assets.json`、`stage-environment-assets.json`、`agent-manager-assets.json`、`stage-library-catalog.json` 及其 `stage-library-assets.json` 校验资料。不会遍历其他捕获文件。

每个有效来源按**完整原字符串的 UTF-8 SHA-256**索引；查询参数不删除、URL 不重新规范化。每个目标文件检查路径边界、存在性、实际 SHA-256 和声明的字节数。声明 SHA-256 时必须一致；未声明时计算实际 SHA-256，并计入 `computedChecksums`，不宣称已与远端原件比对。片场 catalog 必须有对应声明校验值。同一来源的不同本地副本仅在实际内容哈希相同时合并，确定性选择字典序最小路径。

全部私有 manifest 缺失是公开安装的正常状态，生成合法空表。已存在的资料格式错误、校验不符、目标缺失或来源冲突返回诊断并禁止发布；CLI 退出码为 1。失败时保留已有索引，调用方必须停止接线成功流程，不能继续使用旧索引声称本轮校验通过。

## 索引合同

```js
{
  version: 1,
  algorithm: 'sha256-exact-utf8',
  entries: {
    '<64 lowercase hex source hash>': {
      ref: '/assets/example.png',
      sha256: '<64 lowercase hex file hash>',
      bytes: 123
    }
  }
}
```

`index-format.mjs` 导出 `validateResourceIndex(index)`、`hashSource(string)`、`isStaticAssetRef(string)`。验证拒绝缺失表、非法算法、额外字段及越界资源路径。不得把 fetch 404、无效 JSON 或校验异常转换为空表。合法空表只能表示没有可用映射，不能表示旧资源都已本地化。

哈希索引减少原 URL 暴露，但哈希不是加密，索引依然属于本机私有构建产物。

## 纯快照迁移合同

```js
import {migrateCanvasSnapshot} from './src/features/local-resource-migration/snapshot.mjs';
const result = await migrateCanvasSnapshot(saved, {index});
// 测试或其他受信运行时可注入 hashSource: async string => lowercaseSha256。
```

返回：

```js
{
  snapshot, // structuredClone 后的快照，原输入不变
  changes: [{path, sourceHash, ref}],
  unresolved: [{path, sourceHash, code}],
  summary: {references, changed, unresolved, alreadyLocal}
}
```

`path` 使用字段名和数组下标，不包含节点 ID、提示词或来源 URL。未知来源保持原值，`code: 'local_import_required'`；`blob:` 保持原值但标记 `transient_blob`，因为它不能证明跨刷新持久性。已识别的 `asset:`、媒体 data URL、静态 assets 路径及精确 `/api/generation/media/<UUIDv4>` 计入 `alreadyLocal`。这个统计只证明引用形式，本地文件、IndexedDB Blob、生成资源实际可读性仍需各读取方验证。结果没有“全部资源成功”标志。

覆盖：

- 当前节点与 `history/future` 中的节点副本；保留 revision、项目、视图、边、位置及未知字段。
- 明确主媒体字段、`versions/options`、图片/视频历史 options、playlist clips。
- Fabric `editorDoc.canvas` 的图片 `src`、嵌套对象、背景/覆盖图片、图片 clipPath。
- 片场模型及 setup/baseline/keyframe 中的模型源，环境资源、sceneAsset、全景会话和编辑记录。
- `studioV2.asset`、worldResource 主资源/缩略图及已知世界 splat/mesh/pano 字段。
- `generation.refs/inputs/references` 中明确资源位置。

提示词、文字、标识、原始 provenance、信息页 URL 不改写。此模块不解析 HTML、脚本、CSS、字符串化文档或 Agent 会话；需要各自类型化适配。无法从字段名推断的资源不会被盲目替换。

## 素材库、主体、模板与生成历史

以下函数全部从 `snapshot.mjs` 导出，异步参数为 `(value, {index, hashSource?})`，返回同一 `{snapshot, changes, unresolved, summary}` 合同。原输入不变；shape 错误、缺索引或索引无效均拒绝，不降级为“空资源成功”。

| 函数 | 输入结构 | 明确迁移字段 |
|---|---|---|
| `migrateLibrarySnapshot` | 素材 items 数组，或 `{items, folders?, ...}` envelope | 每个素材的 `image/fullImage/video/audio/poster/thumbnail` |
| `migrateSubjectSnapshot` | 完整 `{version:1, libraryKey, subjects, ...}` 权威记录 | 媒体型主体 assets 的 `url` 和主媒体字段；text assets 保持原样 |
| `migrateTemplateSnapshot` | 单个 IndexedDB 模板 row，或 row 数组；row 必须含 `graph:{version:1,nodes,edges,...}` | 封面 `image/video`；graph 节点使用完整画布资源 visitor |
| `migrateGenerationHistorySnapshot` | 完整 `{version:1, projectId, receipts, rows, ...}` 权威记录 | 媒体型 receipt outputs 的 `url/sourceUrl`、媒体别名和世界 splat/mesh/pano；rows 的 `source/mediaRef/thumbnailRef` 与模型 `worldPatch` |

主体诊断示例为 `$.subjects[0].assets[1].url`，模板集合示例为 `$[0].graph.nodes[1].image`，历史示例为 `$.receipts[0].outputs[1].world.assets.mesh.hqMeshUrl`。动态 splat resolution 名称使用数字下标，避免把任意私有 key 放入诊断。

所有库的 IDs、文本、操作回执、删除时间、未知扩展字段、provenance 保留。素材库 `mediaKey` 保留，因为它是既有收藏身份；接线方须验证基于旧 URL 的收藏匹配，不要把键值保存成功当作功能验证。模板 createdAt/updatedAt、边、参数和布局不重写。生成历史 status、archiveStatus、archiveError、application、taskId、sourceFileId 与 projectId 不改，绝不因为找到映射就改成归档成功。

`outputs[].sourceUrl` 是现有输出校验、原结果重试使用的媒体 descriptor，所以迁移；`provenance.sourceUrl`、`worldResource.sourceUrl` 的信息性原始来源和 `world.marbleUrl` 保持原样。文本型 outputs 的 `url/text` 不被作为媒体改写。

对应权威边界：素材库当前 `tapnow-library` localStorage items；主体使用 `agent-subject-library:<base>` IndexedDB；模板使用独立 templates object store；历史使用 `agent-generation-history:<projectId>` record。纯函数不触碰这些存储。调用方应在读取后、媒体展示前迁移，使用存储的 revision/CAS 与缓存 guard 保存完整快照，保存失败时保留原权威记录和迁移诊断。

### 历史兼容与归档

精确索引目标是静态 `/assets/...`，并非“已在本地素材 Blob 库归档”。历史 `archive.node()` 对模型要求 `asset:`。普通图片、视频、音频和 GLB 在纯迁移后，可由接线将**本轮 changes 所证明的静态资源**按索引校验 SHA-256/bytes 后读取为 Blob 并存入 LocalAssets，将对应明确字段改成持久 `asset:`。不能扩大任意 URL/路径白名单；任意既有 `/assets/...` 也不能自动当成已经过本轮索引证明的资源。

这一步仍要保持关联字段一致：模型 row.mediaRef 与 worldPatch.worldResource.url；同一 sourceHash 在本次迁移复用同一 asset 引用，避免同一模型被保存成两个不同 asset 身份。输出 `sourceUrl` 必须一起处理，因为现有可读性校验会检查它。迁移不应自动 resubmit 原任务。归档状态只能由现有实际解码/归档流程确认；读取或存储失败保留旧记录并显示修复状态。

SPZ/world 是独立边界：`outputSnapshot()` 的 world 嵌套资源目前只接受受信生成路由或原公开 HTTPS，既不接受静态路径，也不接受 `asset:`；archive 又要求保存 world metadata 与原 output metadata 一致。当前默认 `world-node/resource.materialize()` 本身只支持 GLB。直接把 SPZ 世界资源全部转为 asset 会破坏归档、重试及节点恢复校验。此批接线应保持该世界的一致性组原样并显示明确待修复/不支持归档状态，不能以零 unresolved 声称可恢复。完整支持需要独立的受信本地 world 校验和 reader adapter，或者恢复原任务已封存的 `/api/generation/media/...` 引用，不能直接放开现有 URL 校验白名单。

## 接线与失败规则

1. 启动先完成构建，客户端严格获取并验证索引。
2. `CanvasStore.load()` 后、画布 hydrate/媒体渲染前迁移完整快照。异步读取期间已有本地编辑时不得用旧快照覆盖。
3. `changed > 0` 时，通过 CanvasStore 原有 revision 比较保存完整 `result.snapshot`；保存成功前不显示持久化完成。冲突重新读取并重算，保留当前编辑，不能绕过 CAS。
4. `unresolved` 展示字段级待导入记录，不公开来源/提示词。未解决记录不删除，不能把“已屏蔽网络”当作素材可用。
5. 部分映射成功可保存为部分迁移，但必须保留未解决计数；不要写全量完成标记。
6. 迁移可能改变媒体签名。启动中的生成恢复/任务运行应与迁移协调，不能伪造更新 recovery.signature 或原任务身份来恢复已经变化的输入。
7. HTML/widget 的宿主媒体绑定、共享库与生成历史的权威存储接线、素材实际渲染和正式产品命名属于其他接线责任；本模块通过单测不代表整个本地化目标完成。

## 验证范围

专项回归覆盖纯迁移保留性、重复运行、查询参数精确性、字段级诊断、Fabric/片场/撤销历史、四类共享记录、合法空表、非法表、文件校验、目录穿越、符号链接越界及构建失败时不覆盖旧索引。使用临时合成素材，不触碰真实用户存储。
