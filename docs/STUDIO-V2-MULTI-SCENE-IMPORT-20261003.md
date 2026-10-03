# 3D 片场 2.0：多场景动画导入与资源收口

官方依据：同版 `reference/studio-v2-page-readable.js` 的 `_c`（2071 起）按当前场景过滤可绑定的动画轨道，并复制动画片段；原生导入菜单已有多场景选择。此次沿用该菜单，没有新增设计、依赖或外部请求。

修正的实际路径：

- 一个 glTF 节点被多个场景引用时，Three 为其他场景复制节点。原实现把动画只绑定到第一个场景的 UUID，导入其他场景后该节点不会运动。现在在恢复显示名称前保存每个场景的绑定，分别复制对应动画并写入该场景的节点 UUID；无名称的根节点和子节点按已加载源根与场景副本的层级对应绑定。
- 导入选择场景与默认场景加载只采用可绑定的片段，避免带入其他场景独有的无效轨道。现有不包含新字段的 prepared 对象仍可使用旧入口。
- Three 会按场景缩减 parser associations，场景完成顺序也决定谁采用原始节点；官方缓动 sampler extras 使用稳定的已加载源节点恢复，再复制到各场景，不依赖哪个场景先完成。不会重新请求模型服务。
- 导入成功、已应用但保存失败、关闭或检查被替换时，统一释放未采用场景的资源。以当前片场内容作为 retain 集，保留正在使用的共享几何、材质和纹理；同一批共享资源仅释放一次。Agent 指定 sceneIndex 的导入也使用相同动画分配。
- 默认场景 `loadSaved()` 在返回前释放未采用兄弟场景并保留默认场景，返回场景列表只含该默认场景；恢复场景和加载预设资源沿用此路径。快捷添加 model/actor/tree 在预检失败时释放新模型，已应用内容和保存失败后的内容保留给当前片场管理。
- 原生导入沿用 Agent 的身份约定，仅清除新导入节点的 `studioId`，让当前片场分配新 ID。相同导出模型重复导入互不混淆；Three UUID、运镜绑定和其他 userData 均保留。

定向验证：

- `node --test tests/studio-v2-multi-scene-import.test.cjs` 6/6 通过：真实 GLTFLoader 解析共享节点、两场景 AnimationMixer 实际插值、默认第二场景只含匹配动画、无名称的共享根和子节点、改变场景完成顺序后官方缓动 extras 保留、共享资源保留与未使用资源释放、选中场景的 GLB 导出/重新载入后继续运动。自定义 cubic 插值工厂的复制用单元断言覆盖，复杂骨骼/cubic 浏览器组合仍未验收。
- 受影响 `tests/studio-v2-import-focus.test.cjs` 1/1 通过；已有 `tests/studio-v2-agent-controls.test.cjs` 5/5 通过。
- 新增 `tests/studio-v2-default-model-resources.test.cjs` 2/2 通过：默认载入的未使用几何/材质/纹理各释放一次，共享选中资源保留至内容关闭；快捷添加成功、预检失败和已应用但保存失败均按归属清理。
- 新增 `tests/studio-v2-repeat-import.test.cjs` 1/1 通过：真实导出 GLB 连续原生导入两次，所有 Studio ID 独立、UUID 保持、来源与相机源节点 metadata 保留，两个运镜分别关联各自镜头，播放第二段不会驱动第一份模型。
- 六个变更运行模块的 `node --check` 通过。没有跑全量、启动服务或提交。

主任务已在隔离 `/qa/native-creation-app.html?session=multiscene-20261003&persistSession` 实际验收 `qa/studio-v2-multi-scene.gltf`（明确的本地行为夹具，不是设计参考）：默认第二场景“QA scene B shared rig”导入后显示 1 镜头 / 1 运镜；播放并放大预览，进度 1.00 / 2.00 秒可见真实红色立方体；返回、刷新并重入后仍有 1 段可播放运镜。截图为 `/tmp/freenow-multiscene-preview-20261003.png`，总记录见 `docs/LOCAL-WORLD-AND-SCENE-20261003.md`。

无名称共享节点、CUBICSPLINE/复杂骨骼、多场景资源计数和重复 GLB 身份隔离目前为定向自动验证；该浏览器结果不替代这些组合的完整现场验收。第一场景含独有对象动画的浏览器路径仍待检查，未宣称完整多场景工作区或全部 3D 功能完成。

独立复审已复现并确认无名称共享节点、场景完成顺序导致的缓动绑定缺口已修复，并独立核对选中/未使用的几何、材质与纹理释放计数。复审指出的既有 `loadSaved()` 兄弟资源缺口也在授权后纳入上述默认加载与快捷添加清理。
