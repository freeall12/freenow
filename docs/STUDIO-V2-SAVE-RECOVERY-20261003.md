# 新版片场保存失败恢复（2026-10-03）

本批补齐官方“放弃修改并重新加载”按钮与恢复链路，不代表完整片场复刻完成。

## 官方依据

唯一来源仍为 `reference/studio-v2.md` 所列 TapNow 官方版本 `eb1c3578957450302e3cff5edd2ad253d0874421`。

- `reference/studio-v2-page-readable.js:2900–2903`：保存失败提示保留本地修改，显示“重试保存”和“放弃修改并重新加载”。
- 同文件 `973–977`：导入/保存期间拒绝放弃；取消保存定时器，清理待保存修改、手势、运镜编辑状态，重新加载已保存内容。

## 实现

- `runtime.mjs` 的 `saved` 只在资产和画布持久化都确认成功后更新，失败候选值不成为恢复基线。
- `save-recovery.mjs` 直接只读当前数据库的项目记录，读取真实已持久化的片场状态；不调用 `CanvasStore.load()`，避免推进整个画布的 CAS 版本而允许旧画布覆盖另一个窗口的更新。数据库、项目、CanvasApp、CanvasStore、LocalAssets 与 host node 的身份均被固定并重检。
- 先验证保存的视角、网格、光照、镜头/动画索引与画幅，再完整加载 GLB，并用候选 ScenePlayback/Mixer 检查绑定。读取/资源/格式失败发生在现有编辑树、历史、选择和资源释放之前。
- 如保存失败留下不同的 host node 值，恢复该值须先经原有 `updateNode/saveProject` 确认，保留已有 CAS 冲突保护；失败保留编辑树，并只回退尚未确认写入的内存字段。已确认写入之后不反向伪造内存回退。
- 成功后替换内容树，停止旧动画、清理操作选择与统一历史、运镜叠加几何、相机辅助资源和显示材质缓存，恢复已保存镜头、所选运镜、光照、网格、画幅及自由视角。旧 geometry/material/texture 释放，当前新树保留。
- 保存、重新加载、变换/运镜手势、撤销恢复或拍摄在途时拒绝放弃；重新加载期间关闭导航和变换输入，生产按钮显示忙碌并禁用，编辑区域 inert。失败继续显示错误且允许重试。

## 定向检查

```bash
node --test tests/studio-v2-save-recovery.test.cjs tests/studio-v2-agent-controls.test.cjs tests/studio-v2-import-focus.test.cjs
node --check src/features/studio-v2/runtime.mjs
node --check src/features/studio-v2/ui.mjs
node --check src/features/studio-v2/save-recovery.mjs
node --check src/features/studio-v2/qa/save-recovery-controls.mjs
node --check src/features/studio-v2/qa/save-recovery-fixture.js
node --check src/features/studio-v2/qa/generate-save-recovery-app.cjs
```

21/21 通过：专属恢复测试 15 项（包括六种坏 metadata 子项），受影响 Agent 控制 5 项和导入完成焦点 1 项。实际 GLTFExporter/GLTFLoader/Three Mixer 用于模型、动画、保存失败、恢复与资源释放验证。Node 中 IndexedDB 为事务适配 fixture，不把该证据当成浏览器实际 IndexedDB 验收。

覆盖保存失败基线不推进、成功重试成为新基线、真实GLB和运镜恢复、空场景、读取和资产失败保留编辑、保存/手势在途拒绝、重新加载期间阻止编辑、项目和同ID node替换拒绝、host恢复写入失败保留编辑、只读恢复不推进CAS/不覆盖另一窗口更新、无效视角/光照/画幅等前置拒绝。未全量跑无关套件，未新增依赖。

## 独立浏览器 QA 入口

`/qa/studio-v2-save-recovery-app.html?session=save-recovery-20261003-main`

专用页面从当前 `index.html` 主壳生成，没有修改主入口或公共 QA 控件。canonical fixture/controls/generator 均在 tracked `src/features/studio-v2/qa/`，生成页位于 ignored `qa/`。偏好设置只放内存 Map；画布和资产使用稳定 session 的隔离真实 IndexedDB。配置明确 `configured:false`，阻止其他 API 与外部网络，不复用旧生成 fixture 的伪配置。固定红色立方体、镜头、2 秒运镜由本地真实几何生成，未调用模型或官方服务。

```bash
node src/features/studio-v2/qa/generate-save-recovery-app.cjs
```


1. 点“准备并打开已保存片场”，等待真实 GLB 加载；立方体 X=0。
2. 点“注入下一次保存失败”，只替换下一次 LocalAssets.put；调用后自动恢复原方法。
3. 点“修改立方体 X=2 并保存”，看到生产“场景保存失败，本地修改已保留”。
4. 收起 QA，点击生产真实“放弃修改并重新加载”；应恢复 X=0，所选镜头与运镜仍可预览，错误消失。
5. 正常返回、刷新、重入，确认 X=0；再注入一次失败并点生产“重试保存”，应确认 X=2，随后刷新仍保持。

本子任务没有操作浏览器；现场验证由主智能体执行，其证据需独立记录。

## 限制

“重新加载”恢复数据库中当前已提交的片场，可能包含某个早期候选写入已经成功的结果；不把报错之后仍在内存的 host 值当作已提交记录。跨窗口画布冲突不会被本按钮吞掉，仍需用户处理该画布的冲突。大模型资源压力及任意第三方材质全部组合没有逐态验收。
