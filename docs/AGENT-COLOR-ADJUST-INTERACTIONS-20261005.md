# color-adjust@v2 本地交互与保存生命周期

本次增量修复原页的参数保存、应用交接和关闭等待。官方界面结构、18参数、自动建议、重置、三页签、高级通道和像素算法沿用安装包原HTML；未添加依赖、图标或生成服务。

## 原件与可复现缺口

- 原件：`src/features/agent-apps/resources/apps/color-adjust@v2.285e6ccb.html`。
- manifest版本：`color-adjust@v2 → 285e6ccb`。
- SHA256：`285e6ccbe35c7178fb8953514c2c2956af1be15e5a19dbf3dcbe38ee69f97337`。原文件与manifest没有修改。
- 原 `rc()` 仅在 `change` 调用 `ki()`；高频 `input` 的最后参数只在内存和预览里，未安排保存。
- 原 `e$()` 并行请求状态保存且 `catch{}` 吞掉错误；没有队列、成功快照去重或可见重试。
- 原 `n$()` 未先提交最后的平坦state；`updateModelContext(...).catch(()=>{})` 不等待交接成功、不显示失败。原 `t$()` 同样吞掉Skip失败。
- 原件无 `freenow/lifecycleReady/Flush`，关闭不能等待400ms debounce的最后编辑。
- 原高级通道按钮点击后 `Ei()` 重建自身，键盘焦点丢失；原图比较只支持指针，待执行的预览帧可以覆盖正在按住的原图。

专项测试直接运行原 `e$()` 重现错误被吞掉，并提取派生HTML里的实际函数及官方滑杆/建议/重置回调验证修复。

## 实际行为

`color-adjust-local-interactions.mjs` 先验证完整SHA及每个替换目标仅出现一次，返回局部派生HTML。重新派生或不匹配版本/字节均报错；其他应用保持原值。

- `input` 即安排400ms保存；`change`、失焦及关闭会刷新最后状态。
- 同一时间仅有一个状态事务，高频编辑合并到最新的完整18参数加 `active_tab/advanced_open`。仅成功提交的指纹可以去重，失败保留待保存状态。
- 保存失败在生产 `.status` 显示五语言文案及真实「重试保存」按钮，不显示内部SDK错误。重试经过原SDK和生产 `onSaveState`。
- Apply先保存当前快照，等待期间整个官方root为inert，避免其他页签、Skip或高级通道改动应用快照；双击被同步锁定。若等待后用户激活过期，显示「参数已保存，请再次点击应用」，下一次点击复用已保存快照。
- Apply获得真实PNG回执后等待上下文事务。失败保留同一输出的待交接内容，错误旁的「应用到画布」按钮及原Apply都只重试 `updateModelContext`，不会再次调用像素工具或创建输出节点。宿主仅恢复同一来源、同一会话生命周期的失败permit；成功仍消耗一次。
- 尚有失败上下文时关闭被阻止，当前页保持可操作，必须由用户显式重试交接；关闭不会自动执行Apply或发送消息。
- Skip也先保存最后参数再发送官方固定Skip文案；失败可重试，保存等待导致激活过期则要求再次点击。
- `freenow/lifecycleFlush` 等待保存回执；失败恢复root及发起焦点，成功保持冻结直到父级关闭或resume。Apply/Skip运行中拒绝关闭；来源换页或pagehide后不发送晚到输出/消息。
- 高级通道重建后焦点回到当前按钮。预览canvas可Tab聚焦，以空格/Enter按住比较原图；松开、指针取消/离开或失焦恢复调色预览，比较期间不覆盖原图。
- 重置仍是官方全18参数归零，建议仍仅切换曝光/色温/色调与初始建议前值；官方没有独立撤销按钮，本次未自行加入。

## QA入口与步骤

用正在运行的本地服务端口访问：

```text
/src/features/agent-apps/qa/color-adjust.html?session=color-adjust-20261005-root
```

`session` 只接受1–64位字母、数字、下划线或连字符，库名 `tapnow-qa-color-adjust-v2-<session>`；不复用旧v1验收库。默认960×540图为明确标记的QA真实像素输入；可用「导入真实本地图片」选择16MiB以内PNG/JPEG/WebP，该图片存为本地asset并替换本次QA来源。

1. 打开官方页，切光效/色彩/效果、滑杆连续调整并用方向键调整；用Tab打开/收起高级通道，确认焦点保留。按住预览空格/Enter与鼠标分别比较原图。
2. 选择1800ms延迟，连续改曝光和色温，立即「等待保存后关闭」。观察待保存回执计数；关闭应等待实际事务完成。重新打开，回读真实持久结果，核对20个平坦字段及页签/高级通道。
3. 勾「下一次状态保存失败」，修改参数后关闭；关闭保留原页，显示错误及重试。重试关闭或点生产保存重试，核对原值未丢失。
4. 选择1800ms延迟，调整参数立即Apply；等保存期间所有原件控件不可编辑。若显示再次应用提示，点击Apply，核对输出PNG与持久state为同一参数。
5. 勾「下一次应用上下文保存失败」，Apply一次。核对图节点数只增加1；回执有输出但无新增context。点击错误旁的Apply重试，节点数应不再增加，context文案与同一output node一致。
6. 回读会真实读取IndexedDB PNG bytes，计算SHA256，解码输出原图尺寸，核对图节点/回执/provenance/后续上下文；Skip才产生普通消息队列。

QA布局使用整数24px行高和整数边距以便CUA在双层opaque iframe中操作。仍需实际浏览器验收确认坐标、焦点和页面显示。

## 已运行检查与边界

```bash
node --test tests/agent-color-adjust-interactions.test.cjs tests/agent-color-adjust.test.cjs
node --check src/features/agent-apps/qa/color-adjust.mjs
git diff --check
```

2026-10-05：32项通过，其中新增14项覆盖SHA固定、原件失败重现、保存队列、真实滑杆/重置/建议回调、快照一致、失败重试、Apply冻结/激活边界、context-only重试、Skip、晚到来源变化、关闭握手及键盘比较/焦点。原件像素一致性和实际runtime提交/补偿回归18项也通过；派生内联script经项目现有esbuild解析。

本执行代理没有操作浏览器，没有调用模型或生成接口，没有提交Git。上述回归是源码与VM/runtime证据，不能替代全部视觉、hover、大图性能或真实浏览器焦点验收。root负责共享proxy/CORS/host/controller接线和当前CUA证据。

2026-10-07交叉复查：上下文事务提交后的最后一次真实PNG核验存在操作失效窗口。`setModelContext`现会在该核验结束后再次核对宿主操作与原回执，失效时执行原有补偿保存，避免宿主拒绝晚到回执却留下已持久上下文。新回归先在原实现重现“应拒绝但成功”，窄修后通过，并核对补偿事务与原输出节点不重复创建。

本轮仅运行相关10项回归（4项runtime保存/补偿与6项派生保存/context/关闭），`node --check src/features/agent-apps/color-adjust-runtime.mjs`及`git diff --check`通过。原HTML重新计算SHA256仍为上文固定值；本执行代理未操作浏览器，尚需root完成CUA交互验收。

## 2026-10-07 Computer Use 与持久结果

实际服务使用独立4195端口与session，正式宿主、双层iframe、SDK和本地像素runtime共同运行。曝光15、1800ms慢保存下关闭等待实际事务，重开恢复15。将曝光改25并注入一次状态保存失败，关闭保留页面及重试反馈，重试关闭后重开恢复25。

注入一次上下文保存失败后Apply生成唯一960×540 PNG，输出节点`b5c57959-2461-4388-8202-17f207c768a6`。输出29738字节，SHA256为`f64f4ae19f003125d3713e702d9443488ddac2846dae4846530c1cecca8d1072`；原图SHA256为`4ec792d44d1972f1b7517b8bc087ffbff1d9589a39d6694298300e4978d47c52`。待交接时继续改曝光30，关闭被阻止；通过真实键盘重试Apply，只提交原曝光25输出的上下文，没有再次创建PNG/节点，界面提示新参数仍需Apply。

实际IndexedDB回读核对PNG尺寸、字节、SHA、图结构、回执和上下文一致，原图与结果合计2节点，Skip队列为空。关闭、刷新和重开后仍恢复曝光30草稿、已应用25的同一PNG与上下文。[真实界面](screenshots/freenow-color-persistence-20261007.jpg)。全部hover、焦点组合与大图性能仍未完成。未调用外部模型。
