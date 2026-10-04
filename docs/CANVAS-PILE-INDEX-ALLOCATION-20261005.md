# 堆叠索引全图扫描与临时分配 · 2026-10-05

`app.js` 的完整渲染、框选、堆叠落点判断等链路使用 `CanvasPiles.index(nodes)`。现有优化已经共享单帧索引，但索引本身仍通过 `nodes.map` 构造每节点一个 `[id,node]` 临时数组，并两次筛选全部节点以获取堆叠。

本次仅修改 `canvas-piles.js` 的索引实现：一次扫描直接填充 `byId` 并收集 `pileNodes`；词法排序使用堆叠列表副本，成员列表继续按原画布顺序建立。索引仍每次新建，原位修改、撤销重建、异步成员变化不会复用旧归属。坐标、成员顺序、重复ID的最后节点对象、词法顺序决定的先获归属、NaN、数字/字符串ID及稀疏成员数组均保留既有行为。

没有改变画布DOM、hover事件、撤销入口或公共API，没有新增依赖。对50成员的常规堆叠，原生 `indexOf` 去重在定向对照中比逐成员 Set 更合适，因此最终保留该原逻辑。

## 工作量与耗时

新增 `tests/canvas-pile-index-performance.test.cjs` 用原生产算法作为基线，运行同一批节点对象并逐项比较真实成员对象、成员顺序和归属。计数场景为1,000个堆叠、每堆叠50成员，共51,000节点：

| 每次新建索引 | 原实现 | 本次实现 |
| --- | ---: | ---: |
| `[id,node]` 临时数组 | 51,000 | 0 |
| 节点 `type` 读取（包含成员类型校验） | 152,000 | 101,000 |
| 成员数组数字下标读取 | 1,375,000 | 1,375,000 |

耗时使用未插入计数器的普通节点/成员数组，每个算法先预热8次，再交替运行30次；本机2026-10-05单轮记录如下。耗时为诊断值，无固定阈值断言。

| 场景 | 原中位数 | 本次中位数 | 原P95 | 本次P95 |
| --- | ---: | ---: | ---: | ---: |
| 80×50成员，4,080节点 | 1.299ms | 1.174ms | 2.421ms | 1.683ms |
| 1,000×50成员，51,000节点 | 17.504ms | 17.975ms | 30.898ms | 23.494ms |

大场景中位数接近且本次略高，不能声称所有规模都加速。可确定减少的是扫描和临时分配；此记录不包含DOM、布局、绘制或GPU，不能换算成整体FPS提升。

## 定向验证

```sh
node --test tests/canvas-pile-index-performance.test.cjs tests/canvas-piles.test.cjs tests/canvas-marquee-frame-performance.test.cjs tests/canvas-pile-preview-render.test.cjs
node --check canvas-piles.js
node --check tests/canvas-pile-index-performance.test.cjs
git diff --check
```

覆盖原位成员顺序变化、跨堆叠重复归属、undo快照对象、真实dropTarget、分数坐标未变，以及既有框选最终落点、渲染索引共享和预览媒体复用。计数/耗时通过并不替代实际浏览器交互验收。

## 最短本地交互验收

使用既有隔离入口 `/qa/canvas-groups-app.html?performance&performanceLarge&session=pile-index-20261005`，其存储键带该session前缀，与日常项目分离。

1. 点击「测量重叠堆叠落点响应」。查看 `sameTarget`、`liveHighlight`、`highlightCleared`、`coordinatesUnchanged` 均为true；该按钮中的前后耗时比较针对已有落点优化，不作为本次索引改动的耗时证据。
2. 点击「验证隐藏标题缩放恢复」。查看 `releasedVisible`、`releasedWidthExact`、`undoRestoresPile`、`coordinatesExact` 均为true，`hiddenTitleWrites` 为0。

2026-10-05主线程已实际点击上述两按钮：`sameTarget/liveHighlight/highlightCleared/coordinatesUnchanged`全部true；`hiddenTitleWrites:0`，`releasedVisible/releasedWidthExact/undoRestoresPile/coordinatesExact`全部true。按钮第一项报告4,080个诊断节点、80个堆叠，属于该按钮已有落点算法的对照，不能和本次51,000节点Node索引基准混为整体画布性能结果。

旧QA入口存在两个与本次改动无关的验收问题：初始化曾显示生成历史`resolve`未定义提示；多个独立诊断浮层重叠，隐藏标题按钮中心被另一浮层遮住。主线程检查实际DOM和命中位置后点击未遮挡的按钮边缘完成验收，没有改生产页面或脚本调用绕过交互。该历史QA的旧logo/营销按钮不作为当前生产品牌证据。完整菜单、全部hover状态、长期运行与整体帧率仍需各自实测。
