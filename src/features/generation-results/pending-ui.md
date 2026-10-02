# 生成节点等待状态

在 `CanvasApp` 与 `GenerationAPI` 建立后安装：

```js
import('./src/features/generation-results/pending-ui.mjs').then(({install}) => install());
```

`install()` 自动加载同目录 `pending-ui.css`，相同 CanvasApp 重复安装返回原实例。返回 `{refresh(), destroy()}`；销毁移除监听、等待层及视频资源，保留已加载样式。模块不创建任务，不修改节点数据，不调用生成服务。

状态来自 `pendingOperation: '<type>.generate'` 加 `generationRun.runId/requestId`，或 GenerationAPI 的对应真实 `image/video/text.generate` queued/running 任务。已有 job 的失败、取消、未配置和应用错误优先于残留占位。succeeded 仅在实际 applying 期间继续显示。批次已规划目标由 generationRun 标记管理，撤销或应用后不会被旧任务重新显示；保留原图时原节点不显示结果占位的动效。

图像与视频采用官方 `reference/canvas-current-readable.js:16252–16566` 的 Op 内联 CSS，所有噪声 SVG、遮罩、扫光、burst 和 reduced-motion 分支直接复制。自己的媒体保留在下层；自己没有媒体时，按输入边顺序使用首个图像或视频父节点作为模糊背景。没有媒体时使用官方空背景。不会新增百分比、取消按钮、预计时间或图标。

文本采用官方 31749 的三条骨架：宽度 100%、2/3、1/3，高 8px，间距及内边距 8px；颜色、圆角和 pulse 来自官方 CSS 的实值。原正文暂时隐藏，生成结束后恢复同一正文 DOM；等待时禁止正文双击编辑。reduced-motion 关闭文字 pulse。

等待层局限于 `.node-body`；标题、连接口、节点坐标及选中轮廓不变。正文、现有占位内容不会透出等待层。仅单选真实等待节点时，body 添加 `data-generation-pending-selection`，通过 CSS 隐藏 `#node-toolbar`；选择改变、结束或 destroy 时清理。使用 visibility 保留浮层位置计算，避免别的 render 写回 hidden=false 后复活。底部生成按钮 disabled 等由各自组件处理。尚未接入图片新图解码等待后的 1600/1400ms 外层转场；当前只复用 Op 本身，不把这部分宣称为完整图片成功转场。

`canvas:render` 的 viewportOnly 事件完全跳过。普通拖动仅读取节点数据及缓存 shell 身份，不重建等待层、不重复 querySelector、不重启动画。结构变化和 shell 替换会重新挂载。GenerationAPI.subscribe 直接触发刷新；没有轮询或逐帧循环。背景 LocalAssets.url 的异步返回受实例存活检查，移除后的媒体不会复活。

验证：

```sh
node --test tests/generation-pending-ui.test.cjs
```

覆盖状态身份、残留标记、撤销及保留源、父媒体、拖动/缩放复用、正文恢复、节点重建、异步媒体清理、官方 CSS 原文一致性。不含错误覆盖层，也不将 `applicationError` 当作官方 `taskInfo.error`。
