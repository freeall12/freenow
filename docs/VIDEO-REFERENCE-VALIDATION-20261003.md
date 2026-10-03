# 视频参考时长与空参考提交

2026-10-03：统一参考时长检查，并在提交阶段把没有媒体或主体元素的全能参考投影为真正文生视频。显示中的节点配置不被修改；已有样片/正式片与 MiniMax 合同保留。

## 依据和行为

- 官方 `reference/canvas-current-readable.js:22275` 的 `Zv`：只有 `REFERENCE_TO_VIDEO` / `REFERENCE_VIDEO_TO_VIDEO`，且实际图片、视频、音频、`elementList` 和 `elementRefs` 都为空，才降为 `TEXT_TO_VIDEO`。普通上游文字不属于媒体，真实主体元素仍属于参考。
- 官方画布 `:31305` 的 `ome` 来自 `vendor-packages-CN3JnHbF.js` 导出 `fj`，对应 `Wde`。其条件为 `duration < min`、`duration > max + maxTolerance` 或 `sum > totalMax + maxTolerance`。容差只放宽上界。
- Seedance 2.5 普通/样片全能参考：每段视频至少 2 秒，最大 30 秒，总最大 30 秒，上界容差 0.2 秒。视频编辑单源至少 4 秒，最大 30 秒，上界容差 0.2 秒。其他模型使用其目录实际规则，不编造缺少的约束。

生产纯函数位于 `src/features/video-generation/reference-validation.mjs`。`settings.mjs` 保留界面选择，`prepareVideoRequest` 根据实际输入做提交投影，规范 `videoMode`、`variant` 与供应商 `modelType`，重复准备保持一致。

主体保护包括顶层/参数中的 `elementRefs`、`element_refs`、`elementList`，以及展开后的 `subjects` 和原主体提示快照。仅文字资产的主体展开后虽然没有媒体输入，仍保留参考模式。仅存于原 `providerParameters.elementRefs` / `element_refs` 的绑定，在重建供应商投影时保留，避免保持参考模式却丢掉真实元素。最终的原生能力支持仍由具体适配器验证。

正式片先经过既有样片身份校验，再投影固定 `draft_video_id` / 1080p，不带普通提示词、素材或元素，不能由通用空参考降级覆盖。样片仍强制 480p，正常参考素材快照保留。MiniMax 的显式模式/参数检查先于通用降级；不绕过其音频开关、参考素材和原生时长合同。

## 真实时长边界

节点 `referenceInputs` 通常没有时长；主体快照 `durationMs` 也可能过时。预备阶段只检查已有 `duration` 秒数能证明的违规，未知时长继续进入实际解码，主体快照毫秒值不当作权威证据。

`generation-media.mjs` 通过现有 `createWorkflowMediaResolver` 读取实际媒体后调用同一校验函数。这个边界严格要求有限且大于零的实际 `duration`；未知、非法、超单段或总时长均明确报错，并标记 `providerDispatched=false`。不能用目标生成时长、快照数值或估计值补造参考时长，也不会截短视频。检查在媒体传输和结果预留之前执行。

## 定向回归与独立审查

```sh
node --test tests/video-reference-validation.test.cjs tests/generation-media-preparation.test.cjs tests/generation-minimax-media.test.cjs tests/node-editor-minimax-defaults.test.cjs tests/video-draft-final-core.test.cjs tests/video-draft-final-gateway.test.cjs
```

29/29 相关测试通过；改动模块语法与 `git diff --check` 通过。覆盖严格下界、单段和总时长、未知/非法时长、解码更新过时主体快照、纯提交幂等、实际元素字段保留、样片/正式片及 MiniMax 回归。独立审查发现并修复 wire-only 元素丢失；审查者再执行 5 项对应目标测试通过，未发现新增具体问题。没有运行旧全量测试或真实供应商调用。

## 真实浏览器验收

入口：`http://localhost:4173/src/features/video-generation/qa/reference-validation.html?session=video-ref-live-1003`，点击“运行全部真实媒体诊断”。

该页面使用正式 `TaskService`、请求准备、真实 `LocalAssets`、浏览器原生视频 metadata 解码和生产媒体传输。捕获适配器仅记录准备后的请求，然后明确停止为 `qa_capture_only`；任务真实状态是 `failed`，诊断注明“未调用供应商，未生成结果”，不伪造模型生成成功。

主任务已通过 Computer Use 执行 9 场景，全部符合预期，控制台 warn/error 均为空：

| 场景 | 实际浏览器时长 | 传输 / 捕获适配器 | 结果 |
| --- | --- | --- | --- |
| 空全能参考 | 无媒体 | 1 / 1 | `TEXT_TO_VIDEO` |
| 文字主体 | 无媒体 | 1 / 1 | `REFERENCE_TO_VIDEO`，主体快照保留 |
| wire-only 元素 | 无媒体 | 1 / 1 | `REFERENCE_TO_VIDEO`，元素字段保留 |
| 下界不足 | 1.9 秒 | 0 / 0 | 严格拒绝，不放宽最小值 |
| 下界 | 2 秒 | 1 / 1 | 准备后捕获 |
| 上界容差 | 30.2 秒 | 1 / 1 | 准备后捕获 |
| 超上界 | 30.25 秒 | 0 / 0 | 单段时长拒绝 |
| 总上界容差 | 15.1 + 15.1 秒 | 1 / 1 | 准备后捕获 |
| 超总时长 | 15.15 + 15.15 秒 | 0 / 0 | 总时长拒绝 |

合成素材是同源 H.264 64×48、20 FPS、无音轨的棕色静态画面，6 个文件合计 35,548 字节。`src/features/video-generation/qa/media/manifest.json` 记录生成方式、ffprobe 实测、文件大小和 SHA-256，页面再核对原生解码时长和尺寸。不是模型生成质量样本。偏好使用页内 Map，素材库使用独立 session 的 IndexedDB，没有删除其他存储。

截图位于开发机 `/tmp/freenow-video-reference-validation-20261003.png`，公开仓库不依赖此文件。此验收证明生产准备和真实解码边界，不能据此证明真实供应商账号权限、生成质量或官方界面像素一致。补录浏览器结果后冻结本批代码和文档，未重跑测试。
