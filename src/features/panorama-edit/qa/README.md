# 全景局部编辑前端隔离验收

```sh
node src/features/panorama-edit/qa/server.cjs 4267
# http://127.0.0.1:4267/?session=unique-session
node --test tests/studio-panorama-native-frontend.test.cjs src/features/panorama-edit/qa/server.test.cjs
```

页面复用正式 `index.html`、CanvasApp、IndexedDB 与旧版 Studio/全景编辑器。种子只有公开合成立方体和球体，默认数据脚本替换为空库；内存 localStorage、带 session 前缀的 canvas/assets/其他 IndexedDB 不读取日常项目。CSP 与 fetch 拦截阻止外部资源和其他产品 API。QA 服务仅发布源码白名单、本地 Three 依赖和合成素材；不载入 `.env`、真实 Key、个人画布和原站媒体。

左上“打开正式全景编辑”进入正式 Studio；“添加中央框选”复用同一 panoramaAction。输入修改描述并点 Generate，真实 TaskService、routed gateway、OpenAI SDK multipart、1024×1024 crop/mask、2048×1024球面回投、服务端归档与浏览器 patch 保存全部运行。唯一供应商 fetchImpl 只接受固定 SDK images/edits 请求，并返回公开合成1024 PNG；这不是实际模型生成或效果验收。

可切换缺 Key、延迟下一次配置、释放迟到配置、改变片场光照、模拟一次显式 CanvasStore 事务失败、重试同一结果保存、数据库回读。面板记录外部阻断、任务 POST、SDK POST、mask bytes、patch 数与数据库回读。保存失败后 prompt/历史/取景/退出锁定，保留同一 patch 收据；“重试保存”仅再次等待当前图数据库保存，不重新生成、下载、合成或创建结果节点。

来源守卫覆盖项目、原节点对象、scene/setup、编辑器会话、修订、来源图、球面选区、描述和镜头；配置守卫先于首次 availability 捕获只读 providerRevision，随后逐次检查公开配置快照。回填与提交使用同一守卫。显式 save+beforeCommit+flush 完成后才标记 applied；重试期间如果外部代码已移除/替换当前 patch，停止保存，不盲目复写。

原安装包行为核对：TapNow 0.4.81 的 `/Applications/TapNow.app/Contents/Resources/web/assets/ThreeDWorkspace-BzPphAqB.js`，SHA-256 `85b505729a166e8b56273effd999e4f9468db1f4e6758c2a49d97d7a74cf5694`。静态资源含 `handleSelectSessionPin`、`handleStartNewPosition`、`selectedPatchId`、`regionDirections` 和 `setIncludedInComposite`，并对 global patch 排除局部停用/删除工具条。本地沿用位置/相机/方向/独立 patch UI 语义；新配置守卫、事务 barrier 和保存重试是本地可靠性实现，不据此推断原站保存实现或模型请求合同。未提交官方生产任务。
