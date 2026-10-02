# 官方互动学习页接线合同

依据：未修改的 `resources/apps/interactive-learning@v1.cd0bb18c.html` 与 `reference/vendor-packages-CN3JnHbF.js` 的 `Bue/rg/Aae/as`。官方 `bm/m_/p_` 定义状态，`f_` 清理并截断答案，`v_/__` 输出IL1；官方源码没有输入schema，因此下述字段来自实际渲染与发送逻辑，数量和长度上限为本地边界，并非宣称官方限制。

Purpose：显示实际课程目录或单关学习板，完成观察、选择、挖空、反推、改编五题；持久保存草稿与页面完成标记，将目录跳转、点评、生成请求、过关或暂停通过正常Agent用户回合交接。

Inputs：`prepareInteractiveLearning(data,title?)`。data只允许 `view/locale/course/chapters/level`；locale支持中/英/日/韩/法，默认中文，title默认「互动学习」。

目录示例：

```json
{"view":"syllabus","locale":"zh-CN","course":{"title":"本地光线练习","creator":"实际来源作者","total_nodes":2},"chapters":[{"label":"第一章","locked":false,"levels":[{"key":"L1.1","title":"逆光与主体","why":"学习光线与构图","state":"current","done_questions":[]}]},{"label":"第二章","locked":true,"levels":[{"key":"L2.1","title":"色彩对照","why":"下一关","state":"locked","done_questions":[]}]}]}
```

chapter可有note，最多20章、共100关；key为 `^[A-Za-z0-9][A-Za-z0-9._-]{0,47}$`。state只能locked/current/done；locked不带进度，done必须五题全标记，current最多四题；最多一个current，锁章内只能locked。目录没有题目正文或下一关学习板，不得从摘要虚构。

学习板示例：

```json
{"view":"board","locale":"zh-CN","level":{"key":"L1.1","title":"逆光与主体","why":"练习提示词","media":"image","creator_prompt":"雨后街道，人物逆光，低角度镜头","questions":{"q2":{"stem":"哪个词控制光线？","options":[{"text":"逆光","correct":true},{"text":"低角度","correct":false}],"explain":"逆光控制光线相对主体的方向"},"q3":{"parts":["人物","，","镜头"],"blanks":["逆光","低角度"],"bank":["逆光","低角度","高角度"]},"q4":{"stem":"按真实观察写提示词"},"q5":{"stem":"改成骑车的人","formula":"主体 + 光线 + 构图"}},"hints":{"q2":["想想人物边缘光"],"q3":["光线和相机分别控制"],"q4":["写可确认的观察"],"q5":["保留光线与构图"]}}}
```

level可有node_title、params、retries、done_questions、start_at及preview_url/learner_preview_url/contrast_url。media是image/video；video只显示目标起点图，不能把预览当作实际视频播放。questions包含q2–q5；选择题2–12个唯一选项、恰好一个correct。挖空题1–12个空，parts比blanks多一个，blanks都在唯一bank内；bank最多36词，重复答案允许。各题提示最多4条；q2/q3少于4条时官方补一条答案提示。hints内缺少的题默认空数组；q4/q5没有提示时官方不显示自评按钮。输入总UTF-8最多512KiB；creator_prompt最长4000、题目/提示2000、草稿2000 UTF-16字符。未知字段、工具/权限、其他业务数据拒绝。

Outputs：准备后的官方response有title/summary/view/locale和目录或level。`initialInteractiveLearningState(response)` 在目录返回null，在学习板返回真实官方初始state（q3初始显示时初始化空位）。`validateInteractiveLearningState(state,response)` 校验 `{done,cur,hintShown,clozeFill,drafts}`：done按q1–q5稳定顺序，不能撤销来源已完成标记；hintShown为q2–q5的实际提示计数；clozeFill为null或对应长度的bank词/null；drafts只保存q4/q5字符串。

`resolveInteractiveLearningReply(message,response,savedState)` 是异步函数，返回 `{kind,text,metadata,result?}`。kind为go/replay/review/generate/next/skip。目录只接受实际未锁关卡的官方go消息。学习板ask=q4/q5绑定已存drafts和done；next必须已存五题全完成；暂停只接受当前locale的准确官方文案。全部IL1及summary严格匹配，无任意前后缀。

官方答案协议会换行压空白、清除`;|=`、截断前300 UTF-16字符，使用原始文本而非百分号编码。交接只使用实际发送答案；不会从已存长草稿偷偷补全。截断拆开emoji时本地拒绝非法Unicode。稳定SHA256 handoffId基于实际action、来源题目与提交内容；导航/提示展开不影响去重。review/generate保留实际creator_prompt、题目、目标/学习者/对比图片；读取图片和模型结果仍须实际工具回执。

Permissions：`ui://tapnow/interactive-learning@v1` 的官方policy为 `{allowExpanded:false,autoExpandOnReady:false}`，正常64KiB状态上限。官方csp只给 `interactiveLearningImageDomains` 导出的9个TapNow图片域；proxy原本支持data/blob图片。helper只接受这些HTTPS来源或PNG/JPEG/WebP data图，不额外开放媒体/网络/tools/call。保留现有source/nonce/当前用户动作、会话trace和来源guard；学习进度不能扩大工具权限。

Failure modes：官方 `je` 延迟400ms保存，`p_` 吞保存错误，`Hn` 在提交前不flush。宿主必须真实等待stateWork事务提交，resolver必须读trace.appState，不能把当前展示当成已保存。刚输入立即提交可能因最新草稿未保存而拒绝，需等待保存再重试。官方q2/q3正确答案可本地标记，q1及其他题允许自评；保存状态不含选择正确性历史、模型评分或真实生成回执，因此done只能表示页面检查或自评标记，不能证明学会。点评和生成请求不会自动完成q4/q5。

Logging：持久保存show_app来源response、已提交appState、原IL1+可读交接、handoffId/widgetOrigin及真实队列回执。失败回滚，切换会话/trace/iframe代次或保存状态发生变化时拒绝旧回执；存储提交后仍需核对来源并补偿撤回失效队列。

## 共享宿主接线

1. registry新增URI、默认不展开policy和图片csp，prepareApp调用prepareInteractiveLearning；show_app data schema按上述分支校验，不混用选择器参数。
2. board在onReady通过正常事务提交初始state；syllabus无需appState。所有后续state先调用validator再保存；恢复错误状态不能当成功。
3. 消息处理等待真实状态提交链，捕获trace/result/response/appState/会话/iframe身份，调用resolver；异步结束与队列提交后再次核对身份，保留正常widgetOrigin与hand-off去重。
4. q4为实际点评请求，q5为用户生成请求，必须进入正常Agent回合与现有生成权限/确认链；没有provider回执时禁止输出“已经生成”。go/replay/next只能从真实课程来源生成下一张卡，当前目录摘要/board没有完整下一关输入，不能虚构。

## 验收与边界

```sh
node --test tests/agent-interactive-learning.test.cjs
node --check src/features/agent-apps/interactive-learning.mjs
node --check src/features/agent-apps/qa/interactive-learning.mjs
```

专项测试直接运行官方独立初始化/恢复/答案清理/IL1编码函数，以及捕获的官方Bue/Aae策略，覆盖五语言、目录进入/重玩/锁定、点评/改编/过关/暂停、未保存/篡改拒绝、emoji截断、真实来源去重和状态约束。

`qa/interactive-learning.html` 使用生产controller/host/registry和原HTML；本地练习示例明确没有目标图片或模型结果。专用 `tapnow-qa-interactive-learning-v1` IndexedDB真实保存草稿、完成标记与去重队列，等待事务完成才成功；普通重绘保留卡片，刷新恢复；可切目录/学习板输入、模拟运行中与保存失败。队列不自动生成模型答复或解锁下一关。该确定性队列不能替代主Agent端到端与真实模型/媒体验收；本子任务没有浏览器或视觉验收。
