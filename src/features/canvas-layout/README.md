# 多选布局坐标应用性能

官方规则见 [画布分组与布局](../../../reference/canvas-groups.md)：宫格留白、间距、顺序和 Dagre 横向依赖布局沿用现有定义。世界坐标为绝对值，成员关系不增加父坐标。

## 本次优化

`app.js` 的 `CanvasApp.layoutNodes` 调用 `CanvasGroups.layout`。原先每放置一个选中节点，都会用 `positions` 重建整图后代关系、过滤全部节点，再由 `translate` 重建整图节点索引。全选 N 个普通节点时，该坐标应用循环为 O(N²)。

`canvas-groups.js` 现在只在一次布局内建立关系索引、原图顺序记录和节点索引。仍按原选中节点顺序处理；每一步捕获该子树的**当前**坐标，按原图顺序应用位移。因此堆叠与其成员同时入选、嵌套组、缺失成员链接、重复记录和循环关系保留旧行为。索引不跨布局调用缓存，撤销替换或成员编辑会重新读取。宫格和 Dagre 算法没有变化。

## 定向测量

可重复执行：

```bash
node src/features/canvas-layout/qa/measure.cjs
node --test tests/canvas-layout-application-performance.test.cjs tests/canvas-groups.test.cjs tests/canvas-group-descendants.test.cjs
```

`measure.cjs` 使用真实当前布局函数；对照只把坐标应用循环替换为原 `positions + translate`，宫格计算完全相同。ID getter 记录节点读取量，`performance.now` 记录 Node CPU 耗时。2026-10-03 本机三次测量中位数：

| 全选数量 | 原节点 ID 读取 | 优化后读取 | 原中位耗时 | 优化后中位耗时 |
|---|---:|---:|---:|---:|
| 1000 | 2,006,000 | 8,000 | 145.17 ms | 1.46 ms |
| 4000 | 32,024,000 | 32,000 | 2592.47 ms | 4.46 ms |

这些值包含测量 getter 的开销，不是浏览器帧率或生产动作总耗时。17 项定向检查通过，包括真实分组/布局、父子顺序、重复 ID、缺失链接、循环、成员变化与 180 组混合图对照。

## 生产主壳 QA

入口：`/src/features/canvas-layout/qa/main.html?session=oct03-layout-01&count=1000`。`count` 支持 10–4000；新 session 创建新的隔离项目与 IndexedDB，不覆盖任何现有记录。

页面动态读取当前 `/index.html` 并加载生产 `app.js`、`canvas-groups.js`、`CanvasStore`、布局工具栏和撤销链。夹具只有确定性的本机小 SVG，没有生成结果；API 和外部 fetch 被明确禁止。启动只在不存在的隔离项目记录中写 seed，生产读取等待 seed 事务完成后照常执行。偏好键使用页面内隔离映射。

右上按钮依次提供：全选、宫格布局、单次撤销、重做、保存回读、刷新、新隔离 session。诊断显示同步总动作耗时、等待两次绘制帧的耗时、世界坐标最大误差、视图是否不变、撤销/重做/保存的逐项坐标相等检查。这些浏览器数据包含渲染、撤销快照和持久化等现有链路成本，不能与纯算法 CPU 探针混为一项。

静态语法检查与 Node 测量不能证明浏览器体验已验收。主任务须实际点击并观察诊断，再记录生产主壳验证结果。
