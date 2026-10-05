# Agent 已保存视频蒙层编辑（2026-10-05）

`generation_submit` 新增 `video.erase`、`video.replace`。Agent 使用视频节点已保存的完整时序 RLE 蒙层，保留原视频并创建连接结果。没有蒙层时返回 `mask_required`，提示打开“添加蒙层”识别并保存；不会猜矩形、自动分割或创建编辑任务。

主线程后续已完成真实浏览器手动移除、自动替换、刷新和审批中来源变化验收，见[本批实机记录](LOCAL-VIDEO-MASK-AGENT-20261005.md)。手动确认前素材/蒙层读取及POST为0；自动替换提交512×320原图、完整240帧与原clip1..5，保存一个连接结果；来源clip变2..6后旧确认明确拒绝、读取和POST均0。这里的LLM/生成输出是合成夹具，不能证明真实模型效果。

最终配置交审另修复陈旧isConfigured响应误写任务配置ID：完整公开metadata须与当前快照一致才可接受陈旧响应；最新失败清null则拒绝。同值配置并行仍允许，两任务各单次POST且header准确；6项实际TaskService/header回归通过。结果封面用实际解码首帧，刷新保留，不用源图代替。

## 工具合同

Purpose：把已识别并保存的时序蒙层、完整视频和原选段传入现有生产生成链路，完成视频移除或替换。

Inputs：`kind`、`nodeId`、空 `prompt`；`count` 省略或 1。移除的 `referenceIds` 省略或空数组；替换恰好指定一个实际图片节点，输入优先 `fullImage || image`。不接受模型、供应商、分辨率、矩形或其他静默覆盖参数。

```json
{"kind":"video.erase","nodeId":"video-source","prompt":""}
```

```json
{"kind":"video.replace","nodeId":"video-source","prompt":"","referenceIds":["replacement-image"]}
```

来源节点须为实际 video。保存描述符为 `node.videoMask={source,clip,asset,time,width,height,duration}`；source 和 `JSON.stringify(node.clip || null)` 必须与当前来源一致，asset 须是本机不可变 `asset:` 素材。`trim` 选段当前会明确拒绝，避免忽略它而编辑错误时段。蒙层 JSON 须带 `rle-zero-based-row-major` 编码、完整来源尺寸、fps 和逐帧 RLE；使用共享 `validateMask` 核对完整时长与索引。

Outputs：提交返回 `nodeId`、原 `taskId` 和当时 status。任务成功和结果应用成功分别来自生产 TaskService / application 状态；工具提交回执不等于视频已生成。结果标题“视频移除 / 视频替换”，节点连接到来源；createConnected 后等待实际 `app.saveProject()`。

Permissions：沿用 Agent ask/auto。ask 待审批、拒绝不读素材、不创建任务。未配置或无法建立非null公开配置身份时返回 `configuration_required`，不读保存蒙层或视频；不以未知custom provider代替已批准供应商。没有蒙层先返回“添加蒙层”提示，不发 provider 请求。

Failure modes：审批前纯metadata绑定项目、来源节点对象/类型/视频地址/clip/蒙层asset及完整描述符、替换节点对象/fullImage/选区等，不提前resolve或读取素材；待审批期间对象替换或元数据变化也拒绝。异步 availability、蒙层读取、媒体准备、dispatch 和 apply 后均检查。蒙层读取仅接受 LocalAssets 返回的 blob URL，20 秒超时、66 MiB 上限和可取消有界 UTF-8 读取，不读远程 mask。参数、元数据或来源变化会拒绝，不用变化后的素材继续原任务。

派发前必须等待现有 Agent `onDepthSubmitted` 保存并 flush 原任务 ID；缺回执入口、保存失败、取消或上游 generation history gate 失败均停止 provider。保存结果失败时保留已创建的节点对象、ID 和结果 URL，应用重试再次保存这些节点；不会再次创建、重新 POST 或覆盖已被用户修改/移除的结果。刷新使用持久原 taskId GET 恢复，不用新任务替代原任务。

Logging：taskId 进入现有 conversation trace；`attachGenerationJob` 提供 status/applied/applicationError/resultIds。生产审批与任务动作标签“视频移除 / 视频替换”。审批前只读取公开configuration，将共享native-profile的简短hint写入trace，在实际确认卡展示“独立替代 / Wan VACE / 上传fal CDN / 本机保留原声音 / 效果待验”；已批准配置指纹贯穿同步 `configurationSnapshot` 派发守卫，availability之后、蒙层读取每次await、TaskService isConfigured后/媒体prepare前后/最终provider前均比较。配置失败清空为null也拒绝，不能回退其他provider。结果已完成后的应用只核来源守卫，后续配置变化不阻断原结果保存重试。隔离 QA 另记录实际请求、dispatch 前 acknowledged、完整 source、clip、frame 数、替换原图尺寸与错误，便于独立核查。

## 供应商和能力边界

Agent 使用现有 GenerationAPI `runInPlace`，`generation-ui.js` 选择共享 `prepareMaskedVideoMedia`：解析实际来源，保留完整视频、完整蒙层和原 `sourceClip`，由 backend 对实际 bytes 联合裁出选段与时序遮罩。替换图沿用共享 PNG 原尺寸解码规范化；没有发送缩略图、单帧蒙层或偷偷改变选段。

当前 native profile 明确是 **独立替代：Wan VACE 14B / 720p / adaptive / 单结果**，不是已验证与原站相同的后端。native readiness 要求完整时序能力、5–30 fps 和 81–241 帧选段，时间点精确对齐帧边界；不补帧、截断或改速。真实服务会将选定来源片段、黑白时序遮罩及替换图片上传到 fal CDN；原选段音轨由本机 remux 保存。披露文字由共享 native-profile 提供，实际 Agent确认卡消费其hint；真实浏览器展示由主任务核验。

本轮没有真实密钥、付费供应商请求或实际模型效果验证。固定 QA 输出是从公开合成来源裁出的 4 秒 MP4，仅用于验证可解码媒体、协议、落图和恢复，不能当作移除/替换视觉效果证据。

## 限定验证

```bash
node --test tests/agent-video-mask.test.cjs
node scripts/build-agent-video-mask-fixture.cjs
node --test tests/agent-video-mask-fixture.test.cjs
```

9/9 Agent 链路测试通过：实际 schema/client dispatcher、ask 待审批与拒绝、auto、实际 durable callback、TaskService、当前 runInPlace/custom apply 分支、生产 application runner、共享蒙层 media/native-profile/transport、loopback HTTP，使用真实 MP4 / PNG bytes。覆盖完整 8 秒来源 + 原 clip1..5 + 完整 240 帧 RLE + 512×320 替换原图；15 组项目/节点/clip/蒙层asset/fullImage跨阶段漂移；回执/历史失败和等待中取消；save=disk full 后相同连接节点ID重试，POST仍为1；新 TaskService仅GET原taskId。新增7种待审批来源漂移均assetReads0/job0/POST0；配置在availability/isConfigured/最终dispatch及mask/media读取中变化或clearNull均POST0；diskfull应用重试前配置clearNull仍同ID成功，POST保持1。Node替换浏览器元数据读取原语和最终PNG规范化原语，周围生产流程保持真实；不将Node通过计为浏览器通过。

6/6 QA fixture 测试通过：不访问origin localStorage；fetch/DB getter异常fail closed；namespace DB open和禁止deleteDatabase；CSP先于所有script、没有同源API connect权限；catalog按document.baseURI精确GET；合成资源迁移索引不读私有映射；独立fixture tasks/posts恢复；实际Agent turn/continue入口；生产prepareMaskedVideoMedia进入固定任务入口前断言已保存任务ID、全源/全时序/原选段/实际高清PNG。恢复只GET、不新增POST。新增专项提取实际client配置preflight/trace changed/dispatch guard，经实际executeTracedCall核对确认卡披露；审批后配置变更时provider0。

以上9个实现/QA/test脚本的 `node --check`、tracked scoped `git diff --check` 均通过。浏览器 CUA 由主任务执行，当前文档不声称已验证浏览器交互或真实 Wan 视觉效果。

独立审查曾复现两个缺口：首版client仅入口比配置A，helper availability刷新B后仍可进入runInPlace；首版helper在批准后才建立sourceGuard，待审批sourceA换成同id的自洽B会提交B。上述连续配置守卫与审批前source快照是针对这些反例的修复，不把首版单次配置检查当作已完成的派发绑定。

修复后独立只读交审已完成：原A→availabilityB及蒙层读取期间A→B反例均0派发；实际client guard + executeTracedCall + helper的11场景中，正常1派发，项目、同id来源对象、来源URL、clip、mask metadata、同id替换对象、替换URL/选区等漂移均0，批准前读取0。reviewer另fresh复跑3项新增窄测，确认clearNull拒绝及diskfull重试仍同ID/POST1；未发现剩余阻断。没有把这些独立协议反例当作浏览器视觉或真实供应商效果证据。

## 隔离全应用验收

访问当前项目本地 listener 的 `/qa/agent-video-mask-app.html?session=unique`，每场景用不同session：

| 场景 | query | 应核对 |
| --- | --- | --- |
| 移除手动审批 | 默认 | 审批前POST0/mediaRead0；允许后POST1/acknowledged=true/连接结果/applied |
| 替换自动审批 | `&kind=replace&auto` | 原PNG512×320、thumbnail未用于提交、clip1..5、full mask240frames |
| 缺失蒙层 | `&missing-mask` | “添加蒙层”提示、POST0/job0 |
| 未配置 | `&configured=false` | 配置提示、POST0/蒙层及来源未读取 |
| 来源漂移 | 审批前点“改变来源选段”或“清除夹具蒙层” | 原保存蒙层不适用于新来源，不提交provider |
| 刷新恢复 | 同session刷新 | fixture taskRecords ready、原ID、POST仍1、结果ID不变 |

fixture在任何脚本前安装CSP，JS先安装deny fetch再读取bootstrap getter。connect-src只允许localhost/127 QA媒体、精确skills-catalog、blob/data，不能真实转发API。偏好独立page-memory，不读/清理用户localStorage；canvas/assets/templates/derived数据库均限制session namespace，禁止deleteDatabase。精确资源索引GET返回空合成映射，不读私有文件。receipt/posts保存在namespaced CanvasStore，加载中posts=null，不能误报为历史0。

controls等待实际画布load/save边界后向真实LocalAssets写入已通过共享validateMask的合成完整RLE描述符，并保存项目；明确标注“合成完整蒙层”，不是分割能力。刷新复用已有保存蒙层而不重新生成。可见数据报告支持折叠，保留配置/来源漂移控制。生成HTML忽略于Git，可由上述脚本从当前index重建。

主任务首次 `agent-mask-drift-cua1` 漂移尝试没有实际修改来源：597 CSS像素窗口中，Agent左边界x233，而QA“改变来源选段”按钮位于x254，被更高层Agent覆盖，自动点击落到Agent内容。实际仍提交clip1..5，不能据此认定生产guard失败。QA panel原z-index80低于实际agent.css的Agent180，已改为2100，使用210px窄纵向布局、可收缩滚动报告和不收缩控制按钮，保留pointerdown事件隔离；没有修改生产样式或守卫。

后续漂移复验必须先看到报告 `sourceClip={start:2,end:6}` 且保存 `sourceMask.clip` 仍为1..5，再点击正式允许并核对POST0。报告只显示data/blob请求的scheme、MIME类型和长度，不在DOM展示base64或blob地址；普通API/static路径继续可见。上述QA模块直接读取，样式修改无需重建HTML。
