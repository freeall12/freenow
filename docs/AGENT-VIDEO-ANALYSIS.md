# Agent 分镜解析桥接

`src/features/agent-workflows/video-analysis.mjs` 将 Agent 的单个来源视频接入已有 `GenerationAPI.submitDerived`，提交原生 `video.analyze / film_scene_breakdown` 请求。实际镜头检测、MP4 裁片、JPEG 封面及逐镜视觉描述由既有 [原生解析适配器](OPENAI-VIDEO-ANALYSIS.md) 完成。桥接层不生成替代描述、不裁剪伪片段，也不实现另一个模型派发器。

## 工具与接口

已注册可变更工具 `video_analyze`，参数仅为 `{operationId, nodeId}`；二者均为1–180字符的稳定非空字符串。无额外提示词、模型猜选、切点或镜头数参数。

```js
import {createAgentVideoAnalysis} from '../src/features/agent-workflows/video-analysis.mjs';
const host = createAgentVideoAnalysis({
  app: CanvasApp,
  generationAPI: GenerationAPI,
  localAssets: LocalAssets,
  storage: localStorage,
  getProjectId: () => CanvasProjects.id()
});

const result = await host.execute({operationId:'scene-breakdown-1',nodeId:'source-video'}, {
  signal,
  authorize: (name, args) => assertCurrentApprovedCall(name, args),
  onSubmitted: async job => persistAgentTaskReceipt(job.id)
});
// {operationId,taskId,status,applied,applying,applicationStatus,
//  resultIds,nodeIds,error?,applicationError?,recoveryRequired?,next?}
host.get('scene-breakdown-1');
host.dispose();
```

`authorize` 是本次执行循环持有的宿主函数，接受 `('video_analyze', 原参数)`；缺少它即拒绝。模型不能在工具参数中制造批准。执行器应沿用当前写画布/外部生成的审批规则，并将 `onSubmitted` 接到现有执行卡与父运行检查点保存函数。

`GenerationAPI.submitDerived` 必须把 `target.beforeDispatchReady` 传到 `submitJob`。桥接先获得原 taskId、写入操作记录，再在该门闩内复核授权并等待 Agent 任务回执持久化；回执失败、来源改变或取消会阻止模型派发。回调在派发前运行，不能在已开始请求之后才补记任务身份。现有历史门闩仍按原顺序执行。

## 素材准备与生命周期

导出 `prepareAgentVideoAnalysisRequest(node,{resolveMedia,signal,validateSources,baseUrl,transport})`，供其他入口共用准备合同。它通过现有 `createWorkflowMediaResolver` 解码完整来源，临时媒体节点不携带显示节点的 `clip`；实际宽高、完整原片时长与原片绝对 `clip:{start,end}` 一起进入请求。随后复用 `prepareWorkflowInputs` 进行本地素材传输、请求预算和取消检查。原生网关进一步沿用 `prepareVideoAnalysisMedia` 的40 MiB原片边界及能力映射。

桥接不会先导出显示片段，再把原片 `clip` 套在该片段上。`trim` 旧格式、非法裁切区间、实际尺寸/时长/世界坐标缺失均失败。准备和任务派发/应用间持续核对来源节点身份、媒体内容标识、绝对裁切范围和项目身份；来源替换、删除、裁切更改或切换画布时，迟到结果无法回填。

`execute` 返回实际提交回执，通常为 queued/running，随后使用现有 `generation_status`、`generation_wait` 读取进展。`status:'succeeded'` 仅表示提供方已返回；只有 `applied:true` 才表示既有应用链已完成。`resultIds/nodeIds` 来自实际任务回填，未完成时为空；不返回视频 data URL。已物理裁切的镜头输出不再设置 `clip`，`sourceRange` 仅标注原片出处，播放器不能把它再次用作播放裁切范围。

准备超时默认60秒（可注入1–120000毫秒），只限制桥接素材准备和派发回执等待。实际分析时限继续由生成网关掌握，默认10分钟。取消会请求原任务取消并阻止本地迟到应用；它不能证明远端已停止、未扣费或退款。

## 幂等、恢复与应用重试

操作记录存入项目独立的 `tapnow.agent.video-analysis.operations.v1.<encoded-project-id>`。记录仅含原工具参数、请求指纹、状态、taskId和错误摘要，不含媒体、URL、Key或来源正文。最多500条，满时明确失败，不能淘汰未知任务来继续生成。存储不可用或损坏时，拒绝提交。

- 同一 `operationId` 的相同调用在准备中共享一个 Promise，提交后返回原任务回执；参数变化拒绝。已失败或取消也不自动重发，需要明确的新操作身份。
- 同一来源已有 queued/running/unknown 或 succeeded但未应用的手动/Agent解析任务时，拒绝建立第二个任务。先查询、应用或取消已有任务。
- 页面刷新后，仅存操作回执而当前任务Map尚无该 taskId时，返回 `status:'unknown'` 与 `recoveryRequired:true`；不能把旧 succeeded记录当成当前已验证完成。使用 `generation_recover` 查询原 taskId，该查询只走GET。
- 准备期间中断且尚无 taskId时也保留不确定记录，同一操作不重放；先检查现有生成记录。桥接不把“没有当前任务Map”当成“从未调用模型”的证明。
- 成功但应用失败时，保留原输出与实际 `resultIds`，用 `generation_retry_application` 重试既有应用链；它不重新准备素材、不重发模型请求。刷新后按现有恢复合同显式选择结果应用方式。
- 任务托盘若用旧任务创建新任务身份，门闩会因 taskId变化而拒绝；同一操作不能借托盘重试绕过幂等记录。

接口仍依赖用户配置可用视觉模型及既有 FFmpeg/FFprobe。configuration_required、unknown、应用失败都有真实意义，不应展示为解析完成。

## 验证与边界

```sh
node --check src/features/agent-workflows/video-analysis.mjs
node --test tests/agent-video-analysis.test.cjs
```

专项12项回归通过，使用真实 `TaskService`、真实应用执行器及从 `generation-ui.js` 提取的 `submitDerived`，覆盖完整源与clip、真实回填身份、回执门闩、相同操作并发、失败/缺授权/存储错误无派发、unknown/刷新不重放、原结果应用重试、来源/项目改变、无视取消的迟到准备、超时、同来源既有任务和非法请求。媒体与模型在此专项是协议注入替身；这证明接线与生命周期，不能证明真实视觉描述质量、复杂转场检测或官方布局一致性。实际媒体处理另有 `generation-video-analysis-integration.test.cjs` 与 `video-scene-media.test.cjs`。

与本地裁剪、手动解析生命周期、原生素材传输、派发回执和原生分镜集成测试联合51项通过。该集成确实运行本机FFmpeg并验证原片范围、物理MP4裁片与任务重启；视觉描述仍由注入SDK提供，未使用真实供应商Key。
