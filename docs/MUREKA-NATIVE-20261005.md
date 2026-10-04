# Mureka 原生歌曲生成 · 2026-10-05

`server/generation-mureka.cjs` 为现有 `mureka-8` / `mureka-o2` 音乐节点提供公开供应商原生合同。已验证本机 HTTP 请求、真实 MP3 字节、私有磁盘任务/媒体归档、原任务恢复和凭据回显拒绝。**没有真实供应商 Key，没有调用计费接口；账户资格、实际成曲效果与供应商运行行为仍待验。**

## 交叉证据与型号判断

| 来源 | 本轮实际读取内容 | 证明范围 |
| --- | --- | --- |
| [TapNow 官方音频文档](https://docs.tapnow.media/zh/docs/canvas/generate-and-edit-audio) | 模型列表明确 Mureka V8、Mureka O2，音乐需风格、情绪、节奏及页面歌词等输入 | 证明产品入口；不提供供应商 REST 协议 |
| 当前官方安装包 `TapNow.app/Contents/Resources/web/assets/index-BsHyQ2qj.js` | `Fi.MUREKA_8="mureka-8"`、`Fi.MUREKA_O2="mureka-o2"`；`PAa` / `RAa` 均为 `provider:ha.MUREKA`、`characterLimit:4100`、`supportCustomLyrics:true`、`defaultParams:{lyric_mode:false,lyrics:""}`；`YCe` 将布尔值映射为 `auto` / `custom` | 证明原节点型号与歌词交互；4100 为原产品限制，不能套用为官方原生 API 限制 |
| 当前安装包 `page-DVqoHdTT.js` | wireName 目录含 `mureka-8` / `mureka-o2`；该兼容目录条目带 `selectable:false` | 证明 wire 别名；不从兼容目录推断所有账号实际可选性 |
| [Mureka 快速开始](https://platform.mureka.ai/docs/en/quickstart.html) | `https://api.mureka.ai`、`Authorization: Bearer`、JSON、异步歌曲任务 | 证明 API origin、认证与基本异步语义 |
| [歌词到歌曲](https://platform.mureka.ai/docs/api/operations/post-v1-song-generate.html)、[提示到歌曲](https://platform.mureka.ai/docs/api/operations/post-v1-song-easy-generate.html)、[查询任务](https://platform.mureka.ai/docs/api/operations/get-v1-song-query-%7Btask_id%7D.html) 及页面实际加载的 [OpenAPI theme chunk](https://platform.mureka.ai/docs/assets/chunks/theme.Cv864CFs.js) | `SongGenerateReq` / `SongEasyGenerateReq` 的 model enum 均明确含 `mureka-8` 和 `mureka-o2`；读取 `SongTask` / `Song` 完整字段，不止 HTML 首屏的 object 占位 | 证明本批两个型号与自动/自定义模式均有公开原生合同 |
| [Mureka 官方变更日志](https://platform.mureka.ai/docs/en/changelog.html) | 2025-12-09 发布 mureka-o2 与 wav_url；2026-03-02 更新 mureka-8；2026-06-15 新增 Prompt to song | 交叉确认型号与自动模式时间线；不自动改为更新的 9/9.5 |
| [superbuilders/mureka 社区 TypeScript SDK](https://github.com/superbuilders/mureka/tree/654d7a49a30a2fd6054edf5cf59fe1dd7d3af45e) | 已归档，MIT-0；源码采用 `api.mureka.ai`、song generate/query、Bearer，但型号只列 auto/6/5.5 | 只交叉确认旧版 origin/认证/任务结构；不能证明 8/O2 或新 easy-generate；未安装此 SDK |
| [tryAGI/Mureka 社区 .NET SDK](https://github.com/tryAGI/Mureka/tree/db402caa4e2fd0b66f03451908ce19752df3ad3a) | MIT；OpenAPI 实际指向 `api.skyworkmodel.ai` 与 `/api/v1/music?action=...` | 是另一公开部署合同，不能用其 README 的“generated SDK”描述替代本批 platform.mureka.ai 合同；未安装 |

本轮未获得官方 SDK 的当前型号实现；直接依据官方网页加载的 OpenAPI 和官方 cURL 实现，不把社区 SDK 当作官方 SDK。原始公开页面、源码和 schema 摘录保存在已忽略的 `reference/mureka-20261005/`；没有读取账号任务库、`.env` 或真实 Key。正式文档仅保留必要合同与证据链接。

公开 schema chunk SHA-256：`f6a896984ab44e67d5f103310c90b01b2f72fb9c0996e2d06a9ba01fb6153f0d`。安装包 index chunk SHA-256：`a24bbe7de925ccc68aa332dbec6ad6a96e50db11867b21f15c20b7f128ef33a4`。这是本轮文件身份，不保证上游 URL 永久返回该版本。

## 精确请求合同

| 节点模式 | 官方接口与 body | 本批约束 |
| --- | --- | --- |
| Lyric Auto：`lyric_mode:false` | `POST /v1/song/easy-generate`，`{model,n:1,stream:false,prompt}` | 非空 prompt，最多 2000 Unicode 字符；不能同时提交歌词 |
| Lyric Custom：`lyric_mode:true` | `POST /v1/song/generate`，`{model,n:1,stream:false,prompt,lyrics}` | prompt 最多 1024 Unicode 字符，可空；lyrics 非空，最多 5000 字符；保留原行序、换行及结构标签 |
| 原任务查询 | `GET /v1/song/query/{task_id}` | 仅依据配置 origin 与保存的原任务身份构造地址；不用供应商返回的 convenience URL 发送 Key |

所有请求明确发送原型号，绝不发送 `auto`，不因拒绝或新型号发布而换成 7.6/9/9.5。官方 n 默认 2、最大 3 且按数量计费，本批固定 `n:1`；界面 count/times 仅接受 1，成品也必须恰好一首、`index:0`。

本批只接文字 inputs；最多 30 个，合并一次后计算完整 prompt 字数。音频/图片/视频参考、vocal/melody/reference ID、流式播放、纯音乐、styles/gender、格式/采样率/时长控制、字幕/歌词时间轴提取均未接入，显式参数被拒绝。上游 schema 没有本节点可用的时长请求字段，元数据不虚构 duration 范围。原产品 4100 字限制与原生限制的差异需由实际路由前端预检展示。

Auto 在服务端拒绝任何非空 lyrics，包括空白字符串；节点隐藏草稿由前端原生请求投影清除，后端不默默丢弃显式 Agent/调用方冲突。Custom 可只提供歌词，后端不自行补写歌词或节奏。

## 结果、恢复与字节保护

- `preparing` / `queued` → queued；`running` / `streaming` → running，未公开百分比就不编造进度；`failed` / `timeouted` → failed；`cancelled` → cancelled。失败原因与 trace_id 不直接反射给用户。
- 每次回执必须匹配保存的 `id` 和精确 `model`。未知状态、错任务/型号、非成功状态携带成品、缺失/额外 choices、不合法成品 ID/index/duration 均不成为成功。
- 供应商 `Song.url` 必须是通过现有媒体 URL 策略的 HTTPS 地址。`stream_url`、`flac_url`、`wav_url` 不被推测替代；当前主动消费主 `url`，完整字节仅支持 MP3/WAV。`Song.duration` 单位毫秒，输出转为秒，它是供应商元数据，不称为实际解码测量结果。
- 成功 POST 先返回带原任务身份的 running 回执；随后 GET 才下载成品。即使上游立即成功，CDN 下载失败也不会丢掉已经获得的可查询 ID。
- 使用现有 `createGenerationMediaDownloader` 无 Key 下载。原站/本地地址、DNS/实际连接地址、重定向、MIME/长度和媒体容器仍受原安全策略约束。下载实际 MP3/WAV，额外执行完整帧/RIFF 校验与 `assertCredentialFreeBytes`，覆盖 UTF-8、UTF-16 LE/BE、两种对齐和百分号编码的凭据回显。
- 音频原始字节上限 **50 MiB**，下载预算默认 120 秒；API JSON 上限 1 MiB，单次 API 超时默认 30 秒。下载失败或凭据污染保持 unknown，通过原任务继续查询，绝不重 POST。
- 通过保护的完整 bytes 转为 data URL，再交共享 materializer 归档，不进行第二次 CDN 下载。最多约 66.7 MiB Base64；处理时另有原字节/字符串缓冲。现有 generation-store 没有单记录字节上限，materializer 的 720 MiB 字符预算与 50 MiB 音频下载预算可容纳本批单结果；磁盘写入失败仍按原有 storage_error 处理，不声称已保存成功。这不是大批并发内存压力验证。
- 任务 ID 使用 `mu1.` 封装原 origin 身份、精确 model、模式与上游 ID；不含 Key。映射移除/地址变更拒绝查询，Key 轮换不改变身份。
- 本批没有公开取消接口实现，`remoteCancellation:false`，无 `cancel()`。本地取消只停止等待并丢弃迟到结果，不承诺供应商停止计费。

## 接线与配置

模块导出 `createMurekaProvider`、`parseMurekaModelMap`、`DEFAULT_MUREKA_MODEL_MAP`、`MAX_JSON_BYTES`、`MAX_AUDIO_BYTES`。与既有原生 provider 一致提供 `configured` / `fingerprint` / `metadata` / `prepare` / `submit` / `poll` / `generate`；没有新增生产依赖。`download` 是仅供可信服务端测试注入的函数，不可从浏览器请求供应下载 header、覆盖地址或 Key。

共享注册协议为 `mureka-native`，音乐 metadata 每 alias 为：

```js
{
  scene: 'Music', lyricsModes: ['auto', 'custom'],
  maxPromptCharacters: 2000,
  customLyrics: { maxPromptCharacters: 1024, maxCharacters: 5000 },
  maxCount: 1, maxAudioBytes: 50 * 1024 * 1024
}
```

多供应商配置条目示例（合并入现有 JSON，勿覆盖其他供应商）：

```json
{
  "mureka": {
    "protocol": "mureka-native",
    "apiKeyEnv": "MUREKA_API_KEY"
  }
}
```

`GENERATION_ROUTES`（合并到已有操作/型号映射）：

```json
{
  "audio.generate": {
    "models": {
      "mureka-8": "mureka",
      "mureka-o2": "mureka"
    }
  }
}
```

默认模型映射就是精确的两个公开型号，不会选择“最新”；可以提供明确子集：

```json
{
  "mureka-8": {"kind":"audio.generate","model":"mureka-8"},
  "mureka-o2": {"kind":"audio.generate","model":"mureka-o2"}
}
```

API Key 只由服务端私有进程环境注入，不写入文档、浏览器、画布或任务请求。配置成功仅表示具备派发条件；真实账号的模型可用性仍待实际验收。

## 定向验证

```sh
node --test tests/generation-mureka.test.cjs
node --check server/generation-mureka.cjs
git diff --check
```

2026-10-05：**15/15 定向测试通过**，语法/差异检查通过。覆盖实际 AudioCore 两型号与 Auto/Custom 请求；真实 loopback HTTP 创建/查询；真实 MP3 分块媒体响应且 CDN 请求没有 Authorization；私有磁盘任务与媒体归档；两次服务/媒体仓库重启后回读同一实际字节且只有一次生成 POST；丢失真实 HTTP POST 的 unknown 重启不重发；污染音频无结果、无媒体文件、无 Key/Base64 入任务记录，保留原任务可恢复，随后同一任务取回干净 MP3。

测试下载函数把合成 HTTPS CDN 描述映射到本机 HTTP 夹具，再交现有媒体验证器校验真实 bytes；这是可信服务端测试 seam，生产没有 loopback CDN 例外。测试 MP3 为仓库的 0.2 秒合成音频，不能当作 Mureka 实际成曲或质量证据。

共享 routed gateway 与正式音频按钮的 CUA 验收见[音频原生合同专项记录](../src/features/audio-generation/qa/native-pair.md)：custom 1025 字禁用，合法 custom 与保留隐藏草稿的 auto 各只提交一次，实际 MP3 原生播放。记录区分先前 HTTP smoke 与浏览器提交，附上游/CDN 审计与播放证据，并明确 fixture seam 和真实供应商未验边界。
