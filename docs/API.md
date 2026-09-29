# wafer-widget API 参考

- [构造函数](#构造函数)
- [配置项 WaferWidgetOptions](#配置项-waferwidgetoptions)
- [数据结构 WaferParams](#数据结构-waferparams)
- [枚举](#枚举)
- [实例属性](#实例属性)
- [方法](#方法)
- [事件](#事件)
- [标注绘制与交互细节](#标注绘制与交互细节)
- [渲染与性能说明](#渲染与性能说明)

源码入口为 `src/index.ts`，类型声明见 `lib/index.d.ts`（构建产物，`package.json` 的 `types` 字段）。上手教程见 [USAGE.md](./USAGE.md)。

## 构造函数

```ts
new WaferWidget(el: HTMLCanvasElement | string, options: WaferWidgetOptions)
```

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `el` | `HTMLCanvasElement \| string` | canvas 元素或合法 CSS 选择器 |
| `options` | `WaferWidgetOptions` | 组件配置，见下文 |

构造时若传入的是 canvas 元素，会立即初始化尺寸、绑定事件并执行一次初始绘制；否则仅输出 `HTMLCanvasElement is required!` 警告。

画布尺寸取值优先级：`canvas.clientWidth` → `basicConfig.size`（去除单位后的数字）→ 兜底 `600`。

## 配置项 WaferWidgetOptions

> 标注「宿主槽位」的配置项由组件的类型定义保留、但**当前源码并不读取**，它们服务于接入本组件的低代码 / 可视化平台，随 `options` 原样透传；标注「✓」的配置项直接驱动组件渲染与交互。

### 顶层

| 配置 | 类型 | 说明 |
| --- | --- | --- |
| `backgroundColor` | `string` | 画布背景色，同时作为晶圆轮廓圆填充色 ✓ |
| `isShowGrid` | `boolean` | 是否绘制 die 网格参考线（线宽 / 颜色随密度自适应） ✓ |
| `isBackgroundImage` | `boolean` | 背景图片模式（waferScan 图片叠加，圆形裁剪 + 滤镜） ✓ |
| `isShowWaferOutline` | `boolean` | 是否绘制晶圆外轮廓圆；缺省时 waferMap 不可见则绘制（旧版行为） ✓ |
| `redueOutlineRadius` | `number` | 轮廓圆半径缩减比例（相对一个 die 宽度） ✓ |
| `isClipByWaferOutline` | `boolean` | 是否把绘制区域裁剪到轮廓圆内（默认 `true`） ✓ |
| `bgUrlField` | `string` | `waferSummary` 中背景图地址字段名（优先于 `backgroundSetting.imageUrl`） ✓ |
| `basicConfig` | `object` | 各图层基础配置，见下 ✓ |
| `customBtns` | `CustomBtnConfig[]` | 自定义按钮配置（宿主槽位） |

### basicConfig

| 配置 | 类型 | 说明 |
| --- | --- | --- |
| `size` | `string` | 画布尺寸兜底值，如 `'600px'` ✓ |
| `chartType` | `'wafermap' \| 'heatmap' \| 'contourmap'` | 图表类型；缺省时由 `wmConfig.isHeatmap` 推断（旧版兼容） ✓ |
| `dotSelectionMode` | `'multiple' \| 'single'` | die 点选结果模式，默认 `multiple` ✓ |
| `defaultRotate` | `string` | 数据装载后自动应用的 Notch 方向（`rotate0/90/180/270/xMirror/yMirror`） ✓ |
| `isAdaptiveSize` | `boolean` | 画布尺寸跟随容器宽 ✓ |
| `compressEmptyRowsColumns` | `boolean` | 稀疏 waferMap 压缩空行列（也可用 `setCompressEmptyRowsColumns` 动态切换） ✓ |
| `backgroundSetting` | `object` | 背景图参数 `{ imageUrl, brightness, saturation, contrast, rotate }` ✓ |
| `contourMapConfig` | `object` | 等高线参数 `{ dimension, power, lines, size, gridSize, valueRange }` ✓ |
| `isMeasure` | `boolean` | 测距开关（宿主槽位，折线标注本身带测距 label） |
| `isFullscreen` | `boolean` | 全屏开关（宿主槽位） |
| `isReturnDataInatches` / `isReturnDataInBatches` | `boolean` | 批量返回数据开关（宿主槽位；后者为新拼写） |
| `wsConfig` | `object` | Wafer Summary 图层配置 |
| `wmConfig` | `object` | Wafer Map（die）图层配置 |
| `defectConfig` | `object` | 缺陷图层配置 |
| `shotConfig` | `object` | Shot / Reticle 图层配置 |

### basicConfig.wsConfig（晶圆摘要）

| 配置 | 类型 | 说明 |
| --- | --- | --- |
| `visible` | `boolean` | 是否绘制摘要 ✓ |
| `position` | `'leftBottom' \| 'leftTop' \| 'rightBottom' \| 'rightTop'` | 绘制位置 ✓ |
| `data` | `{ title: string; content: string }[]` | 展示项，`content` 为 `waferSummary` 的键名 ✓ |
| `wsDataSet` | `Record<string, any>` | 数据源描述（宿主槽位） |

### basicConfig.wmConfig（die 分布图）

| 配置 | 类型 | 说明 |
| --- | --- | --- |
| `visible` | `boolean` | 是否渲染 die；关闭时（且 `isShowWaferOutline` 未显式设置）绘制圆形晶圆轮廓 ✓ |
| `position` | `{ x: string; y: string }` | die 坐标字段名（如 `XUI` / `YUI`，对应数据中的 `_o_XUI` / `_o_YUI`） ✓ |
| `value` | `string` | 用于图例着色 / 数值显示的字段名 ✓ |
| `label` | `string` | 数值文本取值字段，缺省用 `value` ✓ |
| `isHeatmap` | `boolean` | 旧版热力图开关：`chartType` 缺省时生效，颜色按图例首尾插值（兼容模式） ✓ |
| `drawType` | `'whole' \| 'lbTort' \| 'ltTorb'` | 着色方式：单色 / 双色对角（配合 `addedValue` 字段） ✓ |
| `addedValue` | `string` | 双色模式下第二个取值字段名 ✓ |
| `border` | `string` | 字段名：该字段为真的 die 绘制黑色边框 ✓ |
| `hightlight` | `string` | 字段名：该字段为真的 die 绘制紫色高亮边框 ✓ |
| `shadow` | `string` | 字段名：该字段为真的 die 绘制灰色遮罩 + 黄色发光效果 ✓ |
| `isShowLegendValue` | `boolean` | 是否在 die 上绘制数值文本（字号 <6 CSS 像素自动省略） ✓ |
| `heatmapColorList` | `string[]` | 热力图渐变色板，如 `['#0000FF','#00FF00','#FF0000']` ✓ |
| `heatmapMinColor` / `heatmapMaxColor` | `string` | 低于 / 高于颜色域的兜底色 ✓ |
| `heatmapLegendMode` | `'slider' \| 'interval'` | 热力图图例模式：连续色阶 / 离散区间色 ✓ |
| `heatmapLegendIntervalCount` | `number` | 区间模式分数（2–20，默认 10） ✓ |
| `legendValue` / `legendColor` / `legendName` | `string` | `legendList` 中值 / 颜色 / 名称的字段名 ✓ |
| `transparency` | `number` | die 透明度 0–100，参与图例颜色与热力图色阶换算 ✓ |
| `isSystemColor`、`isSelection`、`isRotate`、`isQuickFind`、`isShowLegend`、`legendLayout`、`legendDataSet`、`legendStatistic`、`data`、`wmDataSet` | — | 宿主槽位 |

### basicConfig.defectConfig（缺陷图）

| 配置 | 类型 | 说明 |
| --- | --- | --- |
| `visible` | `boolean` | 是否渲染缺陷 ✓ |
| `position` | `{ x: string; y: string }` | 缺陷坐标字段名（对应数据中的 `_o_<x>` / `_o_<y>`） ✓ |
| `value` | `string` | 用于图例着色的字段名 ✓ |
| `legendShape` | `{ title: string; content: string }[]` | 符号映射规则，见下文「条件表达式」 ✓ |
| `legendSize` | `{ title: number; content: string }[]` | 大小映射规则，`title` 为字号 ✓ |
| `legendColor` / `legendValue` / `legendName` | `string` | `legendList` 中颜色 / 值 / 名称的字段名 ✓ |
| `isSystemColor`、`isSelection`、`isQuickFind`、`isShowLegend`、`legendLayout`、`legendDataSet`、`legendStatistic`、`transparency`、`data`、`defectDataSet` | — | 宿主槽位 |

**条件表达式**（`legendShape` / `legendSize` 的 `content`）：组件会将每项的 `content` 作为函数体构造 `new Function('params', content)` 并以 `{ row }` 调用，返回第一个真值项的 `title`。例如：

```js
legendShape: [
  { title: 'fiveStar', content: 'return params.row.DEFECT_SIZE > 10;' },
  { title: 'smallDot', content: 'return true;' },
]
```

`title` 支持的符号：`circle`(◉)、`doji`(✦)、`fiveStar`(★)、`flag`(⚑)、`rect`(■)、`smallDot`(●)、`triangle`(▲)、`十`(+)，其余值绘制 `*`。

### basicConfig.shotConfig（曝光场）

| 配置 | 类型 | 说明 |
| --- | --- | --- |
| `visible` | `boolean` | 是否绘制 ✓ |
| `color` | `string` | 矩形描边颜色（支持 CSS 颜色） ✓ |
| `position` | `{ x: string; y: string }` | 左上角坐标字段名 ✓ |
| `offsetX` / `offsetY` | `string` | 字段名：矩形跨越的 die 列数 / 行数 ✓ |

## 数据结构 WaferParams

`updateData(waferData, ...)` 的入参：

```ts
interface WaferParams {
  waferSummary?: Record<string, any>;
  waferMap?: {
    minX: number; maxX: number; minY: number; maxY: number; // 坐标范围
    xCount?: number; yCount?: number;    // x / y 方向 die 总数（推荐，旋转行列交换的基准）
    xDieCount?: number; yDieCount?: number; // 旧格式：跨度，内部按 +1 修正为总数
    minValue: number; maxValue: number;  // value 值域（热力图 / 等高线归一化域）
    heatmapMinValue?: number; heatmapMaxValue?: number; // 热力图筛选初始区间
    heatmapMinColor?: string; heatmapMaxColor?: string; // 颜色域外兜底色
    dataList: Record<string, any>[];     // die 数据行
    legendList: Record<string, any>[];   // die 图例
  };
  defect?: {
    minX: number; maxX: number; minY: number; maxY: number;
    xCount?: number; yCount?: number;
    minValue?: number; maxValue?: number;
    filePath?: string;
    dataList: Record<string, any>[];     // 坐标支持小数（die 内偏移保留）
    legendList: Record<string, any>[];   // 缺陷图例
  };
  shot?: { dataList: Record<string, any>[] };
  zone?: { dataList: Record<string, any>[] };
}
```

- `waferMap.dataList` / `defect.dataList` 每行必须包含 `_o_<position.x>`、`_o_<position.y>` 两个 0 基准 die 坐标字段（例如 `position.x = 'XUI'` 时为 `_o_XUI`）。这两个字段由**调用方预先计算**，组件用它们完成绘制、hover 命中与压缩映射；`setRotate` 旋转优先读取**原始字段**（`XUI` / `YUI`，缺失时回退 `_o_` 字段）以支持绝对方向语义。
- `legendList` 每行至少包含 `legendValue` / `legendColor`（die 建议额外提供 `hexColor` 供旧版热力图插值）。颜色支持 `#RGB`、`#RRGGBB`、CSS 颜色名、`rgb()` / `rgba()`。
- `zone.dataList` 每行字段：`zoneNo`、`minAngleDegrees`、`maxAngleDegrees`、`minRadius`、`maxRadius`。

## 枚举

枚举挂在类静态属性上访问：`WaferWidget.Layer` / `WaferWidget.WaferRotate` / `WaferWidget.Shape`。

```ts
enum Layer { map, defect }        // 图例所属图层：die / 缺陷

enum WaferRotate {                // setRotate 入参（值为字符串，同一方向保留新旧两套键名）
  // Notch 方向语义（推荐）
  'Notch-X镜像' = 'xMirror',
  'Notch-Y镜像' = 'yMirror',
  'Notch向上' = 'rotate180',
  'Notch向下' = 'rotate0',        // 默认方向
  'Notch向右' = 'rotate270',
  'Notch向左' = 'rotate90',
  // 兼容旧版命名
  X镜像 = 'xMirror',
  Y镜像 = 'yMirror',
  '旋转90°' = 'rotate90',
  '旋转180°' = 'rotate180',
  '旋转270°' = 'rotate270',
  重置 = 'rotate0',
}

enum Shape {                      // 标注形状（createType / setData 的 type）
  None = 0, Rect = 1, Polygon = 2, Dot = 3, Line = 4,
  Circle = 5, Grid = 6, ClickSelect = 7, QuickFind = 8,
}
```

## 实例属性

### 模式控制

| 属性 | 类型 / 默认值 | 说明 |
| --- | --- | --- |
| `lock` | `boolean` / `false` | 只读锁定：禁止一切画布交互（鼠标、滚轮缩放） |
| `readonly` | `boolean` / `false` | 只读：可查看、选中，但不能创建 / 编辑标注 |
| `scrollZoom` | `boolean` / `true` | 是否允许滚轮缩放 |
| `createType` | `Shape` / `None` | 当前绘制模式，设为对应形状后进入绘制 |
| `focusMode` | `boolean` / `false` | 专注模式：仅渲染当前选中标注（建议用 `setFocusMode()` 切换） |
| `ctrlCode` | `string` / `'ControlLeft'` | 暂停标注功能所用快捷键的 `KeyboardEvent.code` |
| `gridMenuEnable` | `boolean` / `true` | 网格右键行列输入菜单开关 |
| `isMagnifierVisible` | `boolean` / `true` | 编辑控制点时是否显示放大镜 |
| `magnifierPosition` | `'auto' \| [number, number]` / `'auto'` | 放大镜位置，`auto` 跟随鼠标 |

### 标注样式（未单独设置的标注的兜底值）

| 属性 | 默认值 | 说明 |
| --- | --- | --- |
| `strokeStyle` | `'#0f0'` | 标注边线颜色 |
| `fillStyle` | `'rgba(0, 0, 255, 0.1)'` | 标注填充颜色 |
| `activeStrokeStyle` | `'#f00'` | 选中标注边线颜色 |
| `activeFillStyle` | `'rgba(255, 0, 0, 0.1)'` | 选中标注填充颜色 |
| `lineWidth` | `3` | 标注边线宽度 |
| `ctrlRadius` | `3` | 控制点半径 |
| `ctrlStrokeStyle` / `ctrlFillStyle` | `'#000'` / `'#fff'` | 控制点样式 |
| `gridSelectedFillStyle` | `'rgba(255, 255, 0, 0.6)'` | 网格分区选中填充色 |
| `MIN_WIDTH` / `MIN_HEIGHT` / `MIN_RADIUS` | `10` / `10` / `5` | 矩形 / 圆形最小尺寸，低于时丢弃并触发 `warn` 事件 |

### 标签（label）

| 属性 | 默认值 | 说明 |
| --- | --- | --- |
| `hideLabel` | `false` | 是否隐藏标注标签 |
| `labelUp` | `false` | 标签朝上展示（空间不足时自动翻转） |
| `labelFont` | `'10px sans-serif'` | 标签字体 |
| `labelFillStyle` | `'#fff'` | 标签背景色 |
| `textFillStyle` | `'#000'` | 标签文字色 |
| `labelMaxLen` | `10` | 标签最大字符数，超出显示省略号 |

### 状态（只读参考）

| 属性 | 说明 |
| --- | --- |
| `dataset` | 当前全部标注实例数组 |
| `activeShape`（getter） | 当前选中标注 |
| `scale`（getter） | 当前缩放比例 |
| `waferData` | 当前晶圆数据 |
| `isDrawing` | 渲染队列是否正在执行一轮真实绘制 |
| `selectedDefectLegendValues`（getter） | 当前被排除（隐藏）的缺陷图例值列表 |

### 旧版属性名兼容（deprecated）

以下别名保留 getter/setter，等价于新名称：`remmber` → `remember`、`remmberOrigin` → `rememberOrigin`、`offScreenCtx` → `offscreenCtx`、`xDieCount`/`yDieCount` → `xCount`/`yCount`。

## 方法

### 数据与图例

| 方法 | 说明 |
| --- | --- |
| `updateData(waferData, contextParams?, callbackFn?, isResize?)` | 合并更新晶圆数据、重建坐标压缩、刷新图例映射并重绘。`contextParams` 非空且带 `waferMap` 时视为**全新装载**：重置旋转方向、热力图区间覆盖与等高线控制点，并记录原始边界（`waferBoundary`）；`callbackFn({ option, data, ...contextParams })` 可在数据更新时联动返回新配置；`isResize`（默认 `true`）控制是否重置画布尺寸 |
| `updateOption(option)` | 深合并更新配置并重绘，返回 `Promise<WaferWidgetOptions>`（合并后的配置） |
| `updateDieLegend(legendList?)` | 更新 die 图例映射（颜色按 `transparency` 转换为 WebGL 格式）；不传参仅重建映射 |
| `updateDefectLegend(legendList?)` | 更新缺陷图例映射 |
| `toggleLegend(type: Layer, legendValue, callback)` | 切换某图例的显示 / 隐藏（内部维护排除列表），回调返回当前全部被排除的图例值，随后防抖重绘 |
| `batchSetLegend(type: Layer, legendValues)` | 整体替换排除列表，随后防抖重绘 |
| `getDieDisplayPosition(die)` / `getDefectDisplayPosition(defect)` | 取单条数据在**显示坐标系**（含旋转 / 压缩换算）中的位置；宿主做数据联动时使用 |

### 热力图

| 方法 | 说明 |
| --- | --- |
| `updateHeatmap(value: number \| [number, number])` | 更新热力图筛选区间；兼容旧版单阈值（等价 `[value, MAX_SAFE_INTEGER]`）。只影响颜色与筛选，不重置画布状态 |
| `setHeatmapRange(value: [number, number])` | 重设颜色域并把筛选区间重置为新全域（写覆盖标记，后续 `updateData` 不再从数据读取）；返回是否生效 |
| `getHeatmapRange()` | 返回当前颜色域 `[min, max]` |
| `setHeatmapIntervalSelection(intervals: HeatmapLegendInterval[])` | 设置区间图例中被隐藏的区间（`{ key, kind, min, max, includeMin, includeMax }`） |
| `setHeatmapLegendConfig(mode: 'interval' \| 'slider', intervalCount)` | 切换连续色阶 / 离散区间色并重绘 |
| `updateHeatmapValue()` | 从 `waferMap.heatmapMinValue/heatmapMaxValue` 读取初始区间（`redraw` 内部自动调用） |

> 热力图区间比较基于 big.js 十进制精确运算；每个 die 绘制时会写入 `dieValueEnum`（-2 域外低 / -1 区间外 / 0 区间内 / 1 区间外 / 2 域外高）。

### 视图控制

| 方法 | 说明 |
| --- | --- |
| `redraw()` | 立即重绘（内部先刷新等高线配置、热力图初始区间与图例映射） |
| `resize(canvasSize?)` | 重新初始化画布尺寸并重绘；可传显式尺寸（走渲染队列，重复调用自动合并） |
| `fitZoom(invalidate?)` | 适配画布，居中显示；返回 `Promise<void>` |
| `setScale(type, byMouse?, pure?)` | 缩放：`type` 为 `true` 放大 5%、`false` 缩小 5%；`byMouse` 以鼠标为中心；`pure` 只计算不绘制。放大受设备 WebGL 安全上限（`MAX_TEXTURE_SIZE` 等探测值）约束，缩小下限为画布尺寸 |
| `setRotate(rotateAngle: WaferRotate)` | 镜像 / 旋转（**绝对方向**语义，重复设置同一方向结果一致）：从原始坐标字段出发变换 die 与缺陷数据，行列数按方向交换，随后 `updateData` 重绘 |
| `quickFind(point)` | 快速查找：按原始坐标标记目标 die（红色描边，只保留最后一次）；非 die 坐标忽略 |
| `getActiveQuickFindPoint()` | 返回最后一次快速查找的原始坐标（无则 `null`） |
| `setFocusMode(type)` | 切换专注模式 |
| `setLocalZoomMode(enabled)` | 开启一次性局部放大框选（画布变十字光标），拖框完成后高分辨率重绘并触发 `localZoomComplete`，随后自动退出该模式 |
| `clearLocalZoom()` | 清除局部放大并还原完整视图 |
| `setCompressEmptyRowsColumns(enabled)` | 开启 / 关闭稀疏 waferMap 空行列压缩并重绘 |
| `setImage(url)` | 设置 / 切换底层背景图 |
| `saveImage(download?)` | 导出图片：700×600 JPEG（左侧 600×600 晶圆图 + 右侧图例）。内部先 `whenRendered()` 等待真实绘制完成；`download=true`（默认）触发下载，文件名 `wafer-<时间戳>.jpg`；传 `false` 返回 canvas 元素 |

### 渲染控制

| 方法 | 说明 |
| --- | --- |
| `whenRendered()` | 等待渲染队列与最后一次画布提交真实完成（含绘制过程中新排入的适配任务）；实例已销毁或上次绘制失败时抛错 |
| `prepareExport()` | 导出前调用：临时恢复小字号数值文本并等待完整重绘，返回 `release()`（导出完成后必须调用以恢复屏幕显示状态） |
| `setRenderingPaused(paused)` | 页面实例隐藏 / 进入后台时暂停渲染（数据、选择、缩放状态保留），恢复可见时续画 |
| `flushPendingDraw()` | 立即提交防抖中的重绘任务 |
| `getRenderVersion()` | 渲染版本号：数据更新或用户视图操作会递增，可用于判断导出快照是否失效 |

### die 点选

| 方法 | 说明 |
| --- | --- |
| `setDotSelectionMode(mode)` | 点选结果模式：`'multiple'` 叠加（默认，兼容旧版）/ `'single'` 单选（新点选清空旧点） |
| `setSelectedDies(points)` | 以 ClickSelect 形状设置选中的 die 列表（原始坐标，自动换算显示位置） |
| `getSelectedDieCoordinates()` | 返回当前点选 / 框选 die 的原始坐标列表 `Point[]` |
| `hasOnlyClickSelectMarks()` | 当前标记是否全部为点选（ClickSelect） |
| `hasDefectsInMarks(defectPoint)` | 缺陷坐标是否落在任一标记内 |

### 标注

| 方法 | 说明 |
| --- | --- |
| `setData(data: AllShape[])` | 恢复标注数据（按 `type` 字段实例化为对应形状，支持 Rect / Polygon / Dot / Line / Circle / Grid） |
| `getMarksPoints()` | 返回每个标注覆盖的 die 坐标集合：`Set<[number, number]>[]`，按标注顺序排列；全部为点选时走快速路径直接返回 |
| `clearMarks()` | 清空全部标注（含点选拖框状态） |
| `deleteByIndex(index)` | 删除指定索引的标注（触发 `delete` 事件） |

### 命中检测

| 方法 | 说明 |
| --- | --- |
| `hitOnShape(mousePoint)` | 返回 `[索引, 标注实例]`，未命中时索引为 `-1` |
| `isPointInRect(point, coor)` / `isPointInPolygon(point, polygon)` / `isPointInCircle(point, center, r)` / `isPointInLine(point, coor)` | 点与矩形 / 多边形 / 圆 / 折线的命中判断（自动换算平移与缩放） |

### 生命周期

| 方法 | 说明 |
| --- | --- |
| `destroy()` | 取消渲染队列中的任务与防抖、销毁放大镜、解绑全部事件、清理 canvas / WebGL / 图例映射 / 背景图缓存、清空数据 |
| `on(eventName, cb)` / `off(eventName, cb)` / `emit(eventName, ...payload)` | 事件总线（继承自 `EventBus`） |

## 事件

通过 `instance.on(event, callback)` 监听：

| 事件 | 回调参数 | 触发时机 |
| --- | --- | --- |
| `load` | `image.src` | 底图加载完成 |
| `drawingStart` / `drawingEnd` | — | 渲染队列开始 / 结束一轮真实绘制（可用于展示 loading） |
| `hover` | `{ x, y, dieData?, defectData? }` | 鼠标在画布上移动（`wmConfig` 或 `defectConfig` 可见时）；`x` / `y` 为显示坐标系下的 die 格坐标，`dieData` / `defectData` 为命中的数据行（已按旋转 / 压缩换算） |
| `select` | 标注实例 或 `null` | 选中 / 取消选中标注，或 die 点选完成 |
| `add` | 标注实例 | 标注创建完成（矩形 / 圆 / 网格达到最小尺寸、多边形双击闭合、点 / ClickSelect 点击）；点选拖框结束后携带最后一个点选 |
| `delete` | 标注实例 | `deleteByIndex` 删除标注 |
| `updated` | `dataset` | 每帧画布刷新完成 |
| `warn` | 提示文本 | 标注尺寸低于最小限制等警告 |
| `contextmenu` | 原生事件 | 画布右键（已阻止默认菜单） |
| `localZoomComplete` | — | 局部放大框选完成并完成高分辨率重绘 |

## 标注绘制与交互细节

创建流程：设置 `instance.createType = Shape.Rect`（或其他形状）→ 在画布上按下左键开始 → 拖动 → 松开完成（多边形 / 折线为多次点击加点，双击结束，`Esc` 回退最后顶点）。

| 形状 | 创建 | 编辑 |
| --- | --- | --- |
| 矩形 `Rect` | 拖拽 | 8 个控制点缩放、整体拖拽 |
| 圆 `Circle` | 拖拽定半径 | 半径控制点、整体拖拽 |
| 多边形 `Polygon` | 点击加点，双击闭合（≥3 点） | 顶点拖拽、整体拖拽 |
| 折线 `Line` | 点击加点，双击结束（≥2 点），完成后显示测距 label（如 `11.82mm`） | 顶点拖拽、整体拖拽 |
| 点 `Dot` | 单击 | 整体拖拽 |
| 网格 `Grid` | 拖拽出外框，右键设置行列（`prompt` 输入 `行,列`），双击切换分区选中态 | 外框 8 控制点、整体拖拽 |
| die 选中 `ClickSelect` | `createType = Shape.ClickSelect` 后**单击**选中 / 再点取消单个 die，**拖框**批量选中框内全部 die（框选期间显示虚线选框） | 也可用 `setSelectedDies()` 编程设置；单选模式（`dotSelectionMode: 'single'`）下新点选会清空旧点 |
| 快速查找 `QuickFind` | 由 `quickFind()` 内部创建 | — |

其它交互约束：

- **缩放**：滚轮以鼠标为中心缩放；触屏双指缩放。放大超过 2 倍 / 缩小回落 2 倍以内 / 数值文本可辨认状态变化时，自动防抖（1 秒）用 WebGL 重绘高清晶圆图；放大上限受设备 WebGL 安全尺寸约束。
- **平移**：按住右键拖拽（桌面端）；触屏单指在非绘制状态下平移。
- **放大镜**：编辑控制点（或拖拽点标注）时在鼠标旁弹出 100px 圆形放大镜，松开即销毁；`magnifierPosition` 可固定位置。
- **快捷键**（绑定在 `document.body`，捕获阶段）：`Ctrl`（或 `ctrlCode` 指定的键）按住期间不创建 / 不结束标注；`Backspace` 删除选中标注；`Esc` 回退折线 / 多边形顶点。
- **边界限制**：标注拖拽与缩放被限制在画布范围内。

## 渲染与性能说明

- **渲染队列与请求合并**：所有重绘请求（`drawWafer`）先合并去重；单实例按需执行，die + defect 总点数超过 5 万（`WEBGL_RENDER_CHUNK_SIZE`）时进入页面级共享队列 `waferRenderQueue`，多实例串行执行 WebGL 重绘。隐藏（`setRenderingPaused`）、重查（新数据到达）与销毁会通过 `AbortSignal` 在安全检查点取消进行中的绘制。
- **WebGL 上下文/着色器复用**：同一实例的 WebGL 上下文与编译好的 program 跨绘制复用（省去每次 12~19ms 的上下文创建与编译），空闲 30 秒后自动 `loseContext` 释放；上下文被浏览器回收（`webglcontextlost`）时丢弃缓存并在下次绘制重建。
- **分块分图层渲染**：die 层按图层（rect 主矩形 / border 边框 / glow 发光 / mask 遮罩）× 5 万点分块生成顶点并 `drawArrays`，只为当前图层实际需要的元素分配 `Float32Array`；块间 `gl.flush()` + 让出宏任务，长任务可被新数据打断。绘制上下文开启 `antialias / alpha / preserveDrawingBuffer`，透明底色。
- **等高线 K 近邻 IDW**：控制点 ≤ 2048 时精确遍历全部控制点；更多时启用空间分桶逐环收集近邻（凑满约 32 个、至少一圈）——反距离权重随距离快速衰减，近似结果与精确结果肉眼不可辨，幂指数为 2 时权重用 `1/d²` 快路径。高度场按脏标记缓存：数据 / 等高线配置变化才重算，缩放与普通重绘只重排坐标；控制点绘制超过 2000 个时抽样且不画高度标签。
- **悬停命中索引**：die / defect 按显示坐标建 `Map<"x_y", 行>`（数据版本变化时重建），`getPoint` 为 O(1) 查表。
- **热力图颜色 memo**：同一次绘制内相同原始值复用颜色与 `dieValueEnum`，Big.js 构造与区间比较只发生在不同值上。
- **defect 符号精灵**：符号按（字形, 颜色, 0.5px 档位尺寸）预渲染缓存后 `drawImage`，替代逐缺陷 `fillText`。
- **资源治理**：绘制结束解绑缓冲区；缩放与局部放大的源图尺寸受设备 `MAX_TEXTURE_SIZE / MAX_RENDERBUFFER_SIZE / MAX_VIEWPORT_DIMS` 安全上限（探测后缓存）约束；`setRotate` 不再深拷贝整包数据。
- **缩放交互**：缩放比例非 1 时视图直接缩放已绘制的 `waferCanvas`；放大超过 2 倍、缩小回落、或数值文本可辨认状态变化时，防抖（400ms）重绘矢量晶圆图；滚轮路径不再触发强制布局（画布 CSS 比例缓存）。
- **坐标压缩脏标记**：`compressEmptyRowsColumns` 的压缩表只在数据 / 坐标字段 / 开关变化时重建；defect（保留 die 内小数偏移）、shot（矩形跨度映射）、zone、hover 命中全部自动换算。
- **缓存**：CSS 颜色 → WebGL rgba 换算、0-100 渐变色阶（按色板 + 透明度）、背景图（按 URL）、die 坐标读取闭包（按字段名 + 压缩表）均带缓存。
- **可辨字过滤**：格子数值文本小于 6 CSS 像素时跳过绘制；`prepareExport()` 临时恢复，导出后 `release()`。
- **帧调度**：视图层（标注 / 点选 / 局部放大框）统一走 `requestAnimationFrame`；`update()` 返回 `Promise<void>`，配合 `whenRendered()` 可精确等待画布真实提交。
- **移动端**：通过 `navigator.userAgent` 识别，事件统一合成处理（单击、双指缩放、三指呼出网格菜单、快速双击等效双击）。
