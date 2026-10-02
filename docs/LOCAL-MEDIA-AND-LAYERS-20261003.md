# 本机生成媒体与图层合成 · 2026-10-03

本批完成生产本机网关的结果素材落盘、原任务GET恢复及官方图层合成工作流。没有调用真实图像/视频/LLM供应商，没有宣称全站本地化或一比一验收完成。品牌替换依用户要求留到功能补齐后统一执行。

## 生成结果本地保存

生产 `server/server.cjs` 固定使用私有 `server/.generation-tasks`、`server/.generation-media`。供应商已成功的原始描述只私有保存；下载、格式边界检查、完整SHA及任务归属校验完成后，公开结果才变为成功和 `/api/generation/media/<UUIDv4>`。原图、封面、来源媒体及世界全部已声明SPZ/网格/全景资源均转换，文本不走媒体存储。

下载器固定DNS解析和实际连接地址，拒绝内网、原站域、跳转及超量流；不向任意CDN附供应商Key。HTTP只提供已发布的本任务文件，支持HEAD/单Range，使用同一完整性核验后的文件句柄。取消先存收据再中止下载；供应商已完成时不伪造上游取消，也不DELETE已完成产物。媒体接口关闭会中止慢客户端并释放句柄。

保存失败时任务为unknown，保留providerStatus=succeeded与localization失败状态；画布和Agent显示素材保存失败/重新取回素材。恢复不会重新生成。过期签名地址有原任务ID、查询能力和相同供应商配置指纹时，只GET原任务，核对ID，私有提交新描述/revision后重新落盘；无此能力明确报告不能刷新，绝不POST补救。缺文件按新revision取回。严格底层与预算见[下载合同](GENERATION-MEDIA-MATERIALIZER-20261003.md)。

画布普通结果应用也先真实解码图片/视频；修复LocalAssets解析超时后迟到结果仍开始加载的问题。历史、世界模型、Agent素材输入逐项接精确本机媒体引用，仍保留合法旧供应商记录。调色、裁切、人物站位/情绪、产品板、审片、素材选择器和制作预览等9个既有runtime补齐本机结果读取；已有宽来源合同不在本次变更中收窄。素材选择器串行生成真实内联预览，查询字节预算不足时省略可选预览，仍保留条目与引用能力，iframe不获得额外网络权限。

## 官方图层合成

接入 `layer-composer@v1` 原页面，提供显示/隐藏、顺序、坐标、缩放、旋转、透明度、画幅和背景。输出使用完整源像素、本地Canvas合成PNG，实际写入asset与画布节点，等待画布及会话保存后才给成功回执。重复请求复用原产物；撤销或删除后不会自动重建。源字节/输出字节改变、保存失败和迟到结果均有明确保护。合同及官方资源hash见[图层合成](../src/features/agent-apps/LAYER-COMPOSER.md)。

当前registry计数 **17/22版本URI、17/20功能族**。剩余功能族animatic、ecommerce-photoset、previs；历史animatic@v1和character-blocking@v1仍保留未接。计数不是功能/视觉验收百分比。

## 实际验收

- 新下载器16项、durable/gateway/HTTP15项、前端媒体与相关历史/世界93项、图层共享38项及模块18项通过。根任务媒体解码/应用13项通过；Agent旧工作流兼容修补累计132个唯一相关案例通过（含新增10项），首次两项fixture错误修复后仅定向复跑。各组含相关既有回归，不能相加当作新增测试数。仅运行与本次改动相关检查。
- 独立审查复现并修复原生Speech流式WAV误拒、过期signed URL无法刷新、慢客户端阻塞关闭三项；没有运行真实供应商请求。
- Computer Use 操作生产图层controller/runtime专属QA：隐藏/恢复前景，X705→706、旋转0→1、透明度100→99，投放实际PNG38916字节、960×540，SHA256 `5a495390dcc1190ed2e007383143edb73f419c65aa6dcf2571ba69ed91074911`。实际reload后回读同一PNG/hash/节点/会话；撤销后再次投放显示未知结果保护且无重复节点。输入是明确标记的本地QA几何PNG，非AI生成。截图在开发机 `/tmp/freenow-layer-composer-local-20261003.png`。
- Computer Use 操作隔离的真实gateway/TaskService/httpProvider/validateResultMedia fixture：先显示provider succeeded但localization failed，再点击只取回原任务，得到本地不可变URL并真实解码856×558图片。reload仍同一任务/资源，两项POST计数均保持1。输入是本机已存camera PNG，原始SHA `0cc3ec6493f72b2a76c5fcb4ccc28947fd2cc36754f23052821b9df320a25c92`；非真实供应商输出。可访问性状态已记录上述结果；截图裁切出现空白，不能作为此项验收证据。fixture不操作用户画布。
- 主服务已正常关闭重开，端口仍4173；Agent未配置Key状态如实保留。

## 未关闭边界

- 浏览器tasks-v1直连配置入口尚待迁到本机服务；旧画布/Widget远程资源和合法URL跳转至原站的迁移仍未完成。主页面尚不能启用全局本机CSP来代替功能实现。
- 媒体store启动只校验manifest结构/归属；读取/复用才核完整payload。每次HEAD/Range也完整校验SHA，为O(文件字节数)，尚未验证大视频性能。进程崩溃遗留锁会fail closed，须确认全部writer退出再把锁移至私有目录外保留；不能宣称任意崩溃自动恢复。
- 容器边界检查不是完整媒体解码；SPZ仅落盘，渲染器未接；全站菜单/布局/hover/拖动、最大画幅性能、真实Key供应商联调仍需继续。
- 去除产品可见TapNow logo、水印、导出标记并替换freenow尚未执行；原始证据、用户媒体、历史协议兼容保留。
