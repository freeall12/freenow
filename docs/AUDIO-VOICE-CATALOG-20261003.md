# 音色目录与试听接线

普通音频节点和 Agent 音频确认卡现在共用默认生产 `AudioAPI` 音色目录/菜单，不再要求额外调用 `setVoiceProvider`。不读取或写入浏览器 Key；供应商选择和 Key 由本机生成配置负责。当前目录合同只支持 ElevenLabs 真实目录，其他服务没有音色库时明确报未配置/型号不可用，不能把 OpenAI 内置音色伪装成 ElevenLabs 库。

## 来源与界面边界

保留 `audio.css` 及 Agent `styles.css` 中已有官方捕获的菜单外观、搜索和参数入口；图标复用 `ui-icons.js` 与 Agent 官方原资源。官方来源见 `reference/audio-nodes.md`、`reference/agent-generation-audio.md`。

2026-10-03 主任务官方 CUA 查看音频节点：默认 Mureka V8，模型菜单显示 11Lab V3 NEW；点击进入订阅商城，未继续或绕过。临时空 Audio 已删除、DOM count=0 确认。因此本次没有新鲜 Eleven 音色菜单在线视觉证据，不声称已 live 对齐，不复制营销付费阻断。

## 请求合同

`src/features/audio-voices/client.mjs`：

```text
GET /api/generation/voices?model=eleven_v3&pageSize=100[&search=...&cursor=...]
→ configured, provider, model, voices[{id,name,labels,category,description?,previewRef?}], hasMore, nextCursor
GET /api/generation/voices/{encodeURIComponent(id)}/preview?model=eleven_v3
→ 真实 audio/* Blob
```

目录保持供应商稳定 ID，拒绝缺标识/重复 ID/坏分页响应；试听固定使用同源 ID 路径，不请求后端数据中的上游 URL。请求无重定向、不缓存，接收 AbortSignal；试听限定非空 audio/*、最多10MB。

后端错误保留原 code：`voice_catalog_configuration_required` / `voice_catalog_model_unavailable` / `voice_catalog_upstream_failed` / `voice_catalog_timeout` / `voice_catalog_busy` / `voice_preview_unavailable`。服务端预览登记有效期为5分钟，目录30秒成功缓存；失效可明确重试目录。

## 生命周期与选择

- 菜单加载、未配置、空库、无搜索匹配、失败重试和分页都可见；输入先过滤当前真实列表，再按250ms防抖向服务端搜索。
- 每个菜单请求有 AbortController 和递增版本；关闭、换节点/模型、换 provider、销毁确认卡取消未完成读取，忽略迟到数据。
- 两个入口试听全局互斥；关闭/选择/搜索中止试听，暂停 audio 并回收 object URL。迟到 Blob 和 play Promise 不恢复播放。
- 节点选择保存 `audioConfig.params.voice_id`，`AudioAPI.buildRequest` 原样提交；Agent 选择保存 `confirmationDraft.voice`，原 `audioRequestConfig` 转换为 `parameters.voice_id`。没有伪造音色列表或试听文件，没有新增生产依赖。

## 专项 QA 与验证

生产入口独立 QA：`/src/features/audio-voices/qa/voices.html`。它使用真实 AudioAPI、真实 Agent card、真实同源目录/试听，在内存中隔离节点/trace，既不改主画布用户存储，也不派发生成。可核对实际请求 URL/status/MIME、两处所选 voice_id、关闭卡片与切换节点。日志在 `window.voiceCatalogQA.audit`。

后端独立合同 fixture listener 使用同一 QA 时，URL 必须加 `?fixture=local-contract`；页面显著标明“本地合同fixture与真实WAV，非真实供应商音色”，不能作为真实 ElevenLabs 能力验收。

QA 源级 `Audio` subclass 保留原生构造与播放，把真实元素挂到可见 controls 区域；仅监听浏览器实际 `loadedmetadata`、`playing`、`timeupdate`、`ended`、`pause`、`error`，在 audit 中记录 duration/currentTime。没有伪造事件或播放进度。生产菜单本身不改为 QA 控件。

```sh
node --test tests/audio-voice-catalog.test.cjs tests/audio-menu-lifecycle.test.cjs
```

19/19 定向检查通过：同源目录/分页/错误/迟到保护和搜索取消、真实 MIME 试听、跨入口互斥与 URL 释放、菜单原生命周期、节点及 Agent 稳定 ID 进入请求。5 个修改生产/QA JS 语法检查通过。自动测试中的 fixture 明确只验证合同，不是供应商成功产物。没有跑全套、没有提交。

主任务已重启4173生产服务：无 Key 请求目录返回503及 `voice_catalog_configuration_required`，不再是接线前的404。真实 Key 下目录/试听以及实际供应商合成仍须最终验收，不把未配置或本地 fixture 当成成功。

主任务在独立127.0.0.1合同 fixture 的新鲜 CUA：目录200、试听200 audio/wav；可见原生音频 `loadedmetadata.duration=2`、`playing.readyState=4`，实际 `timeupdate` 从0.164→0.450→…1.776→2，随后原生 `ended=true`。节点选择440、Agent选择660，经真正 `AudioAPI.buildRequest` 分别得到 `parameters.voice_id=qa_voice_440/qa_voice_660`，模型均为 `eleven_v3`。这些是本机受控目录和真实WAV的接线/播放证据，明确不代表供应商成功。QA日志现在限高滚动，已释放 source 的音轨隐藏，真实审计保留，正常视口截图由主任务补记。

追加 CUA：试听后按 Escape 关闭菜单，真实 `native-audio-released` 事件出现，入口恢复折叠与焦点。正常视口证据为 `/tmp/freenow-voice-catalog-final-20261003.png`。
