# 原生 Replicate SAM2 首次识别前端

主任务最终已完成真实CUA整链：凭据写失败零提交、51张实际PNG合并50帧、蒙层保存失败同UUID/同asset恢复、主画布dirty自动解除，以及直接刷新后的来源/蒙层/历史保留。最终截图、服务器计数与修复过程见[本批实机记录](LOCAL-SAM2-AND-BLOCKING-20261005.md)。使用合成供应商边界，不是SAM2实际模型效果验收。

本批保留物体移除 / 替换面板、添加蒙层、框选与白底取消 / 确认按钮。原白底确认按钮读取本机配置；原生模式随后展示上传与费用说明，用户再次确认才准备视频并创建任务。自定义同步 `/segment` 仍保留。没有新增依赖、真实 Key、私人素材或外部推理验证。

## 用户流程与边界

1. 已有视频打开物体移除 / 替换，点击添加蒙层，在当前帧框选，原白底 `×` 只清除选区；点击画布空白退出工具。Escape 为已有本地交互，未声称官方同样支持。
2. 原生识别确认说明明确：前向片段上传 Replicate；中间提示帧另外上传倒序片段，最多两次 SAM2 推理并可能分别计费。取消已运行任务仍可能计费。Replicate 分割 Key 与 fal 编辑 Key 独立，浏览器不存 Key。
3. 前端实际读取来源视频字节，计算 SHA256；先保存来源画布，再持久保存 UUID、来源字段指纹、原提示选区 / 时间、clip、原蒙层、模型版本和供应商身份。只有保存成功才 `POST /tasks`，使用 UUID `Idempotency-Key`；服务端任务 ID 等于该 UUID。
4. 创建回执丢失仍保留同一 UUID。刷新后打开同一来源显示恢复入口，不自动创建 / 查询任务；用户点击恢复仅 `GET /tasks/:id`。来源字段、实际节点对象、项目、clip、蒙层或活动选区 / 提示时间改变会阻断应用。恢复点击明确恢复原选区与提示时间；后台原始来源 SHA256 必须与上传字节一致，可变 URL 应用前再次读字节验证。已完成蒙层的刷新 `loadMask` 也逐步检查同任务 receipt / 来源指纹，并对可变 URL 再读字节比对 SHA256；未通过不会显示蒙层或启用生成。已打开面板中的来源字段漂移会关闭面板或阻断编辑提交 preflight。
5. `needs_resume` / `canResume` 显示独立续发入口。重新展示费用确认并核对当前配置版本 / 供应商身份，随后才 `POST /resume`。GET 不续发。显式取消是 `/cancel`，停止查看 / 关闭编辑器只中止浏览器观察，不能声称供应商已停止。
6. 有旧记录时不能静默开始新识别。用户明确丢弃本机记录后才可重新框选创建新任务；丢弃不会停止原任务或撤销费用。创建前意图保存失败仍保留页面中的同 UUID / 请求，用户确认后可重试该意图的保存和派发。首次创建及未派发意图恢复都在 POST 前重读配置并比较供应商身份 / 固定版本，不能更换 Key 后用旧意图派发。刷新后没有请求字节的未派发意图只能明确丢弃后重新框选。已标记派发的未知任务永远先 GET，不以“重试”创建新任务。

识别蒙层始终属于**完整原视频时间轴**，使用实际原视频宽高、duration、fps；提示时间是原轴时间。节点 `clip` 只限制播放器范围和后续编辑 `sourceClip` 的本地共同裁剪，不能拿片段时长验证全源蒙层、或给蒙层时间额外减 clip.start。前端保存 `videoMask.timeline='full-source'`，不改其他工作流数据。

## 保存与恢复合同

`src/features/video-mask/recovery.mjs` 把完整通过验证的 RLE 写入 LocalAssets，仅创建一次资产和一次节点修改。完成必须等待正式 `CanvasApp.saveProject({beforeCommit}) → persist → CanvasStore.save → CanvasStore.flush`，并在提交前后检查来源与当前蒙层。主画布保存使用完整 project / history / future / view 快照，成功的最新真实保存同时解除 dirty / 保存失败通知 / 离页保护；不能只保存局部 graph 后伪造完成状态。真实保存失败保留完整 mask、同一 asset 与原 patch；恢复同 UUID 会重新 GET / 使用本地归档并重试保存，不重新推理、不重复插入历史步骤。刷新后既有已应用 patch 与 receipt.maskAsset 能复用相同资产。UI 只在保存成功后进入已识别状态。

现有 `CanvasApp.updateNode` 自带自动保存，可能先保存 pending patch；本批仅给正式 `saveProject` 增加向后兼容的可选 `beforeCommit` 并透传 `persist`，既有自动写入行为保留。Receipt 尚未 `applied` 时阻断异步 `loadMask` 与生成启用，即使 pending patch 曾自动写盘也必须显式恢复并通过受守卫的完成保存。要进一步禁止所有 pending patch 的既有自动写盘，需要给共享应用增加受守卫的节点修改接口。

Receipt 使用独立 `freenow:video-segmentation:v1:<project>:<node>` 本机存储键，写入后回读确认。记录不含视频 / mask 字节或凭据。多个窗口对旧版本写入会拒绝覆盖。损坏记录会阻断识别并显示错误，避免默默覆盖未知任务。浏览器存储拒绝写入时不继续派发 / 轮询。

`preparing`、`running`、`needs_resume`、`unknown`、`succeeded`、`failed`、`cancelled` 使用状态描述及实际分支下载帧数，不估计百分比。部分分支结果不会应用；只有 TaskDTO 的完整 `mask` 才进入原尺寸 / 全时长验证和画布保存。

## 本地验收

```bash
node --test tests/video-segmentation-frontend.test.cjs tests/video-mask.test.cjs tests/video-mask-result-application.test.cjs tests/video-mask-native-profile.test.cjs
node --test tests/video-segmentation-canvas-save.test.cjs tests/canvas-app-persistence.test.cjs tests/video-segmentation-frontend.test.cjs
node src/features/video-mask/qa/sam2-native-server.cjs 0
```

真实本地任务服务入口：`/src/features/video-mask/qa/segmentation-app.html?mode=native&session=sam2-native`。使用 `/qa/sam2-source.mp4` 320×180 / 5秒 / 10fps 原创合成移动方块，播放器选段 `[1,4)`，提示 `2.5` 秒，框选方块中心约 `(140,85)`。native 模式 task/config 直连实际服务，上传 / prediction / PNG下载边界由 QA 服务注入并禁止真实外呼。页面提供 receipt 和 mask 保存失败开关、刷新同项目、来源片段变化与撤销；本地任务审计 `/qa/sam2-audit`。

QA 首次初始化先读取合成 MP4 实际字节，经 `LocalAssets.put(blob)` 保存为不可变 `asset:` 引用，再更新空来源节点并真实保存画布。默认节点不放临时 HTTP 来源，避免历史快照携带未归档 URL。刷新只复用已保存的来源 asset 和蒙层，不替换已有节点 / 来源；报告 `mediaReady:true` 后可开始识别。旧 URL 会话不会被静默替换，最终验收请使用新 session。

仅前端故障状态入口 `?mode=frontend&session=...` 使用公开 8秒 / 30fps素材及明确合成 TaskDTO / RLE，可演练创建响应丢失、显式 resume、模型版本变化。它不是 SAM2 模型能力或服务器编解码证据。

本批专项 17 项与已有相关 20 项共 37 项通过：写失败零派发 / 零查询、第二次意图写失败、失响应刷新只 GET、显式续发与版本隔离、来源 / 对象 / 项目 / clip / mask 守卫、SHA256绑定、真实 save/beforeCommit/flush 失败复用。六项定向回归调用实际 UI 方法，以明确 decoder / DOM 桩验证已完成恢复时来源字段和字节变化、等待中的记录变化、未派发意图换供应商身份零 POST、当前面板字段漂移阻断、短视口滚动面板边界；这些桩不是视频像素或浏览器证据。浏览器 Computer Use 与真实 native QA 服务截图由根任务另外验证；不能把单元测试或合成结果说成真实供应商分割质量。

真实浏览器又发现“蒙层恢复保存成功但主应用 dirty 未清”的缺口后，新增 3 个 actual-host 保存回归：调用实际 `remember` / `updateNode` / `persist` / `saveProject` 和实际 `CanvasProjects.snapshot`，明确 DOM / 存储边界桩，验证失败后同 asset / 同 patch 重试、完整 history / view、正式保存成功才清 dirty / 通知、事务项目守卫和无参数旧调用兼容。新增3项＋共享画布保存28项＋前端17项共48项通过；这批检查针对正式保存路径，不冒充浏览器离页交互证据。

参数面板按当前视口剩余高度限制 max-height 并内部滚动，子项不收缩；低矮视口必要时上移面板，保持视频位置和原卡片 / 按钮视觉。720 / 480 / 240高度的实际 place 方法边界回归通过，浏览器按钮点击可达性由根任务复核。

实际供应商授权测试仍未执行；严格两路提示帧一致性、移动 / 遮挡与模型质量属于另一次明确授权的供应商验证。

可变 URL 的字节校验发生在首次识别应用与刷新恢复时；成功恢复后 URL 内容在下一次编辑派发前再次变化的持续绑定，不属于本批已验证范围。来源字段 / 对象 / 项目 / clip 守卫在编辑 preflight 继续生效；不可变 `asset:` 来源可避免这一 URL 内容漂移边界。
