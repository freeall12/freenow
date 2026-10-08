# 俯视渲染与运行时合同

实现依据：`docs/research/STUDIO-V3-PLAN-20261008.md` 和本地官方 `WorkspacePlanView-HeQ7o6cq.js` 的 `Wr/Or`、`WorkspaceViewfinderButton-BHqIWibq.js` 的 `Jt/bi`。本模块不创建替代底图；边界来自真实 scene source、房间六面几何与可见实体。

`plan-renderer.mjs` 管理独立 `OrthographicCamera`。`createPlanRenderer().render()` 只在同步 draw 成功后保存 plain projection snapshot。无有效 bounds、无加载完成的 source 或 render 失败时，runtime 清空 snapshot、释放 plan profile 并报告错误；失败期间主 runtime 可以回到普通现场渲染，俯视交互层须根据 `ready/error` 隐藏。重试重新建立 profile；局部 cleanup 不销毁共享 renderer、scene 或模型。

渲染期间临时隐藏 helper、camera glyph/frustum、captureExcluded 内容，并禁用 outline/gizmo/picking layers。真实角色、道具、room/source 与 ground references 仍由场景渲染。背景临时清空，clearColor 为 `#030507`，alpha 为 1，outputTarget 为默认 framebuffer，autoClear 为 true。Spark DOF 临时归零，相关 roots 的 frustumCulled 临时关闭。`finally` 恢复 helper visibility、camera layers、background/override、Spark DOF/culling、render target、autoClear、clearColor/alpha、viewport/scissor。

默认剖切高度 1.6m 通过 orthographic near plane 切去屋顶与上部几何。`'all'` 使用完整 near/far；SVG marker 不按剖切高度筛除。非线性高度 slider 和投影算法由 `plan-projection.mjs` 提供。

运行时公开：

```js
runtime.plan.read(); // {active, ready, error, projection, zoom, rotation, sectionHeight, bounds, sourceKey, sceneRevision}
runtime.plan.panPixels({dx, dy});
runtime.plan.zoomBy(factor);
runtime.plan.rotateBy(radians);
runtime.plan.setSection(heightOrAll);
runtime.plan.reset();
runtime.plan.retry();
```

`projection` 是最近一次成功显示的帧，绝不来自 navigation target。`zoom/rotation/sectionHeight` 在已有 frame 时也使用该 frame 的值。导航目标通过 runtime 自身 RAF 逐帧收敛；SVG surface 不需重复启动 RAF。`onPlanFrame(snapshot)` 在成功渲染、resize、来源同步开始及 view/profile 状态变化时通知 host。返回对象是复制值，调用方不能修改 runtime 当前 snapshot。

`sourceKey` 包含 owner identity、world/stage/setup、world-space source、room config/groundY 和本地 source descriptor。`sceneRevision` 随这些身份或 graph source root/epoch 变化递增，普通 frame、zoom/pan/rotation 及同源实体 transform preview 不改变身份。来源同步在异步解码前清掉旧 snapshot；host 应取消旧来源 pointer session。room/empty 忽略旧 world resource descriptor，room root 放入 `graph.worldRoot`，尺寸改变先 remove/dispose 旧 room 再创建；100m 默认 ground 不参与 bounds fit。

plan view 禁用 OrbitControls 和原生 TransformControls，实体选择/编辑由 SVG/domain 事务层负责。进入角色控制、camera possession/preview、viewfinder 或 gallery rendering pause 时释放 plan 并回到现场，恢复时不重用旧 plan profile。整体 runtime dispose 才释放共享 renderer。

验证：

```sh
node --test tests/studio-v3-plan-renderer.test.cjs tests/studio-v3-runtime-plan-focused.test.cjs
```

专项验证真实 Three 几何/正交 near plane、状态隔离与异常恢复、profile cleanup identity、displayed snapshot 与 damping、source 异步切换、retry、room 重建、control/possession/gallery pause。使用模拟 renderer，不能代替浏览器 WebGL/Spark 实景或完整 SVG 交互视觉验收。
