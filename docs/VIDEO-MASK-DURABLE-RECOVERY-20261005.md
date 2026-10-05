# Video mask durable preparation recovery

本次范围：`server/generation-durable.cjs` 中 `fal-video-mask-native` 的素材准备、原任务身份持久化和显式恢复。供应商实现、上传和媒体准备模块分别由对应 owner 维护，factory/router 由 root 接线。

## 私有 checkpoint

`providerPreparation` 只允许以下字段，禁止 URL、签名链接、Key、私有 manifest 路径、音频 URL、upload receipt 或真实字节：

```js
{
  version: 1,
  protocol: 'fal-video-mask-native',
  preparationId: 'UUIDv4',
  kind: 'video.erase', // 或 video.replace
  stage: 'media-preparing',
  status: 'preparing',
  requestHash: 'SHA256 of the canonical full preparedRequest',
  routing: { providerId: 'original', providerFingerprint: '64 lowercase hex' }
}
```

`routing` 可省略；router 添加并验证原 provider 身份，native provider 收到前由 router 去除。durable 只做 schema 检查，并禁止已记录 preparationId 或 routing 变化。请求 hash 使用递归排序对象字段后的完整 prepared request，不只绑定 source/mask。

| stage | status |
| --- | --- |
| media-preparing | preparing |
| media-ready | ready |
| upload-initiating | dispatching |
| upload-initiated | confirmed |
| uploading | dispatching |
| uploaded | confirmed |
| generation-dispatching | dispatching |
| generation-accepted | confirmed |
| unknown | unknown |

schema 会拒绝额外字段、accessor、symbol 字段、错误 hash、错误 stage/status。启动遇到损坏的准备记录以 `storage_corrupt` 关闭恢复入口。

## Provider 调用合同

durable 给 `submit`、`poll`、`resumePreparation` 传入以下 options：

```js
{
  signal,
  localTaskId,
  request: preparedRequest || request,
  preparationState: providerPreparation,
  onPreparationState: async state => { /* await durable write */ },
  onTaskIdentity: async id => { /* await durable write */ }
}
```

provider 必须 await callback，并保留 callback exception。每个素材阶段的 durable write 完成后才能执行下一次上传或模型 POST；原任务 ID write 完成后才能 poll 或进行结果媒体/音轨后处理。存储失败在当前进程中保持 `storage_error`，即使 provider 将 callback exception 包裹成连接错误，也不能重新开启网络恢复。

取消或关闭后，下一次准备 checkpoint 被拒绝。取消后刚得到的原任务 ID 仍可持久化，仅用于原任务 DELETE；不接受结果或继续 poll。

## 恢复边界

无原任务 ID 的 `resumePreparation` 必须只读取同一私有 manifest，不上传、不 POST、不 poll，不返回 outputs。它只能返回 `{status:'unknown'}` 或 `{id:原任务ID,status:'queued'|'running'}`。

启动不会自动调用该恢复入口。显式 `get` / `lookup` 读取证据；没有 ID 时保持 `preparation_unconfirmed`，发现 ID 时先持久化，再 GET 原 ID。安全校验禁止完整 URL、query、fragment、空白/control 等成为任务 ID。不得改 route 或重新提交生成。

已有 provider success 的媒体下载恢复沿用原有规则；该行为不代表重新上传输入或创建模型任务。

## 本地失败分类

仅可信 `fal-video-mask-native` 的 `video.erase` / `video.replace`，无原任务 ID 且携带 `providerDispatched:false` 的以下 code 可记录为明确 `failed`：

- `unsupported_generation`
- `invalid_video_mask_media`

固定文案为“视频遮罩素材未通过准备校验，尚未提交模型生成”，不回显 raw error。`providerDispatched:false` 仅表示模型未提交；保留原准备阶段，因此不能推断此前未上传。其它协议、任意 code、已记录原任务 ID、普通上传/POST 不确定性仍使用 `unknown`。

`providerPreparation` 属于私有字段，public job projection 必须隐藏；原准备记录与供应商的真实 manifest 分别由 durable store 与 provider staging 保存。

## 验证

2026-10-05 fresh focused checks：

```sh
node --test tests/generation-durable-preparation.test.cjs tests/generation-media-durable.test.cjs
# 21 / 21 passed
node --check server/generation-durable.cjs
node --check tests/generation-durable-preparation.test.cjs
# passed
```

新准备测试 10 项覆盖 checkpoint 写失败、ID 先落盘、重启只读证据、原 ID GET、严格 schema 与身份绑定、取消/关闭、有限失败 code、被包裹的存储错误、完整 prepared request 和非法恢复回执。媒体 durable 既有测试 11 项通过。

另定向运行 `generation-durable.test.cjs`、`generation-media-durable.test.cjs`、`generation-durable-world.test.cjs` 共 27 项：18 pass / 9 fail。失败涉及旧测试期待远程媒体直接成功但未配置 materializer、late success 仍期待 DELETE confirmed、旧损坏 outputs code 等既有媒体合同；本批未改这些测试或放宽媒体规则。root 负责基线确认。这不是全库通过的声明。

本批无真实 provider、上传、浏览器、真实 DB、依赖安装或 Git 操作；不会将 fake-provider 测试描述成真实网络验收。
