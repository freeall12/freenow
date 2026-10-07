# Agent 精确模板来源与编辑草稿补齐（2026-10-08）

**新增取得的精确官方模板正文为 0，92 份原引用仍缺失。** 本轮没有用 picker 全库页面或测试 HTML 替代正文，没有调用模型、登录接口、私有上传或猜测下载路径。来源刷新结束时间为 2026-10-07 19:38 UTC（北京时间 10 月 8 日）。

## 来源证据

已读 `agent-template-source-audit-20261005.json` 和 `agent-template-source-static-audit-20261003.md`，沿其中已有官方公开地址刷新。安装包 `/Applications/TapNow.app` 仍为 **0.4.81**，以下原始字节 SHA256 与已有审计一致：

| 文件 | bytes | SHA256 |
| --- | ---: | --- |
| `Contents/Resources/app.asar` | 21,559,524 | `ebf99b3b70514d71b5d862f1b6e230ec3b87861a670c987dd5902e7a32bea8bc` |
| `web/assets/context-D6hXl-WU.js` | 13,851 | `256ea01872d5939d760bb71fbf22cddc53bb626dc3a1410bf49257ff41d8c01a` |
| `web/assets/HtmlArtifactFrame-BLzUcmrV.js` | 1,796 | `a9a1b46d7e7b0c7d02cf2adbf914c9ca391c6d0123aab70a8bd9f34ad823d21b` |

没有重复枚举字节未变 ASAR 的 2,521 个叶文件。已有全量摘要比对与本轮定向测试仍为 92 个登记引用、0 个已取得正文；相同 ASAR 不能成为新增正文证据。

以下公开 GET 均 200；目录和帮助的 bytes/SHA256 与 10 月 5 日审计完全相同：

| 官方路径 | bytes | 原始 SHA256 |
| --- | ---: | --- |
| `https://app.tapnow.media/api/bff/app-store/catalog` | 54,495 | `2baaa19f63d38b20323b49336400ec112e8ba9496945b91066a463fd8f5316cd` |
| `https://app.tapnow.media/api/bff/app-store/items/app/motion-library` | 4,409 | `8941e57a3cbfdcbf9f84f7e1aadd06fefb3f8edeef07dd2860703787995e26f9` |
| `https://app.tapnow.media/api/bff/app-store/items/app/website-design` | 5,772 | `2a36bddcb23be95c04c37d49265c8c52833cd63dd4d947b6c87b8be38458041c` |
| `https://app.tapnow.media/api/bff/app-store/items/app/creative-generative-art` | 4,867 | `8c941683ee172a0a8a9d67b06c63128e5d2ceee1e3485cdbe5618428c0002173` |
| `https://app.tapnow.media/api/bff/app-store/items/app/creative-hardware-mg` | 5,348 | `50a2a1c4db2ee5f112c51c2293750dc176b4d25d083a27592ebef0da662caa9d` |
| `https://docs.tapnow.media/zh/docs/agent/apps` | 108,537 | `e62fc79e615fd31e215a724cad297a05380daada37bc5e2f84d1129d80ee647c` |
| `https://docs.tapnow.media/zh/docs/canvas/use-library-and-templates` | 88,444 | `001c9f142720013bea7905f7ee5c1e53d43dd4e1814e933ebbf1cf1425d0507f` |

首页 `https://app.tapnow.media/` 为 200、82,098 bytes，SHA256 `c0bc629c748c03b01eb568586ee20d153bae2907cab9ce7b84b636a1ad14aade`。只读取 HTML 实际列出的 **19 个** `/_next/static/chunks/*.js`，全部 200；没有执行远端脚本，也没有探测未声明 chunk。

首页、19 个 chunk 和上述 7 个响应中，`html-templates`、`template_ref`、`object_key`、`SKILL.md`、`download_url`、`resource_uri`、`getSkill`、`getPluginSkill` 字面出现次数均为 0。原始公开响应与每次请求的路径/bytes/SHA256 留在本机临时目录 `/tmp/tapnow-template-source-20261008/`，逐请求清单为 `audit.json`；该临时材料没有作为产品依赖或提交第三方源码。该检查仅覆盖这些已知官方公开响应，不能推断服务端没有模板或完整技能包。

另将 27 个实际公开响应的原始摘要逐个与 `creative-template-references.mjs`、`motion-template-references.mjs` 中的 **92 个唯一 SHA256** 比较，精确相同的响应数为 **0**。

仍需要官方完整技能资源包、资源 manifest 或 `template_ref.object_key` 的明确获取合同及对应原始 HTML 字节。预览代理 origin、公开产品说明、捕获的技能 article 和合成 fixture 均不能替代它们。本轮没有新增资源登记或精确正文导入声明。

项目根的 `runtime-reference/` 与 `help/` 是被 Git 忽略的运行材料，使用 `rg --files --no-ignore` 可找到，不能因普通文件列表没有显示就称其不存在。当前 reader 索引实际指向 `runtime-reference/*.json`；这些仍是已记录的 dialog text/article DOM 采集而非源 `SKILL.md` 包，现有 16 项当前捕获已通过 reader 的独立 5/5 摘要/分页检查。`help/image-enhance.html` 是本地帮助入口，没有新增模板正文身份。

## 补齐的本地功能

此前编辑器只有 `beforeunload` 提醒，用户确认刷新后未保存正文仍会丢失。新增 `template-editor-draft.mjs`，生产 `template-source-editor.mjs` 在实际输入时同步保存本标签页 sessionStorage 草稿，重新打开时展示原文供核对并等待明确恢复/放弃。恢复选择未决时锁正文编辑区及保存按钮，避免第二份输入被旧草稿覆盖。

草稿绑定项目产物 store 的 namespace、artifact path、完整模板来源 identity（包含选择 trace/handoff）、不可变来源 path/revision；保存草稿记录实际 base revision 和 base content。已保存版本变化时展示旧版本冲突，恢复只填编辑区，实际保存仍沿原 session 的 revision CAS 和当前来源 guard。成功保存或明确放弃自己的草稿才清理；配额、损坏或并发草稿替换明确提示并保留输入/已有记录。未决旧草稿不会被普通输入或保存静默覆盖。草稿不执行 HTML，不写入模板原始字节，不增加模型或网络权限。

这是本地编辑恢复功能，不是新发现的官方 UI 行为。sessionStorage 只保证本浏览器标签页刷新期间的恢复；关闭标签页、清理站点数据或浏览器策略可移除它。存储失败时仍保留关闭/离页提醒，但不能声称草稿已经可靠写入。

## 验证与集中浏览器入口

定向运行：

```sh
node --test tests/agent-template-editor-draft.test.cjs tests/agent-template-edit.test.cjs tests/agent-template-source.test.cjs
```

**21/21 通过**。新增 4 项覆盖项目/原始来源隔离、版本冲突、配额/损坏/并发拒绝、生产编辑器的明确恢复/成功清理/失败保留与恢复未决锁定；已有 17 项覆盖精确来源摘要、持久化/CAS、会话切换和编辑器焦点/离页提醒。4 个变更模块语法检查及 `git diff --check` 通过。Node 正向模板导入仍采用明确合成字节与测试 digest，不能当成官方正文。

集中浏览器验收入口：`http://localhost:4195/src/features/agent-apps/qa/template-editor.html`（主任务使用独立 freenow server 与隔离数据；此子任务未使用共享 CUA）。4173 属于另一个项目，其 HTTP 200 不能作为本项目验收证据。页面明确标注普通自由 HTML 合成验收，使用独立真实 IndexedDB 和生产编辑器；没有模板 identity，没有摘要绕过，没有模型。fixture 产物 namespace 为 `tapnow-template-editor-ui-qa-v1`，事件数据库为 `tapnow-template-editor-ui-qa-events-v1`，不清理其他存储。

1. 打开编辑器，修改正文但不保存；刷新并同意离页提醒，再打开。正文应保持已保存版本，侧栏出现原样草稿，编辑区先只读。
2. 点「恢复本地草稿」，应恢复输入且解锁，IndexedDB 仍保持旧正文；点「保存修改」后实际回读及再次刷新应有新版本且不再出现草稿。
3. 再留下未保存草稿并刷新，先点「写入新的合成已保存版本」，再打开编辑器。应展示旧版本冲突，不自动替换新保存正文；恢复后仍须明确保存。
4. 打开「保存失败」，恢复/修改并保存。应有明确错误，正文和 sessionStorage 草稿保留；关闭并明确放弃时才清理当前草稿。

## 主任务浏览器补证

主任务在独立 4195 服务实际使用生产编辑器及上述自由 HTML 合成验收页：从 revision 1 填入中文 HTML 草稿，勾选「保存失败」后保存得到明确错误且正文完整保留；「关闭编辑器」显示继续/放弃提示。选择继续、关闭失败开关并保存后得到 revision 2；正常关闭，再点正式「实际回读已保存正文」，显示精确 **122 字符 HTML** 和 `save-readback-confirmed` 事件。截图：[保存回读](../screenshots/template-editor-save-readback-20261008.jpg)。这是正常编辑、失败保留、关闭提示与真实 IndexedDB 保存/回读的实机证据。

**刷新恢复仍未实机验证。** 主任务调用浏览器刷新时出现 beforeunload，但浏览器控制层自动以 `result:false` 取消，后续没有可处理的活动对话框；原生 App 访问也被安全策略拒绝。主任务没有绕过策略，也没有改变产品关闭语义。这些限制不是刷新恢复成功或失败的证据。草稿读取、只读等待、冲突恢复与清理仍仅有本轮 Node/DOM 定向检查。

完整同视口视觉、精确官方正文与全部模板交互仍待分别验证；上述局部保存实机证据和 21 项定向检查不能代表全链恢复或全部模板验收完成。
