# Performance Rhythm 本地交互核对（2026-10-05）

唯一页面依据是安装包原始 `src/features/agent-apps/resources/apps/performance-rhythm@v3.9ead0d0b.html`，SHA256 为 `9ead0d0bb847a55c3598ba90626b3fba85f9d2acbc773a447b12ee57d8994ae3`。原始文件未修改；本次没有模型、媒体、营销文案或外部服务调用。

## 实际合同与修复

| 操作 | 官方实际行为 | 本次处理 |
| --- | --- | --- |
| 曲线拖拽 | `zb/$c/br` 固定首末点时间，驱动力 0–100，内点至少保留 100ms 间隔（极密输入时退化为至少1ms） | 保留规则；结束拖拽/取消手势刷新保存 |
| 曲线增加/删除 | 双击空白添加插值点；3–12点，首末点不可删 | 保留规则；离散点击刷新保存 |
| 节拍编辑 | `Ob/Nb` 拖拽时间、类型、1–3强度、48字备注；最多24个，允许相同时刻 | 保留规则；完成字段和手势刷新保存 |
| 键盘 | 曲线箭头改100ms/1驱动力，Shift改500ms/5；节拍箭头改100/500ms。Tab聚焦不会自动选中；Delete调用当前选中项删除 | 明确修复：先选中收到键盘事件的ID，避免删除另一节拍或曲线点 |
| 保存 | `Y` 300ms防抖，`kb` 无界串行，`fp` 吞失败 | 连续编辑仍防抖；已发出的慢保存只合并最新待存快照；成功相同状态复用；失败可重试 |
| 快速确认 | `Zb` 保存后才由 `gp` 设发送锁；等待保存期间可并行确认/修改，失败仍试图发送 | 在首个await前设置发送锁与`inert`，固定`bb`快照，保存失败/快照变化均不发`ui/message`；结束恢复原inert和仍连接的触发控件焦点 |
| 关闭/重开/重载 | 官方没有自己的关闭按钮，v3官方策略不展开；由宿主销毁和从appState重建 | QA增加宿主关闭/重新打开/重载；保存已提交后恢复实际曲线/节拍/选择/播放头/review |

派生只修改上述行为；曲线算法、节拍规则、官方布局与确认PS1协议均保留。宿主现有PS1与保存状态核对、来源校验和handoffId去重继续生效。

## 根宿主接线（专用模块不直接改共享文件）

在 `resources/mcp-app-proxy.html` 最终 `buildSrcdocWithCsp` 前加入：

```js
.then(async function (templateHtml) {
  if (name !== "performance-rhythm" || version !== "v3") return templateHtml;
  var interactions = await import("../performance-rhythm-local-interactions.mjs");
  return interactions.localizePerformanceRhythmInteractions(templateHtml, name, version);
})
```

`server/server.cjs` 对已有本地派生模块的 CORS 路径白名单中加入 `src/features/agent-apps/performance-rhythm-local-interactions.mjs`，沿用双iframe opaque origin设计。不扩大应用 CSP；不授予 `allow-same-origin`。根Agent负责共享接线。

## 可重复浏览器步骤

入口 `/src/features/agent-apps/qa/performance-rhythm.html?session=rhythm-20261005`，启动沿用仓库 `node server/server.cjs` 的当前监听地址。session为1–48位字母、数字、下划线或短横线，用作专用IndexedDB后缀；不同session隔离旧验收数据，刷新同session恢复数据。未带参数沿用既有默认库。页面保存输入、状态和排队结果，不会调用模型。“实际已提交状态”只显示完成事务的快照，不把保存中的内存当成成功。

1. 打开默认12秒示例。拖动6.2秒曲线点改变时间/驱动力；点击末点观察时间不可编辑。双击曲线空白新增点，删除内点，确认3点下限。核对已提交JSON。
2. 拖动节拍，编辑时间/类型/强度/备注。备注输入 `停住~,%😀`。添加和删除节拍，核对JSON和列表一致。先选中b1，再Tab聚焦b2，Delete应删除b2。
3. 已提交后点“关闭面板”，再“重新打开已保存面板”；“重载官方页面”和浏览器刷新都应恢复实际保存状态。“普通会话重绘”应保留现有iframe而非重建。
4. 将保存延迟设为1800ms。连续拖动，松手后立刻确认并快速重复点击；保存期间曲线/节拍/确认控件不可操作，最终应只排队一次，PS1与JSON是最后实际编辑。若延迟耗尽浏览器原生临时激活，应显示“已保存，请再次点击确认”而不发送；再次点击复用已提交状态快速确认，保留宿主权限。检查确认结束后焦点回到仍连接的原控件。
5. 在没有待提交保存时勾“仅下一次状态保存失败”，再改变review或驱动力让状态产生实际变化。该次保存失败后确认不得排队；重新确认可保存并排队，成功发送后旧“发送失败，请重试”状态应清空。已成功保存且完全未变化的状态会复用，不触发注入失败。
6. 勾“模拟会话运行中”，确认应失败且队列不增加；取消再确认可成功。相同卡片内容重复确认仍只保留一次handoffId。检查“回对话调整”结果仍是官方revise文案。

## 定向证据与边界

```sh
node --test tests/agent-performance-rhythm-interactions.test.cjs tests/agent-performance-rhythm.test.cjs
node --check src/features/agent-apps/performance-rhythm-local-interactions.mjs
node --check src/features/agent-apps/qa/performance-rhythm.mjs
```

新测试执行派生后的实际官方 `kb/Zb/Tb/Ob` 函数，覆盖慢保存合并、相同状态复用及同步/微任务结束竞态、重复确认、失败重试、保存期间变化拒绝、最后拖拽立即确认、原inert/焦点恢复、临时激活过期后重试和键盘错目标；也解析派生后的完整官方bundle并检查源SHA。最新交互测试12/12通过；之前独立官方合同测试10/10通过，未因无相关改动重复跑。现有测试独立核对官方PS1、各语言、分隔符编码、端点、保存状态和主controller来源guard。QA及派生模块语法检查通过。

本子任务没有操作浏览器；原生pointer capture、键盘焦点、视觉与主Agent接线由根Agent统一核验。即时flush仍通过跨iframe异步传输：在请求尚未到宿主或事务尚未完成时直接销毁/导航，不能承诺最后编辑已经落盘。验收恢复步骤应以“待完成0次”和已提交JSON为界；解决所有强制关闭的保存保证需要宿主等待teardown/flush的生命周期合同，不属于只改本页交互的能力。保存中来源失效仍禁止发送确认。
