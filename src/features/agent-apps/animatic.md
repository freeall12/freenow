# Animatic v2 本地合同

依据是 `resources/apps/animatic@v2.bc00a3a5.html` 和官方宿主 `reference/vendor-packages-CN3JnHbF.js` 的 `Bue/wae/Aae`。原 HTML 未修改。URI 保留 `ui://tapnow/animatic@v2`；官方允许展开并默认展开。

## 输入与实际来源

`show_app.data` 接受 `version:2|3`、五种官方 locale、`title?`、`summary?`、`order?`、`beats?:[{beat_id,text,shot_codes}]` 和 `sheets`。

每张板是 `{sheet_id,label?,node_ref?（或sheet_node_ref）,cells?:[{x,y,w,h}],shots}`。每镜是 `{shot_code,cell,duration,move,size,script_text,speed_curve?,transition?,camera_height?,lens?,subject_box?,dialogue?:{text,est_duration,speaker?},node_ref?}`。`shots[].node_ref` 代表独立整图素材；无板来源和无独立镜头来源时保留文字设计状态。`cell` 是 0..8 的数组下标，源板默认等分九格。`subject_box` 为归一化 x/y/w/h。

Agent 不可供应 `textures`、`image_url`、`texture_id`、`shot.image`、字节或任意远程 URL。宿主读取实际 PNG/JPEG/WebP，建立 SHA256、当前源快照和派生缩略图：支持本地 asset/data/blob，生成媒体仅支持精确同源 `/api/generation/media/<UUIDv4>`，禁止重定向。单源最多16MiB/40M像素，全部源图64MiB，缩略图总量2MiB，结构化输出4MiB。

镜头时长 0.4..15 秒；板总时长超过30秒禁止确认。运镜、曲线、转场、时长对齐、文字、镜头顺序、删除、播放、源预览由官方编辑器执行。v3 状态是 `{v:3,selected_shot,edits,order,deleted,variants}`，最多96镜、16KiB；文字编辑上限8KiB。v2历史状态可恢复为v3。

## 工具与生成

`animatic_variants_submit`：

```json
{"plan_id":"stable UUID","shot_code":"SH1","source":{"kind":"cell","sheet_node_ref":"node/actual-image-id","cell":0}}
```

需要 `_meta["tapnow/callId"]` 稳定标识和真实用户操作。源须匹配当前已保存镜头。宿主从完整源像素裁出该格，保存真实PNG asset，新增独立空图片目标、保存画布和reserved计划；随后调用已有 `GenerationAPI.submit(request,{resultMode:'spread',beforeDispatch,beforeDispatchReady})`。`beforeDispatchReady` 必须保存真实 job.id 后才允许 TaskService 联系供应商。图片生成请求生成一个九格景别板，真实供应商参数/配置检查仍由原本机生成链执行。

无 Key 返回 `configuration_required`，不建占位、不派发、不假报成功。重复 call/plan 只查询同一真实任务；已有 queued/running/unknown/succeeded 不再次生成。明确 failed/cancelled/configuration_required 才可由新的显式 call 重派。保存失败同call复用原保留目标。

`animatic_variants_lookup`：`{source_refs:["node/actual-source-id"]}`。输出 `{items:[{shot_code,plan_id,node_id,status,submitted_at,image_url?,cells?}]}`。已有 unknown 和刷新后的缺任务均只按原 job.id 调用 `recover`（GET），不重发POST。自动初始查询不回填。显式用户刷新可使用 `applyRecovered(existing)` 或 `retryApplication`，沿用原生成计划。必须真实succeeded、applied、单图、原target/resultIds、媒体和task provenance匹配，再解码/保存/核对SHA才返回completed。读取、预览、画布及会话保存期间目标或任务变化会拒绝，回滚并补偿保存回执。

## 确认与上下文

`ui/message` 只接受官方五语言 summary 加 ` — AN1 v=2/3;a=confirm;...`，或官方 reject消息。协议由原HTML纯函数对照验证。交接须精确匹配已保存编辑、排序、删除和真实源；进入新的普通Agent回合，后续生成仍走正常工具与权限。打开/确认分镜不自动生成全部故事板。

`ui/update-model-context` 只接受 `Animatic SH1 now uses variant cell 5 from node/<actual-output-id>.`，且对应镜头实际已保存选择必须为同cell和ready输出。官方选择后300ms才保存，runtime最多等待1秒；随后核对原图与输出实际SHA，持久化上下文，不启动新回合。

## 检查与边界

```sh
node --test tests/agent-animatic.test.cjs
node --check src/features/agent-apps/animatic.mjs
node --check src/features/agent-apps/animatic-runtime.mjs
node --check src/features/agent-apps/qa/animatic.mjs
```

20项专属定向测试通过，包括官方协议对照、文本/整图/九格来源、noKey、稳定任务身份、已有unknown的只读恢复、迟到选择状态、save重试、输出预览/保存竞态及同址字节变化。

独立验收页 `/src/features/agent-apps/qa/animatic.html` 使用生产 registry/controller/host/runtime 和独立IndexedDB；源图明确为非AI Canvas fixture。生成按钮连接本机gateway，配置缺失就失败；fixture不会作为真实生成输出。HTTP200仅证明静态可达，浏览器布局/全部点击验收由主任务执行并另记证据。真实供应商质量和整站同态尚需Key联调及实机检查。

## 2026-10-03 无Key文案修正

实机检查发现官方 `uc()` 将所有工具异常统一保存为 `submit_failed`，因此本机已经确认的配置缺失也显示“提交结果暂时无法确认”。runtime在配置检查处实际没有创建任务/占位或联系供应商；问题发生于错误展示合同。

`animatic-local-errors.mjs` 对精确 SHA256 `bc00a3a525a598e8266cb9ac8576250e7e47ee2ba31d18ae5a7ae331cbc5ba28` 的加载文本生成本地派生版本；原HTML保持不变。宿主仅对 `configuration_required` 错误附加 `error.data.code` 和 `providerDispatched:false`，派生编辑器保留此分类并展示五语言配置说明。真实 unknown/传输异常仍保留未知提交语义，不能错误声称未派发。旧已加载iframe需要刷新重新加载代码；已保存镜头编辑恢复。积分价格改为供应商实际计价说明。

新增 `node --test tests/agent-animatic-local-errors.test.cjs` 四项通过：哈希与原source不变、派生模块语法、MCP错误分类、unknown保留和五语言说明。与原20项一起运行共24项。
