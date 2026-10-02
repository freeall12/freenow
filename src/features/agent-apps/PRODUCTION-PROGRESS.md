# 官方制作进度页接线合同

依据：未修改的 `resources/apps/production-progress@v1.acd4e750.html`，官方 `He/s_/c_/l_/d_/m_/_m/ontoolresult`，以及 `reference/vendor-packages-CN3JnHbF.js` 的 `rg/wae/Bue/Aae`。Manifest 的版本 hash 为 `acd4e750`。官方资源与图标原样复用。

这是纯只读生成结果展示。没有应用编辑状态、保存、确认、`ui/message`、模板选择或生成提交操作。页面自己的 SDK 只调用 `get_production_result` 与用户点击项目链接后的 `ui/open-link`。模块不能把工具调用描述、节点 ID 或动画当成任务已受理、已生成、已持久保存或媒体可播放的证明。

Purpose：对当前项目真实已提交生成任务查询结果，按请求节点顺序显示图片/视频、待处理与失败状态。用户要求排除营销、团队、分享、付费流程；本模块没有这些操作。官方静态资源仍含原始额度不足提示文案，它不是付款接线或额度实现。

Inputs：`prepareProductionProgress(data,title?)` 接受 `{node_ids:string[],project_id?:string,project_url?:string,status?:'blocked',reason?:string}`。节点 ID 唯一、非空、最长200字符、最多100个；project_id最长200字符；project_url只接受无用户名密码的绝对 HTTP(S) URL；title默认「制作进度」、最长200字符。只有真实未受理的 `blocked` 结果允许空节点列表，reason只能随blocked传入。输出 `{title,...data}`，供官方 `ontoolresult` 通过 `structuredContent` 初始化。

这些限制是本地宿主合同；官方 `m_` 自身仅筛选非空字符串，不能证明节点来自实际任务。主宿主必须从当前项目中真实持久生成trace或节点绑定构造/核对response，不能允许模型任意传ID或把show_app data当上游回执。初始化不会消费输入items或status:done；官方也总是先显示节点占位并立即查询。

Outputs：官方发 `tools/call {name:'get_production_result',arguments:{node_ids,project_id?}}`。`validateProductionProgressRequest(arguments,response)` 要求ID数量、顺序和project_id与当前来源完全相同，拒绝blocked来源。主宿主只能查询，不能借此调用任意工具或生成、重试、取消、写入画布。

`normalizeProductionProgressResult(toolResult,response)` 接受 `{structuredContent:{items:[{node_id,status?,media_type?:'image'|'video',media_url?,title?}],status?,project_url?},isError?}`，返回 `{content:[],structuredContent:{items,...}}`。节点只允许当前来源，ID唯一；结果按请求顺序排列；合法显式items数组缺少某节点时，遵循官方补 `{node_id,status:'not_found'}`。媒体URL只随done项目输出；done但无URL仅说明上游终态，不能称已取得或验证媒体。上游字段须由主宿主显式映射，额外字段不会原样透传。实际本地媒体应由宿主读取已经入图的真实素材字节。opaque内层经浏览器实测不能读取宿主Blob URL；图片使用已验证实际字节的data:image，视频通过制作进度专用本地proxy允许有界data:video，不放开网络域名或同源权限，官方归档proxy/HTML不改。

本地刻意收紧官方 `s_`：官方会追加未请求节点和无ID对象、同ID最后一项覆盖前项、缺失items视作空数组。本地拒绝外来源、重复、无ID、缺失structuredContent/items和超出合同的字段；非法/不完整结果是刷新失败，不能伪造not_found。实际查询若暂时漏项，宿主应填该节点的真实已知待处理状态或返回查询失败；只有确认查无节点才可返回not_found。

Permissions：复用现有双iframe/source/nonce/当前会话trace检查。官方 `Bue` 使用默认 `{allowExpanded:false,autoExpandOnReady:false}`；`Aae` 没有此资源的媒体域名配置，不能虚构官方媒体白名单。主宿主若展示本地真实产物，应只绑定对应节点、受现有媒体权限/CSP限制。project_url只允许HTTP(S)；媒体支持HTTP(S)、格式严格的blob:http(s)://origin/UUID以及512KiB文本以内带基础图片签名的data:image/png|jpeg|webp|gif;base64。禁止SVG、HTML、blob:null和带凭据URL。视频仅在media_type:video时接受data:video/mp4|webm;base64；文本最多12MiB、解码字节最多8MiB，核对MP4 ftyp或WebM EBML基础签名。宿主专属制作进度结果总容量最多16MiB。此签名不是完整解码证明，生产runtime必须绑定实际源媒体；超限不能冒充完整视频预览。此检查不替代完整图片解码、真实字节来源证明或外域权限；只有运行时核对真实done/applied节点和实际本地素材后才可发这些媒体URL。此模块不发网络请求。打开链接须匹配已核对来源project_url并经过现有链接权限，不能开放任意URL。页面不发对话交接；`validateProductionProgressState` 和 `resolveProductionProgressReply` 始终抛错。

Failure modes：`isError:true`、blocked或无有效初始化节点不能宣称开始成功。轮询isError、结构错误或传输失败不覆盖最近真实状态；连续4次失败停止刷新。终态为done/failed/not_found；请求节点都终态，或真实上游批次status为终态时，官方停止查询。批次終态不替换项目状态，例如批次failed但单项running仍保留running。

官方轮询间隔：无待处理15秒、待处理图片或未知媒体20秒、有待处理视频45秒；首次立即查询。2小时停止刷新，显示仍在进行，不能把任务改为失败。4次刷新失败与2小时超时均没有取消上游任务。官方帧自身负责timer，宿主不要另开重复timer。

`createProductionProgressSession(upstreamResult,now?)`、`applyProductionProgressPoll(session,toolResult,now?)`、`productionProgressPollDelay(session)` 和 `summarizeProductionProgress(session)` 是无网络的会话辅助模型，用于实际上游回执的轮询/日志与官方策略验证。session是宿主内部快照，不是官方appState或真实存储提交回执；调用这些函数不会保存任何东西。停止会话忽略后续poll，重开页面应重新查询真实任务，不用旧快照宣称任务已完成。`isProductionProgressTerminal`、超时与失败阈值常量供宿主复用。

Logging：主宿主记录真实来源项目/节点、查询工具ID、上游状态和失败原因。持久保存必须等待现有存储提交后才返回成功；工具展示无保存确认。此模块不保存、不入队、不生成handoffId。

Tests：`node --test tests/agent-production-progress.test.cjs`，`node --check src/features/agent-apps/production-progress.mjs`。针对性测试从未修改资源单独执行官方pure helpers验证节点排列、终态、延迟和超时，覆盖实际来源请求、blocked/error、未完成/无媒体done、4次失败保持状态、缺项与结构/URL/越权拒绝。没有运行全套或浏览器；共享registry、integration、AgentTools/AgentClient以及实际上游/持久绑定由根宿主接线验证。本模块测试通过不代表主Agent、完整官方页面、CSP媒体预览或真实媒体生成通过。


本地验收页：`/src/features/agent-apps/qa/production-progress.html`，使用生产createAppController，callbacks为getProductionSourceContext和onProductionProgressQuery。专用IndexedDB事务提交后才切换测试状态；query再次读取已提交记录，来源guard在读取前后核对。完成测试fetch已提交公共 assets/tap-logo.webp 与 qa/trim-scenes.mp4，实际解码图像和视频首帧、核对视频尺寸/时长，再提交图片/视频Blob和探测信息；查询读取已提交字节转换为data:image/webp及data:video/mp4，供未修改官方页展示。两项分别是公共Logo和MP4固定测试素材，不是生成结果；没有调用外部模型。专用DB使用public-v3，避免读取旧Blob预览或截图fixture。页面重载仅立即重查，不提交任务；普通会话重绘保留生产iframe。此页还没有浏览器验收，不能宣称官方预览交互已通过。
