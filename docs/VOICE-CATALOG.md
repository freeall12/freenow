# 真实音色库与同源试听

当前只接 ElevenLabs 官方只读音色目录。节点和 Agent 共用本机接口；供应商 Key 只由服务器 ENV 读取，不进入浏览器设置、响应、日志或任务持久化。音色目录配置不表示 ElevenLabs 生成路由已经接通，也不表示 Key 拥有付费生成权限。

## 配置

使用私有 ENV 文件或 shell 环境启动已有服务；`.env.example` 不会自动加载。

```bash
VOICE_CATALOG_PROVIDER=elevenlabs
ELEVENLABS_API_KEY=YOUR_PRIVATE_KEY
ELEVENLABS_API_BASE_URL=https://api.elevenlabs.io
```

`ELEVENLABS_API_BASE_URL` 必须是 origin，不带 `/v1`、凭据、查询参数或 fragment。可由操作员配置兼容服务；原站域与当前本机监听器均禁止。未知供应商、无 Key、非法配置均返回 503；不使用硬编码音色或假成功回退。

## 浏览器合同

```text
GET /api/generation/voices?model=eleven_v3&pageSize=100&search=中文&cursor=NEXT_CURSOR
GET /api/generation/voices/VOICE_ID/preview?model=eleven_v3
HEAD /api/generation/voices/VOICE_ID/preview?model=eleven_v3
```

`model` 支持 `eleven_v3`、`elevenlabs-v3`、`elevenlabs`，统一返回 `eleven_v3`。其他模型返回 503 `voice_catalog_model_unavailable`。列表默认每页 100，允许 1–100；search 最多 200 字符，cursor 最多 2048 字符。官方第一页可能额外带默认音色，本机允许至多 200 个完整条目，不截断破坏分页。客户端必须依据 `hasMore` 和 `nextCursor` 请求后续页。

```json
{
  "configured": true,
  "provider": "elevenlabs",
  "model": "eleven_v3",
  "voices": [{
    "id": "REAL_PROVIDER_VOICE_ID",
    "name": "供应商实际名称",
    "labels": {"language": "zh"},
    "category": "premade",
    "description": "供应商实际说明",
    "previewRef": "REAL_PROVIDER_VOICE_ID",
    "previewUrl": "/api/generation/voices/REAL_PROVIDER_VOICE_ID/preview?model=eleven_v3"
  }],
  "hasMore": false,
  "nextCursor": null
}
```

上面是字段示例，不是内置音色。缺失供应商 `preview_url` 时不返回 `previewRef`/`previewUrl`，菜单应禁用试听。私有 sharing、email、verification、settings 等字段不返回。`id` 为供应商真实 `voice_id`，不映射成另一家供应商的声音；生成仍遵循已有 generation 的路由和能力检查。

试听只能按已取目录登记的 ID 请求，不接受浏览器提供的 URL。成功返回真实 `audio/mpeg` 或 `audio/wav`、`Content-Length` 与字节，支持单 Range、HEAD；不返回 CDN 重定向。试听文件全部通过媒体格式、长度和完整流校验后才发送；MP3 必须具备完整 Layer III 帧，WAV 必须具备一致的 16 位 PCM 参数和数据块。其他格式本批明确拒绝。目录刷新移除或改变试听时，旧下载不发布、不缓存。浏览器取消 fetch 后，本机取消在途目录请求或音频下载。

| HTTP | code | 行为 |
| --- | --- | --- |
| 503 | `voice_catalog_configuration_required` | 服务端未配置、供应商未知或配置被拒绝 |
| 503 | `voice_catalog_model_unavailable` | 模型未接入此真实音色库 |
| 400 | `voice_catalog_invalid_input` | 参数超限或格式无效 |
| 404 | `voice_preview_unavailable` | 无现成试听、登记过期或目录已变化；刷新目录后重试 |
| 429 | `voice_catalog_busy` | 在途读取达到上限 |
| 502 | `voice_catalog_upstream_failed` | 上游请求/认证失败；固定信息，不回显错误正文 |
| 502 | `voice_catalog_response_rejected` | 凭据回显、目的域、音频或目录校验失败 |
| 504 | `voice_catalog_timeout` | 20 秒读取期限到达 |

## 出站与内存限制

- 目录实际请求 `GET <origin>/v2/voices`，`xi-api-key` 仅发到配置的目录 origin。关闭重试与所有 HTTP 重定向；JSON 响应最多 1 MiB，公开字段和原始 JSON 均检查 Key 与 URL percent 编码回显。
- 试听只下载目录中已有公开 CDN 文件，沿用 `generation-media-download.cjs` 的 DNS、公网地址、连接固定、原站域、redirect、格式和完整流保护，不携带 Key/cookie。最多 8 MiB/文件；音频元数据中的 Key 回显同样拒绝。
- 全部目录/试听最多 4 个在途读取；成功目录缓存 30 秒/20 页，试听登记 5 分钟/1000 条，成功音频缓存 60 秒/32 项/总计 24 MiB。失败结果不缓存、不冒充空目录成功。音频 HTTP 使用 `no-store`；缓存只在本机服务内存，不落盘。
- 没有创建、克隆、添加、删除音色、训练、TTS POST 或其他外部变更。没有现成试听就明确 unavailable，不为试听触发收费生成。

## 官方依据与验证

2026-10-03 直接 HTTP 阅读官方公开 [OpenAPI](https://api.elevenlabs.io/openapi.json)，核实 `GET /v2/voices` 的 `page_size <= 100`、`has_more`/`next_page_token`、`xi-api-key` 与 `VoiceResponseModel.preview_url`；`total_count` 是变化快照，官方建议分页依赖 has_more，本机不使用 total_count。官方现有 sample 音频读取接口也已核实，但本批仅接公开 preview_url，无 preview_url 时明确不可试听。

```bash
node --test tests/voice-catalog.test.cjs
node --check server/voice-catalog.cjs
node --check server/server.cjs
```

专测使用合成 Key、loopback 目录 fixture 和实际 24 kHz 正弦 WAV 字节，覆盖只读请求、分页、字段隐私、原站/redirect/Key echo 拒绝、真实字节代理、Range/HEAD、缓存、取消、deadline、并发与目录刷新。没有读取用户真实 Key、没有调用付费供应商；真实账号权限和音色试听仍需配置后的联调。前端菜单及 Agent 浏览器验收另行记录，不能从后端测试声称完成。

音色后端专测 11/11 通过。为复用媒体验证器，相关 `generation-openai-speech.test.cjs` 也运行：7/8 通过，已有 durable Speech 回执测试在 `unknown` 与 `succeeded` 上失败；将 speech 模块替换为 Git HEAD 版本后独立复现同一失败。本批只增加两个验证器导出，不改旧 speech 调用逻辑；此基线问题未在音色任务中扩展处理。

独立浏览器合同 fixture 可执行 `node scripts/qa-voice-catalog.cjs`，脚本打印备用 loopback URL；追加 `?fixture=local-contract` 打开专属 QA。它使用真实 catalog HTTP handler 与生产音频校验器，读取独立 loopback 的合成音色目录和两个实际两秒 WAV 文件；页面明确标注非真实供应商。`/api/qa/voice-audit` 可追踪本机读取和字节长度。不读取 ENV、不修改主 4173 服务或用户存储、不发起生成；该 fixture 证明合同和播放路径，不证明供应商权限或声音质量。
