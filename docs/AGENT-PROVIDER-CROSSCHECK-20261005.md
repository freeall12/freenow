# Agent 模型与 Responses 供应商核对 · 2026-10-05

本次检查以 `main@5d97ceb` 为基线，读取 README、AGENT-API、模型/思考目录、真实服务入口、SDK 传输、检查点及聚焦测试。已安装 OpenAI Node SDK 为 **7.20.0**。没有读取或使用真实供应商 Key，没有调用 TapNow 服务；下文“真实 HTTP”均指真实应用入口和 SDK 连接本机 loopback 协议模拟服务，**不能证明模型权限、联网供应商可用性或创作质量**。

结论：Agent 当前支持配置后的 Responses 协议，并没有“任意厂商 Key 解锁所有菜单”的能力。发现并修复一处续轮兼容缺口：Responses 输出原样回传会携带仅输出的 `created_by` 或 SDK 解析字段；现在通过已安装 SDK 的 `toResponseInputItems()` 仅规范化请求输入，保留完整本地检查点、推理密文、消息阶段、调用身份和顺序。正常恢复与取消已定向验证，强制杀进程后立即重启仍有基线存储失败。

## 官方与社区证据

检索日：2026-10-05。以下文档为当天实际获取的正文；模型能力和文档可能更新。

| 来源 | 核对到的具体证据 | 对本项目的含义 |
| --- | --- | --- |
| [OpenAI function calling](https://developers.openai.com/api/docs/guides/function-calling) | 工具用顶层 `type:function`、`name`、`parameters`；结果用 `function_call_output` 和原 `call_id`。`strict:false` 明确选择 best effort。严格模式需所有字段 required，optional 用 null，object 禁止额外属性。 | 本项目 95 个 domain function tools 使用 `strict:false`，保留本地递归校验及浏览器再次校验。没有把现有大量 optional 参数直接切成 strict，避免改变工具语义。 |
| [OpenAI reasoning](https://developers.openai.com/api/docs/guides/reasoning) | “Stateless mode applies when store is false”；当前文档说明此模式默认返回 `encrypted_content`，兼容旧 `include:reasoning.encrypted_content`，但不再必需；工具循环应回传所有 reasoning/function call/output。 | `store:false`、完整有序历史符合当前文档。此次没有添加旧 include 来冒充必需参数；供应商若不返回可重放推理项，必须另行验证，不能假设兼容。 |
| [OpenAI conversation state](https://developers.openai.com/api/docs/guides/conversation-state) | 支持手工 input-array chaining 或 previous_response_id；compaction 输出包含不透明记录。 | 项目采用本机手工历史及检查点，不依赖远程 stored Responses 或 previous_response_id。 |
| [OpenAI streaming](https://developers.openai.com/api/docs/guides/streaming-responses) | `stream:true` 使用 SSE typed events，含 output_text delta、completed、failed/error。 | SDK 接收 SSE，本地浏览器接收应用 NDJSON；不是把 SSE 原样透传。完整 completed 之前的调用增量只显示，不执行。 |
| [OpenAI compaction](https://developers.openai.com/api/docs/guides/compaction) | standalone `/responses/compact` 返回 compacted output，密文不供人工解释；也有独立的 server-side context_management 模式。 | 本项目使用 standalone compact，按字符启发式阈值触发，验证用户输入不变；未宣称支持 server-side 自动 compact。提供方不支持时保留原历史并禁用重复尝试。 |
| [OpenAI Node SDK README](https://github.com/openai/openai-node/blob/11b9283f2a22737e273ccc1593d01af5cf584a0b/README.md) / [规范化实现](https://github.com/openai/openai-node/blob/11b9283f2a22737e273ccc1593d01af5cf584a0b/src/lib/responses/ResponseInputItems.ts) | README 要求手工历史保留所有 output，并使用 `toResponseInputItems`。源码去掉 created_by、parsed_arguments、parsed，保留 reasoning 和 phase；SDK 默认会重试两次，可设置 maxRetries:0。 | 修复直接复用已安装 7.20.0 helper，没有加依赖。Responses create/compact 和保护层明确 maxRetries:0；不自动重发未知结果。 |
| [LangChain.js Responses 专用实现](https://github.com/langchain-ai/langchainjs/blob/71ede02def46cc009807130227e22adab44f4cd3/libs/providers/langchain-openai/src/chat_models/responses.ts) | 单独构造 Responses 参数、映射 reasoning、调用 `client.responses.create`；备注避免 SDK 与框架两层 retry 相乘。 | 社区成熟实现也区分 Responses 协议及 retry 所有者；单纯换 baseURL 不会自动转换原生 Claude/Gemini 等协议。该仓库 MIT，本次只核对源码，没有集成依赖。 |
| [LiteLLM Responses 路由](https://github.com/BerriAI/litellm/blob/e1d16f51d14849c1b3decf17cd81a3bcb4863dca/litellm/proxy/response_api_endpoints/endpoints.py) / [许可证](https://github.com/BerriAI/litellm/blob/e1d16f51d14849c1b3decf17cd81a3bcb4863dca/LICENSE) | 专门声明遵循 Responses spec 的 `/v1/responses`、`/responses` 路由，并单独处理背景模式等参数。非 enterprise 目录 MIT，enterprise 有另行许可。 | 可作为需要自行配置/验证的 Responses facade 参考，不是已接入项目的组件；不能从其路由存在推断所有模型支持 reasoning、工具、密文、compact 或同样取消语义。 |

## 全部模型菜单映射

20 个可见项（含 Auto）及 1 个历史别名。名称、图标和思考选项来自本地官方采集目录，属于**展示别名**，不是 OpenAI 或其他厂商的已确认模型 ID。测试把每个别名明确映射成 `fixture-<alias>`，验证实际 `/v1/responses` 收到该值，没有验证表中名称对应的真实模型身份。

| UI 名称 | 本地别名 | 必需路由 | 思考设置 |
| --- | --- | --- | --- |
| Auto | `auto` | `OPENAI_MODEL` | 不发送 reasoning（无可调控件） |
| G 3.8 Flash | `g-3-8-flash` | `AGENT_MODEL_MAP["g-3-8-flash"]` | 不发送 reasoning（无可调控件） |
| TapNow G-6 L | `tapnow-g-6-l` | `AGENT_MODEL_MAP["tapnow-g-6-l"]` | 默认 medium；low/medium/high/xhigh/max；不可关闭 |
| TapNow G-6 S | `tapnow-g-6-s` | `AGENT_MODEL_MAP["tapnow-g-6-s"]` | 默认 medium；low/medium/high/xhigh/max；不可关闭 |
| Deepseek V4.1 Flash | `deepseek-v4-1-flash` | `AGENT_MODEL_MAP["deepseek-v4-1-flash"]` | 默认 high；low/high/max；不可关闭 |
| TapNow O-5.5 | `tapnow-o-5-5` | `AGENT_MODEL_MAP["tapnow-o-5-5"]` | 不发送 reasoning（无可调控件） |
| TapNow O-5 | `tapnow-o-5` | `AGENT_MODEL_MAP["tapnow-o-5"]` | 默认 high；low/medium/high/xhigh/max；不可关闭 |
| TapNow S-5 | `tapnow-s-5` | `AGENT_MODEL_MAP["tapnow-s-5"]` | 默认 high；low/medium/high/xhigh/max；可关闭 |
| TapNow S-4.6 | `tapnow-s-4-6` | `AGENT_MODEL_MAP["tapnow-s-4-6"]` | 默认 medium；low/medium/high/max；可关闭 |
| TapNow O-4.8 | `tapnow-o-4-8` | `AGENT_MODEL_MAP["tapnow-o-4-8"]` | 默认 high；low/medium/high/xhigh/max；可关闭 |
| TapNow O-4.7 | `tapnow-o-4-7` | `AGENT_MODEL_MAP["tapnow-o-4-7"]` | 默认 high；low/medium/high/xhigh/max；可关闭 |
| TapNow O-4.6 | `tapnow-o-4-6` | `AGENT_MODEL_MAP["tapnow-o-4-6"]` | 默认 medium；low/medium/high/max；可关闭 |
| TapNow F-5.1 | `tapnow-f-5-1` | `AGENT_MODEL_MAP["tapnow-f-5-1"]` | 默认 high；low/medium/high/xhigh/max；不可关闭 |
| TapNow F-5 | `tapnow-f-5` | `AGENT_MODEL_MAP["tapnow-f-5"]` | 默认 high；low/medium/high/xhigh/max；不可关闭 |
| TapNow G-6 A | `tapnow-g-6-a` | `AGENT_MODEL_MAP["tapnow-g-6-a"]` | 默认 medium；low/medium/high/xhigh/max；不可关闭 |
| TapNow G-5.6 S | `tapnow-g-5-6-s` | `AGENT_MODEL_MAP["tapnow-g-5-6-s"]` | 默认 medium；low/medium/high/xhigh/max；不可关闭 |
| K 2.7 | `k-2-7` | `AGENT_MODEL_MAP["k-2-7"]` | 不发送 reasoning（无可调控件） |
| TapNow O-5（历史别名，菜单隐藏） | `tapnow-o-5-2` | `AGENT_MODEL_MAP["tapnow-o-5-2"]` | 默认 high；low/medium/high/xhigh/max；不可关闭 |
| TapNow G-5.6 L | `tapnow-g-5-6-l` | `AGENT_MODEL_MAP["tapnow-g-5-6-l"]` | 默认 medium；low/medium/high/xhigh/max；不可关闭 |
| TapNow G-5.6 T | `tapnow-g-5-6-t` | `AGENT_MODEL_MAP["tapnow-g-5-6-t"]` | 默认 medium；low/medium/high/xhigh/max；不可关闭 |
| K 2.6 | `k-2-6` | `AGENT_MODEL_MAP["k-2-6"]` | 默认 enabled；enabled；可关闭 |

- Auto 只使用 `OPENAI_MODEL`；其显示“平衡速度/成本”不表示已有模型自动选择器，也不验证能力或价格。
- 指定别名必须存在于 `AGENT_MODEL_MAP`；未映射返回 `configuration_required`，不回退 Auto。历史 `tapnow-o-5-2` 仅供已有锁定会话读取，菜单不列出。
- 可调思考默认值会随 UI 选择发送；每个 enabled/level/off 必须另外存在于 `AGENT_REASONING_MAP[alias]`。UI `max` 不保证供应商原生支持 `max`：可以明确映射为其支持的 effort（fixture 映射 high），未映射拒绝。
- `g-3-8-flash`、`k-2-7` 的采集 metadata 不可切换，现 UI 不发送 reasoning；`tapnow-o-5-5` 没有采集思考配置，同样不发送。不能从默认 enabled 元数据推断请求已设置提供方参数。
- 一个 start 解析后的 model/reasoning 固定于服务端 session，continue 不重新读取前端偏好。已有对话锁定起始别名；旧对话缺失起始别名时要求新建，不从当前全局偏好猜测。

## OPENAI_BASE_URL 兼容边界

| 条件 | 实际边界 |
| --- | --- |
| 配置 | `OPENAI_API_KEY` 与 `OPENAI_MODEL` 必填；baseURL 可选，默认 OpenAI `/v1`。进程环境启动时读取，修改需重启。`/api/agent/config` 是本地配置检查，返回 configured 不发供应商请求，不验证 Key/模型权限。 |
| 路径与鉴权 | SDK 向 baseURL 下的 `/responses`（及可选 `/responses/compact`）发 JSON POST，使用 Bearer Key。baseURL 应是服务 API 前缀，不应填完整 `/responses` 路径。本项目没有 native Anthropic/Gemini/DeepSeek Chat Completions 转换，也没有 Azure 专用部署/API-version/api-key 鉴权适配。 |
| 必需协议 | model、instructions、完整 input 数组、function tools、strict:false、store:false、max_output_tokens；有配置时 reasoning.effort。返回 Responses output 及规范 call_id；Chat Completions 的 choices/tool_calls 格式不能替代。 |
| 流式协议 | 必须支持 typed Responses SSE，最终 `response.completed` 带完整 output。只会发普通文字 token、[DONE] 或部分函数参数的兼容端点不够。浏览器端协议是 NDJSON，失败可能在 HTTP200 后由 error 行表达。 |
| 媒体 | 当前 Agent 支持真正 input_image（本地图片/视频采样帧），要求提供方支持对应多模态与格式；传媒体名字或填 LLM Key 不等于能理解视频或进行媒体生成。 |
| 推理与上下文 | effort、可重放 encrypted_content、phase 等兼容性依模型/网关而定。compact 是可选能力，失败保持历史；字符阈值不是 tokenizer，也不保证避免模型 context limit。新 user turn 只提交最近16条可见 user/assistant历史，不宣称跨会话持续推理。 |
| 取消 | 本地 AbortController 传到 SDK，cancel API 持久确认；断线关闭上游 HTTP已验证。不能保证所有网关实际停止后端模型计算或退款。不是使用提供方的后台 `/responses/{id}/cancel`。 |
| 目的地址 | 仅允许有效 HTTP/HTTPS API 地址；本机服务自身端口和原站目的地拒绝；网络重定向为 error。明确配置的自托管 loopback 可以使用。Key 保留服务端，响应中的凭据由保护层拦截。 |
| 独立能力 | OpenAI 内置 web_search/computer_use/生成工具未直接启用；Agent 域工具中的检索、生成等复用项目独立接口与配置。LLM Key 不配置图片/视频/3D 网关，也不提供这些厂商的鉴权。 |

## 修复与复现

变更仅有：

- `server/agent.cjs`：构造 create 请求时 `input:toResponseInputItems(s.input)`。
- `server/agent-compaction.cjs`：compact 请求同样规范化 head；存储原记录、边界、参数、回执身份不变。
- `tests/agent-provider-contract.test.cjs`：可重现的 loopback 服务及真实应用入口/SDK 断言，无正式4173监听冲突，每个 fixture 使用随机端口和临时独立存储。

回归 fixture 返回真实格式的 reasoning/message/function_call，包含 output-only created_by、SDK parsed 字段、phase、encrypted_content。模拟端点拒绝在后续 input 出现仅输出字段。修复前 JSON continue 400、SSE continue error；修复后二者完成，原 call_id、消息 phase、推理密文及 output 顺序保留。此 fixture 验证规范化契约，不是宣称真实 OpenAI API 在本机已实际返回这些字段。

```sh
node --test tests/agent-provider-contract.test.cjs tests/agent-compaction.test.cjs tests/agent-server-stream.test.cjs
node --test tests/agent-checkpoint-boundaries.test.cjs tests/agent-runtime-lifecycle.test.cjs tests/agent-resume-stored.test.cjs
node --test --test-name-pattern='retains original pending|restores child calls' tests/agent-checkpoint-http.test.cjs
node --check server/agent.cjs
node --check server/agent-compaction.cjs
node --check tests/agent-provider-contract.test.cjs
git diff --check
```

结果：第一组 **22/22**；第二组 **29/29**；第三组两项选定真实 HTTP 用例 **2/2**；语法和 diff 检查通过。

新 provider 测试实测：21 个目录项逐一发出正确路由/默认思考请求、所有可调思考档位要求明确映射、未映射别名在派发前503、配置查询不发模型请求、JSON/SSE规范化续轮、真实 `/responses/compact`、cancel API与浏览器断连关闭 SDK上游、部分工具不执行。恢复测试验证等待工具原 call_id、正常重启和无Key只读核对、重复回执只复用结果、配置变更阻断、unknown 不重发，以及父子任务规范结果聚合。

## 未通过项与验收限制

额外运行五个既有/新增相关文件时共25项，22通过、3失败。将本次两个服务文件恢复为 `HEAD@5d97ceb` 后，在独立临时树复跑旧 HTTP 文件，7项中4通过、相同3项失败，确认不是规范化修复引入；没有扩大为全套测试或修改生成存储。

1. `agent-checkpoint-http` 两项 SIGKILL 重启用例（父 SDK请求、子 SDK请求）在重新启动真实服务时报 `Local task stores unavailable; server was not started.`。纯 Agent 检查点/unknown 测试通过不能抵消这个真实入口缺口；本批无法宣称强杀进程恢复完全可用。
2. `agent-stream-http` 旧组合用例在 failed/EOF 时预期短 `text_delta`，实际只有 session/error。现有凭据保护层暂存可能跨 delta 拼接凭据的尾段，未完成响应时不放出短尾段；该预期在基线同样失败。本次新长增量取消/断连用例独立验证真实上游关闭。
3. 无真实 Key，所以真实提供方鉴权/额度/权限、每个菜单别名真实模型身份、effort参数支持、外部SSE/密文/compact一致性、输出质量、账单取消效果与长链创作表现均未验收。没有“所有厂商都兼容”的结论。
