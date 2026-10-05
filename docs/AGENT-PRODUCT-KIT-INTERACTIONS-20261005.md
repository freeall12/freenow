# Product Kit 交互核对与本地修正 · 2026-10-05

## 依据与范围

原始安装包页面：`src/features/agent-apps/resources/apps/product-kit@v1.758d09b3.html`，SHA256 `758d09b3f06e99a6b4e47a782d33ef90b9f12935c140b8bdfe88ca41f76e2535`。逐字节保留原件、原manifest、既有 `product-kit@v1.bf378d28.html` 演示派生件。原站/安装包定义功能，localhost只作为本地实现QA。本轮不访问模型、供应商或私人素材，未操作主任务浏览器、未提交Git。

官方页面没有drag、dragstart、dragend、pointerdown/pointerup等交互事件处理，也没有拖动句柄。配色角色固定为scene/product/information/accent/brand/material，不能重排。宿主卡片拖动应由主任务按真实宿主行为单独核对，不能算作Product Kit内缺失功能。

## 原始来源 → 差异 → 实现

| 官方原函数或字段 | 可证实行为/缺口 | 本地实现 |
| --- | --- | --- |
| `A_`、`Mn`、`de` | 调整只修改草稿；取消丢弃，保存克隆到K。锁定颜色、文案语言不可改。最多两个调性，候选色最多呈现原色加前三个备选 | 保留全部原交互与布局、候选数量、锁定关系，不扩展不存在的功能 |
| `N_`、`Im`、`D_`、`O_` | 已保存选择/规格确认延迟220ms发送setWidgetState；保存错误被吞掉 | 单笔in-flight + 一个latest pending快照，失焦/点击完成尽快flush；实际回执失败可见并可重试 |
| `Tm`、`q_`、`z_` | 原SDK复现「保存后立即确认」先发送新PK1、尚无保存请求 | inert冻结确认快照，先等待保存回执并核对状态/来源epoch，保留原计数与精确PK1；失败不发消息 |
| full/recall、plan_attached | full有配色/调性/Look/规格与确认；recall可沿用或调整，调整保存后转full；附规划只改变确认文案 | 20种语言/视图/规划组合运行实际原SDK与DOM，消息精确对应官方投影 |
| Look字段、palette.locked、copy.language | 锁定Look仅显示；没有独立切换Look锁定的按钮，语言及锁色来自输入事实 | 保留原显示及只读关系，没有新增控制或伪造锁定来源 |
| 生命周期 | 官方无blur/pagehide/关闭flush；220ms内关闭有状态丢失窗口 | 复用 `localLifecycleScript`，关闭等setWidgetState真实回执；失败保留页面，resume解锁；pagehide后禁止迟到消息 |
| `Mn`、`ze` 编辑重绘 | 根任务CUA发现键盘Space选择后全重绘使焦点落到body，不能连续Tab | 仅编辑事件按按钮序号恢复新DOM同控件；进入调整聚焦首可用编辑项，Save/Cancel聚焦目标视图首操作；不改布局 |
| 缩略图 | 既有runtime读取真实本地图片、重新核对SHA | 保持runtime限额和来源验证；本轮PNG仅明确公开合成QA输入，不是产品事实或失败回退 |

关闭只持久保存K（用户已经点击保存或确认规格的状态）。调整中的de草稿没有被确认，取消或直接关闭不会悄悄将它写入Kit。五语言错误/失活重试文案独立提供；recall保存失败也有可见状态。长保存导致浏览器用户激活失效时，提示再次点击确认，第二次点击沿用已成功保存的指纹，符合宿主真实用户操作约束。

## 接线与完整性

专属模块 `src/features/agent-apps/product-kit-local-interactions.mjs` 导出 `localizeProductKitInteractions(html,name,version)`。它只接受product-kit/v1且输入SHA属于：

- 经既有缩略图传输修正的原件：`7434c9a09d30ca1b6f1b6c84aca80f4d82eaa8bc590e93a0a60bfc164f44131b`。
- 既有本地演示派生件：`bf378d28fe79d46390b75b4f5ab0d1cbc2bbf7ab46f360154c6de234c5d02234`。

每个修正目标还要求唯一出现。未知版本、篡改字节、未经过thumbnail修正的官方原件均明确拒绝；其他App原样通过。主任务负责共享proxy在transport后调用该模块、host canFlushClose名单和integration hasPendingCloseApps名单追加 `ui://tapnow/product-kit@v1`。本子任务未直接修改共享文件。

## 本轮定向证据

```sh
node --test tests/product-kit-interactions-sdk.test.cjs tests/product-kit.test.cjs tests/product-kit-runtime.test.cjs tests/product-kit-local-demo.test.cjs
node --check src/features/agent-apps/product-kit-local-interactions.mjs
node --check src/features/agent-apps/qa/product-kit.mjs
```

26/26通过。新增12项运行实际页面脚本和原SDK，宿主存储回执使用可控桩：原版220ms窗口复现；SHA校验；5语言×2视图×2规划组合；编辑取消/保存、6角色、锁色、2调性上限、禁令、语气、规格与恢复；立即确认等回执；关闭/错误/重试；blur/用户激活失效/recall错误；来源变化与pagehide；锁定Look与未提交草稿；慢连续编辑合并、保存completion微任务边界及编辑重绘焦点恢复。原SDK回执后0–10层微任务注入最后编辑，关闭均等最后实际事务后成功。30/31次慢连续保存分别只有1/2次真实SDK保存请求，确认冻结并核对最终快照。另14项既有测试覆盖产品状态与真实来源字节链。

保存失败不增加消息，关闭失败不返回flushed:true，页内保留选择。派生SHA、官方消息、已保存投影、来源/项目变化均有定向检查。JSDOM没有像素渲染或真实文件选择器；上述测试不等于完整视觉、宿主拖动或全部CUA交互通过。

## 由主任务执行的CUA步骤

1. 在主任务已核对的localhost监听端口打开 `/src/features/agent-apps/qa/product-kit.html?session=product-kit-1005p`；该session独立IndexedDB，不触及旧QA。原存储默认行为不变。
2. 原生文件选择器导入 `/Users/laplace/Documents/Codex/2026-09-22/new-chat/outputs/canvas-replica/src/features/agent-apps/qa/product-kit-public-fixture.png`。此图320×240，仅stdlib生成公开几何像素，无产品声明。图片显示应与该fixture一致，来源node/qa-product和实际SHA须回读。
3. 将 `src/features/agent-apps/qa/product-kit-interactions-fixture.json` 内容贴入本次创作材料textarea后开板。该JSON明确是合成测试输入，包含锁定炭黑、三个调性候选、禁令、两种语气、锁定Look和一条仍禁止的测试规格。
4. 调整→场景砂岩→精密→温暖（第三个应拒绝）→禁令开关→自然描述；先取消并核对原内容，再重新调整保存。保存后立即点击确认；回读持久状态与队列，PK1必须等实际state并对应砂岩/两个调性/当前禁令及语气。未确认qa1仍应阻止入画/文案。
5. 设事务延迟6000ms，改回暖灰并保存，立即点「保存后关闭素材板」。等实际回执前素材板应保留；关闭后「重新打开已保存素材板」恢复暖灰。队列只由明确确认增加；关闭不会创建消息。确认因失活只提示再次点击时，再点击应仅产生一次真实交接。
6. 勾选保存失败，改砂岩保存后确认或关闭。失败必须可见，页面保留，持久状态与消息数不增加；取消失败后再次确认/关闭成功并恢复。
7. 规格展开→确认属实后规格按钮消失，回读confirmed_ids包含qa1。这是用户的测试确认动作，不证明商品规格；刷新应恢复选择和已交接队列，不出现远程示例图。
8. 用nativeTab/Space连续操作候选色、调性、禁令、语气，焦点应保持同一逻辑控件，可继续Tab；保存/取消后焦点应落到当前视图首操作。根任务已实机确认暖灰按钮Space后焦点保持，并确认Save返回Adjust焦点。最新规格toggle/内联确认焦点补修只有定向测试证据，未再次CUA。
9. JSON `variant`改recall后开新板，核对沿用/调整两按钮与锁定Look；调整取消应保留recall，保存应转full。分别把locale改en-US/ja-JP/ko-KR/fr-FR开板核对语言；把plan_attached改false核对普通继续文案。完整同视口视觉及全部组合尚需实际CUA记录。

主任务可从页面「回读持久状态与队列」获取实际事务证据；`window.productKitQA.snapshot()`仅为辅助结构证据，不替代UI操作。网络面板应不出现TapNow云图或生成供应商请求。上传另一张公开来源后旧卡片不得交接。对以上未执行的步骤不声称CUA通过。

## 根任务最终CUA证据与错误文案窄补

根任务在隔离session `product-kit-1005p-root1` 完成实际双iframe验收。原生文件选择器导入公开合成fixture320×240；持久source SHA与原图一致：`8a9564f770dc623a3bbaa0af0ec897f5fd9c88499823b0da1b6e1c65d57368ad`。键盘选择暖灰/砂岩、精密、禁令false、自然描述，最多两个调性、锁定炭黑/Look/语言均已核对。qa1的展开与确认仅为合成验收操作，不证明商品规格。暖灰按钮Space激活后焦点保持；Save返回Adjust焦点通过。

第一次真实PK1交接后队列为1。设6000ms状态事务延迟，保存后即时确认显示「Kit 已保存，请再次点击确认按钮继续。」且队列保持1；再次真实点击后队列为2。持续fail-save时暖灰状态关闭失败、页面保留；解除fail-save后关闭成功，刷新仍恢复暖灰与2条队列。

CUA发现原SDK错误文本露出后，本地去掉拼接，仅显示五语言失败重试文案，没有增加状态或来源日志。根任务重新加载最新修正，再启用fail-save并选择砂岩、Save，实际只显示「Product Kit 保存或交接失败，请重试。」，不含SDK原始文本。解除fail-save后Close收到真实成功回执，reopen恢复砂岩。最终DOM `#reply` 回读长度为2。

![Product Kit 最终交互验收截图](screenshots/agent-product-kit-interactions-20261005.jpg)

[截图原文件](screenshots/agent-product-kit-interactions-20261005.jpg)。以上是根任务本轮实机结果，未扩大为全部语言、recall全部组合或完整同视口视觉通过。双opaque iframe的fractional坐标限制不支持本轮鼠标drag验收；原页自身也没有drag排序，不能将不存在的控件算作遗漏或声称拖动通过。

最新规格展开/收起焦点恢复、内联确认后的下一操作焦点补修仅由定向测试覆盖，未在补修后再次CUA。

```sh
node --test --test-name-pattern='localized errors|specification expand|close flush waits|blur commits' tests/product-kit-interactions-sdk.test.cjs
```

4/4相关检查通过，其中五语言×full/recall验证内部SDK文本不进入产品status、保存失败仍可重试；另验证规格焦点、关闭失败和失焦保存。上一版完整Product Kit定向组合为26/26；本次未重跑全套，不将新增用例数量作为新全套通过数。
