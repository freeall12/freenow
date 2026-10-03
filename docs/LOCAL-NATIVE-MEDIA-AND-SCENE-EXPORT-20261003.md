# 原生音乐、视频增强与本机片场导出

2026-10-03。本批继续推进功能闭环，不代表所有官方功能和设计已完成。运行时仅使用本机资源、存储与独立配置的供应商；没有原站登录、服务端或资源回退。最终 freenow Logo 与应用自身水印替换仍在完整功能验收之后进行。

## 本批实现

- `minimax-music-native`：Music 2.6 自动歌词、自定义歌词与纯音乐，真实 MP3/WAV hex 解析、采样率/格式/字节边界；Agent 增加同一模型，复用现有 MiniMax 图标和音频配置转换。明确 API 拒绝为失败；同步回执丢失保留 unknown，不重复 POST。
- `fal-video-native`：FLUX 精准/创意增强，以及显式映射到 Topaz Proteus 的子集。未物化的 clip/trim/sourceClip、90fps、2x 慢放等不支持项会拒绝，不能静默处理整片或改变规格。原任务身份跨路由修改恢复，结果经过实际 MP4 校验并在本机归档。
- 统一单供应商和多供应商 factory、模型可用性及前端配置状态；补齐 `.env.example`，修正多供应商说明中 ElevenLabs/Marble 的过时状态。
- 3D 原更多菜单按场景名导出 GLB，预计算真实大小，重复点击共用编码，忙碌时禁用；场景被修改、替换或关闭后拒绝迟到下载。

## 实际验证

只做受影响检查，没有全量重跑。MiniMax 模块 12 项；fal 模块/队列/原视频增强核心 27 项；GLB 新导出和原相关检查 27 项及 QA facade 回归 1 项；独立网关集成 6 项；前端配置回归 11 项通过。独立审查发现并修复遗留裁片参数被忽略、明确音乐 API 拒绝误记 unknown 两个问题。共享文件语法和 diff 检查通过。

### 音乐 Computer Use

启动 `node scripts/qa-minimax-music-native.cjs`，打开其输出的随机 loopback URL。夹具加载公开空种子，使用独立浏览器源和临时 gateway/durable/media 目录，不读取真实 Key。模拟上游只返回现有 44.1kHz/128kbps、0.2 秒正弦 MP3；它验证协议与媒体链路，不证明模型生成质量。

实操自定义歌词 → 正式 AudioAPI / GenerationAPI → 本机网关 → 本机媒体归档 → 同一原节点回填。源和 resultIds 均为 `0548a143-ad68-4200-9a89-d7fc230dcb77`，服务器结果为 `/api/generation/media/...`，画布媒体为 `asset:...`。实际播放记录 `paused:false`、currentTime 0.167808；刷新后相同源 ID 可再次播放，currentTime 0.129994。整个过程上游 POST 1 次，歌词原样保留，lyrics_optimizer=false。未接真实付费供应商。

### 3D Computer Use

正式片场“更多 → 导出场景(glb)文件”显示 3.7 KB，下载 `QA GLB 导出城市.glb`。浏览器回读及实际 Downloads 文件均确认 3692 字节 GLB v2、模型缩放 `[2,1,.5]`、35°镜头、PointLight 和一条真实动画轨道。模型初始局部坐标 `[1,.5,0]` 与世界坐标 `[2.921060994,1.5,-3.389418342]` 保留。

延迟真实编码回包 → 点击导出 → 修改模型 X=3 并保存 → 释放：出现“场景已更新，本次未下载”，下载计数保持 1。重试得到新的 GLB，局部坐标 `[3,.5,0]`、世界坐标 `[4.763182982,1.5,-4.168255027]`，动画仍保留。fixture externalAttempts 为空。QA 公共 facade 路径错误在本轮实操中修复，再次加载后完成验证。

官方视频增强菜单也已实际打开核对：Topaz Labs / FLUX Video Upscale、分辨率、帧数、放慢倍率及 FLUX 精准模式。未点击任何付费生成；检查产生的临时增强节点已清理。

## 边界与剩余工作

- [MiniMax Music 配置](MINIMAX-MUSIC-NATIVE.md)：官方自 2026-08-20 起停止向新用户提供付费音乐/歌词 API，仅既有合资格用户继续；Key 存在不证明资格。
- [fal 视频配置](FAL-VIDEO-NATIVE-SETUP.md)：FLUX 1.5–3 倍、MP4≤20秒/50MB；Topaz 明确 Proteus、原速、auto/30/60fps、1–4 倍。真实画质、音轨保留和完整输出播放质量仍待 Key 联调。
- [GLB 导出合同](STUDIO-V2-SCENE-EXPORT-20261003.md)：全局 viewer/grid/lighting 使用既有旁记录；未声称 GLB 导出保持 Three.visible 语义。关闭迟到保护有代码回归，本轮 CUA 直接验证的是修改坐标的迟到保护。
- SPZ 渲染、完整精确模板资源、其他尚未适配生成操作、全站坐标/菜单/hover/微动效及性能验收仍开放；继续按[完整本地化清单](FREENOW-LOCALIZATION-ACCEPTANCE.md)推进，不能将新增协议数当作全功能完成。

本机证据：`/tmp/freenow-glb-export-20261003.{png,json}`、`/tmp/freenow-minimax-native-20261003.png`、`/tmp/freenow-minimax-native-before-refresh-20261003.json`、`/tmp/freenow-minimax-native-after-refresh-20261003.json`、`/tmp/freenow-minimax-native-server-20261003.json`。证据留在开发机，公开运行不依赖它们。
