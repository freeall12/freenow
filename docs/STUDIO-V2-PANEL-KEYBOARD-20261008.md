# 片场 2.0 对象／镜头面板：标签键盘与悬停增量

## 本轮核对与版本对应

本轮直接核对了当前本地 `src/features/studio-v2/scene-panel.mjs`、相关测试、官方采集源码以及安装包，未把旧待办当作当前缺口。项目使用现有 Node／Three／Fabric 内含 JSDOM；没有添加依赖。并行代理修改的其他文件不属于本轮。

当前 v2 对应官方发布版本 `eb1c3578957450302e3cff5edd2ad253d0874421`，来源由 `reference/studio-v2.md` 登记。可定位证据：

| 官方文件／组件 | 位置 | 核对结果 |
| --- | --- | --- |
| `reference/studio-v2-page-readable.js` `rn/nc` | 1758–1770 | 对象展开、50 条分页、点击选择、全名 title；对象行没有自定义右键菜单或 hover 动作。 |
| 同文件 `oc` | 1772–1785 | `Wn/Xn/cs/ls` 是 Tabs／TabsList／TabsTrigger／TabsContent；镜头和运镜行使用点击回调。编辑运镜按钮有 `title="编辑运镜"`。 |
| `reference/vendor-packages-CN3JnHbF.js` | 243 行 `vO/y4/b4/E4`；导出 `f4/f5/f6/f8` | 对应页面的 `Wn/Xn/cs/ls`，继续代理到官方 Radix 实现。 |
| `reference/vendor-libs-DqoAc28N.js` | 186 行 `Gna/Wna/Kna/Zna` | 水平／automatic，列表 loop 默认 true；焦点自动激活，右键或 Ctrl 点击阻止默认聚焦，标签与面板有 ARIA 关联。 |
| 同文件 | 186 行 `Nea`、`Zro/eio/Dea/tio` | Roving focus；Left／Right、Home／End、PageUp／PageDown，修饰键不参与，上下键不参与水平列表，RTL 反向左右键。 |

安装包另属新一代工作区：`/Applications/TapNow.app/Contents/Info.plist` 当前版本 **0.4.81**；`assets/ThreeDWorkspace-BzPphAqB.js` 中没有此版 v2 的 `objectList/shotList` 组件。

| 安装包模块 | 精确组件 | 与本地关系 |
| --- | --- | --- |
| `ThreeDWorkspace-BzPphAqB.js` | 376 行 `d4`：director entity 行为、history 事务、source identity 写入 | 使用 world-space／setups／entityState 模型，不能直接当成 GLB v2 的行菜单合同。 |
| 同文件 | 548 行 `S$`：plan 指针位置菜单 | 将 actor/camera 放置回调交给 runtime 与位置命中；属于新版导演工作区。 |
| 同文件 | 548 行 `k$`：WorkspacePlanView 与实体选择／轨迹／菜单装配 | 本地 `studio.mjs` 3 行、304 行只登记已有 v1 与 `studioV2` 分流；未找到该安装包模块的独立第三代生产入口。旧版 director 能力不构成新版这一模块已实现的证明。 |

本轮没有把第三代 actor/camera/entity 菜单嫁接到当前 GLB v2。第三代入口、来源身份、事务模型和菜单仍需独立映射后实现；这不表示用户范围排除这些非营销功能。

## 具体当前差异与修复

此前本地两个标签均为普通可 Tab 聚焦按钮，没有方向键处理、自动焦点激活或标签／面板关联；内容只有一个匿名容器。当前增加单一 Tab 停留、焦点自动激活、循环左右键、首尾键、RTL、两份有标签关联的面板和禁用修饰键导航。鼠标实际聚焦新标签后 click 不重复重建目录。显式程序 click 仍可刷新未聚焦标签，供现有正式 QA 刷新按钮使用。

此前编辑运镜按钮有可读 aria-label 但缺少官方完整悬停 `title`。现在补为“编辑运镜”。原来的 `motion.start(clip.index,camera.userData.studioId)`、对象 identity、`selectShot`、分页／展开状态与保存路径均保留。标签切换不会触发选对象、切镜头或保存事务。

关闭语义核对：片场设置标题仍是原生按钮，收起 body 保留当前标签与树状态；Escape 在这个非弹出面板不自造关闭行为。对象／镜头行没有官方自定义右键菜单，本轮不新增它。

实现文件：

- `src/features/studio-v2/scene-panel.mjs`
- `src/features/studio-v2/qa/scene-panel-controls.mjs`：诊断新增每个标签的 selected/tabIndex/controls 和面板 hidden/labelledBy，并提供聚焦正式标签入口。
- `tests/studio-v2-scene-panel-tabs.test.cjs`

## 新鲜定向证据

```bash
node --test tests/studio-v2-scene-panel-tabs.test.cjs tests/studio-v2-scene-panel.test.cjs tests/studio-v2-scene-panel-snapshot.test.cjs
node --test tests/studio-v2-scene-panel-qa.test.cjs
node --check src/features/studio-v2/scene-panel.mjs
node --check src/features/studio-v2/qa/scene-panel-controls.mjs
git diff --check -- src/features/studio-v2/scene-panel.mjs src/features/studio-v2/qa/scene-panel-controls.mjs tests/studio-v2-scene-panel-tabs.test.cjs docs/STUDIO-V2-PANEL-KEYBOARD-20261008.md
```

8 条新增验证覆盖 ARIA 关联、单一 Tab 停留、箭头循环／首尾、focus 自动激活、修饰键／组合输入、右键／Ctrl 鼠标保护、RTL、对象真实 identity 回调与镜头事务入口、折叠与 Escape、运镜完整悬停与 clip/camera 来源参数。既有 9 条对象／镜头与目录验证通过；3 条真实 GLB 生产 loader／120 镜头动画绑定／隔离 QA 验证通过。未跑全库测试。

## 给主执行者的真实生产 QA

现有入口继续使用正式画布、`StudioAPI.open`、GLB loader、WebGL runtime 和片场 UI：

```text
http://localhost:4173/src/features/studio-v2/qa/scene-panel-main.html?session=panel-keyboard-oct08
```

1. 点击“准备并打开真实大场景”。确认 `prepared=true`、`loadStatus=ready` 和实际 WebGL 模型。点击“聚焦正式拍摄标签，随后用键盘”，收起 QA 检查器。
2. 按 Right：场景标签激活、焦点留场景标签，正式对象树出现。再按 Right：回拍摄。Left 循环；Home／PageUp 到拍摄，End／PageDown 到场景。上下键与 Shift／Ctrl／Alt 方向键不切标签。
3. 在拍摄标签按 Tab，焦点应进入该标签的可见 tabpanel；下一次 Tab 才进入首个镜头。未激活场景标签和隐藏面板不会插入顺序。反向 Shift+Tab 应退出标签组。
4. 主动聚焦場景标签即可激活，无需 Enter；Enter／Space 保持当前选择。片场设置收起再展开保持标签。标签上的 Escape 不关闭片场或清空对象。
5. 场景页展开模型组，翻页 50→100→150→151。选择真实模型 151 应选择 `qa-panel-model-150` 并聚焦实际 renderer canvas。回拍摄选镜头 120 应得到 `shotId=qa-panel-camera-119`；运镜编辑仍绑定其实际 clip/camera。
6. 右键／Ctrl 点击未激活标签不能切换标签；镜头和运镜长名称保留原生完整 title，运镜编辑按钮悬停提示“编辑运镜”。新版第三代指针菜单不属于这个 v2 QA 页面。
7. 展开检查器读取 `dom.tabs`、`dom.panels`、`activeElement/lastPanelFocus`。确认每组恰好一个 `tabIndex=0` 的标签、active 标签 controls 与可见面板 id 一致。使用新的 session 独立保存 QA 数据；不清理用户原数据，无 Key／真实模型调用。

测试通过不等于实机验收完成。本轮未使用共享 CUA；实际键盘焦点、布局／悬停和跨代入口验收由主执行者集中记录。

## 主线 CUA 实机验收补充（2026-10-08）

主执行者随后使用现有 `generate-scene-panel-app.cjs`，从当前生产 `index.html` 重新生成 `scene-panel-main.html`，更新旧 QA 页面中的品牌与脚本引用。以下是这次新鲜实机验收入口；上文 4173 地址是初始复现示例。

```text
http://localhost:4195/src/features/studio-v2/qa/scene-panel-main.html?session=panel-keyboard-oct08b
```

正式真实 GLB 大场景已准备并打开。主线通过 CUA 实际操作并以 DOM 只读核查验证：

- 从 QA 按钮聚焦正式“拍摄”标签后，Right 切到“场景”；激活状态、焦点和 `tabIndex=0` 同时落在“场景”。再次 Right 循环回“拍摄”。
- End 后再 Home 回到“拍摄”。Tab 进入实际 `tabpanel`，下一次 Tab 进入首个镜头“QA 镜头 001”。
- Shift+Right 和 Down 保持当前标签；右键点击未激活“场景”标签时，“拍摄”继续激活。
- DOM 只读核查确认标签组只有一个 `tabIndex=0` 标签，`aria-controls` 与对应 `tabpanel` 的 ID、标签关联一致。

随后正常点击“场景”标签、收起 QA 检查器与 Agent，在默认 **1280×720** 视口保存了截图：[studio-panel-keyboard-20261008.png](screenshots/studio-panel-keyboard-20261008.png)。截图包含真实 WebGL 橙色合成模型、正式对象树及镜头预览；合成布景用于验收，不是官方设计参考。

本批没有重复完整分页至 151 条、镜头 120 的 CUA 验收；过去对应验证见已有场景面板记录，不能把它们写成本批新鲜复测。RTL、全部按键组合、全部 hover 状态也未做本批实机覆盖。运行时全部行为、官方逐像素一致性和新一代 director 独立入口仍未闭合。

此前定向 **17/17** 与生产 GLB QA **3/3** 检查仍作为本批代码验证依据；此次仅追加实机记录，没有修改生产源码／测试或重复运行测试。
