# Story Room 与人物站位交互核对（2026-10-05）

本次核对生产模型、runtime、controller、原 HTML 和专属 QA。未调用模型、生成接口或外部服务；未修改原 HTML，未新增依赖。浏览器验收由主任务执行，下列操作是待验收步骤，不能当作已通过证据。

## 真实修复

新增 `src/features/agent-apps/story-room-local-interactions.mjs`，导出 `localizeStoryRoomInteractions(html,name,version)`。只接受完整 SHA256 `dae7d235df8887af866f8b1984b75075c651f1b4d8f79775a0470a4b89f569a0` 的 `story-room@v1` 原页；每项修改还要求目标源码仅出现一次。其他资源原样返回，错版本或来源变化明确失败。

- 原页编辑后延迟 400ms 保存，但确认直接发送已经计算的 NS1。派生在确认前取消待执行计时器，将当前官方状态复制为快照，串行等待既有保存及当前事务，然后发送原消息。确认期间临时设置根节点 `inert` 和触发按钮 `disabled`，finally 恢复原属性和焦点；这些状态不进入 appState。
- 原页保存和消息异常被吞掉。派生显示对应语言的失败与宿主原因；失败不发送未保存结构，同一页面可直接重试。成功发送后显示实际交接提示，宿主继续负责持久队列和稳定 handoffId 去重。
- 慢保存导致 iframe 的短时用户激活过期时，仅显示“结构已保存，请再次点击”，不发送消息、不放宽 host 权限。只缓存实际成功提交的状态 fingerprint，新点击相同快照无需再等待保存；保存失败不缓存，后续不同状态必须重新提交。
- 原页 `km` 先 trim 再截断到24个UTF-16字符，合法截断结果可能以空格结束；`U_` 刷新时再次 km 会把该空格删除。派生恢复时保留这个已合法截断的名称，避免 NS1 与已存状态发生变化。
- 中文提示“确认才会写回画布”改为“确认后交给 Agent 继续整理”。另外四语言仅承诺本地编辑直到确认，没有写画布承诺。本次保留官方五语言协议摘要与 token。

Story QA 增加已保存状态显示、模拟保存失败、只读 `window.storyRoomQA.snapshot()` 和关闭时释放 controller/database；继续用独立 IndexedDB `tapnow-qa-story-room-v1`。Story 与 Character QA 均支持 `?session=interactions-1005i`，将该session追加到各自专属DB名；只允许1–48个ASCII字母、数字或连字符，无参数沿用历史DB，非法参数明确失败。共享 proxy 需要主任务统一接入上述导出，QA 使用生产加载链，不自行绕过 proxy。

## 已有功能与边界

Story Room 原 UI 已有跨幕拖动、新增场景、两次点击删除、剧情线淡化过滤、幕折叠、轨道收起及20步撤销。本次没有改写它们。过滤会淡化其他剧情线，不隐藏场景；新增场景没有剧情线且只含名称。跨幕移动新增场景时 `news.act` 保留创建幕，实际位置取 `cols`；此行为正确。Story Room 原页没有“重置”按钮，撤销只恢复 `cols/news/dels`，保留过滤、折叠和递增 `nseq`。

Character Blocking v3 的输入/保存/CB3、真实本地头像裁切与来源哈希已存在，本次没有新增人物站位实现。原页拖动使用 pointer capture；数值输入仅接受范围内整数；键盘普通位置步长10、Shift步长1，吸附位置步长50；朝向普通步长5°、Shift步长1°。重置恢复建议位置/朝向，保留 target/ratio/selected_id/snap。原页确认会立即重存完整状态；失败由生产保存链拒绝，原页显示“发送失败，请重试”。新确认会再保存，支持不刷新直接重试；这个路径仍需实际浏览器补证。

## 主任务浏览器操作与期望回执

1. 打开 `/src/features/agent-apps/qa/story-room.html?session=interactions-1005i`，点击“打开剧本结构板”。以新卡片为本轮来源，记下显示的 traceId 和初始队列数。
2. 通过 `S1` 卡片的 `.grip` 拖到第二幕 `.list[data-act="A2"]` 的 `S3` 前方。待保存状态应为 `A1:[S2]`、`A2:[S1,S3]`，原来源 `S1.act=A1` 不被伪改。
3. 第一幕“＋ 加一场”输入“雨夜核对录音”并回车，紧接着点击“确认结构”，无需等待400ms。保存状态 `A1:[N1,S2]`、`news.N1.act=A1`；队列新增恰好1次，原消息为 `结构确认：2 幕 4 场，移动 2，新增 1，废弃 0 — NS1 v=1;order=A1:N1,S2|A2:S1,S3;new=N1:雨夜核对录音`。官方“移动”比较来源场景的全局位置/幕，所以 S1 移幕同时让 S2 的序号变化，两项计入。
4. 第一幕 `S2` 的“✕”连续点击两次，确认删除；点击“事故调查”过滤，应保存 `filter:P2` 并淡化其他来源剧情线。确认后的消息为 `结构确认：2 幕 3 场，移动 1，新增 1，废弃 1 — NS1 v=1;order=A1:N1|A2:S1,S3;new=N1:雨夜核对录音;del=S2`，与上一步不同结构新增1条。
5. 连续点“撤销”三次，依次恢复 S2、去除 N1、恢复 S1 原幕；`nseq` 保留1，过滤可保留P2。每一步已保存状态应与视觉一致。幕与轨道收起/展开保存为官方 `collapsed/stripOpen`，不改变内容 handoffId。
6. 勾选“模拟状态保存失败”，新增场景后立即确认：原卡内显示保存错误；已保存状态与队列数保持前值。取消模拟后在同一原卡直接确认，应保存当前结构并仅新增1条；再确认不增加队列。确认等待期间板内不能继续编辑，完成或失败后按钮可再操作、焦点恢复。
7. 真正刷新浏览器，卡片结构、过滤、折叠、已保存状态与队列都恢复；再次确认同结构不增加队列。另用23个“甲”加“ 后续名称”新增场，确认后刷新再确认，24字符名称末尾空格保持，队列去重不失效。
8. 打开 `/src/features/agent-apps/qa/character-blocking.html?session=interactions-1005i` 的新卡。拖林岚标记和方向把手，检查实际已保存整数；调整 X/Y/朝向，改 `video`/`9:16`，选择周宁并开吸附，再点“重置”：人物位置/朝向回建议值，目标/画幅/选择/吸附保留。确认应含精确CB3及实际本地来源哈希，重复确认去重。
9. 人物页勾选保存失败，改X后确认：不得新增队列。取消模拟，在原卡直接再确认：新X应提交、恰好新增1条；刷新恢复。上传新图片后旧卡确认应明确来源失效，重新开卡才使用新本地头像。

## 聚焦验证

```sh
node --test tests/agent-story-room.test.cjs tests/agent-story-room-local-interactions.test.cjs tests/agent-character-blocking.test.cjs
node --check src/features/agent-apps/story-room-local-interactions.mjs
node --check src/features/agent-apps/qa/story-room.mjs
```

先前27项通过，其中5项新增回归覆盖完整来源SHA、确认等待两个真实模拟提交且快照不随后续引用突变、保存失败不发送/同页重试/重复点击、队列失败重试、合法尾空格恢复。最后激活边界单独新增2项并定向通过，覆盖慢保存后过期不发送、重新点击复用实际提交的fingerprint、新状态必存及失败不缓存；没有重复全套。测试明确使用模拟请求与DOM，只证明保存顺序和协议约束；pointer交互、真实像素和刷新仍以主任务浏览器证据为准。人物站位13项是已有测试再次通过，不计为本次新功能。

```sh
node --test --test-name-pattern='slow successful save|failed save never caches' tests/agent-story-room-local-interactions.test.cjs
```

原人物页 SHA256 保持 `f1fd0e23de67bf00f60ccf333b7d5b57262a01726a37adeef28c800d51a8815b`。本次未提交 Git；没有读取Key。
