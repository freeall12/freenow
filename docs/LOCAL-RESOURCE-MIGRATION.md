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

提示词、文字、标识、原始 provenance、信息页 URL 不改写。此模块不解析 HTML、脚本、CSS 或字符串化文档，也不迁移 library/subject/template/Agent 记录；需要各自类型化适配。无法从字段名推断的资源不会被盲目替换。

## 接线与失败规则

1. 启动先完成构建，客户端严格获取并验证索引。
2. `CanvasStore.load()` 后、画布 hydrate/媒体渲染前迁移完整快照。异步读取期间已有本地编辑时不得用旧快照覆盖。
3. `changed > 0` 时，通过 CanvasStore 原有 revision 比较保存完整 `result.snapshot`；保存成功前不显示持久化完成。冲突重新读取并重算，保留当前编辑，不能绕过 CAS。
4. `unresolved` 展示字段级待导入记录，不公开来源/提示词。未解决记录不删除，不能把“已屏蔽网络”当作素材可用。
5. 部分映射成功可保存为部分迁移，但必须保留未解决计数；不要写全量完成标记。
6. 迁移可能改变媒体签名。启动中的生成恢复/任务运行应与迁移协调，不能伪造更新 recovery.signature 或原任务身份来恢复已经变化的输入。
7. HTML/widget 的宿主媒体绑定、共享库、生成历史、素材实际渲染和正式产品命名属于后续接线责任；本模块通过单测不代表整个本地化目标完成。

## 验证范围

专项回归覆盖纯迁移保留性、重复运行、查询参数精确性、字段级诊断、Fabric/片场/撤销历史、合法空表、非法表、文件校验、目录穿越、符号链接越界及构建失败时不覆盖旧索引。使用临时合成素材，不触碰真实用户存储。
