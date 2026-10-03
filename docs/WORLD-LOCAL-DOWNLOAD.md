# 世界模型只读本地下载

`WorldNode` 工具栏下载继续调用 `world-node/resource.mjs:download`，但不再把模型来源直接赋给 `<a href>`。旧独立 HTTPS 地址也可能让跨源 download 变为导航并跟随跳转，因此现在只接受同源可信 `/assets/`、耐久 `/api/generation/media/<UUID>`、当前源 Blob、可信 asset 解析及模型/二进制 base64 data 引用。

asset 解析后的实际地址再次检查；读取使用 `redirect:error`，异常 redirected/改变响应来源拒绝并取消流。复用既有有界 12 MiB 模型读取与取消合同，保持原字节和文件名；只有读取完成生成的本地 Blob URL 才进入下载链接。远程旧记录原样保留，提示迁移或重新导入，不通过下载访问原站或远程供应商静态文件。

```sh
node --test tests/world-local-download.test.cjs tests/world-materialization.test.cjs
node --check src/features/world-node/resource.mjs
```

4 项专属下载回归及 12 项相关模型回归通过。覆盖本地引用、远程/原站/异源 Blob 的零读取拒绝、重定向响应取消、超量/取消及实际 Blob 下载链接与原字节。独立复核发现大写 DATA: 被原生 fetch 规范化后误判跳转，已仅规范化协议、不改 base64 字节；原生 data fetch 的大小写同字节回归追加到原专项并通过。不新增依赖，不改 UI/品牌，不写用户存储。

可公开复现的隔离浏览器入口：`/src/features/world-node/qa/local-download.html`。通过 import map 和绝对路径加载完整生产模块；“下载本地模型”读取已有 `/assets/studio/library/bicycle-city.glb` 并生成 `local-bicycle.glb`；“拒绝旧远程模型”使用 `.invalid` 来源。页面不操作画布、会话或数据库。

主线程已用 Computer Use 实际验证同页临时入口 `/qa/world-local-download.html`：先拒绝旧远程模型，显示 media_localization_required、本次读取 0；再下载本地模型，读取 1。实际下载到 `Downloads/local-bicycle.glb`，1,055,520 字节，SHA-256 为 `829c5016658a857aad64056b9aa4a9071ed75cff74e040cdc6e2c9c23200614f`，与本地来源文件完全一致。截图 `/tmp/freenow-world-local-download-20261003.png` 留在开发机，临时页面已关闭。之后将同一页面复制到上述 tracked 目录，脚本绝对路径保持不变，没有重复测试或据此扩大其他 3D 功能的完成声明。
