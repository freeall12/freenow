# 画布复刻组件库

入口：启动项目后访问 <http://localhost:4173/component-library/>。目录页列出已实现模块、源文件、调用入口与复用条件，并提供菜单和提示的交互预览。

## 复用层级

| 类型 | 入口 | 使用方式 |
| --- | --- | --- |
| 基础交互 | `ui.js`、`ui.css` | 普通 `<script>` 加载后使用 `window.ReplicaUI`；不依赖画布 |
| 画布逻辑 | `core.cjs` | Node/CommonJS 项目 `require('./component-library/core.cjs')`；不挂载 DOM |
| 媒体逻辑 | `media.mjs` | ES module `import * as media from './component-library/media.mjs'` |
| 功能界面 | `features.mjs` | 统一打开搜索、媒体预览、图片/视频工具、片场和 Agent；需要画布宿主 |

基础菜单已经用于画布右键操作；提示组件已经用于画布工具按钮。抽取后原入口保持不变，避免复制两套实现。

```html
<link rel="stylesheet" href="component-library/ui.css">
<script src="component-library/ui.js"></script>
<script>
  const menu = ReplicaUI.createMenu({
    element: document.querySelector('#my-menu'),
    label: '文件操作',
    onError: error => console.error(error)
  });
  menu.show(120, 80, [
    { label: '打开', key: '↵', run: () => openFile() },
    null,
    { label: '尚不可用' }
  ]);
  // 页面卸载时：menu.destroy()
</script>
```

`createMenu` 返回 `show(x, y, items)`、`close(restoreFocus?)`、`destroy()` 和 `isOpen`。菜单项的 `run` 可以返回 Promise；异常交给 `onError`。空项表示分隔线，未给 `run` 的项禁用。键盘支持上下、Home、End、Escape 和 Tab。

```js
const tips = ReplicaUI.createTooltip({
  root: document,
  selector: 'button[data-tip]',
  delay: 180,
  canShow: () => !menu.isOpen
});
// 页面卸载时：tips.destroy()
```

提示从 `data-tip`、`data-tooltip` 或 `aria-label` 取文字；支持自定义 `place(button, rect, size)`。功能界面需要先提供 CanvasApp、节点类型、图标、存储及对应服务接口，不能仅复制单个 UI 文件。目录中的“需画布宿主”表示现有实现可作为功能模块复用，尚不是零配置独立控件。模型生成和云端能力沿用项目的可替换接口，不由组件库伪装为已配置。

在已挂载原画布的页面中，可以从统一入口调用功能界面：

```js
import { openNodeSearch, openMediaPreview, openImageTool, openVideoTool } from './component-library/features.mjs';

openNodeSearch();
await openMediaPreview(imageNodeId);
await openImageTool('crop', imageNodeId);
await openVideoTool('trim', videoNodeId);
```

图片工具名：`crop`、`resize`、`angle`、`relight`、`enhance`、`outpaint`、`erase`、`redraw`、`annotate`。视频工具名：`trim`、`extend`、`reshoot`、`mask`。节点 ID 必须在当前画布中存在且类型匹配；其余宿主依赖见目录页源文件。
