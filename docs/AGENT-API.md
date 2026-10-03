# 本地 Agent 和模型接口

运行 `pnpm dev`。静态文件和Agent均由 `server/server.cjs` 在 `127.0.0.1:4173` 提供。需要现有锁文件依赖 `pnpm install`。

服务端环境变量：`OPENAI_API_KEY`、`OPENAI_MODEL` 必填；`OPENAI_BASE_URL` 可选，必须为支持 Responses API 的服务。不要把密钥放入前端文件、对话、版本库或本地存储。启动时从环境读取，浏览器只拿配置是否就绪及模型名称。

`POST /api/agent/turn`：`{message, history:[{role,content}], context, binding:{projectId,conversationId,submissionId}}`。浏览器发送前持久保存 binding；同一绑定和内容去重，改变内容不能复用原 submissionId。

返回：`{sessionId, done, text, calls:[{callId,name,args,mutates}], round}`。前端依次展示、确认并执行工具。

`POST /api/agent/continue`：`{sessionId,results:[{callId,result}],binding}`。服务器检查绑定和所有待执行callId一一对应，回传Responses `function_call_output`，上限16轮。持久保存已接受回执后才发下一轮；相同回执仅重读已提交响应，不再次请求模型。未知状态不能重发。

`POST /api/agent/cancel`：`{sessionId,binding}`，中止模型请求，取消状态落盘后才确认。已完成的本地修改保持可撤销。未配置模型时仍可使用。

`POST /api/agent/state`：`{sessionId,binding}`，只读返回 `{sessionId,status,round,done,restored,canResumeWithReceipts,pending:[{callId,name}],text,binding,reason?,delegation?}`。可选的 `delegation` 为 `{callId,tasks:[{taskId,title,dependsOn,status,started,blockedBy?,error?}]}`，绑定当前待处理委派；浏览器据此展示中断子任务的状态和依赖。未配置 Key 时可读取，不发模型请求、不执行工具、不返回原始媒体或工具参数。身份不符返回409，记录不存在返回404。

工具定义与递归参数校验在 `agent-tools.js`；浏览器执行器在 `agent-client.js`。工具访问已声明的画布、片场、技能、生成和检索接口，不执行模型返回的代码。服务器只监听loopback并拒绝跨源API请求。执行记录保存在当前项目的本机对话历史；终态/空闲服务端会话按30分钟移出内存，正在请求或等待工具回执的会话保留。父运行检查点位于静态拒绝目录 `server/.agent-sessions`，不自动删除历史；容量满时明确拒绝新记录。子任务/DAG及真实子Runtime检查点随父记录原子保存，不另建独立存储。

### 父运行持久恢复边界

等待工具回执的检查点保留原 callId、多模态像素、输入和轮次，可通过原回执显式续轮；已落盘但尚未请求模型的 `planned` / `receipts_saved` 也可显式继续。请求过程中断恢复为 `unknown`，不推断成功或自动重发。配置改变阻断未完成运行；历史终态仍可查询。已保存的委派批次可恢复原子任务身份、调用、依赖与规范结论；完成结果只读复用，已知尚未发出的任务需要显式启动/继续，模型在途中断仍为unknown。旧记录缺少委派检查点时标记 `blocked / delegation_state_not_persisted`，不会猜测重建子任务。`delegated-state` 和 `delegated-result` 同样可无Key只读核对；修改和续轮仍需原配置。详见 子任务恢复合同（开发机来源：`reference/agent-delegation-checkpoints-20261002.md`）。

浏览器目前只提供“核对中断任务”的手动只读查询；没有自动恢复工具、自动重发或继续按钮。`canResumeWithReceipts` 只表示服务端协议具备续轮条件，不能代替原工具执行证据或授权。完整合同、聚焦验证与剩余工作见 检查点接线（开发机来源：`reference/agent-checkpoint-integration-20261002.md`） 和 [存储合同](AGENT-SESSION-STORE.md)。

生成任务走独立 `GenerationAPI`，可以注入提供方或HTTP `/tasks` 协议。没有提供方时状态为 `configuration_required`，不会生成占位成功图像。

验证：`pnpm test`。Agent 测试包含 SDK 接口替身与已安装 OpenAI SDK 连接本地 SSE fixture 的传输验证；覆盖参数、工具循环、拒绝、取消与上限，不代表真实外部模型已联网成功。

## 配置与连接检查

以下配置只由 `server/server.cjs` 启动时读取。先在服务进程环境中配置，再运行 `pnpm dev`；修改后需重启服务。当前启动脚本不自动加载 `.env` 文件。

| 环境变量 | 作用 |
| --- | --- |
| `OPENAI_API_KEY` | 服务端模型凭据，必填，不返回浏览器。 |
| `OPENAI_MODEL` | `modelSelection.id: "auto"` 使用的 Responses 模型，必填。 |
| `OPENAI_BASE_URL` | 可选的 OpenAI 兼容服务地址；流式模式需要支持 Responses SSE 事件。 |
| `AGENT_MODEL_MAP` | 可选 JSON 对象，将 UI 模型别名映射到实际服务端模型名称。未配置的指定别名返回 `configuration_required`，不回退到 Auto。 |
| `AGENT_REASONING_MAP` | 可选 JSON 对象，将模型别名下的思考档位映射到提供方支持的 `reasoning.effort`；细节见下方“Agent模型思考参数”。 |
| `PORT` | 可选本机监听端口，默认 `4173`；监听地址固定 `127.0.0.1`。 |

`GET /api/agent/config` 返回 `{configured,model,missing}`，其中 `missing` 是缺失的环境变量名称。这个检查不发模型请求，也不证明提供方可用。一次 `/turn` 解析后的模型与思考参数固定于服务端 session，后续 `/continue` 不随 UI 偏好变化。LLM 配置与生成网关的 `GENERATION_API_BASE_URL`、`GENERATION_API_KEY` 独立；填好 LLM KEY 不等于生图/生视频服务已连接。

## Agent 流式响应契约

仅 `POST /api/agent/turn`、`POST /api/agent/continue` 在请求包含 `Accept: application/x-ndjson`（非 `q=0`）时启用流式响应，请求 JSON 内容不变。响应为 `Content-Type: application/x-ndjson; charset=utf-8`，每行一个 JSON 对象、以换行结尾；HTTP 分块和 UTF-8 字节边界不能当作事件边界。未声明该 Accept 的调用仍返回旧 JSON；客户端也能读取旧服务返回的 JSON。`/cancel` 与 `/artifact-html` 继续使用 JSON。

服务端运行接口为 `start(input, signal, onEvent?)` 与 `resume(sessionId, results, signal, onEvent?, binding?)`。旧内部无绑定调用保留兼容，浏览器始终绑定项目、会话和提交身份。启用回调时使用已安装 OpenAI SDK 的 `responses.create({...request,stream:true},{signal,maxRetries:0})` 异步迭代器，`store:false`；回调只发布前三类事件，HTTP 层发布唯一终态 `result` 或 `error`。

| 事件 | 数据结构与含义 |
| --- | --- |
| `session` | `{type:"session",sessionId,round}`：每个模型轮次开始、SDK 请求前发送。初始 sessionId 无需等模型完成即可取得，用于停止。自动修复无效工具时仍用同一 sessionId，round 递增。 |
| `text_delta` | `{type:"text_delta",sessionId,round,delta}`：本轮可见文本增量，delta 为字符串；仅用于显示。 |
| `thinking` | `{type:"thinking",sessionId,round,active}`：仅收到 SDK reasoning item 的开始/结束事件才发布活动状态；收尾清除活动状态。不透传 reasoning 正文、摘要或隐藏推理，未收到 reasoning item 时不伪造思考事件。 |
| `result` | `{type:"result",result:{sessionId,done,text,calls,round,segments}}`：本次 HTTP 请求唯一成功终态。calls 保持 `{callId,name,args,mutates}`；text 仍是最终轮完整文本，segments 为本次请求中各已完成轮的完整文本。 |
| `error` | `{type:"error",error,code?}`：本次请求失败终态，不能从此前文本或中间事件执行工具。连接已断开时可能无法送达此事件。 |

`segments` 只出现在流式成功结果，结构为 `[{round,text}]`，范围是当前一次 `/turn` 或 `/continue` HTTP 请求，并非整个会话历史。前端按 round 用完整文本替换已有增量，不能将 result.text 或 segments 再追加一遍。某轮没有任何文本 delta 时，仍可由 segments 补全；纯工具轮的空文本消息可移除。例如自动纠正无效工具后，终态可以是：

```json
{"type":"result","result":{"sessionId":"session-id","done":true,"text":"已完成检查。","calls":[],"round":2,"segments":[{"round":1,"text":"先检查当前画布。"},{"round":2,"text":"已完成检查。"}]}}
```

工具循环最多发起 16 次模型请求。达到上限时，流式分支另发 `round:17` 的 session 和本地停止消息，并加入 segments；这不是第 17 次模型请求。JSON 分支保留旧停止响应形状，不新增 segments。正常 `/continue` 的 round 接着同一 session 的计数递增。

### 成功、失败与工具执行边界

只接受 SDK `response.completed` 事件且 `response.status === "completed"` 的完整 output；`response.failed`、`response.incomplete`、不匹配的完成状态、未完成 output item 或提前 EOF 都失败。SDK 迭代器正常结束本身不代表成功。`function_call_arguments.delta` 和 `output_item.done` 不向前端发布可执行调用；客户端只在通过校验的终态 result 返回后执行工具。

所有 function call 在记录或返回前按整轮校验：`call_id` 必须非空、同轮唯一，且同一 session 后续轮次不得复用已接受的 ID。异常整轮拒绝，错误为 `invalid_tool_call_ids`；前端另做空值、同批重复及已接收 ID 检查，错误为 `invalid_tool_calls`。未知工具或非法参数按原协议生成 `function_call_output` 错误；没有合法待执行调用时可自动进入下一轮，前轮文本通过 segments 保留。自动修复参数不是重试失败的网络请求。

工具白名单和 schema 仍以 `agent-tools.js` 为准；浏览器执行器再次校验并进入画布、片场、技能、素材或生成任务模块，不能执行模型返回的任意脚本。写操作遵守既有确认/自动执行偏好，`skills_save` 保留独立确认；流式文本和 thinking 状态不构成执行许可。`ask_question`、`show_form` 是真实用户输入屏障：同一模型响应中的其他调用不执行；`/continue` 必须提交与待执行 callId 一一对应、经过原问题或表单校验的结果。

已经开始流式输出后 HTTP 状态为 200，失败由 error 行表达。常见服务端 code：`response_failed`（模型失败）、`response_incomplete`（响应未完成）、`stream_incomplete`（模型流提前结束）、`cancelled`（取消）、`invalid_tool_call_ids`（工具身份异常）。开始流之前的校验错误仍走 JSON 状态响应；没有 KEY/模型或指定映射未配置时返回 JSON 503 和 `configuration_required`，即使请求接受 NDJSON 也不制造模拟流。

### 停止、断线和显示恢复

前端收到第一个 session 即保存取消身份。用户停止会取消 fetch/reader，并调用 `/api/agent/cancel`；未正常结束的 HTTP 连接关闭会触发服务端 AbortController，继续传入 SDK。停止后迟到的完整工具输出仍被丢弃，不执行本轮工具。已完成本地修改和已提交的独立生成任务不会因中止 LLM 响应自动回滚，应按各自撤销或任务取消接口处理。

流式 SDK 请求设置 `maxRetries:0`，客户端遇到 EOF、坏 JSON、身份变化、error 或断线也不自动重发 `/turn`、`/continue`。服务端已确认失败的 session 标记结束；有持久检查点的在途请求结果不明时标记 unknown，不能借空工具结果重新执行。浏览器在没有终态 result 时结束读取，会报告 `stream_interrupted`；已收到的文本保留并标记中断，不能当作工具执行成功。

界面按动画帧合并消息更新，不为每个 delta 重建整个面板。刷新时保存的 streaming 消息变为 interrupted；只恢复可见记录，不恢复服务端运行或自动重放工具。页面离开先暂停排队任务再取消当前流，避免导航时启动下一项；普通“停止本次执行”仍遵守现有队列策略，不等同于暂停整条队列。

### 聚焦验证

```bash
node --test tests/agent-server-stream.test.cjs tests/agent-stream.test.cjs tests/agent-stream-http.test.cjs
```

覆盖中文 UTF-8 字节拆分、session 提前可用、reasoning 内容不外泄、仅最终完成可用工具、参数纠错多轮文本、用户输入屏障、轮次上限、重复 callId、JSON 回退、无 KEY 503、停止与浏览器断连向真实 SDK 上游传播。HTTP 测试使用随机临时端口及本地 SSE 提供方，不使用真实模型 KEY，不占用正式 `4173`。这些测试验证实现契约，不代表供应商模型或长链创作质量已验收。

## 结构化用户问答

`ask_question` 在现有 Responses 工具循环中等待真实用户输入，不调用单独的模型服务。它是本项目的问答工具，不宣称覆盖官方 `show_form` 全部字段类型。

- **Purpose**：收集创作决定，逐题选择或自由回答后一次续轮；问题等待期间不执行同一模型响应中的其他工具。
- **Inputs**：`{questions:[{question_id,header,question,options:[{label,description}],multiSelect}]}`；1–4题，各2–4项；ID唯一，选项标签唯一。header最多40字符，question最多2000字符，label最多160字符，description最多1000字符。
- **Outputs**：`{answers:[{question_id,selected_labels?,free_text?}]}`，必须覆盖所有题。自由文本最多200字符；单选为一个label或自由文本，多选可同时包含labels与自由文本。服务端按待执行callId对应的原始问题重新验证；错误结果只能是`{error:string}`，不能同时携带答案。
- **Permissions**：无需再加一层写操作确认，真实选择/提交本身就是答题动作；回答不授权无关修改或调用。工具不读系统文件、不访问凭据、不提交生成。同批其他工具收到“未执行”，须在收到答案后的模型轮次重新决定。
- **Failure modes**：缺答、题ID不匹配、重复/不存在的选项、单多选冲突、超长文本、重复提交均拒绝；关闭面板只回收视图，重开继续当前草稿。停止触发Abort并终止本轮；刷新标记interrupted和未回答，不恢复服务端会话或自动提交。服务端原30分钟session过期边界仍存在。
- **Logging**：问题、草稿、实际提交或失败结果进入本机对话工具trace；答案通过`function_call_output`传给配置的LLM。UI未提交内容不进入SDK续轮；不增加服务端答案日志或任何Key日志。
- **Tests**：既有`tests/agent.test.cjs`覆盖答案身份与完整性、真实异步等待、旧视图/重复提交、停止/刷新，以及同批工具屏障（含无效问题）。`node --test tests/agent.test.cjs tests/agent-browser-tools.test.cjs`本轮68/68通过。实际UI、官方源码依据及未验证边界见问答记录（开发机来源：`reference/agent-questions.md`）。无Key尚未实机验证真实模型触发production composer问答；隔离QA与SDK替身分别验证用户输入和协议。

```json
{
  "questions": [{
    "question_id": "visual_style", "header": "风格", "question": "使用哪种画面风格？", "multiSelect": false,
    "options": [{"label": "写实", "description": "自然光与真实材质"}, {"label": "动画", "description": "手绘线条与简化造型"}]
  }]
}
```

回答：`{"answers":[{"question_id":"visual_style","selected_labels":["写实"]}]}`。主输入框发送优先回答当前问题，成功推进/提交后才清空；失败保留文字，不误加入后续任务队列。

## 新增片场编排

`scene_setup` 支持创建、克隆和切换状态；`scene_environment` 修改真实房间尺寸、图案和光照；`scene_export` 输出全景、四向视图、拼接或各状态摄像机画面。坐标均是米，旋转是弧度 XYZ。

`generation_submit` 可指定 `referenceIds`、3D `position`、`setupId`。这些字段在提交时绑定，结果不会因用户切换状态而改变落点。服务输出 `type:model` 和 GLB `url` 后，先写入画布，再尝试加载回填。目标状态删除或GLB无效时保留画布结果、显示应用错误，并提供重试应用入口。

`generation_wait` 等待最多30秒，返回真实状态、结果节点ID和应用错误；仍运行时Agent可再次等待。`succeeded` 只表示供应商完成，`applied` 才表示前端结果已应用。

统一生成接口示例：`POST /tasks` 接收 `{kind,nodeId,prompt,inputs,parameters}`；返回 `{outputs:[{type:"model",url:"https://.../model.glb"}]}`，或 `{id,status,progress}` 并由 `GET /tasks/:id` 轮询完成。同样支持 image/video/audio/text 结果。

### 图片生成批次回填

`kind: "image.generate"` 且目标为图片节点时，返回的全部 `type: "image"` 资源先实际解码，再原位回填目标；`resultIds` 为原节点ID。无需新增外部请求字段。每个输出接受 `url` 或 `image`，可选 `id`、`sourceFileId`；图片像素宽高以解码结果为准。

前端持久化 `imageHistory: [{id, createdAt, prompt, parameters, options: [{id, image, width, height, sourceFileId}]}]`，新批次在前，旧图片/版本保留。选择历史图片恢复对应提示词和参数，保留下一次生成的count/times；尺寸调整保持底边中心。批次预览不写图数据，复制到画布不继承历史。

来源/参数/历史变更或删除后拒绝迟到结果，并记录任务的 `applicationError`；未配置服务仍返回 `configuration_required`，没有假图片。工作流回填保留当前引用顺序和绑定。云端历史查询尚未实现；供应商KEY仍需按统一任务协议接入或提供对应适配器。契约和UI验收见 图片历史报告（开发机来源：`reference/image-history.md`）。

### 逐对象时间轴补充

`scene_keyframe({time, entityId?})`在指定对象（省略时为当前选择）保存独立关键帧。播放、录制、场景基准或对象锁定时拒绝修改。旧整体快照迁移为各对象轨道，不会把一个对象的关键帧应用到其他对象。

`scene_read`提供当前游标的对象变换，并返回`playback: {time, duration, playing, loop}`。`keyframes`包含`entityId`、秒单位`time`和`state`。时间轴读写使用片场世界坐标，未加入浏览器面板偏移。真实OpenAI模型的多工具编排仍待服务端KEY与模型配置后的端到端验收。

## 音频接口补充

UI生成与Agent的`generation_submit(kind: "audio.generate")`统一使用`AudioAPI.buildRequest(nodeId, overrides)`。输入包括提示词、目录中的虚拟或实际模型、参考节点ID、可选秒单位duration；保存参数按模型映射转换，Eleven音乐时长发送`music_length_ms`。不要直接调用模型标识绕过目录校验。

参考输入保留`id/type/url/text/title`；本地`asset:`媒体在提交前转成data URL。Sonilo参考视频读取metadata后把真实秒数传为`parameters.duration`，界面显示“跟随视频”。UI与Agent走相同的文本长度、素材兼容/数量、歌词、时长校验；原目录名称不限定后端供应商。

服务返回`{outputs:[{type:"audio",url,title}]}`。前端取回文件、验证不为空/不超过50MB、实际解码，再保存到IndexedDB并创建300×300结果节点。下载/解码失败显示“结果应用失败”，可重试；服务成功并不等于结果已回填。服务必须允许本地页面的CORS读取。固定文件服务`qa/audio-provider.cjs`只验证协议，不合成声音。

音色列表预留`AudioAPI.setVoiceProvider({listVoices: async () => [{id,name,previewUrl?}]})`；也可`setVoices`注入列表。未配置时明确展示空状态，不能伪造系统音色；创建音色尚未实现；语音输入转写见下方共享接口。

## 共享语音输入

- **用途**：Agent对话、图片/视频提示词、音频提示词使用同一录音控件；录音完成才提交转写。取消释放音轨并中止请求，不自动发送Agent消息或提交生成。
- **输入**：`POST /api/voice/transcribe`的body为原始音频二进制，Content-Type为audio/webm、audio/mp4、audio/mpeg、audio/wav、audio/ogg或audio/flac；上限25MB。`GET /api/voice/config`只返回`{configured}`。
- **输出**：`{text}`。无KEY/模型返回503和`configuration_required`；空录音、不支持格式、超限或无识别文本返回错误，不伪造成功。
- **模型配置**：服务端`OPENAI_API_KEY`与`OPENAI_TRANSCRIPTION_MODEL`；可选`OPENAI_BASE_URL`需支持OpenAI audio/transcriptions协议。与Agent的`OPENAI_MODEL`独立。修改环境后重启服务。KEY不进入前端。
- **替换提供方**：`VoiceInput.setProvider({transcribe: async (blob, {signal}) => ({text})})`，默认调用本机服务。不要忽略signal；前端还会丢弃取消后的迟到结果。转写默认60秒超时。
- **权限**：用户点击语音输入后才请求浏览器麦克风权限；源码不自行读取或保存系统凭据。录音只在当前内存中保留；失败可试听/重试，关闭或离开输入上下文释放资源。不记录原始音频、转写文本或KEY到服务端日志。
- **插入保护**：绑定原节点/对话和选区；文本变化或输入上下文失效时不覆盖新内容。富文本使用原DOM Range插入，避免换行与纯文本计数差造成偏移。无法插入的已识别文本可复制。
- **验证**：`tests/voice.test.cjs`验证录制取消/释放、迟到授权、SDK请求契约及错误；`qa/voice-recorder.html`用真实合成音录制验证控件。样例文字不是模型识别。实时流式识别、真实麦克风、生产转写端到端仍待验收。

## 片场镜头光学（旧版片场）

`scene_update`的patch新增 `depthOfFieldMode: "deepFocus" | "aperture"`、`apertureFNumber: 1.4..22`、`focusDistance: 0.1..1000` 和 `focus`。固定距离示例：`{depthOfFieldMode:"aperture",apertureFNumber:2.8,focusDistance:3}`。直接提供focus时使用以下一种结构：

- `{mode:"distance",distance:3}`：米单位，0.1–1000。
- `{mode:"point",target:[x,y,z]}`：片场世界坐标。
- `{mode:"object",entityId:"对象ID",offset:[x,y,z]}`：对象本地坐标偏移；offset可省略。

焦距解析为相机轴向深度；目标缺失或位于相机后方时回退到保存距离。`scene_read.optics`返回当前镜头字段及cameraId。使用`scene_camera`进入指定镜头后，`scene_keyframe`保存当前位置、旋转、焦距、画幅和光学状态；采样在时间轴内进行。深度模式为离散切换，对焦距离/点与光圈在相邻关键帧之间插值。

本地渲染不访问外部API；修改走现有受限工具调度，不读取系统凭据。字段范围与focus结构双重校验，错误返回给Agent，不能假报完成。光学数据与画布一起持久化；不新增包含媒体或凭据的日志。单测见`tests/studio-optics.test.cjs`，实际渲染见`qa/studio-optics.html`；生产OpenAI编排仍未验证。

原站恢复后确认 `showDepthOfField` 发布开关为false。本地 `studio-camera-ui.mjs` 的 `studioFeatures.depthOfField` 同样默认false，隐藏UI入口；以上光学工具字段和引擎仍可使用。这是未开放功能能力保留，不应向用户描述为原站当前可见按钮。

## 本地示例模型工具

- **用途**：Agent查询63个已本地化模型并真实放入活动3D片场；无需生成API。
- **输入**：`scene_library({query?})`按中文分类或模型ID过滤。`scene_sample({sampleId,position:[x,y,z],materialMode?:"source"|"clay",scale?})`使用查询所得ID，世界坐标绝对值不超过10000米；统一scale为0.01–100，省略时采用原站目录值。
- **输出**：查询返回分类及模型`id/name/scale/preview`；放置返回含ID、材质、变换及本地资源路径的真实对象。`scene_update`也支持切换`materialMode`。
- **权限**：查询只读，放置标记mutates并走现有执行确认/自动执行设置，可在片场撤销。不读系统凭据；模型只来自受控本地目录，不执行下载内容中的脚本。
- **失败**：未打开片场、未知ID、非法坐标/比例、加载失败或加载期间切换状态均返回错误；不会插入空壳成功对象。
- **日志**：保留现有本地工具参数/结果轨迹，不记录模型二进制或KEY。
- **验证**：`tests/studio-placement.test.cjs`覆盖目录文件、精确坐标、地面偏移、取消后迟到加载；`tests/agent-browser-tools.test.cjs`验证两个工具进入同一场景执行器。63模型真实WebGL验收及主片场证据见`reference/stage-placement-library.md`。OpenAI端到端仍需服务端KEY和模型配置。

## 环境工具补充

`scene_environment`现在支持`ground:{y:-100..100,size:2..100,grid:boolean}`，`room.lineMarkers`及`lighting.preset`。预设ID为`studio-soft / clean-interior / sunny-outdoor / soft-urban / golden-hour / night-street`。选择预设会清除当前自定义HDR引用，但保留资源列表；独立全景背景保持。返回包含room、ground、environment，并等待贴图加载，失败报告错误。

这些修改仅操作本地场景与已本地化HDR，不触发外部模型。导入文件由用户文件选择器读取、50MB上限并实际解码，保存在IndexedDB；运行时不会把文件发给OpenAI或生成提供方。无额外KEY和权限。原有工具记录保留参数与结果，测试见`tests/studio-environment.test.cjs`，真实GPU验收见`qa/studio-environments.html`。


## 全景编辑接口

`scene_panorama`动作：`open/read/close/region/clear/undo/redo/generate`。`region`接受`rect:{x,y,width,height}`，数值为当前渲染viewport的0–1归一化坐标（含真实页面偏移）；生成需`prompt`。返回sessionId、setupId、revision、球面方向选区或taskId。调用`generation_status/wait`确认任务以及sceneResult，不能把queued或configuration_required当完成。

独立生成协议`kind:"panorama.edit"`，`inputs[0].image`是实际完整PNG；`parameters`包含binding(nodeId/setupId/sessionId/revision)、camera(position/quaternion/fov/aspect)、regions(id/color/directions)、坐标约定及output规格。方向为世界单位向量，Y向上，正前方-Z；u=atan2(x,-z)/(2π)+0.5，v=asin(y)/π+0.5，v向上。服务负责蒙版区域编辑并合成为2:1等距柱状图，返回`outputs:[{type:"image",image或url,width,height}]`。任意厂商KEY需由适配器转换此协议。

输出先保留在画布，才尝试应用。仅相同片场、状态、编辑会话、revision允许替换预览；异步下载期间再次检查。错误比例/下载失败保留结果节点，任务显示应用错误；重试不会重复创建节点。记录`studio.panoramaEdits`持久化到本地，图片经LocalAssets/IndexedDB保存。关闭会话不会取消已提交任务，但结果不会覆盖新的编辑器。

权限：编辑器操作本地可撤销；generate按已有Agent执行确认策略提交给已配置provider；读取工具和状态不发送图片。异常：未配置、provider失败、超时/取消、图片解码/比例错误、陈旧会话。日志仅保留任务状态、关联IDs及错误，不包含KEY。验证：`tests/studio-panorama.test.cjs`、Agent分发回归及`qa/studio-panorama.html`。未使用生产KEY验证。


### 全景历史扩展

`scene_panorama`新增`history`（返回当前状态的位置与patch摘要）、`reframe`（解除位置锁定，留在编辑器）、`select_position`（id）、`toggle_patch`（id与enabled）、`delete_patch`（id，可撤销）。历史选择加载时拒绝编辑/导出，避免读到旧画面；选中历史patch后需解除选择才能生成。

`studio.panoramaSessions`保存id/setupId/viewpoint/base/thumbnail/patches与软删除记录，`panoramaActiveSessionId`保存最后选中的位置。局部层由提交时世界方向蒙版约束，输出图像即使改变了其他像素，本地也仅合成选区内部分。所有图层仍是可替换模型协议结果；全局层替换整图，局部层叠加。启停和删除重新合成，不调用模型。Agent返回真实状态，未就绪会抛出明确错误。


### 全景局部层裁切

`scene_panorama` 的 `history` 返回每层 `camera/regions/crop`。`crop_patch` 参数示例：

```json
{"action":"crop_patch","id":"patch-id","crop":{"minX":-2,"maxX":2,"minY":-1,"maxY":1}}
```

边界采用生成时相机前方10单位平面，X向右、Y向上；各值必须有限且位于[-10000,10000]，宽高至少0.5。调用仅修改当前全景历史中的指定局部层，触发真实2:1像素合成/持久化/一条撤销记录；不会调用模型。不存在的层、全局层、非法范围或正在合成时返回错误。切换会话或历史修订后，旧异步合成不会覆盖新状态。工具执行继续走现有Agent可审查记录与受限分发流程。


## 反馈服务适配边界

`FeedbackAPI`是页面接口，不属于Agent白名单工具。默认只保存本地；不会自动向原站或其他第三方发送描述、截图和回放。

- `open(nodeIds)`：打开反馈弹窗，用户可以取消关联节点、上传/移除图片、选择是否附带链接和最近80条画布视图/节点几何快照。
- `records()`：读取本地保存记录。`status`为`saved`或`sent`，包含稳定`id`、`description`、`nodeIds`、`screenshots`、`context`、`replay`、`createdAt`。同一弹窗重试更新同一ID。
- `setProvider({async submit(record){ return {id: 'remote-receipt'}; }})`：安装真实服务适配器；传入null恢复仅本地保存。返回id保存为remoteId；返回无id或抛错时保持本地记录并显示未发送原因。
- `attachment(asset)`：按截图引用返回实际Blob。适配器可自行实现二进制上传；本地页面不内置生产目的地、不读取任何系统凭据。
- 验证：隔离QA包含实际32×24 PNG预览/保存后解码、固定回执和失败重试。固定提供方不等于真实远程服务验收。


## 画布分组和布局工具

- `canvas_group({ids})`：2–50个节点打组或扩展原组，返回真实分组ID和世界边界。子节点位置不变。
- `canvas_ungroup({id})`：移除组容器，子节点及其世界坐标保留。
- `canvas_layout({ids,mode})`：mode为grid/horizontal；单个组ID布局其直接成员，多个节点ID布局选择。水平采用本地Dagre库。
- `canvas_read`补充parentId/groupColor/layoutType。所有节点的x/y均为绝对世界坐标；`canvas_update`移动组时一并平移所有后代，不需要手动给子节点加父坐标。
- 权限和日志：均走现有mutates白名单/手动确认、参数和结果记录，只改本地可撤销图状态，不调用生成提供方。
- 失败：选择不足/过多、组不存在、非法布局模式、无可布局节点；不执行任意代码，不接收原相对坐标图格式。
- 验证：canvas-groups纯状态回归、Agent分发/参数拒绝及浏览器真实鼠标/撤销/持久化。真实OpenAI工具选择仍待服务端KEY。

## 分组工作流与本地模板工具

| 工具 | 输入 | 输出 / 行为 |
| --- | --- | --- |
| canvas_generation_config | id，可选prompt/model/ratio/quality/duration | 写入真实图片/视频节点参数，可撤销；参考节点使用canvas_connect |
| workflow_run | groupId | 返回running和节点数；按依赖启动生成，需要已配置生成提供方 |
| workflow_status | groupId | status、当前层、总层数、实际completed节点及errors |
| workflow_stop | groupId | stopping；已启动任务继续完成，禁止后续层启动 |
| templates_list | 无 | 本地模板ID、名称、标签、备注、节点数和更新时间；不返回媒体体 |
| template_save | groupId、name，可选description/tags | 新模板ID，保存到本地IndexedDB；不支持3D片场 |
| template_use | id | 新组ID及世界边界；重映射内部ID/引用，单次撤销可移除 |

用途：Agent把画布编辑、依赖执行与模板复用接入同一受限工具循环。除status/list外均标记mutates，沿用原手动确认/自动确认选择和可查看执行记录。不会运行Skill中的任意代码，不保存API KEY，不上传到TapNow。只有workflow_run会通过用户配置的生成提供方发送提示词、引用与参数。

失败边界：无可生成节点、循环、配置缺失、静态参考无内容、输入校验失败时不启动；任务失败或应用失败停止后续层。生成期间改变成员/参数/输入/边或删除节点时拒绝迟到结果。移动节点不使结果失效，也不改写新坐标。结果类型必须匹配且媒体可读取。

页面同一时间只执行一个组；状态暂存于当前页面，刷新不会恢复远端任务。workflow_stop不等于远端任务取消；需要单任务取消时使用generation_cancel。执行停止期间所有已启动任务仍会回填，或在失效时报告应用错误。模板采用40单位归一化留白，导入世界坐标只叠加一次锚点，避免父偏移漂移。

验证：工作流纯状态并发/失败/停止测试、模板精确坐标/引用重映射、Agent白名单与元数据输出测试，以及26项真实页面固定提供方验收。生产OpenAI的工具选择和模型效果尚待配置后验证。

## 堆叠工具

- `canvas_stack({ids})`：2–50个图片/视频/文本/音频，支持选择现有堆叠进行扁平合并。返回新容器id、memberIds和世界坐标。
- `canvas_unstack({id})`：取消容器，返回成员的真实世界落点（原128间距中心优先布局）。
- `canvas_pile_release({pileId,id,x,y,targetId?})`：将一个成员移出至精确世界坐标；可加入另一个堆叠。源仅余一个成员时解散源容器。
- `canvas_read`额外提供memberIds；容器与成员坐标均为绝对值。分组包含堆叠时，不给成员叠加组坐标。
- 权限：三工具均mutates，沿用手动确认/自动确认设置、执行记录与错误回传；不进行模型或外部服务调用，所有修改可撤销。
- 失败：成员不存在、类型不支持、数量超限、非法数值/目标、来源目标相同均拒绝。Tool schema与纯状态测试、24项实际浏览器验收覆盖；生产OpenAI选用工具尚未验证。


## 文本编辑与生成

用途：把真实 Markdown 节点、文本模型参数和依赖执行接入现有 Canvas/Agent 工具。`canvas_add` 支持 `textMode: "pure" | "generate"`；Agent 提供 content 时默认 pure，无正文时默认 generate。纯文本节点只能输出连线，生成节点可接受文本、图片、视频参考。`canvas_read` 返回 textMode/color。

- `canvas_generation_config({id,prompt?,model?,count?,thinkingLevel?})`：文本数量1–4；思考参数按模型切换清理，模型ID校验使用采集目录。配置可撤销。
- `generation_submit({nodeId,kind:"text.generate",prompt?})`：走 `TextAPI.buildRequest`，与UI共用请求构造。返回taskId；结果通过原生成任务列表跟踪、取消、重试。生产服务尚未连接。
- `TextAPI.getConfig(node)`、`setConfig(id,patch)`、`buildRequest(id,overrides)`、`submit(id)`：页面本地入口。引用按referenceIds/连线顺序去重，文本内容前置到prompt，本地媒体转data URL。生成中UI禁用重复提交；失败/取消后恢复。

统一提供方收到的请求示例（标签源自原站目录，并非声称提供方实际支持该模型）：

```json
{
  "kind": "text.generate",
  "label": "文本生成",
  "nodeId": "text-node",
  "prompt": "上游正文\n\n用户提示词",
  "inputs": [{"id":"reference-node","type":"text","title":"参考文本","text":"上游正文"}],
  "parameters": {"model":"gpt-6-astra","count":1,"reasoning_effort":"high"}
}
```

DeepSeek目录使用 `thinking_level: "OFF" | "MEDIUM" | "HIGH"`；OpenAI目录使用小写 `reasoning_effort`。其他模型不发送不适用的思考字段。将来服务适配器负责目录ID到实际模型的映射，不能假定只填KEY即可接任意厂商协议。

提供方返回 `{"outputs":[{"type":"text","text":"# 生成正文"}]}`。普通提交创建连线的纯文本结果节点；分组工作流强制单结果并原位写回原生成节点。原站单结果/多版本的全部处理分支还待核对。

权限：沿用现有mutates工具白名单、手动确认选择与执行记录；本地编辑不调用模型。只有用户提交生成或执行工作流时才向配置的提供方发送提示词和引用。服务端OpenAI Agent KEY仍只从环境变量读取。

失败：空提示词且无有效引用、引用丢失/为空、模型不支持媒体、数量/模型/思考值非法均拒绝；工作流允许尚未生成的合法上游，拒绝不兼容媒体。未配置提供方显示configuration_required，绝不模拟成功。全文编辑同时被外部修改时保留外部最新内容并提示复制本地草稿。

验证：text核心/Agent分发测试，浏览器真实Markdown编辑/复制/撤销、世界坐标、素材库、刷新、固定提供方和工作流回填；固定提供方只验证协议与本地执行，不代表生产模型调用通过。

## 本地剪辑合并接口

`POST /api/media/playlist`（本机处理，无需模型KEY）：

```json
{"clips":[{"data":"BASE64_VIDEO_BYTES","start":1,"duration":2}]}
```

- 目的：按给定顺序裁剪视频片段，归一化后合并。返回`video/mp4`实际字节；失败返回JSON错误。
- 范围：1–50段，总时长≤600秒，解码输入≤80MiB，请求≤112MiB，最多2个同时执行。每次FFmpeg处理超时120秒。
- 权限：沿用服务器已有localhost绑定和API来源校验；只处理请求携带的字节，不允许服务端抓取任意URL。输入限本地MP4/MOV/WebM/Matroska解码。
- 输出：1280×720/30fps/H264/AAC 48kHz，保留宽高比补边；无声片段补静音。
- 失败：未安装FFmpeg、无效视频、范围/容量超限、请求取消或处理超时。中止子进程并清理临时文件，不产生伪成功视频。
- 日志：UI显示真实错误，错误文本隐藏临时工作目录；不记录视频字节。
- 验证：`tests/playlist.test.cjs`；`qa/playlist-app.html`；真实横/竖屏及有声/静音视频输出见`reference/canvas-commands-playlist.md`。

此接口并非LLM工具。时间线Agent专用命令仍需后续接入与工具路由测试。

## 独立图片编辑器的数据与生成边界

- 本地数据：图片节点 `tool: "image-editor"`，`editorDoc: {version:1,width,height,canvas}`，其中 canvas 为 Fabric 6.7.0 序列化对象。封面为节点 `image`；x/y 保持无限画布世界坐标，编辑器对象位置为逻辑像素。
- 入口：`CanvasImageEditor.create(screenPoint)`、`open(node)`；当前 UI 编辑实例可见 `CanvasImageEditor.current`。这是 UI 模块接口，尚未作为可由模型任意调用的执行工具暴露。
- 生成：`GenerationAPI.submit` 收到 `kind/nodeId/prompt/count/parameters`、实际 `references` 与 `editorContext: {revision,objectId,document}`。抠图引用所选图片的未变换裁剪源窗口；一般生成引用整个合成画布。提交前检测文档版本变化。
- 提供方未配置时为 `configuration_required`。普通生成创建关联节点；抠图使用 `GenerationAPI.runInPlace(request, {type,guard,apply})`，`apply(output)` 解码后更新同一个 FabricImage 并记录一次对象历史。调用前后校验编辑器仍打开、节点仍存在、对象仍存在且文档 revision 未变化；失效结果记录 applicationError，不回退创建节点。
- 抠图期间仅渲染透明度降低，不写回序列化对象；同对象禁止重复提交。错误恢复按钮和外观，任务面板记录状态。测试适配器已验证正常/缺配置/过期结果；真实 API 仍待 KEY。
- 凭据沿用现有配置机制，不写入 editorDoc/字体清单/下载文件；本轮没有修改鉴权或部署配置。


## Agent模型思考参数

`POST /api/agent/turn` 的 `modelSelection` 支持 `{id, thinking:{enabled,level?}}`。它与文本生成节点的思考目录相互独立，不能复用文本节点DeepSeek的OFF/MEDIUM/HIGH枚举。

- 目的：保持Agent模型选择和思考参数从UI到一次工具循环的语义一致。
- 输入：前端展示别名与合法思考状态；按 `src/features/agent-composer/thinking-catalog.mjs` 校验。
- 输出：Responses API的服务端模型名称与可选 `reasoning:{effort}`；前端不指定任意供应商字段。
- 配置：`AGENT_MODEL_MAP` 映射模型；`AGENT_REASONING_MAP` 映射该别名下的low/medium/high/xhigh/max/off/enabled至提供方支持的effort。例子见README；不能假定显示名等于真实供应商模型。
- 权限：沿用已有本地API来源校验和工具权限；不改变执行确认策略，不在浏览器保存KEY。
- 失败：非法档位/不允许关闭在请求前拒绝；缺少映射返回configuration_required；不静默回落。
- 状态：一次工具循环保存解析后的model/reasoning；继续执行保持不变。Auto不指定reasoning。
- 日志与验证：沿用对话错误反馈，不记录凭据；tests/agent.test.cjs覆盖固定映射、非法档位、未配置和开关语义。真实供应商能力仍需接KEY后验证。

## Studio 2.0 Agent 接入（2026-09-29）

- **用途与输入**：片场对话绑定 `studioNodeId`；发送前等待场景保存，传递 `activeScene`、选中对象 ID、动画目录及实际能力。工具定义仍使用米、XYZ 弧度；`src/features/agent-scene/studio-bridge.mjs` 将弧度转换为新版界面的角度，读回时反向转换。新版对象变换为 `parent-local`，响应明确返回 `units.transformSpace`，不把子对象的局部位置当世界位置。
- **权限与边界**：沿用现有工具确认和服务端 OpenAI Responses 循环。执行中切换片场后，绑定会话的场景修改会失败；不自动跳到另一片场。新增属性和未支持的能力明确报错，避免看似成功但没有效果。首次接入只支持 `name/position/rotation/scale`。后续的关键帧、拍摄、播放、画幅与灯光增量以本文件后文及当前 `scene_read.capabilities` 为准；不得将旧版镜头光学字段直接视为新版可写属性。
- **模型生成输入**：`model.generate` 必须绑定片场节点。新版传 `parameters.sceneBinding:{version:2,nodeId}`、`position:[x,y,z]`（默认原点），不传旧版 setupId。不同供应商仍通过统一任务适配器，未配置时明确返回待配置。
- **输出与保存**：生成结果先落到画布。`generated-models.mjs` 再校验所有 GLB 和合并后 12 MiB 限制，作为一个对象组追加到指定片场；兼容打开和关闭状态。返回 `sceneResult:{applied,nodeId,objectIds,alreadyApplied?}`。以 GLB extras 的任务 ID 标记防止保存失败重试造成重复导入。
- **失败行为**：结果不是模型、坐标无效、模型损坏、场景版本改变、导入期间场景被修改或删除均报错，保留画布产物。保存失败可重试；不将供应商 succeeded 当作已应用。仅追加到当前目标版本，不替换整个场景。
- **日志与验证**：沿用会话工具状态和 `applicationError`，不记录 Key。现有 Agent 测试补入弧度转换、分数坐标、真实 GLB 往返、打开/关闭片场保存失败重试和迟到结果保护。人工验证见 `reference/studio-v2-agent.md`。未配置真实模型 Key，因此没有生产模型编排或生成成功的验收结论。

## Agent 视觉附件输入

`POST /api/agent/turn` 可带 `mediaInputs:[{name,imageUrl,time?}]`。默认前端适配器 `prepareMediaInputs(items,{signal,resolveUrl})` 将实际图片解码至最长边768px JPEG，并为 MP4 提取首/中/尾帧；`time` 为视频秒数。`AgentUI.configureAttachmentInputs(prepare)` 可替换准备过程，返回值仍须符合上述契约。

服务端 `mediaContent` 仅接受 JPEG data URL、文件名与非负时间，不按附件路径/远程 URL 拉取数据；限制12帧及700000字符，转成 Responses `input_image` 与标记来源的 `input_text`。输入有取消、15秒解码/定位超时、CORS/格式/丢失资源及超限错误。整个 JSON 请求上限1MB，前端发送前检查，避免上传后才失败。沿用本机来源校验，不改变工具确认与 Key 边界。错误显示于会话，不记录原图内容或凭据。34项 Agent 回归包含实际 SDK 图像内容与恶意格式拒绝；本机实际附件请求证据见 `reference/agent-attachments.md`。视频只是采样画面，没有音频理解保证；真实模型需配置后验证。

## 行内技能草稿

前端会话可保存 `composerDoc`（paragraph/text/hardBreak/skillMention），HTML不作为持久化来源。模型仍接收纯文本 `message` 和 `context.selectedSkills`；发送时冻结该轮技能，输入区清空显式标签并保留片场默认上下文，后续轮次不自动继承已经移除的技能。历史用户消息保留结构化快照用于正确渲染。技能名称不是执行权限，仍由已有技能目录、禁用状态和工具参数校验决定可用性。见 `reference/agent-skill-mention.md`。

### Agent 行内素材引用

`POST /api/agent/turn` 的现有自由结构 `context` 内增加 `composerReferences`（kind/id/label/mediaType/scope）和 `referenceMaterials`（实际解析的 id/name/type/source/content，正文最多20000字符）。画布引用 ID 同时进入 `references`；图片及视频沿已有 `mediaInputs` 转成真实解码图像/帧。个人与团队素材按 scope 区分；整文件夹在发送时解析当前成员，同源同ID去重。删除的节点/素材明确失败，不假装引用成功。

每次发送先冻结文档、技能、引用及本轮材料；清空输入只移除行内引用，保留显式附件和隐式片场上下文。应用标签传递结构化身份，不新增任意代码执行能力。Casting Room / Visualize 的完整专属工具编排尚未接通；不能把标签插入视为插件执行完成。

权限、Key和多模态上限沿用现有接口；此次没有新增服务端工具。回归覆盖同名节点、个人/团队同ID、删除引用和发送后引用清理；浏览器请求证据见 `reference/agent-references-qa.json`。

### 应用管理适配接口

`await AgentUI.configureApps({install, uninstall})` 注册本机应用管理适配器。`install({id})` 必须返回 `{installed:true}`，`uninstall({id})` 必须返回 `{uninstalled:true}` 才更新本地注册状态。不存在适配器、错误/未成功回执均报错且不伪造状态。Key应留在服务端，由适配器调用已配置的本地服务；UI不内置原站安装请求或外部凭据。

状态键 `tapnow-agent-app-state-v1` 保存每项 installed/enabled；只影响目录和引用可见性，不扩大Agent工具白名单。启用应用不等同于外部授权。应用引用仍通过 `composerReferences` 传入，专属工具执行仍需独立接入。接口回归见 `tests/agent.test.cjs`，页面证据见 `reference/agent-manager.md`。

### 自定义技能包及分页读取

`skills_read({name, path?, offset?})` 保持既有name调用兼容；个人技能默认返回入口workflow及content，可选path解析包内相对路径，offset为非负整数，每次最多20000字符。返回 `path/content/nextOffset/totalLength/referenceFiles/referenceIsUntrusted`，nextOffset为null表示结束。路径不允许协议、绝对路径或越过包根；不存在文件及禁用技能报错，不访问本机任意文件或远程网络。

个人技能包保存在既有 `tapnow-custom-skills` 中，增加 `entryPath/files[{path,content}]`。导入是本地操作，最大2MiB Markdown总字节；元数据及正文不会自动发送。创建和编辑采用官方64/1024/20000字符限制。重命名/卸载同步未发送草稿中的语义引用，保留历史消息。测试见agent.test.cjs，浏览器证据见 `reference/agent-skill-lifecycle.md`。

### 本地消息操作与分叉

消息反馈仅保存在当前对话的 `feedback: 'up' | 'down' | null` 字段；无隐式反馈上报。分叉记录 `forkedFrom: {chatId,messageIndex}`，复制截至选定助手消息的历史，保留场景和模型选择，清空未发送草稿；不会执行复制来的工具记录。继续发送使用现有 `/api/agent/turn`，仍受服务端最近16条文本历史、单条20000字符的限制。完整历史显示不等于完整上下文已发送给模型。正文渲染不执行HTML或加载远程图片。见 消息记录（开发机来源：`reference/agent-messages.md`）。

### Queue 与执行恢复

`queuedMessages` 保存在所属本地对话，项包含 `id/createdAt/text/composerDoc/refs/referencePins/skills/uploads/artifactRefs/quotedText/studioNodeId/selection`。`selection` 为排队当时的展示模型与思考选项，仍由原服务端映射校验，Key不进入前端。接口不新增生成API：轮到任务时继续调用 `/api/agent/turn` 与 `/continue`。

`queuePauseReason` 表示本地失败/刷新暂停，编辑后重新发送会恢复调度。`activeRun` 仅记录浏览器已开始执行的提交ID/时间；刷新时不能据此推断远程生成已取消或完成，因此显示状态未恢复并不自动重放。停止当前运行后会按顺序接续排队项；取消排队仅取消未执行项。执行失败会保留余下队列。详见 实现与官方行为边界（开发机来源：`reference/agent-queue.md`）。

## 工具执行记录（2026-09-29）

前端每次真实调用保存 `id/callId/runId/name/args/createdAt/status/result`；开始执行后才记录 `startedAt`，实际返回或结束时记录 `endedAt`。手动确认仍按本地工具定义的 `mutates` 判断，不能由模型自行关闭。拒绝不调用工具；停止确认中的任务记为 cancelled；停止期间已经实际完成的操作保留真实 done 结果。浏览器刷新后 pending/running 记录改为 interrupted，禁止自动重放；远程任务结果需要重新查询。

生成提交只表示任务已提交，不能从工具 done 推断视频/图片完成。未配置模型或生成服务仍返回真实配置错误。步骤原参数和返回值可在“调用详情”中查看，不作为脚本或 HTML 执行。没有新增服务端接口或依赖。

## 生成确认参数（2026-09-29）

`generation_submit` 保留原参数，增加可选 `count`（1–15整数）、`imageSize`、`quality`、`resolution`、`generateAudio`、`videoMode`。`duration=-1` 仅用于 `video.generate + VIDEO_EDIT` 的自动时长，其余有效值至少1秒。已知模型进一步使用官方目录校验和归一化。界面展示别名不表示已接通该厂商服务。

确认回调支持 `{allowed, args}`；编辑仅允许 prompt/model/aspect/imageSize/quality/count/duration/resolution/generateAudio/videoMode。目标、引用、类型与场景位置不能通过卡片更改。`originalArgs` 保留编辑前值，`args` 记录确认值，实际工具执行仍经过 AgentTools.parse。图片质量映射到现有 `outputQuality`，不会与历史分辨率字段 `quality` 混淆。

`generationJob` 按实际 taskId 保存 status/progress/error/applied/applying/applicationError/resultIds；不存储媒体输出正文。供应商输出和本地结果应用结束分别通知。刷新不会自动恢复未完成的远端任务；已知终态可保留。生成卡片取代通用确认视图，审计参数仍在本地工具记录中，尚未增加卡片内原始JSON详情入口。见 官方依据与验收边界（开发机来源：`reference/agent-generation.md`）。

### 批量确认内部记录

前端将相邻同参数同类且不同目标的生成调用组合为 `name: generation_batch` 的内部展示记录；该名称不在模型可调用工具目录里。`batchItems` 保存各原调用，`batchDraft` 保存编辑文本和 rejected，`confirmationDraft` 保存共享参数。后端仍只收到原 callId 对应的逐项结果，没有新增HTTP契约。

确认返回 `{allowed,args:{decisions:[{callId,allowed,args?}]}}`，数量、顺序与callId必须完全匹配原批次。保留项在任何提交前完成schema及确认白名单校验；拒绝项不调用生成。停止只停止后续提交，已提交任务按实际taskId追踪；刷新对子项递归恢复，禁止自动重放。日志不包含密钥或媒体正文。测试与手工验收见 批量记录（开发机来源：`reference/agent-generation-batch.md`）。

### Agent 音频确认参数

`generation_submit(kind:"audio.generate")` 增加可选 `audioScene`（Music/Sound/Text-to-Speech）、`lyricsMode`（auto/custom/instrumental）、`lyrics`、`voice`、`stability`、`promptInfluence`、`loop`、`subtitle`、`audioFormat`、`sampleRate`、`speechRate`、`pitchRate`、`loudnessRate`。`duration:null` 表示自动并清除已存时长；音频最大360秒，具体模型按官方Agent目录收紧。非音频仍最多120秒，视频编辑的-1语义不变。

用途：可编辑确认后真实提交音频。输入经共享schema与模型兼容性验证，输出仍为实际taskId/status。权限沿用已有生成确认与Act偏好，模型Key仅在服务端/适配器配置。未配置返回configuration_required，不能视为成功。日志保存原始/确认参数与实际任务关联，不含Key或媒体正文。

默认音频参考取目标配置引用及输入连线，在调用展示前冻结。`originalArgs` 保留模型原请求；确认编辑不能换目标/引用。批量复用原逐项callId契约。`AudioAPI.listVoices()` 复用既有真实音色provider，返回 `{voices,configured}`，不制造默认音色。回归与UI验证见 音频确认记录（开发机来源：`reference/agent-generation-audio.md`）。

### 交互表单与后续修订

用途：`show_form` 在会话内呈现制作参数表单并等待真实用户提交。参数包含 `title/description/submit_label/accent/form_icon/display_type/fields`；字段支持 `radio/checkbox/select/text/rating/slider/date/number/image_select`，具体有界schema见 `agent-tools.js`。必填、选项身份、多选数量、文本长度、有效ISO日期、数字范围、滑块步长均在前后端校验。

输出采用官方可观察结构：

```json
{"tool_call_id":"实际SDK call_id","form_title":"制作参数","values":[{"field_id":"style","field_label":"风格","value":"film","display":"电影 (film)"}],"skipped":false}
```

`tool_call_id`绑定实际调用；服务器根据原始字段重算display，不信任回传标签和显示文本。每项字段必须恰好出现一次；选择不存在的选项、伪造字段、重复/缺失字段、超限或空必填均拒绝且不部分追加结果。规范结果最多180000字符。跳过只能是 `skipped:true,values:[]`，不是批准生成或其他操作。

权限：表单本身只读，无自动生成、画布修改或外部服务调用。与 `ask_question` 一样构成执行屏障，同一批其他调用返回未执行，等待真实提交后由模型重新决策。关闭面板不提交，停止中止等待，刷新保留草稿并明确标记未提交。图片仅通过已知画布节点ID或当前对话实际上传项解析，模型不能提供任意URL让服务端下载。

已提交卡的“修改”在空闲时开启编辑；重新提交创建新用户轮 `/api/agent/turn`，可选负载 `formRevision:{form,result}`。原工具结果 `trace.result` 不改，最新显示保存在 `formLatestSubmission`；服务端验证并把修订作为明确标注的用户数据加入新轮，绝不伪造或重放旧 `function_call_output`。当前主输入草稿、附件和引用不被修订操作消耗。

日志保存原表单、草稿、真实输出和修订摘要；不含Key。SDK未配置仍返回真实配置缺失，不制造模型答复。会话和等待事件当前不可在服务重启后恢复；客户端重新提交修订并不承诺模型已经接受。相关回归在 `tests/agent.test.cjs`；正式UI接线在 `agent-client.js`、`agent-execution/view.mjs`，等待器在 `agent-form-runtime/waiter.mjs`。本轮Agent相关72/72通过，九类控件完整浏览器状态验收由根代理另行记录。

### 片场 2.0 播放与时间定位

用途：`scene_playback` 复用官方可观察播放/时间轴对应的本地 `ScenePlayback`，控制真实Three.js AnimationMixer。仅影响预览、播放镜头/运镜选择，不修改轨道或关键帧，不发起生成/导出。采用与 `scene_camera` 一致的 `mutates:false` 视图操作分类；选择镜头/运镜沿既有UI保存选择偏好，并非完全无状态变化。

输入：

```js
{action:'select',animationIndex:0,target:'camera',cameraId:'已有镜头ID'}
{action:'select',animationIndex:1,target:'objects'}
{action:'seek',time:0.375}
{action:'play'}
{action:'pause'}
{action:'stop'}
```

先读取 `scene_read.version/capabilities/animations`。索引须为0至10000整数；select要求target，cameraId只用于camera目标，省略时使用当前镜头。动画必须包含指定镜头或真实对象轨道。不同action不能夹带无关参数。seek支持小数秒，必须位于当前实际动画的0至duration区间；不会静默把越界输入截成末帧。

select选中动画并暂停在0；play已在播放时保持进度，结束后再次play从0开始；pause重复调用不恢复播放，保持当前画面；seek定位并暂停，动画关闭后可重新激活已选运镜。stop还原预览前基础姿态、清除活动播放，但保留选定镜头/运镜，之后play恢复该运镜。若刚刚停止的是对象动画，要继续对象动画须再次select；不会把对象动画错误地当成镜头运镜。选择objects不覆盖已选shotId/motionIndex，沿既有UI规则固定镜头预览姿态。

输出：`{version:2,nodeId,shotId,motionIndex,playback:{index,target,time,playing,duration}}`。`scene_read.playback`同样增加duration；停止后index=-1、duration=0，不把上次动画时长当作活动状态。

边界与失败：仅V2capability明确支持；旧版片场拒绝并提示版本。场景未加载/关闭、导出中、撤销恢复中、变换拖拽或关键帧gesture均拒绝。参数与目标验证在状态变化前完成；不修改用户正在拖动的关键帧。错误和真实输出沿既有执行trace记录；不涉及凭据、远程资源或额外文件权限。

实现：`src/features/studio-v2/scene-playback.mjs`与runtime/entry接线，通用Agent场景桥检查capabilities，未复用语义不同的scene_setup。测试在既有 `tests/studio-timeline.test.cjs` 和 `tests/agent-browser-tools.test.cjs`：真实Three轨道、小数seek/0及末帧、幂等播放/暂停、结束重播、stop恢复、对象与镜头关联、无效目标/范围及busy状态不改变场景、schema和真实路由。专项组合28/28通过；完整浏览器和真实LLM操控另行验收，不能以纯Three测试替代成片观看。

播放增量最终相关组合：`node --test tests/agent.test.cjs tests/agent-browser-tools.test.cjs tests/studio-timeline.test.cjs`，83/83通过；新增播放模块及schema、runtime、entry、旧版路由、执行标签语法检查通过。


### 片场 2.0 关键帧姿态

`scene_keyframe({time,entityId?,pose?,space?,animationIndex?})` 在V2支持相机与普通模型的独立轨道。pose可包含position/rotation/scale；Agent旋转是XYZ弧度，space为parent-local（默认）或world。同一Float32时间替换，记录一步撤销，写入后暂停于该时间以便拍摄。缺省动画选择歧义、非法姿态及不能表达的父级变换会在修改前拒绝。旧版仅支持time/entityId，拒绝新增参数而不静默忽略。权限、保存失败已应用语义与动画隔离细节见 [关键帧合同](AGENT-STUDIO-KEYFRAMES.md)。

本地浏览器直接调用真实Agent执行器验证了相机0/2秒关键帧、GLB保存刷新、替换撤销、seek1秒精确插值、两帧真实PNG与画布连线；普通cube独立轨道在1秒为[2,1,0]，stop恢复[2,0,0]。完整记录见 `reference/studio-v2-agent-keyframes-playback.md`。没有调用LLM或生成模型，不代表已完成模型长链或Agent视频交付验收。

### 片场 2.0 画幅、灯光与只读镜头信息

本增量复用 `scene_update` 和 `scene_environment`，工具总数不增加。官方V2当前UI证据支持相机画幅与灯光方位/高度；未据此开放旧版焦距、光圈、景深和对焦写入。`scene_update.focal/aspect/focus/apertureFNumber/depthOfFieldMode`等旧版字段仍只在旧版实现中适用，V2整请求明确拒绝。

- **画幅输入**：`scene_update({id:cameraId,patch:{viewport:{width:1920,height:1080}}})`；宽高为1–8192整数，宽高比1:20至20:1。`viewport:null`恢复导入相机原始比例。仅已存在camera可用，不能将该字段塞进scene_add或普通模型。预设1:1、9:16、16:9与自定义合法尺寸使用同一runtime setter。尺寸描述画幅比例，不承诺输出该分辨率。
- **灯光输入**：`scene_environment({lighting:{azimuth:180.125,elevation:30.25}})`；方位0–360°、高度-90–90°，可只传其中一项，保留另一项。V2不接受room、ground、preset、intensity或background。重置可传 `scene_read.defaultLighting` 的真实默认值；不伪造HDR或额外环境能力。
- **读取**：V2返回 `supportedCameraProperties:['viewport']`、`supportedLightingProperties:['azimuth','elevation']`、`lightingUnits:'degrees'`、`defaultLighting` 和 `cameraSettings`。每个cameraSettings含 `id/viewport/effectiveAspect/projection`；透视投影含fovDegrees/aspect/near/far/zoom，正交投影含left/right/top/bottom/near/far/zoom。这些projection参数只读，fovDegrees与灯光度数不会被对象旋转弧度转换误改。
- **权限与事务**：沿用原有变更工具确认、trace与场景绑定，不调用外部服务。普通TRS仍使用Agent弧度→runtime角度转换；viewport和lighting原值传递。混合patch先验证所有字段、目标camera和当前编辑状态，再执行一次undo/commit并等待保存；非法viewport与不支持光学字段不能先修改name或TRS。包含运镜的camera仍须通过关键帧修改姿态。
- **失败边界**：未加载、关闭、导出、恢复、拖拽/关键帧gesture或拍摄期间拒绝设置变更。保存失败由桥返回 `{error,applied:true,entityId}` 或 `{error,applied:true,settings:"lighting"}`，正式trace标为error并将已应用语义回传模型，不能报告无条件成功或盲目重新执行。V1在任何mutation前拒绝viewport/elevation及azimuth>359，保留原来的aspect和0–359°等合同。
- **审计与验证**：日志沿用实际输入、返回cameraSettings/lighting及错误，不含Key。Agent schema/桥/路由相关77/77通过，覆盖尺寸整数及比例边界、null恢复、灯光度数、小数不漂移、普通模型拒绝、混合不支持patch不调用runtime、旧版兼容。真实V2事务和浏览器画面由片场分支与根代理追加证据；本记录不声称焦距/DoF写入或真实LLM编排已验证。

### Agent 样片生成正式片

官方依据：Seedance 样片/正式片审计（开发机来源：`reference/seedance-draft-final-gap.md`）。通过现有 `generation_submit` 增加专属分支，不新增工具：

```js
// 保留样片并创建新的正式片节点
{kind:'video.generate',draftSourceId:'已有样片节点ID'}
// 对已有正式片目标重试；其唯一入边必须来自该样片
{kind:'video.generate',draftSourceId:'已有样片节点ID',nodeId:'已有正式片节点ID'}
```

此分支只接受 `kind/draftSourceId/nodeId`；拒绝prompt、model、resolution、referenceIds以及draftVideoId等供应商身份参数。普通生成仍必须提供nodeId和prompt，不因正式片免提示词而放宽。已有target必须是正式片节点，且全部入边恰好一条、purpose为draft-reference、source对应draftSourceId；不能将普通节点变相覆盖为正式片。

`canvas_read` 和模型初始画布上下文对video节点提供 `draftSummary:{isDraft,isFinal,hasResult,model?}`；hasResult表示可用样片媒体与实际文件身份齐全。摘要不含媒体URL、供应商文件ID或继承提示词。边返回purpose以便区分专属引用；仍以执行时纯模型和真实节点校验为准。

确认卡标题“样片 → 正式片”，显示实际来源节点、继承提示词/素材的说明、固定1080P和1个正式片。来源可点开查看；没有普通提示词或模型编辑器。权限沿用原有生成确认/Act模式和trace。正式片请求不参与普通图/视频批量合并，避免共享参数确认改变继承语义。

审批草稿保存来源身份/配置指纹；来源历史版本、媒体或继承配置变化后，旧确认会拒绝并要求重新提交。来源/目标身份不能通过编辑审批参数更换。确认时及执行前校验当前节点和入边；异步加载工作流后再检查并处理停止信号。实际执行统一调用 `submitDraftFinal({sourceId,targetId?})`，由该共用工作流校验忙碌状态、创建节点/边、投影请求并保护迟到回填。Agent返回真实 `{nodeId,taskId,status}`，后续任务状态沿既有generationJob关联；没有独立调用供应商或普通生成回退路径。

缺少Key或供应商样片转正式片能力必须呈现配置缺失，不生成假视频。刷新后任务恢复仍服从现有真实任务记录，不能凭旧trace宣称远端完成。工具日志保存批准的节点参数与真实任务结果，不接受模型提供的供应商文件ID，也不记录Key。

关键回归在现有Agent测试中：参数白名单和普通合同、source-only调用、当前来源/文件身份/嵌套素材快照变化、目标专属唯一边、审批参数越权、批量隔离和不泄露文件身份的发现摘要。Agent相关80/80通过；正式UI和统一工作流的创建/失败/重试由根代理验收。没有真实外部模型调用。


## Agent 能力追加：节点、历史、运镜与应用恢复

白名单以 `agent-tools.js` 为准，工具参数会在服务端及浏览器二次校验。本节工具的日志均进入当前会话工具 trace；历史正文是本机已有记录，只读工具不访问其他会话或系统文件。所有 `mutates:true` 工具遵守原确认/自动模式，读记录或工具输出本身不提供授权。未配置模型时不制造模型结果。

| 工具 | 输入 | 输出与失败 |
| --- | --- | --- |
| canvas_read_node | id, offset=0, limit=8000（最多20000字符） | node、content分页、connections、实际history字段；不存在/非法分页报错。媒体和凭据脱敏；不推断未知沿革 |
| canvas_disconnect | source,target | removedEdgeIds、disconnected；无边返回false，不添加撤销步骤 |
| canvas_redo | 空对象 | redone、undoCount、redoCount；空历史不误报 |
| canvas_resize | id,width,height，世界单位 | UI约束后的真实bounds、changed；仅text/group；一次撤销 |
| conversation_read | before_index?,limit?（1–20）；或 message_index,text_offset?,text_limit?（1–16000） | 分页历史摘要与nextBeforeIndex，或完整用户/助手文本切片与nextOffset；两种模式不能混用，不能读取别的会话 |
| scene_select | id | selected；不存在对象先拒绝 |
| scene_motion_read | cameraId?,animationIndex?,offset?,limit? | V2世界关键帧姿态、缓动、删除限制和分页；只读，外部旋转弧度XYZ |
| scene_motion_select | cameraId?,animationIndex?,keyIndex | 真实编辑器选择；-1取消选点，保留姿态；首次进入可能初始化轨道隔离，因此遵守写操作确认 |
| scene_motion_edit | action=edit/move/delete/easing及对应参数 | 真实编辑后运镜及实际夹取时间；一次撤销；完整action参数检查，见运镜合同 |
| scene_export_video | 空对象 | 实际nodeId、duration、width、height；需先选运镜，无生成API。取消停止回填；节点已创建但保存失败返回applied:true及nodeId |
| generation_retry_application | id（已有任务） | applied、applicationStatus、applicationAttempts、resultIds、可选applicationError；只使用已有成功输出，不提交模型、不新建任务。刷新后丢失的任务明确失败 |

`scene_motion_edit` 的 edit 接 `keyIndex,pose:{position?,rotation?,scale?}`（world/radians）；move 接 `keyIndex,time`；delete 接 `keyIndex`；easing 接 `type:LINEAR/CURVE/STEP,curve?`，curve仅CURVE接受单调四值贝塞尔参数。相机原生光学仍只读。内部度数仅在 Agent 边界转换，合同见 `reference/studio-agent-motion-contract.md`。

`conversationMemory` 自动携带有界的既有工具回执及较早创作决定。内容是历史证据；生成终态、节点当前状态和真实像素须重新检查。服务端序列化保证完整 JSON，省略内容显式记入 `contextOmissions`。此机制不恢复活动运行，不是子Agent或LLM语义压缩。工具摘要排除媒体/代码正文；长用户文本可分页完整取回。

内置 `skills_read` 支持 path/offset。`SKILL.md` 是 `capture/dialog.txt` 的逻辑别名，`sourceFormat:captured-dialog-text`、`originalMarkdown:false` 明确说明来源。`capture/article.html` 仅为原DOM参考，`executable:false`。保留13项真实采集的来源与校验值；60条未采集引用返回定位错误及availablePaths。个人技能包的真实Markdown读取方式保持。不得因采集正文出现其他工具名就执行未注册能力。

验证及具体文件见 `reference/agent-capabilities-increment-20260930.md`：聚焦SDK输入、生产客户端分派、真实Three编辑器及取消边界；未新增E2E，真实LLM/浏览器成片尚不作为已验证结论。


## 只读子 Agent 编排

`agent_delegate` 的 Purpose 是按无环依赖图编排镜头规划、提示词准备和审查子任务。Inputs 为 `{tasks:[{id,title,instructions,dependsOn?}]}`，1–6项，ID唯一；Outputs 为服务器规范 `{status,tasks:[{taskId,title,dependsOn,status,response?:{text},error?,blockedBy?}]}`。详细 HTTP、预算和生命周期合同见 接线记录（开发机来源：`reference/agent-delegation-integration.md`） 与 调度器合同（开发机来源：`reference/agent-delegation-server.md`）。

Permissions：子模型继承主模型配置，只有固定14项只读工具，不能生成、修改、问用户或再委派。父响应中的同批其他操作在结果返回前不执行。子结论是待审核建议，父 Agent 沿原确认模式操作；浏览器自称成功不能替代服务器回执。

Failure modes：错误身份、无效工具/媒体回执在调度前拒绝；子失败独立且部分失败明确回报；上限 limited 不算完成。父停止/断连传播取消，无自动网络重试。刷新仅恢复可见trace，不恢复服务端运行；重启无活动任务恢复。

Logging：当前会话trace.delegates仅持久化标题、状态、轮次、工具名和文字结论，不含媒体正文、隐藏reasoning或子模型凭据。实际像素通过已验证mediaInputs瞬时传给worker。

Tests：13项聚焦父子Runtime/调度/客户端执行器回归通过，复用现有Responses与执行视图测试，不新增E2E。无Key时接口503configuration_required；真实模型质量及同态视觉验收未完成。


## 已有生成任务恢复

- `generation_recover({id})`：按原浏览器 taskId 读取本机持久任务；只 GET，不重新提交，也不自动应用。返回真实 status、recovered、recovery、applicationStatus；unknown 不得解释为生成失败并自动重发。并发查询合并，取消优先于迟到结果。
- `generation_apply_recovered({id,mode,sourceId?})`：修改画布，走现有工具确认规则。mode 为 existing（可验证原占位）或 new_nodes（显式取回为独立媒体/文本节点）；sourceId 只用于新节点连接。结果以 applied / applicationError / resultIds 判断，提供方 succeeded 不是画布应用成功。
- 原位闭包、模型放置与全景合成不能靠通用恢复重建。新节点取回不会覆盖原素材；已有恢复标记防止重复导入。无记录、来源移除、媒体无法解码、保存失败明确报错，不生成替代媒体。
- 普通/批量生成卡与样片卡的未知任务提供查询按钮；取回成功后提供原占位／新节点两个显式入口。该恢复操作是本地推断功能，尚无官方同状态视觉依据。

生产记录位于静态访问被拒绝的 `server/.generation-tasks`；协议与局限见 [生成网关](GENERATION-GATEWAY.md)。这不代表 Agent 对话执行状态或分组 DAG 已支持跨重启继续。

## 深度视频专用工作流

新增 `depth_video_prepare`（只读）、`depth_video_convert` 与 `depth_video_recast`（沿用正常确认/Auto边界）。工具参数以 `agent-tools.js` 为准；不接受模型自报已确认/已查看。准备工具的真实帧随 `/continue` 传输，服务端核对来源、参考及真实表单提交；主宿主在成功续轮后才记查看证据。生成任务先保存ID再分发，输出实际解码后回填。

Purpose：按深度视频工作流准备素材、转换和重演。Inputs：来源/深度节点ID，已选人物/环境或真实formCallId，以及目录支持的模型和选项。Outputs：实际taskId、节点ID、时长/尺寸与角色分工；无媒体不报成功。Permissions：只读准备；转换/重演受既有工具执行模式控制；不允许子Agent执行。Failure modes：未查看、表单未提交/跳过/被覆盖、来源变化、取消、缺配置、真实媒体解码及尺寸/时长不匹配。Logging：保留任务/节点/调用身份，不持久化视觉像素正文。Tests：真实宿主到AgentRuntime续轮的聚焦回归及本地FFmpeg验证，未跑E2E，未验证真实供应商质量。完整边界见 接线记录（开发机来源：`reference/agent-depth-integration.md`）。

## 本地视频裁剪

`video_trim({operationId,nodeId,start,end,timeBasis})` 与 `video_trim_retry_save({operationId})` 已接主执行循环；均沿用当前确认模式，不开放给只读子Agent。`timeBasis=node` 表示相对当前节点片段，`source` 表示底层源视频绝对秒。稳定operationId用于同参数重试、合并并发及验证已有持久结果，不能在不确定时换ID重复制作。

Purpose：把指定片段实际导出成新的连接视频节点。Inputs：来源和明确秒范围/时间基准。Outputs：operationId/status/saved/applied/nodeIds及实际时长/尺寸/源范围；不返回媒体正文。Permissions：本机FFmpeg及当前画布素材保存，不调用生成提供方。Failure modes：来源变化、超时/取消、范围或真实输出不符、保存失败；保存失败返回完整applied回执，保留已创建节点。Logging：操作与输出provenance，原视频大体积data URL不重复写入。Tests：时间基准、真实解码边界、刷新复用、取消、保存重试及展示状态的聚焦回归。完整限制见 接口文档（开发机来源：`reference/agent-video-trim.md`）。

## 白模捕获与实际媒体交接

`show_widget` 的隔离iframe现提供本地 `tapnow.createWhiteboxCapture` 与 `tapnow.uploadToCanvas`。前者实际截图/录像；后者提出待确认PNG/视频Blob，宿主用户按钮才添加到画布。不是通用工具桥，不接收任意URL/节点patch/位置。来源、nonce、代码/对话绑定、格式、实际解码、字节摘要和保存均验证。回执进入原trace.result.mediaOutputs；失败/取消不制造节点。保存失败只重试保存。视频转H264 30fps，实际时长调整如实显示。接口及验证限制见 白模集成（开发机来源：`reference/agent-whitebox-handoff-integration.md`）。

`generation_video_models({model?,referenceCounts?:{image?,video?,audio?}})` 为只读本地目录查询：返回模型模式/参考预算及真实目录选项；不调用供应商，无Key可用。缺模型/非整数计数报错。输出明确 `liveProviderVerified:false`，不能视为服务已配置或真实模型效果证明。图/视频通用Agent提交也解析本地媒体真实字节，保留参考ID/顺序，并在分发前检查原节点身份和来源是否改变。


## 个人主体库

新增 subjects_list/read/save/archive/apply。读取也开放给只读子 Agent；写入和导入沿用既有确认/Auto 模式。save 从实际节点快照保存，更新和归档需要内容版本；apply 使用明确世界坐标并复用一次画布事务。保存失败后的重试保持 operationId 和参数一致，检查 applied/saved/currentMatches。主体库修改不能由画布撤销恢复。完整 Purpose、Inputs、Outputs、Permissions、Failure modes、Logging 与验证范围见 主体库合同（开发机来源：`reference/agent-subjects.md`）。


## 图片编辑器

新增 image_editor_create/open/read/edit/save/export/close，调用现有 Fabric 编辑器。新建使用画布世界坐标；所有图层操作使用画板逻辑像素。修改和保存需要当前 sessionId/expectedRevision；read 支持图层与文本分页。保存保留完整图层及全分辨率合成，检查 applied/saved/currentMatches。工具未开放给子 Agent。Purpose、Inputs、Outputs、Permissions、Failure modes、Logging 和验证边界见 图片编辑合同（开发机来源：`reference/agent-image-editor.md`）。

图片编辑追加：edit.crop 使用绝对源像素矩形，edit.erase 使用明确图层及画板路径；只有全部目标有效才提交蒙版。image_editor_export 导出 PNG/JPG/分层栅格 PSD，使用当前会话与版本及稳定 operationId；回执仅确认浏览器下载请求，不能证明磁盘落盘。导出既不保存编辑文档，也不授权生成模型。


## 2026-10-02 本地3D资源与技能管理

- `world_read({nodeId?})`：官方采集模型目录与真实world节点参数、参考可用性；只读，不确认供应商实时支持。
- `world_generate({nodeId,model?,prompt?,isPano?,material?,referenceIds?})`：独立3D节点生成。省略参考使用入边；空数组为无参考。等待真实持久回执才dispatch，返回taskId而非成品。结果状态沿用generation_status/wait。当前仅GLB可应用，原生splat未接入。见 世界生成合同（开发机来源：`reference/agent-world-generation-20261002.md`）。
- `canvas_add` 现支持 `type:world`，位置仍是世界坐标。
- `scene_import({sourceNodeId,sessionId,expectedRevision,sceneIndex?,properties?})`：把画布已有真实GLB导入打开的V2片场。参数的sessionId/revision必须来自刚读取的scene_read；properties旋转单位是弧度。
- `scene_redo({sessionId,expectedRevision})`：真实片场历史重做；不会重发模型请求。V2环境可原子修改ground.grid及光照。保存失败若已应用会明确返回applied:true，不能盲目重做。见 [片场控制](AGENT-STUDIO-LOCAL-CONTROLS.md)。
- `skills_rename({name,new_name,base_version,operation_id})` / `skills_uninstall({name,base_version,operation_id})`：管理个人技能，自动模式下仍必须用户确认。官方技能不可更改；相同operation_id只核实原结果，不再次覆盖后来编辑的技能。卸载无归档恢复。会话引用刷新失败以referencesUpdated:false单列，不掩盖已提交的技能变更。
- `skills_list({includeDisabled:true})` 可列禁用个人技能元数据；读取禁用个人技能仅返回管理版本，不返回可执行正文，也不启用技能。

上述新增入口复用既有UI、确认、任务/持久化与本地资源实现。没有真实供应商或GPU视觉验收；任务跨服务重启恢复与专用world结果跨刷新回填仍不完整。


## 子 Agent 依赖编排

`agent_delegate` 接收1–6项 `{id,title,instructions,dependsOn?}`，支持乱序定义的无环依赖图。服务端以前置任务真实终态决定后续可否启动，并以实际记录传递有界结论；前置失败会产生 `skipped` / `blockedBy`，不能算完成。子Agent仍仅能读取和建议。

新增 `POST /api/agent/delegated-state` 输入 `{sessionId,callId,taskId}`，为纯只读原会话状态查询。返回对应snapshot及started，未开始返回not_started；不创建会话/批次或调用SDK。它仅用于当前进程的丢回包核对，不提供跨服务重启恢复，也不授权重新启动任务。完整合同与验证见 依赖接线（开发机来源：`reference/agent-delegation-integration.md`）。
