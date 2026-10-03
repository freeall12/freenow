# Agent 官方工作流清点 · 2026-10-03

本次续批已完成下文曾建议的 Creative 无预选 art/hardware 入口与精确选择交接，见[增量验收](AGENT-CREATIVE-FAMILY-20261003.md)。随后接入人物站位v3、产品素材板v1、广告审核v1、图层合成v1及动态分镜v2、预演v3、电商组图v2；实时getApp与manifest逐项核对，当前22/22个版本URI、20/20个功能族已接（仅登记与接线覆盖）；单个精确模板正文及后续下载/编辑链仍未完成。

官方清点依据本机可追溯的 TapNow 0.4.81 安装包；“当前”指本次读到的官方安装包快照，不代表已核验线上最新发布。清点子任务为只读操作。主任务前批完成调色/裁切/粗剪接线，本批继续接人物站位/产品素材/广告审核/图层合成/动态分镜/预演/电商组图，下面状态同步到当前registry；实际操作与测试另见[本地媒体编辑验收](AGENT-LOCAL-EDITING-20261003.md)。

## 结论与分母

| 计数口径 | 总数 | registry 已接 | 未接 | 用途 |
| --- | ---: | ---: | ---: | --- |
| 官方 manifest 的带版本资源 URI | 22 | 22 | 0 | 静态资源与版本接线清单 |
| manifest 按 `@` 前名称合并的功能族 | 20 | 20 | 0 | 本批功能接线进度；animatic 和 character-blocking 各有两个版本 |
| 官方 apps 目录中的 HTML 文件 | 24 | 不适用 | 不适用 | 额外保留 performance-rhythm v1、v2，但 manifest 仅声明 v3；不能把历史文件加成新增功能 |

原“22个工作流/10已接/12未接”混合了版本与功能族口径。前批增加调色、裁切、粗剪，本批再接人物站位v3、产品素材板v1、广告审核v1、图层合成v1、动态分镜v2、预演v3及电商组图v2；用实际getApp导出对照manifest已核准为 **22个版本URI/22已接/0未接**，对应 **20族/20已接/0族未接**。随后接入的 animatic@v1 和 character-blocking@v1 是已有更新版本同族的历史项，不是另外两个产品功能。manifest 仍保留它们，本轮没有证据证明旧版已被官方撤销；后续新增功能默认研究 manifest 中该族最高版本，不凭此断言服务端只能调用最高版本。

这里的“已接”仅指 registry 有入口及专属处理代码，不能等同完整同态视觉验收、每一状态已验收或供应商生成链已完成。Creative 与 Website 是两个 URI 名称，但其 HTML 逐字节相同；按 HTML 实现合并又是另一个口径，不用于上表。Creative 内部 website / art / hardware 三类及 46 个模板引用，也不能作为新的 manifest URI 加入分母。

## 当前接线与历史版本分列

- 本批新增三族已接线：animatic@v2、ecommerce-photoset@v2、previs@v3；专属生成、保存/回复、GET恢复与来源核验见[共享合同](agent-apps-local-generation-contract.md)。
- manifest保留的历史URI：animatic@v1与同族v2均已接；character-blocking@v1与同族v3均已接。历史版的保存、播放/镜头切换及单次交接已有定向浏览器证据，见[历史应用验收](HISTORICAL-APPS-AND-NATIVE-TTS-20261003.md)。两项都仍属于22 URI分母，不作为额外功能族，也不宣称已被官方撤销。
- manifest外历史HTML：performance-rhythm@v1、@v2只作归档参考，不属于当前22 URI分母。

本批共用接线37项检查通过。根任务实际浏览器已核验站位真实头像、video/9:16、X310/facing96、CB3一次交接、reload恢复及失败保存无新队列；Product Kit真实camera图856×558、砂岩配色、双调性、PK1一次交接、源SHA与真实reload通过。站位鼠标拖动及产品拖动仍未验，广告审核实际浏览器已验证中文首帧keep/cull与备注净化、英文试拍win/pass_over、日语成片keep/rework/win，三阶段累计3条可信node_ref/SHA交接；重复确认、刷新恢复、运行中拒绝和真实替换PNG后旧来源拒绝均通过。真实本地视频解码为320×180/8秒，readyState4并实际原生播放；后续模型生成与投放效果未验。计数和局部通过均不代表全部交互、完整视觉或实际媒体生成验收。

## 来源与可复核身份

- 原官方资源根：`/Applications/TapNow.app/Contents/Resources/web/usercontent-proxy/`。
- 项目资源：`src/features/agent-apps/resources/apps/manifest.json` 与同目录 hash HTML。官方 manifest 和本地副本逐字节相同；22 份 manifest 声明的 HTML 也分别逐字节相同。
- 官方 manifest SHA256：`8c2c08873c86f14d7d28e0c5fb9ef0a5b0f834292144bed98855cd6b414c3e79`。
- 官方 Creative HTML SHA256：`2a07bc2e7e3874c49f012f1022cbf838939bf8ea502ca33af31b277986dadcc9`。
- 宿主官方策略：`reference/vendor-packages-CN3JnHbF.js` 的 `Nx` / `Bue` / `wae` / `Aae`。策略按名称分派；三个 picker 行内上限 520，animatic / previs 允许且默认展开，其余不能凭本地偏好改变。
- 本地接线事实：`src/features/agent-apps/registry.mjs`、`host.mjs`、`integration.mjs`、`agent-client.js`。这些只证明实现状态，不作为产品设计依据。
- 可追溯官方公开目录快照：`reference/agent-app-store-public-source-20260930.md`、`agent-app-store-public-catalog-20260930.json` 与 creative 两份详情 JSON。其来源为官方 `https://app.tapnow.media/api/bff/app-store/`，catalog `content_version=5e1c0c5ade0ae66a`；本轮只读归档，未重新请求。

## 功能族清单

下表 URI 均补全为 `ui://tapnow/<名称>@<版本>`，文件为 `<名称>@<版本>.<hash8>.html`。所有族均保留在创作目标中；“营销排除”均为“否”，仅排除 TapNow 自身营销宣传、付费，以及已明确排除的团队 / 社区 / 分享路径。广告审核、产品素材与电商组图是用户创作工具，不能据名称或目录的通用 `marketing_line` 字段删除。此处是任务范围解释，并非声称原站没有营销使用场景。

| 功能族 / 官方资源 | manifest 版本与 hash8 | 营销排除 | 本地状态 | 仍缺的本族接线或边界 |
| --- | --- | --- | --- | --- |
| actor-emotion / 人物情绪 | v1 `63ee986b` | 否 | 已接 v1 | 完整官方同态视觉及全部人物 / 声音组合验收；实际灰模写回已有独立合同 |
| ad-review / 广告审核 | v1 `e990e21f` | 否，用户创作 | 已接 v1 | 真实本地图片/视频、三阶段marks/notes、精确AR1和真实来源交接；三阶段真实本地图片/视频交接及失败保护已局部验，不能冒充投放或合规验证；[合同](../src/features/agent-apps/AD-REVIEW.md) |
| animatic / 动态分镜 | v1 `7f4d2fcb`；v2 `bc00a3a5` | 否 | 已接 v1 / v2 | 真实图板/图片、sheets编辑/AN1与实际variants任务已接；无Key未派发、参数交接局部浏览器已验，完整播放/九格组合及真实供应商质量未全验 |
| character-blocking / 人物站位 | v1 `596deb3b`；v3 `f1fd0e23` | 否 | 已接 v1 / v3 | 真实本地头像裁图、positions/facings/target/ratio保存与CB3；真实浏览器局部已验，鼠标拖动未验；[合同](../src/features/agent-apps/CHARACTER-BLOCKING.md) |
| color-adjust / 色彩调整 | v2 `285e6ccb` | 否 | 已接 v2 | 实际PNG、18参数、保存与后续上下文已接；完整hover/大图性能及正式模型调度未全验 |
| creative-picker / 创意选择器 | v1 `2a07bc2e` | 否 | 已接 v1，含 A / H 推荐 ID | 无预选入口已接；全部模板交互验收、精确模板获取与后续产物编辑；见下文 |
| cutlist-review / 剪辑清单审核 | v1 `a3b10365` | 否 | 已接 v1 | 真实视频、状态/CR1与单独确认后本机拼装已接；本机产物固定1280×720，正式模型调度未验 |
| director-markup / 导演批注 | v1 `4b53a29e` | 否 | 已接 v1 | 已有真实正文 / DM1 核对；完整语言、文本选择与视觉组合仍需分项验收 |
| ecommerce-photoset / 电商组图 | v2 `a7b6a057` | 否，用户创作 | 已接 v2 | 真实产品/行/参数与实际逐项任务、GET恢复已接；本机fixture两行及刷新旧ref已局部验，真实供应商质量未全验；[合同](../src/features/agent-apps/ecommerce-photoset.md) |
| interactive-learning / 互动学习 | v1 `cd0bb18c` | 否 | 已接 v1 | 已有目录 / 学习板 / IL1；课程全部内容与完整同态视觉不由接线计数证明 |
| layer-composer / 图层合成 | v1 `067126cf` | 否 | 已接 | 完整源像素本地PNG合成、实际保存/回执/撤销保护；浏览器局部通过，见[合同](../src/features/agent-apps/LAYER-COMPOSER.md) |
| library-picker / 素材库 | v1 `3449ff83` | 否 | 已接 v1，仅个人库 | 个人库完整同态视觉；团队 scope 已明确排除，不计缺口 |
| motion-picker / 动效库 | v1 `11addd0c` | 否 | 已接 v1 | 46 项逐项动画 / 交互、精确模板取得与修改；不把字体 / 图形动效写成摄像机运镜 |
| performance-rhythm / 表演节奏 | v3 `9ead0d0b` | 否 | 已接 v3 | 固定时长 / 曲线 / PS1 已接；历史 v1 / v2 文件不纳入当前 manifest 分母 |
| platform-resize / 按平台改尺寸 | v1 `897f4688` | 否，图像裁切 | 已接 v1 | 精确比例真图、批量保存/撤销已验；全部拖动和同视口视觉未验 |
| previs / 预演 | v3 `584fd5b2` | 否 | 已接 v3 | 实际镜头/图板、edits/order/variants、预验与真实run回执、正常缺图板生成和GET选图恢复已接；九格fixture刷新保持3.1秒/ELS/同run_id局部已验，商业供应商质量未验；[合同](../src/features/agent-apps/PREVIS.md) |
| product-kit / 产品素材板 | v1 `758d09b3` | 否，用户创作 | 已接 v1 | 真实本地产品图、Kit字段/状态/PK1/来源SHA；原HTML不变，proxy经SHA核验仅修缩略图校验，拖动及全部组合未验；[合同](../src/features/agent-apps/product-kit.md) |
| production-progress / 制作进度 | v1 `acd4e750` | 否 | 已接 v1 | 已接真实 job 只读投影和媒体；全部状态 / 超限 / 多结果同态视觉不由计数证明 |
| story-room / 剧本结构板 | v1 `dae7d235` | 否 | 已接 v1 | 已有真实 scenes / NS1 核对；完整多幕、多剧情线组合与同态视觉仍需分项验收 |
| website-design-picker / 网站设计选择器 | v1 `2a07bc2e` | 否 | 已接 v1，固定 family:website | 与 Creative 复用同一原始 HTML；21 项逐项验收及后续模板产物链仍缺 |

上述专属工具名来自对应官方 HTML 的实际调用点，不是建议新增通用工具权限。资源存在不能代替专属接线或验收。新接线必须继续采用专属白名单及真实来源 / 状态 / 结果回执。

## Creative art / hardware 抽查

官方文件：`creative-picker@v1.2a07bc2e.html`，Website 副本内容相同。

| 层级 | 官方事实 | 本地事实 / 结论 |
| --- | --- | --- |
| 模板映射 | 第 213 行 `TemplateReferences` 共46项：W01–W21、A01–A17、H01–H08 | 映射含17个 A ID；不能据此宣称17个当前可选艺术模板 |
| 当前列表 | 第4933行将 A05 设置 `retired:true`；第5299行 `renderList` 排除 retired，第5332行恢复状态清除 retired 选择 | 实际 art 列表16项，hardware 8项；公开详情 art 16 与此一致。第163行 art 侧栏静态 `<small>17</small>` 仍是官方原始文本，不能把这一个数字当活跃项数量 |
| 家族入口 | 第160行适配器先恢复已保存 widgetState；否则推荐 ID 的 W / A / H 首字母选择模式；否则读取 `family:website|art|hardware` | 本地可用 `recommended_template_id:A01/H01` 进入对应模式并预选；无推荐 ID 时 Creative 默认 website。registry给Website固定family，Creative严格接受website/art/hardware；无推荐art/hardware入口本批已接 |
| 可见产品入口 | 官方公开 apps 分别为 website-design、creative-generative-art、creative-hardware-mg；activation_skill 同名 | 本地manager的art/hardware无预选入口及选择交接已接；逐项模板交互和产物编辑仍需独立验收 |
| 状态与动作 | version:1；mode / category / query / drafts / inputs / pending；拖动与键盘改变预览，暂停、修改参数、提交；保存成功后才 `ui/message` | 复用既有 picker host / queue；本轮只读源代码，未实际操作这24个活跃 art / hardware 模板，不能称交互验收完成 |
| spec / 输出 | CreativeRuntime `library_version:1.1.0`；art 的 spec.skill 为 creative-generative-art，hardware 为 creative-hardware-mg；均 `output.kind=animation-html`，模板时长12秒 | 外层交接句使用 tapnow-creative，不能覆盖 spec.skill；输出是 HTML，官方详情不承诺本 app 视频导出 |

更正历史 `reference/agent-app-store-public-source-20260930.md` 中“目录16 / 安装包17是版本差异”的解释：目前代码证据支持 **17个引用映射含已退役A05、16个活跃可选项**。本轮不改旧证据文件，避免覆盖历史记录。

## 模板资源获取链与真正缺口

1. **应用 HTML 的取得已知。** 官方 `mcp-app-proxy.html` 第168行读取 `apps/manifest.json`，随后按资源名称 / 版本与 hash 读取应用 HTML。这是 picker 本身的装载链。
2. **单个模板的引用已知。** Creative `TemplateReferences` 与 Motion `templateReferences` 各46项，共92个独立 `html-templates/<ID>/<sha256>.html` 对象键及SHA256。这不是完整下载 URL，也不是应用 manifest 中的 HTML。
3. **选择交接已知。** 官方第152–160行将选择 spec 与 template_ref、handoffId 加入 `ui/message`；`phase: awaiting-content`，本回合邀请用户给内容或确认默认内容。提交选择不是立即生成授权。之后才取得精确模板、读HTML、修改；再修订应修改最新产物。
4. **下载解析合同仍缺。** 本项目归档记录未取得对象键解析 / 下载域名、鉴权 / 签名合同、独立模板HTML或两份外层技能正文。此前匿名技能请求401、猜测对象域的请求超时只是历史访问结果，本轮未重试。SDK 通用 `readServerResource` / downloadFile / fetch 定义存在，不能证明 picker 使用它们下载独立模板。
5. **本地后续实现仍缺。** registry / host 没有已核验的模板正文解析器；现有通用 artifacts 写入与 HTML 预览不是精确官方模板的下载、哈希校验、内容编辑、版本迭代链。不能将 picker 整库预览 HTML 或临时自造模板冒充被选模板正文。

Creative catalog SHA256 为 `10421d5dedd820104b167d60af250e2a6657365226b0bc7a456f5daffea56781`；它与每个 template_ref.sha256、应用文件 hash8、manifest SHA 是不同身份。

## 前次最小建议（入口本批已落实，模板正文仍待补）

前次建议仅补 **Creative 的无预选 art / hardware 入口与选择交接**，现已落实；以下保留当时的验收范围，尚缺的精确模板正文继续单列，不增加新manifest URI或自造下载接口。

1. 复用原官方 Creative HTML 和现有资源 URI。为 Creative 参数增加严格的 `family` 枚举，只在 creative-picker 接受；Website 固定 website，Motion / 其他工作流拒绝。官方无推荐时支持这个字段，不能通过预选 A01 / H01 假冒“打开库而未选择模板”。有既存状态时保持官方状态恢复优先级；同时给推荐 ID 与 family 时要求相符，防止入口错误。
2. manager 的 art / hardware 实际调用分别携带 family；标题 / 图标采用已抓取的官方资源。保留官网 HTML 原始 retired 处理与侧栏文本；接线校验仅接受活跃推荐 ID，A05 不作为当前新推荐。
3. 复用保存 / handoff / hidden message / 普通队列。下一批最小验收范围：art 可选16、hardware 8；无预选初始模式；A01 / A17 / H01 / H08 的修改、暂停、拖动、刷新恢复及一次交接；退役A05恢复清除；运行中禁交接；保存失败不入队。先看实际画面与消息 / 状态回执，再报告范围。
4. 在用户提供内容后，把未知模板解析明确显示为未配置 / 未取得官方资源。模板下载器、已校验原始HTML、产物修订与真实预览另作一批；先取得官方下载合同和样本再实现，不写猜测域名。

Creative子路径补齐不会增加URI或功能族数。前次建议研究的character-blocking@v3现已接真实来源/保存/CB3正常队列；站位确认仍不等于已制作视频。动态分镜、预演与电商组图三族本批已接专属真实任务/状态/写回合同；仍需完整交互与真实供应商质量验收，不能仅凭HTML文件存在或功能族20/20计为整个产品完成。

## 新三应用局部验收边界

本批共享新增20项检查通过、旧共享59项通过（含ProductKit单项短调度失败后单独通过）及4项旧schema目标通过。根任务实际浏览器核验：Animatic无Key明确任务未派发/0job和AN1单次精确参数交接；Previs刷新只GET九格fixture、同3.1秒/ELS/waiting/run_id、POST仍1；商品组图无Key0job、本机两行任务及刷新旧ref，切换配置后原POST仍2。原站付费系统未接入，hash绑定本地展示不承诺Tapies扣费。fixture只证明本机任务与持久化路径，不能冒充实际商业模型质量。精确模板正文/编辑链、完整官方视觉/交互、多语组合和整个产品验收仍有缺口。
