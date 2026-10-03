# 真实 GPU 拾取隔离 QA

入口：`/src/features/studio-v2/qa/picking-main.html?session=gpu-1003`。

页面从当前 `index.html` 生成，保留正式主画布与 `StudioAPI.open`。preferences 只用内存，CanvasStore 与 LocalAssets 使用 `qa-studio-picking:<session>:` 独立真实 IndexedDB。请求只允许本机文件；模型/API 调用被阻止。场景均为合成几何与程序纹理，不读取用户场景或官方资产。

重新同步主壳：

```sh
node src/features/studio-v2/qa/picking-generate-app.cjs
node src/features/studio-v2/qa/picking-verify.mjs
```

## 交互步骤

1. 选择分组与透视/正交，再点击「准备分组场景（不选择）」。合成 Three JSON 写入独立 IDB 并通过真实 CanvasStore/ObjectLoader 回读后挂入正式 runtime。
2. 右侧表显示探针、预期 studioId 和当前屏幕坐标。点击黄色十字中心，QA 不拦截 pointer、不主动调用 select/pick；正式 canvas pointerup → runtime.pick → ScenePicker → runtime.select 执行。
3. 查看实际 `selectedId` 和 observations。只有来自 canvas pointer 且命中探针附近的真实 selection 记录具有 `match`；对象树或其他非 pointer 选择不会被记为测试通过。`trusted` 保留真实事件标记，细线探针需精确命中像素。
4. 分别设置 DPR 1/2，重复点击。resize/拖动视角后点击「刷新坐标 / 诊断」。收起 QA 不影响十字点击；也可隐藏十字检查原始预览材质。
5. 快速点两个目标，核对最终 ID 属于最后一次点击；通过正式片场关闭按钮关闭，再刷新诊断，核对没有迟到 selection。这些生命周期步骤须由浏览器实际验证。

## 分组

- 贴图透明孔：实心前景、孔后景、空白 null。
- opacity：无纹理 uniform 的 0.049 / 0.05 / 0.051，严格阈值边界。
- alphaMap：绿色 0 / alpha 255 透过；绿色 255 / alpha 0 仍命中前景。NearestFilter，无 mipmap。
- MASK：alphaTest=.5，opacity=.25 后景 / .75 前景。
- Line / Points：细线、虚线实线与空档、48 CSS px 圆形点精灵中心及透明角。透明角从点中心同 z 投影，再偏移 20×20 CSS px。
- morph / skin：实际形变位置的实心与孔、静止旧位置。ObjectLoader 回读保留 morph 权重、骨骼和绑定，点击进入原生 shader 路径。
- 相机辅助体：正式 CameraPresentations 根据真实相机及合成 motion 构造机身；相机 ID 来自正式父级映射。另一组添加前景遮挡。隐藏大尺寸 bounds 几何仅提供可见辅助体尺度，不能参与拾取。
- 播放中选择：第 09 组点击「播放 / 重播合成动画」，真实 ScenePlayback 播放对象位置轨道，十字跟随实际对象。点击运动中实心或孔；诊断保留 pointer 时 `playbackBefore` 与 selection 时 `playbackAfter`，需要实际 GPU 命中并确认停止。按钮只启动动画，不选择对象。

诊断记录 Three/browser/GPU、DPR/drawing buffer、实际/预期 ID、pointer 坐标、读取结果及错误。透视和正交相机固定在 `(0,0,10)` 面向原点；正交切换是 QA 限定 camera + Navigation/TransformControls 接线，不代表产品增加正交入口。

第 05 组可在设置 DPR 后点击「将细线对齐整数指针像素」。native CUA 的 pointer 坐标会取整，原细线在 DPR 2 有时只覆盖半 CSS 像素，无法发出对应真实点击。此按钮仅将两条合成线沿世界 Y 微移，用当前相机计算整数 CSS 点击所读取的物理像素中心；整数 canvas 原点、DPR 2 时为 `floor(screenY) + .25`。实线、虚线实线和空档探针同步到线所在 z=0 平面，表格与十字显示可达的整数点击坐标，`coordinates()` 额外保留 `projectedX/projectedY`，`lineAlignment` 记录位移与物理行。Points 和其他分组不变，生产线宽、材质、拾取规则及预期 ID 不变。更换 DPR、resize 或移动相机后需再次点击对齐；重新准备恢复原场景。按钮不会调用 select/pick，对齐本身不代表 GPU 命中通过。

## 验证边界

本 fixture 验证 GPU picking；宿主 studio 节点真实保存，但合成场景独立保存为 Three JSON，并不宣称通过产品 GLB 导入、保存或导出。这样保留 glTF 无法表达的独立 alphaMap 与 Point sprite 规则。准备时标记 synthetic runtime revision 已处理，仅避免关闭自动将探针导出成产品 GLB；不以该标记证明数据耐久。

形变几何使用普通 `BufferGeometry.copy(PlaneGeometry)`：参数几何的 `toJSON()` 只保存构造参数，追加 morph/skin attribute 会被遗漏。修正后的验证逐项比较 position/normal/uv、morph position/influence、skinIndex/skinWeight、bone/bind/inverse，并比较回读前后全部实际形变世界顶点；中心 X 为 morph -0.95、skin 2.3。此检查证明探针几何保留，不等于 GPU 命中通过。

fixture CSP 仅追加 `wasm-unsafe-eval` 支持本机 WASM；不加入 JavaScript `unsafe-eval`。正式主入口 CSP 本身允许 `unsafe-eval`。初次浏览器报告的 WebAssembly CSP 拒绝来自 `model-io.mjs` 静态导入的 MeshoptDecoder：Three `libs/meshopt_decoder.module.js:30` 在模块加载时就实例化内嵌 WASM，即使本 fixture 不导入 GLB；不是 picking GPU shader 的依赖。

开发阶段已通过语法检查、JSON/ObjectLoader 回读合同检查和 diff 检查。开发者未运行浏览器；GPU 样例结果由根任务实际点击、诊断和截图确认。未覆盖任意自定义 shader、transmission、宽线、alphaHash/alphaToCoverage 等扩展；不得据此称完整一比一。

2026-10-03 根任务实机反馈：DPR 2 的 fixture Y 对齐后，trusted pointer 在 `[439,284]` 命中 Line、`[348,441]` 命中虚线实段、`[392,441]` 命中空档后景、`[828,360]` 命中 Points、`[848,380]` 命中透明角后景，`[640,655]` 空白清除为 null。截图 `/tmp/freenow-gpu-lines-points-final-20261003.png`。这是合成线的位置对齐，生产线宽未扩大。morph/skin 六探针均通过；动画实心点击的实际诊断为 `time=.8755, playing=true` → `qa-animated, time=0, index=-1, playing=false`。此记录来自根任务已完成的 CUA，未重新测试。
