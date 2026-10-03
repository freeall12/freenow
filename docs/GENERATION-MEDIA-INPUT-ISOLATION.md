# 生成任务的原站媒体输入隔离

供应商请求体中的媒体 URL 也可能触发供应商取图。只拦截本机 `fetch` 目标无法覆盖 `image_url: https://files.tapnow.media/...` 这一类依赖。服务端现复用 `generation-endpoint-policy.cjs` 的原站域名与主机规范化规则，在任务保存前、准备前及准备后拒绝这些媒体输入，早于 `provider.prepare` 和 `submit`。

## 合同

- 输入：`inputs`、`references`；`parameters.refs`、`parameters.subjects[].assets`、`parameters.draftEstimateMedia.{images,videos,audios}`。
- 字段：上述列表的 URL 字符串，或非 `type: text` 对象中的 `url/image/fullImage/video/audio/model/poster/sourceUrl/sourceVideoUrl`。
- 输出：返回原请求对象，不转换、不改写媒体或提示词。
- 权限：无网络、磁盘、凭据或供应商调用；只检查已声明的媒体地址。
- 失败：`original_service_blocked`，`status: 400`，`providerDispatched: false`；直接持久任务提交不保存拒绝的请求。准备流程后来产生的原站媒体会走已有任务准备失败状态。
- 日志：不增加 URL、查询参数或请求体日志。

识别原站和子域、大小写、尾点、现有别名及协议相对地址。独立域名、本地路径、`asset:`、`blob:`、`data:` 的具体可用性仍由原适配器检查。`prompt`、文本输入、普通元数据及供应商参数中的任意文本不扫描。旧任务允许读取原记录；使用新的幂等键重新提交旧请求时仍须通过校验。已接收任务的 GET 恢复继续只查询原供应商任务，不重放 POST。

## 验证

```bash
node --test tests/generation-media-input-isolation.test.cjs
```

首轮专用 6 项通过，覆盖域名规则、准确字段、文本和本地输入保留、准备/提交/存储零调用、准备后重新校验、旧记录重新提交以及真实本地 HTTP tasks-v1 入口与重启。独立复核随后发现带基准地址解析会将 `http:tapnow.media/image.png` 误当本地路径；现先独立解析，失败才回退到相对地址解析。新增 `http:`、单斜杠、反斜杠及 HTTPS 变体回归证明 native prepare/submit 与 tasks-v1 POST 均为零；本次限定运行新增项及相关 4 项，共 5/5 通过，未重跑 HTTP/重启项。所有供应商响应均为本地注入，未访问远端。

相关检查共 59 项，53 通过、6 失败。去除本批 durable/gateway 校验调用的加载器对照中，相关失败套件共 26 项，20 通过，仍为相同 6 个失败：Ark 恢复成功断言、durable 取消回执、存储输出失效、关闭时写入次数、视频来源恢复和 routed 恢复。它们涉及既有素材归档或取消合同，本次未修改旧 fixture；此结果不代表完整套件通过。
