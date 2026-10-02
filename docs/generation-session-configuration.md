# 本机生成连接配置

“连接 API”中的 tasks-v1 地址和可选 Key 交给本机 Node 服务执行。浏览器只向同源 `/api/generation` 发送任务；供应商响应先交给现有私有媒体存储，完成后发布本机素材 ID。Key 只存在本机进程的配置版本中，不写入配置文件、任务 JSON、日志或公开配置。上游回显 Key 的会话任务响应会被拒绝，避免把凭据作为任务身份或结果保存。

这项配置只选择用户填写的 tasks-v1 网关，不推断或切换其他供应商。空 Key 适用于用户明确配置的无认证自托管端点，此时不会发送 Authorization。环境变量和现有多供应商路由继续保留原合同。

## HTTP 合同

`GET /api/generation/config` 返回既有能力 metadata，以及：

```json
{
  "configured": true,
  "protocol": "tasks-v1",
  "source": "session",
  "configurationId": "opaque-version-uuid",
  "csrfToken": "opaque-process-token",
  "recovery": true
}
```

不返回供应商地址、Key、内部指纹或原生真实模型 ID。`configurationId` 是非秘密的版本标识，用于把媒体准备采用的能力配置与实际提交对应起来，不能代替 CSRF token。环境配置的版本 ID 在每次启动时更新。

`POST /api/generation/config` 必须来自本机当前端口、同源 Origin，采用 `Content-Type: application/json` 和 `X-Generation-Config-Token: <csrfToken>`。输入只接受以下两种：

```json
{"baseUrl":"http://localhost:9182/v1","apiKey":""}
```

```json
{"mode":"environment"}
```

成功返回 200 和同形 metadata。配置 body 最多 16 KiB；地址最多 4096 字符，Key 最多 8192 字节。额外字段、控制字符、地址中的用户凭据/查询参数/片段不接受。拒绝原站域及其子域，也拒绝本应用当前 loopback 监听端口以阻止递归；明确填写的其他本机自托管端口允许使用。写入失败只返回固定错误，不回显输入。会话最多保留 100 个版本，达到上限后拒绝新增，保留在途任务所需的旧版本。

新任务可用 `X-Generation-Configuration-Id: <configurationId>` 固定准备阶段取得的版本；未知或重启前的版本返回 `409 configuration_changed` 和 `providerDispatched:false`，不会创建任务或提交供应商。旧客户端未提供该 header 时，仍按创建持久任务时的当前版本提交。幂等键重复返回原任务，不更换其配置版本。

未启用私有持久任务目录的旧构造保留 GET/任务合同，但写配置返回 `409 recovery_unavailable`，防止启用绕过素材本机化的连接。

## 在途任务与恢复

每个新持久任务保存内部 `providerBinding = {version,source,id,fingerprint}`。指纹只取规范化端点和协议等非秘密身份，不含 Key。环境 tasks-v1 原有端点指纹和 routed 原有 opaque task identity 继续兼容。

同一进程 A → B → 环境配置的切换只改变新任务的选择。旧任务的异步准备、POST、GET、DELETE 和过期素材链接刷新继续使用其绑定版本。即使 A、B 地址相同但 Key 不同，也保留各自 Key 版本。多个任务共享原有唯一的 durable service、mediaStore 和 ownsResource 门；切换配置不另建媒体所有权域。

进程重启后不会恢复内存 Key。已接受的会话任务必须重新提供相同端点的配置后，才能 GET 原供应商任务 ID。填写其他地址不能接管旧任务。原任务首次匹配恢复后，本进程会固定这次重新提供的 Key 版本，后续同端点的 Key 轮换也不会改动该恢复身份。queued 未派发任务被标记为未开始；派发结果不明且没有原远端 ID 的任务保持 unknown；恢复从不重新 POST。已保存的实际本机素材可继续读取；私有已完成结果只恢复下载，过期描述符只能查询原任务刷新。

生产 gateway/router 对所有生成协议统一拒绝原站网络目标并禁止 HTTP redirect；Key 不会随重定向转发。注入的真实 OpenAI SDK 使用受保护 fetch 的独立副本，SDK baseURL 参与端点身份，矛盾地址配置被禁用。会话响应最多 1 MiB，单次查询最长 30 秒，取消最长 5 秒，错误不回显上游私密消息。

## 验证

```bash
node --test tests/generation-session-config.test.cjs tests/generation-media-durable.test.cjs tests/generation-media-gateway.test.cjs tests/generation-media-http.test.cjs tests/generation.test.cjs tests/generation-routing-config.test.cjs tests/generation-openai.test.cjs
```

测试使用合成供应商响应、临时私有目录和本机 HTTP fixture，不读取真实 `.env` 或 Key，不调用真实模型。
