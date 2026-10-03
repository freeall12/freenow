# HTML作品本地预览与派生导出

原作品正文、artifact_path和revision继续由现有store保存；此功能不修改存储schema，也不把资源转换后的HTML回写原文。

`local-export.mjs`建立绑定原路径/版本/完整正文的会话。首次准备惰性调用共享 `local-resource-migration/html-document.mjs`，从实际本地资源或可信索引核对媒体后转为data URI。原始外部脚本、样式或未知媒体按共享诊断明确返回待修复，显式导航被禁用并记录诊断；不能通过挡图声称导出完成。预览显示已准备部分和具体诊断位置，下载只有status:ready才可用。

派生下载包含完整外层HTML及 `sandbox="allow-scripts"` 内层srcdoc，保留内联交互和全幅画框。外层CSP的frame-src仅允许about:，阻止内层脚本或meta刷新把iframe导航到HTTP(S)、data或blob文档；内层仍使用共享解析器提供的资源CSP。没有allow-same-origin、表单、弹窗或顶层导航权限。这是本地派生展示合同，不把内联脚本warning解释成已分析任意运行逻辑；实际浏览器的交互、导航阻断及下载内容仍须验证。

## 调用

```js
const preview = openHtmlPreview({
  file,
  getCurrentFile: () => store.get(file.artifact_path),
  isCurrent: () => sameChatAndTrace && !pageLeaving,
  // 可选，仅用于已有宿主资源服务或确定性验收：
  getResourceOptions: signal => ({index, assets, fetchImpl}),
});
await preview.ready;
```

getCurrentFile必须读取真实完整文件，不能返回伪造旧快照。准备前后、复用结果及下载前均核对路径、revision、内容和当前来源。关闭会Abort；资源读取晚到、来源离开、文件删除或替换版本不会生成下载。panel在切换文件/关闭/相关store变更时关闭旧预览。未提供版本读取接口时明确失败。

默认资源接口只读本地 `/assets/local-resource-index.json` 和现有LocalAssets；不上传原HTML、不写入新资源、不会尝试补抓原站。每次材料化基于原文；原媒体引用和来源在原artifact保留。未知来源、缺失本地素材、解析器不可用或容量超限显示实际诊断位置，需要补本地资源后重开。

## 确定性验收

`/src/features/agent-artifacts/qa/local-export.html`使用生产store/panel/preview及共享转换模块。独立产物IndexedDB，显式保存本地SVG Blob并保留asset:原文，预览/下载由实际读取bytes派生；可点计数交互、尝试原站导航、下载、刷新核对原文。未知远端图片应显示位置并禁用导出；延迟准备期间关闭应取消迟到结果。未调用模型或原站。此页不清理任何存储。

```sh
node --test tests/agent-artifact-local-export.test.cjs
node --check src/features/agent-artifacts/local-export.mjs
node --check src/features/agent-artifacts/html-preview.mjs
node --check src/features/agent-artifacts/panel.mjs
node --check src/features/agent-artifacts/qa/local-export.mjs
```

会话绑定与包装测试检查派生内容、缓存重验、未配置读取、未知诊断、关闭/替换版本迟到拒绝和属性转义；不会把这些静态检查当作真实浏览器离线或互动验收。无法材料化的来源明确阻止导出；任意脚本行为、完整同视口视觉和真实项目内容需分别验证。

## 本轮实际浏览器验收

根Agent使用原始验收页真实操作：本地图片显示，内联计数按钮0→1。点击下载时浏览器工具的download event等待超时，但随后核对实际 `/Users/laplace/Downloads/离线互动.html` 文件存在、2336bytes；不能把事件超时等同下载失败。实际文件含嵌入SVG data URI、opaque sandbox iframe和外层frame-src about:，不含原asset引用。

根Agent将这份实际下载文件复制到被Git忽略的QA路径并重新在浏览器打开：图片显示，计数0→1。源验收页刷新后仍为revision1且正文保留原asset引用，派生导出未覆盖原作品。未知远端图片页面显示待修复并禁用下载。

点击作品内尝试原站导航按钮时，外层CSP阻断目标导航；内部iframe变成浏览器错误页，原交互内容不会自动保留。根Agent已关闭并重新打开预览恢复。该行为只证明本次导航被阻断，不能描述为「阻断后页面保持原样」或自动恢复。这里记录的是确定性本地产物检查，未调用模型；全部脚本/导航变体、完整视觉与其他用户作品仍未逐项验收。
