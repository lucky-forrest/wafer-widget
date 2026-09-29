# wafer-widget

基于 Canvas 2D + WebGL 的晶圆图（Wafer Map）渲染与标注组件。核心架构源自图片标注库 [canvas-select-plus](https://github.com/DongMenKant/canvas-select-plus)，在其缩放、平移、标注交互体系上扩展了半导体晶圆图所需的数据可视化能力。TypeScript 编写，打包为 UMD 模块，无框架依赖。

![晶圆图示例](./index.png)

## 功能特性

### 晶圆图渲染

- **Die 分布图**：WebGL 批量着色渲染，支持按图例字段离散着色与热力图模式（图例首尾颜色插值）
- **Die 标记**：按数据字段标记黑色边框、紫色高亮边框、灰色遮罩 + 黄色发光效果
- **Die 数值显示**：直接在格子上绘制图例值
- **网格参考线**：可开关的 die 网格线（`isShowGrid`）
- **缺陷图（Defect）**：Canvas 2D 渲染，符号（`● ▲ ★ ✦ ⚑ ◉ ■ +` 等）、大小、颜色均支持按条件表达式映射
- **Shot / Reticle 曝光场**：按行列偏移绘制矩形框
- **Zone 分区**：按角度 / 半径绘制扇形分区及编号
- **Wafer Summary**：在画布四角任意位置绘制晶圆摘要信息

### 交互与标注

- 标注形状：矩形、多边形、折线（测距）、圆形、网格（分区选择）、点、单击选中 die（ClickSelect）
- 滚轮缩放（以鼠标为中心）、右键拖拽平移画布、触屏双指缩放
- 标注支持拖拽、控制点微调，编辑控制点时自动弹出圆形放大镜
- 快速查找：定位目标 die 并自动放大聚焦
- 图例显隐：单个切换（`toggleLegend`）/ 批量设置（`batchSetLegend`）
- 晶圆旋转与镜像：X / Y 镜像、90° / 180° / 270° 旋转、重置
- 导出带图例的晶圆图片（JPEG 下载或返回 canvas）

## 环境要求

- Node.js `~14` 或 `~16`（见 `package.json` 的 `engines` 字段）
- 浏览器需支持 Canvas 2D 与 WebGL

## 安装

```bash
npm install wafer-widget --save
```

> `lib/` 为构建产物目录，已在 `.gitignore` 中忽略。从源码使用时请先执行 `npm run build` 生成 `lib/wafer-widget.min.js` 及类型声明文件。

## 快速开始

### script 标签引入（UMD）

```html
<script src="./lib/wafer-widget.min.js"></script>
<canvas id="wafer-widget" width="600px" height="600px"></canvas>
<script>
  const wafer = new WaferWidget(document.getElementById('wafer-widget'), waferOptions);
  wafer.updateData(waferData);
  wafer.on('hover', (p) => console.log(p.x, p.y, p.dieData));
</script>
```

### 模块环境引入

```js
import WaferWidget from 'wafer-widget';
```

完整示例见根目录的 [index.html](./index.html)（内嵌示例数据）。执行 `npm run serve` 后访问 <http://127.0.0.1:9999> 即可查看。

### 数据结构概览

`updateData(waferData)` 接收的数据主要包含以下部分：

| 字段 | 说明 |
| --- | --- |
| `waferSummary` | 晶圆摘要键值对，配合 `wsConfig.data` 绘制在画布角落 |
| `waferMap` | Die 数据：`dataList`（每行需含 `_o_<x>` / `_o_<y>` 归一化坐标字段）、`legendList`、`min/max` 值与 `xDieCount` / `yDieCount` 等 |
| `defect` | 缺陷数据：`dataList`（同样使用 `_o_<x>` / `_o_<y>` 坐标）、`legendList` |
| `shot` | Reticle 曝光场 `dataList` |
| `zone` | 分区 `dataList`（含 `minAngleDegrees` / `maxAngleDegrees` / `minRadius` / `maxRadius` / `zoneNo`） |

> `_o_` 前缀字段（如 `position.x` 配置为 `XUI` 时对应 `_o_XUI`）是调用方预先计算好的 0 基准 die 坐标，组件直接使用其绘制、命中检测与旋转变换。

### 常用 API

| 方法 | 说明 |
| --- | --- |
| `updateData(waferData)` | 更新晶圆图数据并重绘 |
| `updateOption(option)` | 合并更新配置并重绘 |
| `redraw()` | 强制重绘晶圆图 |
| `setRotate(angle)` | 镜像 / 旋转 / 重置 |
| `quickFind(point)` | 快速定位到指定 die 并放大 |
| `toggleLegend(layer, value, cb)` / `batchSetLegend(layer, values)` | 图例显隐控制 |
| `updateHeatmap(value)` | 热力图模式下设置阈值 |
| `setSelectedDies(points)` | 设置选中的 die 列表 |
| `getMarksPoints()` | 获取标注覆盖的 die 坐标集合 |
| `saveImage(download?)` | 导出带图例的图片 |
| `destroy()` / `resize()` | 销毁 / 重设画布尺寸 |

完整配置项、方法、事件与交互说明见 **[docs/API.md](./docs/API.md)**。

## 交互操作

| 操作 | 方式 |
| --- | --- |
| 缩放 | 鼠标滚轮 / 触屏双指 |
| 平移画布 | 按住右键拖拽 |
| 创建标注 | 将 `createType` 设为对应 `Shape` 后左键绘制 |
| 结束折线 / 多边形绘制 | 双击（移动端为快速双击屏幕） |
| 回退折线 / 多边形顶点 | `Esc` |
| 删除选中标注 | `Backspace` |
| 调整网格行列 | 选中网格后右键呼出输入框 |
| 切换网格分区选中态 | 双击网格内分区 |
| 暂停画布标注 | 按住 `Ctrl`（可通过 `ctrlCode` 自定义键位），期间左键不创建标注，供宿主接管交互 |

## 本地开发

```bash
npm install        # 安装依赖
npm run dev        # rollup watch 构建 + live-server（端口 9999）
npm run watch      # 仅监听构建
npm run build      # 产出 lib/wafer-widget.min.js（含 sourcemap 与 .d.ts）
npm run serve      # 仅启动演示页服务
```

## 目录结构

```
├── index.html          # 本地演示页（内嵌示例数据）
├── rollup.config.js    # UMD 打包配置（全局变量名 WaferWidget）
├── src/
│   ├── index.ts        # WaferWidget 主类（渲染 + 交互 + 公开 API）
│   ├── event-bus.ts    # 事件总线（on / emit / off）
│   ├── tools.ts        # 颜色转换、插值、自定义函数等工具
│   └── shape/          # 标注形状：矩形、多边形、点、折线、圆、网格、ClickSelect、QuickFind
└── lib/                # 构建产物（git 忽略，npm 发布目录）
```

## 许可

[MIT](./package.json)
