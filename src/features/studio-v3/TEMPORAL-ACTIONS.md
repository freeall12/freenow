# 独立状态的时间作者领域

`temporal-actions.mjs` 负责真实关键帧、通道与曲线约束的持久数据修改，以及 base / selected-key / time-key 编辑目标和新建关键帧确认。它不管理 DOM、播放时钟、渲染器或保存请求；调用方拥有 history transaction。

## 官方依据与本地边界

读取安装包 `ThreeDWorkspace-BzPphAqB.js`，SHA-256：`85b505729a166e8b56273effd999e4f9468db1f4e6758c2a49d97d7a74cf5694`，目录 `/Applications/TapNow.app/Contents/Resources/web/assets/`。以下位置是压缩源码字符偏移：

| 原函数 | 偏移 | 契约 |
| --- | --- | --- |
| `Kn` | 487706 | 有效自身 selected key 优先；没有自身 keys 则 base；正好命中时间 key 则 selected-key；其余 time-key |
| `fF` | 208104 | playback blocked；显式 base；选中其他实体 key 时回落当前 playhead；时间规范为非负整数 |
| `uW` / `Pr` | 246203 / 492075 | time-key 创建 track/key 时准备确认；选中现有 key 不需要创建确认 |
| `Qx` / `hW` / `gW` | 246444 / 248795 / 249236 | 保存快照；同时间保留 key ID；键排序；自动 snapshot 指定字段；写 key 后 duration 至少 3000ms |
| `fW` / `nk` / `rk` | 247438 / 251127 / 251507 | 删除 values、相关 segments，清 unused keys/空 channels/空 tracks；首末 key 改变时移除对应 endpoint control |
| `pW` / `tk` | 247871 / 248455 | 移动 key 夹在前后 key 之间，至少间隔 1ms，不能穿越 |
| `ak` / `SW` / `ik` | 252003 / 254451 / 252940 | 在目标时间采样后编辑快照；key 编辑写 temporal，不把采样状态写到 base |
| `WW` / `zW` | 267540 / 272475 | 作者权限、history auto/external；set-duration 最少 1000ms，且不能短于任何 key，包括 unused key |
| `bm` / `wF` / `py` | 210392 / 212160 / 213701 | 内部插入 key，用旧曲线左右子区间中点生成两段 `t=.5` bend 约束 |
| `LW` / `NW` / `FW` | 266100 附近 | 非 hold 且有距离的多个区间按路径距离重分配毫秒，保留首末时间和 hold 时长 |

复用当前 schema v4、`world-space.setTemporal`、实体 patch reducer 和 setup history lane。只新增本模块、说明和专用测试；没有新框架或依赖。

真实采样统一使用 `camera-shot-sampling.mjs` 的 `sampleTemporalSetupState`；插入 split 与均速时间分配复用同模块导出的 `resolveTemporalPathSplit` / `temporalPositionPathSegments`，不复制插值数学。共享采样支持无摄像机 setup 的 actor/prop，数值线性、离散 hold、旋转最短四元数路径、焦距对数插值及 64 弦长曲线路径。

原版 `gW` 不自动捕获 `entity.lookTarget` / `entity.heldEntityId`。本地仅在显式编辑这些字段时写对应合法 schema 通道，或由手动通道 CRUD 写入；这是本地补齐，不能写成原版自动快照行为。
合法旧/import camera state 可能保留不同的 camera.position 与 plan transform.position。本地快照以实际渲染优先的 camera.position 捕获 position channel，避免首次保存 key 跳位；保留原 base，不静默升级数据。规范化后的标准状态与原 gW position 一致。
原版低层 `WW` 没有 readonly 参数，本模块将 readonly、播放和 scrub 门禁集中在领域入口，属于本地边界增强。非法 NaN/Infinity、未知字段、零 scale 和非法镜头标量也会明确拒绝。

## 持久结构与权限

```js
setup.temporal = {
  durationMs: 3000,
  tracks: [{
    id: 'entity-track:actor', owner: {kind: 'entity', entityId: 'actor'},
    keys: [{id: 'temporal-key:...', timeMs: 0, label: 'Start'}],
    channels: [{id: 'entity-track:actor:entity.pose', property: 'entity.pose',
      values: [{keyId: 'temporal-key:...', value: {kind: 'pose', value: 'Standing'}, interpolation: 'hold'}]}]
  }]
};
```

仅 independent setup 中拥有本地实例的 actor/camera/prop 可时间创作。共享 baseline 实体、baseline setup、无本地实例、locked actor/prop、readonly、playing、scrubbing 返回明确拒绝，不写 state。跨 stage、非法 ID/类型/字段抛 `StudioDomainError`。

这里的 baseline 禁止针对**时间作者**。baseline 自身合法的 scene-object 基础编辑仍由现有实体领域入口处理，host 不应全部送进此时间模块。
自身没有 key 时，即使其他实体已有动画、playhead 不为零，该实体的自动编辑目标仍是 base。

## 编辑准备、确认与反复 preview

```js
const prepared = prepareTemporalEdit(state, {
  setupId, entityId, timeMs, selectedKeyId,
  patch: {transform: {position: {x: 5}}}, source: 'entity-control'
}, {readonly, playing, scrubbing});
```

返回 `{ok, kind:'temporal-edit', target, impact, needsConfirmation, requiresConfirmation, intent, action, fingerprint, accepted, lane, scope}`。prepare 不创建 key、不改 base、不增加 history。`intent.entity` 含 id/label，`intent.impact` 含 `timeMs/willCreateKey/willCreateTrack/existingKeyId/existingTrackId`，可直接用于确认对话框。

`selectedKeyId` 是当前实体的 UI 本地选择，不持久化。也支持 `selectedKey:{entityId,keyId}`；无效自动选中 key 回落 Kn 的其他规则。显式 `target` 支持 `base`、`selected-key`、`time-key`、`playhead-key`，对未知目标明确失败。

```js
const result = applyPreparedTemporalEdit(state, prepared, {
  confirmed: true, patch: latestPatch, now
});
```

需创建但未确认返回 `confirmation-required`；显式 `confirmed:false` 返回 `cancelled`。旧 state 与修改保持不变。普通 base/selected-key 无需传 confirmed。
setup、同 stage 实体定义或相关 key 数据改变会返回 `stale-preparation`；每次 apply 也重新检查权限。

拖拽 / 控制 session 接入时：

1. prepare，必要时显示创建确认；确认前不写 key。
2. `history.begin(prepared.lane, label, prepared.scope)`。
3. preview 调用 `applyPreparedTemporalEdit(previewState, descriptor, {patch:latestPatch, confirmed:true})`。
4. **每次缓存 `result.prepared`**。首次创建后 target 固定为该 key ID，并更新 fingerprint；后续最新 patch 继续写同一帧。
5. commit 一笔 transaction；cancel 使用 history.cancel 并丢弃 descriptor。

调用者不应绕过 fingerprint 或持久化 prepare 的临时采样 state。领域只把修改后的 key 快照写到 temporal，原 setup.entityStates 中的 base 保持不变。
`patch` 支持 `transform/visible/pose/camera/lookTarget/heldEntityId`，复用实体字段合并、camera plan ↔ optical 同步和 optics 校验。定义字段 label/color/locked/materialMode 仍走实体定义 reducer。

摄影机 pose input 的 `clearLookAt:true` 应在 host 转为 `patch.camera.lookAt = {mode:'none'}`。schema 不支持 null；不能删除 channel value 后让旧/base 目标重新生效。none 会作为 hold 通道显式覆盖目标，base 编辑也可保存这个合法状态。

## 作者 API

`reduceTemporalAction(state, action, options)` 返回 `{ok,state,changed,lane,scope,historyLabel,selection?,reason?,prepared?}`。
options 为 `{now?,readonly?,playing?,scrubbing?,createId?}`。lane 使用 `setup:${setupId}`，scope 为 `{kind:'world-space'}`；模块本身不 begin/commit，UI 和 Agent 可共用同一个纯 reducer。

所有 action 可带 `setupId/entityId/source`，默认 active setup；`set-duration` 不要求 entityId。

| type | 特定字段 | 行为 |
| --- | --- | --- |
| `save-key` | `timeMs,keyId?,label?,snapshot?` | 保存完整原版字段集；缺省 snapshot 来自真实当前时间采样；同 time 保留已有 ID；自动 split 内部路径 |
| `move-key` | `keyId,timeMs` | 四舍五入并夹在邻居内，保持 key ID/values |
| `rename-key` | `keyId,label` | 修改非空 label |
| `remove-key` | `keyId` | 删除帧及引用，清空 track/通道与失效曲线约束 |
| `remove-track` | 无 | 删除当前实体轨道 |
| `set-duration` | `durationMs` | 最少 1000ms 且覆盖所有 key |
| `redistribute-timing` | 无 | ≥3 keys 且 ≥2 个可重分配区间；按距离分配整数毫秒，其余区间时长不变 |
| `set-key-value` | `keyId,property,value,interpolation?,channelId?` | 新建或更新某字段通道在某 key 的值 |
| `remove-key-value` | `keyId,property` | 删除单通道样本并清 unused keys |
| `set-channel` | `property,values,channelId?` | 替换通道，默认保留已有 ID；values 仅引用现有 keys |
| `remove-channel` | `property` | 删除通道并清没有引用的 key/track |
| `set-endpoint-control` | `endpoint:'start'|'end',point` | 修改真实 position 路径端点控制 |
| `set-segment-bend` | `fromKeyId,toKeyId,point,t?` | 仅相邻非 hold position 区间；t 范围 `.05..95`，缺省 `.5` |
| `clear-segment-bend` | `fromKeyId,toKeyId` | 清相邻 position 区间的 bend |
| `edit-entity` | `timeMs?,selectedKeyId?,selectedKey?,target?,patch,confirmed?` | prepare/apply 的便捷单次入口；需确认但未确认时返回 prepared |

`value` 统一为 `{kind,value}`，`interpolation` 只接受 `linear` 或 `hold`。合法字段及 kind 由导出的 `TEMPORAL_CHANNEL_KINDS` 给出；最终复用 `assertState` 校验字段形状、Euler order、引用关系和 stage。camera 标量必须正数，fov 小于 180；pose 仅 actor；camera 字段要求 camera 本地 state；scale 不能为零。
显式 snapshot 必须是同实体、引用有效的完整 `EntitySetupState`。从真实 graph 读取姿态时，先完成坐标转换并与 sampled state 的其他字段组合，再传 snapshot。

附属纯 API：

- `snapshotEntityChannels(definition,setupState)`：原 gW 的 `{property,value,interpolation?}` 快照字段集，供保存当前真实 graph/sample state。
- `temporalKeyCreationImpact(state,{setupId?,entityId,timeMs})`：确认影响，不写数据。
- `temporalDurationMinimum(state,setupId?)`：system / blocking-key，含 durationMs、阻挡 key/time/track 标签。
- `temporalUsedDurationMs(state,setupId?)`：仅 channel 引用的 key；无有效 key 或只有一个 0ms key 返回 null；单个正时间 key 有有效时长。与 UI duration minimum 分开。
- `temporalKeyMoveRange(track,keyId,durationMs)`：邻居约束。
- `temporalTrackDescriptor(state,{setupId?,entityId,selectedKeyId?})`：当前单轨的 id/entityId/kind/label/keyItems.moveRange/selectedKeyId。

## 曲线与时长的准确限制

内部插入帧先按弧长时间反查原曲线参数。保存原曲线左右子区间的各自中点为两段 `t=.5` bend 约束。原版只存这些约束，**不保证逐点完全保留原 Bezier 曲线**，不能宣称精确 De Casteljau 拆分。
原 wF 同时要求插入 key 的左右邻居正好是原区间两端；存在中间仅被其他字段使用的稀疏 key 时，不跨越这些邻居附加 split bend。
删除首末帧会清相应 endpoint control；移动 key 不改控制点；hold 区间不做路径 bend 或均速分配。
作者 set-duration 统计全部 key，拍摄动态时长统计被通道引用的 key。保存 key 会将 duration 重新提高到至少 3000ms，忠实 Qx，不能沿用先前手工缩短的 1000ms 后声称同一契约。
注意原 `$l`（251029）遍历**所有 tracks** 调用 nk，Qx/fW/pW/dW 均调用它。保存一个实体的 key、删除 key、移动 key 或删除 track，会同时清掉其他轨道中没有任何 channel 引用的合法 unused key。随后 duration minimum 可能降低；set-duration 本身保持这些 keys。这个归一化例外是原版行为，专项明确覆盖，不能改成只清当前轨道再声称对齐。

## 验证

```bash
node --test tests/studio-v3-temporal-actions.test.cjs
node --check src/features/studio-v3/temporal-actions.mjs
```

专项覆盖：JSON 往返后真实采样、无临时 base 写入、selected/time/base 决策、确认/取消/多次 preview、history 单事务与 undo/redo/cancel、时长 all/used 差异、CRUD 清理、邻居移动、channel 稀疏值、离散 hold、四元数旋转、log focal、camera optical/plan、canonical no-look、curve split 中点约束、均速时间、baseline/lock/readonly/playback/scrub、字段/类型/跨 stage 引用严格拒绝。
额外 SHA 绑定原版纯 CRUD 对照项仅抽取函数，不执行应用 bundle；normalizer 用已验证 canonical fixtures 的 clone adapter，比较作者增删改契约，而非原版脏数据升级行为。缺少已安装源码时跳过该对照项，其余专项仍运行。
此模块完成领域作者数据和接口；UI、播放回显及关闭重开由 host/entry/runtime 集成验收，不能从领域测试推断已完成这些交互。
