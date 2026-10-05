# Agent 皮肤增强与视频蒙层审批 · 2026-10-05

`generation_submit` 新增独立 `image.skin` 分支。它使用图片增强节点的皮肤编辑器三档模式，将生成结果保存为增强节点的新版本；不会把皮肤操作解释成打光或任意图片提示词编辑。

```js
{
  kind: 'image.skin',
  nodeId: 'source-image',
  prompt: '',
  skin: {mode: 'heavy'}, // detailed / standard / heavy，必须显式提供
  targetNodeId: 'existing-enhance' // 可选；省略时应用结果阶段新建增强节点
}
```

`nodeId` 始终指向完整来源图片。既有目标须为独立 `tool:'enhance'` 图片节点，并且只有一条入边，来源必须是该 `nodeId`。参考列表只能省略或包含该来源，结果数量只能省略或为 1；模型、质量、其他图像处理参数和非空提示词均拒绝。图片裁切、选区或片段必须先导出为真实图片。

## 来源与能力边界

只读核对本机官方包 `index-BsHyQ2qj.js` 的 `cOl`、`dOl`、`uOl`，确认 provider 为 Enhancor，detailed 使用 `enhancor-detailed`，standard/heavy 使用 `enhancor-realistic-skin` 的固定语义；参数与公开协议缺口见 [原厂合同研究](SKIN-EDITOR-NATIVE-CONTRACT-20261005.md)。这里没有请求原站生成 API。

本地启用条件是 `skinRequestState` 验证所选服务公开的 `capabilities.skin`，包含所支持模式及精确语义、完整原尺寸 PNG 来源、单结果和真实结果像素校验。目前采用专用 `skin-tasks-v1` 独立任务网关合同，需要实际实现该合同的外部服务。普通 `tasks-v1`、OpenAI/fal 图片编辑路由或仅填写 Enhancor Key 均不能自动启用。执行详情取当前 profile 的实际披露，并说明来源、新建/既有增强目标、模式和版本保存意图。

## 审批、回执和保存

- 审批前刷新 `availability({kind,signal})`，再捕获公开配置。每个 await 后检查来源、目标、连线、参数、项目、对话、当前 run 和取消。
- 审批只捕获节点对象身份与元数据；不读取素材、不创建节点、不请求模型。
- 每次来源校验重新执行完整图片范围验证，覆盖 `sourceBox`、`mask`、`projection`、`selectedRegion` 等全部已知选区字段。审批后或结果返回前新增选区，均不能继承原完整图片授权。
- 正式 `onDepthSubmitted` 将原 `submittedTaskId` 写入对话并等待持久 flush；完成后 TaskService 才可解析来源媒体和发出 POST。回执或任务历史保存失败时停止，不能重发。
- `onPrepared` 捕获已物化完整 PNG 的最终请求，核对原任务 ID、来源与批准的模式；`runInPlace.verifyRequest` 在应用前核对完整请求快照。任务托盘恢复即使保留相同任务 ID 和原节点身份，也不能把更改模式、来源 ID 或源图字节的结果应用到画布。
- 新目标仅在实际结果应用时创建；既有目标保留身份。参数板切到 `realistic-portrait` 及批准的 mode，复用面板 `createEnhanceResultApplication` 保存实际图片来源、provenance 和版本。
- `saveProject` 完成后才标记应用成功。保存失败保留原任务、目标和版本，应用重试只重存，不重复 POST 或增添版本。结果或目标被用户修改后，原应用重试拒绝覆盖。
- 页面刷新后的查询和手动取回使用既有恢复机制；不承诺跨重启自动重建本页应用闭包。任务 ID 表示提交，不能当作图片生成、落图或保存成功的证据。

视频蒙层正式审批同时修复旧配置缓存：先刷新 availability，再读取并披露配置；捕获 guard 新绑定原 args，来源、替换图片、保存蒙层和参数漂移均需重新审批。`tests/agent-video-mask.test.cjs` 增加提取正式审批段的 null/missing 缓存恢复及两个配置 await 的漂移回归。

## 定向验证

`tests/agent-skin.test.cjs` 10 项通过：严格 schema、正式 dispatch 与真实 TaskService/HTTP 图片传输、审批前零媒体读取、持久原任务 ID 先于传输、新建目标和既有目标、版本保存失败重试、拒绝/缺配置/保存失败/取消零派发、来源/连线/配置漂移、实际审批段及独立 UI Agent fixture 的真实回执检查。新增实际 HTTP GET 恢复回归覆盖模式、来源 ID 和 PNG 字节变化，均保持一次 POST、零节点/版本修改和零保存。

相邻 `agent-video-mask`、`agent-relight`、`agent-image-processing`、`agent-execution-view` 共 39 项与 skin 9 项合并执行，48/48 通过；修改模块语法与 diff 空白检查通过。未进行全库测试或浏览器验收，未使用真实 Key、付费模型、用户环境或用户项目。

最终请求恢复保护增量后，仅重新执行 skin 专项 10/10；模块语法及 diff 检查通过。

完整来源范围增量后，skin 专项 11/11 通过。新增回归遍历全部 12 个选区/裁剪字段：真实 TaskService 在 availability 等待期间新增字段后保持零任务、零媒体读取、零 POST 和零新节点；独立无传输服务夹具调用实际 Agent 应用回调，验证晚到图片结果也不会创建/更新节点或保存。后者是结果守卫验证，不代表新的供应商或浏览器验收。

隔离 QA helper 为 `src/features/agent-generation/qa/skin-agent-fixture.js`，由同一 `src/features/image-skin/qa/server.cjs` 宿主插入。它只固定 Agent 模型回复，生成沿实际网关与归档执行，并在 generation POST 前读取真实 CanvasStore 对话确认原任务 ID。正式确认卡、真实 PNG 解码、刷新持久化及正式“重试应用结果”的浏览器验收由主线程继续记录；合成接口响应不能证明真实供应商模型效果。

```sh
node --test tests/agent-skin.test.cjs tests/agent-video-mask.test.cjs \
  tests/agent-relight.test.cjs tests/agent-image-processing.test.cjs \
  tests/agent-execution-view.test.cjs
```

主线程随后完成新版正式确认卡与新建相连增强节点的Computer Use：持久会话回执先于POST，512×320完整PNG、768×512真实归档、结果保存与刷新回读通过。具体截图和限制见[本批实机记录](LOCAL-SKIN-AGENT-20261005.md)。
