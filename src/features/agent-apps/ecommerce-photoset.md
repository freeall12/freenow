# 本地电商组图

唯一设计合同是未修改的 `resources/apps/ecommerce-photoset@v2.a7b6a057.html`。SHA256：`a7b6a057ceeb55ec0cef26e35d33e18c42c53aec26b2c1d6032e04294b401861`。它是用户基于真实产品素材编辑与生成图片组的创作功能。

## 官方合同与来源

资源URI为 `ui://tapnow/ecommerce-photoset@v2`。输入包括 `mode:amazon|freeform`、`product_context:{product_label,product_node_ids}`、`requirements:[{sequence,theme,visual_requirement,copy_requirement,template_key?}]`、`params:{model,aspect_ratio,resolution,image_variant_count,quality?}`、可选 `param_options:{<参数>:{values,default?}}`、`locale` 与 `subtitle`。宿主要求产品节点为当前画布中有真实图片的节点；不自动补示例产品、产品规格或创作计划。

`prepareEcommercePhotoset` 给官方面板提供正文。输入最多32项图片要求、8个产品素材节点；主题30字符、画面与文案各500字符，完整输入与保存状态128KiB。官方HTML直接读取structuredContent，没有内置输入schema；以上为宿主的显式有界接受范围。`initialEcommercePhotosetState`、`validateEcommercePhotosetState` 对照官方zb/jb：version为1，rows按sequence键存储编辑内容、draft/pending/submitted/failed状态和可选node_id/failure_reason；params、pending、uncertain与freeform handed_off保持官方结构。空主题可以保存编辑，但不能确认派发。

`createEcommercePhotosetRuntime` 的prepareAppArgs读取当前真实素材并解码，来源节点快照与实际SHA写入result顶层 `ecommercePhotosetSourceContext`，不作为模型可注入字段。每张图片8MiB、合计32MiB、8192边/16M像素、读取与解码30秒。支持本地asset/data/blob，以及精确 `/api/generation/media/<UUIDv4>`；生成资源只从当前页面完整精确同源获取，不接受HTTP重定向、peer变化、任意HTTP来源、query/hash或原站回退。无可限额流的响应拒绝。动作再次读取来源字节核对SHA，完整原图转有界data URI作为不可变生成input；面板预览不是生成参考替代品。

## 真实生成与持久派发

官方amazon模式先弹出确认对话框，再持久保存pending(call_id/sequences和行状态)，调用 `ecommerce_photoset_generate`。参数严格等于此页实际已保存行、固定模板键、产品节点、生成参数，以及 `confirmation:{schema_version:app_generation_confirmation.v1,item_count,output_count,acknowledged:true}`。必须由当前官方页面真实确认授予一次动作许可；模型不能直接绕过应用状态、来源与确认链。

每行创建独立实际任务目标节点，经 `GenerationAPI.submit` → 生产TaskService → 本机gateway进入图片生成。显式 `resultMode:spread` 走生产canvasResults占位与批量回填；image_variant_count是每项实际生成数量。运行时不自行标记applied，不造图片完成状态。实际outputs、resultIds、应用失败和配置失败由正常生成任务与生成历史记录呈现；submitted仅表示任务已持久提交，不表示已完成或结果已验证。

画布保存及会话派发意图先提交；TaskService返回taskId后将其保存到 `trace.ecommercePhotosetOperations`。host-only beforeDispatchReady等待该事务成功，再核对来源才允许供应商POST。事务失败执行会话补偿，禁止继续派发；保留已可见任务节点供核对，不静默删除画布内容或重建。目标的独立 `node.ecommercePhotoset` 记录scope/operationId/fingerprint/来源，正常结果provenance可继续表示实际生成任务与媒体。

相同callId参数变化拒绝；同callId并发确认共享任务组。重复的等价未失败请求即使callId改变，也核对原持久任务；unknown或刷新丢失本地任务只执行原taskId的GET lookup/recover，不再POST。原节点撤销、删除、修改或有意图而缺taskId时，明确阻止静默重建。已明确失败的行可由用户新确认重试。没有配置时返回逐项configuration_required，且不会创建目标节点或提交TaskService任务。供应商与Key配置使用现有本机生成配置链。

确认派发期间守住当前会话、项目、应用response、实际保存状态身份、SHA与source快照。已持久接受的任务允许官方随后把pending保存为submitted；其TaskService守卫继续核对原项目、会话中的trace、真实源图与任务目标，避免正常最终状态保存误取消任务。

官方vc在finally保存submitted前发送 `E-commerce photo set submitted sequences ... . Canvas nodes are the source of truth.`。setModelContext据实际持久任务账本与已保存的编辑文本逐字核验；不能把未知节点、失败行或编造节点写入模型上下文。上下文持久保存失败也执行补偿。

## Freeform与估价

官方freeform按原行顺序发送 `DESIGN_ROOM_FREEFORM_PLAN_V1\n<JSON>`。它只把当前持久方案、真实来源SHA与node绑定送入现有用户队列，后续走正常Agent生成授权；不自行派发。handoffId必须等于此页pending.call_id，正文、参数、来源和保存状态均须一致。

`tapnow/estimateGenerationCost` 仅表示本地不提供Tapies计价，返回unavailable并保留实际项目数/图片数。官方Xb/Py/ty允许估价不可用时继续确认，不要求更改原HTML。没有伪造积分、余额或扣费结果。

## 接线与验收

运行时接口：prepareAppArgs → prepareApp → bindPreparedResult；capture返回scope/guard/validateState/validateSourcesCurrent/reply/isCurrent/dispose。generate(args,trace,chat,{callId,userAction,isCurrent,sourceContext,signal})返回官方structuredContent内容；setModelContext使用相同来源选项。共享controller适配为getGenerationAppSourceContext/onGenerationAppTool/onGenerationAppContext。

```sh
node --test tests/ecommerce-photoset.test.cjs tests/ecommerce-photoset-runtime.test.cjs
```

当前18个定向测试通过。直接执行官方zb/jb/Eb函数核对初始状态、逐项参数和token正文；使用实际TaskService核对逐项派发、taskId持久门阻塞、完整原图输入、unknown查询、不同callId去重、配置缺失、源字节/项目/会话变化、画布与会话保存失败、撤销删除与上下文真实性。Node中的图片解码和供应商输出为明确测试适配，不是实际供应商生成或浏览器视觉证据。

## 2026-10-05 官方交互与参数复核

本次设计来源仍为manifest绑定的原HTML；安装包 `web/assets/page-DVqoHdTT.js` 的 `SN` 也使用同一 `ui://tapnow/ecommerce-photoset@v2` URI。以下为原HTML函数与现有接线核对，不代表本次完成了浏览器点击或真实供应商生成。

| 官方操作或状态 | 原HTML实现 | 本地接线与证据 |
| --- | --- | --- |
| 点击行、Enter/Space展开，编辑主题/画面/文案，完成收起 | `qs/vy/yc`，主题30字、两正文各500字 | 使用原页面；`validateEcommercePhotosetState`保留相同编辑长度与状态结构 |
| 模型、比例、分辨率、张数、质量选择 | `Gb/Bb/qi/zb` | Amazon质量固定low/medium/high，忽略quality.values限制；freeform使用提供的质量选项，未提供时省略quality |
| 确认层、取消、Escape返回按钮焦点 | `sy/Py/Sc` | 原页面保留；取消不调用生成工具，确认提交先保存pending |
| Amazon确认后逐行真实任务 | `uy/ly/Eb/Ub` | 精确核验已存pending、callId、真实源图SHA，再接生产TaskService；18项定向测试覆盖配置缺失与持久派发门 |
| freeform确认方案与已接受但未存最终状态的恢复 | `ry/iy/ay` | 精确原计划正文、handoffId、真实来源与正常Agent队列接线；原页面处理accepted恢复 |
| 普通重绘、刷新、unknown重新核对 | `zb`与`xi`还原uncertain序号 | 账本绑定原taskId并GET recover；不同callId的等价请求不新增POST，原节点缺失不重建 |
| 保存期间关闭、会话/项目变化、源字节替换 | 原页串行`zi/wc`，宿主生命周期 | runtime的scope/状态身份/SHA守卫拒绝失效动作，已接受任务继续由实际任务历史核对 |
| 任务结果应用 | 官方提示Canvas节点为真相来源 | 生产GenerationAPI的spread占位与标准结果回填；submitted仅表示已提交，真实产物与视觉验收另行核对 |

本次修复前，Amazon输入 `param_options.quality.values:["medium"]` 后原页面允许选low/high，但宿主保存会拒绝；freeform省略quality或只给high/low选项时，宿主初始值错误地补medium。新增回归直接执行原HTML的`zb/jb/Eb`，先重现这两处不一致，再验证修复。原HTML及其SHA没有修改。

最短CUA复核入口：`/src/features/agent-apps/qa/ecommerce-photoset.html`。导入真实产品图片 → 在方案JSON将`param_options.quality.values`设为`["medium"]` → 打开官方组图 → 质量选择低/高 → 展开行编辑并点完成 → 确认并生成 → 取消或Escape → 再次确认提交。检查保存状态quality保留选择；无配置时失败原因为configuration_required且jobs为0。freeform分支将mode改为freeform、删除params.quality、把quality.values设为`["high","low"]`；开新卡后初始质量应为high，确认方案的持久队列params.quality同为high。此入口沿用专用IndexedDB，不使用其他项目或私密任务库；有配置时确认会真实调用供应商，应由根任务安排受控验收。

专属真实浏览器页：`/src/features/agent-apps/qa/ecommerce-photoset.html`。默认无产品素材，由文件上传进入专用IndexedDB。页面使用生产registry/controller/host、GenerationAPI、生成历史与TaskService；实际配置会联系本机gateway并派发真实任务。可核对原图、编辑计划、逐项生成、配置缺失、保存失败、普通重绘、reload、持久回读和原任务GET恢复。恢复只应用原canvasResults占位；已存在且与taskId/实际媒体完全相同的产物仅回读，不创建重复节点。不提供合成示例媒体或固定产物假生成。“连接本机生成 API”直接调用生产GenerationAPI.configure弹窗；沿用现有本机配置链，不另实现配置UI。

本子任务未使用CUA；根任务负责真实页面点击、状态恢复、生成产物解码与最终视觉验收。实际供应商未配置时不能宣称真实生成成功。

## 根任务当前浏览器证据

2026-10-05根任务通过CUA在 `?session=20261005-photoset-quality` 的独立数据库中导入真实Sony产品PNG（616×497）。输入质量选项仅medium，原页面仍可选择high/low并持久保存；第一行主题改为“产品主图本地”并点完成。确认层展示低质量，Escape关闭后焦点回确认按钮；再次确认时两行均为configuration_required，jobs为0。本机公开配置当时明确 `configured:false`。

Freeform新卡省略params.quality、只提供high/low，初始值为high；实际“确认方案”完成一次交接，队列保留high、真实来源SHA及handed_off状态。通过原生Tab/Shift+Tab/Return完成双层iframe操作，没有脚本绕过确认。截图为[本地实际质量与编辑页面](../../../docs/screenshots/photoset-quality-20261005.jpg)。这些证据不能证明配置后的供应商生成、全部语言或完整像素验收通过。

共享生产接线与工具/费用边界见 项目根 `docs/agent-apps-local-generation-contract.md`。共享controller测试验证真实保存状态后freeform新用户队列、MCP structuredContent包装、投影换源capture重建；这些检查不替代供应商实际生成与官方视觉验收。官方五语言确认层经原SHA绑定的本地展示派生显示“未提供费用估算”和配置供应商实际用量计费，原HTML字节保留，未接入Tapies扣费。
