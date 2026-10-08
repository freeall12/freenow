# Saved View 领域动作

`saved-view-actions.mjs` 复用 schema v4、`addView`、`removeView` 和既有 history patches，提供保存 View 的列表、创建、完整相机替换、改名、删除与持久选中。没有新增 schema、网络调用、ID 工厂、资产、照片或渲染 API。官方证据见 `docs/research/STUDIO-V3-SAVED-VIEWS-20261008.md`；独立管理面板与“更新当前视角”可见按钮没有官方定位证据，应标为本地补齐。

## 列表

```js
const all = listSavedViews(state);
const inSetup = listSavedViews(state, {stageId: 'stage-default', setupId: 'setup:state-1'});
```

默认返回所有舞台、所有独立状态内的 persisted Views，保持 `worldSpace.views` 的存储顺序。可选 `stageId`／`setupId` 是非空字符串，组合时取交集；不存在或不匹配返回空列表。结果每项保留完整 View 字段，增加 `stageLabel`、`setupLabel`、`isActive`。列表、camera、tags 等嵌套内容均与输入 detached。列表不产生 implicit-camera-shot，也不使用链接实体 camera 覆盖 `view.camera`；普通 capture-only 和无链接 View 都真实可见。

## 动作与历史

```js
const action = {
  type: 'create', id: hostSuppliedId, camera: completeCameraSnapshot
};
const result = reduceSavedViewAction(state, action, {
  now: Date.now(), readonly: false, playing: false, scrubbing: false
});

if (result.ok && result.changed) {
  session.change(() => result.state, {
    lane: result.lane, label: result.historyLabel,
    scope: {kind: 'world-space'}, content: action.type !== 'set-active'
  });
}
```

示例中宿主在实际执行前还需再次检查 session/source 身份及事务状态。reducer 不创建或提交历史；宿主必须以返回 lane 和既有 world-space scope 提交。`set-active` 是可重放的 world lane 状态选择，宿主可用 `content:false` 标记非内容变更，仍由现有 session 完成保存。

| 动作 | 输入 | 变化与 lane |
| --- | --- | --- |
| create | `{type:'create', id, camera, label?, notes?, tags?}` | 当前独立 setup/stage；调用 addView 并激活新 View；`setupLane(activeSetupId)`；“保存视图” |
| update-camera | `{type:'update-camera', viewId, camera}` | 仅目标 camera、updatedAt；目标 View 所属 setup lane；“更新视图相机” |
| rename | `{type:'rename', viewId, label}` | trim 后仅目标 label、updatedAt；目标 setup lane；“重命名视图” |
| remove | `{type:'remove', viewId}` | 调用 removeView；目标 setup lane；“删除视图” |
| set-active | `{type:'set-active', viewId:string\|null}` | world lane，仅 activeStageId/activeSetupId/activeViewId；null 只清 activeViewId；“选择视图” |

结果为 `{ok, changed, state, lane, viewId, reason?, message?, historyLabel?}`。成功且有变化的完整 state 与输入、action 均 detached，避免调用者修改返回 state 时污染原 state。无变化及业务阻断返回原 state 引用、changed=false、无 historyLabel；宿主不应生成 history 或 dirty。改名／相机相同和重复选中是 `ok:true`、reason=`unchanged`。缺失 View、空名称、baseline create、readonly／playing／scrubbing 返回 `ok:false` 及对应 reason。非法字段、身份、JSON、相机、关系与时间戳抛 `StudioDomainError`，输入始终不变。

## 相机、名称和边界

create 的 ID 必须由宿主提供且在 views 中唯一；名称未提供或为 null 时按官方 nullish 语义使用 `View ${全局views.length + 1}`，显式名称 trim 后不能为空。默认 tags 为 `['capture']`（null 也取默认）；显式 `['capture','shot']` 或其他 tags 按既有 schema 检验。shot tag 只声明 View 分类，绝不补 sourceCameraEntityId、创建摄像机或假装该 View 能使用需要真实 camera entity 的镜头 jump。

camera 必须是宿主取得的完整透视快照，含 position、rotation、fov。先验证纯 JSON，再由 `assertCamera` 校验 finite pose、合法 Euler order、0<fov<180、正光学值、null 支持、景深模式及同舞台 focus/lookAt 实体关系。没有默认镜头或缺字段补全，也不将正交图伪装成透视相机。此模块保存合法输入原值，不调用会默认补齐、夹取或重算 FOV 的 `cameraOpticsPatch`。schema 允许的独立 fov/focalLength 原值保持不变；宿主负责快照与实际 projection 一致。

update-camera 只替换完整 snapshot，不合并旧 camera，不改 id、stageId、setupId、createdAt、sourceCameraEntityId、notes、referenceIds、tags、durationMs、generationContext、viewportDrawing 或任何实体/动画/环境/来源。update/rename 的 now 必须有限非负且不早于目标 createdAt。无实际变化不会仅因新的 now 改 updatedAt。所有目标操作允许合法跨 setup/stage View，内容历史归目标所属 setup，而非当前 setup。

remove 只执行已有 removeView 级联：删除这一 View、以它为 source 的 outputs、references 的这一 view target；必要时清 activeViewId。保留所有其他 View、entity 与 entity camera、setup、temporal、capturedPhotos、environment、worldSpace.source。output 中已有 canvasNodeId 只是关系字段，此 reducer 没有画布 API，删除领域 output 不会删除已导出画布媒体。

set-active 与 restoreView 分开：选中仅切已有 stage/setup/ID，不改保存相机、不恢复导航相机、不采样 setup、不进入摄像机接管。真正恢复应由宿主等待目标 setup 的资源同步后使用独立导航 API，并在完成时检查 session/source 围栏；列表不能把选中当作已恢复视角。

## 官方与本地守卫

官方 save reducer 激活新 View；默认 `View N` 按全局数量计数，create 保存当前 captureSetup。官方 callback 未传播 sourceCameraEntityId 等链接字段，这里同样拒绝给 create 增加这些字段。

官方 rename trim/空名/同名守卫被保留；官方低层 create 接受空 label，本地 strict schema 不允许，因此 create 也 trim 并拒绝空名。官方 patch 可宽泛浅合并，这里将 update-camera 限制为仅相机和更新时间，阻止身份/关系注入。官方序列化关系修复没有移入本地：已有 assertState 严格拒绝不合法状态，动作不会自动修复或过滤源数据。

官方 `setActiveView` 没有找到 readonly 守卫；本地 `createStudioSession` 的 `change`/history 即使 `content:false` 仍调用 assertEditable，所以 reducer 的 readonly 拒绝全部动作，包括持久选中。这是现有 session 合同所要求的本地差异。宿主如需要只读导航，可以使用其 transient 相机 API，但不能绕过 session 写入 active IDs。playing/scrubbing 只阻断 create/update/rename/remove；set-active 是选择，在该纯领域层允许，宿主可以进一步依据资源同步和控制租约阻断。

## 权限、日志与失败

模块不写文件、不请求网络、不访问 provider，也不读取密钥。readonly/playing/scrubbing 是调用方当前事实，宿主还负责 owner/source/revision/sessionToken 身份、事务冲突、播放控制租约、持久保存与错误展示。审计信息来自返回 lane/historyLabel 与现有 history record；本模块无隐藏日志。非法输入抛错，业务拒绝有 reason/message，均无状态变更。

## 验证

`node --test tests/studio-v3-saved-view-actions.test.cjs`：13/13 通过。覆盖全 View 列表及 detached 数据、跨 setup/stage 创建与选择、真正相机与光学/JSON关系校验、身份字段注入、readonly/播放/拖动阻断、rename/update/selection no-op 无历史、仅 View 删除边界，以及全部五种动作的精确 forward/inverse patches 和真实 history undo/redo。

本切片只验证纯领域模块。未宣称管理 UI、可见相机采集、资源同步恢复、浏览器视觉或 session 保存重开已完成；这些必须由宿主接线专项另行验证。

宿主接线已完成；真实生产菜单、跨状态恢复、保存失败原回执重试与刷新重开证据见[集成验收](../../../docs/verification/20261008-studio-saved-views.md)。本文件专项范围与集成验收分别记录。
