# 旧人物情绪卡的本地参考预览

主入口仍为 Agent 聊天记录菜单 →「迁移本地附件」。只在显式点击时迁移；不会后台自动改写旧卡。

这次仅新增一种精确槽位：合法 `done show_app` 且请求/结果 URI 均为 `ui://tapnow/actor-emotion@v1` 的 `chats[].messages[].result.response.actor.reference_nodes[].preview_url`。先验证人物应用 response 合同，再通过完整原 URL 的 UTF-8 SHA-256 精确索引找到本机 `/assets/` 字节。未知引用保留并以安全路径/错误码报告，迁移不会请求原 URL。

协议识别接受 schema 已支持的大小写形式（例如 `HTTPS://`）；计算索引 SHA 时始终使用完整原始字符串，不规范化协议、域名、路径或查询。独立复核发现的大写协议误拒绝已修复，新增精确大写映射回归单独通过。复核者原大小写双 fixture 也已确认：各自只有原字符串 SHA key，均 `changed:1 / unresolved:0 / read:1 / put:1`，保存的 data URL 字节准确一致，原记录未变，仅读取本机 `/assets/a.png`。

共享导入器有界读取并核对索引的 SHA、准确字节数和 MIME，禁重定向。专用 helper 仅允许 PNG/JPEG/WebP，输入最多 374976 字节；浏览器通过 `Image.decode()` 真实解码，尺寸需为正整数、单边最多 8192、总像素最多 16777216。通过后才写入本地素材，并以原字节生成不超过 500000 字符的 canonical data URL 保存到人物预览字段。该字段与官方页面不接受 `asset:`，因此不会把库引用直接当作 `<img src>`。损坏图片、类型、字节、容量、尺寸或保存错误会阻止权威记录发布。

`createConversationMigration` 复用同一操作中的已核验预览，CAS 冲突重读后重算；`project-context.js` 仅允许该精确 typed 字段改变，再以整个记录比较证明其他内容未改。原工具参数、`node_ref`、`actorSourceContext.sourceSnapshots`、`actorExpressionGuide`、`appState`、任务身份及恢复 journal 原样保留。不重新绑定已变化的画布或授权应用操作；来源守卫失效仍须重新打开实际应用。

新人物卡的 `actor-guide-runtime.prepareAppArgs` 原本已从真实图片派生本地预览，这次补齐旧远程卡的显示迁移。其他 App 的 response、source fingerprint、Previs 纹理与恢复收据不属于本次槽位；不得按通用 `image/url` 字符串递归替换。

## 验证入口

```sh
node --test tests/actor-preview-migration.test.cjs
```

浏览器打开 `http://127.0.0.1:4173/src/features/local-resource-migration/qa/conversations.html`，依次点击「初始化独立测试记录」→「添加 QA 旧人物卡」→「迁移测试附件」→「刷新页面复验」。既有独立 QA 记录保留，新按钮只追加合成旧卡，不触碰个人会话，不执行工具或生成媒体。已知完整测试 URL 映射到 `/assets/agent-casting.png`（15288 字节，SHA-256 `d63945ac11cccff5ab24f9ca08479576f09d5c4d3a214dbdfd7c3278d82daf76`）；未知测试 URL 原样保留。QA fetch 适配器只允许这个本机路径，官方人物 iframe 使用生产 host/card/proxy 读取保存的 data URL。

Node 测试注入解码适配器检查核验、持久化、失败与 CAS 行为；真实 `Image.decode`、官方参考图显示和刷新恢复需以浏览器验收确认，不能由测试通过代替。

2026-10-03 根任务完成独立 QA 的真实浏览器验收：保留已有 3 项本地附件，追加合成旧人物卡后显式迁移，报告 `changed:1 / unresolved:2 / alreadyLocal:3 / persisted:true`；本地素材读取 1 次、原地址读取 0 次。生产 host/proxy 的双层 iframe 中，人物参考 `<img>` 来源为 `data:image/png`，真实解码尺寸 200 × 200，灰模画布 512 × 512。刷新重开后仍保持相同来源与尺寸。截图：`/tmp/freenow-actor-preview-migration-20261003.png`。

未知附件与第二个人物参考仍待本地导入，没有改写其原引用。此次只操作隔离 QA 数据库，未修改个人会话；合成旧卡和本机 PNG 不代表模型结果，也未验收应用确认、真实生成或其他 App 媒体迁移。
