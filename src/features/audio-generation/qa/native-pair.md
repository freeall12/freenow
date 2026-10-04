# Mureka / Seed Audio 原生合同浏览器验收 · 2026-10-05

本记录覆盖正式画布、AudioAPI、GenerationAPI、共享 routed gateway、原生适配器、私有任务/媒体归档与浏览器原生播放。供应商使用本机 fixture 与合成 Key；没有真实供应商调用、计费或质量验收。Mureka 仍只在现有节点目录中，未加入 Agent 官方目录。

## 复现

在项目根目录运行，无需新依赖或用户 Key：

```sh
node scripts/qa-audio-native-pair.cjs
```

脚本打印随机 loopback 页面 URL、audit URL、上游端口和临时归档目录。打开打印的页面；页面左上 QA 面板仅创建节点、设置参数和切换隔离配置，实际生成必须点击节点的正式生成按钮。API 审计位于 `/api/qa/audio-native-pair-audit`；页面播放事件和当前来源可从 `window.audioNativePairQA` 读取。页面不读取用户 `.env`、真实 Key 或正式任务库。

1. 创建 Mureka V8，选择「Mureka自定义1025字」：正式按钮禁用，描述不能静默截短。选择「Mureka自定义合法」并正式生成，检查 custom POST、查询和本地 MP3。再选择「Mureka自动保留草稿」并生成，检查本地歌词草稿保留而上游 `lyricsLength:0`。
2. 创建 Seed Audio，选择「Seed Ogg/24k」：按钮禁用且提示 48000，原参数仍为 24000。选择「Seed Ogg/48k+字幕」并正式生成：检查 Ogg 输出、实际 fixture 字幕节点及来源连线，使用正式原生播放器播放。
3. 加入「31秒本地参考」：正式按钮禁用；移除参考恢复。可选短音频按钮生成真实 0.12 秒 WAV 并保存到 LocalAssets。前端及适配器对未物化的 `clip` / `trim` / `sourceClip` 明确拒绝；本工具不自动裁剪素材。
4. 分别切到「缺Key」「缺路由」：按钮禁用，audit 不增加上游提交；恢复配置后刷新页面，检查已有音频/字幕保留，原生播放器仍能播放已归档素材。
5. 终端 Ctrl-C 停服；检查脚本打印的页面与上游端口均无 LISTEN。

## 本轮实际证据

主任务通过 CUA 操作了正式按钮和播放器，浏览器页签已关闭。QA 服务在验收后已优雅停止；本轮页面端口 `64124`、fixture 上游端口 `64123` 均已确认无监听。再次运行会得到新端口。

| 验收 | 实际结果与证据范围 |
| --- | --- |
| Mureka custom 描述 1025 字 | 正式按钮禁用；CUA 现场确认 |
| Mureka 合法 custom | 一次 `POST /v1/song/generate`，`lyricsLength:11`，一次 query GET、一次无 Authorization 的 CDN GET；4223 字节 MP3 归档；CUA 播放得到 duration 0.2 秒、readyState 4、playing |
| Mureka auto 隐藏草稿 | 草稿保留，一次 `POST /v1/song/easy-generate`，`lyricsLength:0`；一次 query GET、一次无 Authorization CDN GET |
| Seed Ogg 24000 / 48000 | 24000 禁用；显式改 48000 后一次正式 POST，`format:ogg_opus`、`sample_rate:48000`、`enable_subtitle:true`；CUA 确认字幕文本来自 fixture 回执，字幕节点与来源连线已创建 |
| Seed 本地长参考与缺配置 | 31 秒本地 WAV 禁用；缺 Key / 空路由禁用；审计中配置切换后没有新的上游请求 |
| 刷新后持久素材 | CUA 确认两音频与字幕保留；保存的浏览器事件包含刷新后的 Ogg playing → timeupdate → ended，duration 0.1265 秒、readyState 4 |

审计文件：[上游与 CDN 请求记录](../../../../reference/native-audio-pair-cua-audit-20261005.json)。**总计 5 次生成 POST，其中前 2 次是浏览器验收前的 HTTP smoke**：Seed WAV/24000 一次、Mureka auto 一次；CUA 操作产生后 3 次：Mureka custom、Mureka auto、Seed Ogg/48000。3 次 Mureka query GET 和 3 次无 Authorization CDN GET 同样包含 smoke 的 1 次。不能把这 5 次都写为浏览器正式按钮提交。记录的 `mode:unmapped` 是缺路由阶段的审计快照，不代表恢复配置失败。

播放文件：[刷新后浏览器原生事件](../../../../reference/native-audio-pair-browser-events-20261005.json)。其中直接保存的是 Seed Ogg 刷新后的事件；Mureka 原生播放与字幕连线由本轮 CUA 现场确认，未在该播放文件中另存全部事件。

HTTP smoke 额外确认 Seed WAV/24000 的 owned media 可读（5804 字节、audio/wav、0.12 秒），以及 Mureka POST → query GET → 无凭据下载 → owned MP3 可读（4223 字节、audio/mpeg、0.2 秒）。上述结果只证明 fixture 端到端链路。

前端专项组合 `audio-native-profile` / `audio-generation-in-place` / `audio-menu-lifecycle` 本轮 29/29 通过；追加真实 `refsForRequest` 与按钮选区回归后，native-profile 10/10 通过。覆盖实际 buildRequest 在 LocalAssets 读取前拒绝无效参数和三类未物化选区、异步来源守卫、自动模式草稿保护、公网 HTTPS 的声明 duration 不作为本地实际时长验收。代码语法及 scoped diff 检查通过。浏览器验收后未重新运行测试。

## fixture 与能力边界

Mureka 成品 URL 固定为 `https://fixture-mureka.invalid/tone.mp3`。QA 在可信服务端 `download` seam 中将此唯一身份映射为真实 loopback HTTP GET，再交生产媒体 downloader 校验 bytes、原生适配器执行完整 MP3/凭据保护、生产 materializer 归档。没有修改生产 DNS/peer、重定向或媒体安全策略，也没有为生产开放 loopback CDN。CDN 请求不携带 Authorization。

Mureka fixture 为约 0.2 秒合成音；Seed WAV/Ogg 为约 0.12 秒正弦音，Ogg 浏览器测得 0.1265 秒。字幕固定为明确 fixture 文本，不复制提示词。原生 playing/ended 与实际媒体字节证明浏览器解码和播放链路，不能证明真实成曲、声线、朗读、账号资格或供应商遵循提示词。

本次 CUA 直接覆盖 Mureka V8 与 Seed Ogg。Mureka O2、自定义歌词 5000 字边界、其他 Seed 格式/采样率/参考组合由各专项合同测试覆盖；不声称逐项完成浏览器验收。真实供应商取消/恢复能力仍遵循各适配器合同。未物化选区目前明确拒绝，后续如实现本地裁剪转换须独立验证。
