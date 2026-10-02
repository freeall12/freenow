# 官方广告创意审核（v1）本地合同

依据：未修改的 `resources/apps/ad-review@v1.e990e21f.html`，实际 `_m/p_/$m/bm/g_/__/S_`。包 `reference/vendor-packages-CN3JnHbF.js` 的 Bue/wae 对此页使用默认 `{allowExpanded:false,autoExpandOnReady:false}`，没有 520 高度限制。原包提供原站图片/视频域，本地宿主不继承这些权限。独立模型与运行模块不修改官方HTML。

Purpose：供用户对真实素材逐卡标记和备注，按首帧快筛、试拍评审、成片验收交接创意判断。该判断不是模型审核、平台合规通过或真实广告投放数据验证；后续生成、修改、投放、删除和支出仍走普通确认。

Inputs：普通 `show_app` 使用 `resource_uri:"ui://tapnow/ad-review@v1"`、可选title，data字段如下。node_ref是本地主宿主添加的明确引用入口，creative combo仍是独立的创意组合ID：

```json
{"locale":"zh-CN","stage":"frame_cull","batch":{"label":"batch-1","product":"保温杯","note":"审核本次创意方向。"},"items":[{"combo":"C1","node_ref":"node/image-node-id","media":"image","node_title":"实际首帧A","hook":"随身携带","angle":"通勤","persona":"日常使用者","meta":"待评方向"}]}
```

stage严格为frame_cull/pilot_review/final_review；locale支持中/英/日/韩/法，默认中文。每页1–48项，combo唯一、最多120字符，不允许协议分隔符`;|=,`、换行或JS特殊原型键；batch.label最多160字符、同样避免协议歧义。可选product200/note2000；item可选node_title200、hook/angle/persona300、meta1000字符。未知字段与额外工具权限字段拒绝。原HTML未公开JSON Schema，此处是按其实际读取字段定义的有界本地合同。

Runtime：`createAdReviewRuntime({app,localAssets,getProjectId,...adapters})` 提供 `prepareAppArgs(args,{signal,isCurrent})`、`bindPreparedResult(result,args)`、`capture(response,{trace,chat,isCurrent})`。输入每个node_ref须为`node/<当前真实节点id>`，必须对应所声明的图片或视频。图片读取fullImage||image，视频读取video；已有虚拟clip/trim视频须先导出。模型输入不能提供preview_url或poster_url，宿主不按模型URL猜来源。读取只接受本地blob/data或当前origin的实际媒体路径；原站与其他外部域在fetch前拒绝，旧远程资产应先真正保存本地。

真实源经过有界流读取、PNG/JPEG/WebP或MP4/WebM类型检查与实际图像/视频解码后转换为data预览。node_ref剥除，官方页面仍收到其原有 `{combo,media,preview_url,...文本}`。来源nodeId、combo、项目、媒体SHA256、宽高、实际视频时长和节点签名保存在 `result.adReviewSourceContext`。同一媒体的多个创意combo可共享一次读取，但绑定保留逐combo映射。单媒体8MiB、整次读取16MiB、prepared JSON15MiB、解码32MP/边长16384，读取与解码30秒；Blob URL由宿主创建并释放。prepared恢复数据仅用于展示，不写回画布。

State：`initialAdReviewState(response)`为`{marks:{},notes:{}}`，根controller须真实持久保存。`validateAdReviewState(state,response)`严格校验marks/notes只有当前combo，frame可keep/cull、pilot只win、final可keep/cull/win。备注保存原输入，最长60 UTF-16字符；官方确认p_将换行合为空格、去`;|=`、折叠空白/trim、截60。空白备注是合法保存输入，在确认时不进入AR1。

阶段规则完全按官方：首帧未标记计cull，至少keep1；试拍只计win，至少win1，其他素材passed_over保留在画布；成片未标记计keep，win同时属于keep，cull为回炉，至少keep1。全部淘汰/回炉必须点该阶段的官方“整批不合适”按钮，走reject_batch方案交接，不能绕过阈值伪造确认。

Outputs：`resolveAdReviewReply(text,response,savedState)`验证当前语言的完整摘要与AR1逐字一致，或该阶段/语言的官方整批拒绝文案；拒绝额外命令、跨语言文案、改阶段/批次/计数/备注、仅发送AR1及未提交状态。AR1顺序为`v=1;stage=...;batch=...`，首帧/成片有keep/cull，试拍有win，成片只有win非空才写win，备注按原素材次序`n.combo=...`。返回 `{kind:'confirmed'|'reject_batch',text,metadata,result}`，可读result保留原文本、combo、media和净化备注，附实际keep/cull/win/passed_over。

生产必须调用sourceContext的 `reply(text,savedState)`，而非仅使用纯resolver结果。reply重读真实源字节核对哈希，将可信combo→node_ref、media_sha256、尺寸、实际视频时长和project_id追加到普通队列文本；没有base64字节载荷。handoffId重新绑定真实项目/节点/媒体hash与审核结论，跨来源不能共用身份，重复同一trace确认按正常队列去重。text上限16384字符，超长明确失败。

Permissions：仅双iframe保存状态和普通消息交接，无额外tools/call、生成或画布写权限。`capture.guard({verifyBytes:false})`验证展示字节hash与实时项目/trace/节点；确认reply强制verifyBytes重读源，并再次检查来源。`isCurrent()`检查签名和页面存活；dispose取消在途读取。真实会话、用户动作、nonce/source、运行中拒绝、保存锁和queue提交后保护由生产controller/host提供。根接线设专用ad-review-proxy，仅允许该资源的本地图片/视频data/blob，host16MiB预算，不授原站域。

Failure modes：官方保存延迟400ms且吞保存失败，S_确认不会等待保存，因此根controller必须串行stateWork等待真实已提交appState，再确认。初始状态无自动保存，onReady须同样走正常事务。快速编辑确认、保存失败、会话运行、页面重载、project/trace/节点/媒体字节替换均不能得到成功回执；队列提交后来源变化须撤销并完成补偿保存。此模块未生成平台审核或投放回执。poster_url没有独立宿主来源合同，因此生产不接受模型poster、当前runtime只供实际媒体预览；错误媒体仍由官方页面展示fallback。

Logging：保留原show_app参数/response、提交appState、adReviewSourceContext、AR1与可读交接、source-bound handoffId、widgetOrigin；不记录伪投放或伪模型结果，不将本地用户判断升级为数据验证。

Tests：

```sh
node --test tests/agent-ad-review.test.cjs tests/agent-ad-review-runtime.test.cjs
node --check src/features/agent-apps/ad-review.mjs
node --check src/features/agent-apps/ad-review-runtime.mjs
node --check src/features/agent-apps/qa/ad-review.mjs
```

12项定向测试直接从官方HTML提取 `_m/p_/$m/bm/g_` 与5locale文案做独立期望，覆盖三阶段默认/阈值、净化备注、精确摘要、原输入/已存状态和可信来源、URL阻断、实际字节更换、类型/解码/大小/无流失败、中止与挂起源切换。测试的注入decoder仅用于运行边界，不冒充浏览器媒体质量。

2026-10-03实际浏览器验收：`/src/features/agent-apps/qa/ad-review.html` 使用生产controller/card/host/registry和原官方HTML。专属IndexedDB `tapnow-qa-ad-review-v1` 保存Canvas真实480×320PNG、本机`qa/trim-scenes.mp4`实际320×180/8秒视频、graph、三阶段trace、真实marks/notes和queue。中文首帧keep1/cull1/净化备注；英文试拍win1、另一项passed_over；日语成片winC1/cullC2→keep1/rework1/win1都成功交接且附原节点ref/hash。首帧重复确认队列仍1次；刷新恢复前两阶段状态/队列。官方视频readyState4，data视频实际播放后currentTime0.496205/paused:false。运行中确认显示官方发送失败、队列仍3次；实际替换首帧PNG后旧页确认显示来源变化及发送失败，队列没有新增。截图检查了原页图片和视频画面。本轮交互采用CUA原生Tab/Return输入；嵌套iframe直接locator/坐标受工具限制，未修改HTML绕过。未调用模型、平台审核或投放服务；完整主画布后续Agent执行和其他locale的逐项视觉仍需单独验收。
