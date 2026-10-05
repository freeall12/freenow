# Wan VACE 视频遮罩编辑原生替代 · 2026-10-05

新增独立协议 `fal-video-mask-native`，将已有完整时序 RLE 遮罩用于 `video.erase` / `video.replace`，实际提交 `fal-ai/wan-vace-14b/inpainting`。替换图进入 `ref_image_urls`，来源和遮罩共同裁选段，结果经过真实解码、原音轨处理和本地归档后才完成。它是显式 Wan VACE 独立替代，不是 TapNow 私有 `tapnow-video-edit` 的同型号实现，也不保证非目标像素、目标身份或画面效果等同。

本适配以**已有合法遮罩**为前提。初次目标识别仍需要独立的视频分割服务；仅填 FAL Key 不会补齐识别→编辑全流程。前置研究及供应商来源见 [就绪核对](VIDEO-MASK-PROVIDER-READINESS-20261005.md)，本记录说明随后落地的编辑部分。

正式工具栏/Agent、真实gateway/上传模块/FFmpeg/本地归档、视频播放及刷新已通过隔离本机组合验收，详见[完整范围](LOCAL-VIDEO-MASK-AGENT-20261005.md)。供应商传输边界为合成响应；不是实际账号上传或Wan VACE效果验收。

## 文件与配置

- [`server/generation-video-mask.cjs`](../server/generation-video-mask.cjs)：纯参数校验、私有准备记录、上传编排、一次 queue POST、原身份查询、音轨处理及已验证结果缓存；导出 `createVideoMaskProvider`、`parseVideoMaskModelMap`。
- [`generation-video-mask-media.cjs`](../server/generation-video-mask-media.cjs)：完整来源解码、共同选段、黑白 mask MP4、实际输出时序/画幅和音轨验收。见 [媒体合同](VIDEO-MASK-MEDIA-PREPARATION-20261005.md)。
- [`generation-fal-upload.cjs`](../server/generation-fal-upload.cjs)：官方 CDN 初始化和单次 PUT，固定认证 origin、DNS/TLS peer 验证、阶段回执。见 [上传合同](FAL-CDN-UPLOAD-20261005.md)。
- 共享 durable 服务与 router 保持准备状态、原本地任务及供应商身份；见 [持久化合同](VIDEO-MASK-DURABLE-RECOVERY-20261005.md)。

配置示例须合并到已有 providers/routes，不覆盖其他操作。`.env.example` 不会自动加载；真实 `FAL_KEY` 只放服务进程私有环境。

```sh
export GENERATION_PROVIDERS='{"vace":{"protocol":"fal-video-mask-native","apiKeyEnv":"FAL_KEY","modelMap":{"video.erase":{"kind":"video.erase","model":"fal-ai/wan-vace-14b/inpainting","semantics":"explicit-native-alternative"},"video.replace":{"kind":"video.replace","model":"fal-ai/wan-vace-14b/inpainting","semantics":"explicit-native-alternative"}}}}'
export GENERATION_ROUTES='{"video.erase":"vace","video.replace":"vace"}'
```

可以只配置其中一种操作；不会自动启用另一种。精确别名是对应的 kind，默认专用请求可以省略 model；显式不同别名会拒绝。普通 `video.generate` 不会路由到该适配。构造器的 `directory`、`mediaTools`、`uploader`、`download` 是可信服务端依赖/测试注入，浏览器配置或任务不能选择它们。生产网关按任务目录派生私有准备目录，构造器及 `prepare` 都不创建文件或读取媒体。

## 不能丢失的输入

保留现有 `editRequest` 合同：

```js
{
  kind: 'video.replace', // 擦除为 video.erase
  nodeId: 'source-node',
  prompt: '',
  inputs: [
    {type: 'video', role: 'source_video', url: 'data:video/mp4;base64,...'},
    {type: 'image', role: 'replacement_image', url: 'data:image/png;base64,...'}
  ],
  parameters: {
    action: 'replace', // 擦除为 remove，且没有 replacement_image
    sourceClip: {start: 1, end: 9.1},
    mask: {encoding: 'rle-zero-based-row-major', width: 320, height: 180,
      fps: 10, frames: [/* 完整来源的 101 个 RLE 字符串 */]},
    aspectRatio: 'adaptive', resolution: '720p', candidateCount: 1
  }
}
```

- 必须绑定一个来源视频；替换必须另有一张实际图片，擦除不能带参考图。`references` 只能省略或为空数组。
- RLE 是零基、逐行像素 start/length，不能重叠或越界。空帧允许，但完整 mask 和选段内都必须有目标。不能用 rectangle、首帧静态图或蓝色 UI overlay 代替时序 mask。
- 完整源最多 2400 帧，fps 为 5–30；来源与完整 mask 的实际尺寸、帧数、fps、PTS 和时长须一致。选段必须在真实帧边界，选中的帧数为 81–241；完整源可长于 241 帧，但不自动重采样、截尾、循环或补帧。
- 原输入 MP4 上限 32 MiB；替换图仅接受实际可解码的非交错 8-bit RGB/RGBA PNG，20 MiB。前端 native 分支将 PNG/JPEG/WebP 按原尺寸解码转 PNG，不缩小到预算；通用 tasks-v1 保留原格式。内联 byte envelope、实际文件大小、可选声明宽高/MIME 都核对。公网来源必须独立无凭据 HTTPS，并经过既有 DNS/peer/redirect/字节边界。
- 未知顶层、输入、参数字段、错误角色、额外参考、相互矛盾的 model、声音开关、额外画幅/清晰度/数量设置全部拒绝，不丢弃后提交。原音轨由来源实际解码判定，不能由调用者的静音开关关闭。

实际 FFmpeg 准备对 source 和每帧 mask 同裁 `[start,end)` 并从 0 重计 PTS；黑 0 保留、白 255 编辑，mask 视频编码后逐字节解码核对。原 `sourceRange` 留作结果来源说明。准备后的 video/mask/reference **全部**通过预算检查后才开始上传，单文件最高 90 MiB，超过不改 multipart。原始 mask 像素展开还有 256 MiB 本机预算，详见媒体合同。

## 一次生成与失败恢复

供应商 body 固定：

```js
{
  prompt: 'Replace the masked object with the subject in the reference image, preserving the surrounding scene and motion.',
  video_url: confirmedSourceCDN,
  mask_video_url: confirmedMaskCDN,
  ref_image_urls: [confirmedReferenceCDN],
  resolution: '720p', aspect_ratio: 'auto',
  match_input_num_frames: true, match_input_frames_per_second: true,
  enable_prompt_expansion: false, enable_auto_downsample: false,
  temporal_downsample_factor: 0, num_interpolated_frames: 0,
  preprocess: false, enable_safety_checker: true, sync_mode: false
}
```

擦除省略 `ref_image_urls`，固定指令为 `Remove the masked object and reconstruct the background, preserving the unmasked scene and motion.`。这两个动作是明确的提示词映射，不是供应商原生 remove/replace 枚举；公开 profile 提供提示词模板，不能宣传它保证保留每个非目标像素。

私有 UUID 准备目录保存 source/mask/reference/audio、实际 metadata、文件 SHA-256 和上传回执，目录 0700、文件 0600。所有上传阶段和 queue POST 前先原子写 manifest，再 `await onPreparationState` 写 durable 状态；回调失败不进入下一项网络操作。上传字段的 dispatched 表示已保存的**派发意图**，不证明远端收到文件。

| 阶段 | 已持久化后允许的下一步 |
| --- | --- |
| `media-preparing / preparing` | 下载/解码原媒体、共同裁片与本机准备 |
| `media-ready / ready` | 所有实际文件已保存且上传预算已检查 |
| `upload-initiating / dispatching` | 固定 fal storage origin 初始化 POST |
| `upload-initiated / confirmed` | 已保存文件 URL、实际 bytes/mime/hash 身份 |
| `uploading / dispatching` | 仅 signed upload URL PUT 实际 bytes，无 fal Key |
| `uploaded / confirmed` | 文件上传回执确认，才能处理下一个文件 |
| `generation-dispatching / dispatching` | 一次完整模型 POST |
| `generation-accepted / confirmed` | 原 request ID 已写 manifest，随后 await durable 身份保存 |
| `unknown / unknown` | 只读原记录，不重上传或补发生成 |

`wm1` 身份封装固定模型、kind、准备 UUID、原 queue request ID，长度小于 2048。准备 hash 绑定完整原请求，私有 manifest 另绑定原 durable `localTaskId`；交叉 kind、本地任务或请求的恢复会拒绝。Key 轮换不改变非秘密指纹。router 保持原 provider 绑定，不能因为当前路由变化转到另一供应商。

没有 queue ID 时，`resumePreparation` 只读旧 manifest。若原回执已写本机但 durable ID 保存失败，返回该 ID 让 durable 先持久化，再查询；否则保持 `unknown`。不重新准备、上传或生成。原任务 status/result 只在 `fal-ai/wan-vace-14b/requests/{id}` 查询；不使用回执 URL 发送 Key，也不重复拼 `inpainting`。PUT 取消只能证明收到请求，返回 `unknown`，不承诺执行停止。

私有准备记录为恢复证据，保留而不自动清理；它们不属于 Git 或静态发布内容。停止任务/服务后才可由操作者按项目维护政策处理，不删除仍在恢复的记录。

## 实际结果与音轨

只接收单个 `video.url`，下载最多 100 MiB，并完整解码有效 MP4。检查实际 frame count/fps/每帧 PTS/duration 和选段一致，画幅按输出端约 2 像素取整容差核对；供应商提供的宽高、fps、帧数、时长和字节数也须与实际一致。固定请求是 `720p`，但官方未公开精确像素公式，所以另用本地保守验收 `width×height >= 720×720`、最高 16M 像素拒绝明显低清结果。这不是官方 720p 定义，不凭标签把小图标记为高清。

Wan schema 没有原声音保留开关，因此无条件移除供应商音轨。原视频静音时结果保持静音；原有声音时使用**原选段**音频：能精确保留 decoded PCM、样本时间与完整范围的 AAC 走原包 copy；否则用 PCM32 无损路径，不二次有损 AAC 编码。metadata、PCM hash 和实际音频解码都核验。FLAC32-in-MP4 的浏览器兼容单独验收，不能把 FFmpeg 解码成功算作播放器支持。

最终原字节先以私有临时文件→rename→manifest 保存；若中断在结果 bytes 保存和 manifest commit 之间，原任务 GET 后可安全覆盖未提交的结果，不重 POST。缓存重用会核 hash、重新实际视频解码并比对原音轨存在状态；成功才交 durable materializer 保存，公开结果只有 `/api/generation/media/{resourceId}`。

所有原始 queue JSON（包括不用的 metadata）、编码 URL、PNG bytes/解码像素、视频及音频原字节检查 Key 回显；压缩 PNG metadata 暂不支持。供应商错误/私有路径不作为公开成功信息或可选择的请求参数。

## 验证与隔离 QA

```sh
node --test tests/generation-video-mask.test.cjs
node --test tests/generation-video-mask-integration.test.cjs
node --check server/generation-video-mask.cjs
node --check src/features/video-mask/qa/native-server.cjs
```

专项 **15/15** 通过：精确映射、prepare 无文件/网络、未知控制零派发、全 mask/selected clip、真实图片进入上传、精确 body、durable await 失败、失上传/POST 回执只读恢复、先存原 ID、原任务绑定、真实 lazy uploader 90 MiB 构造、低清拒绝、结果 commit 中断恢复及取消。该专项的 codec/上传/queue 输出是明确的合同 stub，不算真实视频解码证据。

另 **2/2** 组合测试使用真实 FFmpeg 和官方 CDN helper：合成 silent/AAC 来源 320×180/10fps/101frames → 共同裁 1–9.1s 的 source/mask 81frames → 2/3 个实际文件通过固定 DNS/TLS transport fixture POST+PUT → 一个 queue POST → `unknown` → 真本地 HTTP durable 关闭/重启 → 原 GET → 实际 1280×720 MP4 完整核验/原音轨处理 → 真 materializer/media store/HTTP 归档读回。结果实际 fps=10、81frames、8.1s、音轨状态与来源一致。上传、生成各只发生一轮；外部 queue/CDN 是注入的 transport fixture，视频内容是合成数据，不是供应商生成。

独立交审复验修复了：result commit 后 `wx` 永久失败、100/90 MiB lazy constructor 冲突、仅标签声称 720p 而接受极小输出；7 项针对性复验通过。完整 codec 联合记录与浏览器证据由各自文档/主任务另列，数量不与重叠测试累加。

最终只读交审确认真 codec 组合的上述范围和 `localTaskId` 在 submit/poll/resume/generate、durable/router 的贯通，没有新增阻断；该轮交审未重复执行测试，2/2 通过来自负责人新运行的记录。

可复现的常驻 QA 使用真 [`generation.cjs`](../server/generation.cjs)、native provider、codecs、上传 helper 和媒体归档；只在 QA host 内注入固定传输，不扩展公共 provider config：

```sh
env -i PATH=/opt/homebrew/bin:/Users/laplace/.local/bin:/usr/bin:/bin \
  /opt/homebrew/bin/node src/features/video-mask/qa/native-server.cjs 0
# 打开输出地址 /qa/video-mask-native-app.html?mode=pipeline&session=unique
# 审计：/api/generation/fixture-audit
# 音轨兼容：/qa/audio-check.html
```

进程使用临时端口与 `/tmp` 私有 task/media/preparation；不占 4173，不读取真实 Key、原站账号或日常数据库。正式前端负责 session 数据库与素材隔离，只有 pipeline 模式允许同源真 generation API；服务器拒绝其他 API、私有文件和外部传输，CSP 阻止外网 fallthrough。音轨检查页只服务媒体 owner 提供的三个明确授权合成临时文件，不公开 `/tmp` 目录。退出时优雅关闭所有 store 后清临时目录。

主任务真实 Computer Use 已完成 erase 的 pipeline 验收：2 个文件上传、1 次 queue POST、1 次结果下载；新增视频实际 1280×720、8.1s，播放器 muted=false，播放到 ended=8.1s 且无 error；刷新后 nodes=3，原连接边保留。该记录确认播放和归档恢复，不包含听音观察，也不证明合成供应商 fixture 的物体擦除效果。

验收发现 QA 的空资源索引形状导致“资源索引格式无效”提示；已按现有 Agent QA 改为合法空合成 `{version:1,algorithm:'sha256-exact-utf8',entries:{}}`，未读取私人资源索引。同时移除审计里没有采集依据、恒为 null 的 `appliedOutputAudio` 字段。服务器脚本语法检查通过；在 erase 验收和截图完成后已优雅重启，HTTP 新读取确认合法索引与已移除的审计字段，初始上传/POST/下载计数均为 0；replace 浏览器验收由主任务继续。

尚未真实付费调用、验证账号资格/CDN 可用性、Wan 输出画质、参考主体一致性或未遮罩像素保持；分割服务仍是从新导入视频开始的完整独立闭环缺口。
