# 生成供应商路由契约

`server/generation-router.cjs` 导出 `createGenerationRouter({providers,routes,fetchImpl})`，复用现有原生适配器，并提供有界的 `tasks-v1` 异步适配。它只选择运维配置中的供应商，不接收浏览器提供的目的地址或凭据。

```js
providers = {
  native: {protocol: 'openai-native', apiKey, modelMap},
  video: {protocol: 'ark-native', baseUrl, apiKey, modelMap},
  tasks: {protocol: 'tasks-v1', baseUrl, apiKey}
};
routes = {
  'image.generate': {default: 'native', models: {'public-image-alias': 'native'}},
  'video.generate': {models: {'public-video-alias': 'video'}},
  'world.generate': 'tasks'
};
```

模型别名取 `request.parameters.providerParameters.model ?? modelId ?? model`。操作 kind 与别名均精确匹配。别名没有单独路由时仅使用显式 default。已选择供应商缺少配置、别名、操作能力或请求失败时不切换供应商。原生 `image.recognize`、`video.analyze` 未提供别名时使用操作 kind 作为原生映射别名。

公开配置返回 `protocol: 'routed'`、`providers` 与规范化 `routes`。供应商保留现有能力元数据；原生供应商补充 `capabilities.models = {publicAlias: {kind}}`，供页面在媒体处理前验证请求。配置不返回 Key、供应商地址、真实模型 ID 或恢复身份指纹。结构无效时路由整体禁用，供应商原生配置不完整时仅禁用相应供应商。

## 方法与边界

| 方法 | 输入 | 输出 | 失败行为 |
| --- | --- | --- | --- |
| `prepare` | 完整生成请求 | 原请求 | 验证凭据字段、路由和选定适配器能力；不会提交模型 |
| `submit` | 请求、可选 AbortSignal | 单次提交回执 | 不重试 POST；未确认提交保持 unknown |
| `generate` | 请求、AbortSignal、进度/身份回调、轮询预算 | 实际结果 | 原生同步执行或有界异步轮询；不会重新提交 |
| `poll` | 原始接受回执的 opaque ID | 原 opaque ID 与最新回执 | 只查询身份中的原供应商；身份/配置不符时停止 |
| `cancel` | 原 opaque ID、AbortSignal | 已确认 cancelled 或 unknown | 只有任务身份吻合且状态为 cancelled 才确认远端取消 |
| `protocolFor` / `isPollable` | 请求 | 协议或 null / 布尔值 | 不产生网络请求 |

异步 opaque ID 含供应商标识、供应商配置指纹与原供应商任务 ID。路由表调整不会影响原任务查询。原供应商配置变更会阻止恢复；Key 轮换不改变供应商身份。Ark `sourceFileId` 仍保留供应商原始任务 ID，以支持样片转正式片。同步 OpenAI 原生任务不创建伪远端 ID。

`tasks-v1` 每次 HTTP 操作最长 30 秒，取消最长 5 秒，JSON 响应最多 1 MiB，完整提交请求最多 64 MiB。请求使用 `redirect: 'error'`，响应流与 fetch 均受 AbortSignal 限制。错误消息固定且不回显上游私密信息。任务网关返回的 `providerDispatched: false` 或本机视频错误代码不能证明本机准备失败；只有选定 OpenAI 原生适配器可使用可信本机错误分类。

持久记录保存接受的 opaque ID 与稳定的 `routing-v1` 契约指纹。重启后只能 GET 原 ID；无原 ID 的 unknown 任务不会重新 POST。活动同步任务的 GET 返回已有快照。执行证据记录在现有持久服务的 submissionState、providerTaskId、providerFingerprint 与取消回执中。

验证命令：

```bash
node --test tests/generation-router.test.cjs tests/generation-durable.test.cjs tests/generation-openai.test.cjs tests/generation-ark.test.cjs
```

测试全部使用 mock 客户端与本地合成响应，不调用真实模型。
