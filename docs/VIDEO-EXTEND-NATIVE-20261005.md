# 延长镜头供应商适配 · 2026-10-05

本地 `video.extend` 现有独立适配实现官方 Toolbar 的**参考生成**流程，协议名为 `ark-video-extend-reference`，必须显式使用 `capabilityMode: prompt_simulation`。这表示方向、连续性和不重复原片是提示词要求；不是原生时序参数或生成质量保证。文件名保留任务约定的 NATIVE，实际协议及能力声明不称作 native extend。

**不能只填 Key 就把本地视频发给 Ark。** 当前 Ark 视频合同只列公网 URL 和 `asset://<ASSET_ID>`；本适配仅支持不含凭据的公网 HTTPS 视频，未实现公网素材发布或 Ark 资产库。`asset:`、`blob:`、本地 `/api/...` 和 MP4 data URI 均拒绝。现有本地裁片会变为内联 MP4，裁片验证成功不表示可提交 Ark。正式界面应在读取、裁片之前提示这个条件；不能传整片公网 URL 冒充本地选区，也不能将 Files API 的 `file.id` 当作 Asset ID。

另一个只读调查已记录[Ark 本地视频传输证据](ARK-LOCAL-VIDEO-TRANSPORT-20261005.md)：Files 的二进制上传服务于 Responses/Chat 理解合同；CreateAsset 则需要 AK/SK、已授权素材组和公网来源 URL。因此这两条公开路径都不能据此声称“只填 Ark API Key 即可把本地视频上传用于生成”。

## 官方 Toolbar 合同

实际读取[生成和编辑视频文档](https://docs.tapnow.media/zh/docs/canvas/generate-and-edit-video)及安装包的 `/Applications/TapNow.app/Contents/Resources/web/assets/page-DVqoHdTT.js`。这一静态核验阶段没有打开、编辑官方站点或调用其私有生成接口；后续主线程的官方 Web 只读操作见文末 CUA 记录。

安装包资产 SHA-256：`8334adc98d6ec24265d45ed4f45458be19d137b5391e5b3abb77e064d221cd86`。以下根据其中 `cpe`、`tO`、`dpe`、`upe` 的实际实现，避免根据名称推定能力：

- 方向 `backward/forward`；新增时长整数 4–30 秒；连续性 `natural/action/camera/scene`；画幅固定 `adaptive`；保留主体、场景、风格、动作、声音；一个候选，最多四个引用/主体槽位。
- `dpe` 编译 `notVideoEditTask` 和 `extendDetailed` 提示词，并记录 `magicEdit.capabilityMode: prompt_simulation`。提交参数为 `modelType: REFERENCE_TO_VIDEO`，不是独立 `VIDEO_EXTEND`。
- `cpe` 调用 `tO(data, SEEDANCE_2_5)`。固定入参优先于源节点模型，因此这条 Toolbar 路径实际选择 Seedance 2.5；“沿用源视频的模型与参数配置”提示文字不能推导为模型真的被继承。
- 源节点 `params.resolution` 经正规化并按当前模型可用规格降至不高于原选择的分辨率，或使用参考 variant 默认值；`generateAudio/generate_audio` 布尔值被继承。当前本地适配使用运营者显式映射，界面应展示实际规格。显式 `parameters.resolution/generateAudio` 按 profile 能力检查后原样使用；未设置才采用映射默认，不静默降级。
- 新结果创建独立视频节点：片尾在原节点右方，边 `source → result`；片头在左方，边 `result → source`。原片保留。提交的是新增片段时长，不是原片长度加新增时长；结果不由服务端拼接原片。
- 官方代码把裁片范围用于来源说明；本地现有 `prepareExtensionMedia` 已把选区裁为真实媒体并保留 `sourceRange`。适配拒绝仍包含 `clip/trim/sourceClip` 的未准备输入，不让原片替代选区。

## 公开供应商边界

实际读取 [Ark 创建任务正文](https://www.volcengine.com/api/doc/getDocDetail?LibraryID=82379&DocumentID=1520757) 的 `Result.MDContent`，对照[公开创建 API](https://www.volcengine.com/docs/ark/create-video-generation-task-api)。

- Seedance 2.5 全模态参考支持生成、编辑和延长，输出整数秒 4–30；`omni_reference_task_type: extend` 要求至少一个视频和 `ratio: adaptive`，文档描述支持向前或向后延长。
- 该 subtype 是**任务类型引导**。实际任务仍按素材和提示词判定；与显式 subtype 不一致可能产生 `InvalidParameter.TaskTypeMismatch`。官方 Toolbar 没有显式传 `reference/edit/extend`。本地映射因此仅允许未设置或 `auto`，不将普通参考 subtype 强制为 `reference` 后提交延长提示词。
- 视频需实际 2–30 秒，合计最多 30 秒；单视频宽高 300–6000、宽高比 0.4–2.5、像素数 407696–8295044。运营者还需配置账号真实模型支持的媒体数量/格式/时长与输出规格。当前适配按这些边界和显式 profile 检查，不自动截短。
- 创建 `POST /contents/generations/tasks` 只接受回执 ID；恢复查询原 `GET /contents/generations/tasks/{id}`。成功读取实际 `content.video_url`；不根据返回的整数时长估算真实播放时长，也不编造封面或尺寸。
- 本次公开创建正文没有证明“原生 extend 结果只包含新增部分”的输出合同；所以不能无条件用这个 subtype 替代独立结果节点。本文实现选择可核对的官方 Toolbar 参考流程，并在提示词中要求只生成新增部分。实际连续性和是否重复内容仍需付费模型结果验收。

另实际读取 [fal Veo 3.1 extend-video OpenAPI](https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/veo3.1/extend-video)，SHA-256：`c6d7fa38a65fa5907f5fbb96db7ea61ba6d0be5547462a9eebf4ff3590d76797`。输入 `duration` 固定 `7s`，输出 `resolution` 固定 `720p`，视频仅 16:9/9:16 及 720p/1080p；没有方向枚举或额外参考/主体输入。这是可选的**独立尾部延长功能**候选，不能无损承接当前 4–30 秒、片头/片尾和四引用槽位合同。若要引入，应明确新范围和规格，不能静默忽略设置。未新增此 endpoint 的调用。

## 独立 adapter 接口

实现：`server/generation-video-extend.cjs`。

```js
const {createVideoExtendProvider, parseVideoExtendModelMap} =
  require('./generation-video-extend.cjs');
const provider = createVideoExtendProvider({baseUrl, apiKey, modelMap, fetchImpl});
// prepare(request), submit(request, {signal}), poll(originalId, {signal}),
// generate(request, {signal, onTaskIdentity, onProgress, pollInterval, timeout})
```

仅支持 `video.extend`。模型别名必须显式选择，真实型号只在服务端配置；公开 metadata 不暴露真实型号、Key 或端点。样例中的型号占位符必须换成账号真实可用型号，不代表已有访问权限。

```js
const modelMap = {
  'operator-extension': {
    kind: 'video.extend',
    capabilityMode: 'prompt_simulation',
    model: '<operator-selected-Seedance-2.5-model-or-endpoint-id>',
    resolution: '720p',
    generateAudio: true,
    profile: {
      ratios: ['adaptive'],
      resolutions: ['720p'],
      durations: Array.from({length: 27}, (_, i) => i + 4),
      audio: true,
      maxImages: 4,
      maxVideos: 4,
      maxAudios: 2,
      videoDurationRange: {min: 2, max: 30, totalMax: 30},
      audioDurationRange: {min: 2, max: 30, totalMax: 30}
    }
  }
};
```

请求以一个首位 `source_video` 开头，其他素材按 `reference` 或 `subject_reference` 展开。视频必须带实际宽高和时长。`subjects` 为 `{id,name,description}`；`referenceIds` 与 `reference` 输入一一匹配。适配将主体说明、文本输入和各素材 token 保留到模型内容，拒绝缺失或未展开的引用。

`parameters` 支持：`model/modelId/providerParameters.model`（须一致）、`capabilityMode`、`direction`、`extendDirection`、`duration`、`mode`、`ratio`、`sourceClip`（只能空）、`subjects`、`referenceIds`、`candidateCount`（必须 1）；可选 `resolution` 必须在 `profile.resolutions` 中，可选 `generateAudio` 必须为布尔且 `profile.audio: true`。显式值覆盖映射默认；未设置才使用 `entry.resolution/generateAudio`。其他设置在 POST 前拒绝。方向中文值为“片头延长/片尾延长”；模式中文值为“自然延续/动作接续/延续运镜/推进场景”；ratio 为“自适应”。

提示词使用真实来源边界和 `@video1`，另明确“仅生成新增片段，原片由画布保留，不要在结果中重复或拼接原片”。提交采用现有 Ark 运输和轮询；不下载/重复提交来源。结果由共用安全 downloader/materializer 归档，供应商成功与本地归档成功保持分离。

## 失败、恢复与验证

- 权限：只有已配置路由和显式模型才能提交。服务端 Key 仅用于对应 Ark 端点，不进入任务内容或公开回执。未读取真实 `.env`、未使用真实 Key。
- 失败：不支持的规格/素材、本地视频、矛盾字段、未裁选段在 POST 前报错；创建 HTTP/JSON/回执不确定时为 unknown，不自动重试。供应商执行超时保留原任务 ID；未声称远端取消。
- 日志/追溯：复用 durable store 的 provider binding、fingerprint、原任务 ID 和私有 providerResult；不新增原始响应或 URL/Key 日志。路由/映射变化应要求恢复原配置，不换模型再 POST。
- 输出：公开仅为已归档的新候选媒体；不复制输入充当结果，不将源视频或源时长写入生成输出。实际内容需要播放检查。

```sh
node --test tests/generation-video-extend.test.cjs tests/generation-ark.test.cjs
node --check server/generation-video-extend.cjs
node --check tests/generation-video-extend.test.cjs
```

定向 **29/29 通过**（延长 adapter 12 项，既有 Ark 17 项）。新增验证覆盖两种方向/四种连续性、4/30 秒端点、主体和多模态引用、1080p及无声显式继承、未准备/矛盾请求零 POST、unknown 不重发、原 ID 恢复、媒体未保存前不公开，以及实际 QA MP4 bytes 经共用 materializer 归档后再次重启不 GET/不下载。`sourceRange` 长度必须与实际裁片时长一致（最多 0.1 秒封装/采样差）。实际 MP4 fixture 仅验证归档，不是模型延长效果；未运行全量 suite、未执行真实付费调用、未做浏览器播放验收。

创作面板现用 `extensionSettings(node)` 固定官方 `seedance-2.5` 公开别名，继承显式来源分辨率/声音。异步 availability/configuration 预检显示实际别名和规格；未配置或本地视频尚未发布时提前禁用提交。正式提交重新检查配置；来源和引用用项目 ID、原节点对象、媒体 URL 和裁片范围校验，避免回收 ID 或切换项目后回填。媒体准备在解码前、物化后和传输后重复核对原生合同。

前端定向 **12/12 通过**：`tests/video-creation-native-profile.test.cjs`、`tests/video-creation.test.cjs`、`tests/video-extension-media.test.cjs`。其中原生本地输入/裁片失败断言确保不读取、不裁切、不传输；公网输入物化后的真实尺寸及传输改写也会再次检查。创作面板及媒体模块语法检查通过。

生产 UI 隔离夹具：

```sh
node scripts/build-video-extension-fixture.cjs
# /qa/video-extension-app.html?mode=native&session=unique
# /qa/video-extension-app.html?mode=unconfigured&session=another-unique
```

夹具只使用已有本地合成 MP4，每个 session 有独立 localStorage/IndexedDB namespace；未知 API/外部 fetch 被阻止，无模型提交回执。点击“打开视频延长”可核对参数菜单、4–30秒、四种方式、方向与 Escape；native 模式展示 1080p/无声继承及公网素材条件，unconfigured 模式展示配置阻断。`window.ExtensionFixture.posts/trimCalls` 应均为 0。浏览器实际验收由主任务执行，不能把入口创建作为视觉/交互通过。

共享 router、公开配置接线由主任务处理。仍需独立公网素材发布/Ark资产接入及真实模型结果验收；这两个缺项不能算作已完成。

## 主线程 CUA 操作对照

官方 Web 实际“回到节点”→视频节点工具栏的 **30s 图标**→“视频创作 Beta”→“延长镜头”，确认两方向、4–30 秒默认 8、四种连续性模式；Escape 关闭参数层并保留创作层。30s 是工具栏图标，源播放器实际为 5.1 秒；未执行官方生成。

本地 native fixture 实际选择片头 / 30 秒 / 延续运镜，验证 Escape 分层和参考选择进入 / 退出；固定 seedance-2.5，源 1080p / 无声保持。Ark 本地传输未支持，确认禁用、POST 0 / trim 0；与前端专项检查共同确认，生成所需的媒体准备、裁片和提交被提前阻止，UI 自身仍会加载视频。unconfigured fixture 也已实点“打开视频延长”：确认禁用，状态明确缺少 `GENERATION_API_KEY`，规格保持；receipt 为 posts 0 / trimCalls 0 / blockedAPI 0 / jobs []。没有生成结果或供应商连续性质量验收。[完整记录与本地截图](LOCAL-VIDEO-TOOLS-STORAGE-BRAND-20261005.md)。
