# HTML 历史资源的只读本地派生

模块：`src/features/local-resource-migration/html-document.mjs`。它保留原文，只返回用于预览或导出的派生 HTML；不更新 artifact、Widget、会话或 AssetStore。

## 调用合同

```js
const result = await localizeHtmlDocument(originalHtml, {
  document,
  index,                      // validateResourceIndex 接受的精确 SHA-256 来源表
  assets: window.LocalAssets, // 只调用 read(asset) 或 url(asset)，不会调用真实 put
  fetchImpl: window.fetch,
  signal,
  expectedSourceHash,         // 可选：原始 UTF-8 HTML 的完整 SHA-256
  policyTarget: 'artifact',   // 或固定 'widget'；不能传任意 CSP
});
// {html, sourceHash, status, diagnostics, summary:{slots, embedded, unresolved}}
```

两阶段接口为 `prepareHtmlDocument(html, options)` 和 `materializeHtmlDocument(prepared, options)`。prepare 只惰性解析与计算原文哈希，返回冻结的 `{sourceHash,resourceCount,diagnostics}`；正文由模块内部 WeakMap 持有，prepared 不是可序列化或跨模块实例的任务记录。materialize 每次从同一原文重新派生，失败后的重试不会消费已改写正文。组合入口 localize 接受所有选项。

`hasHtmlResourceSlots(html,{document})` 是同步、保守的惰性检测：明确媒体槽、外部脚本/文档/链接、CSS URL/import/image-set/转义均进入异步处理；纯内联脚本与没有资源的 CSS 可保持原同步 Widget 握手。无法可靠解析时返回 true。

`ready` 仅表示可静态识别的资源已完成本地嵌入，没有未解决的静态资源边界；不证明内联代码已经执行验证。`pending_import` 表示至少一项 error。diagnostics 为 `{path,code,severity:'error'|'warning',sourceHash?}`，只含结构位置、固定代码和完整来源哈希，不含原 URL、名称、正文或签名。summary.unresolved 为 error 数量，不等于唯一缺失文件数量。

## 解析、读取和权限

- 原文在 `template.content` 的无浏览上下文文档中解析，以 html fragment context 保留真正 head/body 和属性；不插入活动页面、执行脚本或先加载资源。普通开头的 html 属性单独用惰性属性解析器保留。DOMParser 不用于解析未知原文。
- 明确资源槽覆盖 img/src/srcset、video/audio/src、source/src/srcset、video/poster、SVG image/href 与 xlink:href，包括嵌套 template 内容。支持常用单个 w/x srcset 描述符，不能解析的候选列表给出 srcset_invalid。
- HTTP、相对路径等来源只按完整字串 UTF-8 SHA-256 查表，不能裁掉签名或匹配文件名。本地 `/assets/` 必须在可信索引中。复用 importIndexedAsset 校验 MIME、长度、SHA 和同源 redirect:error 流读取；该调用的 put 是临时内存回调，不写真实 AssetStore。
- `asset:` 通过只读 `assets.read(id,{signal}) -> Blob` 或现有 `assets.url(id) -> blob:` 读取。url 返回 HTTP/data/任意非 Blob URL 一律拒绝。Blob 流读取受预算约束；不任意抓取历史 blob 来源。已有 image/video/audio data URL 保留并做类型及长度预算检查。
- 默认每项预算 20 MiB，总唯一读取字节预算 60 MiB；可注入 maxBytes/maxTotalBytes，分别上限 100/200 MiB。`hashSource` 和 `hashBytes` 可用于受控测试；生产使用 WebCrypto。
- CSS 通过构造 CSSStyleSheet.replaceSync 获得浏览器 CSSOM，然后解析其声明中的 URL token并按属性位置替换。可注入 `parseCss(text)->{cssRules}`，测试使用已有 cssom 依赖，不新增生产依赖。CSS 解析与字节读取均不连接样式表到活动文档。
- CSS @import、外部 stylesheet、font-face、image-set、解析丢失或不支持的规则给出 error，不以正则全局替换宣称完成。CSS 中作为文字的 `"url(...)"` 不当作资源。未知媒体保留在派生正文中，但由最前真实 head CSP 阻止；消费者不能在 pending_import 时宣称离线资源完整。
- 派生文档清除旧 CSP、base、显式外部导航与刷新；外部脚本和嵌套文档禁用并给 error。未知 SVG use/feImage、input-image 等超出明确槽的资源给 error。内联 JS/事件保留并给 dynamic_code_uninspected warning，未尝试分析代码中的动态 URL。

默认 artifact 策略只允许内联脚本/样式及 data 图片/媒体，connect/frame/object/form/base 全禁。固定 widget 策略只为图片/媒体额外保留既有 blob 权限，使白模和本地录像预览可用；不扩展网络权限。**页面 CSP 不等于禁止自身导航**，消费者必须在 opaque sandbox 中运行派生正文，并由外层策略阻止子 frame 转到外部页面；独立 HTML 导出也须使用这个包裹。

## 绑定、失败和验证

模块不决定 artifact_path/revision、chat/trace、frame generation 或 nonce 权限。消费者在异步完成后仍必须校验这些字段与原 code/content 一致，使用 sourceHash 绑定原文，取消或丢弃过期结果。不要用正文完整哈希代替宿主身份/版本检查。资源缓存失效由消费者结合当前索引和 asset adapter 执行；模块缓存只存在于单次 materialize。

输入/预算不合法抛 html_input_invalid；没有惰性解析能力抛 html_parse_unavailable；原哈希不匹配抛 html_source_changed；无效索引抛原索引验证错误。AbortSignal 抛取消原因。资源读取失败、未知来源和 CSS 不完整返回位置诊断及 pending_import，不返回静默 ready。

```sh
node --test tests/html-document-migration.test.cjs
node --check src/features/local-resource-migration/html-document.mjs
```

专项 9 项通过，验证零自动资源加载、原哈希/无私有诊断、八类资源槽、typed asset/Blob 转码、CSSOM 与未支持边界、失败重试、预算、取消，以及真正 head CSP 和 widget Blob 权限。JSDOM 及注入 CSSOM 不能替代真实浏览器 CSSStyleSheet、下载后的导航隔离、Widget 白模录像或视觉验收。本模块没有执行浏览器或用户存储验证。
