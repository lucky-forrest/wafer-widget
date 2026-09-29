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

源码入口为 `src/index.ts`，类型声明见 `lib/src/index.d.ts`（构建产物）。

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
| `backgroundColor` | `string` | 画布背景色 ✓ |
| `isShowGrid` | `boolean` | 是否绘制 die 网格参考线 ✓ |
| `basicConfig` | `object` | 各图层基础配置，见下 ✓ |
| `customBtns` | `CustomBtnConfig[]` | 自定义按钮配置（宿主槽位） |

### basicConfig

| 配置 | 类型 | 说明 |
| --- | --- | --- |
| `size` | `string` | 画布尺寸兜底值，如 `'600px'` ✓ |
| `isMeasure` | `boolean` | 测距开关（宿主槽位，折线标注本身带测距 label） |
| `isFullscreen` | `boolean` | 全屏开关（宿主槽位） |
| `isReturnDataInatches` | `boolean` | 批量返回数据开关（宿主槽位） |
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
| `visible` | `boolean` | 是否渲染 die；关闭时绘制圆形晶圆轮廓 ✓ |
| `position` | `{ x: string; y: string }` | die 坐标字段名（如 `XUI` / `YUI`，对应数据中的 `_o_XUI` / `_o_YUI`） ✓ |
| `value` | `string` | 用于图例着色 / 数值显示的字段名 ✓ |
| `isHeatmap` | `boolean` | 热力图模式：按 `(value - minValue) / (maxValue - minValue)` 在图例首尾颜色间插值 ✓ |
| `border` | `string` | 字段名：该字段为真的 die 绘制黑色边框 ✓ |
| `hightlight` | `string` | 字段名：该字段为真的 die 绘制紫色高亮边框 ✓ |
| `shadow` | `string` | 字段名：该字段为真的 die 绘制灰色遮罩 + 黄色发光效果 ✓ |
| `isShowLegendValue` | `boolean` | 是否在 die 上绘制图例值文本 ✓ |
| `legendValue` / `legendColor` / `legendName` | `string` | `legendList` 中值 / 颜色 / 名称的字段名 ✓ |
| `isSystemColor`、`isSelection`、`isRotate`、`isQuickFind`、`isShowLegend`、`legendLayout`、`legendDataSet`、`legendStatistic`、`transparency`、`data`、`wmDataSet` | — | 宿主槽位 |

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
    xDieCount: number; yDieCount: number;                   // x / y 方向 die 数
    minValue: number; maxValue: number;                     // 热力图插值域
    dataList: Record<string, any>[];                        // die 数据行
    legendList: Record<string, any>[];                      // die 图例
  };
  defect?: {
    minX: number; maxX: number; minY: number; maxY: number;
    filePath?: string;
    dataList: Record<string, any>[];
    legendList: Record<string, any>[];
  };
  shot?: { dataList: Record<string, any>[] };
  zone?: { dataList: Record<string, any>[] };
}
```

- `waferMap.dataList` / `defect.dataList` 每行必须包含 `_o_<position.x>`、`_o_<position.y>` 两个 0 基准 die 坐标字段（例如 `position.x = 'XUI'` 时为 `_o_XUI`）。这两个字段由**调用方预先计算**，组件用它们完成绘制、hover 命中与 `setRotate` 坐标变换。
- `legendList` 每行至少包含 `legendValue` / `legendColor`（die 建议额外提供 `hexColor` 供热力图插值）。颜色支持 `#RGB`、`#RRGGBB`、CSS 颜色名、`rgb()` / `rgba()`。
- `zone.dataList` 每行字段：`zoneNo`、`minAngleDegrees`、`maxAngleDegrees`、`minRadius`、`maxRadius`。

## 枚举

```ts
enum Layer { map, defect }        // 图例所属图层：die / 缺陷

enum WaferRotate {                // setRotate 入参（值为字符串）
  X镜像 = 'xMirror',
  Y镜像 = 'yMirror',
  旋转90° = 'rotate90',
  旋转180° = 'rotate180',
  旋转270° = 'rotate270',
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
| `isDrawing` | 是否正在绘制晶圆图 |

## 方法

### 数据与图例

| 方法 | 说明 |
| --- | --- |
| `updateData(waferData, contextParams?, callbackFn?)` | 合并更新晶圆数据、刷新图例映射并重绘。`callbackFn({ option, data, ...contextParams })` 可在数据更新时联动返回新配置（宿主平台使用） |
| `updateOption(option)` | 深合并更新配置并重绘 |
| `updateDieLegend(legendList?)` | 更新 die 图例映射（颜色会转换为 WebGL 格式）；不传参仅重建映射 |
| `updateDefectLegend(legendList?)` | 更新缺陷图例映射 |
| `updateHeatmap(value)` | 热力图模式下设置阈值，低于该值的 die 不再绘制 |
| `toggleLegend(type: Layer, legendValue, callback)` | 切换某图例的显示 / 隐藏（内部维护排除列表），回调返回当前全部被排除的图例值，随后防抖重绘 |
| `batchSetLegend(type: Layer, legendValues)` | 整体替换排除列表，随后防抖重绘 |

### 视图控制

| 方法 | 说明 |
| --- | --- |
| `redraw()` | 立即重绘晶圆图 |
| `resize()` | 重新初始化画布尺寸与事件并重绘 |
| `fitZoom()` | 适配画布，居中显示 |
| `setScale(type, byMouse?, pure?)` | 缩放：`type` 为 `true` 放大 5%、`false` 缩小 5%；`byMouse` 以鼠标为中心；`pure` 只计算不绘制。上限为原图最大边的 100 倍，下限为最小边 300px |
| `setRotate(rotateAngle: WaferRotate)` | 镜像 / 旋转 / 重置：基于 `_o_` 坐标变换 die 与缺陷数据后重绘 |
| `quickFind(point)` | 快速查找：复位视图、定位到指定 die 坐标并自动放大聚焦（绘制 `↓` 标记） |
| `setFocusMode(type)` | 切换专注模式 |
| `setImage(url)` | 设置 / 切换底层背景图（晶圆图默认绘制的位图） |
| `saveImage(download?)` | 导出图片：700×600 JPEG（左侧 600×600 晶圆图 + 右侧图例）。`download=true`（默认）触发下载，文件名 `wafer-<时间戳>.jpg`；传 `false` 返回 canvas 元素 |

### 标注

| 方法 | 说明 |
| --- | --- |
| `setData(data: AllShape[])` | 恢复标注数据（按 `type` 字段实例化为对应形状，支持 Rect / Polygon / Dot / Line / Circle / Grid） |
| `setSelectedDies(points: Point[])` | 以 ClickSelect 形状设置选中的 die 列表（覆盖现有标注） |
| `getMarksPoints()` | 返回每个标注覆盖的 die 坐标集合：`Set<[number, number]>[]`，按标注顺序排列 |
| `clearMarks()` | 清空全部标注 |
| `deleteByIndex(index)` | 删除指定索引的标注（触发 `delete` 事件） |

### 命中检测

| 方法 | 说明 |
| --- | --- |
| `hitOnShape(mousePoint)` | 返回 `[索引, 标注实例]`，未命中时索引为 `-1` |
| `isPointInRect(point, coor)` / `isPointInPolygon(point, polygon)` / `isPointInCircle(point, center, r)` / `isPointInLine(point, coor)` | 点与矩形 / 多边形 / 圆 / 折线的命中判断（自动换算平移与缩放） |

### 生命周期

| 方法 | 说明 |
| --- | --- |
| `destroy()` | 解绑全部事件、清理 canvas 与图例映射、清空数据 |
| `on(eventName, cb)` / `off(eventName, cb)` / `emit(eventName, ...payload)` | 事件总线（继承自 `EventBus`） |

## 事件

通过 `instance.on(event, callback)` 监听：

| 事件 | 回调参数 | 触发时机 |
| --- | --- | --- |
| `load` | `image.src` | 底图加载完成 |
| `hover` | `{ x, y, dieData?, defectData? }` | 鼠标在画布上移动（`wmConfig` 或 `defectConfig` 可见时）；`x` / `y` 为 die 格坐标，`dieData` / `defectData` 为命中的数据行 |
| `select` | 标注实例 或 `null` | 选中 / 取消选中标注，或 ClickSelect 选中 die |
| `add` | 标注实例 | 标注创建完成（矩形 / 圆 / 网格达到最小尺寸、多边形双击闭合、点 / ClickSelect 点击） |
| `delete` | 标注实例 | `deleteByIndex` 删除标注 |
| `updated` | `dataset` | 每帧画布刷新完成 |
| `warn` | 提示文本 | 标注尺寸低于最小限制等警告 |
| `contextmenu` | 原生事件 | 画布右键（已阻止默认菜单） |

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
| die 选中 `ClickSelect` | `createType = Shape.ClickSelect` 后单击 die，再次单击取消 | 也可用 `setSelectedDies()` 编程设置 |
| 快速查找 `QuickFind` | 由 `quickFind()` 内部创建 | — |

其它交互约束：

- **缩放**：滚轮以鼠标为中心缩放；触屏双指缩放。放大超过 2 倍时自动防抖（2 秒）用 WebGL 重绘高清晶圆图。
- **平移**：按住右键拖拽（桌面端）；触屏单指在非绘制状态下平移。
- **放大镜**：编辑控制点（或拖拽点标注）时在鼠标旁弹出 100px 圆形放大镜，松开即销毁；`magnifierPosition` 可固定位置。
- **快捷键**（绑定在 `document.body`，捕获阶段）：`Ctrl`（或 `ctrlCode` 指定的键）按住期间不创建 / 不结束标注；`Backspace` 删除选中标注；`Esc` 回退折线 / 多边形顶点。
- **边界限制**：标注拖拽与缩放被限制在画布范围内。

## 渲染与性能说明

- **分层渲染**：die 层使用离屏 WebGL canvas 批量绘制（单次 `drawArrays` 完成全部矩形，顶点与颜色预计算到 `Float32Array`）；缺陷、Shot、Zone、Summary 及标注层使用 Canvas 2D。
- **多级画布**：晶圆图先绘制到离屏 `waferCanvas`，在缩放比例为 1 时导出为位图（`toDataURL`）作为背景图，缩放交互期间直接缩放位图，放大超过 2 倍才防抖重绘矢量晶圆图，避免高频 WebGL 调用。
- **缓冲区清理**：每次 WebGL 绘制后统一 `deleteBuffer`，离屏 canvas 用完即移除。
- **帧调度**：标注层重绘统一走 `requestAnimationFrame`，高频事件（mousemove）不会产生多余绘制。
- **移动端**：通过 `navigator.userAgent` 识别，事件统一合成处理（单击、双指缩放、三指呼出网格菜单、快速双击等效双击）。
