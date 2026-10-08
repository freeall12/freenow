# 场地来源与房间编辑

`space-actions.mjs` 提供同步纯 reducer，复用已有 worldSpace.source/roomConfig，不增加 schema 或持久化层。

```js
const result = reduceSpaceAction(state, {
  type: 'set-space-source', source: {kind: 'mesh-preset', preset: 'room'}
}, {now: Date.now(), readonly: false, busy: false});

if (result.ok && result.changed) {
  history.transact(result.lane, result.historyLabel, () => result.state, result.scope);
}
```

## 输入与输出

| 输入 | 合同 |
| --- | --- |
| `{type: 'set-space-source', source}` | 验证并设置来源；roomConfig 保留 |
| `{type: 'update-room', patch}` | patch 仅 width/depth/height/trackingGuides；nested guides 合并当前值 |
| now | 有限非负时间戳；用于调用验证，不改 setup/entity 时间戳 |
| readonly/busy | 返回 ok=false、changed=false、原 state 及对应 reason；不改场地 |

成功结果为 `{ok, changed, state, lane, scope, historyLabel}`。lane 始终为 `setupLane(activeSetupId)`；例如 `setup:setup:state-1`，baseline 为 `setup:setup-default`。scope 为项目既有 `{kind: 'world-space'}`。label 是“切换场地”或“修改房间”。无实际变化返回同一个原 state，宿主不应生成 history 或 dirty/save。非法字段、尺寸、非 JSON 或缺失资源抛 `StudioDomainError`。

修改只替换 worldSpace.source 或 roomConfig，保留 setups、entities、active IDs、environment 等数据，也不写外层存储对象的 `sourceBinding`。因此选择 `{kind: 'world-asset'}` 仍回到原绑定资源，不把当前选择当作新原始来源。

## 校验范围

`assertRoomConfig(config)` 和 `assertSpaceSource(source)` 均可单独调用，并返回原对象。宽深 1..100m、高 2..20m；guides enabled/lineMarkers 是 boolean，mode=white/standard/calibration，spacingMeters=.25/.5/1/2。严格拒绝未知字段，绝不把非法值静默夹到边界。

来源允许：

| source | 可用字段 |
| --- | --- |
| empty/world-asset | 只有 kind |
| mesh-preset | kind + preset='room' |
| history-world | kind + threedMeta，可选 historyAssetId/label/thumbnailSrc |

history-world 需真实 GLB/SPZ 资源字段，接受官方 `source_url/source_format`、本地 `url/format` 或 `sourceUrl/sourceFormat`。省略格式时必须能从 URL 扩展名判断。也接受官方 `lod_assets` 中 format=spz、level=100k/full_res 且 URL 非空的资源。object/world-object 或 imported_asset_kind=object/outputType=asset 明确拒绝；仅有缩略图、任务状态或空 metadata 不能冒充场景。

来源校验仅证明 metadata 存在可用加载字段，不检查磁盘、网络或 provider 任务；加载失败由资源适配器呈现。scene picker 和搜索由宿主处理，模块不获取生成历史。

## 连续交互、权限与日志

房间尺寸 scrub 的 begin/preview/commit/cancel 由宿主使用一条当前 setup history 事务处理。连续 preview 可反复调用 update-room 合并 patch；取消应恢复整个事务初始 state。宿主独立负责 active setup/stage/source identity fence、owner 读写权限、busy 判定、保存与 UI 回焦。

模块没有网络、文件写入、隐式 ID 或内部日志。宿主 history 使用返回 lane/scope/historyLabel 记录可审计变更；导航 pan/rotation/zoom/section 不通过此 reducer。

## 验证

`node --test tests/studio-v3-room-scene.test.cjs tests/studio-v3-space-actions.test.cjs`：13/13 通过。来源及房间专项覆盖只读/busy、严尺寸与字段、nested merge/no-op、原 state 不变、来源 metadata、不改其他 setup/原绑定，以及当前 setup lane 两步 undo/redo 精确恢复。

宿主连续 scrub、取消、保存回读和跨来源生命周期仍需在浏览器验收；不能把纯 reducer 测试当作这些行为已完成的证据。
