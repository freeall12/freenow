# 本地 Product Kit

依据唯一为安装包原始 `resources/apps/product-kit@v1.758d09b3.html`，SHA256 为 `758d09b3f06e99a6b4e47a782d33ef90b9f12935c140b8bdfe88ca41f76e2535`。它是用户确认产品素材、配色、调性、禁令、文案和待验证规格的创作板；打开或确认不会生成产品图或创建营销任务。

## 输入与真实来源

`createProductKitRuntime({app,localAssets,getProjectId})` 提供只读适配。生产 `prepareAppArgs(args,{signal,isCurrent})` 接受 `resource_uri:ui://tapnow/product-kit@v1` 和 `data:{node_ref,...官方产品Kit字段}`。`node_ref` 指向当前画布真实图片；`product` 只接受 `name/category/price_band`，模型不能提供 `thumbnail_url`。其余官方字段全部由用户真实产品材料和本次创作上下文提供，不自动补入演示产品、规格、计划或事实。

运行时使用现有 `prepareMediaInputs` 和 `createWorkflowMediaResolver` 读取实际本地图片。仅接受 asset/data/blob，拒绝 HTTP(S) 来源或解析结果。单源图8MiB、解码最大8192边和16M像素、实际预览最多500000字符；一次读取/解码30秒。fetch流按声明与实际字节双重限额，取消、超时或页面关闭中止读取。真实图片读取/解码失败不回退原站、示例或假产品。prepare后 `node_ref` 移入宿主来源元数据，官方payload中的 `product.thumbnail_url` 为实际像素生成的data图片。

官方原始y_缩略图校验只接受HTTPS。宿主 `mcp-app-proxy.html` 中 `localizeProductKitTransport` 在加载product-kit@v1时核对完整SHA：原件须具有唯一原校验字串，才把这一个字段校验换为有界data:image/png/jpeg/webp；本地派生件须已具有唯一的本地校验字串，验证后原样传入。磁盘官方HTML原字节保留；其他UI与脚本保持原行为。篡改字节、重复校验目标或未知版本明确失败。

独立演示页通过 `node scripts/derive-product-kit-demo.cjs --write` 从原件确定性派生，将官方演示thumbnail替换成已有 `assets/studio/library/chair-office.webp` 的内联data URI，同时应用上文的字段校验修正，确保独立打开也能通过校验。它是演示占位图片；原件的示例产品字段保持不变，不代表真实产品来源，也不作为嵌入工作流输入或回退。`resources/apps/manifest.json` 的 `widgets` 指向新文件名hash，`derivations` 明确记录原件、派生件和图片的完整SHA。脚本同步proxy的派生SHA校验，原始捕获文件与原SHA保持不变。嵌入工作流的thumbnail仍由真实当前节点读取、解码并注入。

## 状态与确认

`prepareProductKit(data,title)` 返回官方对象；locale支持zh-CN/en-US/ja-JP/ko-KR/fr-FR，variant为full或recall。版本、真实日期、角色顺序、配色锁定与候选、调性关系、禁令、锁定文案语言、语气候选和auto_ban规格按官方y_关系核对。

`initialProductKitState` 对应km；`validateProductKitState` 对应S_，schema为`product-kit-widget.v2`，包含kit_version/view/palette/tone_words/look_state/product_bans/voice/confirmed_ids。支持空调性选择，locked Look允许回到unlocked，不能从原unlocked Look伪造锁定。Palette锁定来源和文案语言不属于用户可编辑状态。初始状态须通过现有对话持久保存链提交，不能把默认显示当成已保存。

`productKitProjection`、`productKitToken` 对应I_/z_。PK1中Kit JSON属性顺序与encodeURIComponent精确一致，确认ID按原hypotheses顺序编码。五语言q_实际都发送英文计数摘要：

```text
PRODUCT KIT v2: 4 colors, 1 tones, 0 confirmed specs.
PK1 v=1;action=apply;kit_version=2;kit=<官方编码Kit>;confirmed=-
```

`resolveProductKitReply(message,response,savedState)` 精确核对当前实际保存状态和官方完整消息，没有猜测式解析或跳过路径。真实来源runtime `context.reply(message,savedState)` 还会重新读取来源SHA，验证状态身份与内容在异步检查期间未变化，补充真实来源node_ref/SHA/像素尺寸，并生成含项目与来源的稳定handoffId。相同Kit来自不同产品不会误去重。已确认规格仅表示用户声明属实，未确认规格持续阻止入画/文案，宿主不独立证明规格或编造任务/广告结果。

## 接线接口

`runtime.prepareAppArgs` → `prepareApp` → `runtime.bindPreparedResult(result,preparedArgs)`；来源写入result顶层 `productKitSourceContext`，只有response传入iframe。

`runtime.capture(response,{trace,chat,isCurrent})` 返回 `scope/binding/guard/isCurrent/dispose/validateState/validateSourceCurrent/reply`。guard和validateState同步；validateSourceCurrent与reply异步。reply第二参须为当前trace.appState对象。controller等待初始/后续保存链，再经context.reply将完整消息提交正常用户队列；source元数据及preview应从模型回执投影删除。页面只有setWidgetState/ui-message，不开放tools/call、update-model-context或画布写回能力。

## 验证

```sh
node --test tests/product-kit.test.cjs tests/product-kit-runtime.test.cjs
```

测试直接执行官方km/S_/I_/z_对照五语言、full/recall、编辑、锁定、精确PK1和保存状态；直接提取实际proxy的SHA兼容函数，验证正常/篡改/版本/目标唯一性及data校验差异；覆盖真实本地字节传入解码适配、恢复绑定、同URL换字节、来源/项目/状态变化、远程回退禁止、大小预算、超时取消、迟到响应流清理与页面关闭。无可限额字节流的响应直接拒绝，不分配无界arrayBuffer。Node中渲染适配为明确桩；真实浏览器证据见下文，仅覆盖实际执行的分支。

专属验收页 `/src/features/agent-apps/qa/product-kit.html` 初始没有产品来源，由本地文件上传真实PNG/JPEG/WebP并存入本页专用IndexedDB。修改本次实际产品元数据和Kit后打开；支持初始/编辑状态持久保存、精确确认、队列去重、刷新恢复、运行中拒绝与保存失败。`window.productKitQA.snapshot()` 返回当前实际session供证据回读，页内“回读持久状态与队列”检查提交数据。上传替换来源后旧卡片明确失效；本页不自动生成假产品图、不联系原站或生成服务。

## 2026-10-03 真实浏览器证据

根任务通过 CUA 原生文件选择器导入本地 `assets/696b1da59de7a308.png` 摄影机图片，实际解码856×558，`source_sha256=0cc3ec6493f72b2a76c5fcb4ccc28947fd2cc36754f23052821b9df320a25c92`；输入产品名称为“摄影机本地素材验收”。官方页面真实显示该图片，验证了本地素材读取、默认缩略图解码和受控传输兼容。

实际操作将场景配色从暖灰改为砂岩，新增精密调性并保存；展开未确认测试规格，保留未确认状态。确认产生1次实际Kit交接，包含PK1及真实来源node/hash。真实浏览器reload后恢复砂岩、双调性、仍被禁止的未确认规格和1条队列。截图证据：[Product Kit 本地素材验收](/tmp/freenow-product-kit-local-20261003.png)（本轮临时截图）。

正式主入口重启后，Agent无warn/error，可加载原Creative。这仅证明本轮入口和已有Creative加载回归通过。保存失败、其他语言和完整同视口视觉尚未经过CUA；不能以该局部验收声称全部交互、全部语言或完整视觉已通过。

## 2026-10-05 保存与关闭交互修正

官方页面自身不包含拖动或配色重排；素材板移动属于宿主。官方配色角色次序保持不变。本轮通过原 SDK 复现原版「保存后220ms内确认」先发送PK1、未提交最新状态的窗口，新增 `product-kit-local-interactions.mjs`，在既有本地缩略图传输之后按精确SHA动态派生，不修改官方原件、manifest或既有演示文件。

保存最多保留一笔运行中的事务与一个最新待保存快照；连续编辑合并为最新快照。确认冻结已保存选择、等待真实状态回执并核对版本及快照，再发送原PK1。保存失败不发送、不伪造关闭成功，保留选择供重试。若真实保存耗时使用户激活失效，页面明确提示再次点击确认。失焦提交已点击「保存」或规格确认的待保存状态；关闭走宿主既有 `freenow/lifecycleFlush` 回执，调整中的草稿仍需点击「保存」，取消或直接关闭不会默默接受草稿。

专属QA支持 `?session=product-kit-1005p` 隔离本批IndexedDB；不传session保持原存储名。新增事务延迟、保存后关闭、重新打开。公开合成PNG和显式fixture JSON仅用于人工验收，不是生产默认产品素材。26项Product Kit定向测试通过，其中原SDK/JSDOM覆盖五语言×full/recall×附规划开关、候选色/锁色/调性限制/禁令/语气/规格/取消/关闭/失败重试/慢连续编辑/来源变更；此证据不是CUA像素或拖动验收。详细范围和主任务实机步骤见 `docs/AGENT-PRODUCT-KIT-INTERACTIONS-20261005.md`。

根任务CUA发现编辑选项由键盘Space激活后，官方全重绘将焦点丢到body。本地仅编辑事件按相同按钮位置恢复新DOM焦点；进入调整聚焦首可用编辑项，保存/取消聚焦目标视图首操作。新增原SDK焦点回归，不改变布局和官方原件；修正后连续键盘CUA待根任务重载验证。

根任务后续CUA已反馈编辑焦点、两调性限制、禁令/语气保存、规格确认及实际PK1队列通过；6000ms慢保存提示二次确认、队列只由再点击增加，持续保存失败则关闭拒绝且页面保留。其发现SDK错误文本出现在status后，本地窄补为只显示五语言失败重试文案，并恢复规格toggle/内联确认焦点。4项相关定向检查通过，未重跑全套；窄补后错误文案CUA待根任务重载验证。详见本批验收文档。
