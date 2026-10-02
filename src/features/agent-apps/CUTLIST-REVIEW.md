# 官方拼装审阅

来源为未修改的 `resources/apps/cutlist-review@v1.a3b10365.html`：`It/h_/v_/us/we/vi/__/wm/z_`。原版布局、保留/丢弃、100ms入出点步进、时长跳转、恢复建议、短于1.5s软提示、固定播放顺序与CR1均保留。

## 输入与来源

`show_app` 使用 `resource_uri:"ui://tapnow/cutlist-review@v1"`，可选title和以下data；拒绝选择器参数和其他工具字段。

```json
{"locale":"zh-CN","ratio":"16:9","target_duration_s":6,"notes":"来源视频的实际剪辑建议","shots":[{"id":"actual-video-node-id","label":"片段一","media_duration_ms":8000,"in_ms":0,"out_ms":3000,"default_keep":true,"trim_reason":"保留动作前半段"}]}
```

- 官方字段：`locale?`（中/英/日/韩/法）、`ratio?`、`notes?`、`target_duration_s?`、1–50个shots。片段精确字段为`id,label,media_duration_ms,in_ms,out_ms,default_keep,preview_url?,trim_reason?,flag?,flag_note?`。flag仅`aggressive_trim/drop_suggested/ratio_mismatch`。这些是建议，不表示模型已审核。
- 本地id绑定当前项目真实完整video节点的id；已有clip/trim必须通过正常`video_trim`导出真实完整素材后再审阅。时间基准为底层完整来源绝对毫秒；不默默加clip偏移。
- runtime读取真实MP4/WebM字节并实际解码首帧、宽高与时长，`media_duration_ms`必须等于解码时长四舍五入的毫秒，结束不能越过实际末尾。不能由Agent伪造时长或预览URL；声明preview只能对应该节点的实际媒体/宿主解析地址。
- `prepareAppArgs`→生产`prepareApp`→`bindPreparedResult`把项目、来源签名、SHA256和解码元数据存为宿主`cutlistSourceContext`；卡片恢复必须携带该绑定。节点被删除、替换、裁剪、项目切换或同URL真实字节被替换后，旧确认失效。
- 视频单段最多8MiB、整次实际读取最多16MiB、整页JSON最多15MiB；同媒体复用读取/解码，响应预算仍按每个实际传输URL出现计费。超限明确失败，不能假称播放。实际尺寸最多8192×8192且33MP。普通来源验证30秒超时，带来源轮询、流预算、取消和关闭中止；确认重新流读SHA，保存按钮不重复解码。

## 显示与保存

独立`resources/cutlist-review-proxy.html`只允许本资源v1，并保留双opaque iframe、`sandbox=allow-scripts`、`connect-src 'none'`、禁止网络域。只增加实际有界`data:video`播放；原proxy和原官方页面不变。官方`video.controls`可播放完整来源、点击入出点跳时刻，裁切范围是建议参数，不是已导出视频。

状态精确为`{shots:{[id]:{keep,in_ms,out_ms}}}`，须包含全部来源id，不允许重排或新增。范围为整数、至少100ms，不超真实素材。onReady走实际事务保存初始值；后续保存串行并等事务提交。官方400ms延迟保存且提交按钮不flush，宿主精确核对已提交state：即时未保存修改会拒绝，应等保存后再提交。

CR1为`CR1 v=1;keep=<id>:<in>-<out>,...;drop=<id>,...;confirm=1`，keep/drop各自保持来源顺序；没有drop时省略。确认核对官方五语言摘要、保留数量、四舍五入到0.1s的总长和目标原值，不接纳任意前后缀。至少保留一段，总长最多180000ms；目标不足、片段短于1.5s不阻止。`再改改`精确接受当前locale消息，但不采用未确认编辑。确认可读内容剔除视频data URL，使用稳定`cutlist_<SHA256>`身份进入普通队列，保留widgetOrigin；它没有tools/call和生成授权。

## 生产本地拼装与正常确认

生产 `cutlist_assemble` 已接入正常 `executeTracedCall` 画布修改确认；审核交接本身不会执行拼装。工具精确输入为三个标识，模型不能提供响应、状态、CR1正文、视频URL或授权字段：

```json
{"trace_id":"actual-show-app-trace-id","handoff_id":"cutlist_<64-character-SHA256>","operation_id":"stable-assembly-operation-id"}
```

宿主从当前会话真实已接受的用户/队列交接、`widgetOrigin`和`trace.appHandoffs`查找相同身份，核对原始CR1与当前已保存state；审核后又修改状态须重新确认。校验当前项目、视频真实字节、会话来源后，才由宿主构造执行授权。执行产物回执写入来源trace的`cutlistAssemblyReceipts`并等待会话事务提交；保存前后调用只读`validateReceiptCurrent`再次核验真实产物节点、元数据、provenance、产物SHA与源SHA，失败补偿撤回本次成功回执，不能将会话保存期间已撤销/替换的产物声称完成。来源失效、未接受交接或正常修改确认被拒绝都不会执行。

内部 `createCutlistReviewExecutor` 保留下面接口；它未向iframe开放。只有经过上述正常确认的生产route或QA页面明确的单独本地执行操作，才可构造授权：

```js
const receipt = await executor.execute({
  operationId, message: officialCR1Message, response, state,
  authorization: {kind: 'local_cutlist_assembly', handoffId: confirmedHandoffId}
}, {sourceContext, signal});
```

复用现有`/api/media/playlist`：上传已核验真实视频字节，只按fixed顺序和source时间裁剪拼装，由本机FFmpeg归一化到1280×720/30fps，异画幅按比例留边；不调用生成Provider。产物读取有界16MiB，实际解码核对时长/尺寸并SHA256，LocalAssets保存后再读回实际存储字节核对同一SHA，之后创建真实连接video节点；画布事务保存/flush后再次有界读取产物与源视频SHA，并核对节点、元数据、完整provenance和来源，才返回`applied:true/saved:true/currentMatches:true/nodeIds`。operationId固定；不确定重试不能改计划。保存失败保持可见节点并回报`applied:true/saved:false/currentMatches:false`，同一operation重试只保存已有结果，不重复编码；已删/改结果不自动重建。保存期间来源变化或撤销/篡改结果会明确失败，回执分别保留实际`applied/saved`，不能把已经写入的素材/画布假称撤销。项目切换禁止保存到另一项目。刷新后从持久provenance重新读取实际字节与解码后复用结果。生产route已有操作回执通过内部`expectedReceipt`作为宿主ledger前置约束：旧节点身份、SHA、时长和尺寸必须相同；旧产物被删或回执不一致时不允许重新生成来掩盖。

范围限制：生产Agent通过`cutlist_assemble`执行真实本地拼装，单段裁剪也保留原`video_trim`。本页面审核不会自行执行任一修改工具。没有外部模型生成实现；模型调用保留正常Provider配置和工具权限流程，不能用审核冒充生成。该本地拼装固定16:9，输入ratio只作为建议信息。

## 验收

`/src/features/agent-apps/qa/cutlist-review.html`使用生产prepareApp/controller/card/host、原官方页与独立图谱/专用IndexedDB：`tapnow-qa-cutlist-review-v1`。准备真实`/qa/trim-scenes.mp4`样例后，两个真实节点指向本地存储的同一视频。正常提交只记录普通队列。下方单独本地授权按钮在隔离图谱调用真实FFmpeg服务，回报实际产物、哈希与解码，并可重试保存；不清理其他存储、无模型请求。

```sh
node --test tests/agent-cutlist-review.test.cjs tests/agent-cutlist-review-runtime.test.cjs
```

22个聚焦测试通过：独立执行原官方token/摘要/时间函数对照五locale、固定顺序、180秒边界、缺状态/非法参数、稳定去重/preview剔除、传输预算与proxy、production工具parse→registry、真实来源签名/哈希/恢复、伪造duration/preview拒绝、同URL替换、HTTP/声明/实际流预算与取消、过大解码、超时/关闭、单独授权、保存失败重试、LocalAssets晚回执/读回字节、save/flush后源切换或结果撤销、provenance篡改、createConnected中即时篡改、跨项目保存拒绝、宿主ledger身份/哈希对照、存盘期间同asset/同URL实际字节替换拒绝及会话保存等待窗口的只读最终核验。Node解码为明确桩，真实浏览器视频/FFmpeg验收另外记录，不能用这些桩宣称播放或真实产物已验证。


实际浏览器/FFmpeg验收（2026-10-03，根agent操作）：隔离页中两个真实8s/320×180来源；官方按钮把第一段出点3s改为2.9s，提交后普通队列1次、产物0。下方独立授权本地拼装返回实际1280×720、5.921333s产物，node `f3abf31a-91e6-487a-bf73-f6c7c3e78bb5`，SHA256 `ac17160631ba6c87f14ff788782dda1d5da7fd042d61a87a0a9eee766b77100d`。播放readyState4、paused=false、currentTime从0.219推进至0.560，手动seek0.059s红帧、5.862s蓝帧已目检；样例是明确标注的本地fixture，未调用模型。这证明本次隔离QA真实产物链，不代表外部模型生成、其他画幅或生产真实会话已人工操作验收。最终刷新验收通过：官方第一段出点2.9s、普通队列1次、产物1份恢复；重新点击独立本地拼装复用同一node `f3abf31a-91e6-487a-bf73-f6c7c3e78bb5`，回报`applied/saved/currentMatches`均为true，SHA与5.921333s时长保持相同，没有新增节点。该复用走最新保护代码。
