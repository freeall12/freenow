# 音频生成与多结果

`native-profile.mjs` 使用生成服务的公共配置做供应商参数校验。Sonilo Music 的文字音乐及完整视频音乐使用 `sonilo-native`；Sonilo SFX 的 ThinkSound 显式替代保留独立协议。

Sonilo Music 单次任务支持 1–10 个 WAV 变体。Agent 确认卡展示实际数量、逐变体计费说明及完整分段 start / prompt / label；明确请求的视频音乐时长也会保留并展示，提交前必须与真实源视频时长一致。

`application.mjs` 将所有完成结果保存到来源音频节点的 `options`、`audioResultMetadata`、`audioHistory`，默认播放器展示首项；`resultIds` 指原位来源节点，数量不会等同于变体数量。

访问第二个结果：左侧“历史”→“音频”→该任务第二条结果的“预览”。点击该条主缩略图可将保存的音频应用为独立画布节点；也可“选择”两项后一起“应用到画布”。预览与导入保存素材均不提交新生成任务。当前没有音频节点内的变体切换控件。

同任务的历史结果按 `taskId:outputIndex` 独立保存。若测试 fixture 返回相同字节，媒体存储可以去重为同一 URL，而两条结果记录仍然保留。

离线启动、真实 MP4 / multipart / WAV 回执及验收步骤见 [Sonilo 原生 UI QA](../../../docs/SONILO-NATIVE-UI-QA-20261005.md)。该 fixture 不读取私人环境文件，不调用真实 Key 或模型；供应商账号权限与音乐质量仍需真实账号验收。
