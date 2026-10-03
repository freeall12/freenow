# 旧互动学习预览本地迁移

补齐 `CURRENT-FUNCTION-GAPS-20261003.md` 的第二项：历史互动学习 board 卡三个图片槽恢复本地显示。入口为现有 `createConversationMigration`，提交复用 `CanvasProjectContext.createConversations().migrateResources` 与权威会话数据库CAS。没有扩展学习评分、模型生成或旧交接授权。

仅处理 `name=show_app/status=done`、无trace/result错误、`kind=mcp_app`、请求和结果URI均为 `ui://tapnow/interactive-learning@v1` 且response.view为board的历史trace。精确槽位只有 `result.response.level.preview_url / learner_preview_url / contrast_url`；未出现的槽不新增。syllabus、queuedMessages、args、appState、任务/恢复日志、来源指纹、handoff和其他App路径均不作递归替换。

生产 `prepareInteractiveLearning` 仍只接受本地data图片。迁移器先复制旧response，只把以上精确旧预览槽临时换为已知本地PNG用于完整shape校验；非预览字段、题目结构、summary和title仍走生产校验。该校验副本不写入候选或会话。非HTTP(S)/合法静态路径、非法Unicode、带凭据、无界或错误data图保持无效，报告 `invalid_learning_preview_record`，不读取本机或远程。

完整原URL按原始UTF-8做SHA256索引，不去查询参数、不调整大小写、不解码/归一化签名。索引只指向受限 `/assets/` 本机静态文件。所有实际字节通过已有 `importIndexedAsset` 的长度、流量预算、SHA256、MIME、同源与禁止redirect校验；生产 `Image.decode()` 验证实际尺寸，最大边8192、最大像素16777216。只允许PNG/JPEG/WebP，最多187476字节，生成canonical base64 data URL最多250000字符。真实解码和字节核对后才写LocalAssets；只有素材持久写入返回真实asset引用才接受data字节。

每张卡原子发布：任意旧槽无精确索引则整张卡三个字段原样保留，报告 `pending_import/local_import_required`，不把已知部分或校验占位冒充正常恢复。全部槽可本地导入后，在实际新response上执行完整生产校验（不使用占位），然后发布只含精确槽的changes。三个大data图仍受生产512KiB整体输入上限，超限不提交。成功后再次迁移仅计alreadyLocal，不重复读取或写会话。已有canonical本地data图保持原样，本批不重新解码其旧内容。

`project-context.js` 新增同样精确路径证明：只接受合法完成trace和已存在的三个槽、本地canonical数据；所有同卡槽修改完后完整校验实际response。候选会话必须与按这些修改构造的expected逐字段相同，否则拒绝。不能顺带改变来源、正文、题目、草稿、保存进度、任务身份、原调用或已交接去重。其他附件与人物白名单没有改变。

CAS冲突最多三次重读权威记录并重新规划；已核本机import按ref/SHA/bytes缓存复用。导入期间本地新草稿会阻止提交；数据库已提交但本地新草稿出现时报告 `local_edits/persisted=true`，不应用旧快照，后续原会话保存链保留新版本。导入/解码/素材保存/会话写入失败不会发布更新；已持久化但会话失败时可能留下未引用本地素材，不伪称数据库和素材联合事务。

## 验证

```sh
node --test tests/interactive-learning-preview-migration.test.cjs tests/interactive-learning-preview-typed-proof.test.cjs tests/actor-preview-migration.test.cjs tests/actor-preview-typed-proof.test.cjs tests/agent-conversation-resource-migration.test.cjs tests/agent-project-context.test.cjs
node --check src/features/local-resource-migration/interactive-learning-previews.mjs
node --check src/features/local-resource-migration/conversations.mjs
node --check project-context.js
node --check src/features/local-resource-migration/qa/learning-previews.mjs
```

新增专项测试覆盖三个精确槽、大小写/签名精确索引、未知整卡保留、SHA/长度/MIME/解码/尺寸/保存失败、严格旧shape、非目标trace、CAS重读、新草稿保护、typed篡改/非canonical/缺槽/部分迁移拒绝。Node测试使用注入解码适配器验证调用顺序与实际字节身份，不能替代浏览器真实解码。

独立QA `/src/features/local-resource-migration/qa/learning-previews.html` 使用生产迁移与会话存储/素材链。已知合成旧卡的三槽映射到既有本机PNG；未知卡有一槽缺索引。只有实际response完整通过生产校验后才真实解码本地图片并显示原官方学习页。刷新回读独立数据库，不清理或覆盖个人数据；没有tools/队列回调，不调用模型，不把fixture当学习结果。本批未执行浏览器或视觉验收。
