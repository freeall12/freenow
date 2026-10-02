# Creative family 入口与交接 · 2026-10-03

本批范围：Creative 无预选 art/hardware 入口、严格参数与交接验证；复用既有 Creative URI 和官方原 HTML。没有增加 manifest URI/功能族、模板下载器、猜测域名或依赖；品牌统一后置。

## 已接行为

- `prepareApp` 与真实 `AgentTools.parse('show_app')` 接受 Creative 独有 `family:website|art|hardware`。Website 固定 website；Website、Motion 和其余工作流拒绝传入 family。
- 推荐 ID 必须为当前活跃合法 ID，A05 拒绝作为新推荐；显式 family 与推荐 W/A/H 族冲突时拒绝。旧记录不重新按新推荐合同验证，原 HTML 仍优先恢复 widgetState，并自行清除 retired 选择。
- 实际 manager 详情的示例/使用动作携带对应 family 建立本地 `role:tool/show_app` 卡；保留应用 reference，不请求模型，不预选 A01/H01。相同会话同入口且原需求一致时复用原卡；原需求不同则建立新的无预选卡。
- manager 动作从进入回调就绑定原聊天，编辑器/应用依赖等待前后及保存后核验运行态/会话。失败只撤销本动作；补偿保存失败显式报告。编辑器回滚同步视图和保存；期间用户新编辑不被旧 snapshot 覆盖。
- Creative/Website 的正常 hidden 队列消息，必须匹配已保存 pending ID/signature、selectedId、draft parameters/request、inputs、官方 catalog SHA256、spec.skill、output 与精确 template_ref；完整原官方 awaiting-content 文案核验后才入队。host locale 覆盖签名中的旧 locale，跟随官方适配器实际行为。
- 模型结果投影明确 `local_template_body.status=configuration_required`；对象键不是 URL、本地未取得所选模板正文，不能联原站下载或伪造。官方 HTML 原始交接语句继续保留；运行时本地资源限制由主任务宿主策略负责。

## 新鲜验证

命令：

```sh
node --test tests/agent-creative-family.test.cjs tests/agent-app-registry.test.cjs tests/agent-app-host.test.cjs tests/agent-apps-batch-integration.test.cjs tests/agent-apps-edit-integration.test.cjs
node --check agent-client.js
node --check agent-tools.js
node --check src/features/agent-apps/creative-picker.mjs
node --check src/features/agent-apps/integration.mjs
node --check src/features/agent-manager/picker-launch.mjs
```

结果：关联回归51项通过；最后补充“不同原需求不得复用旧卡”后，Creative专项8项再验通过。8 项新增回归覆盖真实工具/schema与registry、官方适配器状态恢复优先、manager确定路由、精确handoff/被篡改状态/引用拒绝、实际locale覆写、保存后切换补偿、从真实 agent-client 提取的 onApp 回调依赖等待切换与失败编辑器回滚，以及不同原需求不得复用旧入口卡。

CUA 新建独立标签页，在本机 `localhost:4173` 的生产入口按「AI 助手 → 新建对话 → 添加附件 → 全部应用 → 管理应用 → 生成式数字艺术库详情示例」实际打开原 HTML，看到 art 16 项、无预选、A05 缺席；保留官方 art 侧栏静态17文本。本次发现并修复 `role:tool` 缺失及官方签名 en_US/发送 zh_CN 的实际locale覆写差异。

独立验收页：`src/features/agent-apps/qa/creative-family.html`。使用同一 manager launcher、createAppController、官方 proxy/HTML 与宿主保存/队列回调；队列仅在本页内存保存，不启动模型或生成。

| 验证 | 实际观察 |
| --- | --- |
| art / hardware 无预选 | 官方实际列表16/8，初始提示选择模板 |
| A01 / A17 / H01 / H08 | 通过官方 state 恢复修改参数；实际键盘改变拖动输入、暂停按钮变为播放；各一次真实宿主交接，累计4条，hidden:true、pending.accepted:true |
| 状态优先 | hardware 入口恢复 art/A05 历史 state，回到 art16；原 HTML 清除选择，显示选择模板提示 |
| busy | H08 使用按钮 disabled，无新增队列 |
| 保存失败 | H08显示「未能保存待提交的方案，请重试。」；队列仍3；保存恢复后第4条交接成功 |
| 精确交接 | 四项交接均为 awaiting-content；art.skill=creative-generative-art、hardware.skill=creative-hardware-mg，animation-html/12秒；官方template_ref/sha256保留 |

验收页的「重载已保存状态」仅重建 iframe 并读取本页内存 state，**不是浏览器刷新后的持久化验收**。参数面板是官方隐藏表单，本批通过官方 state 恢复修改参数，未声称可见参数表单交互已验。CUA 嵌套iframe鼠标输入返回目标失效/小数坐标不可安全检查，采用真实键盘ArrowRight改变官方 dragX；**鼠标拖动未验**。没有穷举24个活跃 art/hardware 模板，未取得独立模板正文、未测试下载/后续编辑/模型或媒体生成。

证据截图：`reference/creative-family-retired-restoration-20261003.jpg`；更多实际入口截图见本批后续记录。官方 Creative 原HTML SHA256 仍为 `2a07bc2e7e3874c49f012f1022cbf838939bf8ea502ca33af31b277986dadcc9`，新回归测试核对完整字节哈希和46个模板引用表。

补充截图：`reference/creative-family-hardware-entry-20261003.jpg` 显示hardware8无预选；`reference/creative-family-manager-restored-20261003.jpg` 为生产页面重新导航加载后打开原会话：保存的art入口卡仍显示16项/无预选，实际卡数1。此项证明生产入口卡身份/args恢复，未验证已修改draft/input经生产浏览器刷新恢复。
