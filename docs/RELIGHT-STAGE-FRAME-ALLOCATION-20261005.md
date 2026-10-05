# 重打光预览每帧临时对象复用 · 2026-10-05

仅修改 `image-relight-stage.mjs`，以 [参数与预览合同](RELIGHT-PARAMETER-EDIT-CONTRACT-20261005.md) 为边界，保留主/轮廓光位、半径6、色温色值、亮度映射、相机、插值速度、拖动与键盘合同。

- `vec` 可以直接写入主光或轮廓光已有的 `group.position`，每帧不再为两盏灯创建临时 `Vector3`。建网格和圆点时仍生成各自独立点，避免共享可变几何。
- 两灯及其主/轮廓标记的三个数组只在该stage建立时创建一次。
- 非选中辅助线的 `0x444444` 灰色 `Color` 只在该stage建立时创建一次，帧内只读取其RGB。

对象均属于单个stage，没有跨预览共享的可变状态。每帧RAF、`renderer.render`、灯锥shader `time`、颜色/光位/相机插值、辅助线/圆点动态仍按原算法执行；没有改为静态渲染或停掉可见动画。纹理生命周期、缩放、光源命中与手势代码未更改。

## 聚焦证据

`tests/image-relight-stage-allocation.test.cjs` 执行修改前后完整生产 `createStage/animate`，保留真实Three.js场景、灯、材质、几何、相机和数学，仅用假renderer避免要求GPU，用可控时钟/RAF逐帧对照。基线仅将本次三个复用点还原为修改前代码。

60帧（其中10帧主光拖动）包含亮度/色温变化、主光位置变化、正面/透视切换、轮廓光启停、轮廓光快捷键与主光键盘调整：

| 目标分配点 | 原60帧 | 本次60帧 |
| --- | ---: | ---: |
| 灯位临时Vector3 | 120 | 0 |
| 拖动中非选线灰色Color | 110 | 0 |
| 两灯遍历外层/元组数组 | 180 | 0 |

本次在初始化时新增一个灰色Color和三个常驻灯遍历数组。计数只覆盖上述显式构造，不把其他Three.js内部对象、`snapAngle`或其余JavaScript分配算成0，也不据此声称GPU耗时或FPS提升。

每帧比较灯位/方向/强度/颜色、灯泡与灯锥所有uniforms（包括持续递增的time）、相机位置/方向、静态辅助线位置缓冲与动态颜色/透明度缓冲、圆点位置/颜色/透明度，以及图片加载标记。全部严格相等；屏幕投影坐标精确相等。两stage独立，卸载停止RAF、解除监听，销毁后晚到纹理仍立即释放。

```sh
node --test tests/image-relight-stage-allocation.test.cjs tests/image-relight.test.cjs
node --check image-relight-stage.mjs
node --check tests/image-relight-stage-allocation.test.cjs
git diff --check
```

两条舞台等效/生命周期检查及七条原参数/拖动/屏幕定位检查通过。该定向工具没有执行WebGL raster；主线程随后已在正式Three预览实操视图、光位、轮廓光、亮度/色温、重置和关闭，并保存[实际截图](LOCAL-RELIGHT-AGENT-20261005.md)。没有执行自动逐像素对照或GPU性能测量，不把数学等效当作全站视觉验收。没有新增依赖或修改用户数据。
