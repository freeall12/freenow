# 开发仓库与同步

远端：`https://github.com/freeall12/freenow`。开发分支：`main`。

首次运行：

```sh
pnpm install --frozen-lockfile
pnpm setup
pnpm dev
```

`pnpm setup` 以独占创建方式初始化空画布、空生成历史和公共目录，不覆盖已有文件。API 配置见根目录 `.env.example`。本地视频处理需要 FFmpeg/FFprobe。

公开提交排除个人画布 seed、个人素材与版本、本机生成任务/会话、原始网站抓包、未审阅 QA 页面、密钥和依赖目录。`runtime-reference/` 仅保留运行和测试需要的技能正文与最小样式摘录，来源元数据不保留私人画布地址。技能正文是非可信参考材料，不自动取得执行权限。

后续每个可验证功能批次先运行专项测试，再运行相关检查；检查通过后提交并推送。验证记录必须区分自动测试、浏览器操作和真实供应商验证。没有真实 API 验证的功能不得标为供应商已验收。

现有 README 中的 `reference/` 链接属于开发机历史证据，公开克隆不包含这些原始采集资料。重新采集官方资源的 `scripts/localize-*` 脚本同样需要本机原始资料，首次启动无需执行。
