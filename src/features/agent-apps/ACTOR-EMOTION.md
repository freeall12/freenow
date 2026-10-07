# 人物情绪导演台

依据未修改的 `resources/apps/actor-emotion@v1.63ee986b.html`：`MT/OT`输入、`IE/IT/sT`状态、`gb/wb`灰模图片保存、`Db/eT`真实AE2确认；官方宿主 `reference/vendor-packages-CN3JnHbF.js` 的 `Bue/wae/_ae`定义展示和CSP。不是普通模板选择器，也不是仅凭一段情绪文本就确认的工作流。

```json
{"resource_uri":"ui://tapnow/actor-emotion@v1","title":"第18场情绪","data":{"locale":"zh-CN","scene":"林岚忍住泪水，平静告别。","mode":"video","source":{"node_ref":"node/实际视频节点ID","media_kind":"video"},"actor":{"binding_id":"aem_0123456789abcdef","name":"林岚","role":"告别的人","reference_nodes":[{"node_ref":"node/实际图片节点ID"}]},"face":{"valence":-65,"stance":-65,"intensity":68},"voice":{"preset":"tender","intensity":36},"dialogue":"我们就到这里吧。"}}
```

节点引用必须来自当前项目真实来源；生产runtime从实际节点图片生成preview_url，并丢弃调用者提供的preview_url。上面是字段说明，不能把说明占位值作为实际来源。来源节点媒体类型等于mode，1–4个人物参考均为真实图片节点；图像模式禁止voice/dialogue。当前本地节点引用为`node/<安全节点ID>`，binding为`aem_`加16位小写十六进制。scene最多4000字符，title最多200字符，人物name/role最多200/1000字符，dialogue最多4000字符；拒绝未知字段与重复人物引用。locale仅中/英；voice preset为calm/happy/tender/sad/angry/fearful/tense/cold。面部横纵轴是整数[-100,100]，面部和声音强度是整数[0,100]。

Purpose：使用官方内嵌3D人偶预演面部情绪；视频可独立设置声音情绪。保存真实表情指导图片，核对确认后进入正常新用户回合，请Agent整理提示词。

Inputs：`prepareActorEmotion(data,title)`生成官方版本1完整结构；data不接收version/summary、任意工具、权限或预设图片回执。状态为`{version:1,active_tab:'face'|'voice',face,voice?}`。图像只能face且没有voice。宿主在首次就绪时提交初始状态，后续状态写入串行；确认与图片保存均等待已提交状态。

Outputs：首次show_app返回`kind:mcp_app`。官方`gb`随后请求唯一工具`actor_emotion_save_expression_guide`，只接受`{binding,mode,source_node_ref,actor_reference_node_refs,face,locale,image_data_uri}`和元数据`tapnow/callId`。SDK协议progressToken由host核对并剥离，不扩展工具输入。图片必须是官方灰模真实捕获的512×512 PNG或WebP，data URI最多120KiB、工具arguments JSON最多128KiB。官方优先PNG，超预算才尝试WebP质量0.92/0.82/0.72/0.62。内嵌GLB无需外部模型URL。

`prepareActorExpressionGuide(params,data,savedState)`只返回经过结构/CRC/原始图片字节SHA256校验的pending `{callId,bytes,mime,width,height,record}`；此时没有node_ref或成功回执。运行时必须真实解码512×512、写入本地素材、实际创建连接图节点、提交画布和会话保存，然后才给record补上真实node_ref。实际SDK成功输出为`{content:[],structuredContent:{node_ref,guide_sha256,binding,face}}`。灰模不可用、图片过大、无法解码或保存失败均返回错误，不伪造成功。

官方确认原文为`Db(state) + ' — ' + eT(...)`，token实际是`AE2 v=2;binding=…;mode=…;face=x~y~intensity;voice=none|preset~intensity;guide=node/…;guide_sha256=…`。`resolveActorEmotionReply(text,data,savedState,savedGuide)`核对官方中/英原文、已提交face/voice、真实图片哈希以及原来源/人物绑定，补充可读JSON并产生内容SHA256稳定handoffId。active_tab属于展示状态，不改变交接内容。确认只授权整理提示词，不能直接提交图片/视频/声音生成。

Permissions：只在actor-emotion@v1的生产host启用该单一工具回调，其他应用与工具仍拒绝；沿用双iframe、nonce、来源、当前用户动作与iframe代次。来源保护覆盖项目/会话/trace、保存状态、来源内容和引用；运行中拒绝新保存/确认。正式确认还要检查实际本地素材bytes以及对应图节点provenance。用户删除、撤销或改动灰模节点后不能继续使用旧回执。

Failure modes：不匹配的mode/来源/绑定/face，缺失已提交状态或实际guide、旧哈希、任意确认前缀、非法媒体、异步期间来源/iframe/state切换均拒绝。官方页面编辑状态有350ms debounce且确认没有主动flush；本地哈希限定派生在确认时取消待防抖，通过原SDK串行FK提交本次IT快照，等待真实保存回执后再捕获/保存灰模和发送AE2。保存失败保留页面与调用ID供显式重试，不保存灰模或发送确认。已创建的可见图节点在后续会话保存失败时保留，不能无证据声称整个画布操作已撤销；回执和队列仍失败。保存失败不会触发模型。

Logging：show_app trace保留appState、actorExpressionGuide、widgetOrigin和handoff；真实图片节点provenance保留调用ID、来源快照、图片哈希。图片工具重试按调用ID和内容核对；相同来源与相同灰模字节的新调用可复用已保存真实节点；重复相同确认按稳定内容handoffId去重，改变voice/face/正文/guide字节则产生新交接。节点ID保留在可读交接中，重建同一字节图片不会仅因节点ID不同而绕过去重。

展示策略严格采用官方`{allowExpanded:true,autoExpandOnReady:false}`，无maxInlineHeight。原站证据`vendor-packages-CN3JnHbF.js`的`_ae(actor-emotion)`配置imgDomains：tap-testing.tamaredge.top、tap-testing2.tamaredge.top、files-testing.tapnow.art/media/top、files.tapnow.art/media/ai/top（均https）；没有mediaDomains。这是官方宿主的域名配置记录。

当前本地离线sandbox使用`img-src data: blob:`、`media-src blob:`、`connect-src 'none'`；上述原站HTTPS域名不在当前页面白名单中。人物参考由宿主从真实节点像素生成data URI；内嵌GLB和纹理在本页本地解码。双iframe继续只允许`allow-scripts`，保留opaque origin。

## 本地纹理加载派生

官方内嵌GLB包含真实JPEG纹理`FBHead_baked_tex`。现代浏览器的官方ImageBitmapLoader会对GLTFLoader创建的`blob:null/...`调用fetch，受到当前`connect-src 'none'`拦截；`blob:null`表示opaque origin，并不表示图片不存在。旧路径会让人偶纹理加载失败，即使模型几何已显示。

`actor-emotion-local-resources.mjs`仅对actor-emotion@v1、完整HTML SHA256 `63ee986bdf5b9572cad5edc838da540eda6147007ab3f011604959467616437f`和唯一精确替换点生效，将加载器选择切到官方已有TextureLoader，通过`<img>`读取现行`img-src blob:`允许的本地纹理。另一个精确替换点让确认等待已提交状态；原按钮、情绪混合、语言文本和AE2编码保持官方实现。修复只作用于proxy写入srcdoc前的内存派生内容；官方HTML文件字节未变，GLB、JPEG纹理和材质保持原资源内容。没有扩大connect-src或增加外部网络权限。outer proxy加载该专属静态模块需要其精确路径的匿名CORS读取；内层页面策略继续全禁网络连接。

关闭沿用现有本地生命周期合同：派生页面在原SDK连接前安装`localLifecycleScript`，发送`freenow/lifecycleReady`；生产host仅把actor-emotion@v1加入既有关闭白名单。请求`freenow/lifecycleFlush`时冻结原root、提交尚未渲染的pointer末值、取消350ms待防抖，并通过原FK保存IT快照；真实回执后才`flushed:true`。存储失败解锁并返回错误，卡片显示“页面已保留，请再次关闭以重试”；hg正在保存灰模或发送确认时明确拒绝关闭。这个路径不捕获灰模、不发送AE2，也不提交模型调用。

2026-10-08只读核对当前安装包 `/Applications/TapNow.app/Contents/Resources/web/usercontent-proxy/apps/manifest.json`：只声明actor-emotion@v1，无独立actor-guide应用。对应安装包HTML与本地原件逐字节相同，SHA为上值。`actor-guide-runtime.mjs`是本地真实灰模保存适配器。公开Apps概览位于https://docs.tapnow.media/zh/docs/agent/apps；本次具体按钮/SDK合同来自安装包原HTML，并非由概览推测。

## 验收

```sh
node --test tests/agent-actor-emotion.test.cjs
node --test tests/agent-actor-emotion-confirmation-sdk.test.cjs tests/agent-actor-emotion-local-resources.test.cjs
node --test tests/agent-actor-emotion-close-sdk.test.cjs
```

测试独立提取官方`IT/Db/eT/GQ/sE`原文，验证两语言与图像/视频模式、真实PNG与WebP输入、CRC/字节哈希、预算、未保存/假来源/假guide/注入拒绝及内容去重。PNG结构校验不能替代实际图片解码；生产runtime另有解码、素材和提交保存回归。

2026-10-08专项验证：新增4项测试执行原HTML的`wb/tT/FK/IT`：原页面立即确认复现未提交face错误；本地图像及声音模式等待状态保存；存储慢时按钮维持busy且双击不重入；存储失败不保存灰模/不发送AE2，显式重试恢复；之前排队的SDK状态先完成再保存准确确认快照。纹理/原件完整性/CSP的4项测试通过。未在本批使用浏览器，不把VM验证写作视觉验收。

新增关闭专项5项通过：完整7.3MB官方模块和实际SDK启动，点击原“喜悦”按钮后立即关闭，等待真实SDK保存回执并精确读取face `{valence:100,stance:0,intensity:72}`；原SDK不能抢先返回Method not found；关闭保存失败后保留编辑并可重试；hg忙时拒绝关闭。生产host测试验证无ready时拒绝、ready后等待对应close ID、错误ID无效、成功后resume恢复。实审另发现`hasPendingCloseApps`未列actor，项目/片场切换会绕过关闭保护；现只在该集合补入actor，真实controller和实际client guard/beginStudio最小回归验证只打开actor也拒绝跳走，并维持旧会话。完整模块VM没有WebGL，测试显式返回无画布context，故不宣称本批人偶渲染复验。

生产组件待执行验收（本页使用实际controller/host/runtime，灰模来源仍是原HTML）：

1. 打开 `/src/features/agent-apps/qa/actor-emotion.html`，点击“打开官方人物情绪页”，展开卡片，等待纹理人偶可见。
2. 从“悲伤”选择“坚定”，在350ms内点击“确认情绪方向”。应直接成功，不出现未提交face错误；真实512×512灰模图片增加1张，AE2/可读JSON的face与可见方向一致，队列增加1条。连续点击确认不应重复队列或相同图片。
3. 点“视频模式样例”，它实际读取 `/qa/trim-scenes.mp4` 并存储视频节点。打开新应用，切声音为“冷淡”，调强度后立即确认，face/voice均须精确保存；声音改变与面部独立，相同灰模字节应复用图片，但不同声音产生新交接。
4. 刷新：应用face/voice/tab、真实图片与队列保留。普通会话重绘及相同确认不重复派发；勾选“模拟会话运行中”后确认必须拒绝，取消后可重试。
5. 在行内卡片打开后，勾选“验收：会话保存延迟800毫秒”再展开。改变方向立即Escape收起：应显示“正在保存最后编辑…”，保存完成后才收起，重新展开及刷新保留末次方向。保存期间点确认/收起不能交错成为提前成功。
6. 先取消延迟，行内勾选“验收：会话保存失败”再展开。改变方向立即确认：显示灰模参考保存失败，不增图片/队列；立即Escape：页面保留并显示最后编辑未能保存。取消验收失败后重试确认/关闭：成功保存，刷新保留末值。本页故障开关仅作用于标明QA的专用会话适配器。

正式主壳验收入口：主壳Agent会话通过正常`show_app`调用上方实际node_ref数据，不直接嵌入QA页。生产人物runtime会从真实项目图片生成参考预览并绑定来源快照。实际图片/视频节点必须当前存在；灰模确认应创建连接图片节点并保存到用户项目。正式主壳选情绪后立即点确认，再改情绪立即点击关闭Agent面板或切换会话，等待close保存完成后刷新；状态应恢复，未配置Key时provider任务数不得增加。只打开actor时直接切项目/片场应提示先收起AI助手、保留旧项目/片场；完成关闭保存后才允许切换。存储故障和800ms延迟用独立QA页验证，不能注入用户项目或把专用fixture当真实主壳数据。

验证边界：本批未新增贯通原wb→生产controller→真实runtime的“灰模保存失败/消息失败→重试同handoff”组合测试，依赖既有runtime保存去重和state-controller回归；不能将这条完整浏览器链写为已新验收。当前新增测试证明确认状态顺序与关闭生命周期，生产组件实机步骤仍需执行。

`/src/features/agent-apps/qa/actor-emotion.html`使用生产controller/host/runtime，独立IndexedDB `tapnow-qa-actor-emotion-v1`，真实本地输入图片和图节点适配器。它加载原始捕获页面并应用上述哈希限定纹理派生，真实渲染并捕获灰模，实际解码/保存后才展示图片回执与队列；刷新恢复保存结果，普通重绘不能重复排队。没有模型或生成API调用。本页fixture和本地适配器用于宿主路径验收，不能代替用户项目与真实模型的生成验收。

2026-10-03主任务CUA复验：新浏览器页无warn/error，灰模及原纹理完整可见；使用原生键盘选择“喜悦”并确认，实际已保存guide从2张增至3张，队列为3项。新guide图片SHA256为`5c76d227075d9c87cf201b4fb5a87624384ab94710c8cea031774329d595e57e`。刷新后3张保存图片均可实际解码为512×512。纹理修复的4项聚焦测试此前已通过；此文档更新未重复运行测试。截图：[真实纹理浏览器验收](/tmp/freenow-actor-local-texture-20261003.png)。

## 2026-10-08主任务CUA专项实机证据

本段记录主任务后续实机结果，补充上文仅有VM验证时的边界。使用生产host/controller/runtime的专项页面，图像模式真实保存1张512×512灰模图片，AE2确认1次。开启800ms会话保存延迟，通过正常键盘恢复建议值后确认；提交的face为`{valence:-65,stance:-65,intensity:68}`，已核对与实际灰模保存回执及图片SHA一致。

通过正常slider的Right键编辑后，点击外部收起按钮触发关闭前保存。在会话保存故障开启时，UI显示“最后编辑未能保存…页面已保留”，原卡片继续保留，控件恢复可操作。取消故障后在原卡片重试关闭成功；重新放大、刷新、再次放大，强度62及“悲伤87% + 恐惧13%”恢复，实际已保存灰模1张、确认队列1条保持。截图为当时1600×1000大视口：[关闭重试与刷新恢复](../../../docs/screenshots/actor-emotion-close-refresh-20261008.png)。实机操作结束已reset，截图记录的是重置前状态。

操作边界：嵌套按钮鼠标/坐标操作被工具输入边界拒绝，fullscreen内按钮仍未能点击；本批成功路径是外部收起按钮起点，再依次Tab到提示控件及slider，使用正常键盘进入和编辑。因此不宣称全部鼠标交互或精确小于350ms的编辑后确认已经实机验收。真实视频/声音独立设置、完整灰模或消息保存失败后的确认重试及单次handoff去重，均未在本批CUA验证。项目guard/片场guard的证据来自新增真实client测试，不是CUA实机操作。本次仅追加文档证据，没有修改源码、重新运行测试或提交。
