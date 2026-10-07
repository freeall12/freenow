# Desktop 本地文件夹整理（2026-10-08）

本地后台、原生授权/确认入口及 Agent 工具已接线。只支持在用户实际选择的一个目录内创建子目录、移动和重命名普通文件；无删除、文件内容读取、全机默认授权或远端文件接口。本轮最新 source QA 已实机验证原生授权、三项确认执行、有效单项取消及目录移动拒绝；完整 Agent SDK、恢复及实机回滚仍有未验边界。

## 官方证据与版本

- [官方更新日志](https://docs.tapnow.media/zh/docs/changelog)：v2.13.23，2026-08-27，标题“Agent 可整理桌面文件夹”。原文：“在 TapNow Desktop 中，把一个本地文件夹授权给 Agent，再说明要创建哪些子文件夹、移动或重命名哪些文件。Agent 会先显示整批操作供你确认；确认后只在该文件夹内执行，任一步失败都会撤回已经完成的更改。”
- [官方 Agent 教程](https://docs.tapnow.media/zh/docs/agent/chat-with-agent)：“执行前，确认卡片会列出整批操作。检查路径和名称后一次确认，Agent 才会开始处理。它不会操作授权文件夹以外的内容，也不会覆盖已有文件；任一步失败时，会撤回这批操作中已经完成的更改。”
- 本机 `/Applications/TapNow.app` 安装包版本 **0.4.81**，`Contents/Resources/app.asar` SHA256 `ebf99b3b70514d71b5d862f1b6e230ec3b87861a670c987dd5902e7a32bea8bc`。2026-10-08 只读检查 `dist/main.cjs`：IPC `tap-desktop:local-files:organize-directory`、每批上限50、mkdir/move/rename、grant root realpath/dev/ino校验、逐层拒绝symlink、逆序rmdir/rename回滚及显式 rollback incomplete 错误。**安装包还支持目录移动，本次本地实现明确拒绝目录移动，不能报告安装包全部能力一致。** 安装包源码是实现证据，不是官方运行结果。

## 用户流程

1. Desktop 菜单“授权 Agent 整理本地文件夹…”或者 Agent `desktop_files_authorize` 打开原生选择器，用户选择一个目录。
2. Agent 读取授权状态与真实目录列表，使用稳定 UUID 生成整批预览。预览不改文件。
3. 调用 `desktop_files_apply` 后原生弹窗显示授权目录和每一项创建/源→目标，默认“取消”。自动模式也需要这次原生确认。
4. 实际确认后执行；失败则逆序撤回本批已完成更改。外部占用/改变阻止撤回时，保留文件并返回 `rollback_failed` 和错误操作列表。
5. 菜单“查看文件操作回执”或 status/recover 查询原批。未知结果不能当作未执行，不能换 UUID 再创建同批任务。
6. “撤销本地文件夹授权”或退出窗口失效；重启必须重新选择原目录，只读核对未知批次，绝不自动执行或回滚。

## 工具契约

| 工具 | 输入 | 输出与权限 |
| --- | --- | --- |
| `desktop_files_status` | `{}` | 实际授权状态、目录名称和批次回执；浏览器返回 desktop=false |
| `desktop_files_authorize` | `{}` | 原生选择器的实际用户授权结果；不能从 renderer 传根路径/owner |
| `desktop_files_list` | `path?`相对目录、`offset?` | 每页至多200个名称和类型，不读文件内容；symlink显示 blocked_symlink |
| `desktop_files_preview` | `operationId` UUID、`operations`1–50项 | `batchId/digest/status=prepared/operations`；mkdir:path，move/rename:source/destination |
| `desktop_files_apply` | 原预览的`batchId/digest` | 原生确认后的真实批次终态；拒绝重复执行和内容变更 |
| `desktop_files_recover` | 原`batchId` | 同一目录重新授权后的只读现状及原回执；没有执行能力 |

路径必须为相对路径。拒绝绝对路径、Windows路径、点段、空段、控制字符、symlink、特殊文件、跨卷子目录、仅大小写差异、现有目标和目录移动。目录授权只由 main→utilityProcess 私有 IPC 授予；HTTP 没有授权、列表或执行路由。preload 限制本机固定 origin 与顶层窗口；main再次校验 sender、mainFrame、origin，权限绑定主窗口身份。root保留原文件描述符，并持续检查realpath/dev/ino。

Agent 的 AbortSignal 转换为单次请求 nonce。停止待授权/待确认请求会使晚到的原生“确认”失效；开始执行后的停止不伪装为文件已取消，等待原批次回执。已经开始的批次完成持久化后才允许正常后台关闭。

## Failure / Logging

回执目录为独立后台 `.desktop-file-batches`，目录0700、文件0600。只记录批次 UUID、相对操作路径、授权身份、文件身份、syscall意图/已完成阶段和错误code；不保存内容/Key，不打印文件内容或模型请求。每步前保存intent并fsync，文件移动用原子 hard-link（现有目标立即EEXIST）后解除原条目，逐步保存linked/done；rollback按逆序仅撤回身份匹配的本批条目。回滚检查现有原位置，不覆盖外部文件。

`completed`是原始完成过的步骤数，`rolledBack`是已撤回步骤数；只有status=completed代表整批有效结果。`rolled_back/rollback_failed/recovery_required/cancelled/revoked`有明确error/code，Agent trace与中文状态展示不会当作成功。启动发现prepared/applying/rolling_back持久记录时仅标记recovery_required，永不重复syscall。

- 授权缺失/根替换：`desktop_files_not_granted`、`desktop_files_grant_changed`。
- 参数/目标冲突/符号链接：`desktop_files_invalid_path`、`desktop_files_destination_exists`、`desktop_files_symlink`。
- 目录内容变化：`desktop_files_preview_stale`；重新核对后明确新任务才可以准备新批。
- 原身份/摘要变更：`desktop_files_batch_identity/conflict`；原ID不允许改内容。
- 回滚占用/替换：`desktop_files_rollback_collision/changed`；保留日志和实际文件，人工核对。
- main等待回执超时/后台退出：结果未确认；查询原batchId，绝不重提。

## focused 验证

```bash
node --test tests/desktop-files.test.cjs
node --test tests/desktop-main-startup-close.test.cjs tests/desktop-runtime-config.test.cjs tests/agent-runtime-lifecycle.test.cjs
```

专项15项测试通过：真实临时目录mkdir/move/rename、路径/大小写/覆盖拒绝、root替换、symlink逃逸、授权身份/摘要冲突、重复确认、逆序回滚、EXDEV失败注入、回滚被外部占用、撤销、重启未知日志只读恢复、IPC发送者/origin/主frame、Agent停止晚确认失效与已开始执行不伪取消、工具schema/真实状态展示、同UUID并发预览冲突与大小写UUID恢复。EXDEV为受控错误注入，未测试真实跨卷设备。原桌面启动关闭6项、环境边界3项、Agent生命周期9项通过。只检查本任务创建的临时目录，未读取私人用户文件或真实Key。

实机开发入口（不prepare、不重建或发布Alpha）：

```bash
pnpm exec electron desktop --freenow-files-qa
```

先确认4183没有其他实例监听。此入口自动新建`os.tmpdir()/freenow-desktop-files-qa-*`作为独立userData和`authorized`QA目录，使用仓库空Key模板，直接打开本地QA页。只选择页面显示的本次QA目录；原生选择器默认该目录。预览→取消检查文件不变，重新明确准备新批次→确认执行→实际列表/文件检查→重复执行回执→撤销授权验证。改源码后必须重启QA Electron进程，现有进程不会热替换main/utilityProcess模块。

## 本轮 source QA 实机证据

2026-10-08，主线重启最新源码 Electron QA 后通过 CUA 操作原生界面，只使用该次启动自动创建的临时 QA 文件夹。没有重建或发布 Alpha；既有 Alpha 不包含本次能力。

1. 原生选择器授权本次 QA 目录，预览三项 `mkdir sorted`、`move one.txt → sorted/one.txt`、`rename two.txt → renamed.txt`。原生整批确认后回执为 `status=completed`、`completed=3`。实际文件回读确认两个目标各7 bytes，内容分别仍为 `QA one\n`、`QA two\n`；原 `one.txt`、`two.txt` 均不存在。
2. 新建单项取消批次 `mkdir must-not-be-created`，先获取最新完整 AX 状态再点击原生“取消”。回执为 `status=cancelled`、`completed=0`，实际文件检查确认该目标不存在。这一轮是有效取消证据。
3. `move sorted → moved-folder` 在预览阶段明确拒绝目录移动，执行和恢复按钮保持 disabled。实际目录检查确认 `sorted/one.txt` 保留、`moved-folder` 不存在。

| 已确认的文件结果 | 字节数 | SHA256 |
| --- | --- | --- |
| `sorted/one.txt`，内容 `QA one\n` | 7 | `3b4276a7f1de5f49ee883d79d519d82dc3df5a8497aface17c28b3d7154165cc` |
| `renamed.txt`，内容 `QA two\n` | 7 | `fbf4ddae0231d133cdb010b27ac9134b97fbfe8c8dc62af8a960ebc0e998cd40` |

截图：[三项操作真实结果](screenshots/desktop-files-local-results-20261008.png)、[有效单项取消回执](screenshots/desktop-files-cancel-receipt-20261008.png)。

工具证据限制：中间一次两项“取消验证”出现 CUA“用户改变应用”提示，随后实际核对为 `completed=2`，临时 QA 内执行了 `renamed.txt → should-not-exist` 和 `mkdir cancelled-folder`。该轮不能作为取消证据，也未据此推断生产 bug；有效取消结论只依据上面的最新单项批次。Return 没有生效，本轮没有验证“默认 Return 取消”。

## 未验与限制

- 原生选择器、三项整批确认、有效单项取消及目录移动拒绝已有上述最新源码实机证据。50项长批次是否全部可读、已开始执行期间退出、完整 Agent SDK 经原生确认/Agent停止取消的端到端链、重启读取同一 journal、实际文件操作失败后回滚，仍未完成实机验证；Node测试不代替这些界面和恢复证据。
- 当前仅macOS开发入口；没有新版签名/公证/打包发布结论。打包时新增tracked源文件才被现有prepare纳入；开发QA入口直接读取source，避免旧staging。
- Node fs缺少openat/目录fd相对写入及renameat2无覆盖机制，因此本次拒绝目录move/rename。对路径祖先的**恶意并发替换**仍存在检查与syscall之间的TOCTOU窗口，保留目录句柄和逐步校验不能消除此竞态。不能据此宣称恶意本地进程并发攻击下目录边界已严格实现。后续应独立评估原生fd相对操作helper；本批未新增系统脚本/原生构建依赖。
- 正常外部变化、目标覆盖、常见symlink逃逸均拒绝或回滚；断电/强制退出中的最终syscall结果可能未知，journal明确保留未知状态，不自动恢复写操作。
