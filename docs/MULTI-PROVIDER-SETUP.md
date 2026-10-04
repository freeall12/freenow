# 多供应商配置与验收

2026-10-03：图片、视频、文字、识别和分镜解析可以同时使用不同服务。没有新增依赖，也没有提供任何真实 Key。此路由是本地实现，不代表已获得 TapNow 后端设计。

## 配置

根目录 `.env.example` 的末尾提供完整占位示例。复制到私有文件，填写实际 Key、地址、模型映射与目标模型真实支持的能力，然后启动：

```sh
node --env-file=.env.local server/server.cjs
```

本机端口默认为 4173。已有服务时先停止正确项目的进程；不要同时启动第二个实例。服务不会自动加载环境文件。Agent 对话仍单独使用 `OPENAI_API_KEY` / `OPENAI_MODEL` 等配置。

| 环境变量 | 内容 |
| --- | --- |
| `GENERATION_PROVIDERS` | JSON：供应商 ID → 配置 |
| `GENERATION_ROUTES` | JSON：准确操作 kind → 供应商 ID 或 `{default,models}` |

供应商配置允许 `protocol`、`apiKeyEnv`、`baseUrl` / `baseUrlEnv`、`modelMap` / `modelMapEnv`。Key 只允许通过环境变量名称引用；JSON 中的 `apiKey` 会使路由无效。地址和模型映射的内联值与环境引用不能同时提供。`modelMapEnv` 所引用的值同样为 JSON。协议支持 `openai-native`、`ark-native`、`fal-native`、`fal-video-native`、`minimax-native`、`minimax-music-native`、`tripo-native`、`elevenlabs-native`、`elevenlabs-sound-native`、`openai-masked-edit-native`、`marble-native` 和 `tasks-v1`。fal 抠图和 Topaz 放大的可直接使用配置见 [fal 图片工具](FAL-NATIVE-SETUP.md)。

两项路由变量都未设置时，原单供应商配置保持不变。只设置一项、JSON 损坏或路由引用不存在的供应商时，整个路由禁用，不借用旧 Key。某个供应商缺 Key 或能力时只阻止选到它的功能，不影响其他已配置功能。Key 名称未设置等同该供应商未就绪。

```json
{
  "image.generate": "images",
  "video.analyze": "images",
  "video.generate": {"models": {"seedance-2.0": "video"}},
  "panorama.edit": "customTasks"
}
```

上例要求相应供应商真实存在并配置该操作。原生模型映射使用前端公开别名，值中的 `model` 才是运营者可用的真实型号。不能仅填 Key 就假定任意型号/参数均可用。MiniMax H3 视频与 Tripo 文字/单图生成 3D 已有独立原生适配；Marble 后端原生接线已完成，但本机 SPZ 渲染尚未接通，前端仍会阻止生成。全景编辑及其他未适配功能仍需要实现相应任务协议的网关。

默认路由仅在没有别名专属路由时生效，已经选定的供应商失败不会自动换供应商。已显式提供的 video `modelId` / `providerParameters.model` 与准备后的型号矛盾时拒绝请求，不得静默改路由。UI 目录外的自定义任务网关别名仍可使用。

## 恢复、凭据和界面

- 浏览器只收到功能、公开别名和配置状态；不返回 Key、端点或真实模型 ID。任务在读取媒体前按操作和别名检查配置。
- 配置弹窗显示每个操作/供应商是否就绪；整体存在可用图片服务并不表示视频服务可用。
- 异步任务持久保存原供应商身份；修改路由表不改变旧任务的目的地。修改原供应商地址/模型映射后阻止查询及取消，恢复原配置才能继续核对。
- Key 轮换不会改变任务身份。unknown 提交不重发；没有远端任务 ID 的同步 OpenAI（含蒙版编辑）、ElevenLabs TTS/Sound 和 MiniMax Music 任务只能查询本地证据。
- Ark 原始 `sourceFileId` 保留，样片续生成仍使用原供应商任务 ID。远端取消仍依据具体协议，不能宣称 Ark 已停算。

型号与配置：[MiniMax H3 视频](MINIMAX-H3-SETUP.md)、[Tripo 3D](TRIPO-NATIVE-SETUP.md)。两个 H3 名称属于不同供应商和媒体类型，不能共用模型映射。

详细契约：[路由 API](generation-routing-contract.md)、[Ark 限制](ARK-VIDEO.md)、[OpenAI 图片参考](OPENAI-IMAGE-REFERENCES.md)、[原生分镜解析](OPENAI-VIDEO-ANALYSIS.md)。

当前逐项状态见[官方交叉核验与 Key 接入清单](OFFICIAL-CROSSCHECK-AND-KEY-READINESS-20261005.md)；多角度新增显式受限 [Qwen 2511 原生替代](FAL-MULTI-ANGLE-NATIVE-20261005.md)，不等价于原站私有转换。

新增原生配置：[MiniMax Music 2.6](MINIMAX-MUSIC-NATIVE.md)、[fal 视频超分](FAL-VIDEO-NATIVE-SETUP.md)、[ElevenLabs TTS](ELEVENLABS-NATIVE-TTS.md)、[ElevenLabs 音效](ELEVENLABS-NATIVE-SOUND.md)、[OpenAI 蒙版编辑](OPENAI-MASKED-EDIT-NATIVE.md)、[Marble](MARBLE-NATIVE-SETUP.md)。Music API 仅对既有合资格付费用户开放，不能由 Key 存在推定访问权。视频超分的参数边界以适配器文档为准。

## 历史验收（最初路由批次）

- 全量 `npm test`：1493/1493 通过；`npm run check`：475 个 JavaScript 模块通过。
- 独立交叉审查及 51 项专项复验通过。真实网关测试混合 OpenAI 图片、Ark 视频与 tasks-v1，确认各用自己的地址/Key；缺路由/缺 Key/矛盾型号零派发，重启继续原任务，改地址不泄露任务 ID。
- 供应商调用全部使用替身；没有真实计费调用。不能据此确认真实账号权限、模型质量、供应商取消或媒体播放质量。

浏览器复现：

```sh
node scripts/build-provider-routing-fixture.cjs
# 打开 http://localhost:4173/qa/provider-routing-app.html?session=独立验收标识
```

入口使用公开空白种子，独立 localStorage/IndexedDB 命名空间，未知 API 和跨域 fetch 均禁止。计数中的 `blocked` 表示被夹具阻止的其他请求，不表示实际外部派发。

实际 Computer Use 顺序：检查分镜解析可用性 → 尝试未配置视频 → 生成固定测试图片 → 查看服务配置 → Escape。观察到 `availability.configured:false`，视频 `configuration_required`，`mediaReads:0`，图片 `posts:1`、`applied:1`、`succeeded`。图片是固定有效 PNG，用于结果解码和应用回调验收，未测试生图质量。配置弹窗分别显示图片就绪、视频/分镜待配置。Escape 关闭后焦点回到调用按钮。

截图 `/tmp/freenow-provider-routing-20261003.png` 留在开发机，公开仓库不依赖此文件。整体官方界面、所有功能组合和真实供应商仍未完成全量验收。
