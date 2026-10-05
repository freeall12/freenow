# Agent SAM2 原生整链隔离验收 · 1005o

公共维护源码为同目录 `agent-segmentation-server.cjs`、`agent-segmentation-fixture.js`、`agent-segmentation-source.js`、`agent-segmentation-controls.mjs`、本说明，以及 `scripts/build-agent-segmentation-fixture.cjs`。`agent-segmentation-app.html` 是派生页，`.gitignore` 仅精确忽略该文件；其他fixture源码可正常跟踪。

可从正式 `index.html` 单独重新生成页面：

```bash
node scripts/build-agent-segmentation-fixture.cjs
```

构建器保留正式入口的生产模块、样式与import map，仅加入隔离bootstrap、公开defaults、一个合成来源节点和QA控制面板。关键入口标记缺失或重复时直接报错，避免静默生成带错误来源的页面。运行下面的host启动命令时也会自动执行构建，不需要预先提交或手工复制生成页。依赖使用本项目既有 `node_modules`，本机需可执行Node、FFmpeg和FFprobe；不安装新依赖。

启动（不读取供应商 / 模型环境变量）：

```bash
env -i PATH=/Users/laplace/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin \
  /opt/homebrew/bin/node src/features/agent-generation/qa/agent-segmentation-server.cjs
```

输出动态 loopback 页面 URL 与只读 `/qa/agent-segmentation-audit`；另一个动态端口只承载该 QA 自己创建的 native host。4173 和上批62798不受影响。退出会关闭两个监听、Agent/session store、native store并清理所属临时目录。

实际链路为：正式 Agent composer/send → HTTP NDJSON → `AgentRuntime` / 私有会话检查点 → 固定 `Responses.create` 工具方案 → 正式 client/trace / 独立 ask 卡 → 实际来源读取与原 UUID 保存 → native HTTP task → 实际 FFmpeg 前向/倒序片段 →真实 FormData 文件字节 → 明确合成 Replicate边界 → 原始 PNG → 严格 binary/RLE 合并 → 实际 LocalAssets / CanvasStore 保存。

只固定 LLM Responses 和 Replicate供应商边界，不替换审批、工具执行、native任务、媒体、canvas保存或恢复。首次 create POST 之前，浏览器 fixture 额外读取真实持久化 conversation trace，核对同UUID `submittedTaskId`、`segmentationTask.id` 与 `unknown` checkpoint；缺失时直接拒绝。没有真实外部模型 / 云请求、真实Key或私人来源。

源是 H.264/yuv420p、320×180、5秒、10fps的公开合成移动矩形，SHA256为 `6f1626326e04801beac78be182d855fffcd30e4067fe3cb72c94392a8f06a306`。新session的空画布在正式hydrate前，从本机 `/qa/sam2-source.mp4` 读取同一真实MP4、校验SHA、通过生产视频reader解码封面，再分别写入真实LocalAssets并回读校验。节点video与image/poster均为持久asset引用，初始history为空；clip `[1,4)`不变。已有session不改来源或历史。早期session-b使用绝对loopback URL且没有封面，刷新迁移会把当前和历史未索引来源记为2项待导入；保留此来源边界记录，不放宽生产迁移规则。固定方案使用源像素矩形 `{x:120,y:60,width:40,height:50}` 与绝对2.5秒。分割读取完整源；原剪辑边界仍保留。上传片段再经实际FFmpeg解码，对照实际source decoded RGB及索引验证。

页面 `session` 定义独立 localStorage / IndexedDB 前缀，同 session reload保留画布、原UUID、Agent对话和local资产。`&auto` 在生产client启动之前设置auto；SAM2首识别和resume仍必须显式确认。面板“准备”按钮只设置固定方案并填写实际composer，等待真实发送按钮启用后显示 `prepared`；用户再点击右侧正式“发送”一次。QA不自动点击发送，以免把未就绪输入或第二次手动点击变成重复队列。发送中状态与 `agentTurnPosts` 来自真实 `/api/agent/turn` 请求。生产任务卡提供同UUID查询、续发、取消与保存重试。

当前项目使用pnpm，Three.js安装路径经过隐藏 `.pnpm` 目录。Agent QA仅将公开 `/node_modules/three/` URL绑定到 `realpath(node_modules/three)` 的精确已安装包根；每次请求仍检查公开路径及最终文件位于该包内。没有开放通用node_modules、隐藏目录或跨包symlink，没有StudioAPI stub。其余静态文件继续使用既有public static政策。

开发期间新增的公开JS/MJS，outer host在首次白名单未命中时重新读取 `git ls-files --cached --others --exclude-standard`，仍要求公开路径、Git列出且真实symlink目标公开。这样后续新增production module无需因inner host的启动时快照404而丢失恢复按钮；忽略/私有文件和通用node_modules保持拒绝。

建议依次验收：

1. 新session首次识别，确认前 audit task/供应商POST均为0；点生产确认，最终 mask exactly50帧、fps10、forward25+reverse26，共51PNG，源节点 `videoMask.taskId` 等于原UUID。
2. 新session拒绝审批，或 `&auto` 检查仍有确认屏障；不得产生task / 云POST。
3. 确认前改变来源clip，审批守卫拒绝，0POST。
4. 切换画布保存失败，再确认识别；完整mask保留一个local asset，关闭失败开关后用生产卡“重试保存”，不得新增推理或复制asset。
5. `unknown-receipt` 模式模拟云接受POST但响应丢失；仅查询原UUID，不得再次create或补派另一路。
6. `needs-resume` 模式在reverse上传等待；面板重启native同store，原UUID查询得到needs_resume；改success后通过生产独立ask确认续发。前一路不重复推理。

审计同时提供 supplier counts / upload+PNG hashes、native私有任务摘要、固定LLM调用与真实Agent session检查点摘要。服务在首轮浏览器验收前只执行静态/只读HTTP检查：HTML/bootstrap/controls/MP4/config/audit HTTP200，private/.env HTTP403，任务/供应商/LLM计数为0；语法与diff空白检查通过。实际审批、交互、保存和刷新由 root 独占CUA验收，最终通过记录见下文。未重跑已有39项测试。

合成供应商按已知矩形生成精确二值PNG，证明本地格式与流程，不证明真实SAM2识别质量、GPU双路一致性或账户可用性。

本轮CUA已暴露fixture时间边界：`delay` 约5秒，早期两次都正常完成50帧，只记附加成功，不能计作取消验证。`needs-resume` 的reverse上传hold仍受真实transport默认30秒timeout；原任务 `175c40bb-a8a6-4f63-8874-37dc12079c9a` 在forward25PNG归档后reverse上传超时，进入failed，不能把超时解释成成功续发。这些早期任务与回执保留，后续通过结果不覆盖原边界记录。

2026-10-05 root 的最终CUA记录：

- `session-c`：新来源video和image/poster为真实持久LocalAssets，缩略图通过浏览器解码为320×180；保存失败后的同asset重存、Agent显式继续及同session刷新通过。
- `cancel3`，原UUID `586513f4-b245-4fb2-9e84-b3473bc91ed4`：运行中停止等待，将clip从 `[1,4)` 改为 `[2,4)`，再通过正式请求取消。原任务最终 `cancelled`，未生成mask或mask asset；forward25帧已归档且remote cancel为confirmed，reverse停在uploading、0/26、无prediction。远端cancel累计1。
- `resume2`，原UUID `dd315cfb-1d40-49a8-bff5-39012c49cc4b`：`needs-resume` 在30秒预算内重启native同store；恢复为forward25已归档、reverse pending。正式卡查询没有增加POST，正式续发仍显示独立确认。确认前累计native resume0 / prediction11 / task7 / LLM15；确认后为resume1 / prediction12 / task7 / LLM15，仅reverse26帧新派发，forward没有重复推理。最终生成50帧mask，LocalAssets只写一次 `asset:c022e2b7-6856-483a-b336-286062173c8e`、22684字节，clip `[1,4)` 与绝对2.5秒保留。

以上计数为同一QA host的累计审计，不代表每个session从零开始，也不包含真实外部SAM2服务验证。

遇到新增恢复module的静态404时，曾进行一次有备份的QA host重载：先保存同一临时目录中的完整native task / PNG / RLE、Agent sessions、源MP4和supplier/LLM审计，再以原54761 origin和native端口复用该目录重启。浏览器session / IndexedDB不清空；source原字节复用。CLI可选参数为 `[outerPort] [ownedNativeTempDirectory] [nativePort]`，只能使用当前host所属QA临时目录，禁止指向正式服务或其他项目。服务正常退出会清理该目录，因此维护性重载前须先完整备份并重新获取writer lease；不要直接终止而丢弃已完成任务。
