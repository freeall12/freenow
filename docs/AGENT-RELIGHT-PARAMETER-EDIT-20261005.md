# Agent 图片打光参数合同 · 2026-10-05

Agent 的 `generation_submit` 现在支持完整标准光照参数。使用独立 `image.relight` 路径提交一张高清来源图，返回任务回执，生成结果成为一个与原图连接的节点；结果节点等待真实画布保存，保存失败重试沿用同一任务与同一节点。

`openai-relight-native` 是显式配置的 `parameter-prompt-edit` 图像编辑替代：每项参数进入编辑指令，不能保证物理打光精度、原站私有模型等效或输出与源图同尺寸。公开适配合同、模型配置及原生编辑请求见 [OPENAI-RELIGHT-NATIVE.md](OPENAI-RELIGHT-NATIVE.md)。旧自有接口与公开模型的差异见 [IMAGE-RELIGHT-NATIVE-20261005.md](IMAGE-RELIGHT-NATIVE-20261005.md)。

## 工具输入

```json
{
  "kind": "image.relight",
  "nodeId": "image-source",
  "prompt": "",
  "relight": {
    "angle": { "preset": "top_front_right_45" },
    "brightnessPercent": 100,
    "temperatureK": 3000,
    "rimEnabled": true,
    "rimPreset": "low_back_45"
  }
}
```

五组 `relight` 字段全部必需；没有 Agent 隐式默认值。主光位覆盖 `image-relight-core.mjs` 的全部26标准位置，亮度为10/50/100，色温为2000/3000/4000/5600/7000/8000 K，轮廓光位为 `back_0` / `top_back_45` / `low_back_45`。轮廓光开启时主光位必须属于原核心允许的十个位置；不合法组合直接拒绝，不静默关灯。

只有 `kind`、`nodeId`、空 `prompt`、完整 `relight`、可选 `referenceIds` 与 `count` 可出现。参考只能省略或等于单个来源ID，数量只能省略或1。模型、画幅、质量、分辨率、额外提示、额外参考及两层未知字段均拒绝。其他生成类型不接受 `relight` 字段。正式解析器和执行函数分别执行白名单校验。

来源使用 `fullImage || image`，最终 `inputs` 是单张 `source_image`，`parameters` 使用原核心 `requestParameters`，只含上述五组字段。共享 `prepareRelightMedia` 执行真实素材解析与传输，静态8-bit、非交错、无 tRNS 的 RGB/RGBA PNG通过真实解码校验后保留原字节；其他可解码PNG（如索引/16-bit/交错）、JPEG/WebP按实际原尺寸转为RGB/RGBA PNG；APNG拒绝。尚未导出的 `crop/imageCrop/clip/trim/selection/imageSelection/region` 节点选区拒绝；应先从编辑器导出实际完整图片资产。正式 Fabric 裁切保存会得到新资产，正常支持。

## 权限、失败和记录

- 审批前先通过 `availability({kind:'image.relight', signal})` 刷新本机公开配置，再读取审批快照；旧null或缺配置缓存不会永久阻断已经恢复的服务。刷新前后及读快照后均检查原来源、参数与会话身份，期间取消或漂移则拒绝；不读取媒体或创建任务。
- 审批前只捕获来源对象、ID、项目、高清地址、选区、metadata、参数和公开配置；不读取媒体、不创建任务。审批展示全部参数及独立编辑语义，简短动作使用“图片打光”。没有虚构计价。
- ask / auto 都走既有 `executeTracedCall`。ask 等用户确认，auto按既有模式执行；来源对象同ID替换、来源/项目/参数/选区变化、取消或配置漂移均拒绝。配置派发守卫是同步快照比较，完整同值并发配置不受版本计数误伤。
- `onSubmitted` 将原任务ID写入真实 Agent trace，并等待会话持久化后，TaskService才允许媒体准备和供应商派发。回执或历史保存失败不派发。
- 来源守卫贯穿配置、素材准备、派发和结果保存；配置只约束派发，已生成结果的保存重试可在服务配置被清空后继续。未知任务保留原ID，不能自动重新生成。
- 结果按原站 `gap:200` 连接到来源，保留真实 `image/fullImage`。`relightParameters` 使用与面板一致的核心UI参数结构，含光位坐标和 `brightnessLevel`。结果同ID替换、媒体/参数修改或原任务输出变化均拒绝覆盖或重复创建。
- 任务ID是提交证据，不是已生成或已保存证据；任务/应用状态沿用既有 trace generationJob。保存错误留给原任务的“重试应用结果”，不重POST。

## 专项证据

`tests/agent-relight.test.cjs` 覆盖14项：全部26光位及离散参数；严格schema与非法轮廓光；审批零媒体/零任务；持久回执→真实源PNG→本机HTTP→连接结果；ask拒绝/auto/缺配置；来源/项目/选区/参数变化；配置在准备和立即派发前漂移；取消及存储失败；等待画布保存和原节点重试；中文披露；QA helper；实际Agent transport/client分支/gateway；全UI注入层的真实对话任务ID检查；实际client审批段的null/旧缺配置缓存刷新；配置刷新和快照读取期间的来源与会话守卫。

最终生产参数/结果位置修改后，11项完整专项通过；随后新增的全UI注入层测试单项通过。此前通用图片处理7项专项通过，确保移除旧 `image.relight` 绕过后抠图、多角度和既有回执流程正常。语法检查和差异空白检查通过。没有重复跑全仓测试。

CUA随后发现延迟配置查询超时会将公开配置缓存置null，而Agent审批只读缓存，导致已恢复服务仍显示无法确认。已在正式client审批前主动刷新availability，再读取快照；新增2项焦点回归直接执行 `agent-client.js` 审批段和 `generation-ui.js` 的真实配置刷新/缓存函数，覆盖null与旧缺配置恢复，以及刷新/快照等待期间的来源、同ID替换、项目、参数、对话、activeRun和取消守卫。2/2通过，零媒体读取、零任务、零结果节点。小型QA helper同样刷新配置后捕获审批快照。相邻视频蒙层分支仍直接读配置缓存，存在相同恢复限制，本次未扩展修改。

Node集成运行正式 `agent-tools`、从实际 `agent-client.js` 提取的 `generation_submit` 分支和 `onDepthSubmitted`、正式 TaskService、`runInPlace` 与应用保存路径；HTTP上游只返回明确标记的测试素材，不证明真实供应商效果。PNG完整解码和编辑prompt编译由共享媒体/原生适配的独立专项覆盖。

## 共用隔离QA

完整UI注入层是 `src/features/agent-generation/qa/relight-agent-fixture.js`，须由隔离宿主在自身 `fixture.js` 之后、正式应用脚本之前加载。它只固定 Agent 的 `/config`、`/turn`、`/continue`、`/cancel` 回复；生产 `agent-tools.js`、`agent-client.js` 和审批界面仍执行。生成请求交回宿主，且先检查真实 CanvasStore 对话中已持久原任务ID。其他 Agent 接口失败，不静默调用真实LLM。

`window.RelightAgentFixture.setLighting(value)` 可切换完整合法参数；默认示例与上面的工具调用一致。打开正式 Agent，输入任意测试说明并发送，核对审批中的五组参数，再执行拒绝、批准、auto、等待期间换源、存储失败等场景。`generationReceipts` 记录任务ID是否派发前持久化。

共享 `src/features/image-relight/qa/server.cjs` 的 `mode=pipeline` 运行实际 routed gateway → OpenAI SDK → 精确合成响应边界 → 本机PNG归档（临时独立目录），并复用该Agent注入层；普通模式仍是面板/Three与API边界夹具。主线程已完成正式AgentUI审批、五参数披露、换源拒绝、派发前真实会话回执、一次SDK调用与结果保存；刷新后正式调用详情保留相同任务ID和参数。[浏览器证据与截图](LOCAL-RELIGHT-AGENT-20261005.md)。夹具内存任务列表不作为跨刷新恢复证据。

`tests/fixtures/relight-agent.cjs` 可给本机HTTP宿主提供相同固定Agent回复，不新建生成服务。小型 `relight-controls.mjs` 只用于正式trace/任务模块协议验收，不能冒充完整AgentUI浏览器验收。

实现分工未读取真实Key/env、发起付费调用或安装依赖。主线程只操作本机合成夹具；真实供应商效果仍待验，未运行的验收不记为通过。
