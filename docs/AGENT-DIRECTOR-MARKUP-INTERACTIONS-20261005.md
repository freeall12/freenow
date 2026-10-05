# Director Markup 本地交互核对 · 2026-10-05

导演批注保留官方的真实文本选择、插入点、四类批注、正文编辑和 DM1 确认。新增专用 SHA 派生，修复最后编辑关闭保存、批注焦点保存、工具条 Escape 取消、慢保存合并与确认重试。没有新增应用内 Save / Cancel / Close 按钮：安装包只有自动保存、删除批注、浮动操作条和“确认并结构化提示词”。关闭属于宿主生命周期。

## 来源与逐项合同

以下原件的 SHA256 都是 `4b53a29e33ef9c42a56045a678279e99f5f5aa5aad654cbb46fa1ef4bbd3850f`，磁盘原件未修改：

- `/Applications/TapNow.app/Contents/Resources/web/usercontent-proxy/apps/director-markup@v1.4b53a29e.html`
- `src/features/agent-apps/resources/apps/director-markup@v1.4b53a29e.html`

| 实际控件 | 官方实现依据 | 行为与本轮处理 |
| --- | --- | --- |
| 原文 textarea | `Y_ / W_ / Lm / n$` | mouseup、select、click、keyup读取真实 `selectionStart/End`；范围提供镜头/运镜，光标提供切镜/情绪。Tab进入工具条，pointerdown保留文本选择。保留。 |
| 文字/点标记 | `Q_ / Rn / Ks` | 镜头蓝线、运镜绿线、切镜红线、情绪紫线；同时存在按原双线/双色显示。标记为镜像而非额外可点击菜单。保留。 |
| 批注增改 | `A_ / C_ / r$ / t$` | 同范围、同类型复用原批注；每项直接自由文本，最大1000 UTF-16字符。没有预设菜单。新增批注后聚焦页边 textarea。保留；focus同时安排保存 `active_annotation_id`。 |
| 批注删除 | `L_ / t$`，`.dm-note-delete:hover` | 删除该项；最后一项删除后移除未使用锚点。悬停改变文字/背景，title与aria-label使用当前语言。保留。 |
| 正文编辑 | `M_ / Xe` | 编辑在锚点之前时移位，编辑覆盖锚点时置为orphaned并提示删除后重新划选；失效项与空批注禁用确认。保留。 |
| 取消浮层 | `se / Y_`、document pointerdown、resize/scroll/blur | 外点、滚动、窗口失焦取消。原Escape只在编辑器keyup里取消，工具条按钮聚焦后没有取消处理；派生补充document keydown，IME组合期间不拦截，并消费已有取消动作。仅来自工具条的Escape关闭后用preventScroll回正文编辑器，保留原选区；正文自身Escape与外点不抢焦点。 |
| 自动保存 | `Qn / Jm / q_` | 原400ms防抖后串行保存所有快照，没有关闭前flush。派生保留输入防抖；完成change/focusout即时flush，慢保存合并为最新待存快照，成功同状态复用，失败可重试。状态仍限128KiB。 |
| 确认 | `V_ / Cm / i$ / gi` | 原进入await前已禁用编辑/按钮，保存失败不发送；派生再核对固定已保存快照，恢复触发焦点。慢保存耗尽宿主需要的临时激活时显示本语言“已保存，请再次点击确认”，重新点击复用真实已提交状态。 |
| 关闭恢复 | 官方没有单独关闭按钮，v1不展开 | 复用现有 `local-lifecycle.mjs`：宿主close/reload先flush防抖和最后状态，失败保留页面可重试。协议仍通过opaque双iframe与正式 `tapnow/setWidgetState`，不开放存储或工具权限。 |
| 语言 | `B_ / hs / Rm` | 官方支持 zh-CN / en-US / ja-JP / ko-KR / fr-FR。验收页五语选择仅影响新打开页面；主文本可为任意语言，应用正文与提示按locale切换。用户标题保留。 |

## 共享接线

根任务在 `resources/mcp-app-proxy.html` 最终 `buildSrcdocWithCsp` 前增加如下转换。专用模块只接受原件完整SHA、director-markup v1；未知版本、改任意原字节或替换目标不唯一都拒绝。其他应用原样返回。

```js
.then(async function (templateHtml) {
  if (name !== "director-markup") return templateHtml;
  var interactions = await import("../director-markup-local-interactions.mjs");
  return interactions.localizeDirectorMarkupInteractions(templateHtml, name, version);
})
```

若共享服务器已有本地派生模块CORS精确白名单，加入 `src/features/agent-apps/director-markup-local-interactions.mjs`；复用既有 `local-lifecycle.mjs` 路径。应用原模型、registry、host、integration与正文/DM1输入合同无须变更。

## 主任务 CUA 验收入口

入口为当前本地服务的 `/src/features/agent-apps/qa/director-markup.html?session=director-20261005`。session为1–48个字母、数字、短横线或下划线，隔离本页验收IndexedDB；默认session沿用原库，刷新同session恢复实际保存状态与已排队结果。这里不调用模型、不生成视频、不上传素材。

1. 打开中文批注页。用真实鼠标从“林岚”开始拖选一段正文，应出现“所选文字 / 镜头 / 运镜”。悬停与点击镜头，页边新增镜头批注且光标在该批注内，输入 `中景~,%😀`。重选相同范围加运镜 `缓慢推进`；相同类型再次操作应聚焦已有项，不能复制。镜像正文显示蓝/绿两条线。
2. 在正文句间实际点击放置光标，应出现“插入点 / 切镜 / 情绪”。分别填 `切到钥匙特写` 与 `从警觉转为迟疑`，同位置显示双色点。检查页边anchor摘要、输入placeholder、删除按钮title和hover。工具条出现后Tab聚焦按钮，再Escape应取消工具条；外点与滚动也应取消，不能新增空批注。
3. 在正文最前加 `序：`，范围start/end与point offset都加2。再修改覆盖某段已批注文字，相关项显示“正文改动覆盖了原位置”，确认禁用。删除失效项，确认恢复。新增未填写批注时确认也应禁用；填写或删除后恢复。检查实际已提交JSON，禁止通过修改JSON代替页面操作。
4. 文字输入后立即点验收页“关闭面板并保存”，不必等400ms。关闭必须等待存储事务，再点“重新打开已保存面板”，应恢复正文、批注、锚点、active_annotation_id。重载官方页面同样先保存；普通会话重绘应保留现有iframe。浏览器刷新只保证已经提交的事务，浏览器强制退出不能被应用拦截并承诺落盘。
5. 设置1800ms延迟，连续改变批注和正文，立即确认并重复快速点击。保存期间内层textarea/按钮禁用；排队文本应为最后实际修改的DM1与可读正文，最多一次相同handoffId。若临时激活耗尽，页面显示“已保存，请再次点击确认”，本次没有排队；再次点击快速复用保存后可交接。确认后焦点回到仍连接的触发控件。
6. 在没有待存事务时勾“仅下一次状态保存失败”，编辑批注后立刻关闭，页面应保留且可重试；确认也不得排队。取消失败注入后再次关闭/确认成功。勾“模拟会话运行中”确认应失败且队列不增长；取消后再次确认成功。已提交JSON只显示事务oncomplete快照。
7. 分别选择English、日本語、한국어、Français后打开新卡片。重复真实范围/点选、两类动作、删除和确认，核对工具条、placeholder、status及确认标签均是该语言，DM1同样能够形成已保存的可读交接。法文窄屏检查长标签与页边批注换行。五语按钮不是原应用新增语言菜单，是QA输入locale入口。

## 本轮证据与边界

`node --test tests/agent-director-markup-interactions.test.cjs`：12/12通过。执行派生后的实际官方 `Y_ / n$ / r$ / t$ / A_ / C_ / L_ / M_ / q_ / R_ / V_ / Jm / i$`，涵盖真实事件处理回调、range/point选择、同类型复用、四类输入、删除、锚点移位与orphaned、emoji/分隔符DM1解析、焦点状态、慢保存合并、完成阶段竞态、失败重试、重复确认、临时激活到期、确认中状态变化拒绝与关闭flush。完整派生bundle经esbuild解析；原字节SHA不变。

既有 `tests/agent-director-markup.test.cjs` 本轮4/4通过，覆盖官方DM1收据与保存正文核对、未知字段、孤立/无效/空批注、非法Unicode和UTF-8状态预算。专用模块与QA `node --check`、`git diff --check`通过。

根任务原生键盘验收发现工具条Escape关闭后焦点落文档，随后只补上工具条来源的焦点恢复。新增事件回归使用 `node --test --test-name-pattern='only toolbar Escape' tests/agent-director-markup-interactions.test.cjs` 定向1/1通过，核对原start/end/direction与preventScroll、正文自身Escape不抢焦点；模块语法通过，既有通过项目没有重复执行。

## 根任务原生 CUA 结果

根任务在同一 `session=director-1005p-root1` 使用生产双opaque iframe完成下列实际页面操作，截图：[导演批注交互与保存](screenshots/agent-director-markup-interactions-20261005.jpg)。

- 通过真实Home、Shift+Right键盘选区和Tab/Return工具条操作创建cut、shot、motion、emotion四类批注；正文新增 `序：` 后，范围锚点保持 `start:2 / end:14`，插入点保持 `offset:2`。
- 设置1800ms保存延迟，最后编辑后立即关闭面板，页面等待保存再关闭；重开与浏览器刷新都恢复4条批注。
- 重新以active note保持一致的场景注入下一次保存失败，编辑后关闭确实失败且保留页面；再次关闭重试成功。较早的一次失败被active note保存提前消耗，不计作关闭失败证据。
- 实际DM1队列为1，重复确认仍为1；已排队可读内容包含 `中景~,%😀·重试验证二`，对应真实保存内容。
- 重载最新焦点补修后，正文Home+Shift+Right形成 `[0,1]` 选区，Tab进入镜头工具条后Escape关闭工具条并返回正文焦点；`start:0 / end:1 / direction:forward`保持。

本子任务没有操控浏览器，以上实机结果由根任务执行并记录。双opaque iframe的fractional位置使CUA工具拒绝坐标拖拽，实际选区验收使用原生键盘；未声称真实鼠标拖选通过。五种语言的完整视口、法文窄屏与全部hover视觉组合尚未实机验收。Node VM与上述中文定向CUA结果不能视为全部语言/交互全面完成。没有新增生产依赖、Git提交或修改共享sdk/host/integration。
