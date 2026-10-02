# 官方 Library Picker（v1）接线合同

依据为未修改的 `resources/apps/library-picker@v1.3449ff83.html`（`$_/Im/zm/_i/Cs/Gn/w_`）和官方捕获 `reference/vendor-packages-CN3JnHbF.js`（`rg/wae/Bue/as/Aae`）。该 HTML 没有业务输入 JSON Schema；本模块按页面实际读取字段定义严格、有界本地合同。未增加营销、团队、分享、付费或通用外部工具。

Purpose：浏览、搜索当前个人素材库；将实际可见素材引用送到正常 Agent 队列，或按明确用户点击将一份真实图片/视频加入画布。引用不等于媒体生成、库写入或额外工具授权。团队按钮保留官方外观，但其查询和状态明确失败。

Inputs：公开 show_app 的 data 仅允许 `{applied?:{types:["image","video","audio","text"]},can_add_to_canvas?:boolean}`。这些字段是本地宿主窄入口；`runtime.prepareAppArgs` 从 `CanvasLibrary.items/folders` 的实时 getter 读取实际素材，禁止 Agent 提供 folders/assets/地址。根 registry 仅对宿主已预备数据调用 `prepareLibraryPicker(data,title?)`。实际传给官方 HTML 的 structuredContent 为：

```json
{"title":"素材库","folders":[{"folder_id":"private:%E6%B5%8B%E8%AF%95","scope":"private","name":"测试","path":"测试","asset_count":1}],"assets":[],"can_add_to_canvas":true}
```

可选 applied.types 为非空、唯一且最多4个的固定类型集合。最多200个文件夹、一次最多500个资产。初始 assets 必为空，真实资产由动态 find 返回。必须有至少一个真实个人文件夹：官方页在无 private 文件夹时自行切换 team；本地 runtime 使用实际库的固定目录与「收藏」目录保证空库仍有真实入口，不制造素材。文件夹/素材 ID 最长240字符、禁止控制字符；名称最多1000字符；文件夹路径最多1000字符；query最多500字符。

工具：只接受 `tools/call` 的 `find_library_assets`，参数必须是 `{scope:"private",folder_id,types?}` 或 `{scope:"private",query,types?}`，不能同时提供 folder_id/query，types 必須逐项等于 prepared.applied.types。folder_id 必须来自实际 prepared.folders；搜索按实际名称/路径查找。结果严格为 `{items:[{asset_id,type,name,preview_url?,source_url?}]}`。官方每个查询带 `tapnow/callId`，宿主仍验证调用来源；此工具不转发给模型或通用 Agent tools。

State：`{scope:"private",query:"",folder:null,picked_asset_id:null}`。folder 若非空须精确来自准备时真实目录；folder 与 query 互斥。`picked_asset_id` 是上次成功发送的素材，而非当前选中 xe；官方切换文件夹/搜索不会清除它。生产 controller 应使用 `context.validateState(state)` 按绑定的全部真实个人库验证 picked，不应只核对当前搜索结果。当前实际引用与入图仍必须来自本次 visibleAssets。状态保存失败必须阻止后续依赖已保存状态的确认。

消息：官方 `Cs` 先 `ui/update-model-context`，内容必须精确是 `用户引用了素材库素材 "{归一化80字符名称}"（asset_id={id}, type={type}, url={source_url}）`（无 source_url 时不含 url），随后 `ui/message`。中文空问题为 `我从素材库选择了「{name}」。`，有问题为 `【素材：{name}】{压缩空白并trim后的最多500字符问题}`；其他 locale 使用官方英文文案。locale 来自 hostContext，以 zh 开头为中文。`resolveLibraryPickerContext` 精确匹配本次真实可见素材；`resolveLibraryPickerReply` 使用一次性实际上下文，校验官方消息并附信任边界。handoffId 为 `library_<64 hex SHA256>`。图片预览字节不进入 Agent 交接。当前发送后才会保存 picked，不能要求保存的 picked 等于当前发送资产；不能只靠旧 picked 恢复引用上下文。

图片地址与官方策略：官方 `library-picker` 不在 wae 特例表，使用 rg `{allowExpanded:false,autoExpandOnReady:false}`，没有 maxInlineHeight。Aae 仅提供 imgDomains，无 mediaDomains/connectDomains。精确 imgDomains 为 helper 导出的12个域：9个官方 as 域，以及 app.tapnow.ai、storage.googleapis.com、conversation-service-131786869360.asia-northeast1.run.app。预览允许由真实库导出的 data:image PNG/JPEG/WebP/GIF 或 LocalAssets.url 的 blob；HTTPS仅官方固定域。preview_url最多1500000字符，外部URL不自动开放其他域；超限明确失败。

本地 source_url 是宿主映射身份 `library://private/<encoded asset id>`，不是网络地址。原库常含大型 data URL/asset:，不能把字节塞进模型上下文；原 HTML 只要求 source_url 是非空字符串，因此无需改页。该身份仅在绑定实际库快照中可解析，不使用 iframe 地址加载媒体。可信实际源只接受同类型 base64 data URL、真实 asset: ID 或上述固定官方 HTTPS 域。保存到 CanvasLibrary 的任意其他域、相对地址或缺失源只能浏览名称，不能入图；从 Agent 输入伪造的身份不能创建库来源。asset: 入图前调用真实 LocalAssets.url 检查存在。

Runtime：`createLibraryPickerRuntime({library,app,store,getProjectId,localAssets,persistConversation})`。library 为实时 getter `{items,folders}`；实际定义在 sidebars.js，缺失必须明确失败，不能用 [] 掩盖不可读状态。app 提供 `getState()/insertAsset()`、可选 `projectSnapshot()`；store 提供真实 `save(state,projectId)` 与可选 flush；persistConversation须等待真实事务成功。所有必要 adapter 创建时检查。方法：

- `prepareAppArgs(args,{isCurrent,signal})` 读取当前库并生成真实 folders；`bindPreparedResult(result,preparedArgs)` 将 `{projectId,library_sha256}` 存到顶层 librarySourceContext，仅response进 iframe。
- `capture(response,{trace,chat,isCurrent})` 绑定当前 project/chat/trace、持久来源摘要与原库快照。返回 `guard()` async、`isCurrent()`同步、`validateState(state)`、`getKnownAssets()`、`getVisibleAssets()`。
- `find(args,{userAction,restore,isCurrent,signal})`；普通调用要求 host userAction===true。restore无需当前点击但必须精确对应实际已保存 folder/query，且由生产controller等待 stateWork 后调用。新查询递增epoch，旧异步查询不覆盖新结果。
- `setModelContext(params,{userAction,isCurrent})`、`reply(message,savedState,{locale,userAction,isCurrent})` 核对真实可见资产与本次引用；reply消费引用上下文，同一个旧上下文不能重发。
- `addToCanvas({asset:{media_type,source_url,name}},{userAction,isCurrent,signal})` 必须精确匹配真实可见图片/视频。audio/text 的官方 w_ 会映射image，但本地拒绝这种类型误入。使用冻结的原库媒体调用现有 app.insertAsset，不接受 iframe 位置/节点ID/真实URL，也不借旧 nodeId 查询 editor 数据补齐。返回实际 `{node_ref,asset_id,library_sha256,scope}`。

Permissions：复用双iframe/source/nonce、当前点击、会话/trace/代次保护。每个操作的 options.isCurrent 必须由当前 host 请求的 sourceGuard 提供；runtime 在hash/预览/asset读取await之后、insert前、graph保存后、会话保存前后核验，不能只在controller最后拒绝回执。capture的isCurrent保护卡片，操作的isCurrent保护当次iframe代次，两者都必要。同步queueWidgetPrompt guard 使用 context.isCurrent，操作前先await context.guard以验证持久SHA256来源。个人库有任何改变须重新打开卡片；不将陈旧结果当作当前源。

Failure modes：官方状态队列 Nn 吞掉保存错误；Cs 先更新上下文、发消息，成功后才保存picked。宿主必须对真实事务/当前状态/当前来源核对，不能以官方toast证明持久化。add先创建真实可见节点，再等待 CanvasStore.save/flush 与会话回执保存；失败明确报告，不返回成功。已出现的节点保留，不能自动删除或冒称撤销；保存期间来源失效后不给成功回执。会话回执失败恢复之前记录并尝试补偿保存，补偿失败独立报告。图保存失败不添加会话回执。每次图save/flush以及会话commit等待后都重新核对同一个节点对象仍在当前graph、node_ref/type、实际源与预览、完整provenance；等待期间Undo/删除/换媒体/换类型/改来源均明确失败。会话placement已提交后失效则恢复之前placement并执行真实补偿事务，补偿返回false也视为独立失败。

Logging：保存原show_app args/prepared response、顶层来源hash、验证后的appState、原官方消息、实际引用与handoffId；入图节点provenance包含真实asset_id/库来源hash/project/chat/trace与node_ref；trace.libraryPickerPlacements仅在真实图保存之后提交。不得把测试素材、占位图或没有源的资产当作生产成功。

Tests：`node --test tests/agent-library-picker.test.cjs` 覆盖输入/类型/团队拒绝、当前实际引用、伪地址、真实动态库/入图、双保存失败、库/项目变化、restore、picked跨查询和iframe异步失效，以及图save等待期间删除、会话commit期间4类删改和补偿提交失败。专用 QA 为 `src/features/agent-apps/qa/library-picker.html`，使用生产controller/host/runtime、单独 `tapnow-qa-library-picker-v1` IndexedDB 和明确标注的Canvas输入图片。可实际点查询、选用、入图、事务回读、失败保存和重载。其素材和图均为验收数据，未读取或改原主项目库；本次仅静态/定向测试，浏览器验收由根任务执行。
