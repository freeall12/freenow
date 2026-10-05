# 视频物体移除 / 替换前端接入 · 2026-10-05

本轮将 Toolbar 已有移除/替换面板接入真实 GenerationAPI 任务链，支持显式配置的 `fal-video-mask-native` 独立 Wan VACE 替代协议。不是原站 `tapnow-video-edit` 的同型号复现，模型效果未验证。识别目标仍依赖独立分割服务；填编辑 fal Key 不会自动使新视频的识别步骤可用。

后续主线程已完成正式面板、真实本地pipeline、播放器及刷新验收，详见[本批实机记录](LOCAL-VIDEO-MASK-AGENT-20261005.md)。以下模块级记录保留各自验证范围；原“待root执行”事项以汇总记录中的实际结果为准，音频只有播放兼容证据，没有听辨结论。

## 请求与媒体边界

`core.editRequest` 保持原合同：移除为 `video.erase` / `action:remove`，替换为 `video.replace` / `action:replace`；prompt 为空；一个完整 source_video，替换另有一个 replacement_image；全源 row-major RLE、原 sourceClip、adaptive、720p、单候选。没有添加模型名、虚构识别结果或生成成品。

前端 `native-profile.mjs` 先检查实际配置、所选路由和时序能力，拒绝不支持的 fps/帧数、非帧边界选段、越出全源的选段及选段内空目标。配置失败时媒体准备不读源。其后 `media.mjs` 使用现有真实素材 resolver，核对实际全源尺寸/时长，保留全部 RLE 和 clip，交给后端共同裁源与蒙层，前端不单独裁源。

替换的原参考图使用 `fullImage || image`。native-only 的 `reference-png.mjs` 实际解码 PNG/JPEG/WebP，以原尺寸画入 Canvas 后生成 PNG；PNG 同样解码，移除容器 metadata，保留像素几何，不自动缩图。单参考图20 MiB、16,777,216像素及完整请求64 MiB预算超限直接拒绝。通用 tasks-v1 保持原格式。取消、来源或参考图变化会阻断下一步。

后端的真正 source+mask 联合选段、黑白视频编码、fal CDN 三文件上传、queue 持久化及原选段音轨 remux 由专用 adapter / media / upload 模块负责；这些实现及其测试不在本前端文件所有权内。

## 面板与守卫

主面板只显示简短中文信息：独立替代、Wan VACE、720p、本机保留原声音；生成会把片段、蒙层、替换图上传到 fal；参考图按原尺寸转 PNG；效果待验。替换实际送入模型的动作模板如下（不是原生 remove/replace 枚举，也不保证主体一致性）：

- 移除：`Remove the masked object and reconstruct the background, preserving the unmasked scene and motion.`
- 替换：`Replace the masked object with the subject in the reference image, preserving the surrounding scene and motion.`

每次异步步骤前后核对项目、来源对象成员身份、视频 URL、clip、不可变 mask asset、参考图对象/fullImage 和当前选择；关闭面板取消识别/生成准备。相同 id 的对象替换也不能冒充原来源。素材选择弹窗关闭或改选后，旧异步图片不能重新成为当前参考。结果创建连接新节点并保留原片；`result-application.mjs` 缓存原结果节点与视频URL，实际等待 `app.saveProject()` 完成后才返回应用成功。保存失败重试沿同一任务/节点，不再生成或创建第二个结果；保存前后核对来源/项目/参考与结果对象。创建结果选中新节点导致自身面板关闭时，独立提交controller与持久守卫继续保存；应用前用户关闭仍会取消准备。刷新持久画布仍须浏览器验收。

选择框拖动只按 RAF 更新选择几何，暂停的视频不持续刷新 overlay；播放使用 requestVideoFrameCallback（无此能力时用 RAF），暂停/关闭取消回调。卡片内容缓存避免每次 pointermove 重建。原图标保留。Esc 取消选区/关闭面板是本地增强；官方本次只读 UI 观察中 Esc 没有反应。

`captureMaskedVideoPoster`复用真实视频帧解码器：编辑结果没有poster时生成最大320px首帧JPEG，保存随结果节点，不借用来源缩略图。取消／失败均在finally释放decoder，保存重试复用同一poster；新增2项专项通过。主线程实际替换结果解码320×180封面并刷新保留，Toolbar和Agent共用此路径。

## 独立公共 QA

```bash
node scripts/build-video-mask-native-fixture.cjs
node scripts/serve-video-mask-native-fixture.cjs
```

静态服务器使用 OS 分配端口，禁止4173；只服务 public checkout 文件和必要 Three 模块，替换 root 四个私有 data 脚本为 tracked defaults。HTML临时生成，不提交。所有 IndexedDB 与 localStorage 按唯一 session 隔离，初始化失败则配置不可用且所有准备/API失败关闭。CSP 只允许 self/data/blob；不加载 `.env`，不连接真实供应商。

入口：`/qa/video-mask-native-app.html?mode=unconfigured|native|delayed&session=unique`。

素材是 tracked `qa/trim-scenes.mp4`（320×180、8秒、30fps、240帧）和原创自绘512 PNG；完整合成移动 RLE 通过真实 LocalAssets/CanvasStore 保存。这是“已有合法蒙层”验收，不模拟识别成功。分割配置始终 false。native 的真实任务 POST 本地403，不返回成品；计数区显示真正 TaskService preparation、POST、媒体读取、保存库名以及脱敏后的输入形状。

- unconfigured：恢复蒙层后打开移除/替换，生成应禁用。编辑器视频预览/蒙层恢复会读取公开素材；零读取断言针对授权识别/生成准备。
- native：移除生成应进入真实准备后仅一个被阻断的本地 POST，保留240帧完整RLE/全源8秒元数据。切换[1,5)后仍保留全部mask与clip。替换通过实际素材选择弹窗选择参考图后进入原尺寸PNG转换；没有成品或新节点。
- delayed：打开并等待生成可用，延迟下一次配置→点真实生成→关闭面板→释放迟到配置，应无准备/POST/新节点。
- 清空蒙层后框选：检查灰蓝全图蒙层、选框/角点、取消保留面板；确认识别配置失败，不产生假mask。

另一个 `mode=pipeline` 仅用于专门的真实本地服务 fixture：source `/qa/native-video-mask-source.mp4`（320×180、10fps、101帧、AAC tone），clip[1,9.1)；前端仅放行 same-origin `/api/generation/*` 到真正 gateway，不伪造任务/结果。后端只有 upload/queue/download 的供应商边界使用合成 transport，其余真实 adapter、FFmpeg、持久任务、本地 MP4 归档均运行。audit `/api/generation/fixture-audit`，输出 `/api/generation/media/*`。入口由独占 `src/features/video-mask/qa/native-server.cjs` 的 owner 交付；不应在静态host上把pipeline成功当成已验收。

## 本轮证据与限制

```bash
node --test tests/video-mask-native-profile.test.cjs tests/video-mask-native-fixture.test.cjs tests/video-mask-result-application.test.cjs tests/video-mask.test.cjs
```

本轮22项通过：严格请求、RLE/选区、分割取消与合同、配置前置拒绝、项目/来源/参考图守卫、实际元数据、PNG三格式decode接口/geometry/预算（Node注入解码/Canvas依赖，未实际浏览器解码JPEG/WebP样本）、native/generic分支与转换后守卫、隔离初始化失败/只读IDB的failclosed、实际保存等待与失败重试复用同节点、自身面板关闭后的持久来源守卫。另一个只读 reviewer 完成5项 focused及aggregate路由3项独立核验，无新增阻断；QA另验证4种初始化失败都0原始fetch/prepare，动态CSP在浏览器真实停后续脚本不在VM验证范围。

静态 host 当前验证 HTML200、公开MP4 Range206、`.env`/root私有canvas-data404。语法检查覆盖所改前端模块与QA/scripts。root已反馈浏览器缺配置与替换路径通过：全240RLE、全源8秒、clip[1,5)、512PNG、一次prepare/被阻断POST、无结果；delayed控制按钮冒泡导致关闭面板的问题已在QA控制层stopPropagation修正，需重新验收。浏览器绘制、播放、真实归档/音轨听验与刷新验收由root执行，结果以root实时验收记录为准。没有真实Key、付费调用或供应商视觉效果证明；从新视频首次识别到生成的独立闭环仍取决于真实分割服务。
