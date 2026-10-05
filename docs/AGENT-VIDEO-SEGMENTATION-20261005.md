# Agent 首次 SAM2 目标识别

Agent 能对现有真实视频选择源像素矩形及源绝对提示时间，使用已配置的 `replicate-sam2-native` 固定模型版本，保存完整源时间轴的时序蒙层。它只识别并保存目标，不自动移除、替换或生成编辑视频。

## 工具合同

| 工具 | 输入 | 行为 |
| --- | --- | --- |
| `video_segment_target` | `operationId` UUID、`nodeId`、`rect:{x,y,width,height}`、`time` | 首次识别；相同 UUID 重入只查询原任务 |
| `video_segmentation_recover` | `nodeId`、原 `taskId` | GET 原任务；完整成功结果可真实应用与保存 |
| `video_segmentation_resume` | 同上 | 独立再次确认后续发原任务未派发分支 |
| `video_segmentation_cancel` | 同上 | 请求取消原任务；已经运行的推理仍可能计费 |
| `video_segmentation_retry_save` | 同上 | 仅读取原本地蒙层素材并重存，不调用提供方 |

`rect` 使用实际完整源视频像素，宽高均至少为完整源尺寸的 2%；`time` 为完整源时间轴的秒数。`clip:[start,end)` 只控制节点播放和后续编辑裁剪，上传不截段，提示时间不减去 `clip.start`。`trim` 需先导出为真实视频。工具不接受模型、URL、Key、替换图或生成参数覆盖。

例：320×180 的视频节点 `video-1`，选区 `(120,60,40,50)`，提示源时间 2.5 秒：

```json
{"operationId":"30fca941-9dcb-4c36-a116-c40d6cb4c023","nodeId":"video-1","rect":{"x":120,"y":60,"width":40,"height":50},"time":2.5}
```

## 批准与持久化边界

首次识别和续发即使在 Agent 自动模式也会显示独立确认卡：完整源上传、前向及可能的倒序片段、最多两次分别计费的推理、取消仍可能收费、固定模型版本和公开提供方指纹。确认前只读取本机公开配置，不读取视频、解码帧或 POST 创建任务。SAM2 配置独立于编辑服务及 GenerationAPI，legacy 网关不用于此链。

确认绑定项目、实际节点对象、源引用/节点内容、clip、baseline mask 和完整参数。执行再校验固定版本/提供方指纹；resume 同时匹配已批准配置、原回执和当前配置。实际完整视频字节 SHA256 与源元数据在批准后的读取/解码中确定；元数据解码使用同一上传字节。

首次 create 前，真实 `CanvasApp.saveProject({beforeCommit})`、同 UUID 的节点回执和 Agent 会话 trace `save()+await flushConversation()` 都成功。共享节点回执的 `dispatched/unknown` 在 POST 前保存。create/resume 请求携带 `X-Segmentation-Model-Version` 与 `X-Segmentation-Provider-Fingerprint` 两个公开批准值；服务端在读取 body/媒体或调用提供方前拒绝缺失或不匹配的值，避免确认后服务重启换配置而产生推理费用。保存冲突或失败阻止派发；已保留原回执不会被新 UUID 覆盖。刷新、未知、失败、取消及重入只查询原 UUID，GET 不续发推理。

完整成功回执必须匹配 UUID、固定版本、提供方指纹、实际源 SHA256，并通过全源 mask 校验。可变来源在应用前重读并比对实际字节。复用 `createMaskApplication` 与真实 guarded canvas save，蒙层素材和 history patch 各只创建一次。项目保存、applied 节点回执及 applied 会话 checkpoint 都成功后才返回 `status:applied, applied:true, saved:true`。

保存失败返回 `save_failed`、原 `taskId` 和 `video_segmentation_retry_save`；重试复用原 asset 和 history。取消是原任务的独立范围守卫：只核对项目、当前节点对象及回执 UUID/revision，源引用/clip/蒙层漂移不阻止取消，也不会应用蒙层；查询、续发与应用仍严格核对来源。恢复卡提供原 UUID 查询、取消、重存及需要时的独立续发确认；它不请求新模型轮次，不创建编辑视频。若首次识别已完成但保存失败使原 Agent 轮次停在 `waiting_tools`，独立恢复保存成功后，仅对同项目/对话/原 callId/runId/UUID/参数且唯一待办的首次识别调用，补存真实完整工具回执到既有 journal。原失败 trace 保留；除本次唯一蒙层 patch 外的整个来源版本必须与原 journal 一致。用户随后核对并明确继续原轮次，不重放识别或自动调用模型。

## 文件与验证

- `src/features/agent-generation/video-segmentation.mjs`：独立原生执行、批准守卫及恢复。
- `src/features/agent-generation/video-segmentation-card.mjs`：原 UUID 恢复操作。
- `src/features/agent-generation/video-segmentation-receipt.mjs`：保存完成后严守原调用身份补存首次识别回执。
- `src/features/video-mask/source-transport.mjs`：Agent 与原视频面板共享完整源媒体运输。
- `agent-tools.js` / `agent-client.js` / `server/agent.cjs`：schema、客户端审批/checkpoint 和模型指令。
- `src/features/agent-execution/trace.mjs` / `presentation.mjs`：强制确认与具体披露。

```bash
node --test tests/agent-video-segmentation.test.cjs tests/agent-video-mask.test.cjs tests/video-segmentation-frontend.test.cjs tests/video-segmentation-canvas-save.test.cjs
```

测试使用真实视频字节、生产客户端 dispatch/配置捕获/checkpoint 片段和独立 trace 执行器；提供方及视频解码以确定性夹具替代。覆盖审批前零媒体/零创建、auto 强制确认、对象/参数/配置漂移、UUID 前持久闸门、原 UUID GET、全源 mask/source SHA、保存失败同素材重试、resume 的 A→批准 B→执行 A 拒绝及 UI 回执兼容。未使用真实 Key 或进行收费推理。真实宿主浏览器/FFmpeg 合成提供方验证由本批 QA 单独记录。

已有 `updateNode` 自动保存可能在 guarded 保存完成前写入 pending patch；只有 applied 回执允许成功声明，不能把可见节点变化视为保存完成。删除本地原任务记录、模型能力或供应商实际可用性不在此工具中自动推断。

## session-b 真实宿主验收

2026-10-05，root 使用 CUA 操作正式 Agent 输入、确认卡和恢复卡。宿主运行真实 AgentRuntime、会话存储、native task/store、FFmpeg、PNG 归档及 LocalAssets；LLM 调用和提供方输出由固定合成夹具替代，不涉及真实 Key 或收费推理。

- 自动模式首次识别仍显示独立确认；确认前源读取、创建任务和提供方调用均为 0。批准后归档完整 50 帧全源蒙层。
- 注入真实画布保存失败后，正式恢复卡重存成功，复用原 asset/UUID；未新建任务或蒙层素材。成功卡显示已保存，移除保存重试入口；原失败 trace 保留。
- QA 宿主保留原存储重载后，新回执恢复模块返回 200。浏览器刷新后，原蒙层、UUID 和素材仍在。
- 点击旧失败卡的正式重存操作后，原 journal 完整工具回执得到保存，提示明确核对并继续，继续按钮启用。该本地恢复阶段 LLM 调用计数保持 9；宿主累计 native task POST / prediction POST 计数保持 4 / 7，刷新后本页 asset put 计数保持 0。上述为复用宿主的累计计数，不代表本次重新创建了这些任务。
- 再次只读核对后，用户明确点击继续，固定 LLM 返回终态，generic 中断卡消失。补存回执和只读核对均未自动请求模型或重放识别；原失败历史未被伪造为成功。

最终会话 `919195d8-cae2-41f0-98df-827a15b89095` 为 `completed`、`pending=[]`、`receipts=1`。明确继续后LLM累计9→10，native创建4和供应商推理7均不变；原工具回执闭环成立。

后续session-c使用真实持久视频/封面asset，重存、明确继续及刷新保持同一蒙层，没有资源迁移提示；结果卡通过正式LocalAssets解析，本机Blob实际解码320×180，迟到来源受保护。工具标题区分needs_resume、unknown、cancelled、save_failed等结果，只有`status=applied`且`applied=true/saved=true`及无错误才显示完整保存。

cancel3已验停止等待后换clip再取消原UUID，无蒙层；resume2已验同store重启后独立确认，仅补倒序26帧，原UUID完整50帧和单asset保存，刷新仍applied。详见[整批结果、截图和限制](LOCAL-AGENT-SEGMENTATION-AND-EXPORTS-20261005.md)与[只读审计](research/agent-sam2-cua-20261005.json)。此验收证明本地完整链路及恢复边界，不证明实际 Replicate 模型的识别质量或生产供应商可用性。
