# 皮肤编辑器隔离验收

```sh
env -i PATH=/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin node src/features/image-skin/qa/server.cjs 0 pipeline agent
```

打开输出 URL。使用正式 `index.html`、`image-enhance-ui.mjs`、TaskService、共享媒体处理和项目保存入口。没有重写或模拟皮肤面板逻辑。

- 不传 `pipeline`：浏览器配置和任务 HTTP 合成边界，用于交互、缺配置、迟到配置和 unknown 恢复。
- 传 `pipeline`：正式 routed 网关、`skin-tasks-v1`、原尺寸 PNG 校验、临时任务归档与结果本地化；仅独立皮肤服务器 HTTP 边界为合成响应。不得把合成图片当作真实皮肤效果。
- 传 `agent`：加载 Agent owner 的固定本地模型回复夹具，正式审批和工具链仍由生产代码执行。

不加载真实环境变量、Key、项目或素材库。浏览器偏好放在内存；IndexedDB 使用独立 session 前缀，默认 `skin-frontend-1005`。仅同端口、同 session 刷新能验证结果/画布持久化；内存任务索引不用于声称跨刷新 TaskService 恢复。

检查步骤：打开正式皮肤编辑→模式菜单/重度警告/键盘/tooltip→未配置不提交→准备关闭/改完整来源后释放迟到配置→保存失败后点击面板“重试保存增强结果”→unknown 后先点击“查询原增强任务”确认仍为 unknown，再点击夹具“释放原任务结果”，最后点击正式“查询原增强任务”取回成功。记录前后 POST、节点、版本和 save 次数。完整成功结果应回填相同增强节点，保持一条原入边。

`/api/generation/fixture-audit` 显示合成供应商 POST/GET、模式、原来源字节数和归档条目，未包含 Key。`fixture-control` 仅用于下一次 POST 回执 unknown，原 GET 保持 unknown，直到显式 releaseUnknown:true 释放；随后查询原 ID 返回同一合成结果。

```sh
env -i PATH=/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin node --test src/features/image-skin/qa/server.test.cjs
node --test tests/image-enhance.test.cjs tests/image-skin-frontend.test.cjs
```

具体运行结果与浏览器验收边界见 `docs/SKIN-EDITOR-FRONTEND-20261005.md`；在尚未运行前不把本文件当作验收通过证据。
