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

Failure modes：不匹配的mode/来源/绑定/face，缺失已提交状态或实际guide、旧哈希、任意确认前缀、非法媒体、异步期间来源/iframe/state切换均拒绝。官方页面编辑状态有350ms debounce且确认没有主动flush，编辑后立即确认可能明确失败，需等待已保存状态后重试。已创建的可见图节点在后续会话保存失败时保留，不能无证据声称整个画布操作已撤销；回执和队列仍失败。保存失败不会触发模型。

Logging：show_app trace保留appState、actorExpressionGuide、widgetOrigin和handoff；真实图片节点provenance保留调用ID、来源快照、图片哈希。图片工具重试按调用ID和内容核对；相同来源与相同灰模字节的新调用可复用已保存真实节点；重复相同确认按稳定内容handoffId去重，改变voice/face/正文/guide字节则产生新交接。节点ID保留在可读交接中，重建同一字节图片不会仅因节点ID不同而绕过去重。

展示策略严格采用官方`{allowExpanded:true,autoExpandOnReady:false}`，无maxInlineHeight。原站证据`vendor-packages-CN3JnHbF.js`的`_ae(actor-emotion)`配置imgDomains：tap-testing.tamaredge.top、tap-testing2.tamaredge.top、files-testing.tapnow.art/media/top、files.tapnow.art/media/ai/top（均https）；没有mediaDomains。这是官方宿主的域名配置记录。

当前本地离线sandbox使用`img-src data: blob:`、`media-src blob:`、`connect-src 'none'`；上述原站HTTPS域名不在当前页面白名单中。人物参考由宿主从真实节点像素生成data URI；内嵌GLB和纹理在本页本地解码。双iframe继续只允许`allow-scripts`，保留opaque origin。

## 本地纹理加载派生

官方内嵌GLB包含真实JPEG纹理`FBHead_baked_tex`。现代浏览器的官方ImageBitmapLoader会对GLTFLoader创建的`blob:null/...`调用fetch，受到当前`connect-src 'none'`拦截；`blob:null`表示opaque origin，并不表示图片不存在。旧路径会让人偶纹理加载失败，即使模型几何已显示。

`actor-emotion-local-resources.mjs`仅对actor-emotion@v1、完整HTML SHA256 `63ee986bdf5b9572cad5edc838da540eda6147007ab3f011604959467616437f`和唯一精确替换点生效，将加载器选择切到官方已有TextureLoader，通过`<img>`读取现行`img-src blob:`允许的本地纹理。修复只作用于proxy写入srcdoc前的内存派生内容；官方HTML文件字节未变，GLB、JPEG纹理、材质和交互保持原资源内容。没有扩大connect-src或增加外部网络权限。outer proxy加载该专属静态模块需要其精确路径的匿名CORS读取；内层页面策略继续全禁网络连接。

## 验收

```sh
node --test tests/agent-actor-emotion.test.cjs
```

测试独立提取官方`IT/Db/eT/GQ/sE`原文，验证两语言与图像/视频模式、真实PNG与WebP输入、CRC/字节哈希、预算、未保存/假来源/假guide/注入拒绝及内容去重。PNG结构校验不能替代实际图片解码；生产runtime另有解码、素材和提交保存回归。

`/src/features/agent-apps/qa/actor-emotion.html`使用生产controller/host/runtime，独立IndexedDB `tapnow-qa-actor-emotion-v1`，真实本地输入图片和图节点适配器。它加载原始捕获页面并应用上述哈希限定纹理派生，真实渲染并捕获灰模，实际解码/保存后才展示图片回执与队列；刷新恢复保存结果，普通重绘不能重复排队。没有模型或生成API调用。本页fixture和本地适配器用于宿主路径验收，不能代替用户项目与真实模型的生成验收。

2026-10-03主任务CUA复验：新浏览器页无warn/error，灰模及原纹理完整可见；使用原生键盘选择“喜悦”并确认，实际已保存guide从2张增至3张，队列为3项。新guide图片SHA256为`5c76d227075d9c87cf201b4fb5a87624384ab94710c8cea031774329d595e57e`。刷新后3张保存图片均可实际解码为512×512。纹理修复的4项聚焦测试此前已通过；此文档更新未重复运行测试。截图：[真实纹理浏览器验收](/tmp/freenow-actor-local-texture-20261003.png)。
