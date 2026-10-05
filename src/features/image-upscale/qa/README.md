# Magnific 原生接口隔离验收

```sh
env -i PATH=/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin node src/features/image-upscale/qa/server.cjs 0 agent
```

打开输出 URL；停止使用终端 Ctrl-C 或 `kill -TERM <输出 PID>`。仅监听随机独立 `127.0.0.1` 端口，退出清理临时任务与媒体目录。没有加载真实环境、Key、用户项目或素材库。浏览器偏好在内存，IndexedDB 使用 `qa-magnific:<session>:` 前缀。URL 可更换 `session` 开始独立验收。

使用正式 `index.html`、ImageEnhance、GenerationUI、TaskService、路由网关、Magnific 适配、完整原尺寸 PNG 校验、结果完整解码、本地归档和画布保存。供应商 POST/GET 及公开 HTTPS 结果下载边界是可信 Node 构造钩子中的固定合成响应，不绕过正式图片验证。512×320 合成陶瓶是输入，768×512 合成图片是固定结果，与所选倍率无关；不得把它当作真实模型效果或倍率验收。

操作步骤：

1. 点击左侧夹具「打开正式 Magnific 放大」，在正式面板操作锐化、颗粒、细节、倍率四个滑杆。原 UI 范围保持三项 0–100、倍率 2–8。
2. 「未配置 / 合成原生接口已配置」切至未配置，确认正式生成禁用、供应商 POST 不增加，再切回已配置。
3. 「下一次保存失败」后用正式生成按钮提交；结果待保存时点击正式「重试保存增强结果」。POST、增强节点与版本数量不增加，保存尝试增加。
4. 「下一次状态未知」后提交；正式面板显示「查询原增强任务」。先点击查询确认仍为 unknown，再点击夹具「释放原任务结果」，最后点击正式查询取得成功。供应商 POST 不增加，GET 始终查询同一原 UUID。
5. 「延迟下次配置」后触发配置检查，切换完整来源或关闭面板，再「释放迟到配置」，确认过期准备不提交。
6. 带 `agent` 启动会在正式 Agent 客户端之前加载固定本机回复。「Agent 新增强节点」或「Agent 写回当前增强」设置目标；「Agent 四参 3/14/29/41」设置明确四值。打开正式助手、发送任意文本、查看真实审批卡并批准。Agent 模型回复固定，正式审批、原任务 ID 持久回执、媒体、生成与保存仍用生产链路。

左侧审计显示四参数、POST、GET、原 UUID、来源字节/尺寸摘要、结果下载、任务状态、版本、保存尝试、入边、Agent 持久派发回执、独立数据库及被拦截外部请求。HTTP 审计：`/api/generation/fixture-audit`。控制：`POST /api/generation/fixture-control`，正文 `{"unknown":true}` 为下次任务原状态读取不可用；`{"releaseUnknown":true}` 释放。API/下载严格匹配固定 HTTPS origin、方法、路径和合成认证；未声明流量直接拒绝。

```sh
env -i PATH=/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin node --test src/features/image-upscale/qa/server.test.cjs
node --test tests/image-magnific-frontend.test.cjs
```

HTTP 合同测试不等于浏览器交互验收；本文件不声明真实供应商效果或实际收费通过。刷新只能用于检查同端口同 session 的本机画布/素材持久化，不能以浏览器内存任务索引声称 TaskService 跨刷新恢复。
