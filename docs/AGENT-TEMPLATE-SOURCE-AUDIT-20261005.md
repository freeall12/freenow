# 精确 Agent 模板来源增量审计 · 2026-10-05

本轮只读核对官方安装包、已归档来源与公开文档；没有打开浏览器、读取登录凭据、请求私有 gateway、生成、上传或接入自动下载。生产 registry、picker 原件和本地导入合同均未改。初始 checkout 为 `main` / `d1842acb274d7327c1bb4ad92b1bf4017b1a8e79`。

**没有发现新的模板对象键解析器，也没有取得可通过现有 SHA256 校验的独立正文。** 本次重新计算全部 Resources 文件和 ASAR 叶文件摘要，排除了安装包变化导致旧结论过期的可能。下述结果只适用于这份安装包与实际读取的文档，不证明服务端没有正文。

机器可复核记录：[版本、文件摘要、22 份原件对照及正文匹配结果](research/agent-template-source-audit-20261005.json)。记录只包含来源身份和核验结果，不纳入私人原始归档。

## 当前安装包与精确匹配

- `/Applications/TapNow.app`：`CFBundleShortVersionString` / `CFBundleVersion` 均为 **0.4.81**。
- `desktop-build-meta.json`：stable / prod / GLOBAL；`sourceSha=b1a75561566795406992a219a7d9189978e3cdd5`，`webBundleVersion=2026.09.24.36028447352.1`。这是本地安装包身份，不作为线上最新版本承诺。
- Resources 当前 **883** 个文件；按原始字节对照 Creative + Motion 的 **92** 个精确 SHA256，匹配 **0**。
- `app.asar`：**21,559,524 bytes**，SHA256 `ebf99b3b70514d71b5d862f1b6e230ec3b87861a670c987dd5902e7a32bea8bc`。标准库解析全部 **2,521** 个叶文件，全部具有 offset，全部按实际 offset/size 摘要核对，匹配 **0**。没有跳过叶文件。
- 与 [10 月 3 日审计](research/agent-template-source-static-audit-20261003.md) 相比，ASAR、HTML 预览代理、widget 加载器、gateway 路由及技能 UI mapper 的精确字节身份均未变化。

| 文件（相对官方 web） | bytes | SHA256 |
| --- | ---: | --- |
| `assets/HtmlArtifactFrame-BLzUcmrV.js` | 1,796 | `a9a1b46d7e7b0c7d02cf2adbf914c9ca391c6d0123aab70a8bd9f34ad823d21b` |
| `assets/context-D6hXl-WU.js` | 13,851 | `256ea01872d5939d760bb71fbf22cddc53bb626dc3a1410bf49257ff41d8c01a` |
| `assets/use-chat-attachment-file-input-BcpbCD8t.js` | 300,886 | `990461a9b1f38b6311465d992b7c0ce5a33af388e9eebfe1e1b4414936c9d84b` |
| `assets/page-DVqoHdTT.js` | 1,785,533 | `8334adc98d6ec24265d45ed4f45458be19d137b5391e5b3abb77e064d221cd86` |
| `assets/index-BsHyQ2qj.js` | 12,943,515 | `a24bbe7de925ccc68aa332dbec6ad6a96e50db11867b21f15c20b7f128ef33a4` |
| `usercontent-proxy/apps/manifest.json` | 853 | `8c2c08873c86f14d7d28e0c5fb9ef0a5b0f834292144bed98855cd6b414c3e79` |

## 本次进一步定位的下载边界

1. `html-templates` / `template_ref` 仍只在 Creative、Website、Motion 三个 picker 页面出现；Website 与 Creative 是相同原件的另一个资源名。没有独立正文文件，也没有代码消费这些对象键。
2. `index-BsHyQ2qj.js` 的 **12** 处 `SKILL.md` 全部为六语言的文件/文件夹上传说明；不是技能包内容或下载链接。`use-chat-attachment-file-input-BcpbCD8t.js` 的 **5** 处则为上传提示或将所选 Markdown 打包为 `SKILL.md` ZIP 的实现。上传与导入代码不能当作官方资源下载器。
3. `index-BsHyQ2qj.js` 的 **4** 处 `object_key` 全部属于 OSS multipart 上传的断点恢复/身份校验；HCL/Terraform 语法库同名字段也不消费模板引用。该文件的 `download_url` 属于用户文件批量下载任务，不包含 `html-templates`、模板目录或 template SHA256 的绑定。
4. 技能读取真实调用为 `wx()` → `getSkill({skill_name})` → `GET /api/agent-gateway/v1/skills/<encoded-name>` → `ft(data)`。mapper 映射 `name/description/instructions/provider/status/version/skipped_file_count`；没有包附件清单或模板资源下载字段。`getPluginSkill` 是插件内技能详情读取，不是现成模板 resolver。这里没有发出任何私有 GET，历史 401 未被重试或绕过。
5. `HtmlArtifactFrame` 接收已经取得的 HTML，再交给 `artifact-proxy.html`；`page-DVqoHdTT.js` 按 `ui://tapnow/<name>@v<number>` 加载 widget。两者仍不能提供 `template_ref.object_key` 的 origin、鉴权、签名或字节获取合同。不得把预览 origin 与对象键自行拼接。

公开 [Apps 文档](https://docs.tapnow.media/zh/docs/agent/apps) 本轮重新 GET：HTTP **200**、**108,537 bytes**，raw SHA256 `e62fc79e615fd31e215a724cad297a05380daada37bc5e2f84d1129d80ee647c`。实际 anchor 中没有独立 skill package 下载页；`SKILL.md/html-templates/template_ref/object_key/download_url` 均 **0** 次。其外部 Agent/MCP 插件链接是连接说明，不能据此假设含这 92 份 HTML。旧公开 app-store 与首页 chunk 的同日刷新结果已在前次审计的 10 月 5 日增量部分记录，本轮没有重复抓取，也没有猜测新域名。

## 对官方应用清单的精确纠偏

官方 manifest 仍为 **22 个版本 URI / 20 个功能族**，apps 目录 **24 份 HTML**；额外的 performance-rhythm v1/v2 是 manifest 外历史文件。22 份 manifest 指向的官方原 HTML 在本地均存在且 **22/22 逐字节相同**。

**本地 manifest 当前与官方 manifest 不同。** 本地 Product Kit 指向 `bf378d28` 的演示缩略图派生页，额外 `derivations` 明确保留 `758d09b3` 原件、派生页和图片的完整摘要。该差异符合已有 [Product Kit 合同](../src/features/agent-apps/product-kit.md)，不是新增官方版本。原工作流清点中“manifest 和本地副本逐字节相同”只适合更早快照，不能继续当作当前证据；它不影响本次 22 份原件对照。此轮只在这里纠偏，没有改共享 manifest。

另一个需要缩小的旧缺口是“产品拖动未验”。本轮检查官方 `product-kit@v1.758d09b3.html`，没有 `pointerdown/pointermove/draggable/dragstart/mousedown/mousemove/touchstart/ondrag/onpointer`；真实交互是配色、调性、禁令、文案与待确认规格操作。缺少拖动验收不能直接被列为官方 Product Kit 功能缺失。

## 非营销交互补验

本轮建议补证 **人物站位 v3 的边缘clamp、吸附切换和位置/朝向原生拖动**。基础拖动已在1005l验收；1005n主任务另外完成边缘clamp、吸附开关、0°/90°朝向、失败重试、一次CB3和刷新恢复，见[人物站位实际记录](AGENT-CHARACTER-BLOCKING-INTERACTIONS-20261005.md)。它不依赖模板正文或模型生成；pointercancel及完整多语言仍未计为本轮实机通过。

来源：`character-blocking@v3.f1fd0e23.html`，完整 SHA256 `f1fd0e23de67bf00f60ccf333b7d5b57262a01726a37adeef28c800d51a8815b`。两组 `pointerdown/move/up/cancel` 分别操作 `.marker-body` 与 `.facing-handle`，均使用 pointer capture；位置由 stage 尺寸归一到 0–1000 并 clamp/round，吸附为50。朝向 `tb()` 以标记中心 `atan2(dx,-dy)` 得0–359度。键盘位置普通10、Shift1、snap50，朝向普通5度、Shift1度；数字输入不能代替拖动证据。

可沿 [10 月 5 日人物站位步骤](AGENT-STORY-BLOCKING-INTERACTIONS-20261005.md) 的现有隔离 QA，使用真实头像执行边缘拖动、方向把手、吸附开关、pointer cancel、实际已存状态与一次 CB3 对照，然后保存失败→同卡重试→真正刷新恢复。此入口只用于本地验收；官方设计 reference 仍来自以上安装包原件及主任务独占的官方 Web。此次研究没有使用 localhost 作为 reference，也没有修改生产实现。

## 本正文缺口下一步

目前最小的有效新证据是**官方可授权读取的技能完整 instructions 或技能资源 manifest**，其中必须实际给出对象键解析规则或真实正文，而非另一次目录产品描述。主任务可在已登录官方 UI 的只读技能详情中检查 `tapnow-motion` / `tapnow-creative` 外层指令是否显示资源获取合同；不能为了让 Agent 自动读取技能而发送 generation 或付费请求。静态包不保证该详情包含附件，本轮没有访问该 UI，也没有把静态 mapper 当作完整服务端响应。

只有取得具有实际来源的原始 HTML 字节，并与当前已保存选择的 `template_ref.sha256` 完全匹配，才沿 [现有本地导入合同](AGENT-TEMPLATE-SOURCE-20261003.md) 保存不可变来源及 editable revision。本轮没有可导入样本，因此没有改 registry、伪造模板、放宽摘要或增加远程依赖。A05 仍是历史引用，不能建立新导入。

本研究分工验证文件、原始字节摘要、ASAR offset/size 与真实 manifest，仅新增审计文档和机器报告，未运行生产测试。主任务原生拖动证据见上方；精确官方模板导入及缺失正文编辑仍不在已完成范围。

## 1005o 官方 Web 只读复核

主线程通过已登录的官方画布，实际打开“添加 → 技能 → 管理技能”。当前可见 16 个技能；分别搜索 `tapnow-motion` 和 `tapnow-creative`，均显示“没有匹配的技能”。切换应用页进入“动效库”详情，看到 46 款模板说明、两个对话示例及“安装应用”，没有可点击的技能原文、包附件或正文下载入口。本轮没有安装应用、发送对话、执行生成或试探私有接口；因此结论仅限当前账号已安装技能与此详情页，不能推断安装后或服务端同样没有正文。92 份精确模板正文缺口仍保留。

同时实际打开 `3d-scene-director` 详情。正文要求区分会话 Widget、独立 HTML 和片场节点；截图应为真实 PNG，录像应有可播放预览，下载需要真实文件入口，加入画布需持久回执。`references/scene-planning.md`、`references/widget-runtime.md`、`references/capture-export.md` 在界面均标为 `[blocked]`，DOM 没有对应链接；本轮没有绕过或自行拼接地址。以该可读正文补充[真实 Widget 下载验收](WIDGET-WHITEBOX-DOWNLOAD-QA-20261005.md)，不将其中提到的原站工具名当作本地已提供能力。
