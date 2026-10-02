# 图片编辑器字体与增强帮助的本地资源

## 运行路径

`image-editor-fonts.js` 的 `base` 为 `assets/fonts/`。`image-editor-entry.mjs` 的 `loadFont` 固定从该目录读取文件并通过 `FontFace.load()` 加载，没有远程回退。130 个字体名称对应 124 个文件，合计 9,036,964 字节；所有名称均位于 `local` 清单。字体别名共用原有文件，未改字体名称或文档存储。

`image-enhance-ui.mjs` 两个指南仍以链接 tooltip 打开新标签页，目标为 `help/image-enhance.html#image-upscale` 和 `#image-realistic-portrait`。帮助页面不加载脚本、外部样式、字体、图片或统计资源。正文以当前参数、原有说明及已接供应商合同为准，明确 fal 的 2x/4x、6x 与 Magnific/皮肤增强边界。

## 历史来源与开发采集

来源版本：`955f12545825932389f4e873a824a9c5dcd3fbd0`。原始字体基址：

```text
https://fe-assets.tapnow.media/955f12545825932389f4e873a824a9c5dcd3fbd0/assets/fonts/
```

这只记录原始文件来源，不是应用运行依赖。原始清单与采集结果见 `reference/image-editor-font-menu-live.json`、`reference/image-editor-font-downloads.json` 和 `reference/image-editor.md`。

`scripts/localize-editor-fonts.py` 是手工开发采集工具，不在启动、构建或应用运行链中。它复用已有字体；只有缺失文件才请求脚本内明确标注的历史来源 URL。没有字体缺失时无需执行该工具。运行环境中缺失或损坏的字体会显示读取失败，不会请求该 URL。

原指南导航来源（只保留在开发文档）：

```text
https://docs.tapnow.media/en/docs/image-creation/image-upscale
https://docs.tapnow.media/en/docs/image-creation/image-realistic-potrait
```

以上地址及采集脚本的历史来源均不提供给产品指南入口。

## 定向检查

2026-10-03 定向核查：

- 124 个文件全部存在、大小大于 100 字节且文件签名属于 WOFF/WOFF2/OTF/TTF；130 个名称均有本地文件。124 个实际本机 HTTP 路径均返回 200 且长度匹配。
- 浏览器关闭缓存后，124 个实际 `FontFace.load()` 全部解码成功；资源计时中 124 个字体条目均来自当前本机 origin、`transferSize > 0`。CDP 事件缓冲只保留 121 条请求并提示截断，因此以完整资源计时记录补核；未将截断记录当作完整网络证据。
- 增强参数与请求 Node 回归 6/6；相关语法检查、`git diff --check` 通过。
- 在既有增强 QA 页通过键盘切换两个标签，实际点击指南 tooltip，分别打开上述两个本机新标签页；帮助目录的皮肤锚点导航通过，桌面与窄标签页排版已查看。
- 既有增强 QA 运行至 24/25 项通过，本地指南断言通过。之后“缺失 API”断言失败：该旧 fixture 的生成历史和生成请求报 `Cannot read properties of undefined (reading 'resolve')`。后续生成断言未运行；本批未改该 fixture 的生成加载链，不能声称整套浏览器增强回归通过。

以上只验证本批字体与指南入口，未作为整站网络验收。

相关参数与请求回归命令：

```sh
node --test tests/image-enhance.test.cjs
node --check image-editor-fonts.js
node --check image-enhance-ui.mjs
```

实际图片增强仍依赖操作者配置的模型服务；查看帮助、图片编辑器字体加载不依赖原站服务。
