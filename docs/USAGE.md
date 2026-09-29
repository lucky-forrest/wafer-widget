# wafer-widget 使用说明

wafer-widget 是一个基于 Canvas 2D + WebGL 的晶圆图（Wafer Map）渲染与标注组件：TypeScript 编写、无框架依赖、打包为 UMD 模块，可独立运行，也可嵌入 Vue / React 等任意宿主。

- API 速查见 [API.md](./API.md)
- 完整可运行示例见仓库根目录 [index.html](../index.html)（`npm run serve` 后访问）

---

## 目录

- [环境要求与安装](#环境要求与安装)
- [快速开始](#快速开始)
- [数据格式 WaferParams](#数据格式-waferparams)
- [配置项速览](#配置项速览)
- [图表类型](#图表类型)
- [交互操作](#交互操作)
- [常用场景示例](#常用场景示例)
- [事件](#事件)
- [性能指南](#性能指南)
- [从旧版本迁移](#从旧版本迁移)

---

## 环境要求与安装

- 构建环境：Node.js（rollup 2 构建，产物无 Node 依赖）
- 运行环境：支持 Canvas 2D 与 WebGL 的现代浏览器
- 新增运行时依赖：`big.js`（已内联打包进 UMD 产物，宿主无需额外安装）

```bash
npm install wafer-widget --save
```

或直接引 script 标签（UMD 全局变量 `WaferWidget`）：

```html
<script src="./lib/wafer-widget.min.js"></script>
```

---

## 快速开始

### 1. HTML

```html
<canvas id="wafer" width="600px" height="600px"></canvas>
<script src="./lib/wafer-widget.min.js"></script>
```

### 2. 最小配置

```js
const options = {
  backgroundColor: 'transparent',
  isShowGrid: false,
  basicConfig: {
    size: '600px',            // 画布尺寸兜底值（优先取 canvas.clientWidth）
    chartType: 'wafermap',    // wafermap | heatmap | contourmap
    wsConfig:   { visible: false, position: 'leftTop', data: [] },
    defectConfig: {
      visible: false,
      position: { x: 'X', y: 'Y' },  // defect 坐标字段名
      value: 'DEFECT_CODE',          // defect 分类字段名
      legendShape: [], legendSize: [], data: [],
      legendName: '', legendValue: '', legendColor: '', legendStatistic: '',
      transparency: 100, isSystemColor: true,
      isShowLegend: false, isSelection: true, isQuickFind: false,
    },
    wmConfig: {
      visible: true,
      position: { x: 'XUI', y: 'YUI' },  // die 坐标字段名
      value: 'BIN',                       // die 着色/取值字段名
      hightlight: '', shadow: '', border: '',
      data: [], isSelection: true, isRotate: true, isQuickFind: false,
      isShowLegendValue: false, isShowLegend: false,
      legendName: 'DATA_RANGE', legendValue: 'DATA_RANGE',
      legendColor: 'COLOR_CODE', legendStatistic: '',
      transparency: 100, isSystemColor: false,
    },
    shotConfig: { visible: false, color: 'red', position: { x: '', y: '' }, offsetX: '6', offsetY: '4' },
  },
  customBtns: [],
};
```

### 3. 实例化并喂数据

```js
const wafer = new WaferWidget('#wafer', options);

wafer.updateData({
  waferSummary: { LOT_ID: 'L001', YIELD: 0.97 },
  waferMap: {
    minX: 0, maxX: 101, minY: 0, maxY: 104,   // 坐标边界
    xCount: 102, yCount: 105,                 // 行/列总数（旧数据可用 xDieCount/yDieCount，按 +1 处理）
    minValue: 1, maxValue: 5,
    dataList: [
      { XUI: 36, YUI: 4, BIN: 1, _o_XUI: 36, _o_YUI: 4 },
      // ... die 列表
    ],
    legendList: [
      { DATA_RANGE: 1, COLOR_CODE: '#00ff37', hexColor: '#00ff37' },
      // ... 图例（legendValue 对应 BIN 值，legendColor 对应颜色字段）
    ],
  },
});
```

> **关于 `_o_` 前缀字段**：内部绘图统一读取 `_o_<字段名>`（如 `_o_XUI`）作为绘制坐标。若数据只提供原始字段（`XUI`），请在喂数据前自行生成 `_o_XUI`/`_o_YUI`；旋转（`setRotate`）时原始字段与 `_o_` 字段都会被使用。

### 4. ES Module 方式

```ts
import WaferWidget from 'wafer-widget'; // types: lib/index.d.ts

const wafer = new WaferWidget(canvasEl, options);
// 枚举挂在类静态属性上
wafer.setRotate(WaferWidget.WaferRotate['Notch向上']);
wafer.createType = WaferWidget.Shape.ClickSelect;
```

---

## 数据格式 WaferParams

```ts
interface WaferParams {
  waferSummary?: Record<string, any>;        // 摘要信息（wsConfig.data 决定显示哪些字段）
  waferMap?: {
    minX: number; maxX: number;              // die 坐标边界
    minY: number; maxY: number;
    xCount?: number; yCount?: number;        // 行/列总数（推荐）
    xDieCount?: number; yDieCount?: number;  // 旧格式：跨度，内部 +1
    minValue: number; maxValue: number;      // value 字段值域（热力图/等高线用）
    heatmapMinValue?: number; heatmapMaxValue?: number;  // 热力图筛选初始区间
    heatmapMinColor?: string;  heatmapMaxColor?: string; // 域外颜色
    dataList: Record<string, any>[];         // die 数据
    legendList: Record<string, any>[];       // die 图例
  };
  defect?: {
    minX: number; maxX: number; minY: number; maxY: number;
    xCount?: number; yCount?: number;
    minValue?: number; maxValue?: number;
    filePath?: string;
    dataList: Record<string, any>[];         // 缺陷数据（坐标支持小数，落点在 die 内偏移）
    legendList: Record<string, any>[];       // 缺陷图例
  };
  shot?: { dataList: Record<string, any>[] };   // Reticle 曝光场
  zone?: { dataList: Record<string, any>[] };   // 扇形分区（minAngleDegrees/maxAngleDegrees/minRadius/maxRadius/zoneNo）
}
```

---

## 配置项速览

仅列出直接影响渲染/交互的配置（完整字段见 [API.md](./API.md)），未标注"旧版"的均为新增能力：

### 顶层

| 配置 | 类型 | 说明 |
| --- | --- | --- |
| `backgroundColor` | `string` | 画布与轮廓圆填充色 |
| `isShowGrid` | `boolean` | 是否绘制 die 网格参考线（自适应线宽/颜色） |
| `isBackgroundImage` | `boolean` | 背景图片模式（waferscan 图片叠加） |
| `isShowWaferOutline` | `boolean` | 绘制晶圆外轮廓圆；缺省时 waferMap 不可见则绘制（旧版行为） |
| `redueOutlineRadius` | `number` | 轮廓圆半径缩减比例（相对一个 die 宽） |
| `isClipByWaferOutline` | `boolean` | 是否把绘制裁剪到圆内（默认 true） |
| `bgUrlField` | `string` | waferSummary 中背景图地址字段名 |

### basicConfig

| 配置 | 说明 |
| --- | --- |
| `chartType` | `'wafermap' \| 'heatmap' \| 'contourmap'`；缺省时由 `wmConfig.isHeatmap` 推断（旧版兼容） |
| `dotSelectionMode` | 点选结果模式：`'multiple'` 叠加（默认）/ `'single'` 单选 |
| `defaultRotate` | 数据装载后自动应用的 Notch 方向（`rotate0/90/180/270/xMirror/yMirror`） |
| `isAdaptiveSize` | 画布尺寸跟随容器宽 |
| `compressEmptyRowsColumns` | 稀疏 waferMap 压缩空行列（见[性能指南](#性能指南)） |
| `contourMapConfig` | 等高线参数：`{ dimension, power, lines, size, gridSize, valueRange }` |
| `backgroundSetting` | 背景图 `{ imageUrl, brightness, saturation, contrast, rotate }` |

### basicConfig.wmConfig（die 图层）

| 配置 | 说明 |
| --- | --- |
| `drawType` | `'whole'` 单色 / `'lbTort'`、`'ltTorb'` 双色对角（配合 `addedValue` 字段） |
| `label` | 格子数值文本的取值字段，缺省用 `value` |
| `heatmapColorList` | 热力图渐变色板（如 `['#0000FF','#00FF00','#FF0000']`） |
| `heatmapMinColor` / `heatmapMaxColor` | 颜色域外（低于/高于）的兜底色 |
| `heatmapLegendMode` | `'slider'` 连续色阶 / `'interval'` 离散区间色 |
| `heatmapLegendIntervalCount` | 区间模式分数（2–20，默认 10） |
| `transparency` | die 透明度（0–100） |

---

## 图表类型

通过 `basicConfig.chartType` 或 `updateOption` 切换，三种类型共用同一份数据：

### 晶圆图 wafermap（默认）

按 `wmConfig.legendList` 离散着色（`legendValue` → `legendColor`），图例切换显隐见 `toggleLegend` / `batchSetLegend`。

### 热力图 heatmap

```js
wafer.updateOption({
  basicConfig: {
    chartType: 'heatmap',
    wmConfig: {
      value: 'YIELD',
      heatmapColorList: ['#0000FF', '#00FF00', '#FF0000'],
      heatmapLegendMode: 'slider', // 或 'interval'
    },
  },
});
wafer.updateData(waferData, { fresh: true });

// 重设颜色域（同时把筛选区间重置为全域）
wafer.setHeatmapRange([min, max]);

// 或只调整筛选区间 / 隐藏部分区间
wafer.updateHeatmap([min, max]);            // 兼容旧版单阈值: updateHeatmap(threshold)
wafer.setHeatmapIntervalSelection([
  { key: 'i1', kind: 'normal', min: 0.2, max: 0.5, includeMin: true, includeMax: false },
]);
```

- 区间比较基于 **big.js** 十进制精确运算，微小数值区间不会因浮点舍入导致颜色塌缩。
- 数据可携带 `waferMap.heatmapMinValue/heatmapMaxValue` 作为初始筛选区间，`updateData` 时自动读取。
- 每个 die 会写入 `dieValueEnum`（-2/-1/0/1/2）标记其在筛选区间中的位置，便于导出统计。

### 等高线图 contourmap

基于反距离加权（IDW）插值生成高度场 + 等高线：

```js
wafer.updateOption({
  basicConfig: {
    chartType: 'contourmap',
    contourMapConfig: {
      dimension: 'die',        // 'die' | 'defect'
      power: 2,                // IDW 幂指数
      lines: 8,                // 等高线条数
      size: 5,                 // 控制点半径(px)
      gridSize: 90,            // 插值网格密度
      valueRange: [min, max],  // 高度归一化域
    },
  },
});
wafer.updateData(waferData, { fresh: true });
```

---

## 交互操作

| 操作 | 方式 |
| --- | --- |
| 缩放 | 滚轮（以鼠标为中心）/ 触屏双指；受设备 WebGL 安全上限约束 |
| 平移 | 鼠标右键拖拽 / 触屏单指拖拽 |
| 点选 die | `wafer.createType = WaferWidget.Shape.ClickSelect` 后：单击选中/取消单个 die，**拖框批量选中**框内所有 die |
| 单选/多选 | `setDotSelectionMode('single' | 'multiple')`；单选模式下新点选会清空旧点 |
| 局部放大 | `setLocalZoomMode(true)` 后拖一个矩形框 → 高分辨率源图重绘（非位图拉伸），完成触发 `localZoomComplete`；`clearLocalZoom()` 还原 |
| 标注 | `createType` 设为 `Shape.Rect / Polygon / Line / Circle / Grid / Dot` 后在画布上绘制；双击结束折线/多边形；Escape 回退；Backspace 删除 |
| 旋转/镜像 | `setRotate(WaferWidget.WaferRotate['Notch向左'])` 等 6 个方向；**绝对方向语义**，重复设置同一方向结果一致 |
| 快速查找 | `quickFind({ x, y })` 用原始坐标标记目标 die（红色描边，只保留最后一次） |

---

## 常用场景示例

### 更新数据 / 图例

```js
wafer.updateData(nextWaferData, { fresh: true });      // 第二个参数非空 = 全新数据装载（重置旋转/热力图区间）
wafer.updateDieLegend(newLegendList);                  // 更新 die 图例并重绘
wafer.updateDefectLegend(newDefectLegendList);
wafer.updateOption(partialOptions);                    // 合并配置并重绘
```

### 读取点选结果

```js
// 点选/框选结束后，取回 die 的原始坐标（非显示坐标）
const dies = wafer.getSelectedDieCoordinates();        // [{ x, y }, ...]

// 反向设置选中（原始坐标 → 自动换算显示位置）
wafer.setSelectedDies([{ x: 36, y: 4 }]);

// 判断缺陷点是否落在标记内
wafer.hasDefectsInMarks({ x: 3.2, y: 5.7 });

// 判断当前标记是否全部为点选
wafer.hasOnlyClickSelectMarks();
```

### 等待渲染完成 / 导出

```js
// redraw 后等待真实绘制与画布提交（而非固定帧数）
wafer.redraw();
await wafer.whenRendered();

// 导出：临时恢复小字号文本 → 等待重绘 → 下载/取回 canvas
const release = await wafer.prepareExport();
try {
  const canvas = await wafer.saveImage(false);  // true = 直接触发 JPEG 下载
} finally {
  release();
}
```

### 大数据/多实例页面

```js
// 实例进入后台/隐藏时暂停渲染（保留数据与交互状态），恢复可见时继续
wafer.setRenderingPaused(true);
wafer.setRenderingPaused(false);

// 渲染版本号：数据或用户视图操作是否发生过变化（导出快照失效判断）
const changed = wafer.getRenderVersion() > savedVersion;
```

---

## 事件

```js
const off = (name, cb) => { wafer.on(name, cb); return () => wafer.off(name, cb); };
```

| 事件 | 触发时机 |
| --- | --- |
| `load` | setImage 图片加载完成 |
| `drawingStart` / `drawingEnd` | 渲染队列开始/结束一轮真实绘制 |
| `updated` | 视图画布每帧提交完成（参数：dataset） |
| `hover` | 鼠标移动（参数：`{ x, y, dieData, defectData }`，坐标已按压缩/旋转换算） |
| `select` | 选中标注 / 点选完成（参数：shape 或 null） |
| `add` / `delete` | 标注新增/删除；点选模式下点选完成也会触发 add |
| `warn` | 操作不合法提示（如矩形过小） |
| `contextmenu` | 右键菜单 |
| `localZoomComplete` | 局部放大框选完成并重绘 |

---

## 性能指南

本版本渲染管线对齐了大数据场景的生产实现，并在其上做了专项优化（以下数据为 Chrome 实测，10 万 die 圆形随机布点、600×600 画布）：

| 场景 | 优化前 | 优化后 |
| --- | --- | --- |
| 等高线 10 万控制点：首次 / 同数据重绘 / 换数据 | ~9.5s | **~1.1s / 1.0s / 0.8s** |
| 晶圆图全量重绘：8k / 50k / 100k | 30 / 50 / 58ms | 热态 17 / 21 / 48ms |
| 悬停命中查找（每次鼠标移动，10 万 die） | ~0.77ms 线性扫描 | **~0.03ms Map 索引** |
| 旋转（10 万 die） | 数百 ms（含整包深拷贝） | **~140ms** |
| 压缩空行列开启后重绘 | +30~70ms（每绘重建排序） | 与关闭持平 |

核心机制：

1. **渲染队列与请求合并**：所有重绘请求先合并去重；超过 5 万点的任务进入页面级共享队列（`waferRenderQueue`），多实例串行执行 WebGL 重绘，避免并发争抢 GPU；隐藏/销毁时通过 `AbortSignal` 在安全检查点取消。
2. **WebGL 上下文与着色器复用**：同一实例的上下文、编译好的 program 跨绘制复用（实测免去每次 12~19ms 的固定重建开销），空闲 30 秒后自动 `loseContext` 释放，多实例不会长期占用浏览器上下文配额；上下文被浏览器回收时自动重建。
3. **分块分图层渲染**：die 按图层（rect/border/glow/mask）× 5 万点分块生成顶点并绘制，只为当前图层需要的元素分配内存；块间让出主线程，长任务可被新数据打断。
4. **等高线 K 近邻 IDW**：控制点超过 2048 时启用空间分桶逐环收集近邻（约 32 个，至少一圈），替代全量遍历——反距离权重随距离快速衰减，近似结果肉眼不可辨；幂指数为 2 时权重直接用 `1/d²`，跳过开方与乘方。实测高度场计算 **9.5s → 89ms（约 107×）**。
5. **等高线高度场缓存**：控制点集 / 配置变化才重算高度场；缩放、普通重绘只按当前画布尺寸重排坐标（IDW 权重只依赖距离比值，对整体缩放不变）；控制点绘制在超过 2000 个时抽样显示并隐藏高度标签。
6. **坐标压缩脏标记**：`compressEmptyRowsColumns` 的压缩表（Set + sort）只在数据 / 坐标字段 / 开关变化时重建，重绘零额外开销。
7. **悬停命中索引**：die / defect 按显示坐标建 `Map<"x_y", 行>`，`getPoint` 由 O(n) 线性扫描降为 O(1)，大数据下鼠标移动不再卡顿。
8. **热力图颜色 memo**：同一次绘制内相同原始值（含 `addedValue` 双色字段）复用颜色与 `dieValueEnum`，Big.js 构造与区间比较只发生在不同值上。
9. **defect 符号精灵**：符号按（字形, 颜色, 0.5px 档位尺寸）预渲染为小图后 `drawImage`，替代逐缺陷 `fillText`。
10. **缩放交互**：缩放/文字可辨认状态变化时 400ms 防抖重绘矢量晶圆图；缩放上限受设备 WebGL 安全尺寸探测值约束；`getBoundingClientRect` 结果在画布重置时缓存，滚轮缩放不再每 tick 强制布局。
11. **旋转去深拷贝**：`setRotate` 旋转只读未被修改的原始坐标字段、`map` 产出新行对象后再归一化，不再 `cloneDeep` 整包 waferData。
12. **可辨字过滤**：格子里数值文本小于 6 CSS 像素时自动跳过绘制（`canDrawScreenLegendValue`），缩放到可辨认阈值才触发重绘补字。

实践建议：

- die 数量 > 5 万时开启 `compressEmptyRowsColumns`（若数据稀疏）；
- 页面存在多个晶圆图（表格/画廊场景）时，不可见实例调用 `setRenderingPaused(true)`；
- 需要截图/导出时使用 `prepareExport + whenRendered` 组合，不要依赖固定 setTimeout；
- `toggleLegend / batchSetLegend / setScale` 内部已做防抖合并，可直接在高频交互中调用。

---

## 从旧版本迁移

本版本保持旧版公共 API 兼容，旧代码可零改动运行：

| 旧写法 | 现状 |
| --- | --- |
| `new WaferWidget(el, options)` + `updateData(data)` | ✅ 不变；`updateData` 新增可选第 3、4 参数 |
| `wmConfig.isHeatmap: true` | ✅ 继续生效（`chartType` 缺省时自动推断），颜色仍按图例首尾插值 |
| `updateHeatmap(value: number)` | ✅ 兼容（等价 `[value, MAX_SAFE_INTEGER]`），推荐改传 `[min, max]` |
| 数据 `xDieCount/yDieCount` | ✅ 兼容（内部 +1 修正）；新数据推荐 `xCount/yCount` |
| `WaferRotate['旋转90°']` 等旧键名 | ✅ 保留；推荐改用 `Notch向左/向右/向上/向下/Notch-X镜像/Notch-Y镜像` |
| `wafer.remmber` / `remmberOrigin` / `offScreenCtx` / `xDieCount` / `yDieCount` | ✅ 以 getter/setter 形式保留别名，推荐改用 `remember` / `rememberOrigin` / `offscreenCtx` / `xCount` / `yCount` |
| `update()` 返回值 | 现返回 `Promise<void>`（画布真实提交完成），旧代码忽略返回值不受影响 |
| `saveImage()` | ✅ 保留，内部自动等待渲染完成 |
| `lib/src/index.d.ts` | 类型入口改为 `lib/index.d.ts`（package.json 已更新） |

枚举访问方式统一为类静态属性：`WaferWidget.Layer` / `WaferWidget.WaferRotate` / `WaferWidget.Shape`。

---

## 本地开发

```bash
npm install
npm run build     # rollup 打包 → lib/wafer-widget.min.js (+ .d.ts)
npm run watch     # 监听构建
npm run serve     # 起本地服务查看 index.html 示例
```

目录结构：

```
src/
├── index.ts                  # WaferWidget 主类（渲染管线、交互、公开 API）
├── render-queue.ts           # 页面级 WebGL 渲染队列（并发限制 + 取消）
├── coordinate-compression.ts # 稀疏坐标压缩
├── tools.ts                  # 颜色/数值工具（带缓存）
├── event-bus.ts              # 事件总线
└── shape/                    # 标注形状（矩形/多边形/折线/圆/网格/点/点选/快查）
```
