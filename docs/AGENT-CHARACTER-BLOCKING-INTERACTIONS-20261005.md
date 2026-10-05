# 人物站位实际交互增量（1005l）

本批起点为干净 `main` / `4001ea8`。项目与 `/Applications/TapNow.app/Contents/Resources/web/usercontent-proxy/apps/character-blocking@v3.f1fd0e23.html` 均实际核验 SHA256 `f1fd0e23de67bf00f60ccf333b7d5b57262a01726a37adeef28c800d51a8815b`。原文件未修改；没有新增依赖、读取Key、调用模型或生成API。

## 原页断点与修复

原页 `Sb` 先 `await Ym()`，随后才由 `Qm` 设置提交锁 `Mt`。`Ym` 捕获保存错误后继续，`Sb` 用保存后当前的 `G/V/target/ratio` 生成 CB3。保存期间继续拖人物或修改目标可能令提交快照与 CB3 不同；宿主虽然能拒绝不一致回执，原页没有可靠的确认闭环。人物与面向 `pointerup` 只安排300ms保存，`pointercancel` 保留最后坐标但没有主动提交；关闭前也没有此资源专属 flush。

新增 `src/features/agent-apps/character-blocking-local-interactions.mjs`：完整来源SHA、版本与逐段唯一替换同时校验，只派生已知 v3，不将历史v1映射到v3。

- 拖动/方向手势结束、键盘精调结束、数值字段离焦、目标/画幅变更、选择与重置点击都会立即 flush 当前官方状态；持续输入仍保留原300ms延迟。pointercancel保持官方最后坐标/朝向，不新增回滚。
- 保存链按不可变快照串行提交，只缓存真正成功的完整状态 fingerprint；重复结束事件不重复写事务，失败可重试、新状态必须保存。来源重发使缓存失效，异步旧来源不能复用成功回执。
- 确认开始就设置 `Mt` 与根节点 `inert`，捕获整份状态、当前人物ID顺序及官方摘要；实际保存后用同一快照生成官方 CB3。期间状态/来源变化、页面被销毁或保存失败均不发送消息。finally恢复原inert、原按钮状态与仍连接于页面的焦点。
- 慢保存导致iframe短时激活过期时，显示五语言“已保存，请再次点击确认”；不发送消息、不放宽host权限。下一点击可直接复用实际已存fingerprint。
- 保存与发送错误显示五语言可重试提示及宿主原因，成功显示真实交接。所有原数学、吸附、多人actor_id、portrait、目标与画幅合同保持。
- 在 `wb()` 连接官方SDK前复用现有 `localLifecycleScript({root:'Wm',flush:'blockingFlush()',busy:'Mt'})`。关闭仅等待既有 `tapnow/setWidgetState` 回执；失败保留原页，成功锁定直到真正关闭或同请求恢复。没有新增消息或工具权限。强制刷新/pagehide仍不能承诺异步最后编辑一定保存；销毁中的确认不会迟到发送。

主任务共享接线：proxy调用导出 `localizeCharacterBlockingInteractions`，server允许此单一静态模块，host `canFlushClose` 与 controller `hasPendingCloseApps` 加入 `ui://tapnow/character-blocking@v3`。本分工未写这四个共享文件。

## 隔离真实浏览器路径

入口 `/src/features/agent-apps/qa/character-blocking.html?session=interactions-1005l`。沿用已实现有界session数据库后缀；默认为两张公开合成人物PNG，实际IndexedDB资产、浏览器WebP裁图及生产registry/controller/host/runtime。外层QA字号、行高设整数像素便于真实iframe拖动，原页生产样式不改。未调用模型。

1. 保持延迟1800，打开新卡，等待“状态保存待完成0”。拖 `.marker[data-id="lin"] [data-slot="marker-body"]` 到舞台中央，再拖 `[data-slot="facing-handle"]` 改面向；抬起手势后立即应有状态保存待完成，提交后的 `positions.lin/facings.lin` 与原页数值相符。
2. 选周宁、改坐标/朝向，再选林岚；确认实际保存的 `selected_id` 跟随选择，人物值互不串用。可开吸附，验证拖动取官方50网格；关吸附后用数字输入林岚 `X=420,Y=610,面向=133`，目标video，画幅9:16。
3. 最后一次数字编辑后立即点击原页“确认人物走位”。1800ms期间所有板内控制被冻结；成功实际队列仅增1条，包含 `CB3 v=3;target=video;ratio=9:16;actors=lin~420~610~133,zhou~实际X~实际Y~实际面向` 及本地真实来源node_ref/字节哈希。重复确认同结构不加队列，触发按钮焦点恢复。
4. 勾保存失败，将林岚X改421并立即确认：旧已保存状态与队列保持，原卡显示事务失败且可重新编辑。取消失败，在同一原卡直接确认：X421真实提交，队列恰好增1条；不需要刷新。
5. 延迟改6000，改X422并立即确认。存储完成后若浏览器激活已过期，应提示已保存/再次确认、队列不增；再点击确认，相同状态不新增状态写入、立即进入原队列守卫。实际激活时长依浏览器，不能用等待长度替代 `isActive` 检查。
6. 延迟恢复1800，拖林岚到新位置后立即点外层“关闭面板并保存”。关闭等待最终事务才移除iframe，实际排队数不变；点“重新打开已保存面板”，位置/面向/目标/画幅与已保存值相符。再改坐标、勾失败、关闭：原页与草稿保留；解除失败再次关闭成功，重开和真正刷新恢复最后成功提交。
7. 替换林岚图片后旧卡确认应因来源变化失败，重新开卡才使用新真实头像。原官方重置仍只恢复建议位置/面向，保留target/ratio/selected_id/snap。

在页面 `window.characterBlockingQA.snapshot()` 可读实际chat/graph、panelOpen、savePending、saveCount，不暴露伪生成结果。保存计数只记录本页实际状态提交，刷新后从0重新计数；队列和人物状态真实持久。

## 定向验证与限制

```sh
node --test tests/agent-character-blocking-interactions.test.cjs
node --test tests/agent-character-blocking-lifecycle-sdk.test.cjs
node --test tests/agent-character-blocking.test.cjs
node --check src/features/agent-apps/character-blocking-local-interactions.mjs
node --check src/features/agent-apps/qa/character-blocking.mjs
```

新增7项交互回归通过，覆盖精确SHA与完整bundle解析、慢保存同快照/多人身份/目标画幅、失败原页重试、激活过期/成功缓存、新来源/状态变化拒绝、pointercancel最后值与结束手势flush、销毁中不发送迟到消息。

另2项执行完整原SDK与实际DOM的生命周期回归通过：按Window注册顺序传控制帧，最后数字输入须收到真实模拟存储响应才能关闭；失败不假成功且同值重试成立。既有13项人物来源/状态/CB3合同也再次通过，合计22项定向检查。未新增依赖，复用项目已有Fabric/jsdom依赖与现有生命周期测试写法。该测试存储响应明确由本地fixture控制，不冒称真实IndexedDB或浏览器拖动。

真实CUA、IndexedDB刷新与图像解码结果见下节主任务记录；Node结果与浏览器证据分别列出。本分工未提交Git。

## 主任务真实浏览器记录

2026-10-05，主任务在 `http://localhost:4173/src/features/agent-apps/qa/character-blocking.html?session=interactions-1005l-root` 使用公开合成PNG、真实IndexedDB、生产controller/host及官方人物板完成下列原生操作。没有调用模型或生成接口，没有篡改UI状态。

最初原生/PW嵌套iframe点击出现工具目标不可用与滚动后坐标命中偏差，不能据此判定产品故障。随后通过 `cua_repl` 的 CDP `Target.attachedToTarget` 取得opaque子帧target，使用 `Input` 真实鼠标操作；QA外层压缩布局将输入、说明和存储默认折叠，原人物组件尺寸/样式与已有存储未改。

| 真实操作 | 实际保存与回执 |
| --- | --- |
| 拖动林岚并拖方向把手 | 坐标从 `300/350` 改为 `449/482`，面向从 `90°` 改为 `133°`。 |
| 1800ms延迟下立即确认 | 原根节点 `inert`，保存完成才新增队列1条；CB3含 `lin~449~482~133`，焦点回确认按钮。 |
| 开保存失败，改X421并确认 | 原卡显示失败，队列仍1条；解除失败后同卡确认成功，队列增至2条，CB3为X421。 |
| 改X422立即点外层关闭 | 关闭按钮disabled，显示“正在保存最后编辑”，待完成1次；实际提交后才移除iframe。重开恢复 `X422/面向133°`，队列仍2条。 |
| 开保存失败，改X423并关闭 | 关闭失败，原板与X423草稿保持可见；解除失败再次关闭成功，本页状态提交计数5，队列仍2条。 |
| 真正PW reload | `X423/Y482/133°`、原队列2条与PNG来源头像均恢复，浏览器warn/error为空数组。 |

保存截图：[人物站位真实浏览器验收](screenshots/agent-character-blocking-20261005.png)，为PW fullPage截图。它记录本次实际页面，截图本身不替代上述保存/队列过程回执。

本次真实CUA覆盖拖动、方向拖动、慢保存确认、确认失败同页重试、关闭失败保留、重开与刷新恢复。6000ms激活过期、多语言、目标/画幅切换、pointercancel及多人物精调仍为定向测试或原合同覆盖，不能计作本次CUA通过。主任务另确认共享host的v3 flush/v1不扩权专项1/1通过，server CORS接线已重启；本记录补写后没有重跑测试。
