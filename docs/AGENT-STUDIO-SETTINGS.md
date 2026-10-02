# 片场 2.0 Agent 画幅与光照

## 官方依据与范围

官方发布的可读包 `reference/studio-v2-page-readable.js` 包含：

- 112–124 行 `Us/Qo/Vs`：光照 azimuth 为 0–360 度、elevation 为 -90–90 度；相机画幅宽高为 1–8192 整数，宽高比为 1/20–20。
- 863–887 行 `setLighting/setCameraViewport`：写入运行时设置并保存；`null` 清除相机画幅覆盖。
- `Ya` 光照面板及 `Lc` 比例面板：真实方位/高度滑块和原始、1:1、9:16、16:9 控件。
- `Qa` 对象属性和镜头关键帧面板：位置、旋转、缩放。此版本没有可据此还原的焦距、光圈、对焦或景深写入控件。

本地复用现有控件与渲染器，只将画幅和光照开放给 Agent。相机投影参数提供只读信息，不把旧版光学字段当作新版支持。

## 工具合同

画幅复用 `scene_update`，只适用于已经存在的相机：

```json
{"id":"<camera-id>","patch":{"viewport":{"width":9,"height":16}}}
```

恢复导入相机的原始比例：

```json
{"id":"<camera-id>","patch":{"viewport":null}}
```

`viewport` 可以与名称、合法的普通变换组合；整个 patch 在首次修改前验证。含运镜的相机仍必须通过关键帧修改姿态。`scene_add` 不接受 viewport，普通模型不能设置相机画幅。

光照复用 `scene_environment`：

```json
{"lighting":{"azimuth":180,"elevation":25}}
```

两个光照字段可以单独设置，未提供的字段保留。单位为度，与对象 rotation 的 XYZ 弧度不同。恢复默认光照时，使用 `scene_read.defaultLighting` 返回的两个值。V2 不接受 room、ground、preset、intensity、background 等旧版字段；它们与合法字段混合时也会整体拒绝。

## 读取与实际渲染

`scene_read` 新增：

- `supportedCameraProperties: ["viewport"]`。
- `supportedLightingProperties: ["azimuth", "elevation"]`、`lightingUnits: "degrees"`、`defaultLighting`。
- `cameraSettings[]`：`id`、`viewport`、`effectiveAspect` 和只读 `projection`。

透视相机的 projection 包含 `type/fovDegrees/aspect/near/far/zoom`；正交相机包含 `type/left/right/top/bottom/near/far/zoom`。这是原相机的投影描述，`effectiveAspect` 则包含 viewport 覆盖；不允许通过该返回结构写入光学参数。

画幅直接作用于 `ShotRenderer.camera()` 的透视 aspect 或正交横向范围；原相机投影不被破坏。`scene_capture` 使用同一渲染器，因此比例变化会反映在真正的 PNG 尺寸和构图中。光照沿用 `runtime.updateLighting()`，影响实际方向光和阴影。

## 事务与错误

- UI 与 Agent 共用 `setShotRatio/setLighting`，校验后才记录历史。Agent 混合名称/变换/画幅只产生一次撤销；viewport-only 和光照修改保留当前播放头，名称/变换沿用已有变换事务行为。
- 相同画幅或光照值不新增撤销历史；恢复原始比例清除覆盖值。
- Agent 在未加载、已关闭、导出、拍摄、撤销恢复、变换拖动或关键帧手势期间拒绝操作。
- Agent 写入等待 `runtime.flush()`。保存失败不伪报成功；已经应用时 runtime 错误带 `applied:true` 和 `entityId` 或 `settings:"lighting"`，Agent 桥接保留此错误含义。
- 已应用的设置在保存失败后保留，可重新提交相同值重试保存而不增加重复设置历史。先读取现场确认状态，不能把保存错误解释为修改从未发生。

## 已做检查与后续验收

针对性最小复现使用真实 Three.js 相机、光源、场景快照、撤销和 Agent bridge，覆盖：

- 透视画幅设置、原始比例恢复、同值无重复历史、一次撤销。
- 正交相机比例变化且原投影不变。
- 光照实际方向和撤销，设置时保留播放状态。
- 名称加画幅一次撤销；非法尺寸、比例、旧版光学/环境字段和普通模型 viewport 全部在修改前拒绝。
- 关闭/导出/恢复/拍摄忙态保护；保存失败带已应用标记，重试不重复加历史。

真实浏览器追加验收见下节。本模块不使用供应商 Key，也不调用 LLM、生图或生视频服务。复杂光学和景深仍未实现，不能据此宣称整个片场或 Agent 导演任务完成。

## 浏览器追加验收（2026-09-30）

隔离入口 `qa/canvas-groups-app.html?session=studio-capture-0930&mediaStore&studioCapture`，沿用真实GLB、红色立方体和已存运镜相机，通过生产AgentUI工具路由执行，没有模拟模型输出。

- 相机viewport设为1024×1024，read.effectiveAspect=1，UI的1:1按钮选中；真实拍摄输出1280×1280 PNG，并连接来源片场。viewport控制比例，不是指定导出像素尺寸。
- 灯光设为azimuth135/elevation25；UI方位/高度控件实际显示135°/25°。同一镜头、播放头0秒的两张方图均有红/灰立方体；64×64解码摘要hash从4145645087变3978832541，平均RGB从30.0856变21.1009，目视确认场景阴影与明暗变化。摘要用于区分实际像素，不代替视觉检查。
- 混合{name,非法viewport}、{name,focal}和非法elevation整体拒绝，objects/cameraSettings/lighting不变。合法300°/60°后一次scene_undo恢复135°/25°。
- 刷新并重新打开片场，1024×1024覆盖与135°/25°灯光保留；两张PNG仍解码为1280×1280，来源连线保留。
- 浏览器error/warn为空。服务重启加载新schema后Agent/generation config均为configured:false，未请求外部模型。

原始证据位于 `reference/studio-v2-agent-viewport-20260930.json`、`studio-v2-agent-lighting-20260930.json`、`studio-v2-agent-settings-guards-20260930.json`、`studio-v2-agent-settings-persisted-images-20260930.json`、`studio-v2-agent-settings-persisted-scene-20260930.json`；可见画面 `studio-v2-agent-settings-current-20260930.png`。

线上官方 `https://docs.tapnow.ai/zh/docs/canvas/create-text-and-3d` 及 `https://docs.tapnow.media/zh/docs/changelog` 已交叉读取，确认拍摄回画布无需生成、3D预览与片场流程；文档也明确控件随版本变化，不能用通用教程证明新版全部设置逐像素一致。精确字段以本节前述官方bundle为依据。
