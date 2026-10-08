# Workspace 本地场景来源

`workspace-source.mjs` 将作者文档的 source 解析成既有 render graph 接受的 `{format, url, ...metadata}`。既有 API 不变：

```js
workspaceSourceResource(app, studioNodeId, state);
localWorkspaceScenes(app);
```

## 来源解析

world-asset 仍使用 `readSourceResource` 读取原 sourceBinding；empty/mesh-preset 返回 null，由场地 runtime 自行生成几何。history-world 必须通过 `assertSpaceSource` 的真实 scene metadata 校验。

可用候选顺序：

1. 本地 direct GLB/SPZ（依次取 url/format、sourceUrl/sourceFormat、source_url/source_format 每对字段；某候选没有自身格式时只从其自身扩展名推断）。
2. 官方 lod_assets 中 format=spz、level=100k 的本地条目。
3. 官方 lod_assets 中 format=spz、level=full_res 的本地条目。

LOD 顺序遵循 `docs/research/STUDIO-V3-PLAN-20261008.md` 中官方 zS 及 course Xj 的 100k 预览来源合同。当前 renderer 加载一份有现有预算限制的本地 SPZ，不新增官方 progressive/网络加载。100k 远程而 full_res 已本地化时使用后者；多条同级候选依原顺序找第一条本地可用引用。

每个候选必须通过既有 `localAssetSource`。远程 URL、带 credentials/query/hash 的模型 URL、API 路径等不得成为加载目标。跳过远程候选后可选择同一 metadata 内已本地化的候选；所有候选都不可用则抛错，绝不连接 TapNow 或 provider。

返回值独立 clone 元数据并填写 canonical format/url，保留既有 splat/world 及来源字段；不会改作者 source、节点 worldResource 或原 sourceBinding。实际文件存在性、SPZ 字节预算和解码由既有 asset-loader 继续检查。

## 场景列表一致性

`localWorkspaceScenes` 只取 type=world/outputType=world 节点，对每个 worldResource 使用同一来源解析器做可用性检查。所以只带官方本地 lod_assets 的真实 world 可选，全远程 LOD、对象、普通图片和空记录不进入场景列表。返回 threedMeta 是原 resource 的副本，选择时解析成相同的本地资源。

## 验证

```bash
node --test tests/studio-v3-workspace-source.test.cjs tests/studio-v3-space-actions.test.cjs tests/studio-v3-assets.test.cjs
```

此前聚焦测试 20/20 通过，包括 resolver 7 项：本地 direct/LOD 优先级、full_res 回退、remote-only 拒绝、无网络调用、未知level/格式及object拒绝、列表/解析一致、元数据与原绑定不变。补充 mixed direct metadata 回归以 `--test-name-pattern='mixed direct metadata'` 单独验证 1/1 通过：远程 SPZ 与本地 GLB 混在同一 metadata 时各自使用配对格式，本地 GLB 不再误作 SPZ；本地 direct 原优先顺序保持。没有在此专项执行 GPU 或真实 SPZ 文件加载；这些仍由运行时及浏览器验收覆盖。
