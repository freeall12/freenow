# Toolbar 视频重拍 · 2026-10-05

`video.reshoot` 新增独立 `ark-video-reshoot-edit` 适配，按官方实验性相机提示词路径执行真实 Ark 视频编辑。四种镜头模式、连续分镜时间、名称、起止相机坐标及各段指令均编译到提示词；来源保留，成功输出创建连接的新视频。它不是原生相机轨迹控制，也不承诺“不变”片段逐帧一致。

## 官方依据

本次实际读取[官方视频文档](https://docs.tapnow.media/zh/docs/canvas/generate-and-edit-video)以及安装包 `TapNow 0.4.81` 的 `/Applications/TapNow.app/Contents/Resources/web/assets/page-DVqoHdTT.js`，SHA256 为 `8334adc98d6ec24265d45ed4f45458be19d137b5391e5b3abb77e064d221cd86`。

- `Ype`：导出版本 2.5 的逐段 `motion_mode`、时间、`point_a/point_b`；四模式 unchanged/static/cut/dynamic。
- `Kpe`：将分段、名称、静态/切换/平滑移动及相机坐标编译为提示词；unchanged 要求完整时间段保持来源，隐藏的补充指令不进入提示词。这只是模型指令。
- `dhe`：固定 `Cd=en.SEEDANCE_2_5`，`VIDEO_EDIT`、`adaptive`、`Np=-1`，有生成来源设置时继承其清晰度/声音；无设置的导入素材采用官方默认 720p/有声，并在面板显示将发送的规格；不根据原始视频像素或无音轨推导生成参数。`multiViewEdit.capabilityMode="prompt_simulation"`。结果新建节点并与源节点连接；不是抽帧转图片再图生视频。

本次还重新读取[Ark 创建任务正文](https://www.volcengine.com/api/doc/getDocDetail?LibraryID=82379&DocumentID=1520757)。`omni_reference_task_type=edit` 是提交前子类型校验：至少一个 reference_video，来源 4–30 秒，ratio=adaptive，duration=-1。实际模型判断与指定子类型不一致仍可能异步失败。这不提供逐段相机 JSON 的原生字段。本适配复用已实现的 Ark POST/原 ID GET、结果归档与恢复。

## 独立配置合同

服务端协议：`ark-video-reshoot-edit`。映射示例中的真实型号由操作者替换，不从来源节点继承，也不把品牌 alias 当真实型号：

```json
{
  "seedance-2.5": {
    "kind": "video.reshoot",
    "model": "REPLACE_WITH_ACCOUNT_SEEDANCE_2_5_MODEL_ID",
    "capabilityMode": "prompt_simulation",
    "resolution": "720p",
    "generateAudio": true,
    "profile": {
      "ratios": ["adaptive"],
      "durations": [-1],
      "resolutions": ["720p", "1080p"],
      "audio": true,
      "maxImages": 0,
      "maxVideos": 1,
      "maxAudios": 0,
      "videoDurationRange": {"min": 4, "max": 30, "totalMax": 30},
      "omniReferenceTaskType": "edit"
    }
  }
}
```

共享路由/环境名由主任务接线。`createVideoReshootProvider({baseUrl,apiKey,modelMap,fetchImpl})` 与 `parseVideoReshootModelMap` 导出于 `server/generation-video-reshoot.cjs`。公开 metadata 包含 `videoReshoot.models` 的能力与默认规格，明确 `nativeCameraControl=false`、`exactUnchangedSegments=false`、`remoteCancellation=false`；不暴露真实型号、服务端地址或 Key。

只有一个 source_video；实际时长/尺寸由 `prepareReshootMedia` 解码读取，计划时长必须与真实素材一致。来源选段在通用 tasks-v1 路径必须先裁成实际视频，附上与真实时长一致的 sourceRange；不发送整片替代选段。未知参数、缺失起止相机、短段运镜、重复 segmentId、非连续计划、隐藏指令及不支持的清晰度/声音在 POST 前拒绝。全 unchanged 属于无操作计划，前端与适配器均拒绝且不发 POST。Ark 使用 -1 输出时长，不将供应商返回的整数时长编造为实际媒体元数据。

Ark generation 视频仍使用已发布 HTTPS。10 月 8 日新增[显式独立 fal CDN 发布](ARK-LOCAL-VIDEO-PUBLICATION-20261008.md)：对应映射配置 `videoUploadProvider` 与独立 fal Key 后，可准备本地 asset/blob/data 视频和实际选段，经完整 MP4 解码后上传；未配时明确阻断。Ark Files 理解接口不等同于 generation 视频上传，本地视频仍不能仅填 Ark Key 使用。[原传输核对](ARK-LOCAL-VIDEO-TRANSPORT-20261005.md)

## 前端保护与恢复

`src/features/video-reshoot/ui.mjs` 在配置查询前后、取帧后及生成/应用时绑定项目 ID、源对象身份、来源 URL/clip 与实际将发送的生成规格；同 ID 新对象不会获得旧任务应用权限。关闭面板撤销 lifetime signal，阻止配置或媒体异步返回后的迟到提交，取消本地等待；不声称远端收费任务已取消。草稿仍保存于来源节点。

媒体准备位于 `src/features/video-reshoot/media.mjs`，在 TaskService route readiness 之后、dispatch receipt 之前执行，原请求不被修改。原任务回执未知时不重 POST；已接受任务恢复只查原 ID。供应商成功须经共享 materializer 保存实际 MP4 bytes 后才公开成功，本批回归验证第二次重启没有额外生成或下载。

## 后续显式替代候选

从[fal 官方 sitemap](https://fal.ai/sitemap.xml)实际发现并读取 [Kling O3 Pro Edit llms](https://fal.ai/models/fal-ai/kling-video/o3/pro/video-to-video/edit/llms.txt) 与 [OpenAPI](https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/kling-video/o3/pro/video-to-video/edit)：正式 endpoint 为 `fal-ai/kling-video/o3/pro/video-to-video/edit`。它接收 prompt（最长 2500）、video_url、keep_audio、image_urls/elements 和固定 shot_type=customize；来源 MP4/MOV 3–15 秒、宽高 720–3840、24–60 FPS、200 MiB。没有相机轨迹字段，没有输出清晰度/声音生成同义字段，keep_audio 是保留来源音轨，不等同 generateAudio。

同一模型的[官方 API 页面](https://fal.ai/models/fal-ai/kling-video/o3/pro/video-to-video/edit/api) Files 部分明确支持 file URL、Base64 data URI，以及 `fal.storage.upload(file)`；binary File/Data 可以由 SDK 自动上传。这是实际读取的本地素材运输依据，没有做真实服务器解码验证。

这是后续显式替代候选，本批未实现或默默切换。即使经 fal 上传本地视频，也需要保留完整分镜提示、明确 3–15 秒及音轨/清晰度差异，不能称官方 Seedance 语义等价。

## 验证

```bash
node --test tests/generation-video-reshoot.test.cjs tests/video-reshoot-native-profile.test.cjs tests/video-reshoot.test.cjs
node --test tests/generation-ark.test.cjs
```

重拍 21/21、底层 Ark 17/17 通过；专项 JS/CJS 语法与 scoped diff 检查通过。第一次新增测试发现 submit 同步抛错，已改成和现有适配器一致的 async submit/generate 后通过，未放宽参数校验。无新增依赖、真实 Key 读取或付费调用；未运行全库或浏览器。真实账号权限、视频编辑效果、分镜执行质量和播放验收仍待验证。


## 公开隔离浏览器夹具

在项目目录执行：

```bash
node scripts/serve-video-reshoot-fixture.cjs 0
```

使用输出的 OS 分配临时端口，不能使用生产 4173。每次换独立 session：`/qa/video-reshoot-native-app.html?mode=unconfigured&session=u1`，另有 `native` 和 `delayed`。生成 HTML 由当前 index.html 重建且被 Git 忽略，三个 QA 脚本可跟踪。源素材使用 tracked `qa/trim-scenes.mp4`；四个私有根数据文件替换为 tracked defaults。服务器不读取 env、不启动真实后端；只读公开文件并支持 MP4 Range，API/mutation 一律拒绝。

夹具给 CanvasStore、LocalAssets、templates、recent/libraries/subjects 和其他 IndexedDB 名统一加独立 session 前缀，localStorage 也独立。生产面板、GenerationAPI 与 TaskService 照常执行；audit 只计数并调用真正 prepareInputs hook。fetch 拦截所有外部/API 请求，CSP 额外阻断外部元素加载，POST 永不返回模拟成功。

CUA 步骤：

1. `unconfigured`：点“打开生产视频重拍”，等待真实 12 帧，核对生成禁用与缺 Key 提示。点 QA“检查真实任务前置校验”，应出现 configuration_required，mediaPrepares=0、posts=0。
2. `native`：同样打开，核对本地 HTTPS/上传限制、请求固定 seedance-2.5/1080p/无声。点前置校验按钮后真实 TaskService 进入 prepareInputs 并拒绝本地来源：mediaPrepares=1、trimCalls=0、posts=0。
3. `delayed`：这一模式只合成 tasks-v1 配置回执，使本地视频能走到真实生成按钮。打开并等待按钮可用，点“延迟下一次配置”，点生产“生成视频”，立即 Escape/关闭面板，再点“释放迟到配置”。pendingConfigs 返回 0，jobs 仍空、mediaPrepares=0、posts=0，不新增节点。

aside 显示数据库名、任务状态、配置请求/返回/挂起数、POST/媒体准备/裁片数。夹具不模拟供应商结果；本批只有启动、语法、HTML 结构、公开文件 HTTP/视频 Range 和私有/API 拒绝检查，实际 CUA 交由主任务执行。
